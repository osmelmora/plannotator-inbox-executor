# Contributing

The goal is to preserve Plannotator Inbox's behavior while making its identity, persistence, and file transport safe for remote agent environments. Keep the actual upstream UI and domain whenever practical. A replacement review dashboard or features from Plannotator's separate code-review app are not implicit requirements.

## Local development

Use Node.js 24, npm, and Bun 1.4. Install the locked app dependencies, then run the repository checks:

```sh
npm ci --prefix app --ignore-scripts
npm run verify
```

Individual commands are available for `npm test`, `npm run typecheck`, `npm run build`, and `npm run check`. Tests use synthetic local data. They must not depend on an operator's `.runtime/`, credentials, private installation, or signed-in browser.

Do not deploy just to run unit tests. Use a separate installation configuration for integration work and document which target you changed. See [INSTALL.md](INSTALL.md) and [the verification boundaries](docs/verification.md).

## Code ownership and provenance

- `app/lib/` contains the Executor adapter: authentication, routing, uploads, transactions, retries, and UI transport.
- `app/domain/` retains the Inbox domain with a persistence seam; [its README](app/domain/README.md) describes the fork.
- `app/vendor/` retains upstream UI/core source. Review [UI changes](docs/ui-fork-changes.md) before editing it.
- `app/ui/` and build scripts package the real Inbox UI for Executor's hosted assets.
- `scripts/install.mjs` provisions an explicitly configured installation; credentials remain private.

Keep upstream license notices and `UPSTREAM.json` provenance. When changing a vendored file, update its fork hash using the provenance workflow and explain the adaptation. Do not run an initial vendoring script over an adapted tree or edit minified public bundles by hand. Rebuild generated assets from source.

## What to include in a contribution

Describe the concrete behavior before and after the change, whether upstream Inbox behaves differently, and how you checked it. Use focused tests for identity, cross-thread delivery, durable cursors, retry collisions, immutable snapshot bytes, and transactional rollback. Unknown/unsupported input must fail explicitly rather than being discarded.

For runtime changes, distinguish local tests, mocked installer tests, real host checks, and real UI/MCP round trips. A mocked deployment is not Cloud verification. Applied migration files are immutable; add a new migration for database changes.

Before a pull request, run the checks and inspect the files to be published. Do not commit operator state, personal deployment IDs/URLs, credentials, private screenshots, or actual review material. Use synthetic examples. Follow [SECURITY.md](SECURITY.md) for sensitive findings.

## Useful next contributions

- A documented clean install and round trip in a second Executor organization.
- Reviewed identity/grant migration and credential rotation.
- Data export/restore, retention, and garbage collection.
- Measured storage and latency behavior near supported limits.
- Upstream compatibility updates with retained UI and explicit behavior changes.

These are possible improvements, not promises of a scheduled release.

## Publishing the first source release

Run `npm run verify` from a clean checkout and inspect `git ls-files` before
publishing. The source scanner checks the working tree and Git index; it is not
a history audit. Keep operator state out of every commit, including old commits.

Create an empty GitHub repository named `plannotator-inbox-executor`, then add its
actual URL as `origin` and push the reviewed `main` branch. Enable private
vulnerability reporting, wait for the included GitHub Actions workflow, and
link the README and INSTALL guide in the repository description. Publishing the
source does not require changing your running Inbox or enabling public app access.

Before announcing a supported install, complete the round-trip walkthrough in a
fresh organization and record the exact source/framework versions and results in
`docs/verification.md`. A release tag should describe any remaining limitations.
