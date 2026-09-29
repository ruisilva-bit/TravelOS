# TravelOS Phase 1 M1 — Stage 5 corrected implementation record

- **Stage:** Phase 1 M1 / Stage 5 corrected generation
- **Generated:** 2026-09-23T12:24:52Z
- **Status:** corrected implementation, disposable PostgreSQL qualification and full CI passed
- **Scope:** Person / Customer / TripTraveller → Trip → Flight → Accommodation → Reservation → ReservationItemLink → exact Money / INTERNAL_ONLY sentinel → PostgreSQL persistence → Admin contracts/API
- **Superseded implementation record:** `STAGE_5_IMPLEMENTATION.md`

## Delivered corrected slice

- `packages/backend-core` owns branded opaque IDs, UUID v7 validation/generation, exact `Money`, exact scheduled local date/time validation, CRM continuity, structured itinerary domain types, reservation linking and application invariants.
- `packages/database` owns explicit row mappers, Agency-scoped transactions, optimistic-lock checks, coherent read snapshots, old/new workspace-revision handling and UUID v7 generation.
- `packages/contracts` owns strict Admin allowlists for continuity, trips, itinerary, reservations, links, Money JSON and `INTERNAL_ONLY`; currency scales, civil-time tuples and UUID text are boundary-validated.
- `apps/admin-api` owns the authorized Admin HTTP adapter. Cost-bearing responses require `finance.view_costs`; host/session/Agency/permission checks remain server-side and optimistic conflicts map to `409`.
- `migrations/0007_stage5_m1_domain_slice.cjs` adds the relational slice, explicit M1 cardinality constraints, same-Agency/same-Trip composite constraints, corrected deferred family/detail checks, old/new revision updates, currency scale registry, grants and migration-context enforcement.
- `tooling/database/run-stage-5-disposable.mjs` qualifies PostgreSQL 18.6 on loopback and proves shutdown/process/listener/filesystem cleanup before removing the disposable root.

## Executed evidence

- Focused corrected aggregate: 4 files / 13 tests passed.
- Disposable PostgreSQL 18.6 qualification: 1 file / 6 tests passed; cleanup and `ct200Actions: 0` passed.
- Full `ci:verify`: 23 gates completed with final PASS under Node 24.19.0, Corepack 0.35.0 and pnpm 11.21.0.
- Migration head: `0007_stage5_m1_domain_slice.cjs`, SHA-256 `c35f3b21b77b222f2a90163ae7d121ab2f084bf02a9109cb5cc041271fde7a5c`.
- Corrected evidence index: `docs/evidence/phase-1-m1/stage-5-corrected/EVIDENCE_INDEX.json`, aggregate SHA-256 `c75fc5792a21e599e04b9bab62ccdfd2736613946e54e825c914705f29b94504`.

## Review boundary

The earlier Stage 5 candidate and evidence remain immutable historical records. The completed independent domain and persistence reviews produced the correction matrix in `STAGE_5_REVIEW_CORRECTIONS.md`; the corrected candidate now requires a fresh independent review. The initial broad and Admin-focused review executions timed out and are not treated as closure evidence.

## Stage 6 boundary

No Stage 6 action, implementation, migration, evidence or review was executed; Stage 6 actions remain zero.
