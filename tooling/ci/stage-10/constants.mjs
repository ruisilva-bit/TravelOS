export const STAGE = "PHASE_1_M1_STAGE_10";
export const BRANCH = "phase-1/stage-10";
export const PREDECESSOR = Object.freeze({
  commit: "f65a64d9c3aabd446ca95a605faed92630a72963",
  tag: "travelos-phase-1-m1-stage-9-gen11-go",
  artifactId: "travelos-stage9-gen11-d6610462",
  archiveSha256: "8b74c305c12eecb9339acdd777449fbdb0b3bf25c498d87a2c7d43931bb6d125",
});
export const TOOLCHAIN = Object.freeze({ node: "24.19.0", corepack: "0.35.0", pnpm: "11.21.0" });
export const MIGRATION_HEAD = "0016_stage9_staff_invitations";
export const STATE = ".hermes/state/stage10";
// No approval is inferred from receipts hashing themselves or from scanner PASS.
export const PENDING_INTEGRATIONS = Object.freeze([
  "Stage 10 deployment contract/package allowlist and exact-artifact runtime adapter",
  "Stage 10 cumulative real PostgreSQL/browser adapter binding the Stage 10 extracted artifact",
  "Stage 10 operational preflight producer and independent receipt authority",
  "Stage 10 complete-source scanner with exact frozen-scope reporting",
  "protected signing trust, custody/recovery, host activation and least-privilege qualification",
  "independent receipt/privacy review and canonical retained-evidence publication",
]);
