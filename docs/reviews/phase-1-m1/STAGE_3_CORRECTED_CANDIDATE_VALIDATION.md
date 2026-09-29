# TravelOS Phase 1 M1 — Stage 3 Corrected Candidate Validation

- **Status:** Author corrections verified; independent non-authoring closure required
- **Corrected findings:** `TOS-S3-001`, `TOS-S3-002`
- **Historical rejected freeze:** `docs/reviews/phase-1-m1/STAGE_3_CANDIDATE_FREEZE.md`, SHA-256 `466693ee8b1ee7a6e36dd630f4484da66c4af0154c5a913ce421f52f4a6fa388`, 41,784 bytes, 304 entries
- **Excluded scope:** Stage 4 authentication, authorization, Agency/domain records, business APIs, application deployment, and UI behavior
- **Stage 4 actions:** **0**

## Correction dispositions

| Finding | Author disposition | Final proof |
|---|---|---|
| `TOS-S3-001` — HIGH | **CORRECTED — PENDING INDEPENDENT CLOSURE** | `docs/evidence/phase-1-m1/stage-3/correction-tos-s3-001.json` |
| `TOS-S3-002` — MEDIUM | **CORRECTED — PENDING INDEPENDENT CLOSURE** | `docs/evidence/phase-1-m1/stage-3/correction-tos-s3-002.json` |

The author does not self-close either finding. Only the independent reviewer of the exact corrected freeze may mark them `CLOSED` or `OPEN`.

## `TOS-S3-001` verification

The final manifest contract requires the exact runtime database identities:

- Admin API: `travelos_admin_api`;
- Portal API: `travelos_portal_api`;
- Worker: `travelos_worker`.

The consolidated verifier accepted the valid manifest, rejected 11 swapped or privileged identity cases, rejected all four duplicate credential-reference shapes, confirmed pairwise-distinct credential references, confirmed generated JSON Schema/runtime identity parity, and confirmed runtime-only invariant `TOS-CONFIG-RUNTIME-005` is active.

Result: **PASS — CORRECTED, PENDING INDEPENDENT CLOSURE.**

## `TOS-S3-002` verification

The shared role-graph contract requires exactly four edges and all `ADMIN`, `INHERIT`, and `SET` options. Its query scope is `BIDIRECTIONAL_EITHER_ENDPOINT_IS_TRAVELOS`.

The consolidated verifier and focused PostgreSQL fixtures rejected four malicious external/internal edges, a missing edge, a duplicate edge, and three option mutations. A wholly unrelated non-TravelOS edge remained outside scope. Bootstrap SQL and shared expected-graph definition parity passed.

Result: **PASS — CORRECTED, PENDING INDEPENDENT CLOSURE.**

## Focused CT 200 verification

The authorized read-only catalogue query against DEVELOPMENT CT 200 observed the exact graph:

- expected/actual edges: 4/4;
- missing: 0;
- unexpected: 0;
- duplicate: 0;
- query catalogues: `pg_catalog.pg_auth_members`, `pg_catalog.pg_roles`;
- database, role/membership, schema, and service mutations: 0;
- repeated bootstrap, migration, backup/restore, and privilege-matrix runs: 0.

Temporary access cleanup passed. The authorized-key entry was removed, reauthentication was denied as expected, and all seven local temporary access/transport artefact paths were verified absent.

Evidence:

- `docs/evidence/phase-1-m1/stage-3/ct-200-focused-role-topology.json`;
- `docs/evidence/phase-1-m1/stage-3/ct-200-focused-access-cleanup.json`.

## Final repository regression

The qualified toolchain is Node `24.19.0`, Corepack `0.35.0`, and pnpm `11.21.0`. The retained final CI report records `pnpm run ci:verify` exit 0 with all 20 gates completed, including format check, lint, typecheck, architecture, unit tests, correction verification, security checks, build, smoke tests, and protected Phase 0 baseline checks at 40/40 before and after.

No CT qualification, backup/restore, migration, or Stage 4 operation was repeated by this repository regression.

Evidence:

- `docs/evidence/phase-1-m1/stage-3/correction-ci-verify.json`;
- `docs/evidence/phase-1-m1/stage-3/correction-ci-verify.log` — 118,769 bytes, SHA-256 `e0bc06a0fc5228de7dc3c2552647f6d64ac5972dc957862a8b8135e0eed027a4`.

## Definitive corrected evidence bundle

The corrected bundle retains the original 26 accepted Stage 3 operational artifacts and adds seven bounded correction/CI/CT/scan artifacts.

- Index: `docs/evidence/phase-1-m1/stage-3/EVIDENCE_INDEX.json`.
- Artifact count: 33.
- Declared/parsed/matched: 33/33/33.
- Missing, unexpected, duplicate, invalid, size-mismatch, and hash-mismatch paths: 0.
- Index SHA-256: `93148f2946627d92a0098ccf2d4b513fc15d24448f75a50a2d794748b227e7d6`.
- Deterministic aggregate: `fa283626f8e5d3c9bbe7cab312a589fb94be4f78ded19c4a5e3744941bc7cf26`.

The pre-index sensitive-data scan passed with zero findings and emitted no matched values. This corrected validation and the later freeze are each subject to a subsequent read-only expanded-scope scan; no scan result is self-certified by modifying the bytes it has just scanned.

## Historical integrity and expected live divergence

The rejected freeze document remains unchanged. Its 304-row candidate was separately verified in `/tmp/travelos-stage3-frozen-review` before correction. Its manifest is expected to diverge from corrected live files and is not reused as the corrected candidate.

The accepted Stage 2 predecessor freeze and closure retain their fixed SHA-256 values:

- `5f2e686c397e7bf9f81b455456e1088cb3c4a897e55e43cd1c09c83fde4ea122`;
- `d4171545ee53a34791814d4cddf49080e06f5f0eab131954c3f8ed9baa13ef81`.

The accepted Phase 0 baseline remains 40/40 with missing 0 and mismatches 0.

## systemd credential disposition

Four encrypted runtime credential files remain on DEVELOPMENT CT 200 with mode `0600`; runtime injection passed and no values were captured. LXC machine-secret backing material is not on encrypted storage. This is accepted by the author only as a DEVELOPMENT limitation and is not approval of a production secret-storage design. The independent reviewer must adjudicate the disposition.

## Stage boundary and author decision

No firewall, DNS, TLS, public exposure, application deployment, authentication implementation, domain schema, production credential, production DR/PITR, or Stage 4 action is authorized or performed by this correction.

All author-side correction, regression, evidence-integrity, CT read-only, cleanup, and boundary gates represented above pass. The corrected candidate is ready for deterministic corrected freeze and independent adversarial review.
