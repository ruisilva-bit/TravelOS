# TravelOS Phase 1 M1 — Stage 5 final candidate validation

- **Stage:** Phase 1 M1 / Stage 5 final candidate
- **Status:** PASS for implementation, qualification and CI; candidate eligible for exact-byte freeze and fresh independent review
- **Evidence index:** `docs/evidence/phase-1-m1/stage-5-final/EVIDENCE_INDEX.json`
- **Supersedes:** the corrected candidate validation record as a candidate for closure; historical bytes remain unchanged

## Validation matrix

| Gate | Evidence | Result |
|---|---|---|
| Shared-kernel/domain invariants | `packages/backend-core/test/m1/shared-kernel.test.ts`, `packages/backend-core/test/m1/application.test.ts` | PASS |
| Strict Admin contracts | `packages/contracts/test/admin-m1-contracts.test.ts` | PASS |
| Authorized Admin adapter and composed JSON parsing | `apps/admin-api/test/m1-routes.test.ts`, `apps/admin-api/test/composed-m1-body-parser.test.ts` | PASS |
| Focused final aggregate | `docs/evidence/phase-1-m1/stage-5-final/focused-tests.log` — 6 files / 18 tests | PASS |
| Disposable PostgreSQL 18.6 | `docs/evidence/phase-1-m1/stage-5-final/integration-tests.log` — 8 tests | PASS |
| Reservation reassignment revision invariant | PostgreSQL qualification test for dependency-free reservation movement | PASS |
| Disposable cleanup | `docs/evidence/phase-1-m1/stage-5-final/disposable-cleanup.json` | PASS; process, port and root removal verified |
| Exact migration checksums | `docs/evidence/phase-1-m1/stage-5-final/migration-checksums.json` — head `0007_stage5_m1_domain_slice.cjs`, SHA-256 `044bf4147cf140670995ed99911e042e1a9999cce99e43e86ef59ed96aaac1f1` | PASS |
| Full CI | `docs/evidence/phase-1-m1/stage-5-final/ci-verify.log` — Node 24.19.0 / Corepack 0.35.0 / pnpm 11.21.0 | PASS; 23 gates completed |
| Package build/runtime | `package-build.json`, `postgresql-runtime.json` | PASS |
| Sensitive-data scan | `source-safety.json` | PASS; findings empty within the scanner's declared scope |

## Final semantic corrections verified

- Raw Admin JSON writes have body parsing installed before raw route registration.
- `INTERNAL_ONLY` supplier-cost mutation requires both `finance.view_costs` and `finance.manage_costs`.
- Reservation reassignment touches both old and new Trip workspace revisions.
- Accommodation and supplier-note writes reconstruct responses under `REPEATABLE READ`.
- RFC3339 instants reject impossible lexical calendar dates instead of accepting JavaScript normalization.
- Money/Admin contracts reject values outside PostgreSQL signed `bigint` range.
- Typed application input validation maps deterministic cross-field failures to HTTP 400.
- M1 create requires the explicit `finance.manage_costs` capability because its request always carries the restricted supplier-cost payload.
- Strict RFC3339 components reject `24:00:00` and out-of-policy numeric offsets before JavaScript normalization.
- Canonical pair locking prevents opposite-direction workspace-revision deadlocks; SQLSTATE `40001` maps to the optimistic-conflict contract.
- A same-Agency/same-Trip/family uniqueness constraint aligns relational cardinality with the one-flight/one-accommodation M1 model.

## Scope boundary

No external database, customer deployment, public exposure, destructive operation, Stage 6 action or real credential was used. Stage 6 remains outside this candidate and has zero actions.
