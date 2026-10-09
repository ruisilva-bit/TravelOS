# Stage 5 FINAL-22 — rejected before CI

FINAL-22 attempt 02 failed the read-only readiness gate `format` after its Phase 1 security-extension baseline was generated. `corepack pnpm run format:check` exited 1: Prettier flagged `tooling/ci/generate-stage-5-current-security-extension-baseline.mjs`. No readiness PASS or invocation guard was created and the FINAL-22 authoritative CI invocation was **not started**. This is not a Stage 5 GO or independent finding adjudication.

- Generated baseline: `docs/evidence/phase-1-m1/stage-5-final-22-attempt-02/final22-security-extension-baseline.json`; SHA-256 `9f797baf2843710ee7bb90d0d714db0749b4eb6a14dad7946f844817e227c63b` (31,663 bytes).
- Baseline-generation receipt: `docs/evidence/phase-1-m1/stage-5-final-22-attempt-02/security-extension-baseline-generation.json`; SHA-256 `8663291470e3146b71ba45c1bd9a123a3e6cd3eba472daf84de3538eb22ac253`.
- Readiness failure record: `.hermes/state/stage5-final22-attempt02-readiness-failure.json`.
- The earlier focused attempt and the attempt-02 focused and disposable PostgreSQL qualifications remain historical evidence; neither is a passed readiness/CI/freeze/review.
- CI invocation count: 0. CI authorization consumed: no; not transferable to another candidate. Stage 6 actions: 0.

Preserve the generated baseline and attempt-02 evidence bytes. The formatting correction belongs to a sequential successor with fresh qualification and its own explicit CI authorization.
