# Plannotator Inbox UI fork

This port uses the real Inbox application, list, sidebar, thread, question cards, annotation pane, and guided review chain from Plannotator commit `177c34099258fa380c6b90c6f3e9411c13f6f463` (package version `0.28.11`). It does not embed or proxy the running local Inbox. Source lives in `app/vendor/`; `UPSTREAM.json` pins the upstream path and SHA-256 of each retained source/asset alongside the fork hash. The upstream MIT and Apache licenses, and the UI/core package licenses, are retained.

## Hosting adaptations

| Source | Change |
| --- | --- |
| All retained TypeScript | Package aliases and extensionless imports become explicit local `.js` imports. The original React implementation is retained. |
| `inbox/api.ts` | Same API method names, args, paths and response types; sends through Executor `inboxQuery` / `inboxMutate`. HTTP envelopes are `{status, bodyJson}`. A 1.5-second bounded query loop, with backoff to 30 seconds, replaces SSE while the page remains open. |
| `app/ui/executor-transport.ts` | Uses supported `apps/client`; receives no credentials, profile identifiers, routing URLs, or local session identity from the browser. Executor binds the page to the selected authenticated reviewer profile. |
| `inbox/App.tsx` | Disables filesystem/remote image resolution and arbitrary-path document hover reads. Hides local MCP installation context. Normal question, thread, list, attachment, decision and guide composition stays upstream. |
| `inbox/components/Settings.tsx`, `EmptyState.tsx` | Replace local companion setup copy with Executor profile/discovery and storage details. State explicitly that durable replies do not wake ended sessions. |
| `inbox/components/AttachmentPane.tsx` | Replace the misleading empty annotation sidebar on raw code attachments with an explicit read-only notice. Markdown/text annotations retain the actual upstream panel. |
| `review-editor/workerPool.tsx` | Removes Vite-only `?worker&inline`; retains the upstream main-thread syntax-highlighting fallback. No worker pool is mounted by the Inbox guide reader. |
| `review-editor/components/AllFilesCodeView.tsx` | Removes the Vite-only development flag; normalizes missing selection sides before the existing toolbar and narrows token events to diff tokens. Unsupported grammars explicitly select plaintext before entering the original Pierre renderer. Read-only diff rendering remains upstream. |
| `review-editor/hooks/usePierreTheme.ts` | A type-only dependency points directly to browser-safe core config types, avoiding the Node config implementation. |
| `review-editor/dock/ReviewStateContext.tsx`, `shared/commit-info.ts` | Uses the exact needed upstream commit metadata interface as a type-only excerpt instead of importing the server-wide type barrel. |
| `review-editor/hooks/useAnnotationToolbar.ts`, `utils/exportFeedback.ts` | Fix two pre-existing strict TypeScript narrowings (`undefined` draft key and optional diff scope). |
| `ui/utils/mermaid.ts` | Select Mermaid 12.0.0's official `dist/mermaid.esm.min.mjs` browser distribution. The first real host build selected Node-only `uuid/dist-node` hashing through Mermaid's default core distribution; the explicit browser distribution fixes that without altering Executor or package versions. |
| Images/sprites | Original bytes encoded as data URL TypeScript modules because Executor source uploads carry text files. |
| CSS/fonts | Original theme and Inbox CSS compiled with the original Tailwind rules into `app/ui/styles.ts`. Fonts are inlined; no font CDN or external companion is needed. The compiled CSS is a text module installed in a `<style>` element: the host currently rejects esbuild CSS data-URL metadata as unresolved imports, even though those URLs are already self-contained. |
| `app/ui/main.tsx`, `index.html` | Mount the real `InboxApp`, provide an error boundary, and show a reload notice if Executor reports an obsolete deployment. Register only `location.origin + '/'` through the authenticated location mutation for agent links; no profile query or thread hash is stored. Failed registration shows a retry notice and a non-sensitive console warning. |
| `app/ui/host.ts`, `scripts/build-ui.mjs` | The real host's full UI compilation returned `RuntimeProtocolFailed` before a usable build result. The final approach compiles retained UI source locally to minified `ui/public` ES modules without source maps. Executor's documented public-assets pipeline hosts every byte. The small host-compiled module supplies the official authenticated `apps/client` transport through a same-page function; the UI bundle has no external imports, credentials, or companion URL. |
| `app/ui/shiki-small.ts` | Uses Shiki's supported fine-grained bundle API. Highlights JavaScript, TypeScript, JSX, TSX, JSON, CSS, HTML, Python, shell, YAML, Markdown and diff. Unknown grammars retain plaintext rendering. Keeps the original Pierre renderer and themes. |
| `ui/utils/mermaid.ts`, `ui/utils/graphviz.ts` | Final vertical slice explicitly rejects diagram rendering. This removes optional Mermaid/ELK/Graphviz runtime costs after the full host build failure. The earlier Mermaid distribution fix remains recorded above as build history, not the final enabled diagram behavior. |
| `build/katex-woff2-only.ts` | Reuses upstream's build optimization to remove redundant legacy font formats. Modern WOFF2 math fonts remain. |

