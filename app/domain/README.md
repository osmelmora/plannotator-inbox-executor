# Executor-native Inbox domain fork

Pinned source: [Plannotator `177c34099258fa380c6b90c6f3e9411c13f6f463`](https://github.com/backnotprop/plannotator/tree/177c34099258fa380c6b90c6f3e9411c13f6f463), package 0.28.11. Copyright 2025–2026 backnotprop and contributors. The upstream MIT and Apache-2.0 license texts are retained. `UPSTREAM.json` maps each forked file to its original source and records both SHA-256 values. The original checkout is unmodified.

## Persistence contract

```ts
interface StorePersistence {
  load(): InboxLine[];
  append(line: InboxLine): void;
}
const store = InboxStore.open(persistence, { now: () => new Date() });
```

`load` returns complete detached records; `append` writes synchronously and throws on failure. Construct a fresh store per Executor execution, inside the same SQLite transaction as authorization, upload/blob writes, domain changes, and idempotency receipts. Never cache the store between calls. The full append log preserves upstream record sequence and first-message cursor semantics. Transactions remove the upstream possibility of partially committed multi-record changes. Legacy unsent-answer/annotation repair remains for compatibility.

`subscribe` remains a synchronous, per-store listener. It is not a cross-execution subscription, a persistent watcher, or a background timer. UI polling and agent waits belong to the Executor adapter.

## Changes from upstream

| Fork module | Adaptation |
| --- | --- |
| `store.ts` | Replace JSONL filesystem load/append and directory setup with `StorePersistence`. Remove filesystem/OS/process access and blob garbage collection. Project roots are explicit mapping identifiers. Retain upstream thread routing, records, questions, answers, replies, annotations, decisions, guide progress, list sections, delivery records, IDs and cursors. |
| `store.ts` deletion | Existing project/thread deletion requests throw `InboxError("unsupported_operation", ...)`. No successful deletion is simulated. Annotation removal remains an append-only domain state change. |
| `store.ts` usage | `diskUsage()` counts serialized persisted record bytes, including historical updates; its synthetic `dir` states that uploads and SQLite overhead are excluded. It does not claim to measure host disk storage. |
| `schema.ts` | Retain `InboxError` and `parseInboxLine`; remove unused disk-layout constants and path helper. |
| `list.ts` | Unchanged domain logic; import paths only. |
| `decisions.ts` | Retain decision business rules; omit HTTP route dispatch. The Executor adapter must throw if `recordDecisionsForReply().refused` is nonempty when atomic rollback is required. |
| `guides.ts` | Extract check/hash/description and authoring-brief functions; omit Bun MCP registration and filesystem HTTP routes. Use `TextEncoder` for byte counts. Canonicalize structured-object retry hashes, preserving array order and exact string payloads. Publish the full authored envelope schema: upstream's generated-text schema excludes metadata present in its own example. Preserve the original as `UPSTREAM_GUIDE_SCHEMA_JSON`. |
| `authored-guide.ts` | Extract `buildAuthoredGuideSnapshot` and strict placement validation, using the original core validators. Require explicit `guide.source` instead of reading Git provenance. `cwd` is accepted for signature compatibility but never read. Refuse unsupported authored fields and malformed metadata before upstream normalization can discard them. |
| `canonical-json.ts` | Small new stable JSON serializer for guide object hashes; preserves ordered arrays. |

Runtime imports use browser-safe vendored core modules plus `node:crypto` SHA-256. No filesystem, `Bun`, subprocess, process identity, or network capability is used by these domain modules. Blob bytes are owned by the outer SQL adapter; the domain holds immutable references only.

## Authorization and retry boundaries

This is upstream business logic, not an authorization module. A thread name is not a grant. Named routing can reopen an older thread ID; callers must authorize the actual returned thread ID inside the transaction. Agent/session labels are routing metadata. The outer adapter must verify credentials, project grants, session ownership, thread membership, and snapshot ownership before exposing records.

Upstream agent idempotency keys are project-wide and compare a subset of the request. The adapter must namespace the domain key per authenticated session and keep a canonical full-request receipt in the same SQL transaction. Human addressed messages (`to.session`) must be filtered from foreign session histories. Upstream code attachments and guides remain read-only; supported Markdown annotations are carried in the person's ordinary reply.

## Verification

Run from the workspace root:

```sh
bun test tests/domain.test.mjs
```

The test port uses real SQLite transactions and constructs a fresh store for each operation. Tests cover question/reply round trips, stale revisions, retries after resolution, named-thread reopening, default session routing, addressed deliveries, Markdown annotations, explicit code-annotation refusal, decision lifecycle, transaction failure rollback, old partial-log recovery, global cursors, honest usage/deletion behavior, authored guides, historical snapshots, metadata validation, and canonical object-order retries. Host deployment, browser, and authentication verification is documented separately in the repository documentation.
