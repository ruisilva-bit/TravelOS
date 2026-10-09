import { strict as nodeAssert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertStage5CandidateManifest,
  getStage5CurrentCandidateScripts,
} from "./stage-5-candidate-coherence.mjs";

import {
  STAGE5_FINAL9_REJECTED_TAG,
  STAGE5_FINAL9_REJECTED_TAG_TARGET,
  STAGE5_FINAL13_CORRECTION_MATRIX_SHA256,
  STAGE5_FINAL13_FREEZE_SHA256,
  STAGE5_FINAL13_INDEX_SHA256,
  STAGE5_FINAL13_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL13_REVIEW_NO_GO_SHA256,
  STAGE5_FINAL10_CI_EXECUTION_SHA256,
  STAGE5_FINAL10_CI_EXECUTION,
  STAGE5_FINAL10_CI_LOG_SHA256,
  STAGE5_FINAL10_CI_LOG,
  STAGE5_FINAL10_CORRECTION_MATRIX_SHA256,
  STAGE5_FINAL10_CORRECTION_MATRIX_PATH,
  STAGE5_FINAL10_INVOCATION_GUARD_SHA256,
  STAGE5_FINAL10_INVOCATION_GUARD_PATH,
  STAGE5_FINAL10_PHASE1_BASELINE_EXPECTED_PACKAGE_SHA256,
  STAGE5_FINAL10_PHASE1_BASELINE_SHA256,
  STAGE5_FINAL10_PHASE1_BASELINE_PATH,
  STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX_SHA256,
  STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX,
  STAGE5_FINAL10_REJECTED_TAG,
  STAGE5_FINAL10_REJECTED_TAG_TARGET,
  STAGE5_FINAL10_REJECTION_RECORD,
  STAGE5_FINAL10_REJECTION_RECORD_SHA256,
  STAGE5_FINAL11_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL11_REJECTION_RECORD_SHA256,
  STAGE5_FINAL11_PRE_FORMAT_SNAPSHOT_SHA256,
  STAGE5_FINAL12_CI_EXECUTION_SHA256,
  STAGE5_FINAL12_CI_FAILED_INDEX_SHA256,
  STAGE5_FINAL12_CI_LOG_SHA256,
  STAGE5_FINAL12_CORRECTION_MATRIX_SHA256,
  STAGE5_FINAL12_EVIDENCE_DIRECTORY,
  STAGE5_FINAL12_INVOCATION_GUARD_SHA256,
  STAGE5_FINAL12_REJECTION_MATRIX_SHA256,
  STAGE5_FINAL12_REJECTION_RECORD_SHA256,
  STAGE5_FINAL12_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL15_FAILED_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL15_FAILURE_RECEIPT_SHA256,
  STAGE5_FINAL15_FAILURE_LOG_SHA256,
  STAGE5_FINAL15_BASELINE_FAILURE_RECEIPT,
  STAGE5_FINAL15_BASELINE_FAILURE_LOG,
  STAGE5_FINAL15_FAILED_BASELINE_COPY,
  STAGE5_FINAL15_SOURCE_INPUTS_MANIFEST,
  STAGE5_FINAL16_BASELINE_SHA256,
  STAGE5_FINAL16_EVIDENCE_INDEX_SHA256,
  STAGE5_FINAL16_READINESS_SHA256,
  STAGE5_FINAL16_PREFLIGHT_FAILURE_RECEIPT_SHA256,
  STAGE5_FINAL16_PREFLIGHT_FAILURE_LOG_SHA256,
  STAGE5_FINAL17_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL18_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL18_PREFLIGHT_FAILURE_RECEIPT,
  STAGE5_FINAL18_PREFLIGHT_FAILURE_RECEIPT_SHA256,
  STAGE5_FINAL19_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT,
  STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT_SHA256,
  STAGE5_FINAL20_CORRECTION_MATRIX,
  STAGE5_FINAL20_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL21_CORRECTION_MATRIX,
  STAGE5_FINAL21_SECURITY_BASELINE_SHA256,
} from "./stage-5-candidate-contract.mjs";

export const PHASE0_ACCEPTED_BASELINE_PATH = "docs/reviews/PHASE_0_ACCEPTED_BASELINE.md";
export const PHASE0_ACCEPTED_BASELINE_SHA256 =
  "bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb";
export const PHASE0_ACCEPTED_BASELINE_ENTRY_COUNT = 40;
export const PHASE0_ACCEPTED_BASELINE_SOURCE_COMMIT = "32b7d2f0a8b628c5c368d22983c5d631aad520fb";
export const PHASE0_PERMISSIONS_PATH = "docs/PERMISSIONS.md";
export const PHASE0_PERMISSIONS_SHA256 =
  "ad036b8647f4482bc5e59bff09e5adbf653a4d3ed3994a20cd5b201d104ea1d9";

export const STAGE5_SECURITY_EXTENSION_BASELINE_PATH =
  "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json";
export const STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH =
  "docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md";
export const STAGE5_SECURITY_EXTENSION_BASELINE_SHA256 =
  "2fb65b6fa0d14875f9c756496f75b2b9fed3a446409295f5bdff46e5deae70cb";
export const STAGE5_SECURITY_EXTENSION_BASELINE_ID =
  "phase-1-m1-stage-5-finance-cost-permission-v1";
export const STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS = Object.freeze(
  [
    "apps/admin-api/src/m1-routes.ts",
    "apps/admin-api/test/m1-authorization-boundary.test.ts",
    "docs/PERMISSIONS.md",
    "docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md",
    "package.json",
    "packages/backend-core/src/agency-organization/agency-bootstrap.ts",
    "packages/backend-core/src/modules/trip-operations/application/m1-staff-operations.ts",
    "packages/backend-core/src/staff-access/permission-registry.ts",
    "packages/backend-core/test/agency-organization/agency-bootstrap.test.ts",
    "tooling/ci/verify.mjs",
  ].toSorted(),
);
export const STAGE5_FINAL15_SECURITY_EXTENSION_ADDED_PROTECTED_PATHS = Object.freeze(
  [
    "packages/backend-core/src/index.ts",
    "packages/database/src/trip-operations/m1-operational-slice-repository.ts",
  ].toSorted(),
);
export const STAGE5_FINAL15_SECURITY_EXTENSION_PROTECTED_PATHS = Object.freeze(
  [
    ...STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS,
    ...STAGE5_FINAL15_SECURITY_EXTENSION_ADDED_PROTECTED_PATHS,
  ].toSorted(),
);
export const STAGE5_FINAL16_SECURITY_EXTENSION_PROTECTED_PATHS =
  STAGE5_FINAL15_SECURITY_EXTENSION_PROTECTED_PATHS;
export const STAGE5_FINAL17_SECURITY_EXTENSION_PROTECTED_PATHS =
  STAGE5_FINAL16_SECURITY_EXTENSION_PROTECTED_PATHS;
export const STAGE5_FINAL18_SECURITY_EXTENSION_PROTECTED_PATHS =
  STAGE5_FINAL17_SECURITY_EXTENSION_PROTECTED_PATHS;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const AGGREGATE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";
