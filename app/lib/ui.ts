import type { SqlReader } from "apps";
import type { InboxStore } from "../domain/store.js";
import {
  decisionsModel,
  waitingDecisions,
  threadDecisions,
  recordDecisionsForReply,
  setQuestionDecision,
  retireDecision,
  replaceDecision,
} from "../domain/decisions.js";
import { inboxListSections } from "../domain/list.js";
import { toInboxQuestion } from "../vendor/core/inbox-questions.js";
import { projects } from "../config.js";
import {
  requireReviewer,
  reviewerProject,
  reviewerMessage,
  type Principal,
} from "./auth.js";
import { strict, refuse, jsonSize, hash, type Input } from "./common.js";
import { cached } from "./requests.js";
import { readBlob } from "./uploads.js";
import { appUrl } from "./tools.js";
const serverSession = "executor-native-inbox-protocol-v1";
const version = "0.28.11-native.177c340";
function permittedProjects(p: Principal, store: InboxStore) {
  return store
    .listProjects()
    .filter((prj) =>
      p.projects.some(
        (k) => projects[k as keyof typeof projects]?.root === prj.root,
      ),
    );
}
function attachment(store: InboxStore, p: Principal, id: string) {
  const a = store.attachment(id);
  if (!a) refuse("attachment_not_found", "No such attachment.");
  reviewerMessage(p, store, a.message.id);
  return a;
}
function state(a: any, messageId: string) {
  return {
    ...a,
    message_id: messageId,
    current: { sha256: a.sent_sha256, size: a.size, mtime: a.sent_mtime },
    changed_since_sent: false,
    unavailable: null,
  };
}
function health() {
  return {
    ok: true,
    app: "plannotator-inbox",
    version,
    serverSession,
    pid: 0,
    update: null,
  };
}
function notifications(sql: SqlReader) {
  return JSON.parse(
    sql
      .exec<{
        value: string;
      }>("SELECT value FROM settings WHERE key=?", "notifications")
      .toArray()[0]?.value ??
      '{"enabled":false,"dismissed":true,"allowed_origin":null}',
  );
}
export function uiRead(
  sql: SqlReader,
  store: InboxStore,
  p: Principal,
  path: string,
): unknown {
  requireReviewer(p);
  if (!path.startsWith("/api/inbox/"))
    refuse(
      "unsupported_operation",
      "Only native Inbox operations are available.",
    );
  const url = new URL(path, "https://native.invalid");
  const route = url.pathname;
  const knownQuery =
    route === "/api/inbox/events"
      ? ["cursor"]
      : route === "/api/inbox/decisions" || route === "/api/inbox/threads"
        ? ["project"]
        : route.match(/\/attachments\/[^/]+\/view$/)
          ? ["version"]
          : [];
  for (const k of url.searchParams.keys())
    if (!knownQuery.includes(k))
      refuse("validation_error", `Unsupported query parameter ${k}`);
  if (route === "/api/inbox/health") return health();
  if (route === "/api/inbox/threads") {
    const list = permittedProjects(p, store);
    const ids = new Set(list.map((v) => v.id));
    const filter = url.searchParams.get("project");
    if (filter) reviewerProject(p, store, filter);
    const rows = store.listRows().filter((r) => ids.has(r.project_id));
    return {
      serverSession,
      version,
      cursor: store.cursor(),
      update: null,
      notice:
        "Plannotator Inbox for Executor · immutable uploads · agent replies arrive on polling",
      projects: list.map((prj) => ({
        ...prj,
        threads: rows.filter((r) => r.project_id === prj.id).length,
        unread: rows.filter((r) => r.project_id === prj.id && r.unread).length,
      })),
      project: filter,
      sections: inboxListSections(
        filter ? rows.filter((r) => r.project_id === filter) : rows,
      ),
      decisions_waiting: waitingDecisions(store).filter((d) =>
        ids.has(d.project_id),
      ).length,
    };
  }
  if (route === "/api/inbox/events") {
    const threshold = Number(url.searchParams.get("cursor") ?? 0);
    if (!Number.isSafeInteger(threshold) || threshold < 0)
      refuse("invalid_cursor", "Invalid UI cursor.");
    const ids = new Set(permittedProjects(p, store).map((v) => v.id));
    const lines = store
      .changesSince(threshold)
      .filter((l) =>
        ids.has(l.kind === "project" ? l.record.id : l.record.project_id),
      );
    return {
      cursor: store.cursor(),
      events: lines.map((l) => {
        if (l.kind === "question") {
          const root = store.message(
            store.message(l.record.message_id)?.thread_id ?? "",
          );
          return {
            seq: l.seq,
            kind: l.kind,
            id: l.id,
            question: toInboxQuestion(l.record, root?.resolved_at != null),
          };
        }
        return { seq: l.seq, kind: l.kind, id: l.id, [l.kind]: l.record };
      }),
      update: null,
    };
  }
  if (route === "/api/inbox/settings") {
    const ids = new Set(permittedProjects(p, store).map((v) => v.id));
    const usage = store.diskUsage();
    const allowed = usage.projects.filter((prj) => ids.has(prj.id));
    return {
      serverSession,
      version,
      port: 0,
      url: appUrl(sql),
      mcp_url: "Executor discovery",
      mcp_command: [],
      home: "Executor",
      data_dir: "Executor app SQLite",
      inbox_tool: {
        hosts: { "claude-code": false, pi: false, opencode: false },
        env: false,
      },
      notifications: notifications(sql),
      phones: false,
      store: {
        dir: "Executor SQLite event-record bytes (excludes blobs and SQL indexes)",
        bytes: allowed.reduce((n, prj) => n + prj.bytes, 0),
        projects: allowed,
      },
    };
  }
  if (route === "/api/inbox/decisions") {
    const id = url.searchParams.get("project");
    if (!id) refuse("validation_error", "project is required.");
    reviewerProject(p, store, id);
    return {
      serverSession,
      cursor: store.cursor(),
      ...decisionsModel(store, id),
    };
  }
  let match = route.match(
    /^\/api\/inbox\/threads\/([^/]+)(?:\/(attachments|sessions))?$/,
  );
  if (match) {
    const id = match[1]!;
    reviewerMessage(p, store, id);
    const thread = store.thread(id);
    if (!thread) refuse("thread_not_found", "No such thread.");
    if (match[2] === "attachments")
      return {
        serverSession,
        attachments: store
          .threadAttachments(id)
          .map((hit) => state(hit.attachment, hit.message.id)),
        annotations: store.pendingAnnotations(id),
      };
    if (match[2] === "sessions")
      return {
        serverSession,
        home: "Executor (no automatic session wake)",
        project: thread.project,
        sessions: [],
      };
    return {
      serverSession,
      cursor: store.cursor(),
      thread,
      decisions: threadDecisions(
        store,
        thread.messages.flatMap((m) =>
          (m.questions ?? []).map((q) => q.decision_id),
        ),
      ),
    };
  }
  match = route.match(/^\/api\/inbox\/attachments\/([^/]+)\/view$/);
  if (match) {
    const hit = attachment(store, p, match[1]!);
    if (
      url.searchParams.has("version") &&
      url.searchParams.get("version") !== "sent"
    )
      refuse(
        "validation_error",
        "Only the immutable sent version is available.",
      );
    return {
      serverSession,
      attachment: state(hit.attachment, hit.message.id),
      version: hit.attachment.sent_sha256,
      text: readBlob(sql, hit.attachment.sent_sha256).toString("utf8"),
      html: null,
    };
  }
  match = route.match(/^\/api\/inbox\/messages\/([^/]+)\/guide$/);
  if (match) {
    const m = reviewerMessage(p, store, match[1]!);
    if (!m.guide) refuse("guide_not_found", "This message has no guide.");
    return {
      message_id: m.id,
      guide: m.guide,
      snapshot: JSON.parse(readBlob(sql, m.guide.sha256).toString("utf8")),
    };
  }
  refuse(
    "unsupported_operation",
    `Plannotator Inbox for Executor does not implement ${route}.`,
  );
}
export function uiWrite(
  sql: SqlReader,
  store: InboxStore,
  p: Principal,
  path: string,
  body: unknown,
): unknown {
  requireReviewer(p);
  if (!path.startsWith("/api/inbox/") || path.includes("?"))
    refuse("unsupported_operation", "Unsupported UI mutation path.");
  strict(body, [
    "serverSession",
    "questions",
    "words",
    "feedback",
    "annotation_ids",
    "idempotency_key",
    "resolved",
    "reviewed",
    "attachment_id",
    "version",
    "annotation",
    "key",
    "recording",
    "draft",
    "text",
    "reason",
    "notifications",
    "url",
  ]);
  if (body.serverSession !== undefined && body.serverSession !== serverSession)
    refuse(
      "server_session_mismatch",
      "Reload the Executor app before writing.",
    );
  jsonSize(body, 96 * 1024);
  const validate = (keys: string[], required: string[] = []) =>
    strict(body, ["serverSession", ...keys], required);
  if (path === "/api/inbox/location") {
    validate(["url"], ["url"]);
    if (typeof body.url !== "string")
      refuse("validation_error", "url is required.");
    const url = new URL(body.url);
    if (
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      !(
        (url.protocol === "http:" &&
          (url.hostname === "localhost" ||
            url.hostname.endsWith(".localhost"))) ||
        (url.protocol === "https:" &&
          url.hostname.endsWith(".executor.website"))
      )
    )
      refuse(
        "validation_error",
        "Location must be a host-issued Executor app URL.",
      );
    sql.exec(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      "ui_url",
      body.url,
    );
    return { url: body.url };
  }
  if (path === "/api/inbox/settings") {
    validate(["notifications"], ["notifications"]);
    strict(body.notifications, ["enabled", "dismissed", "allowed_origin"]);
    for (const [k, v] of Object.entries(body.notifications)) {
      if (
        k === "allowed_origin"
          ? v !== null && typeof v !== "string"
          : typeof v !== "boolean"
      )
        refuse("validation_error", "Invalid notification preference.");
    }
    const value = { ...notifications(sql), ...body.notifications };
    sql.exec(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      "notifications",
      JSON.stringify(value),
    );
    return { notifications: value };
  }
  let match = path.match(/^\/api\/inbox\/threads\/([^/]+)\/seen$/);
  if (match) {
    validate([]);
    reviewerMessage(p, store, match[1]!);
    return { thread: store.markSeen(match[1]!) };
  }
  match = path.match(
    /^\/api\/inbox\/messages\/([^/]+)\/(picks|reply|resolve|decision|guide\/reviewed)$/,
  );
  if (match) {
    const id = match[1]!;
    reviewerMessage(p, store, id);
    switch (match[2]) {
      case "picks":
        validate(["questions"], ["questions"]);
        checkQuestions(body.questions, true);
        return {
          message_id: id,
          questions: store.savePicks(id, body.questions),
          reply: null,
        };
      case "reply":
        validate(
          [
            "words",
            "questions",
            "idempotency_key",
            "feedback",
            "annotation_ids",
          ],
          ["idempotency_key"],
        );
        if (body.questions) checkQuestions(body.questions, false);
        if (
          (body.words !== undefined && typeof body.words !== "string") ||
          (body.feedback !== undefined && typeof body.feedback !== "string")
        )
          refuse("validation_error", "Reply words/feedback must be text.");
        return cached(
          sql,
          p.id,
          id,
          "ui.reply",
          body.idempotency_key,
          body,
          () => {
            const r = store.sendReply(id, {
              ...body,
              idempotency_key: `ui:${p.id}:${id}:${hash(body.idempotency_key)}`,
            } as any);
            const d = recordDecisionsForReply(store, r.reply.id);
            if (d.refused.length)
              refuse(
                "decision_refused",
                "One or more selected decisions could not be recorded; reply transaction rolled back.",
              );
            return {
              message_id: id,
              questions: store.questionsOf(id),
              reply: r.reply,
              replayed: r.replayed,
              decisions: d.recorded,
              decisions_refused: d.refused,
            };
          },
        );
      case "resolve":
        validate(["resolved"], ["resolved"]);
        if (typeof body.resolved !== "boolean")
          refuse("validation_error", "resolved must be boolean.");
        return { thread: store.resolveThread(id, body.resolved) };
      case "decision":
        validate(["key", "recording", "draft"], ["key"]);
        return { question: setQuestionDecision(store, id, body) };
      case "guide/reviewed":
        validate(["reviewed"], ["reviewed"]);
        return {
          message_id: id,
          reviewed: store.saveGuideReviewed(id, body.reviewed),
        };
    }
  }
  if (path === "/api/inbox/annotations") {
    validate(
      ["attachment_id", "version", "annotation"],
      ["attachment_id", "version", "annotation"],
    );
    const hit = attachment(store, p, body.attachment_id);
    if (body.version !== hit.attachment.sent_sha256)
      refuse(
        "validation_error",
        "Annotations must name the immutable sent SHA-256.",
      );
    return { annotation: store.saveAnnotation(body as any) };
  }
  match = path.match(/^\/api\/inbox\/annotations\/([^/]+)\/remove$/);
  if (match) {
    validate([]);
    const record = store
      .changesSince(0)
      .find((l) => l.kind === "annotation" && l.id === match![1]);
    if (!record || record.kind !== "annotation")
      refuse("annotation_not_found", "No such annotation.");
    reviewerProject(p, store, record.record.project_id);
    return { annotation: store.removeAnnotation(match[1]!) };
  }
  match = path.match(/^\/api\/inbox\/decisions\/([^/]+)\/(retire|replace)$/);
  if (match) {
    const d = store.decision(match[1]!);
    if (!d) refuse("decision_not_found", "No such decision.");
    reviewerProject(p, store, d.project_id);
    if (match[2] === "retire") {
      validate(["version"], ["version"]);
      return { decision: retireDecision(store, d.id, body.version) };
    }
    validate(["version", "text", "reason"], ["version", "text", "reason"]);
    return replaceDecision(store, d.id, body as any);
  }
  refuse(
    "unsupported_operation",
    `Plannotator Inbox for Executor does not implement ${path}.`,
  );
}
function checkQuestions(value: unknown, answers: boolean) {
  if (!Array.isArray(value) || value.length > 100)
    refuse(
      "validation_error",
      "questions must be an array of at most 100 entries.",
    );
  for (const q of value)
    strict(q, answers ? ["key", "revision", "answer"] : ["key", "revision"], [
      "key",
      "revision",
    ]);
}
