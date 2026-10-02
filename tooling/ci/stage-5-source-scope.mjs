import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import {
  STAGE5_FINAL9_CANDIDATE_FREEZE,
  STAGE5_FINAL9_CANDIDATE_VALIDATION,
  STAGE5_FINAL9_CORRECTION_MATRIX,
  STAGE5_FINAL9_EVIDENCE_INDEX,
  STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT,
  STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT,
} from "./stage-5-candidate-contract.mjs";

const IGNORED_DIRECTORY_NAMES = new Set([".git", ".vite", "coverage", "dist", "node_modules"]);

export {
  STAGE5_FINAL9_CANDIDATE_FREEZE,
  STAGE5_FINAL9_CANDIDATE_VALIDATION,
  STAGE5_FINAL9_CORRECTION_MATRIX,
  STAGE5_FINAL9_EVIDENCE_INDEX,
  STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT,
  STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT,
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
  ].toSorted(),
);
export const STAGE5_EXPECTED_EVIDENCE_INDEXES = Object.freeze(
  [...STAGE5_HISTORICAL_EVIDENCE_INDEXES, STAGE5_FINAL9_EVIDENCE_INDEX].toSorted(),
);

const STAGE5_SOURCE_SCOPE_PHASES = new Set(["PRE_INDEX", "FINAL_EVIDENCE", "FINAL_CANDIDATE"]);
const STAGE5_ADDITIONAL_DOCUMENT_PATHS = Object.freeze([
  "docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md",
]);

export const STAGE5_REQUIRED_SOURCE_PATHS = Object.freeze([
  "docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md",
  "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json",
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
  "apps/admin-api/src/m1-routes.ts",
  "apps/admin-api/test/m1-authorization-boundary.test.ts",
  "apps/admin-api/test/composed-m1-body-parser.test.ts",
  "apps/admin-api/test/m1-routes.test.ts",
  "tests/integration/stage-5-postgresql.test.ts",
  "package.json",
  "pnpm-lock.yaml",
  "tooling/ci/run-stage-5-focused.mjs",
  "tooling/ci/run-stage-5-authoritative-ci.mjs",
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

export const validateStage5Final9ScanReceiptDirectory = async ({ root = process.cwd() } = {}) => {
  const receiptDirectory = path.dirname(STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT);
  const absoluteReceiptDirectory = path.join(root, receiptDirectory);
  let entries;
  try {
    const directoryMetadata = await lstat(absoluteReceiptDirectory);
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      throw new Error(`FINAL-9 scan receipt root is not a regular directory: ${receiptDirectory}`);
    }
    entries = await readdir(absoluteReceiptDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return { path: STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT, exists: false, result: "PASS" };
    }
    throw error;
  }
  const invalidEntries = entries
    .filter(
      (entry) =>
        entry.name !== path.basename(STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT) ||
        !entry.isFile() ||
        entry.isSymbolicLink(),
    )
    .map((entry) => entry.name)
    .toSorted();
  if (invalidEntries.length > 0) {
    throw new Error(
      `FINAL-9 post-freeze scan output directory contains unexpected entries: ${invalidEntries.join(", ")}`,
    );
  }
  return {
    path: STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT,
    exists: entries.some(
      (entry) => entry.name === path.basename(STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT),
    ),
    result: "PASS",
  };
};

export const validateStage5SourceCoverage = (files, { phase = "FINAL_EVIDENCE" } = {}) => {
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
  const expectedEvidenceIndexes =
    phase === "PRE_INDEX" ? STAGE5_HISTORICAL_EVIDENCE_INDEXES : STAGE5_EXPECTED_EVIDENCE_INDEXES;
  const missingStage5EvidenceIndexes = expectedEvidenceIndexes.filter(
    (filePath) => !stage5EvidenceIndexes.includes(filePath),
  );
  const unexpectedStage5EvidenceIndexes = stage5EvidenceIndexes.filter(
    (filePath) => !STAGE5_EXPECTED_EVIDENCE_INDEXES.includes(filePath),
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
  const requiredFinalCandidateInputs =
    phase === "FINAL_CANDIDATE"
      ? [
          STAGE5_FINAL9_CORRECTION_MATRIX,
          STAGE5_FINAL9_CANDIDATE_VALIDATION,
          STAGE5_FINAL9_CANDIDATE_FREEZE,
        ]
      : phase === "FINAL_EVIDENCE"
        ? [STAGE5_FINAL9_CORRECTION_MATRIX]
        : [];
  const missingFinalCandidateInputs = requiredFinalCandidateInputs.filter(
    (filePath) => !pathSet.has(filePath),
  );
  const failedRequirementIds = [
    ...missingRequiredSourcePaths.map((filePath) => `required:${filePath}`),
    ...failedCoverage,
    ...(pathSet.has(STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT)
      ? [`stage5-scan-receipt-self-inclusion:${STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT}`]
      : []),
    ...missingFinalCandidateInputs.map(
      (filePath) => `stage5-final-candidate-input-missing:${filePath}`,
    ),
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
      path: STAGE5_FINAL9_POST_FREEZE_SCAN_REPORT,
      excludedFromScan: true,
      reason: "generated after the final candidate scan to avoid self-reference",
    },
    missingFinalCandidateInputs,
    coverage,
    failedRequirementIds,
  };
};

export const collectStage5SourceFiles = async ({
  root = process.cwd(),
  phase = "FINAL_EVIDENCE",
} = {}) => {
  const postFreezeScanReceipt = await validateStage5Final9ScanReceiptDirectory({ root });
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
  const files = sortedUnique(sourceFiles);
  const validation = validateStage5SourceCoverage(files, { phase });
  if (validation.result !== "PASS") {
    throw new Error(`Stage 5 source scan coverage is incomplete: ${JSON.stringify(validation)}`);
  }
  return { files, ...validation, postFreezeScanReceiptState: postFreezeScanReceipt };
};
