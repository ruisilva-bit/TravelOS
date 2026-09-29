# TravelOS Phase 1 M1 — Stage 5 final review corrections

This record closes the actionable findings from the fresh read-only semantic review of the previous corrected candidate. The previous review found no issue with the M1 domain shape, strict allowlists, IDOR predicates, optimistic entity locking, family-detail constraints or supplier-cost singleton targeting. The following corrections were applied before the final candidate was requalified.

| Finding | Correction | Verification |
|---|---|---|
| S5C-SEM-001 — raw Admin writes could precede JSON parsing | Use Nest's `useBodyParser("json")` before raw Stage 5 route registration; add a composed-server POST test proving a valid JSON body reaches auth rather than invalid-request handling. | `apps/admin-api/src/app.ts`; `apps/admin-api/test/composed-m1-body-parser.test.ts`; focused tests and full CI |
| S5C-SEM-002 — cost visibility implied restricted-note write authority | Add `finance.manage_costs` to the staff permission registry and require it together with `finance.view_costs` for `INTERNAL_ONLY` supplier-note mutation. | `packages/backend-core/src/staff-access/permission-registry.ts`; `apps/admin-api/src/m1-routes.ts`; route denial/acceptance tests |
| S5C-SEM-003 — reservation `tripId` reassignment did not fire the revision trigger | Broaden the reservation trigger to fire on all inserts, updates and deletes, including Agency/Trip movement, so old and new Trip identities are touched. Add a dependency-free reservation move qualification. | `migrations/0007_stage5_m1_domain_slice.cjs`; `tests/integration/stage-5-postgresql.test.ts`; PostgreSQL 18.6, 7/7 PASS |
| S5C-SEM-004 — mutation response reconstruction used READ COMMITTED | Set `REPEATABLE READ` before both accommodation and supplier-note mutation statements, covering write plus multi-query response reconstruction. | `packages/database/src/trip-operations/m1-operational-slice-repository.ts`; focused tests; PostgreSQL and CI PASS |
| S5C-SEM-005 — impossible RFC3339 calendar dates normalized by JavaScript | Validate the lexical instant date component with the non-normalizing calendar-date validator before projection and Date parsing. | `packages/backend-core/src/shared-kernel/time.ts`; `packages/contracts/src/admin/itinerary/m1.ts`; focused tests |
| S5C-SEM-006 — unbounded exact bigint accepted by Admin contracts | Enforce signed PostgreSQL `bigint` bounds in Money construction and Admin Money validation. | `packages/backend-core/src/shared-kernel/money/money.ts`; `packages/contracts/src/admin/money.ts`; focused tests |
| S5C-SEM-007 — cross-field domain errors could become HTTP 500 | Introduce `M1InputValidationError`, wrap deterministic application validation, and map it explicitly to HTTP 400 in the Admin adapter. | `packages/backend-core/src/modules/trip-operations/application/m1-trip-slice.ts`; `apps/admin-api/src/m1-routes.ts`; focused tests |
| S5F-SEM-001 — create accepted restricted supplier cost without the mutation capability | Require `finance.manage_costs` alongside settings and cost visibility for the M1 create command, which always carries the `INTERNAL_ONLY` supplier-cost payload. | `apps/admin-api/src/m1-routes.ts`; `apps/admin-api/test/m1-routes.test.ts` |
| S5F-SEM-002 — RFC3339 component grammar accepted normalized invalid times | Adopt the strict Stage 5 RFC3339 policy of hours 00–23, minutes/seconds 00–59 and numeric offsets 00–23:59 before JavaScript parsing. | `packages/backend-core/src/shared-kernel/time.ts`; `packages/contracts/src/admin/itinerary/m1.ts`; shared-kernel and contract tests |
| S5F-SEM-003 — opposite-direction revision touches could lock Trips in different orders | Add a pair-touch helper that orders old/new `(agencyId, tripId)` identities canonically before locking; qualify concurrent opposite-direction child moves. | `migrations/0007_stage5_m1_domain_slice.cjs`; `tests/integration/stage-5-postgresql.test.ts` |
| S5F-SEM-004 — PostgreSQL serialization failures bypassed optimistic-conflict mapping | Translate SQLSTATE `40001` from the whole REPEATABLE READ mutation transaction to `M1OptimisticConflictError`, preserving the Admin 409 contract; qualify concurrent writers. | `packages/database/src/trip-operations/m1-operational-slice-repository.ts`; PostgreSQL qualification |
| S5F-SEM-005 — relational schema allowed multiple M1 itinerary items per family | Add a same-Agency/same-Trip/family unique constraint so the relational cardinality matches the one-flight/one-accommodation M1 domain and read projection. | `migrations/0007_stage5_m1_domain_slice.cjs`; integration constraint qualification |
| S5F-INT-001 — aggregate delimiter wording was ambiguous | Clarify the aggregate algorithm as newline-terminated records, matching the deterministic generator and independent recomputation. | Final freeze and evidence-index metadata |

## Requalification

The corrected bytes passed focused tests, PostgreSQL 18.6 disposable qualification with cleanup, migration checksum verification, source safety, package build and full `ci:verify` with 23 gates. Evidence is under `docs/evidence/phase-1-m1/stage-5-final/`.

## Review status

This is an authoring record, not the independent closure decision. A fresh read-only reviewer must inspect the final frozen bytes and return a separate GO/NO-GO decision.
