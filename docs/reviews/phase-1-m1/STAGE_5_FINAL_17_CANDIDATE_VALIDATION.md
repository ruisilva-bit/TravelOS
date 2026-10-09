# TravelOS Phase 1 M1 — Stage 5 FINAL-17 candidate validation

- **Candidate:** FINAL-17, sequential successor to rejected FINAL-16.
- **Author validation:** PRE-CI checks and canonical CI passed; FINAL_CANDIDATE source-scope gate failed. FINAL-17 is **REJECTED BEFORE FREEZE** and is not eligible for independent review or Stage 5 closure.
- **Stage 6 actions:** `0`.

## Protected baseline and pre-CI gate

Candidate scripts, runners, package metadata, evidence tooling, and protected governance inputs were finalized before generation of the FINAL-17 security-extension baseline. The baseline was verified read-only before preflight; the protected inputs were not changed after generation.

- Active baseline: `docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json`.
- FINAL-17 baseline SHA-256: `7378975380066e296df1f4617b2771d104a0697e87480f217638bdbe030b1802`; 12 protected paths.
- Previous Phase 1 baseline (FINAL-16): SHA-256 `a9ac910fc6275da9b3c957a6c280fa8eeb4b5bc03a383d935f08dde2662cdab5`.
- Baseline-generation receipt: `docs/evidence/phase-1-m1/stage-5-final-17/baseline-generation.json`; PASS; SHA-256 `8700d8202d5ddfca7a4f365527a8a7e647ed81b84b3f869accb61136a7c94cd7`.
- Pre-CI readiness: PASS; `docs/evidence/phase-1-m1/stage-5-final-17/readiness-preflight.json`; SHA-256 `612c833f96c5a9e2cd86be97d8f09a7cce9ce99b28c4d1e1fc5299710c82a037`.
- Pre-CI freeze guard: `.hermes/state/stage5-final17-pre-ci-freeze-guard.json`; SHA-256 `da7dd5669c95c54073674789a6c786d394b22b344aeb5be3fa6840f46662ae34`.
- Post-guard verification matched the captured tracked diff and untracked-file snapshot (excluding the guard created by that operation), candidate hashes, evidence index, migration head/checksum, and pinned toolchain. The CI invocation guard subsequently recorded the exact worktree snapshot and candidate inputs.
- Migration head: `0010_stage5_temporal_persistence_parity.cjs`; migration SHA-256 `d7961fbf06cda8b222fd1219de6d9aec85a0205fb1d186e809260d579c598030`; checksum-manifest SHA-256 `ff717238a33a7f83ee5668fce56ea7d09a4a9a446075c0ef7500f14a65c6c522`.
- Pinned toolchain: Node `v24.19.0`; Corepack `0.35.0`; pnpm `11.21.0`.

## Focused and PostgreSQL qualification

- Focused qualification: PASS; 65 tests across 14 files. Receipt `docs/evidence/phase-1-m1/stage-5-final-17/focused-test-execution.json`; SHA-256 `eb9a0eeb4b0db4c85258188e8df4742d15c79eb72dbbbe3a317dc2da61018302`.
- Disposable PostgreSQL qualification: PASS; 29 integration tests. Execution receipt `postgresql-qualification-execution.json`; SHA-256 `33ba9872fd7d11f0ebf2e975deaee443e74189af3332b295ea507212e3cc4464`.
- PostgreSQL runtime was pinned to the disposable loopback qualification; cleanup passed, disposable root absent, and zero PostgreSQL data directories or package archives were retained. Cleanup receipt `postgresql-disposable-cleanup.json`; SHA-256 `fcb09fce5b5e324eae0be6544eb0cf5cb88c60afeab4eb79a8e877bf01702efe`.

## Single authorized CI execution

The canonical command started exactly once after all preflight checks were green:

| Evidence | Result / identity |
|---|---|
| Invocation guard | `.hermes/state/stage5-final17-ci-verify-invocation.json`; SHA-256 `a6e5d8e23498936691747f56153196e23c375e5521fb13c446cca982fd6cc6fb`; state `CONSUMED`; invocation count `1` |
| Exact command | `corepack pnpm ci:verify` |
| Toolchain | Node `v24.19.0`; Corepack `0.35.0`; pnpm `11.21.0` |
| Execution interval | `2026-10-08T10:31:16.440Z`–`2026-10-08T10:34:27.598Z` |
| CI execution receipt | `docs/evidence/phase-1-m1/stage-5-final-17/ci-verify-execution.json`; SHA-256 `adfa16042dbf7603ac743f660b49ea1afdb879a1477b7410fed41e25f7a535cc`; PASS; exit `0`; one invocation |
| Complete CI log | `ci-verify.log`; 634,727 bytes; SHA-256 `72dba7387ff20879533847197bdd7f16bb9358e8f6add2c4fde57cec40e48a92`; 27 gates started, 27 passed, 0 failed |

