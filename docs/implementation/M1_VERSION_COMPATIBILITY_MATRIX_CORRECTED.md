# M1 Stage 1 — Version Compatibility Matrix — Corrected Candidate

**Status:** post-review corrected-generation candidate  
**Supersedes:** `M1_VERSION_COMPATIBILITY_MATRIX.md` only after focused independent closure  
**Evidence index:** `docs/evidence/phase-1-m1/stage-1/EVIDENCE_INDEX.json`

## 1. Exact selection policy

- Node `24.19.0`, Corepack `0.35.0`, pnpm `11.21.0`, exact direct versions, `engine-strict=true`, strict peers, clean resolution and frozen reinstall (`S1-EV-001`–`S1-EV-004`).
- Supply-chain release-age policy is exactly **1,440 minutes**, with no exclusions (`S1-EV-001`, `S1-EV-007`). Better Auth `1.6.28` was younger than that threshold at the original qualification point; aligned runtime/CLI `1.6.27` remains selected.
- Lifecycle policy permits only `esbuild`; pnpm reported no automatically ignored builds (`S1-EV-007`).
- Full and production dependency audits are both zero (`S1-EV-005`, `S1-EV-006`).
- `vite-tsconfig-paths` is rejected and absent; `lodash` resolves only to `4.18.1` (`S1-EV-001`, `S1-EV-002`).

## 2. Runtime and release-tool pins

| Component | Exact pin | Evidence |
|---|---:|---|
| Node.js | `24.19.0` | `S1-EV-022` |
| npm bundled with Node | `11.17.0` (informational) | `S1-EV-022`, toolchain execution record summarized by `S1-EV-003` |
| Corepack | `0.35.0` | `S1-EV-003`, `S1-EV-004` |
| pnpm | `11.21.0` | `S1-EV-003`–`S1-EV-007` |
| PostgreSQL | major `18`; qualified package `18.6-1.pgdg13+2` | `S1-EV-017`, `S1-EV-023` |
| pgBackRest | `2.59.0-1.pgdg13+1` | `S1-EV-023`, `S1-EV-029` |
| Caddy | `2.11.4` | `S1-EV-028` |
| Syft | `1.51.0` | `S1-EV-027` |
| Cosign | `3.1.3` | `S1-EV-026` |

Node archive SHA-256 is `14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647` (`S1-EV-022`). Release-tool checksums and version outputs are retained in `toolchain-package-provenance.json` (`S1-EV-026`–`S1-EV-029`). These are qualified recommendations, not deployments.

## 3. Exact direct dependency matrix

