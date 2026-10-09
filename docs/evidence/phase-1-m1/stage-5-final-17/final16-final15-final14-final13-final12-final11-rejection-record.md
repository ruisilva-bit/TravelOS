# Stage 5 — FINAL-11 Rejection Record

**Disposition:** REJECTED / CI CONSUMED / FORMAT-GATE FAILURE  
**Candidate:** FINAL-11  
**Stage 6 actions:** 0

FINAL-11's single authorized `corepack pnpm ci:verify` execution was consumed on 2026-10-06. The runner recorded invocation count 1 and exit code 1. The run reached `format:check`; all prior ordered gates shown in the log passed. `format:check` failed because these eight candidate tooling files were not Prettier-clean:

- `tooling/ci/generate-stage-5-final11-security-extension-baseline.mjs`
- `tooling/ci/prepare-stage-5-final10-evidence.mjs`
- `tooling/ci/run-stage-5-final10-authoritative-ci.mjs`
- `tooling/ci/stage-5-candidate-contract.mjs`
- `tooling/ci/stage-5-final11-finding-lineage.mjs`
- `tooling/ci/stage-5-final11-readiness-preflight.mjs`
- `tooling/ci/test-stage-5-final11-finding-lineage.mjs`
- `tooling/ci/test-stage-5-final11-security-extension-baseline.mjs`

**Classification:** candidate-generation/preflight defect. Readiness did not require a green full formatting check before the one-time authorization was armed. This is not a product/ADR decision or an implementation test failure. FINAL-11 must not be rerun.

## Immutable FINAL-11 receipts

- Invocation guard: `.hermes/state/stage5-final11-ci-verify-invocation.json`; invocation count 1; result FAIL; exit code 1.
- Command: `corepack pnpm ci:verify`.
- Toolchain: Node `v24.19.0`, Corepack `0.35.0`, pnpm `11.21.0`.
- Started: `2026-10-06T11:54:30.204Z`; finished: `2026-10-06T11:54:53.070Z`.
- Log: `docs/evidence/phase-1-m1/stage-5-final-11/ci-verify.log`; 8,558 bytes; SHA-256 `6e686ec0cf07bee47a155a5fc167f8ad9e55caa9ac2bb9564b755e90745db109`.
- Execution receipt: `docs/evidence/phase-1-m1/stage-5-final-11/ci-verify-execution.json`; records invocation count 1 and exit code 1.
- CI-failed evidence index: `docs/evidence/phase-1-m1/stage-5-final-11/EVIDENCE_INDEX.json`; phase `CI_FAILED`; 28 artifacts.
- Guarded candidate HEAD: `27184b598ae2be2eaf35616d4a9b6c2e623ccd42`.
- Guarded package SHA-256: `f4745f13277201668403ea8a819bcb827b37e1502fa62462d4e8f37cbbe28bf3`.
- Guarded Phase 1 baseline SHA-256: `33aed369ec4346a517a969b60611c32583c69170d53c4c46dbb51c7c343282c7`.
- Guarded runner SHA-256: `0025fd09d1647c9312a8b467fe6f97400919c74d14117d385a3eb81e8d058de6`.
- Migration head: `0010_stage5_temporal_persistence_parity.cjs`, SHA-256 `d7961fbf06cda8b222fd1219de6d9aec85a0205fb1d186e809260d579c598030`.

An exact pre-format snapshot of the tracked diff and all ordinary untracked files was retained locally at `/home/hermes/.hermes/cache/scratch/travelos-final11-consumed-snapshot.tar` (501,760 bytes; SHA-256 `7da6175c438754c1eb296c70e041aed3f1dcd254801fb8405c7f33b15cbd2912`; manifest SHA-256 `df3144bd8b3ec240523bed95f34f80089bebe7f23a19df6946011decefcce808`). It is retained for exact-state recovery and is not a FINAL-11 evidence-directory mutation.

The FINAL-11 source snapshot remains rejected history. Prettier corrections are successor-generation work; candidate FINAL-12 must regenerate and independently verify its baseline, include FINAL-11 failure lineage, pass the complete pre-CI readiness gates, and consume only its own single CI authorization. FINAL-10 records and tag remain immutable. No Stage 6 work is authorized.