The primary `ci:verify` child completed PASS. The outer evidence wrapper then exited `1` while writing/verifying the FINAL evidence index: it called `writeStage5Final17EvidenceIndex` without the authoritative `ciVerify` result, so the generated index claimed `NOT_RUN` and its verifier rejected the mismatch. The original CI execution receipt and complete CI log were not changed. The failed index attempt is preserved at `.hermes/state/stage5-final17-invalid-final-index-attempt.json` (SHA-256 `c33a01a4fce38f9c8ffa21e440873f6ac4c097f0ae2f6b18f199206997fc8317`); the wrapper failure receipt/log are `.hermes/state/stage5-final17-post-ci-finalization-failure.json` and `.hermes/state/stage5-final17-post-ci-finalization-failure.log`. Evidence finalization used the existing index writer with the explicit, receipt-derived values `invocationCount=1`, `result=PASS`, `exitCode=0`. No source, runner, baseline, or CI receipt was edited after CI. FINAL-17's CI authorization is consumed and must not be retried.

## Final evidence index and security scan

- FINAL evidence index: `docs/evidence/phase-1-m1/stage-5-final-17/EVIDENCE_INDEX.json`; 458 artifacts; SHA-256 `240013b0927a9083f744c48983c619b8aa2379e1f14c995259009acd1169e4e6`; aggregate SHA-256 `0dcd6b167b0fb1795c4efd2688c603058f419a932177c7ec3a0bdcdd04bcccd4`.
- Read-back verification: PASS; declared/matched `458/458`; missing `0`; hash mismatches `0`; size mismatches `0`; duplicates `0`; unexpected artifacts `0`; predecessor lineage verified.
- FINAL_EVIDENCE source/security scan after the FINAL index: PASS; 1,573 files scanned; 0 findings; `matchedValuesEmitted=false`; Stage 6 actions `0`. Scope aggregate SHA-256 `f87b406083c6d49daf8c2d9f73468260041e5e9a7e13865422b569941e2bd1db`. Captured scan output: `.hermes/state/stage5-final17-post-ci-evidence-source-scan.json`.
- The FINAL_CANDIDATE scan that would include this validation and a valid deterministic freeze was not run because source-scope collection failed; no post-freeze scan receipt exists for FINAL-17.

## Historical findings and generation lineage

- FINAL-17 finding-lineage receipt: PASS; 49 carried findings; 0 author-closed; 49 pending independent adjudication. The correction matrix records 6 evidence-supported corrections, 5 open, and 38 unverified; these are author-side classifications only. Receipt `finding-lineage.json`; SHA-256 `15b2ba5e1624974a13ad0833f64b4c9f44f99e4b03e435d6b76dc6668f120b1d`.
- The exact predecessor evidence indexes and historical artifacts are verified by the FINAL-17 evidence index and lineage checks. They preserve FINAL-8's rejected independent review, FINAL-10's consumed CI failure, subsequent rejected/pre-CI and CI generations, and FINAL-16's rejected-before-CI evidence. FINAL-16's indexed history remains unchanged.
- The correction matrix classifies the inherited review IDs for independent adjudication only; author-side classification is not closure proof. No historical finding is closed by this validation.

## Candidate decision

FINAL-17's single canonical CI execution passed, and its FINAL evidence index verifies. However, `collectStage5SourceFiles({ phase: "FINAL_CANDIDATE" })` failed closed because it requires absent FINAL-15 and FINAL-16 candidate-validation/freeze documents. Those generations were rejected before a candidate freeze existed; creating files under those names now would fabricate historical artifacts. The collector reported missing inputs `STAGE_5_FINAL_15_CANDIDATE_VALIDATION.md`, `STAGE_5_FINAL_15_CANDIDATE_FREEZE.md`, `STAGE_5_FINAL_16_CANDIDATE_VALIDATION.md`, and `STAGE_5_FINAL_16_CANDIDATE_FREEZE.md`; all expected evidence indexes were present. The exact failure receipt/log are `.hermes/state/stage5-final17-final-candidate-scope-failure.json` and `.hermes/state/stage5-final17-final-candidate-scope-failure.log`.

The file currently at `STAGE_5_FINAL_17_CANDIDATE_FREEZE.md` is only a provisional placeholder (SHA-256 `a7e08191a01a36f99d031a6fd935961506f65915d1fa6c32d72839db823e08f0`) and is explicitly not a freeze. FINAL-17 is rejected before freeze; no final-candidate scan or independent review was performed. The pre-failure validation bytes are preserved at `.hermes/state/stage5-final17-candidate-validation-pre-scope-failure.md` (SHA-256 `a42348107dfac33c154945fb0f27bf5cd40934c7614b2c1849c18fa1270916b9`). Do not rerun FINAL-17 CI. Continue with FINAL-18, correcting the fail-closed source-scope requirements and regression tests, then regenerate baseline and execute the next candidate's one CI authorization only after its complete preflight. **Stage 6 actions: `0`.**
