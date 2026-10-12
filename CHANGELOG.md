# Changelog

## Unreleased

- Added the installer's `publication` command. It saves a commit named in the organization's `executor.community` scope with the public `config.ts`, then restores the installation source. A rerun after a failure between the two commits finishes the restore. Installation commits keep the bare name, so Executor refuses to publish a commit that carries grants. The app manifest now has a listing description.
- Uploaded only the files Executor loads. The build records every file `index.ts` and `ui/index.html` import, type-only imports included, and deployment adds `ui/public`, `package.json`, migrations, skills, and license and provenance files, including the root `LICENSE` and `NOTICE`. The upload falls from 592 files and 14.2 MB to 165 files, with 622 KB outside `ui/public`, within Executor's public listing limits.
- Updated checkout to `v7.0.1` and mise-action to `v5.1.1`, both using Node.js 24 for their GitHub Actions runtime.
- Allowed the exact host-required `apps@0.0.1-beta.81` SDK during pnpm's release-age waiting period so fresh frozen installs work; other dependency age and integrity checks remain enabled.
- Preserved the original Executor account provider declaration so source upgrades retain existing account/profile bindings; added a regression test through the actual pinned SDK host serializer.
- Excluded the pnpm lockfile from Executor source uploads while retaining it in local staging and build integrity checks.
- Updated the existing Cloud deployment from source commit `249f0ae`; authenticated read-only checks preserved both agent connections, stored review material, and unread reply state. No new browser round trip was performed for this update.
- Pinned Node.js 24.21.0, pnpm 12.11.2, and Bun 1.4.2 with mise; moved installs and deployment tooling to separate frozen pnpm lockfiles for root tooling and the app.
- Added Ultracite 8.0.0 and Biome 2.5.15 for maintained source, keeping vendored and generated material outside routine formatting. CI installs the same toolchain and runs the complete verification command.

- Extracted the native Inbox into the standalone `plannotator-inbox-executor` repository.
- Retained the actual Plannotator Inbox UI and domain with Executor-hosted assets, authenticated operations, and durable SQLite.
- Added explicit environment/thread identity, project grants, immutable file uploads, deliberate thread joins, retry receipts, and resumable reply cursors.
- Prepared configurable source installation for new Executor Cloud organizations, with private per-installation state and no embedded deployment credentials.
- Added public setup, agent connection, compatibility, contribution, security, and smoke-test documentation; removed personal deployment evidence from the distributable tree.

### Existing behavior

The original deployment was verified with two scoped Cloud MCP clients and UI replies/annotations. Code attachments and guided diffs retain the pinned upstream Inbox's read-only behavior. See [verification](docs/verification.md) for tested versions and limits; the reusable installer has not yet completed a clean second-organization Cloud installation.
