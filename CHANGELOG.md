# Changelog

## Unreleased

- Extracted the native Inbox into the standalone `plannotator-inbox-executor` repository.
- Retained the actual Plannotator Inbox UI and domain with Executor-hosted assets, authenticated operations, and durable SQLite.
- Added explicit environment/thread identity, project grants, immutable file uploads, deliberate thread joins, retry receipts, and resumable reply cursors.
- Prepared configurable source installation for new Executor Cloud organizations, with private per-installation state and no embedded deployment credentials.
- Added public setup, agent connection, compatibility, contribution, security, and smoke-test documentation; removed personal deployment evidence from the distributable tree.

### Existing behavior

The original deployment was verified with two scoped Cloud MCP clients and UI replies/annotations. Code attachments and guided diffs retain the pinned upstream Inbox's read-only behavior. See [verification](docs/verification.md) for tested versions and limits; the reusable installer has not yet completed a clean second-organization Cloud installation.
