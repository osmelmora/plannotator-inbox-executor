# Architecture

The deployed app contains the Plannotator Inbox domain and React UI. Executor hosts the UI assets, authenticates app operations, and provides the app's SQLite database. No unrestricted Plannotator MCP endpoint is exposed, and no loopback or browser-origin checks are disabled.

```text
Agent environment                         Human reviewer
       |                                        |
Scoped Executor MCP                       Executor app UI
       |                                        |
Agent profile + credential                Reviewer profile + credential
       |                                        |
       +---- authorization + route adapter ------+
                              |
                 Plannotator Inbox domain
                              |
                 Executor durable SQLite
            records / sessions / cursors / snapshots
```

## Runtime boundary

App handlers run in Executor's worker runtime. They use supported app operations and `ctx.sql`; they do not start binaries, access the host filesystem, run Git, or rely on process-global identity. Build and provisioning scripts run on the operator's machine and can stop once installation finishes.

The upstream domain uses an injected synchronous persistence interface instead of JSONL files. Each mutation groups authorization, domain events, snapshot writes, cursor changes, and idempotency receipts in one explicit SQLite transaction. A fresh store is reconstructed per execution; state is not cached in a long-lived JavaScript object.

The actual Inbox UI calls authenticated `inboxQuery` and `inboxMutate` operations through `apps/client`. Those routes require a reviewer credential independently of their visibility in discovery. A bounded browser polling loop replaces the local server's event transport. Prebuilt UI modules and embedded CSS/fonts are served by Executor's public-assets mechanism.

## Identity boundary

The selected Executor account supplies a secret credential. Its hash maps to a configured principal, role, environment allowlist, and project allowlist. Tokens are never tool arguments or UI source. Scoped OAuth connections restrict each agent to its own profile and agent operations; the app separately enforces ownership and membership.

Session identity is `(principal, environment, originating thread, project)`, with immutable source metadata. Configured logical project roots connect different checkouts to shared project decisions. A caller's path is never authority to read server files. Deliberate joins require both a single-use, expiring invitation and an existing project grant.

## Snapshot and reply boundary

Uploads capture selected file and patch bytes with relative paths and revision metadata. The app stores content hashes and immutable manifests; later edits on the agent's machine cannot alter a submitted review. Direct and chunked uploads share the same limits and validation. Binary bytes are preserved separately from the supported text/code viewers.

Human answers and supported annotations are persisted before an agent receives them. Reply cursors are durable and scoped to the authenticated session. Agent polling is active, bounded work; it leaves no background watcher and cannot resume an ended agent conversation.

See [compatibility](compatibility.md) for limits, [verification](verification.md) for tested boundaries, and [Executor's app model](https://executor.sh/docs/concepts/apps-and-deployments) for host deployment semantics.