| Package | Exact version | Evidence |
|---|---:|---|
| `@asteasolutions/zod-to-openapi` | `9.1.0` | `S1-EV-001`, `S1-EV-002` |
| `@axe-core/playwright` | `4.13.0` | `S1-EV-001`, `S1-EV-002` |
| `@eslint/js` | `10.0.1` | `S1-EV-001`, `S1-EV-002` |
| `@nestjs/common` | `11.1.29` | `S1-EV-001`, `S1-EV-002` |
| `@nestjs/core` | `11.1.29` | `S1-EV-001`, `S1-EV-002` |
| `@nestjs/platform-express` | `11.1.29` | `S1-EV-001`, `S1-EV-002` |
| `@nestjs/testing` | `11.1.29` | `S1-EV-001`, `S1-EV-002` |
| `@playwright/test` | `1.62.1` | `S1-EV-001`, `S1-EV-002` |
| `@tailwindcss/vite` | `4.3.3` | `S1-EV-001`, `S1-EV-002` |
| `@testing-library/dom` | `10.4.1` | `S1-EV-001`, `S1-EV-002` |
| `@testing-library/jest-dom` | `7.0.1` | `S1-EV-001`, `S1-EV-002` |
| `@testing-library/react` | `16.3.2` | `S1-EV-001`, `S1-EV-002` |
| `@types/node` | `24.13.3` | `S1-EV-001`, `S1-EV-002` |
| `@types/pg` | `8.21.0` | `S1-EV-001`, `S1-EV-002` |
| `@types/react` | `19.2.18` | `S1-EV-001`, `S1-EV-002` |
| `@types/react-dom` | `19.2.4` | `S1-EV-001`, `S1-EV-002` |
| `@types/supertest` | `7.2.1` | `S1-EV-001`, `S1-EV-002` |
| `@vitejs/plugin-react` | `6.0.5` | `S1-EV-001`, `S1-EV-002` |
| `@vitest/coverage-v8` | `4.1.10` | `S1-EV-001`, `S1-EV-002` |
| `auth` | `1.6.27` | `S1-EV-001`, `S1-EV-002` |
| `better-auth` | `1.6.27` | `S1-EV-001`, `S1-EV-002` |
| `decimal.js` | `10.6.0` | `S1-EV-001`, `S1-EV-002` |
| `dependency-cruiser` | `18.2.0` | `S1-EV-001`, `S1-EV-002` |
| `eslint` | `10.8.1` | `S1-EV-001`, `S1-EV-002` |
| `eslint-plugin-boundaries` | `7.2.0` | `S1-EV-001`, `S1-EV-002` |
| `fast-check` | `4.9.0` | `S1-EV-001`, `S1-EV-002` |
| `jsdom` | `30.0.1` | `S1-EV-001`, `S1-EV-002` |
| `kysely` | `0.29.5` | `S1-EV-001`, `S1-EV-002` |
| `nestjs-pino` | `4.6.1` | `S1-EV-001`, `S1-EV-002` |
| `node-pg-migrate` | `9.0.0` | `S1-EV-001`, `S1-EV-002` |
| `pg` | `8.23.0` | `S1-EV-001`, `S1-EV-002` |
| `pino` | `10.3.1` | `S1-EV-001`, `S1-EV-002` |
| `pino-http` | `11.0.0` | `S1-EV-001`, `S1-EV-002` |
| `prettier` | `3.9.6` | `S1-EV-001`, `S1-EV-002` |
| `react` | `19.2.8` | `S1-EV-001`, `S1-EV-002` |
| `react-dom` | `19.2.8` | `S1-EV-001`, `S1-EV-002` |
| `reflect-metadata` | `0.2.2` | `S1-EV-001`, `S1-EV-002` |
| `rxjs` | `7.8.2` | `S1-EV-001`, `S1-EV-002` |
| `supertest` | `7.2.2` | `S1-EV-001`, `S1-EV-002` |
| `tailwindcss` | `4.3.3` | `S1-EV-001`, `S1-EV-002` |
| `tsx` | `4.23.12` | `S1-EV-001`, `S1-EV-002` |
| `typescript` | `6.0.3` | `S1-EV-001`, `S1-EV-002` |
| `typescript-eslint` | `8.67.0` | `S1-EV-001`, `S1-EV-002` |
| `vite` | `8.2.1` | `S1-EV-001`, `S1-EV-002` |
| `vitest` | `4.1.10` | `S1-EV-001`, `S1-EV-002` |
| `zod` | `4.4.3` | `S1-EV-001`, `S1-EV-002` |

The matrix contains **46 exact direct packages**: 16 runtime and 30 development. The retained graph contains 561 resolved instances, zero failed Node-engine checks and zero failed peer checks (`S1-EV-001`, `S1-EV-002`).

## 4. Transitive override

The workspace policy is:

```yaml
overrides:
  lodash: 4.18.1
```

It deliberately replaces Chevrotain's transitive exact request. The retained graph proves only `lodash@4.18.1`, the strict clean/frozen installs passed, both auth schemas regenerated, and both audits are zero (`S1-EV-001`–`S1-EV-006`, `S1-EV-014`–`S1-EV-016`). Removing the override requires a new affected compatibility run.

