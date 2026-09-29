# TravelOS Phase 1 M1 — Stage 5 final-4 implementation record

- **Stage:** Phase 1 M1 / Stage 5 final-4 candidate
- **Status:** implementation, focused validation, PostgreSQL qualification and full CI PASS; final-4 candidate ready for independent review.

## Corrections

- Added Stage 5 product permission IDs for customer, traveller, trip and reservation view/edit capabilities.
- Enforced composite Admin read/write capabilities, including finance mutation and sensitive traveller visibility.
- Made the M1 continuity projection explicitly designated-primary: one primary traveller per Trip and one primary customer relationship per Person, with filtered repository queries and PostgreSQL partial unique indexes.
- Added a secondary-row qualification proving that valid non-primary relationships do not change the M1 projection.
- Strengthened the two-connection lock qualification by holding the first move open, observing `pg_blocking_pids`, then releasing and verifying the opposite move commits.

## Evidence

- Focused tests: 5 files / 20 tests PASS.
- PostgreSQL 18.6 disposable qualification: 1 file / 10 tests PASS; cleanup PASS; `ct200Actions: 0`.
- Full `ci:verify`: 23 gates PASS under Node 24.19.0 / Corepack 0.35.0 / pnpm 11.21.0.
