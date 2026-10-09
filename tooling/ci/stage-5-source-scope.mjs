import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import currentCandidateManifest from "./stage-5-current-candidate.json" with { type: "json" };

import {
  STAGE5_FINAL11_CANDIDATE_FREEZE,
  STAGE5_FINAL11_CANDIDATE_VALIDATION,
  STAGE5_FINAL11_CORRECTION_MATRIX,
  STAGE5_FINAL11_EVIDENCE_INDEX,
  STAGE5_FINAL11_FINAL8_REVIEW_ARTIFACT,
  STAGE5_FINAL11_FINAL9_REVIEW_ARTIFACT,
  STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL12_EVIDENCE_INDEX,
  STAGE5_FINAL13_CORRECTION_MATRIX,
  STAGE5_FINAL13_EVIDENCE_INDEX,
  STAGE5_FINAL14_CANDIDATE_VALIDATION,
  STAGE5_FINAL14_CANDIDATE_FREEZE,
  STAGE5_FINAL14_CORRECTION_MATRIX,
  STAGE5_FINAL14_EVIDENCE_INDEX,
  STAGE5_FINAL14_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL15_CANDIDATE_VALIDATION,
  STAGE5_FINAL15_CANDIDATE_FREEZE,
  STAGE5_FINAL15_CORRECTION_MATRIX,
  STAGE5_FINAL15_EVIDENCE_INDEX,
  STAGE5_FINAL15_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL16_CANDIDATE_VALIDATION,
  STAGE5_FINAL16_CANDIDATE_FREEZE,
  STAGE5_FINAL16_CORRECTION_MATRIX,
  STAGE5_FINAL16_EVIDENCE_INDEX,
  STAGE5_FINAL16_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL17_CANDIDATE_VALIDATION,
  STAGE5_FINAL17_CANDIDATE_FREEZE,
  STAGE5_FINAL17_CORRECTION_MATRIX,
  STAGE5_FINAL17_EVIDENCE_INDEX,
  STAGE5_FINAL17_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL18_CANDIDATE_FREEZE,
  STAGE5_FINAL18_CANDIDATE_VALIDATION,
  STAGE5_FINAL18_CORRECTION_MATRIX,
  STAGE5_FINAL18_EVIDENCE_INDEX,
  STAGE5_FINAL18_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL19_CANDIDATE_FREEZE,
  STAGE5_FINAL19_CANDIDATE_VALIDATION,
  STAGE5_FINAL19_CORRECTION_MATRIX,
  STAGE5_FINAL20_CANDIDATE_FREEZE,
  STAGE5_FINAL20_CANDIDATE_VALIDATION,
  STAGE5_FINAL20_CORRECTION_MATRIX,
  STAGE5_FINAL20_EVIDENCE_INDEX,
  STAGE5_FINAL20_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL21_CANDIDATE_FREEZE,
  STAGE5_FINAL21_CANDIDATE_VALIDATION,
  STAGE5_FINAL21_CORRECTION_MATRIX,
  STAGE5_FINAL21_EVIDENCE_INDEX,
  STAGE5_FINAL21_POST_FREEZE_SCAN_REPORT,
} from "./stage-5-candidate-contract.mjs";
import {
  STAGE5_GENERATION_LIFECYCLE_LEDGER,
  validateStage5GenerationLifecycleLedger,
} from "./stage-5-generation-lifecycle-ledger.mjs";

const IGNORED_DIRECTORY_NAMES = new Set([".git", ".vite", "coverage", "dist", "node_modules"]);

export {
  STAGE5_FINAL11_CANDIDATE_FREEZE,
  STAGE5_FINAL11_CANDIDATE_VALIDATION,
  STAGE5_FINAL11_CORRECTION_MATRIX,
  STAGE5_FINAL11_EVIDENCE_INDEX,
  STAGE5_FINAL11_FINAL8_REVIEW_ARTIFACT,
  STAGE5_FINAL11_FINAL9_REVIEW_ARTIFACT,
  STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL12_EVIDENCE_INDEX,
  STAGE5_FINAL13_CORRECTION_MATRIX,
  STAGE5_FINAL13_EVIDENCE_INDEX,
  STAGE5_FINAL14_CANDIDATE_VALIDATION,
  STAGE5_FINAL14_CANDIDATE_FREEZE,
  STAGE5_FINAL14_CORRECTION_MATRIX,
  STAGE5_FINAL14_EVIDENCE_INDEX,
  STAGE5_FINAL14_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL15_CANDIDATE_VALIDATION,
  STAGE5_FINAL15_CANDIDATE_FREEZE,
  STAGE5_FINAL15_CORRECTION_MATRIX,
  STAGE5_FINAL15_EVIDENCE_INDEX,
  STAGE5_FINAL15_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL16_CANDIDATE_VALIDATION,
  STAGE5_FINAL16_CANDIDATE_FREEZE,
  STAGE5_FINAL16_CORRECTION_MATRIX,
  STAGE5_FINAL16_EVIDENCE_INDEX,
  STAGE5_FINAL16_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL17_CANDIDATE_VALIDATION,
  STAGE5_FINAL17_CANDIDATE_FREEZE,
  STAGE5_FINAL17_CORRECTION_MATRIX,
  STAGE5_FINAL17_EVIDENCE_INDEX,
  STAGE5_FINAL17_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL18_CANDIDATE_FREEZE,
  STAGE5_FINAL18_CANDIDATE_VALIDATION,
  STAGE5_FINAL18_CORRECTION_MATRIX,
  STAGE5_FINAL18_EVIDENCE_INDEX,
  STAGE5_FINAL19_CANDIDATE_FREEZE,
  STAGE5_FINAL19_CANDIDATE_VALIDATION,
  STAGE5_FINAL19_CORRECTION_MATRIX,
  STAGE5_FINAL20_CANDIDATE_FREEZE,
  STAGE5_FINAL20_CANDIDATE_VALIDATION,
  STAGE5_FINAL20_CORRECTION_MATRIX,
  STAGE5_FINAL20_EVIDENCE_INDEX,
  STAGE5_FINAL20_POST_FREEZE_SCAN_REPORT,
  STAGE5_FINAL21_CANDIDATE_FREEZE,
  STAGE5_FINAL21_CANDIDATE_VALIDATION,
  STAGE5_FINAL21_CORRECTION_MATRIX,
  STAGE5_FINAL21_EVIDENCE_INDEX,
  STAGE5_FINAL21_POST_FREEZE_SCAN_REPORT,
};
export const STAGE5_HISTORICAL_EVIDENCE_INDEXES = Object.freeze(
  [
    "docs/evidence/phase-1-m1/stage-5/EVIDENCE_INDEX.json",
    "docs/evidence/phase-1-m1/stage-5-corrected/EVIDENCE_INDEX.json",
    "docs/evidence/phase-1-m1/stage-5-final/EVIDENCE_INDEX.json",
    "docs/evidence/phase-1-m1/stage-5-final-2/EVIDENCE_INDEX.json",
    "docs/evidence/phase-1-m1/stage-5-final-3/EVIDENCE_INDEX.json",
    "docs/evidence/phase-1-m1/stage-5-final-4/EVIDENCE_INDEX.json",
    "docs/evidence/phase-1-m1/stage-5-final-5/EVIDENCE_INDEX.json",
    "docs/evidence/phase-1-m1/stage-5-final-6/EVIDENCE_INDEX.json",
    "docs/evidence/phase-1-m1/stage-5-final-7/EVIDENCE_INDEX.json",
    "docs/evidence/phase-1-m1/stage-5-final-8/EVIDENCE_INDEX.json",
    "docs/evidence/phase-1-m1/stage-5-final-9/EVIDENCE_INDEX.json",
    "docs/evidence/phase-1-m1/stage-5-final-10/EVIDENCE_INDEX.json",
  ].toSorted(),
);
export const STAGE5_EXPECTED_EVIDENCE_INDEXES = Object.freeze(
  [
    ...STAGE5_HISTORICAL_EVIDENCE_INDEXES,
    STAGE5_FINAL11_EVIDENCE_INDEX,
    STAGE5_FINAL12_EVIDENCE_INDEX,
    STAGE5_FINAL13_EVIDENCE_INDEX,
    STAGE5_FINAL14_EVIDENCE_INDEX,
    STAGE5_FINAL16_EVIDENCE_INDEX,
    STAGE5_FINAL17_EVIDENCE_INDEX,
    STAGE5_FINAL18_EVIDENCE_INDEX,
    STAGE5_FINAL20_EVIDENCE_INDEX,
    STAGE5_FINAL21_EVIDENCE_INDEX,
  ].toSorted(),
);