## 5. Executed gate matrix

| Gate | Result | Evidence |
|---|---|---|
| Exact direct and resolved dependency graph | PASS | `S1-EV-001` |
| Engines and peers | PASS | `S1-EV-002` |
| Clean strict install | PASS | `S1-EV-003` |
| Frozen reinstall | PASS | `S1-EV-004` |
| Full audit | PASS — zero | `S1-EV-005` |
| Production audit | PASS — zero | `S1-EV-006` |
| Build allowlist | PASS — `esbuild` only | `S1-EV-007` |
| TypeScript | PASS | `S1-EV-008` |
| ESLint | PASS | `S1-EV-009` |
| Vitest | PASS | `S1-EV-010` |
| dependency-cruiser | PASS | `S1-EV-011` |
| Nest compile/runtime | PASS | `S1-EV-012` |
| React/Vite/Tailwind build | PASS | `S1-EV-013` |
| Better Auth Staff / Portal | PASS | `S1-EV-014`, `S1-EV-015` |
| Zero realm-table overlap | PASS | `S1-EV-016` |
| PostgreSQL startup/version | PASS | `S1-EV-017` |
| `pg` / Kysely | PASS | `S1-EV-018`, `S1-EV-019` |
| migration up/down | PASS | `S1-EV-020` |
| dump/restore equivalence | PASS | `S1-EV-021` |

The correction probe lockfile SHA-256 is `e86248639a5983765b3e11e3b7ac79d2e4e945fc4a022e368929832a86410a7b` (`S1-EV-001`, `S1-EV-003`, `S1-EV-004`). It is probe evidence, not a Stage 2 product lockfile.

## 6. TypeScript declaration policy

`skipLibCheck: true` is broad: TypeScript skips declaration-file checking generally; it cannot intrinsically be limited to third-party declarations. It is retained because Better Auth publishes optional multi-runtime declarations, while owned `.ts`/`.tsx` code remains strict (`S1-EV-008`). Stage 2 must separately fail on errors in TravelOS-owned declaration files and may not treat this compiler option as permission to weaken owned contracts.

## 7. Better Auth and PostgreSQL results

- Staff SQL SHA-256: `f65a85654e3d21f0ab1f9361757f6198639166fde9794194e93d0fb225531e6f`; five physical tables under `staff_access` (`S1-EV-014`).
- Portal SQL SHA-256: `ce2562b3d8ff1fcc2282be1c1977de54d228265ad7f2107c4c54ac6a5f194762`; four physical tables under `portal_access` (`S1-EV-015`).
- Generated-name and schema-qualified physical-identity intersections are empty (`S1-EV-016`).
- PostgreSQL reported `18.6`, server number `180006`, checksums on and loopback port `55433` (`S1-EV-017`).
- `pg` returned exact numeric `0.3`; Kysely returned `42` (`S1-EV-018`, `S1-EV-019`).
- Migration ledger/table state changed `1/present` then `0/absent` (`S1-EV-020`).
- Dump SHA-256 `9bfc24fd4c7b8bc1b2870eeea833f2e7f764effd2ecc5c4a956af6d47e377a4e` restored with an equal table inventory (`S1-EV-021`).

Generated SQL and dump were deleted after hashing and were never product migrations or source.

## 8. Source ledger and update rule

Authoritative public metadata sources are retained per check in the evidence artifacts: Node release/checksums, npm registry, Better Auth CLI documentation, PostgreSQL/PGDG/Debian indexes and official GitHub releases for Caddy, Syft and Cosign (`S1-EV-001`, `S1-EV-022`, `S1-EV-023`, `S1-EV-026`–`S1-EV-029`).

Any pin change requires a fresh affected engine/peer, audit, generation, build/test, migration and backup/restore qualification. Better Auth runtime/CLI move together; PostgreSQL remains major-pinned in deployment and exact-package-pinned per release.
