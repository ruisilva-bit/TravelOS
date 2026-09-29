# TravelOS Phase 1 M1 — Stage 5 review corrections

- **Superseded candidate:** `STAGE_5_CANDIDATE_FREEZE.md`
- **Superseded candidate aggregate:** `fa69cf6cacbac0e83a229250388f7caa5cdcc3759eb4593f0c5008ce23b86e18`
- **Independent review lanes:** evidence integrity, domain/contracts, persistence/migration; the initial broad reviewer and the Admin lane timed out without an adjudication. The actionable findings below are preserved from the completed domain and persistence lanes and were independently verified during correction.
- **Status:** corrections implemented; corrected PostgreSQL/CI/evidence/review gates pending

| Finding | Severity | Correction | Verification required |
|---|---|---|---|
| S5-001 INTERNAL_ONLY authorization bypass | HIGH | Accommodation update now requires both `agency.manage_settings` and `finance.view_costs`; added settings-only route regression. | Admin route test and independent API review |
| S5-002 civil-time/date integrity | HIGH | Exact calendar round-trip and timezone projection now validate shared-kernel scheduled values; Admin itinerary/trip schemas enforce the same failure cases. | Unit/contract adversarial tests and PostgreSQL qualification |
| S5-003 currency scale contract drift | MEDIUM | Admin Money schema now refines each currency to its pinned scale before route execution. | Contract test and full CI |
| S5-004 prototype-key currency acceptance | MEDIUM | Shared Money registry membership uses own-property checks and validates registry scale. | Shared-kernel prototype-key test |
| S5-005 unrelated reservation links in singular slice | MEDIUM | M1 migration enforces one reservation and one supplier-cost line per Trip reservation; readSlice filters links to the selected reservation and returned itinerary items. | PostgreSQL duplicate/cardinality and slice-link qualification |
| S5-006 ambiguous supplier-cost optimistic target | MEDIUM | M1 migration enforces one supplier-cost line per Agency/Trip/Reservation, matching the existing command target. | PostgreSQL qualification |
| S5-007 UUID textual canonicalization | MEDIUM | Admin opaque-ID schema transforms accepted UUID text to lowercase before authorization/equality checks. | Contract and route tests |
| S5-PERSIST-001 inconsistent read snapshot | HIGH | `getM1TripSlice` now uses a read-only REPEATABLE READ transaction for the complete multi-query read. | PostgreSQL qualification and independent review |
| S5-DB-002 OLD/NEW family-detail trigger bypass | HIGH | Deferred family-detail validation uses tuple helper functions and validates both OLD and NEW identities on updates. | PostgreSQL qualification, including wrong-family and reassignment paths |
| S5-REV-003 old aggregate revision omission | HIGH | Workspace revision trigger touches both OLD and NEW Agency/Trip identities on child updates, with a transaction/aggregate-specific sentinel. | PostgreSQL cross-trip reassignment test |
| S5-LOCK-004 ambiguous optimistic-lock target | HIGH | Supplier-cost singleton constraint makes the reservation-scoped command target unique. | PostgreSQL duplicate-row/cardinality qualification |
| S5-QUAL-005 weak composite-isolation claim | MEDIUM | Qualification now creates a second valid same-Agency Trip and proves valid-but-crossed Trip references fail; the one-root Agency invariant is tested separately through the direct Agency FK. | PostgreSQL qualification |
| S5-CLEANUP-006 failed-shutdown cleanup | MEDIUM | Disposable runner escalates fast shutdown, verifies process absence and loopback-port closure, and retains the root when cleanup cannot be proven. | Disposable runner PASS evidence |

The superseded candidate and its evidence remain immutable historical records. A corrected candidate must use a new freeze and a fresh independent review; no finding is closed by this record alone.
