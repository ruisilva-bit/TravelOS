# Stage 5 FINAL-9 independent review record — historical / rejected

**Status:** `NO-GO — superseded by FINAL-10 remediation`  
**Candidate:** `FINAL-9`  
**Preserved checkpoint:** `phase-1-stage-5-final-9-rejected`  
**Stage 6 actions:** `0`

## Candidate integrity independently checked before semantic review

Three separately dispatched, read-only reviewers verified the same FINAL-9 frozen candidate before their assigned semantic lanes:

| Property | Verified value |
|---|---|
| Freeze | `docs/reviews/phase-1-m1/STAGE_5_FINAL_9_CANDIDATE_FREEZE.md` |
| Freeze SHA-256 | `641b05029e8888c529b01fe0e5805d4ae083a46b544bb1bdfcf1756e8126a33a` |
| Frozen input rows | `453 / 453`, no mismatches |
| Input aggregate SHA-256 | `7acdfaa29d3cf24c632fa854389554900a10d7656d42f62a0875056210dba34e` |
| Evidence index | `docs/evidence/phase-1-m1/stage-5-final-9/EVIDENCE_INDEX.json` |
| Evidence-index SHA-256 | `70118b0890d7c73fd9654c522d2d077930a6d23273f22cbb126d9a45d02284f7` |
| Indexed evidence | `16 / 16`, no mismatches |
| Evidence aggregate SHA-256 | `0e61ffbda493b5cc18cd769b5d5b3352da54713898270948617a70bb4ceabc9f` |
| Authoritative CI receipt | `PASS`, invocation count `1`, Node `24.19.0`, Corepack `0.35.0`, pnpm `11.21.0` |
| FINAL-9 post-freeze scan | `PASS`, 454 files |

The reviewers made no source, evidence, tag, or configuration changes and did not run formatters or generators.

## Independent review lanes and outcome

The delegated reviewers were isolated from the authoring work and reported their own read-only findings. Their lane-local `GO` recommendations mean that lane found no open BLOCKER/HIGH after recording its own residual MEDIUM issue; they are **not** a Stage 5 closure decision.

| Lane | Recommendation | Closure relevance |
|---|---|---|
| Security/API/governance | `GO` for that lane only | One open MEDIUM required correction under the Stage 5 closure workflow. |
| Data/domain/PostgreSQL | `GO` for that lane only | One open MEDIUM required correction under the Stage 5 closure workflow. |
| Evidence/provenance/closure | `NO-GO` | Correctly identified that the FINAL-9 validation/matrix still left all 45 carried findings pending independent adjudication. |

The combined Stage 5 decision for FINAL-9 is therefore **NO-GO**. A frozen candidate is not eligible for closure merely because its integrity and author-side CI evidence pass.

## New FINAL-9 findings carried to FINAL-10

### S5F9-SEC-001 — MEDIUM — Portal API-wide exact Host boundary missing

- **Affected FINAL-9 paths:** `apps/portal-api/src/app.ts`, `apps/portal-api/src/auth-bridge.ts`, `apps/portal-api/src/health.controller.ts`.
- **Independent evidence:** FINAL-9 installed Host validation only within auth/session bridge paths. The liveness route could answer on an unapproved Host without entering that bridge.
- **Scenario / consequence:** An unapproved Host can reach a routable Portal endpoint. The observed response was limited to health metadata, but it violates the independent exact-Host API boundary expected before routing.
- **Required FINAL-10 correction:** install first-position Portal Host validation before body parsing and routing, reject missing/duplicate/conflicting Host input with unbranded private/no-store response, and test wrong-Host health, malformed-body, and auth paths.

### S5F9-DATA-DEADLOCK-HTTP-E2E-001 — MEDIUM — real PostgreSQL deadlock-to-HTTP composition gap

- **Affected FINAL-9 paths:** `packages/database/src/trip-operations/m1-operational-slice-repository.ts`, `tests/integration/stage-5-postgresql.test.ts`, `apps/admin-api/src/m1-routes.ts`, `apps/admin-api/test/m1-routes.test.ts`.
- **Independent evidence:** the real PostgreSQL deadlock test asserted SQLSTATE `40P01` and repository mapping; the route test asserted `M1TransactionConflictError` maps to HTTP 409 using an injected typed error. No test passed an actual PostgreSQL-originated `40P01` error object through repository and HTTP composition in one flow.
- **Scenario / consequence:** A composition or wiring regression could leave the separate tests green while a live deadlock reaches HTTP as a different failure.
- **Required FINAL-10 correction:** qualify a real PostgreSQL-originated `40P01` through the repository and registered HTTP route, asserting the documented `409 {"error":"transaction_conflict"}` contract and private/no-store response.

### S5F9-EVID-CLOSURE-001 — HIGH — FINAL-9 closure gate pending

- **Affected FINAL-9 paths:** `docs/reviews/phase-1-m1/STAGE_5_FINAL_9_CANDIDATE_VALIDATION.md`, `docs/reviews/phase-1-m1/STAGE_5_FINAL_9_CORRECTION_MATRIX.json`.
- **Independent evidence:** FINAL-9 itself declared all 45 carried findings pending independent adjudication and explicitly stated that candidate validation was not closure or GO.
- **Scenario / consequence:** Treating verified hashes or author-side CI as a final Stage 5 decision would bypass independent finding adjudication, including prior HIGH findings.
- **Required FINAL-10 correction / gate:** preserve FINAL-9, remediate the two MEDIUM technical findings, regenerate all qualification/evidence/freeze artifacts for FINAL-10, and obtain a fresh independent read-only review that adjudicates every carried and new finding.

## Disposition and lineage policy

1. FINAL-9 remains exactly preserved under the rejected checkpoint tag; it is historical evidence, not a live closure candidate.
2. The 45 FINAL-8-derived findings remain independent-review lineage. Author-side changes and this transcription do not close them.
3. FINAL-10 must include all 45 original IDs plus `S5F9-SEC-001`, `S5F9-DATA-DEADLOCK-HTTP-E2E-001`, and `S5F9-EVID-CLOSURE-001` in its correction matrix and submit them to a fresh independent read-only review.
4. FINAL-10 must keep Stage 4 closed and Stage 6 action count at `0`.
