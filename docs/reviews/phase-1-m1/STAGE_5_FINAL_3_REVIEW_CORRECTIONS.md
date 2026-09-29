# TravelOS Phase 1 M1 — Stage 5 final-3 review corrections

This record closes the actionable findings from the independent final-2 review.

| Finding | Correction |
|---|---|
| S5F2-SEM-001 — contract accepted PostgreSQL-unsupported offsets | The shared-kernel and Admin contracts now accept only `Z` or numeric offsets from `-15:59` through `+15:59`; validated instants are also canonicalized to UTC before binding. Boundary tests cover `+15:59` and reject `+16:00`. |
| S5F2-SEM-002 — precision divergence | The Stage 5 RFC3339 policy is millisecond precision only. Contracts, shared-kernel tests and application ordering now share that precision policy. |
| S5F2-DB-001 — local-time persistence gap | Flight and Accommodation detail tables now enforce `local_time < TIME '24:00:00'`; PostgreSQL qualification writes `24:00:00` directly and verifies both checks reject it. |
| S5F2-QUAL-001 — weak SQLSTATE qualification | Two repeatable-read sessions establish snapshots before the conflicting update; the test observes SQLSTATE `40001`, maps it through the repository mapper and separately verifies the Admin `409` boundary. |
| S5F2-QUAL-002 — weak concurrent lock qualification | The two-session child-move test uses a readiness barrier, opposite-direction updates, and a bounded lock timeout while the migration uses canonical old/new Trip ordering. |

The final-3 candidate remains limited to Stage 5 M1. No Stage 6 action is authorized.
