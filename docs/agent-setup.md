# Connect an agent and open the Inbox

Complete [installation](../INSTALL.md) first. Adding another agent to an existing Inbox does not require another app installation, but it does require an authorized principal/environment in the installation configuration.

## Open the reviewer UI

In Executor, open **Apps → Plannotator Inbox Executor** (or your configured app name). Select the profile created for your `reviewer` principal in the profile dropdown, then click **Open app**. Bookmark the URL Executor opens.

The dropdown matters: an agent profile is allowed to submit and read its own work, not use reviewer-only UI operations. Accounts hold credentials; profiles select them. Neither is an additional Executor user login.

## Create one scoped MCP connection per agent environment

Use **Scoped connections** on Executor's Connect/Connections page. Select this Inbox app, exactly the intended agent profile, and the following 16 tools explicitly:

```text
send_message           read_thread              wait_for_reply
resolve_message        list_decisions           record_decision
get_guide_brief         submit_guide             open_session
upload_snapshot        upload_snapshot_chunk    commit_snapshot_upload
create_join_token      join_thread              get_reply_cursor
read_snapshot
```

Do not include the reviewer profile, `inboxQuery`, `inboxMutate`, or management operations. An explicit tool list keeps future app additions outside the connection until reviewed.

Copy the generated connection URL into that environment's MCP client and complete normal Executor OAuth sign-in. Use the URL generated for **your** connection; a guessed or copied connection identifier cannot replace provisioning. Executor binds OAuth grants to the chosen organization, so changing the dashboard organization does not retarget an existing agent connection. See [Executor's scoped connection documentation](https://executor.sh/docs/mcp#scoped-connections).

## Tell the agent its routing configuration

Give each environment its configured `environment_id`, allowed `project_key`, and a stable originating T3 conversation ID. Keep the same IDs on retries and after restarts. `source_path` is the absolute checkout path on that agent's machine; it is metadata and is never read by Executor.

For the default example configuration:

```json
{
  "environment_id": "t3-machine-a",
  "thread_id": "a-stable-originating-conversation-id",
  "project_key": "my-project",
  "source_path": "/workspace/my-project",
  "agent_name": "T3 machine A"
}
```

A useful initial instruction to the agent is:

> Read this app's Inbox skill through Executor. Discover its tools, open or resume a session with my configured environment and project, and use my stable conversation ID. Send questions and selected immutable snapshots to the Inbox. Keep returned session/thread IDs and cursors durable, and check `isError` before treating any result as successful.

Read the installed skill with Executor's `skills` tool and discover callable paths with `tools.search` inside `execute`. Use the profile path discovery returns rather than hard-coding another installation's IDs. [Executor discovery and execution](https://executor.sh/docs/mcp#the-tools)

The `thread_id` supplied to `open_session` identifies the **originating T3 conversation**. The `thread_id` returned by `send_message` identifies the **Inbox thread**. Keep both; do not interchange them. Reopening the same origin route resumes its session. Changing its source path or agent name is a conflict, not an implicit identity update.

## Replies, retries, and shared projects

Use `read_thread` for history and `wait_for_reply` for addressed human replies. After processing a reply, persist its cursor and pass it on the next wait to acknowledge it. Omitting the cursor replays unacknowledged replies. All-thread and thread-specific cursor scopes are independent. An optional `request_id` replays that exact poll result; use a new ID for a new poll.

Keep one `idempotency_key` per logical mutation. Retry identical requests with that same key; a changed payload under the same key is rejected. Agents may share project decisions while their sessions and Inbox threads stay separate. To join another thread, use `create_join_token` and `join_thread`; a shared thread name is not an invitation.

Waits default to one second and allow at most five. Your agent must be executing or resume later to collect a reply. This app does not wake idle or ended T3 conversations.
