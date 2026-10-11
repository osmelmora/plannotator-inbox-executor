# Verification and release boundaries

This report separates the original working integration from the reusable source-installation tooling. Operational receipts, private installation identifiers, OAuth state, and browser screenshots from the original deployment are intentionally excluded from the public source tree.

## Previously verified integration

The native Inbox was exercised on 2026-10-11 with Node 24.21.0, Bun 1.4.2, and official Executor CLI `2.0.0-beta.14`. The local host advertised `apps@0.0.1-beta.69`; Executor Cloud advertised `apps@0.0.1-beta.81`. These are tested versions, not a promise that a host still advertises them. The installer discovers the target host's exact framework version.

| Boundary | Observed result |
| --- | --- |
| Local domain/adapter suite | 49 tests, 275 assertions, zero failures before source-release preparation. |
| Browser rendering | Real Plannotator Inbox, question controls, Markdown annotation pane, highlighted code, and guided before/after diff rendered. Three direct Pierre-renderer cases covered TypeScript and plaintext fallbacks. |
| Cloud agent discovery | Two real OAuth/PKCE MCP connections, each limited to its own profile and the 16 agent operations. |
| Cloud routing | Two independent environment/thread sessions submitted into one explicitly shared project. Their sessions and Inbox threads remained distinct. |
| UI → agent reply | A question answer and real Markdown annotation sent in the Plannotator UI were retrieved by the intended agent using `wait_for_reply` and `read_thread`. A second answer entered by the human operator was retrieved by the other agent. |
| Authorization | Unauthenticated MCP returned 401. Foreign sessions/threads were rejected by the app. Foreign profile and reviewer operations were unavailable to scoped agent connections. |
| Retry and snapshot behavior | An identical submission reused its message ID. Editing the source fixture after submission did not change stored text or binary bytes. |
| Persistence | Cloud redeployment retained replies, a pending question, sessions, snapshots, and resumable cursors. Two separate local official Executor process restarts verified backend durability. |

The Cloud path used actual agent MCP calls and the real UI. Administrator APIs provisioned accounts and profiles; they did not substitute for the final agent submission or UI reply. Original local Plannotator/companion workflows were left separate and continued working during that verification.

## Source-release preparation before the toolchain migration

The standalone repository has a fresh, configurable installer and synthetic examples. Its checks must be interpreted separately from the earlier Cloud deployment: **a clean installation into another Cloud organization has not yet been tested end to end**. The original deployment has not been replaced merely to rename or package this repository.

The source-release suite passed 73 tests across eight files, including 17 isolated installer tests and seven publication-scanner tests. Server/UI type checks, CSS compilation, hosted bundle generation, fork provenance, browser boundary checks, three direct diff-renderer cases, and documentation links also passed. The locked dependency audit reported no vulnerabilities at preparation time. A checkout exported exclusively from the Git index also passed the complete verification command without private runtime state or preinstalled dependencies.

An isolated build of the full source also passed locked dependency installation, server/UI type checks, CSS compilation, and bundle generation against the pinned `apps@0.0.1-beta.81`; remote mutations were blocked during that check. The three synthetic upload/message/guide JSON examples passed their actual exported tool input schemas. Installer tests use isolated state and mocked deployment boundaries; they do not establish a second real deployment. Run the repository's documented development checks before publishing or changing supported framework versions. See [CONTRIBUTING.md](../CONTRIBUTING.md) and [INSTALL.md](../INSTALL.md).

## Current development toolchain

The source now uses Node.js 24.21.0, pnpm 12.11.2, and Bun 1.4.2 from [`mise.toml`](../mise.toml), with separate frozen root/app pnpm lockfiles. Ultracite 8.0.0 and Biome 2.5.15 check maintained source, excluding upstream and generated files. The setup and verification commands are in [CONTRIBUTING.md](../CONTRIBUTING.md).

After migration, `pnpm verify` passed lint, both type checks, all 74 tests (including 18 installer tests), CSS and hosted bundle generation, provenance for 437 vendor and eight domain files, browser-boundary checks, three direct diff-renderer cases, and documentation links. An actual isolated installer prepare/build also passed with remote mutations blocked. The app lock migration preserved all 325 distinct dependency versions; the generated 74-package browser dependency/license inventory was unchanged. Every bundled dependency has a retained license text.

A checkout exported exclusively from the Git index passed both frozen pnpm installs and the complete verification command without private state or preinstalled dependencies. This caught and removed two tests' reliance on npm's hoisted dependency layout; their Effect test runtime is now an explicit root development dependency.

The app's pnpm audit reported zero vulnerabilities on 2026-10-11. The separate root development toolchain reports one high-severity advisory, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), in Ultracite's transitive `braces@3.0.3` dependency. No patched version is published at this check. It concerns deeply nested glob patterns in local lint/workspace configuration; Ultracite and this dependency are absent from the deployable app. The finding remains visible rather than suppressed.

This tooling migration is local source work; it does not update the existing Cloud deployment or establish a fresh Cloud round trip. No browser automation was used for these checks.

## Still unverified or unavailable

- Provider-internal Cloud process restart, disaster recovery, data export/restore, and production backup guarantees.
- Capacity/latency near the event-log ceiling or sustained multi-user load.
- A clean second-organization installation and arbitrary self-hosted Executor targets.
- Live OAuth token expiry/refresh in the proof client; real MCP clients own their normal OAuth lifecycle.
- Production retention, deletion, garbage collection, and a self-service grant migration workflow.

The [round-trip walkthrough](round-trip.md) provides a portable smoke test for a new installation. Its synthetic IDs are placeholders, not evidence that another person's deployment already passed.
