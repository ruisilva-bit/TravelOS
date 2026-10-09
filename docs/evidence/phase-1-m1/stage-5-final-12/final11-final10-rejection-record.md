# Stage 5 FINAL-10 Rejection Record

**Disposition:** `REJECTED / CI CONSUMED / PRE-GATE FAILURE`
**Candidate:** FINAL-10
**Stage 6 actions:** `0`
**Purpose:** Preserve the consumed candidate and its failure without representing it as a passing CI run, a deterministic freeze, or Stage 5 closure.

## Authoritative CI receipt

- Command: `corepack pnpm ci:verify`
- Invocation count: `1`
- Result: `FAIL` (exit code `1`)
- Gate: `stage5-security-extension:pre`
- Started: `2026-10-02T13:53:26.590Z`
- Finished: `2026-10-02T13:53:28.825Z`
- Toolchain: Node `v24.19.0`, Corepack `0.35.0`, pnpm `11.21.0`
- Log: `docs/evidence/phase-1-m1/stage-5-final-10/ci-verify.log` — SHA-256 `511223cac393ae64fb700b6b884cc4c468e74c377ac7502fc20cf53f10db1ad6`
- Execution receipt: `docs/evidence/phase-1-m1/stage-5-final-10/ci-verify-execution.json` — SHA-256 `09ee0779646e4c300c4408f1d527580d78f13e79220f6319f27c979aa9e5591b`
- Local once-only guard: `.hermes/state/stage5-final10-ci-verify-invocation.json` — SHA-256 `ca2a2b7e9c9615c90c0bf87a9b34234ec31f228214d2bc892369e2a26ab001e8`; this is local-only and must not be committed, removed, or reused.

## Failure classification and cause

Classification: **candidate-generation / baseline defect**. The first Stage 5 security-extension gate rejected `package.json`; no test gate ran. The active Phase 1 baseline was still pinned to the prior package bytes (manifest SHA-256 `a8769309d7708174419e94407d2d5226c6bd72b982856a831f3e7df5dbb27ceb`, recorded package SHA-256 `5682673b28e8e47cd05a6b95af63fcc01370a966a588b308736d2669a3ccdefb`) after the candidate changed its `evidence:stage5:ci` script. The candidate package bytes at rejection are SHA-256 `3aa9dd1807679cc39fe1801ee83f1d72fd398df45c5a0881e8e49a16a6c07ca1`. This is a fail-closed baseline-generation ordering failure, not a test failure and not evidence that the baseline checker should be weakened.

## Preserved FINAL-10 history

- The FINAL-10 evidence directory remains at `docs/evidence/phase-1-m1/stage-5-final-10/`; its pre-CI evidence index remains unchanged at SHA-256 `885cc4946296eb79c056cf4e1b2ecb05ce2a948c8be139519af2f56fb4bf5b27` and declares phase `PRE_CI`.
- The index's declared pre-CI aggregate `2b3db58c4e595cdd52a8beb503483f1241f7fa9614adaf9017cb1fd5588c5e2b` is historical index content, not a post-CI passing evidence aggregate. The CI runner replaced the pre-CI placeholder log/receipt with the actual failure record; no FINAL-10 index, receipt, or evidence file may be rewritten to make the candidate appear successful.
- The prior Phase 1 extension baseline remains preserved in the rejected FINAL-9 predecessor commit/tag `phase-1-stage-5-final-9-rejected` (`45207d6c58e24e57ea25eca69a694ab33a171cce`) at the exact manifest hash above. The Phase 0 accepted baseline remains untouched.
- FINAL-10 has no passing final evidence index, deterministic freeze, independent GO review, Stage 5 closure, or authorized retry.

## Successor boundary

FINAL-11 is the separately authorized successor. It must use corrected generation ordering: finalize the FINAL-11 runner, `package.json`, and all candidate-specific tooling/configuration first; then generate and verify a new Phase 1 extension baseline that binds those final bytes; then lock candidate inputs and use its own single invocation guard and sole authorized `pnpm ci:verify` execution. FINAL-10's failed guard and receipts remain historical and are never reused.
