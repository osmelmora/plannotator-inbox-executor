# Plannotator Inbox Executor

One Plannotator Inbox for agents working across machines, hosted inside Executor.

Agents send messages, questions, immutable file snapshots, and guided code reviews through Executor's MCP connection. You read and answer them in the **actual Plannotator Inbox UI**, using your Executor login. The app stores its Inbox records and uploaded bytes in Executor SQLite; no local Plannotator process, companion server, tunnel, or always-on developer machine is required.

This is an independent port of [Plannotator Inbox](https://plannotator.ai/docs/reference/inbox/), not an official Plannotator or Executor release. It is available as a source installation for Executor Cloud. The working Cloud deployment and local tests are summarized in [verification](docs/verification.md); a fresh installation in a second organization has not yet been verified end to end.

## Start here

You need an Executor organization where you can create apps, accounts, profiles, and scoped MCP connections, plus Node.js 24 and npm on your setup machine. Bun is needed only for development tests.

```sh
# From a downloaded or cloned copy of this repository:
node scripts/install.mjs init --config inbox.config.json
```

Edit the generated configuration with your Executor organization's canonical UUID, repository mappings, and agent environments. [Installation instructions](INSTALL.md) explain how to identify the organization. Sign in with the official Executor CLI, then run:

```sh
npm exec --yes --package=executor@2.0.0-beta.14 -- executor apps login --host https://api.executor.sh
node scripts/install.mjs install --config inbox.config.json
```

Follow [INSTALL.md](INSTALL.md) for the complete procedure, including how to open the reviewer UI and create each agent's scoped MCP connection. Installation state and credentials stay in the ignored `.runtime/` directory. They are not part of a source distribution.

## One Inbox, separate identities

| Concept | Purpose |
| --- | --- |
| App installation | Owns one shared Inbox and its durable data. |
| Agent credential and profile | Authorizes an environment's allowed projects. Usually one per independent T3 instance or machine. |
| Reviewer credential and profile | Lets the human open the Inbox, answer questions, and send annotations. |
| Environment ID | Stable identity for the originating agent environment; survives T3 restarts. |
| Originating thread ID | Stable conversation ID within that environment; many threads can use one account. |
| Project key | Explicitly maps checkouts on different machines to the same logical repository and shared decisions. |

Knowing an environment or thread ID does not grant access. An agent's scoped MCP connection selects its profile; the app also checks credential grants, session ownership, and thread membership. Threads remain separate unless an authorized session deliberately shares an invitation.

[Connect agents](docs/agent-setup.md) · [Try a complete round trip](docs/round-trip.md)

## What works

- Upstream-named operations: `send_message`, `read_thread`, `wait_for_reply`, `resolve_message`, `list_decisions`, `record_decision`, `get_guide_brief`, and `submit_guide`.
- Persistent project/session mapping, retry deduplication, scoped reply cursors, and deliberate thread joins.
- Immutable text and binary snapshots with relative paths, filenames, revision metadata, and checked hashes. Ordinary reviews upload selected files and a patch, not the whole repository.
- Plannotator question controls, Markdown/text annotations, source-code viewing, and guided diff reviews in the hosted Inbox UI.
- Normal Executor tool discovery and execution. Agents do not need to control a browser.

Code attachments and guided diffs are **read-only, as in the upstream Inbox version this port uses**. Plannotator's separate code-review UI is a different surface. Markdown/text annotations return with the person's ordinary Inbox reply.

## Current boundaries

This initial source release targets small, controlled installations. Uploads allow 50 files, 1 MiB per file and 2 MiB per snapshot. The event log is capped at 20,000 records; retention, garbage collection, and backup/restore tooling remain future work. Binary bytes are preserved but have no Inbox viewer. HTML/diagram viewers and local filesystem, Git, and process operations are unsupported.

Reply waits last 1–5 seconds and can be resumed with durable cursors. Polling does not wake an ended agent session. Initial identities and projects are configured before installation; changing an existing installation's grants requires a deliberate migration rather than silently replacing credentials.

Read the [compatibility contract](docs/compatibility.md) for exact differences and errors.

## Source and contributions

The domain and React UI are forked from Plannotator commit `177c34099258fa380c6b90c6f3e9411c13f6f463` (package version `0.28.11`). Upstream source, provenance, and license notices are retained in [`app/domain`](app/domain/README.md) and [`app/vendor`](app/vendor/UPSTREAM.json). See [UI adaptations](docs/ui-fork-changes.md) and [architecture](docs/architecture.md) before changing those boundaries.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)