const REQUIRED_CI_SCRIPTS = Object.freeze({
  "stage5:security-extension:verify":
    "node tooling/ci/verify-stage-5-final14-security-extension-baseline.mjs",
  "test:stage5-security-extension-baseline":
    "node tooling/ci/test-stage-5-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final12-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final13-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final14-security-extension-baseline.mjs",
  "test:stage5-source-scope":
    "node tooling/ci/test-stage-5-source-scope.mjs && node tooling/ci/test-stage-5-evidence-index.mjs && node tooling/ci/test-stage-5-finding-lineage.mjs && node tooling/ci/test-stage-5-final11-finding-lineage.mjs && node tooling/ci/test-stage-5-final12-finding-lineage.mjs && node tooling/ci/test-stage-5-final13-finding-lineage.mjs && node tooling/ci/test-stage-5-final14-finding-lineage.mjs && node tooling/ci/test-stage-5-final14-evidence-index.mjs && node tooling/ci/test-stage-5-final14-scan-provenance.mjs",
  "evidence:stage5:matrix": "node tooling/ci/stage-5-final14-finding-lineage.mjs --write",
  "evidence:stage5:postgresql": "node tooling/ci/run-stage-5-final14-postgresql-qualification.mjs",
  "evidence:stage5:baseline":
    "node tooling/ci/generate-stage-5-final14-security-extension-baseline.mjs --write",
  "evidence:stage5:prepare": "node tooling/ci/prepare-stage-5-final14-evidence.mjs",
  "evidence:stage5:preflight": "node tooling/ci/stage-5-final14-readiness-preflight.mjs --write",
  "evidence:stage5:ci": "node tooling/ci/run-stage-5-final14-authoritative-ci.mjs",
  "security:scan:source": "node tooling/ci/scan-source-secrets.mjs --stage5-final14",
});
const REQUIRED_CI_SCRIPTS_FINAL15 = Object.freeze({
  "stage5:security-extension:verify":
    "node tooling/ci/verify-stage-5-final15-security-extension-baseline.mjs",
  "test:stage5-security-extension-baseline":
    "node tooling/ci/test-stage-5-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final12-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final13-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final14-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final15-security-extension-baseline.mjs",
  "test:stage5-source-scope":
    "node tooling/ci/test-stage-5-source-scope.mjs && node tooling/ci/test-stage-5-evidence-index.mjs && node tooling/ci/test-stage-5-finding-lineage.mjs && node tooling/ci/test-stage-5-final11-finding-lineage.mjs && node tooling/ci/test-stage-5-final12-finding-lineage.mjs && node tooling/ci/test-stage-5-final13-finding-lineage.mjs && node tooling/ci/test-stage-5-final14-finding-lineage.mjs && node tooling/ci/test-stage-5-final14-evidence-index.mjs && node tooling/ci/test-stage-5-final14-scan-provenance.mjs && node tooling/ci/test-stage-5-artifact-path-set.mjs && node tooling/ci/test-stage-5-review-reconciliation.mjs && node tooling/ci/test-stage-5-final15-evidence-index.mjs",
  "evidence:stage5:matrix": "node tooling/ci/stage-5-final15-finding-lineage.mjs --write",
  "evidence:stage5:postgresql": "node tooling/ci/run-stage-5-final15-postgresql-qualification.mjs",
  "evidence:stage5:baseline":
    "node tooling/ci/generate-stage-5-final15-security-extension-baseline.mjs --write",
  "evidence:stage5:prepare": "node tooling/ci/prepare-stage-5-final15-evidence.mjs",
  "evidence:stage5:preflight": "node tooling/ci/stage-5-final15-readiness-preflight.mjs --write",
  "evidence:stage5:ci": "node tooling/ci/run-stage-5-final15-authoritative-ci.mjs",
  "security:scan:source": "node tooling/ci/scan-source-secrets.mjs --stage5-final15",
});
const REQUIRED_CI_SCRIPTS_FINAL16 = Object.freeze({
  "stage5:security-extension:verify":
    "node tooling/ci/verify-stage-5-final16-security-extension-baseline.mjs",
  "test:stage5-security-extension-baseline":
    "node tooling/ci/test-stage-5-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final12-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final13-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final14-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final16-security-extension-baseline.mjs",
  "test:stage5-source-scope":
    "node tooling/ci/test-stage-5-source-scope.mjs && node tooling/ci/test-stage-5-evidence-index.mjs && node tooling/ci/test-stage-5-finding-lineage.mjs && node tooling/ci/test-stage-5-final11-finding-lineage.mjs && node tooling/ci/test-stage-5-final12-finding-lineage.mjs && node tooling/ci/test-stage-5-final13-finding-lineage.mjs && node tooling/ci/test-stage-5-final14-finding-lineage.mjs && node tooling/ci/test-stage-5-final14-evidence-index.mjs && node tooling/ci/test-stage-5-final14-scan-provenance.mjs && node tooling/ci/test-stage-5-artifact-path-set.mjs && node tooling/ci/test-stage-5-review-reconciliation.mjs && node tooling/ci/test-stage-5-final16-evidence-index.mjs",
  "evidence:stage5:matrix": "node tooling/ci/stage-5-final16-finding-lineage.mjs --write",
  "evidence:stage5:postgresql": "node tooling/ci/run-stage-5-final16-postgresql-qualification.mjs",
  "evidence:stage5:baseline":
    "node tooling/ci/generate-stage-5-final16-security-extension-baseline.mjs --write",
  "evidence:stage5:index":
    "node tooling/ci/stage-5-final16-evidence-index.mjs --write --phase=PRE_CI",
  "evidence:stage5:prepare": "node tooling/ci/prepare-stage-5-final16-evidence.mjs",
  "evidence:stage5:preflight": "node tooling/ci/stage-5-final16-readiness-preflight.mjs --write",
  "evidence:stage5:ci": "node tooling/ci/run-stage-5-final16-authoritative-ci.mjs",
  "security:scan:source": "node tooling/ci/scan-source-secrets.mjs --stage5-final16",
});
const REQUIRED_CI_SCRIPTS_FINAL17 = Object.freeze({
  "stage5:security-extension:verify":
    "node tooling/ci/verify-stage-5-final17-security-extension-baseline.mjs",
  "test:stage5-security-extension-baseline":
    "node tooling/ci/test-stage-5-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final12-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final13-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final14-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final17-security-extension-baseline.mjs",
  "test:stage5-source-scope":
    "node tooling/ci/test-stage-5-source-scope.mjs && node tooling/ci/test-stage-5-evidence-index.mjs && node tooling/ci/test-stage-5-finding-lineage.mjs && node tooling/ci/test-stage-5-final11-finding-lineage.mjs && node tooling/ci/test-stage-5-final12-finding-lineage.mjs && node tooling/ci/test-stage-5-final13-finding-lineage.mjs && node tooling/ci/test-stage-5-final14-finding-lineage.mjs && node tooling/ci/test-stage-5-final14-evidence-index.mjs && node tooling/ci/test-stage-5-final14-scan-provenance.mjs && node tooling/ci/test-stage-5-artifact-path-set.mjs && node tooling/ci/test-stage-5-review-reconciliation.mjs && node tooling/ci/test-stage-5-final17-evidence-index.mjs",
  "evidence:stage5:matrix": "node tooling/ci/stage-5-final17-finding-lineage.mjs --write",
  "evidence:stage5:postgresql": "node tooling/ci/run-stage-5-final17-postgresql-qualification.mjs",
  "evidence:stage5:baseline":
    "node tooling/ci/generate-stage-5-final17-security-extension-baseline.mjs --write",
  "evidence:stage5:index":
    "node tooling/ci/stage-5-final17-evidence-index.mjs --write --phase=PRE_CI",
  "evidence:stage5:prepare": "node tooling/ci/prepare-stage-5-final17-evidence.mjs",
  "evidence:stage5:preflight": "node tooling/ci/stage-5-final17-readiness-preflight.mjs --write",
  "evidence:stage5:ci": "node tooling/ci/run-stage-5-final17-authoritative-ci.mjs",
  "security:scan:source": "node tooling/ci/scan-source-secrets.mjs --stage5-final17",
});
const REQUIRED_CI_SCRIPTS_FINAL18 = Object.freeze({
  "test:stage5:focused": "node tooling/ci/run-stage-5-final18-focused.mjs",
  "stage5:security-extension:verify":
    "node tooling/ci/verify-stage-5-final18-security-extension-baseline.mjs",
  "test:stage5-security-extension-baseline":
    "node tooling/ci/test-stage-5-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final12-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final13-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final14-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final17-security-extension-baseline.mjs && node tooling/ci/test-stage-5-final18-security-extension-baseline.mjs",
  "test:stage5-source-scope":
    "node tooling/ci/test-stage-5-source-scope.mjs && node tooling/ci/test-stage-5-evidence-index.mjs && node tooling/ci/test-stage-5-finding-lineage.mjs && node tooling/ci/test-stage-5-final11-finding-lineage.mjs && node tooling/ci/test-stage-5-final12-finding-lineage.mjs && node tooling/ci/test-stage-5-final13-finding-lineage.mjs && node tooling/ci/test-stage-5-final14-finding-lineage.mjs && node tooling/ci/test-stage-5-final14-evidence-index.mjs && node tooling/ci/test-stage-5-final14-scan-provenance.mjs && node tooling/ci/test-stage-5-artifact-path-set.mjs && node tooling/ci/test-stage-5-review-reconciliation.mjs && node tooling/ci/test-stage-5-final17-historical-evidence.mjs && node tooling/ci/test-stage-5-final18-evidence-index.mjs && node tooling/ci/stage-5-final18-finding-lineage.mjs",
  "evidence:stage5:matrix":
    "node tooling/ci/prepare-stage-5-final18-correction-matrix.mjs --write && node tooling/ci/stage-5-final18-finding-lineage.mjs --write",
  "evidence:stage5:postgresql": "node tooling/ci/run-stage-5-final18-postgresql-qualification.mjs",
  "evidence:stage5:baseline":
    "node tooling/ci/generate-stage-5-final18-security-extension-baseline.mjs --write",
  "evidence:stage5:index":
    "node tooling/ci/stage-5-final18-evidence-index.mjs --write --phase=PRE_CI",
  "evidence:stage5:prepare": "node tooling/ci/prepare-stage-5-final18-evidence.mjs",
  "evidence:stage5:preflight": "node tooling/ci/stage-5-final18-readiness-preflight.mjs --write",
  "evidence:stage5:ci": "node tooling/ci/run-stage-5-final18-authoritative-ci.mjs",
  "security:scan:source": "node tooling/ci/scan-source-secrets.mjs --stage5-final18",
});
const REQUIRED_CI_SCRIPTS_FINAL19 = Object.freeze({
  ...REQUIRED_CI_SCRIPTS_FINAL18,
  "test:stage5:focused": "node tooling/ci/run-stage-5-final19-focused.mjs",
  "stage5:security-extension:verify":
    "node tooling/ci/verify-stage-5-final19-security-extension-baseline.mjs",
  "test:stage5-security-extension-baseline": `${REQUIRED_CI_SCRIPTS_FINAL18["test:stage5-security-extension-baseline"]} && node tooling/ci/test-stage-5-final19-security-extension-baseline.mjs`,
  "test:stage5-source-scope": `${REQUIRED_CI_SCRIPTS_FINAL18["test:stage5-source-scope"]} && node tooling/ci/test-stage-5-final19-evidence-index.mjs && node tooling/ci/stage-5-final19-finding-lineage.mjs && node tooling/ci/test-stage-5-working-tree-snapshot.mjs`,
  "evidence:stage5:matrix":
    "node tooling/ci/prepare-stage-5-final19-correction-matrix.mjs --write && node tooling/ci/stage-5-final19-finding-lineage.mjs --write",
  "evidence:stage5:postgresql": "node tooling/ci/run-stage-5-final19-postgresql-qualification.mjs",
  "evidence:stage5:baseline":
    "node tooling/ci/generate-stage-5-final19-security-extension-baseline.mjs --write",
  "evidence:stage5:index":
    "node tooling/ci/stage-5-final19-evidence-index.mjs --write --phase=PRE_CI",
  "evidence:stage5:prepare": "node tooling/ci/prepare-stage-5-final19-evidence.mjs",
  "evidence:stage5:preflight": "node tooling/ci/stage-5-final19-readiness-preflight.mjs --write",
  "evidence:stage5:ci": "node tooling/ci/run-stage-5-final19-authoritative-ci.mjs",
  "security:scan:source": "node tooling/ci/scan-source-secrets.mjs --stage5-final19",
});
const REQUIRED_CI_SCRIPTS_FINAL20 = Object.freeze({
  ...REQUIRED_CI_SCRIPTS_FINAL18,
  "test:stage5:focused": "node tooling/ci/run-stage-5-final20-focused.mjs",
  "stage5:security-extension:verify":
    "node tooling/ci/verify-stage-5-final20-security-extension-baseline.mjs",
  "test:stage5-security-extension-baseline": `${REQUIRED_CI_SCRIPTS_FINAL18["test:stage5-security-extension-baseline"]} && node tooling/ci/test-stage-5-final20-security-extension-baseline.mjs`,
  "test:stage5-source-scope": `${REQUIRED_CI_SCRIPTS_FINAL18["test:stage5-source-scope"]} && node tooling/ci/test-stage-5-final19-preflight-failure.mjs && node tooling/ci/test-stage-5-final20-evidence-index.mjs && node tooling/ci/stage-5-final20-finding-lineage.mjs && node tooling/ci/test-stage-5-working-tree-snapshot.mjs`,
  "evidence:stage5:matrix":
    "node tooling/ci/prepare-stage-5-final20-correction-matrix.mjs --write && node tooling/ci/stage-5-final20-finding-lineage.mjs --write",
  "evidence:stage5:postgresql": "node tooling/ci/run-stage-5-final20-postgresql-qualification.mjs",
  "evidence:stage5:baseline":
    "node tooling/ci/generate-stage-5-final20-security-extension-baseline.mjs --write",
  "evidence:stage5:index":
    "node tooling/ci/stage-5-final20-evidence-index.mjs --write --phase=PRE_CI",
  "evidence:stage5:prepare": "node tooling/ci/prepare-stage-5-final20-evidence.mjs",
  "evidence:stage5:preflight": "node tooling/ci/stage-5-final20-readiness-preflight.mjs --write",
  "evidence:stage5:ci": "node tooling/ci/run-stage-5-final20-authoritative-ci.mjs",
  "security:scan:source": "node tooling/ci/scan-source-secrets.mjs --stage5-final20",
});
const REQUIRED_CI_SCRIPTS_FINAL21 = Object.freeze({
  ...REQUIRED_CI_SCRIPTS_FINAL20,
  "test:stage5:focused": "node tooling/ci/run-stage-5-final21-focused.mjs",
  "test:stage5-security-extension-baseline": `${REQUIRED_CI_SCRIPTS_FINAL20["test:stage5-security-extension-baseline"]} && node tooling/ci/verify-stage-5-final21-security-extension-baseline.mjs`,
  "test:stage5-source-scope":
    "node tooling/ci/test-stage-5-source-scope.mjs && node tooling/ci/test-stage-5-generation-lifecycle-ledger.mjs && node tooling/ci/test-stage-5-evidence-index.mjs && node tooling/ci/test-stage-5-finding-lineage.mjs && node tooling/ci/test-stage-5-final11-finding-lineage.mjs && node tooling/ci/test-stage-5-final12-finding-lineage.mjs && node tooling/ci/test-stage-5-final13-finding-lineage.mjs && node tooling/ci/test-stage-5-final14-finding-lineage.mjs && node tooling/ci/test-stage-5-final14-evidence-index.mjs && node tooling/ci/test-stage-5-final14-scan-provenance.mjs && node tooling/ci/test-stage-5-artifact-path-set.mjs && node tooling/ci/test-stage-5-review-reconciliation.mjs && node tooling/ci/test-stage-5-final17-historical-evidence.mjs && node tooling/ci/test-stage-5-final18-evidence-index.mjs && node tooling/ci/stage-5-final18-finding-lineage.mjs && node tooling/ci/test-stage-5-final19-preflight-failure.mjs && node tooling/ci/test-stage-5-final20-evidence-index.mjs && node tooling/ci/stage-5-final20-finding-lineage.mjs && node tooling/ci/test-stage-5-working-tree-snapshot.mjs",
  "stage5:security-extension:verify:final21":
    "node tooling/ci/verify-stage-5-final21-security-extension-baseline.mjs",
  "security:scan:source:final21": "node tooling/ci/scan-source-secrets.mjs --stage5-final21",
  "evidence:stage5:final21:matrix":
    "node tooling/ci/prepare-stage-5-final21-correction-matrix.mjs --write && node tooling/ci/stage-5-final21-finding-lineage.mjs --write",
  "evidence:stage5:final21:baseline":
    "node tooling/ci/generate-stage-5-final21-security-extension-baseline.mjs --write",
  "evidence:stage5:final21:prepare": "node tooling/ci/prepare-stage-5-final21-evidence.mjs",
  "evidence:stage5:final21:preflight":
    "node tooling/ci/stage-5-final21-readiness-preflight.mjs --write",
  "evidence:stage5:final21:index":
    "node tooling/ci/stage-5-final21-evidence-index.mjs --write --phase=PRE_CI",
  "evidence:stage5:final21:ci": "node tooling/ci/run-stage-5-final21-authoritative-ci.mjs",
});
const REQUIRED_CI_GATES = Object.freeze([
  ["stage5-security-extension:pre", "stage5:security-extension:verify"],
  ["test:stage5-security-extension-baseline", "test:stage5-security-extension-baseline"],
  ["test:stage5-source-scope", "test:stage5-source-scope"],
  ["stage5-security-extension:post", "stage5:security-extension:verify"],
]);
const FINAL11_ALLOWED_PROTECTED_PATH_DELTAS = Object.freeze(
  ["docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md", "package.json"].toSorted(),
);
const FINAL12_ALLOWED_PROTECTED_PATH_DELTAS = Object.freeze(
  ["docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md", "package.json"].toSorted(),
);
const FINAL13_ALLOWED_PROTECTED_PATH_DELTAS = Object.freeze(
  ["docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md", "package.json"].toSorted(),
);
const FINAL10_FAILED_CI_PROVENANCE = Object.freeze({
  candidate: "FINAL-10",
  phase: "FINAL",
  status: "REJECTED",
  tag: STAGE5_FINAL10_REJECTED_TAG,
  target: STAGE5_FINAL10_REJECTED_TAG_TARGET,
  failedGate: "stage5-security-extension:pre",
  command: "corepack pnpm ci:verify",
  invocationCount: 1,
  result: "FAIL",
  exitCode: 1,
  ciLogSha256: STAGE5_FINAL10_CI_LOG_SHA256,
  ciExecutionSha256: STAGE5_FINAL10_CI_EXECUTION_SHA256,
  preCiEvidenceIndexSha256: STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX_SHA256,
  correctionMatrixSha256: STAGE5_FINAL10_CORRECTION_MATRIX_SHA256,
  rejectionRecordSha256: STAGE5_FINAL10_REJECTION_RECORD_SHA256,
  previousPhase1BaselineSha256: STAGE5_FINAL10_PHASE1_BASELINE_SHA256,
  staleBaselinePackageSha256: STAGE5_FINAL10_PHASE1_BASELINE_EXPECTED_PACKAGE_SHA256,
  localInvocationGuardSha256: STAGE5_FINAL10_INVOCATION_GUARD_SHA256,
  stage6Actions: 0,
});

