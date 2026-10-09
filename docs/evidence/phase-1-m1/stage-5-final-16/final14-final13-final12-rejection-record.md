# Stage 5 — FINAL-12 Rejection Record

**Disposition:** REJECTED / CI CONSUMED / LINT-GATE FAILURE  
**Candidate:** FINAL-12  
**Classification:** candidate-generation/preflight defect  
**Stage 6 actions:** 0

FINAL-12's one authorized `corepack pnpm ci:verify` invocation started and was consumed on 2026-10-06. The runner recorded invocation count 1 and exit code 1. The ordered run passed repository policy, format check, the Phase 0 protected baseline, and Stage 5 security-extension pre-gates; it failed at `lint` with 30 ESLint errors across FINAL-11/FINAL-12 candidate tooling and tests. Errors were unused imports/locals, undeclared `structuredClone`, and undeclared `URL`. This was not a product test failure, infrastructure failure, or architecture/ADR conflict. Readiness omitted a real lint gate before arming the authorization.

FINAL-12 must not be rerun. The remediation removes unused bindings, uses JSON-safe cloning for the baseline/test fixtures, explicitly imports `URL` where used, and requires full lint to pass before successor authorization. These are candidate-generation corrections for FINAL-13.

## Immutable FINAL-12 receipts

- Invocation guard: `.hermes/state/stage5-final12-ci-verify-invocation.json`; SHA-256 `9f57c975cc393f19ec1cb1ea043ae9da5fb9e5159ac838b76705125cff7bb61c`; invocation count 1; exit 1.
- Command: `corepack pnpm ci:verify`.
- Toolchain: Node `v24.19.0`, Corepack `0.35.0`, pnpm `11.21.0`.
- Started: `2026-10-06T13:00:27.391Z`; finished: `2026-10-06T13:00:54.798Z`.
- Log: `docs/evidence/phase-1-m1/stage-5-final-12/ci-verify.log`; 13,896 bytes; SHA-256 `4aae8ee4619ddf75ec89d4feaae0ab6a342b22f95cc638beca01d88ce5039aa5`.
- Execution receipt: `docs/evidence/phase-1-m1/stage-5-final-12/ci-verify-execution.json`; SHA-256 `c1fd59bbb7a1331507977bb8f874d9eb6416324b20e3b53d24d33f69db13c9e9`.
- CI-failed evidence index: `docs/evidence/phase-1-m1/stage-5-final-12/EVIDENCE_INDEX.json`; SHA-256 `b106f74abd4fee430eeb82c96751d660f0473cef7b03006a834764793236a73a`; 39 indexed artifacts; aggregate SHA-256 `195df11cbfea39d3c85e09a95919d64bb8bf007482388c97a0d0bda2266097a4`.
- Guarded HEAD: `27184b598ae2be2eaf35616d4a9b6c2e623ccd42`.
- Guarded package SHA-256: `fdcca2b04737195409fd1c00fc60c94fb007c1af21931c4a1cf6cfae137ae133`.
- Guarded Stage 5 baseline SHA-256: `9fdab6bd8c88c33ad492ca97ba294041b8754e4c465b95ef05a4f71e4d21893a`.
- Guarded runner SHA-256: `cf972c1347d1cd6c712a79548dcc52047b919b64b7490503833bf8900655e3a4`.
- Migration head: `0010_stage5_temporal_persistence_parity.cjs`, SHA-256 `d7961fbf06cda8b222fd1219de6d9aec85a0205fb1d186e809260d579c598030`.
- Exact pre-remediation worktree snapshot: `/home/hermes/.hermes/cache/scratch/travelos-final12-consumed-snapshot.tar`; 1,105,920 bytes; SHA-256 `1842b9566a245e1e8fa1c9ceae836d11f9c8639ec32ce662be5c545400888320`; 96 files; manifest `/home/hermes/.hermes/cache/scratch/travelos-final12-consumed-snapshot-manifest.json`.

The fixed receipt/index/guard and the archived exact snapshot preserve FINAL-12 as rejected historical evidence. FINAL-10 and FINAL-11 records remain unchanged. FINAL-13 is the next candidate; it must retain this lineage, include full lint in readiness, regenerate its protected baseline after all candidate-specific inputs are finalized, and receive exactly one CI invocation only after all preflight checks pass. No Stage 6 work is authorized.
