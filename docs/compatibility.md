# Compatibility contract

Pinned upstream: Plannotator `177c34099258fa380c6b90c6f3e9411c13f6f463`, package version `0.28.11`. That commit includes code-attachment support beyond the release carrying that version. This port targets **Inbox**, not every Plannotator review or local-machine workflow.

## Agent operations

| Operation | Behavior in this port |
| --- | --- |
| `send_message` | Upstream Markdown/question syntax and result envelope; explicit authorized `session_id`, immutable `snapshot_id` for attachments, and required retry key. |
| `read_thread` | Authorized thread history, filtering explicitly session-addressed human messages. `asked_by: anyone` is refused. |
| `wait_for_reply` | Durable scoped cursor and 1–5 second active wait; optional replay-safe `request_id`. Replies target the originating session. |
| `resolve_message` | Authorized resolution with a durable retry receipt. |
| `list_decisions` | Project-wide decisions within the authenticated credential's grant. |
| `record_decision` | Agent-authored decision with reason and retry key; does not assert human approval. |
| `get_guide_brief` | Upstream guide authoring guidance/schema adapted for explicit source metadata. No server-side Git inspection. |
| `submit_guide` | Upstream validation and renderer using an inline exact patch, complete guide snapshot, or an owned uploaded patch. |

Discover actual signatures through Executor. Inputs reject unknown fields rather than silently dropping them. Results retain the MCP tool envelope: inspect `isError` and `structuredContent`, not just whether transport execution succeeded.

The additional operations are `open_session`, `upload_snapshot`, `upload_snapshot_chunk`, `commit_snapshot_upload`, `create_join_token`, `join_thread`, `get_reply_cursor`, and `read_snapshot`. They make remote identity, byte transfer, and durable polling explicit. Application authorization uses credentials, project grants, session ownership, and thread membership; routing labels alone never authorize access.

## UI and snapshots

| Surface | Supported behavior |
| --- | --- |
| Inbox | Actual upstream React list, sidebar, threads, questions, decisions, and guide reader. |
| Markdown/text | Upstream viewer and annotations; feedback returns in durable human replies. |
| Code attachments | Upstream read-only code viewer. |
| Guided diffs | Upstream read-only diff renderer and guide progress. |
| Binary files | Immutable bytes, filenames, metadata, and hashes; read through `read_snapshot`. No binary attachment viewer. |
| File identity | Relative paths and filenames preserved; UTF-8 or strict base64 input, optional checked SHA-256 and modification timestamp. |
| Revision identity | Caller-supplied repository, base/head, branch, and dirty status; immutable with the upload. |
| Updates | Authenticated browser polling replaces local event streaming. |

Read-only code/diff behavior is inherited from the pinned **upstream Inbox**. It is not an Executor Cloud restriction. Inline code-review annotation features from other Plannotator surfaces are outside this port's scope.

## Limits

| Resource | Enforced limit |
| --- | --- |
| Files per snapshot | 50 |
| Decoded file size | 1 MiB |
| Total decoded snapshot size | 2 MiB |
| Serialized upload manifest | 2880 KiB |
| Upload chunk | 24 KiB decoded; at most 120 chunks |
| Active reply wait | 1–5 seconds; default 1 |
| Persisted event log | 20,000 records |
| Join invitation | Single use; expires after ten minutes |

Large manifests should use chunked uploads to fit Executor's execution input limits. Project large snapshot reads inside `execute` to avoid oversized tool output. These upload limits do not establish performance guarantees near the event-log ceiling.

## Explicitly unsupported

Arbitrary filesystem reads, repository scans, symlink traversal, full local Git/process integration, local session wake-up, binary/HTML/diagram attachment viewers, Mermaid/Graphviz rendering, arbitrary local image resolution, project/thread deletion, and retention automation return explicit errors where requested. No successful placeholder is substituted for an unsupported mutation.

Snapshots contain only uploaded data. A source path is descriptive metadata, not a server path. Plaintext is the fallback for syntax-highlighting languages outside the included bundle.

## Intentional behavioral differences

- Human reply and decision-recording side effects are one transaction. A rejected decision rolls back the reply rather than leaving partial success.
- Thread membership and reply delivery are explicitly scoped to authenticated remote sessions. Reusing a thread name is not a cross-session join.
- Guide retry hashing canonicalizes object property order while preserving array order and exact string payloads.
- Storage usage reports serialized event bytes, excluding blobs and SQLite overhead; it is not a host disk meter.
- Installation grants are explicit configuration. Changing principals, project mappings, or credentials requires operator-managed migration; no self-service provisioning or credential-rotation workflow is claimed.
- Replies remain durable, but the app does not wake ended agent sessions.
