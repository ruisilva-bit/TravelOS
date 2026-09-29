# TravelOS Phase 1 M1 — Stage 3 Corrected Independent Closure

- **Closure timestamp (Europe/Lisbon):** `2026-09-16T09:11:48+01:00`
- **Reviewed candidate:** `docs/reviews/phase-1-m1/STAGE_3_CORRECTED_CANDIDATE_FREEZE.md`
- **Independent review output:** `docs/reviews/phase-1-m1/STAGE_3_CORRECTED_INDEPENDENT_REVIEW.json`
- **Closed findings:** `TOS-S3-001`, `TOS-S3-002`
- **Residual findings:** BLOCKER 0, HIGH 0, MEDIUM 0, LOW 1, NOTE 0
- **Stage 4 actions:** 0
- **Final decision:** **GO — STAGE 3 CLOSED**

## 1. Closure authority and limits

This report closes only the Phase 1/M1 Stage 3 PostgreSQL foundation correction cycle. It does not start or implement Stage 4, authorize production deployment, approve production credentials or secret storage, authorize production DR/PITR, or repeat accepted PostgreSQL qualification work.

The historical rejected Stage 3 freeze remains an immutable audit record. The corrected candidate was frozen separately and independently reviewed from an exact read-only snapshot.

## 2. Candidate identity and deterministic verification

| Property | Independently reviewed result |
|---|---:|
| Corrected freeze bytes | 44,636 |
| Corrected freeze SHA-256 | `a973ccc403844bd7e6dc10610117965af761abe1c3197d3ee1f3b9b2ad1ed9d7` |
| Declared / parsed / matched rows | 324 / 324 / 324 |
| Missing rows | 0 |
| Mismatched rows | 0 |
| Duplicate rows | 0 |
| Unexpected rows | 0 |
| Self-reference rows | 0 |
| Deterministic aggregate | `a7e6b0fa84f62c5eca6e87894d95a32c9918b02d618bca5f241e5603d7a57d8f` |

The reviewer recomputed every row from the snapshot at `/tmp/travelos-stage3-corrected-review`. The snapshot contained the 324 declared files plus the self-excluded corrected freeze manifest, with no missing or unexpected files.

The historical rejected freeze remains unchanged:

- path: `docs/reviews/phase-1-m1/STAGE_3_CANDIDATE_FREEZE.md`;
- bytes: 41,784;
- SHA-256: `466693ee8b1ee7a6e36dd630f4484da66c4af0154c5a913ce421f52f4a6fa388`;
- entries: 304;
- deterministic aggregate: `df92cdd61e5ab38b9587c9ec7aae964807b616c651c9973cf8bd1a1cd06a2655`.

It was not rewritten or reused as the corrected candidate.

## 3. Independent reviewer execution

The valid review was performed by a separate Hermes leaf reviewer using the supported `openai-codex` / `gpt-5.6-sol` configuration after the earlier unsupported-model and exhausted-provider attempts had produced no review result.

The valid reviewer:

- worked only inside `/tmp/travelos-stage3-corrected-review`;
- made 27 tool/API calls over approximately 512 seconds;
- independently recomputed the corrected freeze and evidence index;
- read the governing product, domain, security, ADR, implementation, SQL, source, tests, CI and evidence files;
- performed only read-only local checks;
- did not modify the snapshot or repository;
- did not contact CT 200 or alter PostgreSQL, services, credentials, firewall, DNS, TLS or application state;
- returned `filesCreatedOrModified: []`.

The reviewer output is preserved verbatim in `STAGE_3_CORRECTED_INDEPENDENT_REVIEW.json` and is intentionally outside the 324 reviewed freeze inputs.

The raw reviewer output labels the historical severity of `TOS-S3-001` as `MEDIUM` in one summary field. The authoritative rejected finding and correction evidence classify it as `HIGH`; this closure preserves that original severity. The reviewer’s `CLOSED` disposition and decision rationale are unaffected.

## 4. Finding dispositions

### `TOS-S3-001` — original severity HIGH — CLOSED

The reviewer confirmed from exact frozen source and tests that:

- Admin API is fixed to `travelos_admin_api`;
- Portal API is fixed to `travelos_portal_api`;
- Worker is fixed to `travelos_worker`;
- workload credential references are pairwise distinct;
- the runtime invariant also prevents reuse with the migration credential reference;
- checked-in JSON Schema, generated schema and runtime validation remain aligned;
- positive and adversarial tests reject swapped, owner, migrator, capability-group and reused-credential cases.

Primary reviewed evidence:

- `packages/config/src/instance-manifest.ts`;
- `packages/config/src/instance-manifest-invariants.ts`;
- `packages/config/src/instance-manifest-json-schema.ts`;
- `packages/config/test/instance-manifest.test.ts`;
- `packages/config/test/instance-manifest-json-schema.test.ts`;
- `deploy/manifests/schema/instance-manifest.schema.json`;
- `docs/evidence/phase-1-m1/stage-3/correction-tos-s3-001.json`.

### `TOS-S3-002` — original severity MEDIUM — CLOSED

The reviewer confirmed from exact frozen source, SQL, tests and focused evidence that:

