# Security

This app handles code snapshots and agent/human messages. Deploy it inside an Executor organization whose members and administrators you trust. This is an early source release with bounded storage and no independent security audit.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** option if private reporting is enabled. Do not include credentials, real uploaded source, or private thread contents in a public issue. If no private reporting channel is listed, open a minimal issue requesting a private contact without disclosing exploitation details.

No response-time or long-term security-support commitment is currently established. Report the repository revision, Executor framework version, affected operation, and a synthetic reproduction.

## Boundaries

- Executor authenticates OAuth clients and supplies the selected account to app handlers. An app credential limits role, environments, and projects; ownership and membership checks further scope data access.
- Scope each agent MCP connection to one agent profile and the documented 16 operations. Reviewer transport and management operations are for the human/operator.
- Machine IDs, thread IDs, source paths, and MCP connection URLs are not authorization credentials.
- Uploads are immutable, bounded bytes. The app never interprets a caller path as permission to read the server filesystem.
- Do not enable public sharing for an Inbox containing private messages or source code. Source publication and public runtime access are different actions.

## Operator state

Keep `.runtime/` and local installation configuration private. Runtime state contains generated credentials and deployment/account receipts. Preserve it when updating an existing installation; losing it is not a reason to generate replacement credentials silently. Never attach these files to an issue or commit them.

The app stores messages and snapshots in Executor's database. This repository does not implement retention, secure deletion, backup, or restore. Account revocation and scoped-connection revocation belong to Executor; changing embedded project/principal grants additionally requires a reviewed deployment. Follow your host's own access and backup policies.
