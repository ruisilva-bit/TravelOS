# TravelOS Phase 1 M1 — Stage 5 final-2 review corrections

This record closes the actionable findings from the independent review of the superseded Stage 5 final candidate. The persistence lane independently returned GO; the broad lane returned NO-GO with S5F-SEM-001..005 and S5F-INT-001. Every finding was corrected before this final-2 requalification.

| Finding | Correction | Verification |
|---|---|---|
| S5F-SEM-001 — create accepted restricted supplier cost without the mutation capability | Require `finance.manage_costs` in addition to `agency.manage_settings` and `finance.view_costs` on the M1 create command; add a denial test for settings + visibility without mutation. | `apps/admin-api/src/m1-routes.ts`; `apps/admin-api/test/m1-routes.test.ts`; focused PASS |
| S5F-SEM-002 — RFC3339 component grammar accepted normalized invalid times | Adopt strict component ranges before `Date.parse`: hours 00–23, minutes/seconds 00–59 and numeric offsets 00–23:59; add `24:00:00` regression fixtures. | `packages/backend-core/src/shared-kernel/time.ts`; `packages/contracts/src/admin/itinerary/m1.ts`; focused PASS |
| S5F-SEM-003 — opposite-direction revision touches could lock Trips in different orders | Add `touch_workspace_revision_pair`, order old/new Agency/Trip identities canonically, and qualify simultaneous opposite-direction child moves. | `migrations/0007_stage5_m1_domain_slice.cjs`; PostgreSQL 18.6 qualification, 8/8 PASS |
| S5F-SEM-004 — PostgreSQL serialization failures bypassed optimistic-conflict mapping | Catch SQLSTATE `40001` around both full REPEATABLE READ mutation transactions and translate it to `M1OptimisticConflictError`; qualify two concurrent writers. | `packages/database/src/trip-operations/m1-operational-slice-repository.ts`; PostgreSQL 18.6 qualification, 8/8 PASS |
| S5F-SEM-005 — relational schema allowed multiple M1 itinerary items per family | Add `itinerary_item_trip_family_unique` on Agency/Trip/family, aligning persistence with the one-flight/one-accommodation M1 projection. | `migrations/0007_stage5_m1_domain_slice.cjs`; constraint qualification PASS |
| S5F-INT-001 — aggregate delimiter wording was ambiguous | State the exact serialization as newline-terminated records in the evidence index and candidate freeze. | Final-2 evidence index and freeze |

## Requalification

The corrected bytes passed focused tests, PostgreSQL 18.6 disposable qualification with cleanup, migration checksum verification, source safety, package build and full `ci:verify` with 23 gates. Evidence is under `docs/evidence/phase-1-m1/stage-5-final-2/`.

## Review status

This is an authoring record, not the independent closure decision. A fresh read-only reviewer must inspect the final-2 frozen bytes and return a separate GO/NO-GO.
