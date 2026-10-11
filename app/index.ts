import {
  defineApp,
  defineProvider,
  json,
  jsonSchema,
  mutation,
  object,
  query,
  router,
  secrets,
  string,
  number,
  type JsonValue,
  type QueryContext,
  type MutationContext,
  type RouterChild,
} from "apps";
import { toolDefinitions, toolInputSchema } from "./schemas.js";
import { lookupRequest } from "./lib/requests.js";
import { authenticate, sessionOf, checkMetadata } from "./lib/auth.js";
import { openStore } from "./lib/storage.js";
import { invoke } from "./lib/tools.js";
import { uiRead, uiWrite } from "./lib/ui.js";
import { fail, InboxError, type Input } from "./lib/common.js";
const identity = defineProvider({
  name: "Plannotator Inbox credential",
  auth: {
    credential: secrets({
      label: "Scoped Plannotator Inbox credential",
      fields: object({ token: string({ minLength: 64 }) }),
    }),
  },
});
const requirements = { accounts: { identity } };
type ReadContext = QueryContext<typeof requirements>;
type WriteContext = MutationContext<typeof requirements>;
function result(value: unknown): JsonValue {
  return json().parse(value);
}
async function call(
  ctx: ReadContext | WriteContext,
  tool: string,
  input: unknown,
  writable: boolean,
) {
  try {
    const p = authenticate(ctx.accounts.identity);
    const run = (value: unknown = input) =>
      result(invoke(ctx.sql, openStore(ctx.sql), p, tool, value as Input));
    if (!writable) return run();
    const w = ctx as WriteContext;
    if (tool !== "wait_for_reply") return w.sql.transaction(() => run());
    // Active bounded polling only. No timer or work remains after this Promise ends.
    const args = input as Input;
    const session = sessionOf(ctx.sql, p, args.session_id);
    checkMetadata(session, args);
    if (args.request_id) {
      const receipt = lookupRequest(
        ctx.sql,
        p.id,
        session.id,
        "wait_for_reply",
        args.request_id,
        args,
      );
      if (receipt.found) return result(receipt.value);
    }
    const deadline = Date.now() + 1000 * (args.timeout_seconds ?? 1);
    let value: any;
    do {
      value = w.sql.transaction(() => run({ ...args, request_id: undefined }));
      if (
        value.structuredContent?.status !== "waiting" ||
        Date.now() >= deadline ||
        ctx.signal.aborted
      )
        break;
      await new Promise<void>((resolve) => {
        const abort = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(
          () => {
            ctx.signal.removeEventListener("abort", abort);
            resolve();
          },
          Math.min(200, deadline - Date.now()),
        );
        ctx.signal.addEventListener("abort", abort, { once: true });
      });
    } while (!ctx.signal.aborted);
    return args.request_id ? w.sql.transaction(() => run()) : value;
  } catch (e) {
    return result(fail(e));
  }
}
const operations: Record<string, RouterChild<ReadContext, WriteContext>> = {};
for (const t of toolDefinitions) {
  const readonly = t.readOnly;
  const options = {
    description: t.description,
    input: toolInputSchema(t),
    output: json(),
  };
  operations[t.name] = readonly
    ? query(options, (ctx: ReadContext, input) =>
        call(ctx, t.name, input, false),
      )
    : mutation(options, (ctx: WriteContext, input) =>
        call(ctx, t.name, input, true),
      );
}
const UiEnvelope = object({ status: number(), bodyJson: string() });
const UiRead = jsonSchema({
  type: "object",
  properties: { path: { type: "string", minLength: 1, maxLength: 2048 } },
  required: ["path"],
  additionalProperties: false,
});
const UiWrite = jsonSchema({
  type: "object",
  properties: {
    path: { type: "string", minLength: 1, maxLength: 2048 },
    bodyJson: { type: "string", maxLength: 100000 },
  },
  required: ["path", "bodyJson"],
  additionalProperties: false,
});
// Preserve the upstream Inbox statuses: its React client distinguishes 404
// from validation errors when clearing a thread that is no longer available.
const uiErrorStatus: Record<string, number> = {
  forbidden: 403,
  unauthorized: 403,
  unsupported_operation: 501,
  message_not_found: 404,
  thread_not_found: 404,
  project_not_found: 404,
  question_not_found: 404,
  attachment_not_found: 404,
  attachment_missing: 404,
  annotation_not_found: 404,
  decision_not_found: 404,
  guide_not_found: 404,
  snapshot_missing: 404,
  question_revision_conflict: 409,
  question_already_sent: 409,
  thread_resolved: 409,
  idempotency_key_reused: 409,
  attachment_changed_type: 409,
  annotation_closed: 409,
  decision_version_conflict: 409,
  decision_not_current: 409,
  server_session_mismatch: 409,
};
function uiFailure(e: unknown) {
  return {
    status:
      e instanceof InboxError ? (uiErrorStatus[e.code] ?? 422) : 500,
    bodyJson: JSON.stringify({
      code: e instanceof InboxError ? e.code : "internal_error",
      error:
        e instanceof InboxError ? e.message : "Native Inbox operation failed.",
    }),
  };
}
export const inboxQuery = query(
  {
    description:
      "Reviewer-only Inbox UI transport; agents use the upstream-named tools.",
    input: UiRead,
    output: UiEnvelope,
  },
  async (ctx: ReadContext, input) => {
    try {
      const p = authenticate(ctx.accounts.identity);
      return {
        status: 200,
        bodyJson: JSON.stringify(
          uiRead(ctx.sql, openStore(ctx.sql), p, (input as Input).path),
        ),
      };
    } catch (e) {
      return uiFailure(e);
    }
  },
);
export const inboxMutate = mutation(
  {
    description:
      "Reviewer-only Inbox UI transport; agent profiles are denied human actions.",
    input: UiWrite,
    output: UiEnvelope,
  },
  async (ctx: WriteContext, input) => {
    try {
      const p = authenticate(ctx.accounts.identity);
      const args = input as Input;
      let body: unknown;
      try { body = JSON.parse(args.bodyJson); }
      catch { throw new InboxError("validation_error", "bodyJson must contain valid JSON."); }
      return ctx.sql.transaction(() => ({
        status: 200,
        bodyJson: JSON.stringify(
          uiWrite(ctx.sql, openStore(ctx.sql), p, args.path, body),
        ),
      }));
    } catch (e) {
      return uiFailure(e);
    }
  },
);
export default defineApp(requirements, {
  tools: router({ ...operations, inboxQuery, inboxMutate }),
});
