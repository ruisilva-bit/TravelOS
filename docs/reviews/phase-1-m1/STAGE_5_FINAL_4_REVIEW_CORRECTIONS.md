# TravelOS Phase 1 M1 — Stage 5 final-4 review corrections

This record closes the actionable findings from the independent final-3 review.

| Finding | Correction |
|---|---|
| S5F3-AUTH-001 — composite Admin routes used foundation/finance capabilities instead of product capabilities | Added code-owned Stage 5 `customer`, `traveller`, `trip` and `reservation` view/edit permissions; every composite response now requires the applicable read capabilities, and each mutation also requires the applicable edit capability plus finance visibility/mutation where restricted cost data is returned or changed. |
| S5F3-DOMAIN-001 / S5F3-DB-001 — singular M1 continuity projection could select arbitrary valid rows | Defined the M1 projection around designated primary rows. PostgreSQL partial unique indexes enforce one primary traveller per Trip and one primary customer relationship per Person; repository queries filter those designations; qualification inserts secondary valid rows and verifies the primary projection remains stable. |
| S5F3-QUAL-001 — concurrent lock qualification could serialize before contention | The qualification holds the first move transaction open, starts the opposite move, observes active blocking through `pg_blocking_pids`, then commits the first move and verifies the second commits and final destinations/revisions are correct. |
