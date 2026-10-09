# TravelOS Phase 1 M1 — Stage 5 FINAL-13 candidate validation

- **Candidate:** FINAL-13, successor to the immutable rejected FINAL-12 candidate.
- **Status:** author qualification **PASS**; ready for deterministic freeze and independent read-only review. This is **not** Stage 5 closure or GO.
- **Stage 6 actions:** `0`.
- **Authoritative CI:** exactly one `corepack pnpm ci:verify` invocation, PASS (`exitCode: 0`), 2026-10-06 13:50:31.268Z–13:53:21.089Z.
- **Toolchain:** Node `v24.19.0`, Corepack `0.35.0`, pnpm `11.21.0`.

## Baseline and generation order

The FINAL-13 runner/script references and the protected candidate bytes (`package.json` and the Stage 5 implementation document) were finalized before the security-extension baseline captured its ten protected paths. No protected path changed after capture. The generated baseline hash was then pinned in the verifier; remaining verification/test-harness adjustments were outside the ten-file protected manifest and were finalized, linted, formatted, and exercised in the GREEN readiness/CI gates. The baseline verifier checked the FINAL-13 runner binding against the final runner bytes.

- Baseline: `docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json`
- Baseline SHA-256: `2fb65b6fa0d14875f9c756496f75b2b9fed3a446409295f5bdff46e5deae70cb` (9,348 bytes; 10 protected paths).
- Previous Phase 1 baseline SHA-256: `9fdab6bd8c88c33ad492ca97ba294041b8754e4c465b95ef05a4f71e4d21893a`.
- Intentional protected deltas only: `package.json` and `docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md`.
- Baseline-generation receipt: `docs/evidence/phase-1-m1/stage-5-final-13/baseline-generation.json` (`PASS`); it records the previous baseline and FINAL-12 failed-CI lineage.
- The focused baseline verifier checked expected protected paths, exact hashes, Phase 0 and prior Phase 1 lineage/history, package script hash, FINAL-13 runner binding, missing/extra/duplicate paths, and unauthorized drift. Verification and baseline tests passed in the readiness preflight and authoritative CI.
- Phase 0 accepted baseline remains at SHA-256 `bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb` (40 entries); `docs/PERMISSIONS.md` remains `ad036b8647f4482bc5e59bff09e5adbf653a4d3ed3994a20cd5b201d104ea1d9`.

## Readiness and authoritative execution

The pre-CI readiness report is `docs/evidence/phase-1-m1/stage-5-final-13/readiness-preflight.json`. It records GREEN readiness, including full `format:check`, full `lint`, baseline generation/verification, candidate lineage, source-scope coverage, and sensitive-data scan. The immutable invocation guard records candidate, commit/working-tree hashes, toolchain, package/baseline/runner hashes, migration head, canonical command, and Stage 6 count.

| Evidence | Result / identity |
|---|---|
| Invocation guard | `.hermes/state/stage5-final13-ci-verify-invocation.json`; one FINAL-13 authorization, consumed by the recorded invocation |
| Exact command | `corepack pnpm ci:verify` |
| CI receipt | `docs/evidence/phase-1-m1/stage-5-final-13/ci-verify-execution.json`; SHA-256 `66b106aa99e22f19b0c5eda2282fac97217deac911077130c0f537bdcc4e8779` |
| Complete CI log | `docs/evidence/phase-1-m1/stage-5-final-13/ci-verify.log`; 324,910 bytes; SHA-256 `f014f4c7559003a0374118d4170ef9817fdf4c3db340650b23bb4e02992ced76` |
| Evidence index | `docs/evidence/phase-1-m1/stage-5-final-13/EVIDENCE_INDEX.json`; 54 artifacts; independently verified; SHA-256 `3896d13368b2688c583357f806cc79b62c06c20d6f9b7c4998c559d035eeb7f8`; aggregate SHA-256 `2bfc4592b04df786e49a883f65473e433dfb5be0235e6a7b8efac1cceafaf336` |
| Git commit at invocation | `27184b598ae2be2eaf35616d4a9b6c2e623ccd42` |

The receipt records 1 invocation, `PASS`, exit code `0`, and the pinned toolchain versions. No second FINAL-13 CI invocation was made.

## Final evidence and security scan

The independently verified FINAL evidence index records the exact indexed bytes and aggregate using sorted, newline-terminated `relative-path<TAB>bytes<TAB>sha256` records. It retains FINAL-10, FINAL-11, and FINAL-12 rejection evidence and lineage without rewriting any consumed CI receipt or guard.

A post-CI final-evidence source scan was run after the FINAL index existed:

- Report: `docs/evidence/phase-1-m1/final13-scan-reports/STAGE_5_FINAL_13_PREVALIDATION.json`
- SHA-256: `61483758786a2d2c5460ee8f53c66dd5f22dd1ae3d0f18ccbe794d9e9de1feaa` (160,870 bytes)
- Scope: repository-owned source plus final Stage 5 evidence and review.
- Phase: `FINAL_EVIDENCE`; scanned 633 files; result `PASS`; findings `0`.

A further read-only final-evidence scan is required after the validation and freeze documents exist so those final review inputs are included in the scanned scope. Its receipt is kept under the same `post-freeze-scan-reports/` directory, outside the Stage 5 indexed artifact directory.

## Historical findings and independent review gate

`docs/reviews/phase-1-m1/STAGE_5_FINAL_13_CORRECTION_MATRIX.json` has 48 carried finding IDs. It records 0 author-closed, 48 pending independent adjudication, and 3 prior-generation CI failures pending review. The author does not close findings. The independent reviewer must verify the frozen bytes first and adjudicate every carried finding with file-level evidence.

FINAL-10 remains `REJECTED / CI CONSUMED / PRE-GATE FAILURE`; its baseline-generation consistency failure was caused by the protected `package.json` hash becoming stale before CI. FINAL-11 remains rejected after its sole CI run failed at `format:check`. FINAL-12 remains rejected after its sole CI run failed at `lint`. All failed generations, guards, logs, receipts, indexes, and snapshots remain preserved.

## Candidate decision

FINAL-13 is eligible for deterministic freeze and a fresh independent read-only review only. It is not yet an independent GO, Stage 5 closure, deployment authorization, or Stage 6 start. No Stage 6 action has occurred.
