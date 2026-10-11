import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GUIDE_BRIEF_EXAMPLE } from "../app/domain/guides.ts";
import { authenticate } from "../app/lib/auth.ts";
import { hash, InboxError } from "../app/lib/common.ts";
import { toolDefinitions, toolInputSchema } from "../app/schemas.ts";
import { A, B, harness, R, send, setup } from "./harness.ts";

function denied(fn: () => any, code = "forbidden") {
  let e: any;
  try {
    fn();
  } catch (x) {
    e = x;
  }
  expect(e).toBeInstanceOf(InboxError);
  expect(e.code).toBe(code);
}
function reply(h: any, id: string, words = "Confirmed", key = "human-1") {
  return h.write(R, `/api/inbox/messages/${id}/reply`, {
    words,
    idempotency_key: key,
    questions: [],
  });
}
test("credentials authenticate independently of all routing identifiers", () => {
  const h = harness();
  const a = setup(h);
  const b = setup(h, B, "t3-b");
  expect(a).not.toBe(b);
  denied(
    () => authenticate({ id: "account-a", fields: { token: "0".repeat(64) } }),
    "unauthorized"
  );
  denied(() => h.call(B, "read_thread", { session_id: a }));
  denied(() =>
    h.call(B, "open_session", {
      environment_id: A.environments[0],
      thread_id: "t3-b",
      project_key: "shared-native",
      source_path: "/x",
    })
  );
  denied(() =>
    h.call(B, "open_session", {
      environment_id: B.environments[0],
      thread_id: "t3-b",
      project_key: "a-only",
      source_path: "/x",
    })
  );
  h.close();
});
test("same project and same raw retry key never grants foreign thread membership", () => {
  const h = harness();
  const a = setup(h),
    b = setup(h, B, "t3-b");
  const x = send(h, A, a),
    y = send(h, B, b);
  expect(x.project.id).toBe(y.project.id);
  expect(x.message_id).not.toBe(y.message_id);
  denied(() =>
    h.call(B, "read_thread", { session_id: b, thread_id: x.thread_id })
  );
  denied(() =>
    h.call(B, "resolve_message", {
      session_id: b,
      message_id: x.message_id,
      idempotency_key: "resolve",
    })
  );
  denied(() =>
    send(h, B, b, { reply_to: x.message_id, idempotency_key: "reply" })
  );
  h.close();
});
test("retry receipts remain exact, reject changed payload, and default threads persist", () => {
  const h = harness();
  const a = setup(h);
  const x = send(h, A, a);
  expect(send(h, A, a).message_id).toBe(x.message_id);
  denied(() => send(h, A, a, { body: "different" }), "idempotency_key_reused");
  expect(send(h, A, a, { idempotency_key: "send-twice" }).thread_id).toBe(
    x.thread_id
  );
  expect(
    h.call(A, "read_thread", { session_id: a, thread_id: x.thread_id })
      .structuredContent.thread.messages.length
  ).toBe(2);
  h.close();
});
test("named threads and older reopened roots do not grant access", () => {
  const h = harness();
  const a = setup(h),
    b = setup(h, B, "t3-b");
  const x = send(h, A, a, { thread: "Release" });
  denied(() => send(h, B, b, { thread: "release" }));
  h.call(A, "resolve_message", {
    session_id: a,
    message_id: x.message_id,
    idempotency_key: "close",
  });
  const y = send(h, A, a, { thread: "Release", idempotency_key: "second" });
  expect(y.thread_id).not.toBe(x.thread_id);
  h.call(A, "resolve_message", {
    session_id: a,
    message_id: y.message_id,
    idempotency_key: "close-two",
  });
  h.call(A, "resolve_message", {
    session_id: a,
    message_id: x.message_id,
    idempotency_key: "reopen",
    resolved: false,
  });
  expect(
    send(h, A, a, { thread: "Release", idempotency_key: "third" }).thread_id
  ).toBe(x.thread_id);
  denied(() =>
    send(h, B, b, { thread: "Release", idempotency_key: "foreign" })
  );
  h.close();
});
test("explicit invitation allows a joined read, but waits deliver replies only to origin", () => {
  const h = harness();
  const a = setup(h),
    b = setup(h, B, "t3-b"),
    c = setup(h, B, "t3-c");
  const x = send(h, A, a);
  const token = h.call(A, "create_join_token", {
    session_id: a,
    thread_id: x.thread_id,
    idempotency_key: "invite",
  }).structuredContent.join_token;
  h.call(B, "join_thread", { session_id: b, join_token: token });
  denied(() => h.call(B, "join_thread", { session_id: c, join_token: token }));
  reply(h, x.message_id);
  expect(
    h.call(B, "read_thread", { session_id: b, thread_id: x.thread_id })
      .structuredContent.thread.messages.length
  ).toBe(2);
  expect(
    h.call(B, "wait_for_reply", { session_id: b, thread_id: x.thread_id })
      .structuredContent.status
  ).toBe("waiting");
  expect(
    h.call(A, "wait_for_reply", { session_id: a, thread_id: x.thread_id })
      .structuredContent.status
  ).toBe("replied");
  h.close();
});
test("agent profiles cannot impersonate the human through UI read or mutation", () => {
  const h = harness();
  const a = setup(h),
    x = send(h, A, a);
  denied(() => h.read(A, "/api/inbox/threads"));
  denied(() =>
    h.write(A, `/api/inbox/messages/${x.message_id}/reply`, {
      words: "spoof",
      idempotency_key: "x",
    })
  );
  denied(() =>
    h.call(R, "open_session", {
      environment_id: "native-env-a",
      thread_id: "x",
      project_key: "shared-native",
      source_path: "/x",
    })
  );
  h.close();
});
test("question picks and sent answers use real domain and stale revisions fail atomically", () => {
  const h = harness();
  const a = setup(h),
    x = send(h, A, a);
  const [q] = h.read(R, `/api/inbox/threads/${x.thread_id}`).thread.messages[0]
    .questions;
  const entry = {
    key: q.key,
    revision: q.revision,
    answer: {
      v: 1,
      key: q.key,
      kind: q.kind,
      prompt: q.prompt,
      selected: [q.choices[0].label],
    },
  };
  h.write(R, `/api/inbox/messages/${x.message_id}/picks`, {
    questions: [entry],
  });
  denied(
    () =>
      h.write(R, `/api/inbox/messages/${x.message_id}/picks`, {
        questions: [entry],
      }),
    "question_revision_conflict"
  );
  const [picked] = h.read(R, `/api/inbox/threads/${x.thread_id}`).thread
    .messages[0].questions;
  h.write(R, `/api/inbox/messages/${x.message_id}/reply`, {
    idempotency_key: "answer",
    questions: [{ key: picked.key, revision: picked.revision }],
    words: "Use the guard.",
  });
  expect(
    h.call(A, "wait_for_reply", { session_id: a }).structuredContent.reply.body
  ).toContain("Reject empty tokens");
  h.close();
});
test("durable unacknowledged replies survive later sends, no-ID polls and response retries", () => {
  const h = harness();
  const a = setup(h),
    x = send(h, A, a);
  reply(h, x.message_id, "One");
  send(h, A, a, { idempotency_key: "later" });
  const first = h.call(A, "wait_for_reply", {
    session_id: a,
    request_id: "poll-1",
  }).structuredContent;
  expect(first.status).toBe("replied");
  expect(first.reply.body).toContain("One");
  expect(
    h.call(A, "get_reply_cursor", { session_id: a }).structuredContent
      .acknowledged_cursor
  ).toBeLessThan(first.cursor);
  reply(h, x.message_id, "Two", "human-2");
  expect(
    h.call(A, "wait_for_reply", { session_id: a, request_id: "poll-1" })
      .structuredContent.reply.message_id
  ).toBe(first.reply.message_id);
  const second = h.call(A, "wait_for_reply", {
    session_id: a,
    cursor: first.cursor,
  }).structuredContent;
  expect(second.reply.body).toContain("Two");
  expect(second.cursor).toBeGreaterThan(first.cursor);
  h.close();
});
test("single-thread and all-thread cursors remain separate and future cursors fail", () => {
  const h = harness();
  const a = setup(h);
  const x = send(h, A, a, { thread: "one" }),
    y = send(h, A, a, { thread: "two", idempotency_key: "two" });
  reply(h, x.message_id, "first");
  reply(h, y.message_id, "second");
  const p = h.call(A, "wait_for_reply", {
    session_id: a,
    thread_id: x.thread_id,
  }).structuredContent;
  h.call(A, "wait_for_reply", {
    session_id: a,
    thread_id: x.thread_id,
    cursor: p.cursor,
  });
  expect(
    h.call(A, "wait_for_reply", { session_id: a }).structuredContent.reply.body
  ).toContain("first");
  denied(
    () => h.call(A, "wait_for_reply", { session_id: a, cursor: 100_000 }),
    "invalid_cursor"
  );
  h.close();
});
test("new thread with reply after a waiting poll never disappears behind the global cursor", () => {
  const h = harness();
  const a = setup(h);
  send(h, A, a);
  const waiting = h.call(A, "wait_for_reply", {
    session_id: a,
  }).structuredContent;
  const x = send(h, A, a, { thread: "new", idempotency_key: "new" });
  reply(h, x.message_id, "new reply");
  expect(
    h.call(A, "wait_for_reply", { session_id: a, cursor: waiting.cursor })
      .structuredContent.reply.body
  ).toContain("new reply");
  h.close();
});
test("file metadata and binary bytes are immutable, authorized and hash checked", () => {
  const h = harness();
  const a = setup(h),
    b = setup(h, B, "b");
  const binary = Buffer.from([0, 1, 2, 250, 255]);
  const input = {
    session_id: a,
    files: [
      {
        path: "docs/review.md",
        encoding: "utf8",
        content: "# Frozen plan",
        mtime: "2026-10-10T10:00:00.000Z",
      },
      {
        path: "images/pixel.bin",
        encoding: "base64",
        content: binary.toString("base64"),
      },
    ],
    revision: {
      repository: "example",
      base: "abc",
      head: "def",
      branch: "feature",
      dirty: true,
    },
  };
  const x = h.call(A, "upload_snapshot", input).structuredContent;
  expect(
    h.call(A, "upload_snapshot", input).structuredContent.snapshot_id
  ).toBe(x.snapshot_id);
  expect(
    h.call(A, "read_snapshot", {
      session_id: a,
      snapshot_id: x.snapshot_id,
      path: "images/pixel.bin",
    }).structuredContent.file.content
  ).toBe(binary.toString("base64"));
  denied(() =>
    h.call(B, "read_snapshot", { session_id: b, snapshot_id: x.snapshot_id })
  );
  denied(
    () =>
      h.call(A, "upload_snapshot", {
        ...input,
        files: [{ ...input.files[0], sha256: "a".repeat(64) }],
      }),
    "hash_mismatch"
  );
  const sent = send(h, A, a, {
    snapshot_id: x.snapshot_id,
    attachments: ["docs/review.md"],
  });
  const view = h.read(
    R,
    `/api/inbox/attachments/${sent.attachments[0].id}/view`
  );
  expect(view.text).toBe("# Frozen plan");
  expect(view.version).toBe(hash("# Frozen plan"));
  expect(view.attachment.path).toBe("docs/review.md");
  h.close();
});
test("upload path, collision, unknown fields and encoding failures reject", () => {
  const h = harness();
  const a = setup(h);
  for (const path of ["../secret", "/secret", "docs\\a", "./a", "a//b"]) {
    denied(
      () =>
        h.call(A, "upload_snapshot", {
          session_id: a,
          files: [{ path, encoding: "utf8", content: "x" }],
        }),
      "validation_error"
    );
  }
  denied(
    () =>
      h.call(A, "upload_snapshot", {
        session_id: a,
        files: [
          { path: "a", encoding: "utf8", content: "x" },
          { path: "A", encoding: "utf8", content: "x" },
        ],
      }),
    "validation_error"
  );
  denied(
    () =>
      h.call(A, "upload_snapshot", {
        session_id: a,
        files: [{ path: "a", encoding: "base64", content: "not base64" }],
      }),
    "validation_error"
  );
  denied(
    () =>
      h.call(A, "upload_snapshot", {
        session_id: a,
        files: [{ path: "a", encoding: "utf8", content: "x", symlink: true }],
      }),
    "validation_error"
  );
  h.close();
});
test("max file upload roundtrips and oversize fails before writes", () => {
  const h = harness();
  const a = setup(h);
  const data = "x".repeat(1024 * 1024);
  const x = h.call(A, "upload_snapshot", {
    session_id: a,
    files: [{ path: "large.txt", encoding: "utf8", content: data }],
  }).structuredContent;
  expect(
    h.call(A, "read_snapshot", {
      session_id: a,
      snapshot_id: x.snapshot_id,
      path: "large.txt",
    }).structuredContent.file.content.length
  ).toBe(data.length);
  denied(
    () =>
      h.call(A, "upload_snapshot", {
        session_id: a,
        files: [{ path: "too.txt", encoding: "utf8", content: `${data}x` }],
      }),
    "size_limit"
  );
  h.close();
});
test("durable chunk uploads allow reorder/retry but refuse conflicting or missing chunks", () => {
  const h = harness();
  const a = setup(h);
  const manifest = Buffer.from(
    JSON.stringify({
      files: [
        { path: "docs/a.txt", encoding: "utf8", content: "x".repeat(25_000) },
      ],
    })
  );
  const parts = [manifest.subarray(0, 20_000), manifest.subarray(20_000)];
  for (const i of [1, 0, 0]) {
    h.call(A, "upload_snapshot_chunk", {
      session_id: a,
      upload_id: "up",
      index: i,
      content_base64: parts[i].toString("base64"),
    });
  }
  const x = h.call(A, "commit_snapshot_upload", {
    session_id: a,
    upload_id: "up",
    chunk_count: 2,
    sha256: hash(manifest),
  }).structuredContent;
  expect(x.files[0].size).toBe(25_000);
  denied(
    () =>
      h.call(A, "upload_snapshot_chunk", {
        session_id: a,
        upload_id: "up",
        index: 0,
        content_base64: "eA==",
      }),
    "idempotency_key_reused"
  );
  h.close();
});
test("Markdown annotations return with immutable paths, and code annotations refuse", () => {
  const h = harness();
  const a = setup(h);
  const snap = h.call(A, "upload_snapshot", {
    session_id: a,
    files: [
      { path: "docs/a.md", encoding: "utf8", content: "# Alpha" },
      { path: "src/a.ts", encoding: "utf8", content: "const alpha = 1;" },
    ],
  }).structuredContent;
  const x = send(h, A, a, {
    snapshot_id: snap.snapshot_id,
    attachments: ["docs/a.md", "src/a.ts"],
  });
  const view = h.read(R, `/api/inbox/attachments/${x.attachments[0].id}/view`);
  const { annotation } = h.write(R, "/api/inbox/annotations", {
    attachment_id: x.attachments[0].id,
    version: view.version,
    annotation: {
      id: "annotation-test",
      type: "global_comment",
      text: "Use AuthError",
    },
  });
  denied(
    () =>
      h.write(R, "/api/inbox/annotations", {
        attachment_id: x.attachments[1].id,
        version: hash("const alpha = 1;"),
        annotation: { id: "code-test", type: "global_comment", text: "No" },
      }),
    "validation_error"
  );
  h.write(R, `/api/inbox/messages/${x.message_id}/reply`, {
    idempotency_key: "annotated",
    words: "Reviewed",
    feedback: "docs/a.md: Use AuthError",
    annotation_ids: [annotation.id],
    questions: [],
  });
  expect(
    h.call(A, "wait_for_reply", { session_id: a }).structuredContent.reply.body
  ).toContain("AuthError");
  h.close();
});
test("guide submission validates placement and retries canonical object keys", () => {
  const h = harness();
  const a = setup(h);
  const input = {
    ...GUIDE_BRIEF_EXAMPLE,
    session_id: a,
    idempotency_key: "guide",
  };
  const x = h.call(A, "submit_guide", input).structuredContent;
  const reordered = {
    ...input,
    guide: Object.fromEntries(Object.entries(input.guide).reverse()),
  };
  expect(
    h.call(A, "submit_guide", reordered).structuredContent.message_id
  ).toBe(x.message_id);
  const g = h.read(R, `/api/inbox/messages/${x.message_id}/guide`);
  expect(g.snapshot.review.rawPatch).toBe(input.patch);
  denied(
    () =>
      h.call(A, "submit_guide", {
        ...input,
        idempotency_key: "invalid",
        guide: {
          ...input.guide,
          sections: [
            {
              title: "Wrong",
              overview: "Wrong",
              diffs: [{ file: "missing.ts", summary: "Wrong" }],
            },
          ],
        },
      }),
    "invalid_guide"
  );
  h.close();
});
test("mutation rollback includes blobs and records if a later send fails", () => {
  const h = harness();
  const a = setup(h);
  const before = h.sql.exec("SELECT count(*) n FROM blobs").one().n;
  denied(() =>
    h.call(A, "submit_guide", {
      ...GUIDE_BRIEF_EXAMPLE,
      session_id: a,
      idempotency_key: "failed",
      reply_to: "foreign",
    })
  );
  expect(h.sql.exec("SELECT count(*) n FROM blobs").one().n).toBe(before);
  h.close();
});
test("physical database close/reopen preserves sessions, receipts, bytes, replies and cursors", () => {
  const dir = mkdtempSync(join(tmpdir(), "plannotator-inbox-test-"));
  const file = join(dir, "app.sqlite");
  let h = harness(file);
  const a = setup(h),
    x = send(h, A, a);
  reply(h, x.message_id, "Persist this");
  h.close();
  h = harness(file);
  expect(setup(h)).toBe(a);
  expect(send(h, A, a).message_id).toBe(x.message_id);
  expect(
    h.call(A, "wait_for_reply", { session_id: a }).structuredContent.reply.body
  ).toContain("Persist this");
  h.close();
  rmSync(dir, { recursive: true });
});
test("actual apps jsonSchema rejects unknown fields rather than strips them", () => {
  const tool = toolDefinitions.find((t) => t.name === "send_message");
  if (!tool) {
    throw new Error("Missing send_message tool definition.");
  }
  expect(() =>
    toolInputSchema(tool).parse({
      session_id: "s",
      body: "ok",
      idempotency_key: "x",
      forged_role: "reviewer",
    })
  ).toThrow();
});
test("UI exact field checks and unsupported operations are explicit", () => {
  const h = harness();
  setup(h);
  denied(() => h.write(R, "/api/inbox/restart", {}), "unsupported_operation");
  denied(() => h.read(R, "/api/inbox/threads?drop=true"), "validation_error");
  denied(
    () =>
      h.write(R, "/api/inbox/annotations", {
        attachment_id: "x",
        version: "x",
        annotation: {},
        extra: true,
      }),
    "validation_error"
  );
  h.close();
});
