---
name: plannotator-inbox-executor
description: Send questions, immutable document snapshots and guided diffs to the Executor-hosted Plannotator Inbox, then poll for scoped human replies.
---

# Plannotator Inbox for Executor

This app owns its Inbox records and uploaded bytes in Executor SQLite. Use normal Executor discovery and execution. Human review happens in the app UI; agents never operate that UI or invoke reviewer-only `inboxQuery` / `inboxMutate`.

1. Discover this app's agent profile and exact tool signatures with `tools.search`. The selected secret account grants one principal's projects and environments. Routing IDs do not grant access. Use the app profile authorized for the originating environment.
2. Call `open_session` with the durable originating T3 environment ID and thread ID, configured `project_key`, and caller-local absolute `source_path`. Save `session_id`. Reopening the same route resumes it; metadata changes fail.
3. Call `send_message` with Markdown, `session_id` and a stable `idempotency_key`. Use upstream question fences (`:::question`, `:::question-multi`, `:::question-text`). Inspect the MCP envelope's `isError`; a tool transport success is not an Inbox success. Save the returned Inbox message/thread ID; it differs from the originating T3 thread ID passed to open_session.
4. Poll `wait_for_reply` during an active execution. Waits default to 1 second and allow 1–5 seconds. Persist its returned cursor after processing the response, then pass it on the next wait to acknowledge. Thread-specific and all-thread cursor scopes are independent. Omit cursor to replay unacknowledged replies. An optional stable `request_id` replays that exact poll outcome; use a new ID for the next poll. A stored reply does not wake an ended T3 session.
5. Use `read_thread` to inspect an authorized thread, and `resolve_message` once settled. Resolve requires its own retry key. A joined thread's full ordinary conversation is shared deliberately, but waits route person replies to the session whose message they answer.

## Files and diffs

Upload selected immutable files with `upload_snapshot`, keeping their original relative paths, filenames, encoding and revision metadata. Files are `utf8` or strict `base64`; optional SHA-256 is checked. `mtime` is optional caller metadata. Symlinks and arbitrary host-path reads are not supported. Pass `snapshot_id` plus relative `attachments` to `send_message`.

Limits: 50 files, 1 MiB decoded per file, 2 MiB decoded per snapshot, 2880 KiB serialized manifest. Text attachments supported by this app are Markdown, plain/config/data text and source code. Binary bytes can be stored and read with `read_snapshot`; binary, HTML and diagram attachment viewers are explicitly refused. Code attachments and guided diffs are read-only; annotate Markdown/text for feedback.

For a manifest too large for Executor's 64 KiB program limit, serialize `{files,revision?}` as UTF-8, split into at most 120 chunks of 24 KiB, call `upload_snapshot_chunk` with each chunk's base64, then `commit_snapshot_upload` with exact chunk count and whole-manifest SHA-256. Same upload ID/index requires identical bytes. Same commit parameters are retry-safe. Large read results must be projected inside Executor code to stay below its output limit.

For diffs, read `get_guide_brief`, author against the exact caller-captured Git patch, and call `submit_guide`. Send `guide`+`patch`, `guide`+`snapshot_id`+`patch_path`, or a complete `snapshot`. Explicit `guide.source` is required; repository metadata is never inferred from an Executor checkout. Changed structured-object property order is a retry; array order remains significant. Unknown or unsupported fields fail.

## Sharing and decisions

A thread name is reserved to its originating session. To share, an authorized participant calls `create_join_token` with a stable retry key and authorized thread ID. Give the single-use, ten-minute invitation to the intended session through an authorized channel; it calls `join_thread`. It must already have the project grant. Joined senders use `reply_to`, not a name.

`list_decisions` reads project-wide decisions within the credential's grant. `record_decision` records an agent-authored decision with its reason and retry key; it does not claim the person approved it. Only the reviewer profile may answer questions, send human replies or change human annotations.

Errors are explicit: foreign sessions/threads/snapshots return `forbidden`; changed retry payload returns `idempotency_key_reused`; unsupported local-machine features return `unsupported_operation`. Do not work around these boundaries with caller-supplied IDs. This app caps the append log at 20,000 events and retains uploads/receipts; production retention is not implemented.