- the shared role graph contains exactly four expected edges;
- every edge records exact `ADMIN`, `INHERIT` and `SET` options;
- catalog queries include memberships where either endpoint is a protected TravelOS role;
- bootstrap SQL and the shared graph definition remain aligned;
- missing, unexpected, duplicate and option-mutated graphs fail closed;
- adversarial external-to-TravelOS edges are rejected while wholly unrelated edges remain out of scope;
- focused CT evidence reports expected/actual 4/4, missing 0, unexpected 0 and duplicates 0;
- temporary access cleanup passed.

Primary reviewed evidence:

- `tooling/database/stage-3-role-graph.ts`;
- `deploy/database/bootstrap-database-and-roles.sql`;
- `tooling/database/verify-stage-3-ct-role-graph.ts`;
- `tooling/database/verify-stage-3-corrections.ts`;
- `tests/integration/stage-3-postgresql.test.ts`;
- `docs/evidence/phase-1-m1/stage-3/correction-tos-s3-002.json`;
- `docs/evidence/phase-1-m1/stage-3/ct-200-focused-role-topology.json`;
- `docs/evidence/phase-1-m1/stage-3/ct-200-focused-access-cleanup.json`.

## 5. Definitive corrected evidence

| Property | Result |
|---|---:|
| Evidence artifacts | 33 |
| Declared / parsed / matched | 33 / 33 / 33 |
| Missing / unexpected / duplicate | 0 / 0 / 0 |
| Invalid paths | 0 |
| Size mismatches | 0 |
| Hash mismatches | 0 |
| Index SHA-256 | `93148f2946627d92a0098ccf2d4b513fc15d24448f75a50a2d794748b227e7d6` |
| Evidence aggregate | `fa283626f8e5d3c9bbe7cab312a589fb94be4f78ded19c4a5e3744941bc7cf26` |

The bundle retains the original accepted Stage 3 operational evidence and adds bounded correction, focused CT, final CI and sensitive-data-scan artifacts.

## 6. Regression and security gates

The final repository regression used:

- Node.js `24.19.0`;
- Corepack `0.35.0`;
- pnpm `11.21.0`.

`pnpm run ci:verify` completed all 20 configured gates with exit code 0, including format check, lint, typecheck, architecture checks, unit tests, schema parity, correction verification, freeze-input tests, scanner tests, rejected-technology checks, source scan, production build, five-deployable smoke testing, browser-bundle scan, and protected Phase 0 baseline verification before and after at 40/40.

The retained CI log is 118,769 bytes with SHA-256 `e0bc06a0fc5228de7dc3c2552647f6d64ac5972dc957862a8b8135e0eed027a4`.

## 7. Residual finding

### `TOS-S3-003` — LOW — OPEN, NON-BLOCKING

The named `--stage3-corrected-frozen` sensitive-data scan mode selects 323 files rather than the corrected manifest’s exact 324 input rows. It omits:

- `docs/evidence/phase-1-m1/stage-2/EVIDENCE_INDEX.json`;
- `docs/reviews/phase-1-m1/STAGE_2_CORRECTED_CANDIDATE_VALIDATION.md`.

It additionally scans the self-excluded corrected freeze manifest. The independent reviewer separately scanned the exact 324 manifest-row files and obtained PASS with findings 0 and allowlisted findings 0. The two omitted files were also scanned directly with findings 0. Therefore this is an automation/set-equality defect, not evidence of secret exposure, and remains LOW.

Required follow-up before relying on that named mode as an exact-freeze assertion:

1. derive the scan set from verified corrected-freeze rows or the corrected collector;
2. preserve self-exclusion semantics;
3. add an exact set-equality test before reporting PASS.

Correcting this LOW finding would change frozen tooling and therefore belongs to a future separately frozen change; it does not reopen this Stage 3 closure under the declared `BLOCKER=0` and `HIGH=0` gate.

## 8. DEVELOPMENT systemd credential disposition

The reviewer accepted the systemd credential state only for synthetic DEVELOPMENT CT 200:

- four credential files recorded at mode `0600`;
- runtime injection: PASS;
- captured credential values: none;
- LXC machine-secret backing storage: not encrypted.

This is not production approval. Production remains blocked pending encrypted, access-separated secret backing and production-grade validation.

## 9. Stage boundary

- review-time CT actions: 0;
- Stage 4 actions: 0;
- repeated bootstrap runs: 0;
- repeated migration runs: 0;
- repeated backup/restore runs: 0;
- repeated privilege-matrix runs: 0;
- application deployment: 0;
- firewall, DNS, TLS or public-exposure changes: 0.

No Stage 4 domain objects, authentication implementation, application deployment or production operational claim is part of this closure.

## 10. Closure gate

The corrected freeze and definitive evidence index pass exact verification. `TOS-S3-001` and `TOS-S3-002` are independently CLOSED. Residual counts are:

- BLOCKER: **0**;
- HIGH: **0**;
- MEDIUM: **0**;
- LOW: **1**;
- NOTE: **0**.

The mandatory closure predicates are satisfied: corrected freeze PASS, definitive evidence PASS, both rejected findings CLOSED, Stage 4 actions 0, BLOCKER 0 and HIGH 0.

# GO — STAGE 3 CLOSED
