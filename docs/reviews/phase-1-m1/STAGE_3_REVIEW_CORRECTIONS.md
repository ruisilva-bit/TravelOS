# TravelOS Phase 1 M1 — Stage 3 review corrections

Status: **CORRECTED — PENDING INDEPENDENT CLOSURE**

This matrix records author corrections against the independent review of `STAGE_3_CANDIDATE_FREEZE.md`. The rejected freeze remains immutable at SHA-256 `466693ee8b1ee7a6e36dd630f4484da66c4af0154c5a913ce421f52f4a6fa388`, 41,784 bytes, 304/304 rows matched, aggregate `df92cdd61e5ab38b9587c9ec7aae964807b616c651c9973cf8bd1a1cd06a2655`. This document cannot self-close either finding, authorize Stage 4, or constitute independent closure.

## Correction matrix

| Finding | Severity | Reproduction | Root cause | Intended correction | Required proof | Status |
|---|---|---|---|---|---|---|
| `TOS-S3-001` | HIGH | Confirmed: the frozen manifest used one generic TravelOS role-name pattern for every runtime process and did not require pairwise-distinct credential references. | The trust boundary validated role-name shape but not process identity or credential-reference separation. | Require Admin → `travelos_admin_api`, Portal → `travelos_portal_api`, Worker → `travelos_worker`; require pairwise-distinct credential references; preserve JSON Schema/runtime-invariant parity. | `docs/evidence/phase-1-m1/stage-3/correction-tos-s3-001.json`: valid exact identities, 11 invalid-role cases and four duplicated-reference cases rejected, schema/runtime parity PASS, `TOS-CONFIG-RUNTIME-005` active. | **CORRECTED — PENDING INDEPENDENT CLOSURE** |
| `TOS-S3-002` | MEDIUM | Confirmed: frozen bootstrap and CT/disposable topology queries constrained only the membership member side, so external-role → TravelOS-role edges escaped the exact-graph check. | Role topology was represented in duplicated one-directional queries rather than one shared bidirectional exact-graph definition. | Introduce a shared expected graph and bidirectional membership query; make bootstrap fail closed when either endpoint is a TravelOS role; prove SQL/shared-definition parity. | `docs/evidence/phase-1-m1/stage-3/correction-tos-s3-002.json` plus focused CT evidence: exact 4/4 bidirectional graph; malicious, missing, duplicate and option-mutated graphs rejected; unrelated external edge ignored. | **CORRECTED — PENDING INDEPENDENT CLOSURE** |

## Immutable boundaries

- The rejected `STAGE_3_CANDIDATE_FREEZE.md` will not be edited or overwritten.
- Accepted Stage 2/Phase 0 predecessors remain protected.
- Migrations, broader ACLs, network exposure, production secret storage, deployment, and Stage 4 are outside this correction.
- Only a later independent reviewer may close `TOS-S3-001` and `TOS-S3-002` against the corrected freeze.
