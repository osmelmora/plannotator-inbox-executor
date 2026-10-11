# Third-party source and assets

New integration code is licensed under [Apache-2.0](LICENSE). Vendored and
bundled material keeps its original notices and licensing terms.

| Material | Source and revision | Retained license and provenance |
| --- | --- | --- |
| Inbox domain fork | [Plannotator 0.28.11](https://github.com/backnotprop/plannotator/tree/177c34099258fa380c6b90c6f3e9411c13f6f463) | [MIT](app/domain/LICENSE-MIT) or [Apache-2.0](app/domain/LICENSE-APACHE); [file mapping](app/domain/UPSTREAM.json) |
| Inbox UI and supporting source | Same pinned Plannotator revision | [root MIT](app/vendor/LICENSE-MIT) or [root Apache-2.0](app/vendor/LICENSE-APACHE); retained [UI](app/vendor/ui/LICENSE) and [core](app/vendor/core/LICENSE) package licenses are Apache-2.0; [file mapping](app/vendor/UPSTREAM.json) |
| Browser dependencies, fonts, and bundled assets | Exact versions locked in [app/package-lock.json](app/package-lock.json) | [dependency inventory](docs/ui-dependency-inventory.json) and [distributed license texts](app/ui/public/THIRD-PARTY-LICENSES.txt) |

The upstream copyright notices remain in their original license files.
[NOTICE](NOTICE) accompanies source distributions. The UI build retains legal
comments and distributes the dependency license texts alongside its assets.

The source-release lock updates DOMPurify to 3.4.16 and KaTeX to 0.18.2.
Overrides keep transitive KaTeX on that same version and `lodash-es` on 4.18.1
to address dependency advisories. Review these overrides when updating the
retained dependency graph; do not remove them just because a viewer is disabled.

Read [the UI adaptation inventory](docs/ui-fork-changes.md) and [the domain
adaptation inventory](app/domain/README.md) before updating the fork. Preserve
the original upstream hashes, review changes, and refresh the fork hashes
against the pinned upstream checkout. A file hash documents provenance; it
does not replace the corresponding license.
