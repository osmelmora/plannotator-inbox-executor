# Project instructions

This repository hosts Plannotator's Inbox UI and domain inside Executor. Read
`docs/architecture.md` before changing persistence or transport, and
`docs/compatibility.md` before changing tool behavior or supported attachments.

- Discover an installation's tools/profile IDs through Executor. Stable originating
  environment/thread IDs route messages; authenticated profile grants authorize them.
- Preserve immutable review bytes and snapshot anchors, idempotency, durable cursor
  scopes, and addressed-reply isolation when changing operations.
- Keep public `app/config.ts` empty of grants. Installation configuration and generated
  credentials belong to ignored private state; the installer renders scoped build copies.
- Keep upstream imports and licenses traceable. For changes under `app/vendor` or
  `app/domain`, retain modification notices and update `UPSTREAM.json` using the pinned
  upstream commit; `scripts/refresh-ui-provenance.mjs --help` describes that workflow.
- Use `npm ci --prefix app`, then `npm run verify` for the public checkout. Installer
  tests use isolated fixtures; ordinary verification never touches a live deployment.
- Public docs/examples use synthetic identifiers. `.runtime`, `.private`, account
  tokens, OAuth state, operator configuration, and deployment receipts stay outside Git.

When preparing publication, run `npm run check` on the staged source and inspect the
Git file list. The automated check complements review; it does not prove arbitrary
content is safe to disclose.
