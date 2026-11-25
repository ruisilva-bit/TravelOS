# Stage 10 real-package dependency diagnosis

Independent read-only reviewer: `sa-0-bf01c9fb`, delegation `deleg_5f37cc94`. No build, CI, candidate, artifact mutation or remote action by reviewer. This is a local diagnosis, not Stage 10 acceptance.

## Confirmed root causes

- The qualifier invented a root JavaScript API for `@esbuild/linux-x64`, a binary-only dependency. The installed platform executable exists and the real esbuild consumer resolves its `bin/esbuild` subpath. No missing pnpm binary was demonstrated.
- Bare `string_decoder` and `punycode` resolve to Node builtins, but the relevant npm consumers deliberately use slash-qualified installed-package references. Accepting builtin resolution is not verification of those npm bytes.
- Present optional Better Auth test peers bring Vitest, Vite and esbuild into Admin/Portal deployment graphs even under `pnpm deploy --prod`. They remain in the manifest closure and exact inventory; do not hide them by skipping optional peers.

## Correct qualification boundary

Keep manifest closure, same-package identity/version, lock membership, path containment, source/migration/payload inventory and archive binding. Actual executable qualification must use real importer specifiers and preserve ESM/CJS conditions. Computed references and native assets need explicit runtime proof, not a generic package-root probe or name skip list.

The current correction intentionally implements only declared-file inspection plus a credential-free initial-entry failure preflight. Its result explicitly keeps executable import-graph and CT200 authenticated runtime acceptance pending. It is not a replacement for those gates and cannot authorize promotion.

## Parent-executed evidence

- New declared-file helper was tested red/green against binary-only metadata, missing/escaping declared binaries, npm/builtin-name collisions, separate import/require target files, non-runtime type/custom conditions, legacy main extension/directory resolution, exports precedence and wildcard/directory limitations.
- Real extracted archive `stage10-mutable-real-package-4Ip6bY` was inspected read-only after its original foreground rehearsal was interrupted by the tool's 420-second limit. The original execution has no final outcome and remains interrupted; it was not reclassified as a successful run. Its seven recipe command receipts each report exit 0 (install, build, four production deployments, dependency restore).
- A separately written `read-only-package-recheck.json` records package-only checks: 1782 declared file entries and 1150 explicitly unqualified metadata cases. This is not executable-graph completeness or a canonical receipt.
- The three actual extracted application entrypoints were invoked without manifest/credentials and each reached its exact source-owned `process_bootstrap_failed` protocol, exit 1, zero stdout. No listener/authentication/database acceptance follows.
- Full lint and the two new helper suites passed (14 tests, zero skips). Complete expanded regression and independent scoped correction review remain required.

All scratch artifacts are unqualified, local-only rehearsal inputs. No canonical claim, Stage 10 artifact promotion, host policy change or Stage 11 action follows.