const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const sameArray = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const isSafeRelativePath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !path.isAbsolute(value) &&
  !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
const serializeRows = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");

const readRegularFile = async (root, relativePath, label) => {
  assert(isSafeRelativePath(relativePath), `${label} path is unsafe: ${String(relativePath)}`);
  const absolutePath = path.join(root, relativePath);
  let metadata;
  try {
    metadata = await lstat(absolutePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`${label} is missing: ${relativePath}`, { cause: error });
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} is not a regular non-symlink file: ${relativePath}`);
  }
  return readFile(absolutePath);
};

const readGitBlob = (root, tag, relativePath) =>
  execFileSync("git", ["show", `${tag}:${relativePath}`], {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024,
  });

const gitCommitTarget = (root, tag) =>
  execFileSync("git", ["rev-parse", `${tag}^{commit}`], { cwd: root, encoding: "utf8" }).trim();

const verifyPredecessorPhase1Lineage = async ({ root, baseline }) => {
  assert(
    gitCommitTarget(root, STAGE5_FINAL9_REJECTED_TAG) === STAGE5_FINAL9_REJECTED_TAG_TARGET,
    "FINAL-11 predecessor rejected FINAL-9 tag target changed",
  );
  execFileSync("git", ["merge-base", "--is-ancestor", STAGE5_FINAL9_REJECTED_TAG_TARGET, "HEAD"], {
    cwd: root,
  });
  const predecessorBytes = readGitBlob(
    root,
    STAGE5_FINAL9_REJECTED_TAG,
    STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
  );
  assert(
    sha256(predecessorBytes) === STAGE5_FINAL10_PHASE1_BASELINE_SHA256,
    "FINAL-11 predecessor Phase 1 baseline bytes changed in the FINAL-9 tag",
  );
  const predecessor = JSON.parse(predecessorBytes.toString("utf8"));
  assert(
    predecessor.result === "PASS" &&
      predecessor.protectedFiles?.length === 10 &&
      predecessor.aggregateSha256 ===
        "528b8d760fcc468021e7b8e2dfdd44e20430f17119a11162bb6f93f2754bc668" &&
      predecessor.protectedFiles.find((entry) => entry.path === "package.json")?.sha256 ===
        STAGE5_FINAL10_PHASE1_BASELINE_EXPECTED_PACKAGE_SHA256,
    "FINAL-9 tagged Phase 1 predecessor has invalid result, file count, aggregate, or package pin",
  );

  assert(
    gitCommitTarget(root, STAGE5_FINAL10_REJECTED_TAG) === STAGE5_FINAL10_REJECTED_TAG_TARGET,
    "FINAL-11 rejected FINAL-10 tag target changed",
  );
  execFileSync("git", ["merge-base", "--is-ancestor", STAGE5_FINAL10_REJECTED_TAG_TARGET, "HEAD"], {
    cwd: root,
  });
  const final10BaselineBytes = readGitBlob(
    root,
    STAGE5_FINAL10_REJECTED_TAG,
    STAGE5_FINAL10_PHASE1_BASELINE_PATH,
  );
  const final10PackageBytes = readGitBlob(root, STAGE5_FINAL10_REJECTED_TAG, "package.json");
  const ciLogBytes = readGitBlob(root, STAGE5_FINAL10_REJECTED_TAG, STAGE5_FINAL10_CI_LOG);
  const ciExecutionBytes = readGitBlob(
    root,
    STAGE5_FINAL10_REJECTED_TAG,
    STAGE5_FINAL10_CI_EXECUTION,
  );
  const preCiIndexBytes = readGitBlob(
    root,
    STAGE5_FINAL10_REJECTED_TAG,
    STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX,
  );
  const correctionMatrixBytes = readGitBlob(
    root,
    STAGE5_FINAL10_REJECTED_TAG,
    STAGE5_FINAL10_CORRECTION_MATRIX_PATH,
  );
  const rejectionRecordBytes = readGitBlob(
    root,
    STAGE5_FINAL10_REJECTED_TAG,
    STAGE5_FINAL10_REJECTION_RECORD,
  );
  const ciExecution = JSON.parse(ciExecutionBytes.toString("utf8"));
  const final10Manifest = JSON.parse(final10BaselineBytes.toString("utf8"));
  const taggedPackageSha256 = sha256(final10PackageBytes);
  assert(
    sha256(final10BaselineBytes) === STAGE5_FINAL10_PHASE1_BASELINE_SHA256 &&
      final10Manifest.protectedFiles?.find((entry) => entry.path === "package.json")?.sha256 ===
        STAGE5_FINAL10_PHASE1_BASELINE_EXPECTED_PACKAGE_SHA256 &&
      taggedPackageSha256 === baseline.lineage.rejectedFinal10Candidate.packageSha256AtCi &&
      taggedPackageSha256 !== STAGE5_FINAL10_PHASE1_BASELINE_EXPECTED_PACKAGE_SHA256 &&
      sha256(ciLogBytes) === STAGE5_FINAL10_CI_LOG_SHA256 &&
      sha256(ciExecutionBytes) === STAGE5_FINAL10_CI_EXECUTION_SHA256 &&
      sha256(preCiIndexBytes) === STAGE5_FINAL10_PRE_CI_EVIDENCE_INDEX_SHA256 &&
      sha256(correctionMatrixBytes) === STAGE5_FINAL10_CORRECTION_MATRIX_SHA256 &&
      sha256(rejectionRecordBytes) === STAGE5_FINAL10_REJECTION_RECORD_SHA256 &&
      ciExecution.candidate === "FINAL-10" &&
      ciExecution.phase === "FINAL" &&
      ciExecution.invocationCount === 1 &&
      ciExecution.command === "corepack pnpm ci:verify" &&
      ciExecution.result === "FAIL" &&
      ciExecution.exitCode === 1 &&
      ciExecution.logSha256 === STAGE5_FINAL10_CI_LOG_SHA256,
    "FINAL-10 rejected tag no longer matches its consumed pre-gate failure and stale package pin",
  );
  const trackedLocalGuard = execFileSync(
    "git",
    ["ls-files", "--", STAGE5_FINAL10_INVOCATION_GUARD_PATH],
    {
      cwd: root,
      encoding: "utf8",
    },
  ).trim();
  assert(trackedLocalGuard === "", "FINAL-10 once-only local guard must remain untracked");
  let localGuardBytes;
  try {
    localGuardBytes = await readRegularFile(
      root,
      STAGE5_FINAL10_INVOCATION_GUARD_PATH,
      "FINAL-10 local-only invocation guard",
    );
  } catch (error) {
    if (!(error instanceof Error) || !("cause" in error) || error.cause?.code !== "ENOENT") {
      throw error;
    }
  }
  if (localGuardBytes) {
    assert(
      sha256(localGuardBytes) === STAGE5_FINAL10_INVOCATION_GUARD_SHA256,
      "FINAL-10 local-only invocation guard changed",
    );
  }
  const final11BaselineBytes = await readRegularFile(
    root,
    `${STAGE5_FINAL12_EVIDENCE_DIRECTORY}/final11-security-extension-baseline.json`,
    "immutable FINAL-11 Phase 1 baseline copy",
  );
  assert(
    sha256(final11BaselineBytes) === STAGE5_FINAL11_SECURITY_BASELINE_SHA256,
    "FINAL-11 Phase 1 baseline copy changed",
  );
  const final11Baseline = JSON.parse(final11BaselineBytes.toString("utf8"));
  const final11Deltas = final11Baseline.lineage?.final11Generation?.protectedPathDeltas ?? [];
  assert(
    final11Baseline.result === "PASS" &&
      final11Baseline.lineage?.final11Generation?.candidate === "FINAL-11" &&
      final11Deltas.every(
        (delta) =>
          final11Baseline.protectedFiles.find((entry) => entry.path === delta.path)?.sha256 ===
          delta.currentSha256,
      ),
    "immutable FINAL-11 baseline does not preserve its own protected-file deltas",
  );
  if (baseline.lineage.final16Generation?.candidate === "FINAL-16") {
    const receiptBytes = await readRegularFile(
      root,
      STAGE5_FINAL15_BASELINE_FAILURE_RECEIPT,
      "immutable FINAL-15 baseline failure receipt",
    );
    const logBytes = await readRegularFile(
      root,
      STAGE5_FINAL15_BASELINE_FAILURE_LOG,
      "immutable FINAL-15 baseline failure log",
    );
    const failedBaselineBytes = await readRegularFile(
      root,
      STAGE5_FINAL15_FAILED_BASELINE_COPY,
      "immutable FINAL-15 failed baseline bytes",
    );
    const inputManifestBytes = await readRegularFile(
      root,
      STAGE5_FINAL15_SOURCE_INPUTS_MANIFEST,
      "immutable FINAL-15 source-input manifest",
    );
    const failure = JSON.parse(receiptBytes.toString("utf8"));
    const inputManifest = JSON.parse(inputManifestBytes.toString("utf8"));
    nodeAssert.equal(sha256(receiptBytes), STAGE5_FINAL15_FAILURE_RECEIPT_SHA256);
    nodeAssert.equal(sha256(logBytes), STAGE5_FINAL15_FAILURE_LOG_SHA256);
    nodeAssert.equal(sha256(failedBaselineBytes), STAGE5_FINAL15_FAILED_SECURITY_BASELINE_SHA256);
    nodeAssert.equal(
      baseline.lineage.final16Generation.previousBaselineSha256,
      STAGE5_FINAL15_FAILED_SECURITY_BASELINE_SHA256,
    );
    nodeAssert.equal(failure.candidate, "FINAL-15");
    nodeAssert.equal(
      failure.disposition,
      "REJECTED / BASELINE VERIFICATION FAILURE / CI NOT STARTED",
    );
    nodeAssert.equal(failure.ciVerify.invocationCount, 0);
    nodeAssert.equal(failure.ciVerify.authorizationConsumed, false);
    nodeAssert.equal(failure.ciVerify.transferToSuccessor, false);
    nodeAssert.equal(
      failure.generatedBaseline.sha256,
      STAGE5_FINAL15_FAILED_SECURITY_BASELINE_SHA256,
    );
    nodeAssert.equal(failure.stage6Actions, 0);
    nodeAssert.equal(inputManifest.candidate, "FINAL-15");
    nodeAssert.equal(inputManifest.status, "PRE_CI_BASELINE_VERIFICATION_REJECTED");
    nodeAssert.equal(inputManifest.baselineSha256, STAGE5_FINAL15_FAILED_SECURITY_BASELINE_SHA256);
    const archivedInputs = [
      ["package.json", ".hermes/state/stage5-final15-source-inputs/package.json"],
      [
        "tooling/ci/run-stage-5-final15-authoritative-ci.mjs",
        ".hermes/state/stage5-final15-source-inputs/tooling/ci/run-stage-5-final15-authoritative-ci.mjs",
      ],
      [
        "docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md",
        ".hermes/state/stage5-final15-source-inputs/docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md",
      ],
    ];
    for (const [key, relativePath] of archivedInputs) {
      const bytes = await readRegularFile(root, relativePath, `FINAL-15 ${key} source bytes`);
      nodeAssert.equal(sha256(bytes), inputManifest.protectedInputHashes[key]);
    }
    const rejected = baseline.lineage.rejectedFinal15Candidate;
    nodeAssert.equal(rejected?.candidate, "FINAL-15");
    nodeAssert.equal(rejected?.status, "REJECTED / BASELINE VERIFICATION FAILURE / CI NOT STARTED");
    nodeAssert.equal(
      rejected?.failureClass,
      "candidate-generation / baseline-semantic verification",
    );
    nodeAssert.equal(
      rejected?.failedBaselineSha256,
      STAGE5_FINAL15_FAILED_SECURITY_BASELINE_SHA256,
    );
    nodeAssert.equal(rejected?.failureReceiptSha256, STAGE5_FINAL15_FAILURE_RECEIPT_SHA256);
    nodeAssert.equal(rejected?.failureLogSha256, STAGE5_FINAL15_FAILURE_LOG_SHA256);
    nodeAssert.equal(rejected?.ciInvocationCount, 0);
    nodeAssert.equal(rejected?.authorizationConsumed, false);
    nodeAssert.equal(rejected?.authorizationTransferred, false);
    nodeAssert.equal(rejected?.stage6Actions, 0);
  }
};

const phase0RowsFrom = (manifestBytes) => {
  const rows = manifestBytes
    .toString("utf8")
    .split(/\r?\n/u)
    .flatMap((line) => {
      if (!line.startsWith("|") || !line.endsWith("|")) return [];
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/^`|`$/gu, ""));
      return cells.length === 2 && isSafeRelativePath(cells[0]) && SHA256_PATTERN.test(cells[1])
        ? [{ path: cells[0], sha256: cells[1] }]
        : [];
    });
  assert(
    rows.length === PHASE0_ACCEPTED_BASELINE_ENTRY_COUNT,
    "Phase 0 accepted baseline has an unexpected protected-entry count",
  );
  assert(
    new Set(rows.map((row) => row.path)).size === rows.length,
    "Phase 0 accepted baseline contains duplicate protected paths",
  );
  return rows;
};

export const verifyPhase0AcceptedBaselineBytes = async ({ root = process.cwd() } = {}) => {
  const manifestBytes = await readRegularFile(
    root,
    PHASE0_ACCEPTED_BASELINE_PATH,
    "Phase 0 accepted baseline manifest",
  );
  assert(
    sha256(manifestBytes) === PHASE0_ACCEPTED_BASELINE_SHA256,
    "Phase 0 accepted baseline manifest hash mismatch",
  );
  const rows = phase0RowsFrom(manifestBytes);
  const mismatches = [];
  for (const row of rows) {
    const bytes = await readRegularFile(root, row.path, "Phase 0 protected baseline file");
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== row.sha256) {
      mismatches.push({ path: row.path, expectedSha256: row.sha256, actualSha256 });
    }
  }
  assert(
    mismatches.length === 0,
    `Phase 0 protected baseline hash mismatch: ${mismatches.map((entry) => entry.path).join(", ")}`,
  );
  const permissions = await readRegularFile(
    root,
    PHASE0_PERMISSIONS_PATH,
    "Phase 0 permissions document",
  );
  assert(
    sha256(permissions) === PHASE0_PERMISSIONS_SHA256,
    "Phase 0 permissions document does not match its accepted protected hash",
  );
  return {
    result: "PASS",
    manifest: {
      path: PHASE0_ACCEPTED_BASELINE_PATH,
      sha256: sha256(manifestBytes),
      entryCount: rows.length,
    },
    permissions: { path: PHASE0_PERMISSIONS_PATH, sha256: sha256(permissions) },
  };
};

const gitText = (root, args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

export const verifyPhase0AcceptedBaselineLineage = async ({ root = process.cwd() } = {}) => {
  const bytes = await verifyPhase0AcceptedBaselineBytes({ root });
  assert(
    gitText(root, ["cat-file", "-t", PHASE0_ACCEPTED_BASELINE_SOURCE_COMMIT]) === "commit",
    "Phase 0 accepted baseline source commit is unavailable or not a commit",
  );
  const ancestry = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", PHASE0_ACCEPTED_BASELINE_SOURCE_COMMIT, "HEAD"],
    { cwd: root, stdio: "ignore" },
  );
  assert(
    ancestry.status === 0,
    "Phase 0 accepted baseline source commit is not an ancestor of the active candidate",
  );
  const sourceManifest = execFileSync(
    "git",
    ["show", `${PHASE0_ACCEPTED_BASELINE_SOURCE_COMMIT}:${PHASE0_ACCEPTED_BASELINE_PATH}`],
    { cwd: root, maxBuffer: 5 * 1024 * 1024 },
  );
  const currentManifest = await readRegularFile(
    root,
    PHASE0_ACCEPTED_BASELINE_PATH,
    "Phase 0 accepted baseline manifest",
  );
  assert(
    currentManifest.equals(sourceManifest),
    "Phase 0 accepted baseline manifest differs from its recorded source commit",
  );
  const sourcePermissions = execFileSync(
    "git",
    ["show", `${PHASE0_ACCEPTED_BASELINE_SOURCE_COMMIT}:${PHASE0_PERMISSIONS_PATH}`],
    { cwd: root, maxBuffer: 5 * 1024 * 1024 },
  );
  const currentPermissions = await readRegularFile(
    root,
    PHASE0_PERMISSIONS_PATH,
    "Phase 0 permissions document",
  );
  assert(
    currentPermissions.equals(sourcePermissions),
    "Phase 0 permissions document differs from its recorded source commit",
  );
  return {
    ...bytes,
    sourceCommit: PHASE0_ACCEPTED_BASELINE_SOURCE_COMMIT,
    sourceCommitIsAncestor: true,
    result: "PASS",
  };
};

const assertExtensionManifestShape = (
  baseline,
  { requireCandidate, currentCandidateManifest } = {},
) => {
  assert(
    typeof baseline === "object" && baseline !== null && !Array.isArray(baseline),
    "Phase 1 extension baseline is not an object",
  );
  assert(baseline.schemaVersion === 1, "Phase 1 extension baseline schema version is invalid");
  assert(baseline.result === "PASS", "Phase 1 extension baseline result is not PASS");
  assert(
    baseline.baselineId === STAGE5_SECURITY_EXTENSION_BASELINE_ID,
    "Phase 1 extension baseline identity is invalid",
  );
  assert(baseline.stage === "PHASE_1_M1_STAGE_5", "Phase 1 extension baseline stage is invalid");
  assert(
    baseline.stage6Actions === 0,
    "Phase 1 extension baseline must not authorize Stage 6 actions",
  );

  const lineage = baseline.lineage;
  if (requireCandidate) {
    assert(
      lineage?.[`${requireCandidate.toLowerCase().replaceAll("-", "")}Generation`]?.candidate ===
        requireCandidate,
      `Phase 1 baseline is not bound to ${requireCandidate}`,
    );
  }
  assert(
    typeof lineage === "object" && lineage !== null && !Array.isArray(lineage),
    "Phase 1 extension lineage is invalid",
  );
  assert(
    JSON.stringify(lineage.phase0AcceptedBaseline) ===
      JSON.stringify({
        path: PHASE0_ACCEPTED_BASELINE_PATH,
        sha256: PHASE0_ACCEPTED_BASELINE_SHA256,
        sourceCommit: PHASE0_ACCEPTED_BASELINE_SOURCE_COMMIT,
        entryCount: PHASE0_ACCEPTED_BASELINE_ENTRY_COUNT,
      }),
    "Phase 1 extension does not retain the exact Phase 0 baseline lineage",
  );
  assert(
    JSON.stringify(lineage.phase0Permissions) ===
      JSON.stringify({ path: PHASE0_PERMISSIONS_PATH, sha256: PHASE0_PERMISSIONS_SHA256 }),
    "Phase 1 extension does not retain the exact Phase 0 permissions lineage",
  );
  assert(
    typeof lineage.extensionDocument === "object" &&
      lineage.extensionDocument !== null &&
      lineage.extensionDocument.path === STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH &&
      SHA256_PATTERN.test(lineage.extensionDocument.sha256),
    "Phase 1 extension documentation lineage is invalid",
  );
  const expectedPermissionRegistryVersion =
    requireCandidate === "FINAL-15" ||
    requireCandidate === "FINAL-16" ||
    lineage.final15Generation?.candidate === "FINAL-15" ||
    lineage.final16Generation?.candidate === "FINAL-16"
      ? 3
      : 2;
  assert(
    JSON.stringify(lineage.predecessorPhase1ExtensionBaseline) ===
      JSON.stringify({
        path: STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
        sha256: STAGE5_FINAL10_PHASE1_BASELINE_SHA256,
        tag: STAGE5_FINAL9_REJECTED_TAG,
        target: STAGE5_FINAL9_REJECTED_TAG_TARGET,
        verificationResult: "PASS",
        protectedFileCount: 10,
        aggregateSha256: "528b8d760fcc468021e7b8e2dfdd44e20430f17119a11162bb6f93f2754bc668",
      }),
    "FINAL-11 extension baseline does not supersede the exact verified Phase 1 predecessor",
  );
  const final10 = lineage.rejectedFinal10Candidate;
  assert(
    typeof final10 === "object" &&
      final10 !== null &&
      final10.candidate === FINAL10_FAILED_CI_PROVENANCE.candidate &&
      final10.phase === FINAL10_FAILED_CI_PROVENANCE.phase &&
      final10.status === FINAL10_FAILED_CI_PROVENANCE.status &&
      final10.tag === FINAL10_FAILED_CI_PROVENANCE.tag &&
      final10.target === FINAL10_FAILED_CI_PROVENANCE.target &&
      final10.failedGate === FINAL10_FAILED_CI_PROVENANCE.failedGate &&
      final10.command === FINAL10_FAILED_CI_PROVENANCE.command &&
      final10.invocationCount === FINAL10_FAILED_CI_PROVENANCE.invocationCount &&
      final10.result === FINAL10_FAILED_CI_PROVENANCE.result &&
      final10.exitCode === FINAL10_FAILED_CI_PROVENANCE.exitCode &&
      final10.ciLogSha256 === FINAL10_FAILED_CI_PROVENANCE.ciLogSha256 &&
      final10.ciExecutionSha256 === FINAL10_FAILED_CI_PROVENANCE.ciExecutionSha256 &&
      final10.preCiEvidenceIndexSha256 === FINAL10_FAILED_CI_PROVENANCE.preCiEvidenceIndexSha256 &&
      final10.correctionMatrixSha256 === FINAL10_FAILED_CI_PROVENANCE.correctionMatrixSha256 &&
      final10.rejectionRecordSha256 === FINAL10_FAILED_CI_PROVENANCE.rejectionRecordSha256 &&
      final10.previousPhase1BaselineSha256 ===
        FINAL10_FAILED_CI_PROVENANCE.previousPhase1BaselineSha256 &&
      final10.staleBaselinePackageSha256 ===
        FINAL10_FAILED_CI_PROVENANCE.staleBaselinePackageSha256 &&
      SHA256_PATTERN.test(final10.packageSha256AtCi) &&
      final10.packageSha256AtCi !== final10.staleBaselinePackageSha256 &&
      final10.localInvocationGuardSha256 ===
        FINAL10_FAILED_CI_PROVENANCE.localInvocationGuardSha256 &&
      final10.stage6Actions === 0,
    "FINAL-11 extension baseline omits or alters the exact rejected FINAL-10 CI record",
  );
  const final11Generation = lineage.final11Generation;
  const pathDeltas = Array.isArray(final11Generation?.protectedPathDeltas)
    ? final11Generation.protectedPathDeltas
    : [];
  assert(
    final11Generation?.candidate === "FINAL-11" &&
      final11Generation.stage6Actions === 0 &&
      sameArray(
        pathDeltas.map((entry) => entry?.path),
        FINAL11_ALLOWED_PROTECTED_PATH_DELTAS,
      ) &&
      pathDeltas.every(
        (entry) =>
          SHA256_PATTERN.test(entry?.previousSha256) &&
          SHA256_PATTERN.test(entry?.currentSha256) &&
          entry.previousSha256 !== entry.currentSha256,
      ),
    "FINAL-11 extension baseline has an unexpected protected-file delta or Stage 6 action",
  );

  const final12Generation = lineage.final12Generation;
  const final12Deltas = Array.isArray(final12Generation?.protectedPathDeltas)
    ? final12Generation.protectedPathDeltas
    : [];
  assert(
    final12Generation?.candidate === "FINAL-12" &&
      final12Generation.previousBaselineSha256 === STAGE5_FINAL11_SECURITY_BASELINE_SHA256 &&
      final12Generation.stage6Actions === 0 &&
      sameArray(
        final12Deltas.map((entry) => entry?.path),
        FINAL12_ALLOWED_PROTECTED_PATH_DELTAS,
      ) &&
      final12Deltas.every(
        (entry) =>
          SHA256_PATTERN.test(entry?.previousSha256) &&
          SHA256_PATTERN.test(entry?.currentSha256) &&
          entry.previousSha256 !== entry.currentSha256,
      ),
    "FINAL-12 extension baseline has an unexpected protected-file delta or Stage 6 action",
  );
  const rejectedFinal11 = lineage.rejectedFinal11Candidate;
  assert(
    rejectedFinal11?.candidate === "FINAL-11" &&
      rejectedFinal11.status === "REJECTED / CI CONSUMED / FORMAT-GATE FAILURE" &&
      rejectedFinal11.failedGate === "format:check" &&
      rejectedFinal11.invocationCount === 1 &&
      rejectedFinal11.exitCode === 1 &&
      rejectedFinal11.ciLogSha256 ===
        "6e686ec0cf07bee47a155a5fc167f8ad9e55caa9ac2bb9564b755e90745db109" &&
      rejectedFinal11.ciExecutionSha256 ===
        "cfca7be8cb139bd32e4b43e6f7fb847b01b2042a217cec686b3234906a6d2cce" &&
      rejectedFinal11.ciFailedIndexSha256 ===
        "620c4019206ffa97e8456cdb8e6fb3689d27ab1ae86720db5ccabb7e7269b46a" &&
      rejectedFinal11.invocationGuardSha256 ===
        "15a3d5fac1a61e1b354c88a53ca870a0a22d898a06c398622f908738bdf2f473" &&
      rejectedFinal11.rejectionRecordSha256 === STAGE5_FINAL11_REJECTION_RECORD_SHA256 &&
      rejectedFinal11.preFormatSnapshotSha256 === STAGE5_FINAL11_PRE_FORMAT_SNAPSHOT_SHA256 &&
      rejectedFinal11.previousBaselineSha256 === STAGE5_FINAL11_SECURITY_BASELINE_SHA256 &&
      rejectedFinal11.stage6Actions === 0,
    "FINAL-12 baseline must preserve the exact consumed FINAL-11 rejection lineage",
  );
  const final13Generation = lineage.final13Generation;
  const final13Deltas = Array.isArray(final13Generation?.protectedPathDeltas)
    ? final13Generation.protectedPathDeltas
    : [];
  assert(
    final13Generation?.candidate === "FINAL-13" &&
      final13Generation.previousBaselineSha256 === STAGE5_FINAL12_SECURITY_BASELINE_SHA256 &&
      final13Generation.stage6Actions === 0 &&
      sameArray(
        final13Deltas.map((entry) => entry?.path),
        FINAL13_ALLOWED_PROTECTED_PATH_DELTAS,
      ) &&
      final13Deltas.every(
        (entry) =>
          SHA256_PATTERN.test(entry?.previousSha256) &&
          SHA256_PATTERN.test(entry?.currentSha256) &&
          entry.previousSha256 !== entry.currentSha256,
      ),
    "FINAL-13 extension baseline has an unexpected protected-file delta or Stage 6 action",
  );
  const rejectedFinal12 = lineage.rejectedFinal12Candidate;
  assert(
    rejectedFinal12?.candidate === "FINAL-12" &&
      rejectedFinal12.status === "REJECTED / CI CONSUMED / LINT-GATE FAILURE" &&
      rejectedFinal12.failedGate === "lint" &&
      rejectedFinal12.invocationCount === 1 &&
      rejectedFinal12.exitCode === 1 &&
      rejectedFinal12.ciLogSha256 === STAGE5_FINAL12_CI_LOG_SHA256 &&
      rejectedFinal12.ciExecutionSha256 === STAGE5_FINAL12_CI_EXECUTION_SHA256 &&
      rejectedFinal12.ciFailedIndexSha256 === STAGE5_FINAL12_CI_FAILED_INDEX_SHA256 &&
      rejectedFinal12.invocationGuardSha256 === STAGE5_FINAL12_INVOCATION_GUARD_SHA256 &&
      rejectedFinal12.rejectionRecordSha256 === STAGE5_FINAL12_REJECTION_RECORD_SHA256 &&
      rejectedFinal12.rejectionMatrixSha256 === STAGE5_FINAL12_REJECTION_MATRIX_SHA256 &&
      rejectedFinal12.correctionMatrixSha256 === STAGE5_FINAL12_CORRECTION_MATRIX_SHA256 &&
      rejectedFinal12.previousBaselineSha256 === STAGE5_FINAL12_SECURITY_BASELINE_SHA256 &&
      rejectedFinal12.stage6Actions === 0,
    "FINAL-13 baseline must preserve the exact consumed FINAL-12 rejection lineage",
  );
  const final14Generation = lineage.final14Generation;
  if (final14Generation !== undefined) {
    const final14Deltas = Array.isArray(final14Generation.protectedPathDeltas)
      ? final14Generation.protectedPathDeltas
      : [];
    assert(
      final14Generation.candidate === "FINAL-14" &&
        final14Generation.previousBaselineSha256 === STAGE5_FINAL13_SECURITY_BASELINE_SHA256 &&
        final14Generation.stage6Actions === 0 &&
        SHA256_PATTERN.test(final14Generation.packageJsonSha256) &&
        SHA256_PATTERN.test(final14Generation.runnerSha256) &&
        SHA256_PATTERN.test(final14Generation.correctionMatrixSha256) &&
        final14Generation.independentReviewNoGoSha256 === STAGE5_FINAL13_REVIEW_NO_GO_SHA256 &&
        sameArray(
          final14Deltas.map((entry) => entry?.path),
          FINAL13_ALLOWED_PROTECTED_PATH_DELTAS,
        ) &&
        final14Deltas.every(
          (entry) =>
            SHA256_PATTERN.test(entry?.previousSha256) &&
            SHA256_PATTERN.test(entry?.currentSha256) &&
            entry.previousSha256 !== entry.currentSha256,
        ),
      "FINAL-14 extension baseline has invalid predecessor, delta or candidate hashes",
    );
    const rejectedFinal13 = lineage.rejectedFinal13Candidate;
    assert(
      rejectedFinal13?.candidate === "FINAL-13" &&
        rejectedFinal13.status === "REJECTED / CI CONSUMED / CI PASS / INDEPENDENT REVIEW NO-GO" &&
        rejectedFinal13.ciCommand === "corepack pnpm ci:verify" &&
        rejectedFinal13.ciInvocationCount === 1 &&
        rejectedFinal13.ciResult === "PASS" &&
        rejectedFinal13.ciExitCode === 0 &&
        SHA256_PATTERN.test(rejectedFinal13.ciLogSha256) &&
        SHA256_PATTERN.test(rejectedFinal13.ciExecutionSha256) &&
        SHA256_PATTERN.test(rejectedFinal13.invocationGuardSha256) &&
        rejectedFinal13.evidenceIndexSha256 === STAGE5_FINAL13_INDEX_SHA256 &&
        rejectedFinal13.correctionMatrixSha256 === STAGE5_FINAL13_CORRECTION_MATRIX_SHA256 &&
        rejectedFinal13.independentReviewNoGoSha256 === STAGE5_FINAL13_REVIEW_NO_GO_SHA256 &&
        rejectedFinal13.freezeSha256 === STAGE5_FINAL13_FREEZE_SHA256 &&
        rejectedFinal13.stage6Actions === 0,
      "FINAL-14 baseline must preserve FINAL-13's consumed PASS and independent NO-GO",
    );
  }

  const final16Generation = lineage.final16Generation;
  if (final16Generation !== undefined) {
    const deltas = Array.isArray(final16Generation.protectedPathDeltas)
      ? final16Generation.protectedPathDeltas
      : [];
    assert(
      final16Generation.candidate === "FINAL-16" &&
        final16Generation.previousBaselineSha256 ===
          STAGE5_FINAL15_FAILED_SECURITY_BASELINE_SHA256 &&
        final16Generation.stage6Actions === 0 &&
        SHA256_PATTERN.test(final16Generation.packageJsonSha256) &&
        SHA256_PATTERN.test(final16Generation.runnerSha256) &&
        SHA256_PATTERN.test(final16Generation.correctionMatrixSha256) &&
        sameArray(
          deltas.map((entry) => entry?.path),
          ["docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md", "package.json"].toSorted(),
        ) &&
        deltas.every(
          (entry) =>
            SHA256_PATTERN.test(entry?.previousSha256) &&
            SHA256_PATTERN.test(entry?.currentSha256) &&
            entry.previousSha256 !== entry.currentSha256,
        ),
      "FINAL-16 extension baseline has invalid predecessor, delta or candidate hashes",
    );
    const rejected = lineage.rejectedFinal15Candidate;
    assert(
      rejected?.candidate === "FINAL-15" &&
        rejected.status === "REJECTED / BASELINE VERIFICATION FAILURE / CI NOT STARTED" &&
        rejected.failedBaselineSha256 === STAGE5_FINAL15_FAILED_SECURITY_BASELINE_SHA256 &&
        rejected.failureReceiptSha256 === STAGE5_FINAL15_FAILURE_RECEIPT_SHA256 &&
        rejected.failureLogSha256 === STAGE5_FINAL15_FAILURE_LOG_SHA256 &&
        rejected.ciInvocationCount === 0 &&
        rejected.authorizationConsumed === false &&
        rejected.authorizationTransferred === false &&
        rejected.stage6Actions === 0,
      "FINAL-16 baseline must preserve the exact rejected FINAL-15 baseline failure and non-transfer disposition",
    );
  }

  const final17Generation = lineage.final17Generation;
  if (final17Generation !== undefined) {
    const deltas = Array.isArray(final17Generation.protectedPathDeltas)
      ? final17Generation.protectedPathDeltas
      : [];
    const rejected = lineage.rejectedFinal16Candidate;
    assert(
      final17Generation.candidate === "FINAL-17" &&
        final17Generation.previousBaselineSha256 === STAGE5_FINAL16_BASELINE_SHA256 &&
        final17Generation.stage6Actions === 0 &&
        SHA256_PATTERN.test(final17Generation.packageJsonSha256) &&
        SHA256_PATTERN.test(final17Generation.runnerSha256) &&
        SHA256_PATTERN.test(final17Generation.correctionMatrixSha256) &&
        sameArray(
          deltas.map((entry) => entry?.path),
          ["package.json"],
        ) &&
        deltas.every(
          (entry) =>
            SHA256_PATTERN.test(entry?.previousSha256) &&
            SHA256_PATTERN.test(entry?.currentSha256) &&
            entry.previousSha256 !== entry.currentSha256,
        ),
      "FINAL-17 extension baseline has invalid predecessor, delta or candidate hashes",
    );
    assert(
      rejected?.candidate === "FINAL-16" &&
        rejected.status === "REJECTED / PRE-CI PREFLIGHT FAILURE / CI NOT STARTED" &&
        rejected.baselineSha256 === STAGE5_FINAL16_BASELINE_SHA256 &&
        rejected.evidenceIndexSha256 === STAGE5_FINAL16_EVIDENCE_INDEX_SHA256 &&
        rejected.readinessSha256 === STAGE5_FINAL16_READINESS_SHA256 &&
        rejected.failureReceiptSha256 === STAGE5_FINAL16_PREFLIGHT_FAILURE_RECEIPT_SHA256 &&
        rejected.failureLogSha256 === STAGE5_FINAL16_PREFLIGHT_FAILURE_LOG_SHA256 &&
        rejected.ciInvocationCount === 0 &&
        rejected.authorizationConsumed === false &&
        rejected.authorizationTransferred === false &&
        rejected.stage6Actions === 0,
      "FINAL-17 baseline must preserve the exact rejected FINAL-16 preflight and non-transfer disposition",
    );
  }

  const final18Generation = lineage.final18Generation;
  if (final18Generation !== undefined) {
    const deltas = Array.isArray(final18Generation.protectedPathDeltas)
      ? final18Generation.protectedPathDeltas
      : [];
    const rejected = lineage.rejectedFinal17Candidate;
    assert(
      final18Generation.candidate === "FINAL-18" &&
        final18Generation.previousBaselineSha256 === STAGE5_FINAL17_SECURITY_BASELINE_SHA256 &&
        final18Generation.stage6Actions === 0 &&
        SHA256_PATTERN.test(final18Generation.packageJsonSha256) &&
        SHA256_PATTERN.test(final18Generation.runnerSha256) &&
        SHA256_PATTERN.test(final18Generation.correctionMatrixSha256) &&
        sameArray(
          deltas.map((entry) => entry?.path),
          ["docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md", "package.json"].toSorted(),
        ) &&
        deltas.every(
          (entry) =>
            SHA256_PATTERN.test(entry?.previousSha256) &&
            SHA256_PATTERN.test(entry?.currentSha256) &&
            entry.previousSha256 !== entry.currentSha256,
        ),
      "FINAL-18 extension baseline has invalid predecessor, delta or candidate hashes",
    );
    assert(
      rejected?.candidate === "FINAL-17" &&
        rejected.status === "REJECTED / POST-CI SOURCE-SCOPE FAILURE / FREEZE NOT CREATED" &&
        rejected.ciCommand === "corepack pnpm ci:verify" &&
        rejected.ciInvocationCount === 1 &&
        rejected.ciResult === "PASS" &&
        rejected.ciExitCode === 0 &&
        rejected.authorizationConsumed === true &&
        rejected.authorizationTransferred === false &&
        rejected.stage6Actions === 0,
      "FINAL-18 baseline must preserve the consumed FINAL-17 PASS and pre-freeze source-scope rejection",
    );
  }

  const extension = baseline.extension;
  assert(
    typeof extension === "object" && extension !== null && !Array.isArray(extension),
    "Phase 1 extension declaration is invalid",
  );
  assert(
    extension.permissionId === "finance.manage_costs" &&
      extension.permissionRegistryVersion === expectedPermissionRegistryVersion &&
      sameArray(extension.allowedScopeKinds ?? [], ["AGENCY"]) &&
      sameArray(extension.allowedAccessLevels ?? [], ["ALL"]) &&
      extension.ownerRoleReceivesPermission === true &&
      extension.portalEligible === false &&
      extension.stage6Actions === 0,
    "Phase 1 finance-cost permission declaration is invalid",
  );
  assert(
    sameArray(extension.doesNotGrant ?? [], [
      "finance.manage_payments",
      "finance.view_margins",
      "finance.view_prices",
      "portal.access",
    ]),
    "Phase 1 finance-cost permission separation-of-duties declaration is invalid",
  );

  assert(Array.isArray(baseline.protectedFiles), "Phase 1 extension protected files are invalid");
  const hasFinal15Or16Lineage =
    requireCandidate === "FINAL-15" ||
    requireCandidate === "FINAL-16" ||
    requireCandidate === "FINAL-17" ||
    requireCandidate === "FINAL-18" ||
    requireCandidate === "FINAL-19" ||
    baseline.lineage?.final15Generation?.candidate === "FINAL-15" ||
    baseline.lineage?.final16Generation?.candidate === "FINAL-16" ||
    baseline.lineage?.final17Generation?.candidate === "FINAL-17" ||
    baseline.lineage?.final18Generation?.candidate === "FINAL-18" ||
    baseline.lineage?.final19Generation?.candidate === "FINAL-19";
  const expectedProtectedPaths = currentCandidateManifest
    ? currentCandidateManifest.protectedPaths
    : hasFinal15Or16Lineage
      ? STAGE5_FINAL15_SECURITY_EXTENSION_PROTECTED_PATHS
      : STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS;
  const paths = baseline.protectedFiles.map((entry) => entry?.path);
  assert(
    sameArray(paths, expectedProtectedPaths),
    "Phase 1 extension protected-file path set is invalid",
  );
  for (const entry of baseline.protectedFiles) {
    assert(
      typeof entry === "object" &&
        entry !== null &&
        isSafeRelativePath(entry.path) &&
        Number.isSafeInteger(entry.bytes) &&
        entry.bytes > 0 &&
        SHA256_PATTERN.test(entry.sha256),
      "Phase 1 extension protected-file row is invalid",
    );
  }
  assert(
    baseline.aggregateSerialization === AGGREGATE_SERIALIZATION &&
      SHA256_PATTERN.test(baseline.aggregateSha256),
    "Phase 1 extension aggregate declaration is invalid",
  );
  const extensionDocumentRow = baseline.protectedFiles.find(
    (entry) => entry.path === STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
  );
  assert(
    extensionDocumentRow?.sha256 === lineage.extensionDocument.sha256,
    "Phase 1 extension documentation hash is not bound to the protected-file manifest",
  );
  if (final14Generation === undefined) {
    for (const delta of final13Deltas) {
      const currentRow = baseline.protectedFiles.find((entry) => entry.path === delta.path);
      assert(
        currentRow?.sha256 === delta.currentSha256,
        `FINAL-13 protected-file delta is not bound to the active manifest: ${delta.path}`,
      );
    }
  }
};

const verifyExtensionSemantics = async ({
  root,
  protectedBytes,
  requireCandidate,
  baselineManifest,
  currentCandidateManifest,
}) => {
  const documentation = protectedBytes
    .get(STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH)
    ?.toString("utf8");
  const registry = protectedBytes
    .get("packages/backend-core/src/staff-access/permission-registry.ts")
    ?.toString("utf8")
    .replace(/\s+/gu, " ");
  const bootstrap = protectedBytes
    .get("packages/backend-core/src/agency-organization/agency-bootstrap.ts")
    ?.toString("utf8")
    .replace(/\s+/gu, " ");
  const operations = protectedBytes
    .get("packages/backend-core/src/modules/trip-operations/application/m1-staff-operations.ts")
    ?.toString("utf8")
    .replace(/\s+/gu, " ");
  const routes = protectedBytes.get("apps/admin-api/src/m1-routes.ts")?.toString("utf8");
  const repository = protectedBytes
    .get("packages/database/src/trip-operations/m1-operational-slice-repository.ts")
    ?.toString("utf8")
    .replace(/\s+/gu, " ");
  const packageManifest = JSON.parse(protectedBytes.get("package.json")?.toString("utf8") ?? "");
  const verifySource = protectedBytes.get("tooling/ci/verify.mjs")?.toString("utf8") ?? "";
  const final11Runner = (
    await readRegularFile(
      root,
      "tooling/ci/run-stage-5-final11-authoritative-ci.mjs",
      "FINAL-11 authoritative CI runner",
    )
  ).toString("utf8");
  const final12Runner = (
    await readRegularFile(
      root,
      "tooling/ci/run-stage-5-final12-authoritative-ci.mjs",
      "FINAL-12 authoritative CI runner",
    )
  ).toString("utf8");
  const final13Runner = (
    await readRegularFile(
      root,
      "tooling/ci/run-stage-5-final13-authoritative-ci.mjs",
      "FINAL-13 authoritative CI runner",
    )
  ).toString("utf8");
  const final14Runner = (
    await readRegularFile(
      root,
      "tooling/ci/run-stage-5-final14-authoritative-ci.mjs",
      "FINAL-14 authoritative CI runner",
    )
  ).toString("utf8");
  const final10Runner = (
    await readRegularFile(
      root,
      "tooling/ci/run-stage-5-final10-authoritative-ci.mjs",
      "consumed FINAL-10 authoritative CI runner protection stub",
    )
  ).toString("utf8");
  const final16Runner = (
    await readRegularFile(
      root,
      "tooling/ci/run-stage-5-final16-authoritative-ci.mjs",
      "FINAL-16 authoritative CI runner",
    )
  ).toString("utf8");
  const final17Runner = (
    await readRegularFile(
      root,
      "tooling/ci/run-stage-5-final17-authoritative-ci.mjs",
      "FINAL-17 authoritative CI runner",
    )
  ).toString("utf8");
  const final18Runner =
    requireCandidate === "FINAL-18" ||
    requireCandidate === "FINAL-19" ||
    baselineManifest?.lineage?.final18Generation?.candidate === "FINAL-18"
      ? (
          await readRegularFile(
            root,
            "tooling/ci/run-stage-5-final18-authoritative-ci.mjs",
            "FINAL-18 authoritative CI runner",
          )
        ).toString("utf8")
      : "";
  const final19Runner =
    requireCandidate === "FINAL-19" ||
    requireCandidate === "FINAL-20" ||
    baselineManifest?.lineage?.final19Generation?.candidate === "FINAL-19"
      ? (
          await readRegularFile(
            root,
            "tooling/ci/run-stage-5-final19-authoritative-ci.mjs",
            "FINAL-19 authoritative CI runner",
          )
        ).toString("utf8")
      : "";
  const final20Runner =
    requireCandidate === "FINAL-20" ||
    baselineManifest?.lineage?.final20Generation?.candidate === "FINAL-20"
      ? (
          await readRegularFile(
            root,
            "tooling/ci/run-stage-5-final20-authoritative-ci.mjs",
            "FINAL-20 authoritative CI runner",
          )
        ).toString("utf8")
      : "";
  const final21Runner =
    requireCandidate === "FINAL-21" ||
    baselineManifest?.lineage?.final21Generation?.candidate === "FINAL-21"
      ? (
          await readRegularFile(
            root,
            "tooling/ci/run-stage-5-final21-authoritative-ci.mjs",
            "FINAL-21 authoritative CI runner",
          )
        ).toString("utf8")
      : "";

  assert(
    documentation?.includes("`finance.manage_costs`") &&
      documentation.includes("`AGENCY`") &&
      documentation.includes("`ALL`") &&
      documentation.includes("does **not** grant price visibility") &&
      documentation.includes("`finance.view_costs`") &&
      documentation.includes("For FINAL-11") &&
      documentation.includes("For FINAL-12") &&
      documentation.includes("For FINAL-13") &&
      documentation.includes("FINAL-14") &&
      documentation.includes("FINAL-15") &&
      documentation.includes("FINAL-16") &&
      documentation.includes("FINAL-17") &&
      documentation.includes("FINAL-18") &&
      documentation.includes("FINAL-19") &&
      documentation.includes("FINAL-20") &&
      documentation.includes("FINAL-21") &&
      documentation.includes("M1 enforcement boundary") &&
      documentation.includes("FINAL-10") &&
      documentation.includes("only approved content deltas"),
    "Phase 1 extension documentation no longer states the bounded capability semantics",
  );
  assert(
    registry?.includes("export const PERMISSION_REGISTRY_VERSION = 3 as const;") &&
      /id: "staff[.]view",\s+allowedScopeKinds: \["AGENCY"\],\s+allowedAccessLevels: \["ALL"\]/u.test(
        registry,
      ) &&
      /id: "finance[.]view_prices",\s+allowedScopeKinds: \["AGENCY"\],\s+allowedAccessLevels: \["ALL"\]/u.test(
        registry,
      ) &&
      /id: "finance[.]manage_costs", allowedScopeKinds: \["AGENCY"\], allowedAccessLevels: \["ALL"\]/u.test(
        registry,
      ),
    "Code-owned registry must remain AGENCY/ALL-only for M1 permissions in version 3",
  );
  assert(
    bootstrap?.includes("permissionIds: OWNER_ROLE_PERMISSION_IDS") &&
      registry.includes(
        "export const OWNER_ROLE_PERMISSION_IDS: readonly StaffPermissionId[] = STAGE_5_PERMISSION_REGISTRY.map",
      ),
    "Bootstrap owner template is no longer bound to the complete code-owned registry",
  );
  assert(
    operations?.includes('"finance.manage_costs"') &&
      operations.includes(
        "return dependencies.repository.createM1TripSlice(normalizedInput, authorization)",
      ) &&
      operations.includes(
        "return dependencies.repository.updateInternalSupplierNote(normalizedInput, authorization)",
      ),
    "M1 Staff operations no longer authorize restricted supplier-cost command paths",
  );
  if (
    requireCandidate === "FINAL-15" ||
    requireCandidate === "FINAL-16" ||
    requireCandidate === "FINAL-17"
  ) {
    assert(
      operations?.includes("export const M1_OPERATION_PERMISSION_REQUIREMENTS") &&
        repository?.includes("M1_OPERATION_PERMISSION_REQUIREMENTS") &&
        repository.includes("suppliedPermissions.size !== requiredPermissionIds.length") &&
        repository.includes('new M1StaffAuthorizationError("FORBIDDEN")'),
      "FINAL-15 database repository must enforce fixed operation permissions before writes",
    );
  }
  assert(
    routes?.includes("m1Operations: M1StaffTripOperations") &&
      !routes.includes("createM1OperationalSliceRepository"),
    "Admin route boundary no longer consumes the authorization-enforcing M1 facade",
  );
  assert(
    typeof packageManifest.scripts === "object" && packageManifest.scripts !== null,
    "Package scripts are invalid",
  );
  const requiredCiScripts = currentCandidateManifest
    ? getStage5CurrentCandidateScripts(currentCandidateManifest)
    : requireCandidate === "FINAL-21"
      ? REQUIRED_CI_SCRIPTS_FINAL21
      : requireCandidate === "FINAL-20"
        ? REQUIRED_CI_SCRIPTS_FINAL20
        : requireCandidate === "FINAL-19"
          ? REQUIRED_CI_SCRIPTS_FINAL19
          : requireCandidate === "FINAL-18"
            ? REQUIRED_CI_SCRIPTS_FINAL18
            : requireCandidate === "FINAL-17"
              ? REQUIRED_CI_SCRIPTS_FINAL17
              : requireCandidate === "FINAL-16"
                ? REQUIRED_CI_SCRIPTS_FINAL16
                : requireCandidate === "FINAL-15"
                  ? REQUIRED_CI_SCRIPTS_FINAL15
                  : REQUIRED_CI_SCRIPTS;
  for (const [name, command] of Object.entries(requiredCiScripts)) {
    assert(
      packageManifest.scripts[name] === command,
      `Phase 1 extension CI script is missing or changed: ${name}; expected=${command}; actual=${packageManifest.scripts[name]}`,
    );
  }
  const requiredCiGates = currentCandidateManifest
    ? [
        ["stage5-candidate-coherence:pre", "stage5:candidate-coherence:verify"],
        ...REQUIRED_CI_GATES,
      ]
    : REQUIRED_CI_GATES;
  for (const [label, script] of requiredCiGates) {
    assert(
      verifySource.includes(`["${label}", "${script}"]`),
      `Phase 1 extension CI gate is missing or changed: ${label}`,
    );
  }
  const gatePositions = requiredCiGates.map(([label, script]) =>
    verifySource.indexOf(`["${label}", "${script}"]`),
  );
  assert(
    gatePositions.every(
      (position, index) => position >= 0 && (index === 0 || position > gatePositions[index - 1]),
    ),
    "Phase 1 extension gates must run protected pre-check, baseline/source-scope tests, then post-check",
  );
  assert(
    final11Runner.includes('"FINAL-11"') &&
      final11Runner.includes("STAGE5_FINAL11_CI_VERIFY_INVOCATION_GUARD") &&
      final11Runner.includes("const guardPath") &&
      final11Runner.includes("corepack") &&
      final11Runner.includes("ci:verify") &&
      final11Runner.includes("verifyStage5Final11ReadinessPreflight"),
    "FINAL-11 authoritative runner no longer binds its readiness receipt and once-only CI guard",
  );
  assert(
    final12Runner.includes('"FINAL-12"') &&
      final12Runner.includes("STAGE5_FINAL12_CI_VERIFY_INVOCATION_GUARD") &&
      final12Runner.includes("const guardPath") &&
      final12Runner.includes("corepack") &&
      final12Runner.includes("ci:verify") &&
      final12Runner.includes("verifyStage5Final12Readiness"),
    "FINAL-12 runner must bind its readiness receipt and fresh once-only CI guard",
  );
  assert(
    final13Runner.includes('"FINAL-13"') &&
      final13Runner.includes("STAGE5_FINAL13_CI_VERIFY_INVOCATION_GUARD") &&
      final13Runner.includes("const guardPath") &&
      final13Runner.includes("corepack") &&
      final13Runner.includes("ci:verify") &&
      final13Runner.includes("verifyStage5Final13Readiness"),
    "FINAL-13 runner must bind its readiness receipt and fresh once-only CI guard",
  );
  assert(
    final14Runner.includes('"FINAL-14"') &&
      final14Runner.includes("STAGE5_FINAL14_CI_VERIFY_INVOCATION_GUARD") &&
      final14Runner.includes("verifyStage5Final14Readiness") &&
      final14Runner.includes("corepack") &&
      final14Runner.includes("ci:verify") &&
      final14Runner.includes("invocationCount"),
    "FINAL-14 runner must bind current readiness, pins and one-time CI authorization",
  );
  const activeBaseline =
    baselineManifest ??
    JSON.parse(
      (await readFile(path.join(root, STAGE5_SECURITY_EXTENSION_BASELINE_PATH))).toString("utf8"),
    );
  if (
    activeBaseline.lineage.final14Generation?.candidate === "FINAL-14" &&
    activeBaseline.lineage.final15Generation?.candidate !== "FINAL-15"
  ) {
    assert(
      activeBaseline.lineage.final14Generation.runnerSha256 === sha256(Buffer.from(final14Runner)),
      "FINAL-14 runner hash differs from the active protected baseline lineage",
    );
    assert(
      activeBaseline.lineage.final14Generation.packageJsonSha256 ===
        sha256(protectedBytes.get("package.json")),
      "FINAL-14 package.json hash differs from the active protected baseline lineage",
    );
  }
  if (requireCandidate === "FINAL-15") {
    const final15Runner = (
      await readRegularFile(
        root,
        "tooling/ci/run-stage-5-final15-authoritative-ci.mjs",
        "FINAL-15 authoritative CI runner",
      )
    ).toString("utf8");
    assert(
      final15Runner.includes('"FINAL-15"') &&
        final15Runner.includes("STAGE5_FINAL15_CI_VERIFY_INVOCATION_GUARD") &&
        final15Runner.includes("verifyStage5Final15Readiness") &&
        final15Runner.includes("corepack") &&
        final15Runner.includes("ci:verify"),
      "FINAL-15 runner must bind its readiness, pins and once-only CI authorization",
    );
    nodeAssert.equal(
      activeBaseline.lineage.final15Generation?.runnerSha256,
      sha256(Buffer.from(final15Runner)),
      "FINAL-15 runner hash differs from the active protected baseline lineage",
    );
    nodeAssert.equal(
      activeBaseline.lineage.final15Generation?.packageJsonSha256,
      sha256(protectedBytes.get("package.json")),
      "FINAL-15 package.json hash differs from the active protected baseline lineage",
    );
  }
  if (requireCandidate === "FINAL-16") {
    assert(
      final16Runner.includes('"FINAL-16"') &&
        final16Runner.includes("STAGE5_FINAL16_CI_VERIFY_INVOCATION_GUARD") &&
        final16Runner.includes("verifyStage5Final15Readiness") &&
        final16Runner.includes("corepack") &&
        final16Runner.includes("ci:verify"),
      "FINAL-16 runner must bind its readiness, pins and once-only CI authorization",
    );
    nodeAssert.equal(
      activeBaseline.lineage.final16Generation?.runnerSha256,
      sha256(Buffer.from(final16Runner)),
      "FINAL-16 runner hash differs from its baseline lineage",
    );
    nodeAssert.equal(
      activeBaseline.lineage.final16Generation?.packageJsonSha256,
      sha256(protectedBytes.get("package.json")),
      "FINAL-16 package.json hash differs from its baseline lineage",
    );
  }
  if (requireCandidate === "FINAL-17") {
    assert(
      final17Runner.includes('"FINAL-17"') &&
        final17Runner.includes("STAGE5_FINAL17_CI_VERIFY_INVOCATION_GUARD") &&
        final17Runner.includes("verifyStage5Final17Readiness") &&
        final17Runner.includes("corepack") &&
        final17Runner.includes("ci:verify"),
      "FINAL-17 runner must bind its readiness, pins and once-only CI authorization",
    );
    nodeAssert.equal(
      activeBaseline.lineage.final17Generation?.runnerSha256,
      sha256(Buffer.from(final17Runner)),
      "FINAL-17 runner hash differs from its baseline lineage",
    );
    nodeAssert.equal(
      activeBaseline.lineage.final17Generation?.packageJsonSha256,
      sha256(protectedBytes.get("package.json")),
      "FINAL-17 package.json hash differs from its baseline lineage",
    );
  }
  if (requireCandidate === "FINAL-18") {
    assert(
      final18Runner.includes('"FINAL-18"') &&
        final18Runner.includes("STAGE5_FINAL18_CI_VERIFY_INVOCATION_GUARD") &&
        final18Runner.includes("verifyStage5Final18Readiness") &&
        final18Runner.includes("corepack") &&
        final18Runner.includes("ci:verify"),
      "FINAL-18 runner must bind its readiness, pins and once-only CI authorization",
    );
    nodeAssert.equal(
      activeBaseline.lineage.final18Generation?.runnerSha256,
      sha256(Buffer.from(final18Runner)),
      "FINAL-18 runner hash differs from its baseline lineage",
    );
    nodeAssert.equal(
      activeBaseline.lineage.final18Generation?.packageJsonSha256,
      sha256(protectedBytes.get("package.json")),
      "FINAL-18 package.json hash differs from its baseline lineage",
    );
  }
  if (requireCandidate === "FINAL-19") {
    assert(
      final19Runner.includes('"FINAL-19"') &&
        final19Runner.includes("STAGE5_FINAL19_CI_VERIFY_INVOCATION_GUARD") &&
        final19Runner.includes("verifyStage5Final19Readiness") &&
        final19Runner.includes("corepack") &&
        final19Runner.includes("ci:verify"),
      "FINAL-19 runner must bind its readiness, pins and once-only CI authorization",
    );
    nodeAssert.equal(
      activeBaseline.lineage.final19Generation?.candidate,
      "FINAL-19",
      "FINAL-19 baseline generation lineage is missing",
    );
    nodeAssert.equal(
      activeBaseline.lineage.final19Generation?.previousBaselineSha256,
      STAGE5_FINAL18_SECURITY_BASELINE_SHA256,
      "FINAL-19 must preserve the exact FINAL-18 predecessor baseline hash",
    );
    nodeAssert.equal(
      activeBaseline.lineage.final19Generation?.runnerSha256,
      sha256(Buffer.from(final19Runner)),
      "FINAL-19 runner hash differs from its baseline lineage",
    );
    nodeAssert.equal(
      activeBaseline.lineage.final19Generation?.packageJsonSha256,
      sha256(protectedBytes.get("package.json")),
      "FINAL-19 package.json hash differs from its baseline lineage",
    );
    const rejected = activeBaseline.lineage.rejectedFinal18Candidate;
    nodeAssert.equal(rejected?.candidate, "FINAL-18");
    nodeAssert.equal(
      rejected?.status,
      "REJECTED / PRE-CI FINAL VERIFICATION FAILURE / CI NOT STARTED",
    );
    nodeAssert.equal(rejected?.baselineSha256, STAGE5_FINAL18_SECURITY_BASELINE_SHA256);
    nodeAssert.equal(
      rejected?.failureReceiptSha256,
      STAGE5_FINAL18_PREFLIGHT_FAILURE_RECEIPT_SHA256,
    );
    nodeAssert.equal(rejected?.ciVerifyInvoked, false);
    nodeAssert.equal(rejected?.ciInvocationCount, 0);
    nodeAssert.equal(rejected?.authorizationConsumed, false);
    nodeAssert.equal(rejected?.authorizationTransferred, false);
    nodeAssert.equal(rejected?.stage6Actions, 0);
    const receiptBytes = await readRegularFile(
      root,
      STAGE5_FINAL18_PREFLIGHT_FAILURE_RECEIPT,
      "FINAL-18 pre-CI failure receipt",
    );
    nodeAssert.equal(
      sha256(receiptBytes),
      STAGE5_FINAL18_PREFLIGHT_FAILURE_RECEIPT_SHA256,
      "FINAL-18 pre-CI failure receipt bytes changed",
    );
  }
  if (requireCandidate === "FINAL-20") {
    assert(
      final20Runner.includes('"FINAL-20"') &&
        final20Runner.includes("STAGE5_FINAL20_CI_VERIFY_INVOCATION_GUARD") &&
        final20Runner.includes("verifyStage5Final20Readiness") &&
        final20Runner.includes("corepack") &&
        final20Runner.includes("ci:verify"),
      "FINAL-20 runner must bind its readiness, pins and once-only CI authorization",
    );
    nodeAssert.equal(activeBaseline.lineage.final20Generation?.candidate, "FINAL-20");
    nodeAssert.equal(
      activeBaseline.lineage.final20Generation?.previousBaselineSha256,
      STAGE5_FINAL19_SECURITY_BASELINE_SHA256,
    );
    nodeAssert.equal(
      activeBaseline.lineage.final20Generation?.runnerSha256,
      sha256(Buffer.from(final20Runner)),
    );
    nodeAssert.equal(
      activeBaseline.lineage.final20Generation?.packageJsonSha256,
      sha256(protectedBytes.get("package.json")),
    );
    nodeAssert.equal(
      activeBaseline.lineage.final20Generation?.correctionMatrixSha256,
      sha256(await readRegularFile(root, STAGE5_FINAL20_CORRECTION_MATRIX, "FINAL-20 matrix")),
    );
    const rejected = activeBaseline.lineage.rejectedFinal19Candidate;
    nodeAssert.equal(rejected?.candidate, "FINAL-19");
    nodeAssert.equal(
      rejected?.status,
      "REJECTED / PRE-CI EVIDENCE INDEX INCOMPLETE / CI NOT STARTED",
    );
    nodeAssert.equal(rejected?.baselineSha256, STAGE5_FINAL19_SECURITY_BASELINE_SHA256);
    nodeAssert.equal(
      rejected?.failureReceiptSha256,
      STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT_SHA256,
    );
    nodeAssert.equal(rejected?.evidenceIndexCreated, false);
    nodeAssert.equal(rejected?.ciVerifyInvoked, false);
    nodeAssert.equal(rejected?.ciInvocationCount, 0);
    nodeAssert.equal(rejected?.authorizationConsumed, false);
    nodeAssert.equal(rejected?.stage6Actions, 0);
    const receiptBytes = await readRegularFile(
      root,
      STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT,
      "FINAL-19 pre-CI evidence-index failure receipt",
    );
    nodeAssert.equal(sha256(receiptBytes), STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT_SHA256);
  }
  if (requireCandidate === "FINAL-21") {
    assert(
      final21Runner.includes('"FINAL-21"') &&
        final21Runner.includes("STAGE5_FINAL21_CI_VERIFY_INVOCATION_GUARD") &&
        final21Runner.includes("verifyStage5Final21Readiness") &&
        final21Runner.includes("corepack") &&
        final21Runner.includes("ci:verify"),
      "FINAL-21 runner must bind its readiness, pins and once-only CI authorization",
    );
    const generation = activeBaseline.lineage.final21Generation;
    nodeAssert.equal(generation?.candidate, "FINAL-21");
    nodeAssert.equal(generation?.previousBaselineSha256, STAGE5_FINAL20_SECURITY_BASELINE_SHA256);
    nodeAssert.equal(generation?.runnerSha256, sha256(Buffer.from(final21Runner)));
    nodeAssert.equal(generation?.packageJsonSha256, sha256(protectedBytes.get("package.json")));
    nodeAssert.equal(
      generation?.correctionMatrixSha256,
      sha256(await readRegularFile(root, STAGE5_FINAL21_CORRECTION_MATRIX, "FINAL-21 matrix")),
    );
    nodeAssert.equal(generation?.stage6Actions, 0);
    const predecessor = activeBaseline.lineage.predecessorFinal20Candidate;
    nodeAssert.equal(predecessor?.candidate, "FINAL-20");
    nodeAssert.equal(predecessor?.baselineSha256, STAGE5_FINAL20_SECURITY_BASELINE_SHA256);
    nodeAssert.equal(predecessor?.ciVerifyInvoked, true);
    nodeAssert.equal(predecessor?.ciVerifyInvocationCount, 1);
    nodeAssert.equal(predecessor?.authorizationConsumed, true);
    nodeAssert.equal(predecessor?.scanResult, "NOT_RUN");
    nodeAssert.equal(predecessor?.stage6Actions, 0);
  }
  assert(
    final10Runner.includes("FINAL-10 runner is disabled") &&
      !final10Runner.includes("spawnSync(") &&
      !final10Runner.includes("execFileSync("),
    "Consumed FINAL-10 runner must remain a non-runnable protection stub",
  );
  return {
    result: "PASS",
    ciScripts: Object.keys(requiredCiScripts),
    ciGates: requiredCiGates.map(([label]) => label),
  };
};

export const verifyStage5SecurityExtensionBaseline = async ({
  root = process.cwd(),
  expectedBaselineSha256,
  requireCandidate,
  baselineBytesOverride,
  currentCandidateManifest,
} = {}) => {
  if (currentCandidateManifest) {
    assertStage5CandidateManifest(currentCandidateManifest);
    nodeAssert.equal(requireCandidate, currentCandidateManifest.candidate);
  }
  const pinnedBaselineSha256 =
    expectedBaselineSha256 ??
    (requireCandidate === "FINAL-21"
      ? STAGE5_FINAL21_SECURITY_BASELINE_SHA256
      : requireCandidate === "FINAL-20"
        ? STAGE5_FINAL20_SECURITY_BASELINE_SHA256
        : STAGE5_SECURITY_EXTENSION_BASELINE_SHA256);
  assert(
    SHA256_PATTERN.test(pinnedBaselineSha256),
    "Phase 1 extension baseline verifier has no pinned baseline SHA-256",
  );
  const phase0 = await verifyPhase0AcceptedBaselineLineage({ root });
  assert(
    baselineBytesOverride === undefined || Buffer.isBuffer(baselineBytesOverride),
    "Phase 1 extension baseline override must be a Buffer",
  );
  const baselineBytes =
    baselineBytesOverride ??
    (await readRegularFile(
      root,
      STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
      "Phase 1 extension baseline manifest",
    ));
  assert(
    sha256(baselineBytes) === pinnedBaselineSha256,
    "Phase 1 extension baseline manifest does not match its pinned SHA-256",
  );
  let baseline;
  try {
    baseline = JSON.parse(baselineBytes.toString("utf8"));
  } catch {
    throw new Error("Phase 1 extension baseline manifest is not valid JSON");
  }
  assertExtensionManifestShape(baseline, { requireCandidate, currentCandidateManifest });
  await verifyPredecessorPhase1Lineage({ root, baseline });

  const protectedBytes = new Map();
  const mismatches = [];
  for (const entry of baseline.protectedFiles) {
    const bytes = await readRegularFile(root, entry.path, "Phase 1 extension protected file");
    protectedBytes.set(entry.path, bytes);
    const actualSha256 = sha256(bytes);
    if (bytes.length !== entry.bytes || actualSha256 !== entry.sha256) {
      mismatches.push({
        path: entry.path,
        expectedBytes: entry.bytes,
        actualBytes: bytes.length,
        expectedSha256: entry.sha256,
        actualSha256,
      });
    }
  }
  assert(
    mismatches.length === 0,
    `Phase 1 security extension protected-file mismatch: ${mismatches.map((entry) => entry.path).join(", ")}`,
  );
  assert(
    sha256(serializeRows(baseline.protectedFiles)) === baseline.aggregateSha256,
    "Phase 1 extension protected-file aggregate hash mismatch",
  );
  const semantics = await verifyExtensionSemantics({
    root,
    protectedBytes,
    requireCandidate,
    baselineManifest: baseline,
    currentCandidateManifest,
  });
  return {
    schemaVersion: 1,
    result: "PASS",
    phase0,
    phase1: {
      baselinePath: STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
      baselineSha256: sha256(baselineBytes),
      protectedFileCount: baseline.protectedFiles.length,
      aggregateSha256: baseline.aggregateSha256,
      extension: baseline.extension,
    },
    semantics,
  };
};

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  console.log(JSON.stringify(await verifyStage5SecurityExtensionBaseline(), null, 2));
}
