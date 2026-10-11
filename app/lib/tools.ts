import type { SqlReader } from "apps";
import { projects } from "../config.js";
import type { InboxStore } from "../domain/store.js";
import { recordAgentDecision } from "../domain/decisions.js";
import {
  checkInboxGuide,
  describeInboxGuide,
  inboxGuideInputHash,
  GUIDE_BRIEF_EXAMPLE,
  GUIDE_DIFF_STEPS,
  GUIDE_RULES,
  GUIDE_REVIEW_PROMPT,
  GUIDE_SCHEMA_JSON,
} from "../domain/guides.js";
import {
  inboxThreadNameKey,
  checkInboxThreadName,
} from "../vendor/core/inbox-types.js";
import {
  sessionOf,
  requireAgent,
  member,
  checkMetadata,
  type Principal,
  type Session,
} from "./auth.js";
import {
  Buffer,
  ok,
  hash,
  canonical,
  refuse,
  jsonSize,
  type Input,
} from "./common.js";
import { cached } from "./requests.js";
import {
  upload,
  uploadChunk,
  commitUpload,
  readSnapshot,
  attachments,
  writeBlob,
} from "./uploads.js";
export function appUrl(sql: SqlReader, thread?: string) {
  const url =
    sql
      .exec<{
        value: string;
      }>("SELECT value FROM settings WHERE key=?", "ui_url")
      .toArray()[0]?.value ?? "";
  return url + (thread ? "#thread=" + thread : "");
}
function cursor(sql: SqlReader, s: Session, scope: string, initial: number) {
  sql.exec(
    "INSERT OR IGNORE INTO cursors(session_id,scope,acknowledged,returned) VALUES(?,?,?,?)",
    s.id,
    scope,
    initial,
    initial,
  );
  return sql
    .exec<{
      acknowledged: number;
      returned: number;
    }>("SELECT acknowledged,returned FROM cursors WHERE session_id=? AND scope=?", s.id, scope)
    .one();
}
function memberships(sql: SqlReader, s: Session) {
  return sql
    .exec<{ thread_id: string }>(
      "SELECT thread_id FROM memberships WHERE session_id=?",
      s.id,
    )
    .toArray()
    .map((r) => r.thread_id);
}
export function openSession(
  sql: SqlReader,
  store: InboxStore,
  p: Principal,
  input: Input,
) {
  requireAgent(p);
  if (
    !p.environments.includes(input.environment_id) ||
    !p.projects.includes(input.project_key)
  )
    refuse(
      "forbidden",
      "Credential does not grant that environment and project.",
    );
  if (!/^\//.test(input.source_path) || input.source_path.length > 4096)
    refuse(
      "validation_error",
      "source_path must be an absolute caller path (metadata only).",
    );
  if (input.thread_id.length > 300 || input.environment_id.length > 300)
    refuse("validation_error", "T3 identity metadata exceeds 300 characters.");
  const prior = sql
    .exec<Session>(
      "SELECT * FROM sessions WHERE principal_id=? AND environment_id=? AND origin_thread=? AND project_key=?",
      p.id,
      input.environment_id,
      input.thread_id,
      input.project_key,
    )
    .toArray()[0];
  if (prior) {
    if (
      prior.source_path !== input.source_path ||
      prior.agent_name !== (input.agent_name ?? null)
    )
      refuse(
        "session_conflict",
        "Existing durable session has different metadata.",
      );
    return ok("Resumed durable session.", {
      session_id: prior.id,
      project: store.project(prior.project_id),
      environment_id: prior.environment_id,
      thread_id: prior.origin_thread,
      resumed: true,
    });
  }
  const projectConfig = projects[input.project_key as keyof typeof projects];
  if (!projectConfig) refuse("forbidden", "Project mapping is not configured.");
  const project = store.ensureProject(projectConfig);
  const id = "ses_" + crypto.randomUUID().replaceAll("-", "");
  sql.exec(
    "INSERT INTO sessions(id,principal_id,environment_id,origin_thread,project_key,project_id,source_path,agent_name,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    id,
    p.id,
    input.environment_id,
    input.thread_id,
    input.project_key,
    project.id,
    input.source_path,
    input.agent_name ?? null,
    new Date().toISOString(),
  );
  return ok("Opened durable session.", {
    session_id: id,
    project,
    environment_id: input.environment_id,
    thread_id: input.thread_id,
    resumed: false,
  });
}
function send(
  sql: SqlReader,
  store: InboxStore,
  s: Session,
  input: Input,
  guide?: Parameters<InboxStore["sendMessage"]>[0]["guide"],
) {
  if (input.reply_to) member(sql, store, s, input.reply_to);
  if (input.thread && !input.reply_to) {
    const check = checkInboxThreadName(input.thread);
    if (!check.ok) refuse("validation_error", check.message);
    const name = inboxThreadNameKey(check.name);
    const existing = sql
      .exec<{
        owner_session: string;
      }>("SELECT owner_session FROM thread_names WHERE project_id=? AND name_key=?", s.project_id, name)
      .toArray()[0];
    if (existing && existing.owner_session !== s.id)
      refuse(
        "forbidden",
        "A thread name cannot grant access. Obtain an invitation and send with reply_to.",
      );
    sql.exec(
      "INSERT OR IGNORE INTO thread_names(project_id,name_key,owner_session) VALUES(?,?,?)",
      s.project_id,
      name,
      s.id,
    );
  }
  const attached = attachments(sql, s, input.snapshot_id, input.attachments);
  const before = store.cursor();
  const result = store.sendMessage({
    project_id: s.project_id,
    author: {
      kind: "agent",
      host: input.agent_host ?? "t3",
      session: s.id,
      name: input.agent_name ?? s.agent_name,
    },
    body: input.body,
    subject: input.subject ?? null,
    reply_to: input.reply_to ?? null,
    thread: input.thread ?? null,
    idempotency_key: `native:${s.id}:send:${hash(input.idempotency_key)}`,
    attachments: attached,
    guide: guide ?? null,
    base_path: null,
  });
  const m = result.message;
  // Defense after upstream routing: an older reopened named thread is never a grant.
  if (
    m.thread_id !== m.id &&
    !sql
      .exec(
        "SELECT 1 FROM memberships WHERE session_id=? AND thread_id=?",
        s.id,
        m.thread_id,
      )
      .toArray().length
  )
    refuse("forbidden", "Upstream routing reached an unauthorized thread.");
  sql.exec(
    "INSERT OR IGNORE INTO memberships(session_id,thread_id,joined_at) VALUES(?,?,?)",
    s.id,
    m.thread_id,
    new Date().toISOString(),
  );
  cursor(sql, s, "*", before);
  cursor(sql, s, m.thread_id, before);
  const project = store.project(m.project_id)!;
  return ok(
    `${result.replayed ? "Already sent" : "Sent"} to the Plannotator Inbox. Call wait_for_reply for the person’s answer.`,
    {
      message_id: m.id,
      thread_id: m.thread_id,
      new_thread: m.id === m.thread_id,
      thread_name: store.message(m.thread_id)?.thread_name ?? null,
      project: { id: project.id, name: project.name, root: project.root },
      questions: (m.questions ?? []).map((q) => ({
        key: q.key,
        kind: q.kind,
        prompt: q.prompt,
      })),
      attachments: (m.attachments ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        path: a.path,
        kind: a.kind,
      })),
      replayed: result.replayed,
      cursor: store.messageCursor(m.id) ?? store.cursor(),
      url: appUrl(sql, m.thread_id),
      ...(guide ? { guide: m.guide } : {}),
    },
  );
}
export function invoke(
  sql: SqlReader,
  store: InboxStore,
  p: Principal,
  tool: string,
  input: Input,
): any {
  if (tool === "open_session") return openSession(sql, store, p, input);
  const s = sessionOf(sql, p, input.session_id);
  checkMetadata(s, input);
  if (tool === "get_guide_brief")
    return ok("Guided review method and exact schema.", {
      methodology: GUIDE_REVIEW_PROMPT,
      output_schema: JSON.parse(GUIDE_SCHEMA_JSON),
      diff_steps: GUIDE_DIFF_STEPS,
      rules: GUIDE_RULES,
      example: GUIDE_BRIEF_EXAMPLE,
    });
  if (tool === "read_snapshot")
    return ok("Immutable snapshot.", readSnapshot(sql, s, input));
  if (tool === "upload_snapshot")
    return ok(
      "Immutable snapshot saved in Executor SQLite.",
      upload(sql, s, input),
    );
  if (tool === "upload_snapshot_chunk")
    return ok("Durable upload chunk.", uploadChunk(sql, s, input));
  if (tool === "commit_snapshot_upload")
    return cached(sql, p.id, s.id, tool, input.upload_id, input, () =>
      ok("Immutable snapshot committed.", commitUpload(sql, s, input)),
    );
  if (tool === "send_message")
    return cached(sql, p.id, s.id, tool, input.idempotency_key, input, () =>
      send(sql, store, s, input),
    );
  if (tool === "submit_guide")
    return cached(sql, p.id, s.id, tool, input.idempotency_key, input, () => {
      let actual = { ...input };
      if (input.snapshot_id || input.patch_path) {
        if (
          !input.snapshot_id ||
          !input.patch_path ||
          input.patch !== undefined
        )
          refuse(
            "validation_error",
            "snapshot_id and patch_path go together and replace patch.",
          );
        const loaded = readSnapshot(sql, s, {
          snapshot_id: input.snapshot_id,
          path: input.patch_path,
        });
        if (!loaded.file || loaded.file.encoding !== "utf8")
          refuse("validation_error", "Patch must be an uploaded UTF-8 file.");
        actual.patch = loaded.file.content;
      }
      const checked = checkInboxGuide(
        actual,
        store.project(s.project_id)!.root,
      );
      if (!checked.ok) refuse("invalid_guide", checked.error);
      const d = describeInboxGuide(
        checked.snapshot,
        inboxGuideInputHash(actual),
      );
      writeBlob(sql, Buffer.from(d.text, "utf8"));
      return send(
        sql,
        store,
        s,
        {
          ...actual,
          body: input.body?.trim() ? input.body : checked.snapshot.guide.intent,
          subject:
            input.subject ??
            (input.body?.trim() ? undefined : `Guided review: ${d.ref.title}`),
        },
        d.ref,
      );
    });
  if (tool === "read_thread") {
    if (input.thread_id && input.message_id)
      refuse("validation_error", "Choose thread_id or message_id.");
    if (input.asked_by === "anyone")
      refuse(
        "forbidden",
        "Broad project reads are not available to agent profiles.",
      );
    const id = input.thread_id ?? input.message_id;
    if (id) {
      const tid = member(sql, store, s, id);
      if (input.thread_id && tid !== input.thread_id)
        refuse("thread_not_found", "thread_id must identify a root.");
      store.markAgentChecked(tid);
      const thread = store.thread(tid)!;
      return ok("Inbox thread.", {
        thread: {
          ...thread,
          messages: thread.messages.filter(
            (m) => !m.to || m.to.session === s.id,
          ),
        },
        url: appUrl(sql, tid),
      });
    }
    const allowed = new Set(memberships(sql, s));
    let threads = store
      .listRows({ projectId: s.project_id })
      .filter(
        (t) =>
          allowed.has(t.thread_id) &&
          (input.include_resolved || t.resolved_at === null),
      );
    const total = threads.length;
    threads = threads.slice(0, input.limit ?? 20);
    return ok(`${total} authorized threads.`, {
      project: store.project(s.project_id),
      threads,
      total,
    });
  }
  if (tool === "resolve_message") {
    member(sql, store, s, input.message_id);
    return cached(sql, p.id, s.id, tool, input.idempotency_key, input, () =>
      ok("Thread state saved.", {
        thread: store.resolveThread(input.message_id, input.resolved ?? true),
      }),
    );
  }
  if (tool === "list_decisions") {
    const state = input.state ?? "current";
    return ok("Project decisions.", {
      project: store.project(s.project_id),
      decisions: store
        .decisionsOf(s.project_id)
        .filter((d) => state === "all" || d.state === state),
    });
  }
  if (tool === "record_decision")
    return cached(sql, p.id, s.id, tool, input.idempotency_key, input, () => {
      const result = recordAgentDecision(store, {
        project_id: s.project_id,
        text: input.text,
        reason: input.reason,
        agent: {
          host: input.agent_host ?? "t3",
          session: s.id,
          name: input.agent_name ?? s.agent_name,
        },
        idempotency_key: `native:${s.id}:decision:${hash(input.idempotency_key)}`,
      });
      return ok("Decision recorded.", result);
    });
  if (tool === "create_join_token") {
    const tid = member(sql, store, s, input.thread_id);
    return cached(sql, p.id, s.id, tool, input.idempotency_key, input, () => {
      const token =
        crypto.randomUUID().replaceAll("-", "") +
        crypto.randomUUID().replaceAll("-", "");
      const expires = Date.now() + 600000;
      sql.exec(
        "INSERT INTO invites(token_hash,project_id,thread_id,issuer_session,expires_at) VALUES(?,?,?,?,?)",
        hash(token),
        s.project_id,
        tid,
        s.id,
        expires,
      );
      return ok("Explicit invitation (expires in 10 minutes).", {
        join_token: token,
        thread_id: tid,
        expires_at: new Date(expires).toISOString(),
      });
    });
  }
  if (tool === "join_thread") {
    const invite = sql
      .exec<{
        project_id: string;
        thread_id: string;
        expires_at: number;
        joined_session: string | null;
      }>("SELECT project_id,thread_id,expires_at,joined_session FROM invites WHERE token_hash=?", hash(input.join_token))
      .toArray()[0];
    if (
      !invite ||
      invite.project_id !== s.project_id ||
      (invite.joined_session && invite.joined_session !== s.id) ||
      (invite.expires_at < Date.now() && invite.joined_session !== s.id)
    )
      refuse(
        "forbidden",
        "Invitation invalid, expired, already used, or outside granted project.",
      );
    sql.exec(
      "UPDATE invites SET joined_session=? WHERE token_hash=?",
      s.id,
      hash(input.join_token),
    );
    sql.exec(
      "INSERT OR IGNORE INTO memberships(session_id,thread_id,joined_at) VALUES(?,?,?)",
      s.id,
      invite.thread_id,
      new Date().toISOString(),
    );
    cursor(sql, s, invite.thread_id, store.cursor());
    cursor(sql, s, "*", store.cursor());
    return ok("Joined authorized thread.", {
      thread_id: invite.thread_id,
      session_id: s.id,
    });
  }
  if (tool === "get_reply_cursor") {
    const scope = input.thread_id
      ? member(sql, store, s, input.thread_id)
      : "*";
    const row = sql
      .exec<{
        acknowledged: number;
        returned: number;
      }>("SELECT acknowledged,returned FROM cursors WHERE session_id=? AND scope=?", s.id, scope)
      .toArray()[0];
    return ok("Durable receipt cursor.", {
      acknowledged_cursor: row?.acknowledged ?? 0,
      last_returned_cursor: row?.returned ?? 0,
      scope,
    });
  }
  if (tool === "wait_for_reply") return poll(sql, store, p, s, input);
  refuse("unsupported_operation", "Operation is not implemented.");
}
function poll(
  sql: SqlReader,
  store: InboxStore,
  p: Principal,
  s: Session,
  input: Input,
) {
  if (input.thread_id && input.message_id)
    refuse("validation_error", "Choose thread_id or message_id.");
  const selected = input.thread_id ?? input.message_id;
  const single = selected ? member(sql, store, s, selected) : null;
  if (input.thread_id && single !== input.thread_id)
    refuse("thread_not_found", "thread_id must identify a root.");
  const scope = single ?? "*";
  const run = () => {
    const current = cursor(sql, s, scope, 0);
    const threshold = input.cursor ?? current.acknowledged;
    if (
      !Number.isSafeInteger(threshold) ||
      threshold < 0 ||
      threshold > store.cursor()
    )
      refuse(
        "invalid_cursor",
        "Cursor must be a nonnegative existing event position.",
      );
    // Only an explicitly returned position is an acknowledgement. Do not acknowledge on response send.
    if (input.cursor !== undefined && threshold > current.acknowledged) {
      if (threshold > current.returned)
        refuse(
          "invalid_cursor",
          "Cannot acknowledge beyond this scope’s last returned cursor.",
        );
      sql.exec(
        "UPDATE cursors SET acknowledged=? WHERE session_id=? AND scope=?",
        threshold,
        s.id,
        scope,
      );
    }
    // Recompute membership on every poll in the same transaction as the event watermark.
    const ids = single ? [single] : memberships(sql, s);
    let best: { reply: any; seq: number } | undefined;
    for (const tid of ids)
      for (const m of store.thread(tid)?.messages ?? []) {
        if (m.author.kind !== "person") continue;
        const target = m.reply_to
          ? store.message(m.reply_to)?.author
          : undefined;
        const mine = m.to
          ? m.to.session === s.id
          : target?.kind === "agent" && target.session === s.id;
        const seq = store.messageCursor(m.id) ?? 0;
        if (mine && seq > threshold && (!best || seq < best.seq))
          best = { reply: m, seq };
      }
    const returned = best?.seq ?? store.cursor();
    sql.exec(
      "UPDATE cursors SET returned=MAX(returned,?) WHERE session_id=? AND scope=?",
      returned,
      s.id,
      scope,
    );
    if (best) {
      const m = best.reply;
      store.markAgentChecked(m.thread_id, best.seq);
      return ok(`The person replied:\n\n${m.body}`, {
        status: "replied",
        thread_id: m.thread_id,
        reply: {
          message_id: m.id,
          reply_to: m.reply_to,
          body: m.body,
          created_at: m.created_at,
        },
        questions: m.reply_to ? store.questionsOf(m.reply_to) : [],
        cursor: best.seq,
        url: appUrl(sql, m.thread_id),
      });
    }
    if (single && store.message(single)?.resolved_at != null)
      return ok("Thread is resolved.", {
        status: "resolved",
        thread_id: single,
        cursor: returned,
      });
    return ok(
      "No reply yet. Re-poll with the returned cursor during an active execution.",
      { status: "waiting", cursor: returned, thread_ids: ids },
    );
  };
  return input.request_id
    ? cached(sql, p.id, s.id, "wait_for_reply", input.request_id, input, run)
    : run();
}
