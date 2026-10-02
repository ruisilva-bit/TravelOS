export const STAGE5_FINAL9_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-5-final-9";
export const STAGE5_FINAL9_EVIDENCE_INDEX = `${STAGE5_FINAL9_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
export const STAGE5_FINAL9_CORRECTION_MATRIX =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_9_CORRECTION_MATRIX.json";
export const STAGE5_FINAL9_CANDIDATE_VALIDATION =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_9_CANDIDATE_VALIDATION.md";
export const STAGE5_FINAL9_CANDIDATE_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_9_CANDIDATE_FREEZE.md";
export const STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT =
  "docs/evidence/phase-1-m1/post-freeze-scan-reports/STAGE_5_FINAL_9.json";
export const STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT = `${STAGE5_FINAL9_EVIDENCE_DIRECTORY}/final8-independent-review.json`;

export const STAGE5_FINAL9_EXPECTED_EVIDENCE_ARTIFACT_NAMES = Object.freeze(
  [
    "auth-bridge-tests.json",
    "auth-bridge-tests.log",
    "ci-verify.log",
    "ci-verify-execution.json",
    "disposable-cleanup.json",
    "final8-independent-review.json",
    "focused-test-execution.json",
    "focused-tests.log",
    "integration-test-execution.json",
    "integration-tests.log",
    "migration-checksums.json",
    "package-build.json",
    "postgresql-package-provenance.json",
    "postgresql-runtime.json",
    "qualification-summary.json",
    "stage5-source-scope-test.log",
  ].toSorted(),
);

export const STAGE5_FINAL9_EXPECTED_FINAL8_REVIEW_FINDING_IDS = Object.freeze([
  "S5F8-HOST-001",
  "S5F8-AUTHZ-001",
  "S5F8-REVISION-GUC-001",
  "S5F8-CACHE-PREHANDLER-001",
  "S5F8-CACHE-OVERRIDE-001",
  "S5F8-CSRF-001",
  "S5F8-AUTH-PREFIX-001",
  "S5F8-AUTH-SCOPE-001",
  "S5F8-LOCKVERSION-001",
  "S5F8-ID-001",
  "S5F8-RESPONSE-COHERENCE-001",
  "S5F8-DEADLOCK-001",
  "S5F8-MULTIAGENCY-QUAL-001",
  "S5F8-SCAN-PROVENANCE-001",
  "S5F8-TEMPORAL-CONTRACT-001",
  "S5F8-MONEY-CANON-001",
  "S5F8-PERMISSION-DOC-001",
  "S5F8-INPUT-EVIDENCE-001",
  "S5F8-STALE-COST-EVIDENCE-001",
]);

export const STAGE5_FINAL9_EXPECTED_CARRIED_FINDING_IDS = Object.freeze([
  "S5F4-PRIMARY-001",
  "S5F4-TIME-001",
  "S5F4-INTERNAL-001",
  "S5F4-EVIDENCE-001",
  "S5F4-QUAL-001",
  "S5F5-PRIMARY-CARDINALITY-001",
  "S5F5-TIME-001",
  "S5F5-PRIMARY-TYPE-001",
  "S5F5-WORKSPACE-REVISION-001",
  "S5F5-MONEY-VALIDATION-001",
  "S5F6-EVIDENCE-PROVENANCE-001",
  "S5F6-EVIDENCE-COVERAGE-001",
  "S5F6-TIMEZONE-CONTRACT-PARITY-001",
  "S5F6-AUTH-REGISTRY-VERSION-001",
  "S5F6-PRIMARY-CONTINUITY-001",
  "S5F6-MONEY-NORMALIZATION-001",
  "S5F6-PRIMARY-REPARENT-QUAL-001",
  "S5F6-FOCUSED-TOOLCHAIN-ATTRIBUTION-001",
  "S5F7-PRIMARY-CONTINUITY-CONCURRENCY-001",
  "S5F7-WORKSPACE-REVISION-MONOTONICITY-001",
  "S5F7-WORKSPACE-REVISION-CHILD-FIRST-001",
  "S5F7-APPLICATION-INPUT-COMPLETENESS-001",
  "S5F7-TEMPORAL-RANGE-PARITY-001",
  "S5F7-SOURCE-SCAN-ORDER-001",
  "S5F7-ADJUDICATION-PROVENANCE-001",
  "S5F7-AUTH-CACHE-001",
]);

export const STAGE5_FINAL9_EXPECTED_ALL_FINDING_IDS = Object.freeze([
  ...STAGE5_FINAL9_EXPECTED_FINAL8_REVIEW_FINDING_IDS,
  ...STAGE5_FINAL9_EXPECTED_CARRIED_FINDING_IDS,
]);

export const STAGE5_FINAL8_INDEPENDENT_REVIEW_SHA256 =
  "d343aae5ea315cb524b5e0a4afb3f4b7b452827543def934f3c4825011d316d3";
export const STAGE5_FINAL8_FREEZE = "docs/reviews/phase-1-m1/STAGE_5_FINAL_8_CANDIDATE_FREEZE.md";
export const STAGE5_FINAL8_EVIDENCE_INDEX =
  "docs/evidence/phase-1-m1/stage-5-final-8/EVIDENCE_INDEX.json";
export const STAGE5_FINAL8_REJECTED_TAG = "phase-1-stage-5-final-8-rejected";
export const STAGE5_FINAL8_REJECTED_TAG_TARGET = "294657132bf8a5b47181efd90732d5d8f2530c8e";
export const STAGE5_FINAL8_FREEZE_SHA256 =
  "5ec2cc5313cb31e7ddec6349749e6cb5d3934ace1f5e6eff67715b05dd3dbf76";
export const STAGE5_FINAL8_FREEZE_AGGREGATE_SHA256 =
  "c6bfbf895e454268281e67099eb216b8d324b0776cdd8bbffe092bf6707fc0f4";
export const STAGE5_FINAL8_EVIDENCE_INDEX_SHA256 =
  "ef6cb9987c83928894ec2aa1f739ae8bfcbec297406b3d98f5f6f4ac1e9d5397";
export const STAGE5_FINAL8_EVIDENCE_AGGREGATE_SHA256 =
  "b706fdb79b606c8b302f7e8bd17531e7aebbac6d1dba5e966b885dc662c56351";

export const STAGE5_FINAL9_CI_LOG_PLACEHOLDER =
  "PENDING: authoritative pnpm ci:verify has not run; this placeholder is not execution evidence.\n";
export const STAGE5_FINAL9_CI_EXECUTION_PLACEHOLDER = `${JSON.stringify(
  {
    schemaVersion: 1,
    phase: "PRE_CI",
    invocationCount: 0,
    result: "NOT_RUN",
    exitCode: null,
  },
  null,
  2,
)}\n`;
export const STAGE5_FINAL9_EVIDENCE_AGGREGATE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";
