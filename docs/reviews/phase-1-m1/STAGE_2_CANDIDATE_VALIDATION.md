# TravelOS Phase 1 M1 — Stage 2 Candidate Validation

- **Validation timestamp:** `2026-08-21T08:39:03Z`
- **Candidate purpose:** final executable validation of the Stage 2 monorepo, configuration contracts, architecture fences, CI, evidence and five deployable composition-root scaffolds.
- **Validation result:** **PASS**
- **Review state:** **READY FOR INDEPENDENT STAGE 2 REVIEW**
- **Stage 3 authorization:** **NOT GRANTED**

## 1. Authoritative provenance and formatter safety

| Item | Result | SHA-256 / count |
|---|---:|---|
| `IDEA.md` | PASS | `2c7be6b7154835a1301118670a33f2c8b9d9f8a0f178b9565515ab2484a2f524` |
| `AGENTS.md` | PASS | `224d6f1da3c389b97002fadc9b9ee1c60f14c8c3d20df6334f91e0a34df6a340` |
| `docs/reviews/PHASE_0_ACCEPTED_BASELINE.md` | PASS | `bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb` |
| Protected Accepted Phase 0 files | PASS | `40/40`; missing `0`; mismatches `0` |
| Stage 2 mutable formatter targets | PASS | `114` files; protected overlap `0` |

The repository-owned formatter used its positive mutable-file inventory. Accepted Phase 0 documents were not formatter targets. Protected-baseline verification passed before and after the final aggregate gate.

## 2. Clean frozen installation and exact dependency state

| Check | Final result |
|---|---|
| Command | `bash tooling/ci/install.sh --reporter=append-only` |
| Exit code | `0` — PASS |
| Toolchain | Node `24.19.0`; Corepack `0.35.0`; pnpm `11.21.0` |
| Required flags | `--frozen-lockfile`; `--strict-peer-dependencies` |
| Workspace projects / installed packages | `15` / `561` |
| Lockfile SHA-256 before and after | `c2b872478a60675300e83d8d45d70ec42e4bc272d16a17a7519e46f525d2cec9` — unchanged |
| Exact pins | `46/46`; Stage 1 manifest and resolved graph match |
| Policies | engine strict `true`; strict peers `true`; minimum release age `1440` minutes |
| Approved build scripts | `esbuild` only; lodash override `4.18.1` |
| Lifecycle output | none observed; trusted shared cache retained; `561` reused, `0` downloaded |
| Fail-closed lifecycle matrix | PASS — `2` accepted cases, `5` rejected cases |

No cache-reuse failure was manufactured: the final install accepted empty lifecycle output only because complete shared-cache reuse was recorded and exact-pin policy independently restricted approved build scripts to `esbuild`. Empty output without cache-reuse proof, any unapproved script, a broadened policy, and failed pin verification were rejected. No dependency or lockfile update was made.

## 3. Final executable gate

| Gate | Final result | Evidence |
|---|---:|---|
| Protected baseline pre/post | PASS — 40/40 | `TOS-S2-EV-001` |
| Format check / formatter protection | PASS — 114 targets, overlap 0 | `TOS-S2-EV-002` |
| Clean frozen install | PASS | `TOS-S2-EV-003` |
| Exact pins and policies | PASS — 46/46 | `TOS-S2-EV-004` |
| ESLint | PASS — 0 errors, 0 warnings | `TOS-S2-EV-005` |
| TypeScript checks | PASS — 0 errors | `TOS-S2-EV-006` |
| Production architecture graph | PASS — 42 modules, 32 dependencies, 0 cycles, 0 violations | `TOS-S2-EV-007` |
| Invalid Portal fixture | PASS — intended rejection | `TOS-S2-EV-008` |
| Unit tests | PASS — 6/6 files, 17/17 tests | `TOS-S2-EV-009` |
| Configuration contract tests | PASS | `TOS-S2-EV-010` |
| Generated-schema drift | PASS | `TOS-S2-EV-011` |
| Rejected technology scan | PASS | `TOS-S2-EV-012` |
| Source credential/PII scan | PASS — 119 files, 0 findings | `TOS-S2-EV-013` |
| Clean build | PASS — 14/15 projects with build scripts; five deployables | `TOS-S2-EV-014` |
| Five deployable smokes | PASS | `TOS-S2-EV-015` |
| Browser bundle scan | PASS — 6 files, 0 findings | `TOS-S2-EV-016` |
| Stage 2 / Stage 3 boundary inspection | PASS | `TOS-S2-EV-017` |
| `ci:verify` | PASS — 14/14 aggregate gates | `TOS-S2-EV-018` |
| Deterministic implementation tree | PASS — 124 files | `TOS-S2-EV-019` |

