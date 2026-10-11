# A complete agent → Inbox → human → agent round trip

This smoke test uses [synthetic review files](../examples/README.md), following the same flow checked on the original Cloud deployment. Running it on a new installation verifies that installation; the examples alone do not establish a new deployment result.

Complete [installation](../INSTALL.md) and [agent connection setup](agent-setup.md). For the optional isolation check, configure two agent principals with different environment IDs and the same project grant before initial preparation. Use a fresh originating conversation ID for each independent test run.

## 1. Discover and open a session

Through Executor's normal MCP connection, read the app skill, then use `tools.search` to discover `open_session` and the other Inbox operations. The examples below use `inbox` as shorthand for the **actual callable profile path discovery returns**. They are tool arguments, not a request to read these files on the server.

Call `open_session` as agent A:

```json
{
  "environment_id": "t3-machine-a",
  "thread_id": "round-trip-a-001",
  "project_key": "my-project",
  "source_path": "/workspace/my-project",
  "agent_name": "T3 machine A"
}
```

Use your configured values if different. Save `structuredContent.session_id`. Check every result's `isError`; an Executor execution can complete while the app reports an error. Retrying this same route and metadata should return the same session with `resumed: true`.

## 2. Capture and send the review

Replace `REPLACE_SESSION_ID` in [`examples/snapshot.json`](../examples/snapshot.json), then pass its JSON object to `upload_snapshot`. Save the returned `snapshot_id`. The uploaded files include `docs/review.md`, `src/auth.ts`, the exact `changes.patch`, and five binary bytes. Binary bytes demonstrate storage; they are not attached for viewing.

Replace the session/snapshot placeholders in [`examples/message.json`](../examples/message.json), then call `send_message`. Save its `message_id` and Inbox `thread_id`. Retry **the identical input** once: the original message ID should be returned, without a second question. Changing a payload requires a new logical submission and retry key.

Read `get_guide_brief`, then replace the placeholders in [`examples/guide.json`](../examples/guide.json) and call `submit_guide`. Set `reply_to` to the message ID just returned. The guide uses the uploaded patch, so there is no server-side Git lookup or need to upload a repository.

For real reviews, the agent should capture its intended Git diff and the relevant files on its own machine, including uncommitted bytes, and record real revision metadata. A local filename alone does not transfer content. Keep file captures consistent with the submitted patch.

## 3. Review in the real Plannotator UI

Open the app with the reviewer profile. In **Example token guard**:

1. Inspect `src/auth.ts` and the guided review. The diff adds the empty-token check.
2. Select **Reject empty tokens** in the question.
3. Open `review.md`, add a global comment saying **Use AuthError for the empty-token guard.**, and save it.
4. Return to the thread and click **Send**.

Selecting an answer or adding an annotation prepares feedback; **Send** delivers it to the agent. Code and guided diff viewers are read-only in the pinned upstream Inbox. The Markdown annotation is the feedback example here.

## 4. Retrieve and acknowledge the reply

Agent A calls `wait_for_reply`:

```json
{
  "session_id": "REPLACE_SESSION_ID",
  "thread_id": "REPLACE_INBOX_THREAD_ID",
  "timeout_seconds": 1
}
```

Before the human sends, `structuredContent.status` is `waiting`. After sending, expect `replied`; `reply.body` should include **Reject empty tokens** and **AuthError**. Call `read_thread` with the same session/thread to inspect the persisted conversation.

Save the returned `cursor` after processing the reply, then pass it as `cursor` on the next wait to acknowledge it. If you omit it, the unacknowledged reply can be replayed. To inspect durable acknowledgement state, use `get_reply_cursor`. A stable `request_id` retries one specific poll; change it for the next poll.

Stop and resume your client, then reopen the same session and poll with its saved cursor. No browser interaction is needed by the agent, and no background process runs after the bounded wait ends. An ended T3 conversation must be resumed separately to poll again.

## 5. Check snapshots and isolation

After uploading, edit only your local copy of `examples/review/src/auth.ts`. Call `read_snapshot` with the saved snapshot ID and `path: "src/auth.ts"`. Its bytes and SHA-256 should still match the original upload. Read `images/pixel.bin` similarly; its base64 content should remain `AAEC+v8=`. Restore your local example afterward.

For agent B, use its own scoped connection, `environment_id: "t3-machine-b"`, and a different originating `thread_id` when opening a session. Submit a separate question, using a distinct thread name and retry key. Both results should report the same project ID but different session and Inbox thread IDs.

Before answering B, its wait should report `waiting`, not A's reply. Trying to read A's thread using B's session should return `forbidden`. Trying to use A's session from B's credential should also fail. If you intentionally need to share a thread, exercise the invitation helpers instead of bypassing this check.

## What to record

For your own verification, record the tested repository revision, advertised Executor framework version, expected/actual results, and whether the human UI step completed. Keep runtime IDs, private source, credentials, and screenshots out of public reports. A redeployment test establishes continuity across redeployment; it does not establish provider disaster recovery or a provider-internal runtime restart.
