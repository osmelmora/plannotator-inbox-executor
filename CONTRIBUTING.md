# Contributing

The goal is to preserve Plannotator Inbox's behavior while making its identity, persistence, and file transport safe for remote agent environments. Keep the actual upstream UI and domain whenever practical. A replacement review dashboard or features from Plannotator's separate code-review app are not implicit requirements.

## Local development

Install [mise](https://mise.jdx.dev/getting-started.html), inspect [`mise.toml`](mise.toml), then run from the repository root:

```sh
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile --ignore-scripts
mise exec -- pnpm --dir app install --frozen-lockfile --ignore-scripts
mise exec -- pnpm verify
```

The pinned toolchain is Node.js 24.21.0, pnpm 12.11.2, and Bun 1.4.2. Root tooling and the deployable app deliberately have separate dependency manifests and lockfiles. Install both; the app's installation also works independently when staged for deployment. An activated mise shell can omit `mise exec --`.

The app workspace exempts only `apps@0.0.1-beta.81` from pnpm's [minimum release age](https://pnpm.io/settings/dependency-resolution#minimumreleaseageexclude). This exact SDK version is advertised by the Executor Cloud host and has passed local and Cloud checks; the exception lets fresh installs use it during pnpm's default 24-hour waiting period. Other dependency age and lockfile integrity checks remain enabled.

`pnpm verify` runs lint, server/UI type checks, isolated tests, the UI build, and publication/provenance/browser/documentation checks. Tests use synthetic local data and need no operator credentials or signed-in browser. CI runs the same command after installing the toolchain with [`jdx/mise-action`](https://github.com/jdx/mise-action/tree/v5.1.1).

## Lint and formatting

Ultracite 8.0.0 with Biome 2.5.15 checks maintained adapter, UI integration, installer, test, and configuration code. [`biome.jsonc`](biome.jsonc) defines the exact scope. Run:

```sh
mise exec -- pnpm lint
mise exec -- pnpm format
```

`lint` checks; `format` applies fixes. Review the resulting changes before committing. Vendored domain/UI source, the retained upstream test, generated UI assets/styles, lockfiles, provenance/build receipts, and private state are excluded from this formatting pass. Keep their upstream style and refresh generated files through the relevant build/provenance command instead. Exclusion from formatting does not remove type, behavior, provenance, or publication checks.

Use the repository's pinned pnpm for dependency changes and commit the affected lockfile. Changes to deployable dependencies belong in `app/`; root dependencies are development tooling. Preserve the app's security overrides when regenerating its lockfile.

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

Run `mise exec -- pnpm verify` from a clean checkout and inspect `git ls-files` before
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