## 4. Architecture proof

- Production graph: **42 modules**, **32 dependencies**, **0 cycles**, **0 violations**.
- Negative fixture process exit: **1** (non-zero as required).
- Exact rule: `portal-fixture-cannot-import-backend-core`.
- Resolvable forbidden edge: `tooling/architecture/fixtures/invalid-portal-import/portal-entry.ts` → `packages/backend-core/src/index.ts`.
- Expected violations: **1**; unexpected violations: **0**.

The active rule set covers Portal/Admin/backend isolation, portal-safe-core privilege isolation, browser/backend separation, core/framework and adapter independence, package/composition-root direction, composition-root isolation, production/test separation, cycles and unresolved dependencies. The invalid fixture failed for the intended rule, not an unresolved import or tooling error.

## 5. Configuration and security proof

- Valid DEVELOPMENT manifest accepted: **PASS**.
- Unknown root key rejected: **PASS**.
- Unknown nested key rejected: **PASS**.
- Secret-like field rejected: **PASS**.
- Same Admin/Portal host rejected: **PASS**.
- Incoherent exact-host allowlist rejected: **PASS**.
- Generated JSON Schema matches source: **PASS**.
- Rejected technology scan: `15` manifests and `91` source files; no rejected package/import findings.
- Repository-owned source credential/PII scan: `119` files; **0 findings**.
- Browser bundle credential/secret scan: `6` files; **0 findings**.
- Runtime secret management is **not claimed or implemented** by Stage 2.

## 6. Five deployable composition roots

| Deployable | Independent final proof |
|---|---|
| Admin Web | build PASS; own marker `TravelOS` present; Portal marker `TravelOS Portal` absent; 3 files; aggregate `c46711c780a337b1b966222df92328278b8d0134ceee1eddbc9c8ffdd882694c` |
| Portal Web | build PASS; own marker `TravelOS Portal` present; Admin marker `data-routing-root="admin"` absent; 3 files; aggregate `f7224103371288374dcce6cb6d3420901ed0c246643355f7d4cc1a01e796a4ca` |
| Admin API | requested port `0`; bound `127.0.0.1:33165`; real `GET /health/live`; HTTP `200`; clean shutdown; exit `0` |
| Portal API | requested port `0`; bound `127.0.0.1:39645`; real `GET /health/live`; HTTP `200`; clean shutdown; exit `0` |
| Worker | `RUNNING` → clean `STOPPED`; exit `0` |

Nest application initialization alone was not accepted as an API smoke.

## 7. Evidence and deterministic repository tree

- Evidence index: `docs/evidence/phase-1-m1/stage-2/EVIDENCE_INDEX.json`.
- Index SHA-256: `25df1c53e1da00b6cbc8e2c3e7ee867f216c17ee2058ef77df882e1691b1b55e`.
- Indexed artifacts: **19**; every recorded size and SHA-256 recomputed successfully.
- Deterministic implementation tree: **124 files**; aggregate SHA-256 `5cef7513ae008bfd682bb3b887009efa1178bd3a1bd392a8751a2697eae03a1d`.
- Workspace shape: root workspace **1**; apps **5**; packages **9**; pnpm workspace projects **15**.
- `tooling/*` workspace projects: **0**; tooling directories are repository tooling, not pnpm packages.
- Exclusions: `.git`, `node_modules`, `dist`, coverage, Vite caches and TypeScript build-info files.

## 8. Stage 3 boundary and CT 200

Final repository inspection found no Stage 3 behaviour:

- no PostgreSQL runtime database or bootstrap;
- no migrations, DB connections or DB roles;
- no authentication implementation or Better Auth runtime wiring;
- no Trip, Customer or Publishing implementation;
- no Portal business-data endpoint;
- no CT deployment configuration activation.

The database, auth-adapter, backend-core and portal-safe package files remain accepted Stage 2 placeholders/boundary markers. The only API route is `GET /health/live` on the separately composed Admin and Portal APIs.

**CT 200 remained unchanged.** This validation performed no SSH, Proxmox API/`pct`, package installation, file copy, deployment, database/user/service creation, or network/firewall operation against CT 200. No external access was made merely to re-prove non-mutation.

## 9. Conclusion

**PASS.** The exact Stage 2 candidate is ready for freeze and independent non-authoring review. Independent review was not delegated in this turn. Stage 3 remains unauthorized.