const STAGE5_SOURCE_SCOPE_PHASES = new Set(["PRE_INDEX", "FINAL_EVIDENCE", "FINAL_CANDIDATE"]);
const STAGE5_HISTORICAL_POST_FREEZE_SCAN_REPORTS = Object.freeze([
  "docs/evidence/phase-1-m1/post-freeze-scan-reports/STAGE_5_FINAL_9.json",
]);
const STAGE5_ADDITIONAL_DOCUMENT_PATHS = Object.freeze([
  "docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md",
]);

export const STAGE5_REQUIRED_SOURCE_PATHS = Object.freeze([
  "docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md",
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_9_INDEPENDENT_REVIEW.md",
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_10_CORRECTION_MATRIX.json",
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_10_REJECTION_RECORD.md",
  "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json",
  "docs/evidence/phase-1-m1/stage-5-final-10/ci-verify.log",
  "docs/evidence/phase-1-m1/stage-5-final-10/ci-verify-execution.json",
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_11_REJECTION_RECORD.md",
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_12_CORRECTION_MATRIX.json",
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_13_CORRECTION_MATRIX.json",
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_13_CANDIDATE_VALIDATION.md",
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_13_CANDIDATE_FREEZE.md",
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_14_CORRECTION_MATRIX.json",
  "docs/evidence/phase-1-m1/stage-5-final-14/EVIDENCE_INDEX.json",
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_15_CORRECTION_MATRIX.json",
  "tooling/ci/run-stage-5-final15-authoritative-ci.mjs",
  "tooling/ci/generate-stage-5-final15-security-extension-baseline.mjs",
  "tooling/ci/verify-stage-5-final15-security-extension-baseline.mjs",
  "tooling/ci/stage-5-final15-evidence-index.mjs",
  "tooling/ci/stage-5-final15-finding-lineage.mjs",
  "tooling/ci/stage-5-final15-readiness-preflight.mjs",
  "tooling/ci/prepare-stage-5-final15-evidence.mjs",
  "tooling/ci/stage-5-final15-scan-provenance.mjs",
  "tooling/ci/run-stage-5-final16-authoritative-ci.mjs",
  "tooling/ci/run-stage-5-final16-focused.mjs",
  "tooling/ci/run-stage-5-final16-postgresql-qualification.mjs",
  "tooling/ci/generate-stage-5-final16-security-extension-baseline.mjs",
  "tooling/ci/verify-stage-5-final16-security-extension-baseline.mjs",
  "tooling/ci/stage-5-final16-evidence-index.mjs",
  "tooling/ci/stage-5-final16-finding-lineage.mjs",
  "tooling/ci/stage-5-final16-readiness-preflight.mjs",
  "tooling/ci/prepare-stage-5-final16-evidence.mjs",
  "tooling/ci/stage-5-final16-scan-provenance.mjs",
  "tooling/ci/test-stage-5-final16-evidence-index.mjs",
  "tooling/ci/test-stage-5-final16-security-extension-baseline.mjs",
  "tooling/ci/run-stage-5-final17-authoritative-ci.mjs",
  "tooling/ci/run-stage-5-final17-focused.mjs",
  "tooling/ci/run-stage-5-final17-postgresql-qualification.mjs",
  "tooling/ci/generate-stage-5-final17-security-extension-baseline.mjs",
  "tooling/ci/verify-stage-5-final17-security-extension-baseline.mjs",
  "tooling/ci/stage-5-final17-evidence-index.mjs",
  "tooling/ci/stage-5-final17-finding-lineage.mjs",
  "tooling/ci/stage-5-final17-readiness-preflight.mjs",
  "tooling/ci/prepare-stage-5-final17-evidence.mjs",
  "tooling/ci/stage-5-final17-scan-provenance.mjs",
  "tooling/ci/test-stage-5-final17-evidence-index.mjs",
  "tooling/ci/test-stage-5-final17-security-extension-baseline.mjs",
  "tooling/ci/run-stage-5-final18-authoritative-ci.mjs",
  "tooling/ci/run-stage-5-final18-focused.mjs",
  "tooling/ci/run-stage-5-final18-postgresql-qualification.mjs",
  "tooling/ci/generate-stage-5-final18-security-extension-baseline.mjs",
  "tooling/ci/verify-stage-5-final18-security-extension-baseline.mjs",
  "tooling/ci/stage-5-final18-evidence-index.mjs",
  "tooling/ci/test-stage-5-final18-evidence-index.mjs",
  "tooling/ci/stage-5-final18-finding-lineage.mjs",
  "tooling/ci/stage-5-final18-readiness-preflight.mjs",
  "tooling/ci/prepare-stage-5-final18-evidence.mjs",
  "tooling/ci/prepare-stage-5-final18-correction-matrix.mjs",
  "tooling/ci/stage-5-final18-scan-provenance.mjs",
  "tooling/ci/test-stage-5-final18-security-extension-baseline.mjs",
  "tooling/ci/run-stage-5-final19-authoritative-ci.mjs",
  "tooling/ci/run-stage-5-final19-focused.mjs",
  "tooling/ci/run-stage-5-final19-postgresql-qualification.mjs",
  "tooling/ci/generate-stage-5-final19-security-extension-baseline.mjs",
  "tooling/ci/verify-stage-5-final19-security-extension-baseline.mjs",
  "tooling/ci/stage-5-final19-evidence-index.mjs",
  "tooling/ci/test-stage-5-final19-evidence-index.mjs",
  "tooling/ci/stage-5-final19-finding-lineage.mjs",
  "tooling/ci/stage-5-final19-readiness-preflight.mjs",
  "tooling/ci/prepare-stage-5-final19-evidence.mjs",
  "tooling/ci/prepare-stage-5-final19-correction-matrix.mjs",
  "tooling/ci/stage-5-final19-scan-provenance.mjs",
  "tooling/ci/test-stage-5-final19-security-extension-baseline.mjs",
  "tooling/ci/run-stage-5-final20-authoritative-ci.mjs",
  "tooling/ci/run-stage-5-final20-focused.mjs",
  "tooling/ci/run-stage-5-final20-postgresql-qualification.mjs",
  "tooling/ci/generate-stage-5-final20-security-extension-baseline.mjs",
  "tooling/ci/verify-stage-5-final20-security-extension-baseline.mjs",
  "tooling/ci/stage-5-final20-evidence-index.mjs",
  "tooling/ci/test-stage-5-final20-evidence-index.mjs",
  "tooling/ci/stage-5-final20-finding-lineage.mjs",
  "tooling/ci/stage-5-final20-readiness-preflight.mjs",
  "tooling/ci/prepare-stage-5-final20-evidence.mjs",
  "tooling/ci/prepare-stage-5-final20-correction-matrix.mjs",
  "tooling/ci/test-stage-5-final20-security-extension-baseline.mjs",
  "tooling/ci/test-stage-5-final19-preflight-failure.mjs",
  "tooling/ci/stage-5-final20-scan-provenance.mjs",
  "tooling/ci/stage-5-working-tree-snapshot.mjs",
  "tooling/ci/test-stage-5-working-tree-snapshot.mjs",
  "tooling/ci/stage-5-generation-lifecycle-ledger.json",
  "tooling/ci/stage-5-generation-lifecycle-ledger.mjs",
  "tooling/ci/test-stage-5-generation-lifecycle-ledger.mjs",
  "tooling/ci/scan-source-secrets.mjs",
  STAGE5_FINAL16_CORRECTION_MATRIX,
  "migrations/0007_stage5_m1_domain_slice.cjs",
  "migrations/0008_stage5_cardinality_only.cjs",
  "migrations/0009_stage5_revision_and_lock_version_hardening.cjs",
  "migrations/0010_stage5_temporal_persistence_parity.cjs",
  "migrations/checksums.json",
  "packages/backend-core/src/modules/crm/domain/continuity.ts",
  "packages/backend-core/src/modules/finance-operations/domain/supplier-cost.ts",
  "packages/backend-core/src/modules/trip-operations/application/m1-staff-operations.ts",
  "packages/backend-core/src/modules/trip-operations/application/m1-trip-slice.ts",
  "packages/backend-core/src/modules/trip-operations/domain/m1-slice.ts",
  "packages/backend-core/src/shared-kernel/money/money.ts",
  "packages/backend-core/src/shared-kernel/time.ts",
  "packages/backend-core/src/agency-organization/agency-bootstrap.ts",
  "packages/backend-core/src/staff-access/authorization.ts",
  "packages/backend-core/src/staff-access/permission-registry.ts",
  "packages/contracts/src/admin/customers/m1.ts",
  "packages/contracts/src/admin/itinerary/m1.ts",
  "packages/contracts/src/admin/reservations/m1.ts",
  "packages/contracts/src/admin/trips/m1.ts",
  "packages/database/src/trip-operations/m1-operational-slice-repository.ts",
  "packages/database/src/staff-access/staff-access-repository.ts",
  "apps/admin-api/src/auth-bridge.ts",
  "apps/admin-api/src/app.ts",
  "apps/admin-api/src/host-validation.ts",
  "apps/admin-api/src/m1-routes.ts",
  "apps/admin-api/test/host-auth-routing-boundary.test.ts",
  "apps/admin-api/test/m1-authorization-boundary.test.ts",
  "apps/admin-api/test/composed-m1-body-parser.test.ts",
  "apps/admin-api/test/m1-routes.test.ts",
  "apps/portal-api/src/app.ts",
  "apps/portal-api/src/auth-bridge.ts",
  "apps/portal-api/src/host-validation.ts",
  "apps/portal-api/src/main.ts",
  "apps/portal-api/test/health-live.test.ts",
  "apps/portal-api/test/host-routing-boundary.test.ts",
  "tests/integration/stage-5-postgresql.test.ts",
  "package.json",
  "pnpm-lock.yaml",
  "tooling/ci/run-stage-5-focused.mjs",
  "tooling/ci/run-stage-5-authoritative-ci.mjs",
  "tooling/ci/run-stage-5-final10-authoritative-ci.mjs",
  "tooling/ci/prepare-stage-5-final10-evidence.mjs",
  "tooling/ci/run-stage-5-final11-authoritative-ci.mjs",
  "tooling/ci/prepare-stage-5-final11-evidence.mjs",
  "tooling/ci/stage-5-final11-finding-lineage.mjs",
  "tooling/ci/test-stage-5-final11-finding-lineage.mjs",
  "tooling/ci/generate-stage-5-final11-security-extension-baseline.mjs",
  "tooling/ci/stage-5-final11-readiness-preflight.mjs",
  "tooling/ci/run-stage-5-final14-authoritative-ci.mjs",
  "tooling/ci/run-stage-5-final14-postgresql-qualification.mjs",
  "tooling/ci/prepare-stage-5-final14-evidence.mjs",
  "tooling/ci/stage-5-final14-finding-lineage.mjs",
  "tooling/ci/stage-5-final14-evidence-index.mjs",
  "tooling/ci/stage-5-final14-scan-provenance.mjs",
  "tooling/ci/generate-stage-5-final14-security-extension-baseline.mjs",
  "tooling/ci/verify-stage-5-final14-security-extension-baseline.mjs",
  "tooling/ci/stage-5-final14-readiness-preflight.mjs",
  "tooling/ci/test-stage-5-final14-finding-lineage.mjs",
  "tooling/ci/test-stage-5-final14-evidence-index.mjs",
  "tooling/ci/test-stage-5-final14-security-extension-baseline.mjs",
  "tooling/ci/test-stage-5-final14-scan-provenance.mjs",
  "tooling/ci/scan-source-secrets.mjs",
  "tooling/ci/stage-5-candidate-contract.mjs",
  "tooling/ci/stage-5-evidence-index.mjs",
  "tooling/ci/stage-5-finding-lineage.mjs",
  "tooling/ci/stage-5-source-scope.mjs",
  "tooling/ci/verify.mjs",
  "tooling/ci/sensitive-data-scanner.mjs",
  "tooling/ci/stage-5-scan-provenance.mjs",
  "tooling/ci/test-stage-5-evidence-index.mjs",
  "tooling/ci/test-stage-5-finding-lineage.mjs",
  "tooling/ci/test-stage-5-security-extension-baseline.mjs",
  "tooling/ci/test-sensitive-data-scanner.mjs",
  "tooling/ci/test-stage-5-source-scope.mjs",
  "tooling/ci/verify-stage-5-security-extension-baseline.mjs",
  "tooling/database/prepare-postgresql-18.mjs",
  "tooling/database/run-stage-5-disposable.mjs",
  "tooling/testing/vitest.stage-5.config.ts",
]);

