# TravelOS Phase 1 M1 — Stage 5 final-2 candidate validation

- **Stage:** Phase 1 M1 / Stage 5 final-2 candidate
- **Status:** PASS for implementation, qualification and CI; eligible for exact-byte freeze and fresh independent review
- **Evidence index:** `docs/evidence/phase-1-m1/stage-5-final-2/EVIDENCE_INDEX.json`
- **Supersedes:** Stage 5 final candidate validation as a candidate for closure; prior bytes remain historical/superseded

## Validation matrix

| Gate | Evidence | Result |
|---|---|---|
| Shared-kernel/domain invariants | `packages/backend-core/test/m1/shared-kernel.test.ts`, `packages/backend-core/test/m1/application.test.ts` | PASS |
| Strict Admin contracts | `packages/contracts/test/admin-m1-contracts.test.ts` | PASS |
| Authorized Admin adapter and composed JSON parsing | `apps/admin-api/test/m1-routes.test.ts`, `apps/admin-api/test/composed-m1-body-parser.test.ts` | PASS |
| Focused final-2 aggregate | `focused-tests.log` — 6 files / 18 tests | PASS |
| Disposable PostgreSQL 18.6 | `integration-tests.log` — 8 tests | PASS |
| Concurrent optimistic writers | PostgreSQL qualification exercises two simultaneous accommodation updates with one typed conflict | PASS |
| Canonical revision lock order | PostgreSQL qualification exercises opposite-direction concurrent child moves | PASS |
| M1 itinerary family cardinality | PostgreSQL qualification rejects a second same-family item with `itinerary_item_trip_family_unique` | PASS |
| Disposable cleanup | `disposable-cleanup.json` | PASS; process, port and root removal verified |
| Exact migration checksums | `migration-checksums.json` — head `0007_stage5_m1_domain_slice.cjs` | PASS |
| Full CI | `ci-verify.log` — Node 24.19.0 / Corepack 0.35.0 / pnpm 11.21.0 | PASS; 23 gates completed |
| Package build/runtime | `package-build.json`, `postgresql-runtime.json` | PASS |
| Sensitive-data scan | `source-safety.json` | PASS; findings empty within the scanner's declared scope |

## Final-2 semantic corrections

- M1 creation requires the explicit `finance.manage_costs` capability whenever the restricted supplier-cost payload is accepted.
- RFC3339 components reject normalized invalid times such as `24:00:00` under the explicit strict V1 policy.
- Old/new Trip workspace-revision touches use canonical pair ordering.
- SQLSTATE `40001` from mutation transactions maps to the typed optimistic conflict and therefore Admin HTTP 409 path.
- Relational itinerary cardinality matches the one-flight/one-accommodation M1 domain projection.
- Aggregate metadata explicitly says records are newline-terminated.

## Scope boundary

No external database, customer deployment, public exposure, destructive operation, Stage 6 action or real credential was used. Stage 6 remains outside this candidate and has zero actions.
