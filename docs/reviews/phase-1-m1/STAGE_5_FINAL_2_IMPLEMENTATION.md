# TravelOS Phase 1 M1 — Stage 5 final-2 implementation record

- **Stage:** Phase 1 M1 / Stage 5 final-2 candidate
- **Status:** implementation, focused validation, PostgreSQL qualification and full CI passed; awaiting fresh independent review
- **Scope:** Person / Customer / TripTraveller → Trip → Flight → Accommodation → Reservation → ReservationItemLink → exact Money / INTERNAL_ONLY sentinel → PostgreSQL persistence → Admin contracts/API
- **Predecessor:** `docs/reviews/phase-1-m1/STAGE_4_INDEPENDENT_CLOSURE.md`
- **Superseded candidate:** `STAGE_5_FINAL_CANDIDATE_FREEZE.md`; fresh independent review identified S5F-SEM-001..005 and S5F-INT-001, all corrected here.

## Final-2 implementation

- M1 creation now requires `agency.manage_settings`, `finance.view_costs` and `finance.manage_costs`; the request always carries the `INTERNAL_ONLY` supplier-cost payload.
- RFC3339 parsing uses an explicit strict policy before JavaScript parsing: hours 00–23, minutes/seconds 00–59 and numeric offsets 00–23:59. Impossible calendar dates remain rejected lexically.
- Workspace revision triggers lock old/new Trip identities in canonical `(agencyId, tripId)` order, preventing opposite-direction reparenting deadlocks.
- REPEATABLE READ mutation transactions translate PostgreSQL SQLSTATE `40001` to the typed optimistic-conflict error used by the Admin 409 contract.
- Itinerary persistence enforces one family item per Agency/Trip, matching the M1 domain's one Flight and one Accommodation projection.
- Evidence/freeze aggregate metadata states that records are newline-terminated, removing delimiter ambiguity.

## Executed evidence

- Focused aggregate: 6 files / 18 tests passed.
- Disposable PostgreSQL 18.6 qualification: 1 file / 8 tests passed; reservation reparenting, concurrent opposite-direction movement, concurrent optimistic writers, family cardinality, cleanup and `ct200Actions: 0` passed.
- Full `ci:verify`: 23 gates completed with final PASS under Node 24.19.0, Corepack 0.35.0 and pnpm 11.21.0.
- Migration head and final SHA-256 are recorded in the final-2 migration evidence and candidate freeze.
- Final-2 evidence index: `docs/evidence/phase-1-m1/stage-5-final-2/EVIDENCE_INDEX.json`.

## Review boundary

This is an authoring record, not the independent closure decision. A fresh read-only independent reviewer must inspect the exact final-2 frozen bytes and return a separate GO/NO-GO decision.

## Stage 6 boundary

No Stage 6 action, implementation, migration, evidence or review was executed; Stage 6 actions remain zero.