const toPosix = (filePath) => filePath.split(path.sep).join("/");
const sortedUnique = (values) =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const readRegularFiles = async (root, relativeDirectory) => {
  const files = [];
  const directoryMetadata = await lstat(path.join(root, relativeDirectory));
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new Error(`Stage 5 source scope root must be a regular directory: ${relativeDirectory}`);
  }
  const walk = async (currentDirectory) => {
    const entries = await readdir(path.join(root, currentDirectory), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = toPosix(path.join(currentDirectory, entry.name));
      if (entry.isSymbolicLink()) {
        throw new Error(`Stage 5 source scan may not follow symbolic links: ${relativePath}`);
      }
      if (entry.isDirectory() && !IGNORED_DIRECTORY_NAMES.has(entry.name)) await walk(relativePath);
      else if (entry.isFile() && !entry.name.endsWith(".tsbuildinfo")) files.push(relativePath);
    }
  };
  await walk(relativeDirectory);
  return files;
};

const readStage5EvidenceFiles = async (root) => {
  const evidenceRoot = "docs/evidence/phase-1-m1";
  const evidenceRootMetadata = await lstat(path.join(root, evidenceRoot));
  if (!evidenceRootMetadata.isDirectory() || evidenceRootMetadata.isSymbolicLink()) {
    throw new Error(`Stage 5 evidence scope root must be a regular directory: ${evidenceRoot}`);
  }
  const entries = await readdir(path.join(root, evidenceRoot), { withFileTypes: true });
  const symlinks = entries.filter((entry) => entry.isSymbolicLink()).map((entry) => entry.name);
  if (symlinks.length > 0) {
    throw new Error(`Stage 5 evidence root may not contain symbolic links: ${symlinks.join(", ")}`);
  }
  const directories = entries
    .filter((entry) => entry.isDirectory() && /^stage-5(?:-|$)/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const files = [];
  for (const directory of directories) {
    files.push(...(await readRegularFiles(root, `${evidenceRoot}/${directory}`)));
  }
  return files;
};

export const validateStage5Final11ScanReceiptDirectory = async ({ root = process.cwd() } = {}) => {
  const receiptDirectory = path.dirname(STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT);
  const absoluteReceiptDirectory = path.join(root, receiptDirectory);
  let entries;
  try {
    const directoryMetadata = await lstat(absoluteReceiptDirectory);
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      throw new Error(`FINAL-11 scan receipt root is not a regular directory: ${receiptDirectory}`);
    }
    entries = await readdir(absoluteReceiptDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return { path: STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT, exists: false, result: "PASS" };
    }
    throw error;
  }
  const allowedNames = new Set([
    ...STAGE5_HISTORICAL_POST_FREEZE_SCAN_REPORTS.map((filePath) => path.basename(filePath)),
    path.basename(STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT),
  ]);
  const invalidEntries = entries
    .filter((entry) => !allowedNames.has(entry.name) || !entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .toSorted();
  if (invalidEntries.length > 0) {
    throw new Error(
      `FINAL-11 post-freeze scan output directory contains unexpected entries: ${invalidEntries.join(", ")}`,
    );
  }
  return {
    path: STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT,
    exists: entries.some(
      (entry) => entry.name === path.basename(STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT),
    ),
    historicalReports: STAGE5_HISTORICAL_POST_FREEZE_SCAN_REPORTS,
    result: "PASS",
  };
};

export const validateStage5Final14ScanReceiptDirectory = async ({ root = process.cwd() } = {}) => {
  const receiptDirectory = path.dirname(STAGE5_FINAL14_POST_FREEZE_SCAN_REPORT);
  const absoluteReceiptDirectory = path.join(root, receiptDirectory);
  let entries;
  try {
    const directoryMetadata = await lstat(absoluteReceiptDirectory);
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      throw new Error(`FINAL-14 scan receipt root is not a regular directory: ${receiptDirectory}`);
    }
    entries = await readdir(absoluteReceiptDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT")
      return { path: STAGE5_FINAL14_POST_FREEZE_SCAN_REPORT, exists: false, result: "PASS" };
    throw error;
  }
  const allowedNames = new Set([
    "STAGE_5_FINAL_14_PREVALIDATION.json",
    "STAGE_5_FINAL_14_ARCHIVE_MANIFEST.json",
    "STAGE_5_FINAL_14_FROZEN_SOURCE_SNAPSHOT.tar.gz",
    "STAGE_5_FINAL_14_INDEPENDENT_REVIEW_NO_GO.json",
    path.basename(STAGE5_FINAL14_POST_FREEZE_SCAN_REPORT),
  ]);
  const invalidEntries = entries
    .filter((entry) => !allowedNames.has(entry.name) || !entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .toSorted();
  if (invalidEntries.length > 0) {
    throw new Error(
      `FINAL-14 scan output directory contains unexpected entries: ${invalidEntries.join(", ")}`,
    );
  }
  return {
    path: STAGE5_FINAL14_POST_FREEZE_SCAN_REPORT,
    exists: entries.some(
      (entry) => entry.name === path.basename(STAGE5_FINAL14_POST_FREEZE_SCAN_REPORT),
    ),
    result: "PASS",
  };
};

export const validateStage5Final15ScanReceiptDirectory = async ({ root = process.cwd() } = {}) => {
  const receiptDirectory = path.dirname(STAGE5_FINAL15_POST_FREEZE_SCAN_REPORT);
  const absoluteReceiptDirectory = path.join(root, receiptDirectory);
  let entries;
  try {
    const directoryMetadata = await lstat(absoluteReceiptDirectory);
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      throw new Error(`FINAL-15 scan receipt root is not a regular directory: ${receiptDirectory}`);
    }
    entries = await readdir(absoluteReceiptDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT")
      return { path: STAGE5_FINAL15_POST_FREEZE_SCAN_REPORT, exists: false, result: "PASS" };
    throw error;
  }
  const allowedNames = new Set([
    "STAGE_5_FINAL_15_PREVALIDATION.json",
    path.basename(STAGE5_FINAL15_POST_FREEZE_SCAN_REPORT),
  ]);
  const invalidEntries = entries
    .filter((entry) => !allowedNames.has(entry.name) || !entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .toSorted();
  if (invalidEntries.length > 0) {
    throw new Error(
      `FINAL-15 scan output directory contains unexpected entries: ${invalidEntries.join(", ")}`,
    );
  }
  return {
    path: STAGE5_FINAL15_POST_FREEZE_SCAN_REPORT,
    exists: entries.some(
      (entry) => entry.name === path.basename(STAGE5_FINAL15_POST_FREEZE_SCAN_REPORT),
    ),
    result: "PASS",
  };
};

export const validateStage5Final16ScanReceiptDirectory = async ({ root = process.cwd() } = {}) => {
  const receiptDirectory = path.dirname(STAGE5_FINAL16_POST_FREEZE_SCAN_REPORT);
  const absoluteReceiptDirectory = path.join(root, receiptDirectory);
  let entries;
  try {
    const directoryMetadata = await lstat(absoluteReceiptDirectory);
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      throw new Error(`FINAL-16 scan receipt root is not a regular directory: ${receiptDirectory}`);
    }
    entries = await readdir(absoluteReceiptDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return { path: STAGE5_FINAL16_POST_FREEZE_SCAN_REPORT, exists: false, result: "PASS" };
    }
    throw error;
  }
  const allowedNames = new Set([
    "STAGE_5_FINAL_16_PREVALIDATION.json",
    "STAGE_5_FINAL_16_ARCHIVE_MANIFEST.json",
    "STAGE_5_FINAL_16_FROZEN_SOURCE_SNAPSHOT.tar.gz",
    "STAGE_5_FINAL_16_INDEPENDENT_REVIEW_GO.json",
    path.basename(STAGE5_FINAL16_POST_FREEZE_SCAN_REPORT),
  ]);
  const invalidEntries = entries
    .filter((entry) => !allowedNames.has(entry.name) || !entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .toSorted();
  if (invalidEntries.length > 0) {
    throw new Error(
      `FINAL-16 scan output directory contains unexpected entries: ${invalidEntries.join(", ")}`,
    );
  }
  return {
    path: STAGE5_FINAL16_POST_FREEZE_SCAN_REPORT,
    exists: entries.some(
      (entry) => entry.name === path.basename(STAGE5_FINAL16_POST_FREEZE_SCAN_REPORT),
    ),
    result: "PASS",
  };
};

export const validateStage5Final17ScanReceiptDirectory = async ({ root = process.cwd() } = {}) => {
  const receiptDirectory = path.dirname(STAGE5_FINAL17_POST_FREEZE_SCAN_REPORT);
  const absoluteReceiptDirectory = path.join(root, receiptDirectory);
  let entries;
  try {
    const directoryMetadata = await lstat(absoluteReceiptDirectory);
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      throw new Error(`FINAL-17 scan receipt root is not a regular directory: ${receiptDirectory}`);
    }
    entries = await readdir(absoluteReceiptDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return { path: STAGE5_FINAL17_POST_FREEZE_SCAN_REPORT, exists: false, result: "PASS" };
    }
    throw error;
  }
  const allowedNames = new Set([
    "STAGE_5_FINAL_17_PREVALIDATION.json",
    "STAGE_5_FINAL_17_ARCHIVE_MANIFEST.json",
    "STAGE_5_FINAL_17_FROZEN_SOURCE_SNAPSHOT.tar.gz",
    "STAGE_5_FINAL_17_INDEPENDENT_REVIEW_GO.json",
    path.basename(STAGE5_FINAL17_POST_FREEZE_SCAN_REPORT),
  ]);
  const invalidEntries = entries
    .filter((entry) => !allowedNames.has(entry.name) || !entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .toSorted();
  if (invalidEntries.length > 0) {
    throw new Error(
      `FINAL-17 scan output directory contains unexpected entries: ${invalidEntries.join(", ")}`,
    );
  }
  return {
    path: STAGE5_FINAL17_POST_FREEZE_SCAN_REPORT,
    exists: entries.some(
      (entry) => entry.name === path.basename(STAGE5_FINAL17_POST_FREEZE_SCAN_REPORT),
    ),
    result: "PASS",
  };
};

export const validateStage5Final18ScanReceiptDirectory = async ({ root = process.cwd() } = {}) => {
  const receiptDirectory = path.dirname(STAGE5_FINAL18_POST_FREEZE_SCAN_REPORT);
  const absoluteReceiptDirectory = path.join(root, receiptDirectory);
  let entries;
  try {
    const directoryMetadata = await lstat(absoluteReceiptDirectory);
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      throw new Error(`FINAL-18 scan receipt root is not a regular directory: ${receiptDirectory}`);
    }
    entries = await readdir(absoluteReceiptDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return { path: STAGE5_FINAL18_POST_FREEZE_SCAN_REPORT, exists: false, result: "PASS" };
    }
    throw error;
  }
  const allowedNames = new Set([
    "STAGE_5_FINAL_18_PREVALIDATION.json",
    "STAGE_5_FINAL_18_ARCHIVE_MANIFEST.json",
    "STAGE_5_FINAL_18_FROZEN_SOURCE_SNAPSHOT.tar.gz",
    "STAGE_5_FINAL_18_INDEPENDENT_REVIEW_GO.json",
    path.basename(STAGE5_FINAL18_POST_FREEZE_SCAN_REPORT),
  ]);
  const invalidEntries = entries
    .filter((entry) => !allowedNames.has(entry.name) || !entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .toSorted();
  if (invalidEntries.length > 0) {
    throw new Error(
      `FINAL-18 scan output directory contains unexpected entries: ${invalidEntries.join(", ")}`,
    );
  }
  return {
    path: STAGE5_FINAL18_POST_FREEZE_SCAN_REPORT,
    exists: entries.some(
      (entry) => entry.name === path.basename(STAGE5_FINAL18_POST_FREEZE_SCAN_REPORT),
    ),
    result: "PASS",
  };
};

export const validateStage5Final20ScanReceiptDirectory = async ({ root = process.cwd() } = {}) => {
  const receiptDirectory = path.dirname(STAGE5_FINAL20_POST_FREEZE_SCAN_REPORT);
  const absoluteReceiptDirectory = path.join(root, receiptDirectory);
  let entries;
  try {
    const directoryMetadata = await lstat(absoluteReceiptDirectory);
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      throw new Error(`FINAL-19 scan receipt root is not a regular directory: ${receiptDirectory}`);
    }
    entries = await readdir(absoluteReceiptDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return { path: STAGE5_FINAL20_POST_FREEZE_SCAN_REPORT, exists: false, result: "PASS" };
    }
    throw error;
  }
  const allowedName = path.basename(STAGE5_FINAL20_POST_FREEZE_SCAN_REPORT);
  const invalidEntries = entries
    .filter((entry) => entry.name !== allowedName || !entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .toSorted();
  if (invalidEntries.length > 0) {
    throw new Error(
      `FINAL-19 scan output directory contains unexpected entries: ${invalidEntries.join(", ")}`,
    );
  }
  return {
    path: STAGE5_FINAL20_POST_FREEZE_SCAN_REPORT,
    exists: entries.some((entry) => entry.name === allowedName),
    result: "PASS",
  };
};

export const validateStage5SourceCoverage = (
  files,
  { phase = "FINAL_EVIDENCE", candidate = "FINAL-21", candidateArtifactHashes } = {},
) => {
  if (!STAGE5_SOURCE_SCOPE_PHASES.has(phase)) {
    throw new Error(`Invalid Stage 5 source-scope phase: ${phase}`);
  }
  const paths = sortedUnique(files);
  const pathSet = new Set(paths);
  const missingRequiredSourcePaths = STAGE5_REQUIRED_SOURCE_PATHS.filter(
    (filePath) => !pathSet.has(filePath),
  );
  const coverage = {
    apps: paths.filter((filePath) => filePath.startsWith("apps/")).length,
    packages: paths.filter((filePath) => filePath.startsWith("packages/")).length,
    tooling: paths.filter((filePath) => filePath.startsWith("tooling/")).length,
    tests: paths.filter((filePath) => filePath.startsWith("tests/")).length,
    migrations: paths.filter((filePath) => filePath.startsWith("migrations/")).length,
    deploy: paths.filter((filePath) => filePath.startsWith("deploy/")).length,
    workflows: paths.filter((filePath) => filePath.startsWith(".github/workflows/")).length,
    stage5Evidence: paths.filter((filePath) =>
      /^docs\/evidence\/phase-1-m1\/stage-5(?:-|\/)/u.test(filePath),
    ).length,
    stage5ReviewMarkdown: paths.filter((filePath) =>
      /^docs\/reviews\/phase-1-m1\/STAGE_5_.*[.]md$/u.test(filePath),
    ).length,
    stage5ReviewRecords: paths.filter((filePath) =>
      /^docs\/reviews\/phase-1-m1\/STAGE_5_.*[.](?:md|json)$/u.test(filePath),
    ).length,
  };
  const stage5EvidenceIndexes = paths.filter((filePath) =>
    /^docs\/evidence\/phase-1-m1\/stage-5(?:-[^/]+)?\/EVIDENCE_INDEX[.]json$/u.test(filePath),
  );
  const currentIndex = `${currentCandidateManifest.evidenceDirectory}/EVIDENCE_INDEX.json`;
  const predecessorIndex = currentCandidateManifest.historicalInputs.predecessorEvidenceIndex;
  const earlierFrozenIndex = "docs/evidence/phase-1-m1/stage-5-final-23/EVIDENCE_INDEX.json";
  const isCurrentCandidate = candidate === currentCandidateManifest.candidate;
  const expectedEvidenceIndexes =
    phase === "PRE_INDEX"
      ? isCurrentCandidate
        ? [...STAGE5_HISTORICAL_EVIDENCE_INDEXES, earlierFrozenIndex, predecessorIndex].toSorted()
        : STAGE5_HISTORICAL_EVIDENCE_INDEXES
      : isCurrentCandidate
        ? [
            ...STAGE5_EXPECTED_EVIDENCE_INDEXES,
            earlierFrozenIndex,
            predecessorIndex,
            currentIndex,
          ].toSorted()
        : STAGE5_EXPECTED_EVIDENCE_INDEXES;
  const missingStage5EvidenceIndexes = expectedEvidenceIndexes.filter(
    (filePath) => !stage5EvidenceIndexes.includes(filePath),
  );
  const unexpectedStage5EvidenceIndexes = stage5EvidenceIndexes.filter(
    (filePath) =>
      !STAGE5_EXPECTED_EVIDENCE_INDEXES.includes(filePath) &&
      filePath !== earlierFrozenIndex &&
      filePath !== predecessorIndex &&
      filePath !== currentIndex,
  );
  const failedCoverage = Object.entries(coverage)
    .filter(([name, count]) => name !== "stage5ReviewMarkdown" && count === 0)
    .map(([name]) => `nonempty:${name}`);
  if (missingStage5EvidenceIndexes.length > 0) {
    failedCoverage.push(
      ...missingStage5EvidenceIndexes.map(
        (filePath) => `stage5-evidence-index-missing:${filePath}`,
      ),
    );
  }
  if (unexpectedStage5EvidenceIndexes.length > 0) {
    failedCoverage.push(
      ...unexpectedStage5EvidenceIndexes.map(
        (filePath) => `stage5-evidence-index-unexpected:${filePath}`,
      ),
    );
  }
  const candidateArtifactPaths = paths.filter((filePath) =>
    /^docs\/reviews\/phase-1-m1\/STAGE_5_FINAL_\d+_CANDIDATE_(?:VALIDATION|FREEZE)[.](?:md|json)$/u.test(
      filePath,
    ),
  );
  const lifecycleLedger = validateStage5GenerationLifecycleLedger(
    candidateArtifactPaths,
    candidateArtifactHashes,
  );
  const lifecycleExpectedArtifacts = [
    ...(STAGE5_GENERATION_LIFECYCLE_LEDGER.chainAnchor.expectedArtifacts ?? []),
    ...STAGE5_GENERATION_LIFECYCLE_LEDGER.generations.flatMap(
      (generation) => generation.expectedArtifacts,
    ),
  ];
  const lifecycleRequiredArtifacts = lifecycleExpectedArtifacts
    .filter((artifact) => artifact.requirement === "REQUIRED")
    .map((artifact) => artifact.path);
  const activeCandidateInputs = isCurrentCandidate
    ? {
        matrix: currentCandidateManifest.correctionMatrix,
        validation: currentCandidateManifest.finalization.validation,
        freeze: currentCandidateManifest.finalization.freeze,
        scan: currentCandidateManifest.finalization.scan,
      }
    : candidate === "FINAL-21"
      ? {
          matrix: STAGE5_FINAL21_CORRECTION_MATRIX,
          validation: STAGE5_FINAL21_CANDIDATE_VALIDATION,
          freeze: STAGE5_FINAL21_CANDIDATE_FREEZE,
          scan: STAGE5_FINAL21_POST_FREEZE_SCAN_REPORT,
        }
      : candidate === "FINAL-20"
        ? {
            matrix: STAGE5_FINAL20_CORRECTION_MATRIX,
            validation: STAGE5_FINAL20_CANDIDATE_VALIDATION,
            freeze: STAGE5_FINAL20_CANDIDATE_FREEZE,
            scan: STAGE5_FINAL20_POST_FREEZE_SCAN_REPORT,
          }
        : null;
  if (!activeCandidateInputs) throw new Error(`Unsupported Stage 5 candidate: ${candidate}`);
  const priorCorrectionMatrices = [
    STAGE5_FINAL11_CORRECTION_MATRIX,
    STAGE5_FINAL13_CORRECTION_MATRIX,
    STAGE5_FINAL14_CORRECTION_MATRIX,
    STAGE5_FINAL15_CORRECTION_MATRIX,
    STAGE5_FINAL16_CORRECTION_MATRIX,
    STAGE5_FINAL17_CORRECTION_MATRIX,
    STAGE5_FINAL18_CORRECTION_MATRIX,
    STAGE5_FINAL19_CORRECTION_MATRIX,
    ...(isCurrentCandidate
      ? [
          STAGE5_FINAL20_CORRECTION_MATRIX,
          STAGE5_FINAL21_CORRECTION_MATRIX,
          "docs/reviews/phase-1-m1/STAGE_5_FINAL_22_CORRECTION_MATRIX.json",
          "docs/reviews/phase-1-m1/STAGE_5_FINAL_23_CORRECTION_MATRIX.json",
          currentCandidateManifest.historicalInputs.predecessorCorrectionMatrix,
        ]
      : []),
  ];
  const requiredFinalCandidateInputs =
    phase === "FINAL_CANDIDATE"
      ? [
          ...priorCorrectionMatrices,
          activeCandidateInputs.matrix,
          ...lifecycleRequiredArtifacts,
          activeCandidateInputs.validation,
          activeCandidateInputs.freeze,
        ]
      : phase === "FINAL_EVIDENCE"
        ? [...priorCorrectionMatrices, activeCandidateInputs.matrix]
        : [];
  const missingFinalCandidateInputs = requiredFinalCandidateInputs.filter(
    (filePath) => !pathSet.has(filePath),
  );
  const failedRequirementIds = [
    ...missingRequiredSourcePaths.map((filePath) => `required:${filePath}`),
    ...failedCoverage,
    ...(pathSet.has(STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT)
      ? [`stage5-scan-receipt-self-inclusion:${STAGE5_FINAL11_POST_FREEZE_SCAN_REPORT}`]
      : []),
    ...(pathSet.has(STAGE5_FINAL14_POST_FREEZE_SCAN_REPORT)
      ? [`stage5-scan-receipt-self-inclusion:${STAGE5_FINAL14_POST_FREEZE_SCAN_REPORT}`]
      : []),
    ...(pathSet.has(STAGE5_FINAL16_POST_FREEZE_SCAN_REPORT)
      ? [`stage5-scan-receipt-self-inclusion:${STAGE5_FINAL16_POST_FREEZE_SCAN_REPORT}`]
      : []),
    ...(pathSet.has(STAGE5_FINAL18_POST_FREEZE_SCAN_REPORT)
      ? [`stage5-scan-receipt-self-inclusion:${STAGE5_FINAL18_POST_FREEZE_SCAN_REPORT}`]
      : []),
    ...(pathSet.has(activeCandidateInputs.scan)
      ? [`stage5-scan-receipt-self-inclusion:${activeCandidateInputs.scan}`]
      : []),
    ...missingFinalCandidateInputs.map(
      (filePath) => `stage5-final-candidate-input-missing:${filePath}`,
    ),
    ...lifecycleLedger.errors.map((message) => `stage5-generation-lifecycle:${message}`),
  ];
  return {
    phase,
    result: failedRequirementIds.length === 0 ? "PASS" : "FAIL",
    filesScanned: paths.length,
    missingRequiredSourcePaths,
    stage5EvidenceIndexes,
    expectedStage5EvidenceIndexes: expectedEvidenceIndexes,
    missingStage5EvidenceIndexes,
    unexpectedStage5EvidenceIndexes,
    finalCandidateInputs: requiredFinalCandidateInputs,
    postFreezeScanReceipt: {
      path: activeCandidateInputs.scan,
      excludedFromScan: true,
      reason: `generated after the ${candidate} candidate scan to avoid self-reference`,
    },
    missingFinalCandidateInputs,
    lifecycleLedger,
    coverage,
    failedRequirementIds,
  };
};

export const excludeActiveStage5ScanReceipt = (files, manifest = currentCandidateManifest) =>
  files.filter((filePath) => filePath !== manifest.finalization.scan);

export const collectStage5SourceFiles = async ({
  root = process.cwd(),
  phase = "FINAL_EVIDENCE",
  candidate = "FINAL-21",
} = {}) => {
  await validateStage5Final11ScanReceiptDirectory({ root });
  await validateStage5Final14ScanReceiptDirectory({ root });
  await validateStage5Final15ScanReceiptDirectory({ root });
  await validateStage5Final16ScanReceiptDirectory({ root });
  await validateStage5Final18ScanReceiptDirectory({ root });
  const postFreezeScanReceipt = await validateStage5Final20ScanReceiptDirectory({ root });
  const sourceDirectories = [
    "apps",
    "packages",
    "tooling",
    "tests",
    "migrations",
    "deploy",
    ".github/workflows",
  ];
  const rootFiles = [
    "AGENTS.md",
    "IDEA.md",
    "eslint.config.mjs",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "prettier.config.mjs",
    "tsconfig.base.json",
    "tsconfig.json",
    "vitest.workspace.ts",
  ];
  const sourceFiles = [];
  for (const directory of sourceDirectories) {
    sourceFiles.push(...(await readRegularFiles(root, directory)));
  }
  for (const filePath of rootFiles) {
    const metadata = await lstat(path.join(root, filePath));
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Stage 5 source-scope root input must be a regular file: ${filePath}`);
    }
  }
  for (const filePath of STAGE5_ADDITIONAL_DOCUMENT_PATHS) {
    const metadata = await lstat(path.join(root, filePath));
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Stage 5 source-scope document input must be a regular file: ${filePath}`);
    }
  }
  sourceFiles.push(
    ...(await readRegularFiles(root, "docs/reviews/phase-1-m1")).filter((filePath) =>
      /^docs\/reviews\/phase-1-m1\/STAGE_5_.*[.](?:md|json)$/u.test(filePath),
    ),
    ...(await readStage5EvidenceFiles(root)),
    ...STAGE5_ADDITIONAL_DOCUMENT_PATHS,
    ...rootFiles,
  );
  // The active final-candidate scan is an output, never an input to its own scope.
  // Keep historical predecessor scans: their frozen bytes are separate inputs.
  const files = sortedUnique(excludeActiveStage5ScanReceipt(sourceFiles));
  const candidateArtifactHashes = {};
  const pinnedArtifacts = [
    ...(STAGE5_GENERATION_LIFECYCLE_LEDGER.chainAnchor.expectedArtifacts ?? []),
    ...STAGE5_GENERATION_LIFECYCLE_LEDGER.generations.flatMap(
      (generation) => generation.expectedArtifacts,
    ),
  ].filter((artifact) => artifact.sha256 && files.includes(artifact.path));
  for (const artifact of pinnedArtifacts) {
    candidateArtifactHashes[artifact.path] = createHash("sha256")
      .update(await readFile(path.join(root, artifact.path)))
      .digest("hex");
  }
  const validation = validateStage5SourceCoverage(files, {
    phase,
    candidate,
    candidateArtifactHashes,
  });
  if (validation.result !== "PASS") {
    throw new Error(`Stage 5 source scan coverage is incomplete: ${JSON.stringify(validation)}`);
  }
  return { files, ...validation, postFreezeScanReceiptState: postFreezeScanReceipt };
};