## Build and checks

From the repository root, after the two dependency installs in [CONTRIBUTING.md](../CONTRIBUTING.md):

```sh
mise exec -- pnpm typecheck
mise exec -- pnpm build
mise exec -- pnpm check
mise exec -- bun test tests/ui-attachments.test.ts tests/ui-held.upstream.test.ts
```

The ordinary Ultracite/Biome formatting pass excludes retained upstream source and generated UI assets. Update fork provenance after intentional source adaptations; rebuild rather than manually formatting compiled output.

The strict browser TypeScript check passes. `docs/ui-build-receipt.json` records the small host module check; `docs/ui-static-build-receipt.json` records the minified app asset hashes and sizes. `docs/ui-dependency-inventory.json` and `app/ui/public/THIRD-PARTY-LICENSES.txt` retain dependency versions and licenses. Exact Shiki/esbuild versions are pinned and `app/pnpm-lock.yaml` locks the local build inputs independently of root development tooling. The retained source and build scripts are needed only when building, not while using the deployed app. Two retained upstream list tests and three attachment/feedback tests passed with 19 assertions. They guard held-list ordering and delivery state, literal code versus Markdown interpretation, the synchronous highlighting bound, and sent-version annotation feedback.

`scripts/vendor-upstream.mjs` records the initial import method and deliberately refuses to overwrite the existing adapted fork. Deployment uses the included fork source. Re-vendoring requires reviewing the adaptations above; do not run the initial-import script over an existing fork.

`scripts/check-diff-renderer.mjs` exercises the actual Pierre renderer against the deployed reduced Shiki bundle: TypeScript renders with its grammar and Rust/Go render fully as plaintext. All three cases pass. `scripts/refresh-ui-provenance.mjs` refreshes fork hashes against `git show` of the pinned commit after reviewed adaptations; it never changes the upstream checkout.

## Scope limits

- Raw code files and guided diffs retain upstream read-only behavior. Markdown/text attachments support actual upstream annotations; inline code/guide annotations are not claimed.
- Only uploaded immutable snapshots can be opened. Arbitrary machine paths, source edits, repository browsing, image references, and local filesystem previews are not supported.
- The optional HTML/diagram viewer code is retained as a transitive UI dependency, but server support is not implied. Unsupported operations must return explicit backend errors.
- Human-to-session wakeups, local tool installation, companion restart, Tailscale and phone pairing are not hosted features. The transport does not call those services.
- Read/reply cursors, authorization, idempotency and persistence belong to the durable backend. The UI cannot grant access through a thread name or routing identifier.
- This browser build retains the upstream Markdown, syntax-highlighting and diff dependencies. Optional diagram engines are excluded. See the [verification report](verification.md) for the tested deployment boundaries.
