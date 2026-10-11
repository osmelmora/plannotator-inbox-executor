import { jsonSchema } from "apps";
import upstream from "./upstream-tools.json" with { type: "json" };

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}
const text = { type: "string", minLength: 1, maxLength: 4096 };
const session = {
  ...text,
  description:
    "Durable native Inbox session returned by open_session, bound to the selected account.",
};
const identity = { session_id: session };
const writes = new Set([
  "send_message",
  "resolve_message",
  "record_decision",
  "submit_guide",
]);
export const toolDefinitions: ToolDefinition[] = upstream.tools.map((tool) => {
  const inputSchema = JSON.parse(JSON.stringify(tool.inputSchema));
  inputSchema.properties = { ...inputSchema.properties, ...identity };
  inputSchema.required = [...(inputSchema.required ?? []), "session_id"];
  inputSchema.additionalProperties = false;
  if (writes.has(tool.name)) {
    inputSchema.properties.idempotency_key = {
      ...text,
      description:
        "Stable unique key per logical mutation; reuse the same key and payload for a retry.",
    };
    if (!inputSchema.required.includes("idempotency_key"))
      inputSchema.required.push("idempotency_key");
  }
  if (tool.name === "send_message")
    inputSchema.properties.snapshot_id = {
      ...text,
      description:
        "Immutable upload_snapshot result. attachments names paths within this snapshot, never central-server paths.",
    };
  if (tool.name === "submit_guide") {
    inputSchema.properties.snapshot_id = {
      ...text,
      description: "Immutable uploaded manifest containing the review patch.",
    };
    inputSchema.properties.patch_path = {
      ...text,
      description:
        "UTF-8 patch path in snapshot_id, replacing inline patch for larger diffs. Cannot be combined with patch.",
    };
  }
  if (tool.name === "wait_for_reply") {
    inputSchema.properties.timeout_seconds = {
      type: "integer",
      minimum: 1,
      maximum: 5,
      default: 1,
      description:
        "Bounded remote wait; default 1 second, maximum 5. Repeat with the returned cursor.",
    };
    inputSchema.properties.request_id = {
      ...text,
      description:
        "Stable optional retry key for this wait and cursor; a retry returns the same reply.",
    };
  }
  return {
    name: tool.name,
    description: `${tool.description}\n\nNative Executor: session_id is required. ${writes.has(tool.name) ? "idempotency_key is required. " : ""}Use open_session once per originating T3 environment/thread. Results preserve the MCP ToolResult envelope; inspect isError and structuredContent.`,
    inputSchema,
    readOnly: tool.name === "get_guide_brief" || tool.name === "list_decisions",
  };
});
function helper(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  readOnly = false,
): ToolDefinition {
  return {
    name,
    description,
    readOnly,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  };
}
toolDefinitions.push(
  helper(
    "open_session",
    "Register or resume a durable T3 environment/thread in an explicitly configured project. The selected account must authorize the environment and project; source_path is metadata, never a server filesystem path.",
    {
      environment_id: text,
      thread_id: text,
      project_key: text,
      source_path: text,
      agent_name: text,
    },
    ["environment_id", "thread_id", "project_key", "source_path"],
  ),
  helper(
    "upload_snapshot",
    "Upload immutable file bytes for send_message attachments. Preserve relative paths and filenames. UTF-8 text or base64 binary; optional sha256 is verified. No full repository upload is required.",
    {
      ...identity,
      files: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: {
          type: "object",
          properties: {
            path: { type: "string", minLength: 1, maxLength: 500 },
            mtime: { type: "string", format: "date-time" },
            content: { type: "string" },
            encoding: { type: "string", enum: ["utf8", "base64"] },
            sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
          },
          required: ["path", "content", "encoding"],
          additionalProperties: false,
        },
      },
      revision: {
        type: "object",
        properties: {
          repository: { type: "string", maxLength: 4096 },
          base: { type: "string", maxLength: 4096 },
          head: { type: "string", maxLength: 4096 },
          branch: { type: "string", maxLength: 4096 },
          dirty: { type: "boolean" },
        },
        additionalProperties: false,
        description:
          "Originating repository, base/head commit, branch, and dirty status. Stored with the immutable snapshot.",
      },
    },
    ["session_id", "files"],
  ),
  helper(
    "upload_snapshot_chunk",
    "Durably stage one immutable upload chunk (maximum 24 KiB decoded). Encode the serialized {files,revision?} JSON as UTF-8, then split bytes and base64 each chunk. Retrying the same upload_id/index/content is safe.",
    {
      ...identity,
      upload_id: text,
      index: { type: "integer", minimum: 0, maximum: 119 },
      content_base64: { type: "string", maxLength: 32768 },
    },
    ["session_id", "upload_id", "index", "content_base64"],
  ),
  helper(
    "commit_snapshot_upload",
    "Commit staged chunks into one immutable snapshot. sha256 covers the exact concatenated UTF-8 JSON bytes; missing or changed chunks fail. Retry the same upload_id/count/hash safely.",
    {
      ...identity,
      upload_id: text,
      chunk_count: { type: "integer", minimum: 1, maximum: 120 },
      sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    },
    ["session_id", "upload_id", "chunk_count", "sha256"],
  ),
  helper(
    "create_join_token",
    "Create a deliberate invitation to an Inbox thread this session can access. Another authorized project session joins with join_thread; names alone never grant access.",
    { ...identity, thread_id: text, idempotency_key: text },
    ["session_id", "thread_id", "idempotency_key"],
  ),
  helper(
    "join_thread",
    "Join an existing Inbox thread with an explicit invitation from an authorized participant. The selected account must also authorize the destination project.",
    { ...identity, join_token: text },
    ["session_id", "join_token"],
  ),
  helper(
    "get_reply_cursor",
    "Read durable acknowledged_cursor and last_returned_cursor for this session/thread. A returned cursor is not acknowledged until explicitly supplied on a later wait.",
    { ...identity, thread_id: text },
    ["session_id"],
    true,
  ),
);

toolDefinitions.push(
  helper(
    "read_snapshot",
    "Read your immutable manifest and optional file bytes from Executor SQLite. Binary bytes use base64. Only the owning session may read; large outputs should be projected within execute.",
    { ...identity, snapshot_id: text, path: text },
    ["session_id", "snapshot_id"],
    true,
  ),
);

/** One validation boundary shared by catalog declarations and tools. */
export function toolInputSchema(tool: ToolDefinition) {
  return jsonSchema(tool.inputSchema);
}
