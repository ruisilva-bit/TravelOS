import { readdir } from "node:fs/promises";
import path from "node:path";

const IGNORED_DIRECTORY_NAMES = new Set([".git", ".vite", "coverage", "dist", "node_modules"]);

export const STAGE5_REQUIRED_SOURCE_PATHS = Object.freeze([
  "migrations/0007_stage5_m1_domain_slice.cjs",
  "migrations/0008_stage5_cardinality_only.cjs",
  "migrations/0009_stage5_revision_and_lock_version_hardening.cjs",
  "migrations/0010_stage5_temporal_persistence_parity.cjs",
  "migrations/checksums.json",
  "packages/backend-core/src/modules/crm/domain/continuity.ts",
  "packages/backend-core/src/modules/finance-operations/domain/supplier-cost.ts",
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
  "apps/admin-api/test/composed-m1-body-parser.test.ts",
  "apps/admin-api/test/m1-routes.test.ts",
  "tests/integration/stage-5-postgresql.test.ts",
  "tooling/ci/run-stage-5-focused.mjs",
  "tooling/database/prepare-postgresql-18.mjs",
  "tooling/database/run-stage-5-disposable.mjs",
  "tooling/testing/vitest.stage-5.config.ts",
]);

const toPosix = (filePath) => filePath.split(path.sep).join("/");
const sortedUnique = (values) =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const readRegularFiles = async (root, relativeDirectory) => {
  const files = [];
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
  const entries = await readdir(path.join(root, evidenceRoot), { withFileTypes: true });
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

export const validateStage5SourceCoverage = (
  files,
  { requireEvidence = true, expectedStage5EvidenceIndexes } = {},
) => {
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
  };
  const stage5EvidenceIndexes = paths.filter((filePath) =>
    /^docs\/evidence\/phase-1-m1\/stage-5(?:-[^/]+)?\/EVIDENCE_INDEX[.]json$/u.test(filePath),
  );
  const expectedEvidenceIndexes = sortedUnique(expectedStage5EvidenceIndexes ?? []);
  const missingStage5EvidenceIndexes = expectedEvidenceIndexes.filter(
    (filePath) => !stage5EvidenceIndexes.includes(filePath),
  );
  const unexpectedStage5EvidenceIndexes = stage5EvidenceIndexes.filter(
    (filePath) => !expectedEvidenceIndexes.includes(filePath),
  );
  const failedCoverage = Object.entries(coverage)
    .filter(([name, count]) => name !== "stage5ReviewMarkdown" && count === 0)
    .map(([name]) => `nonempty:${name}`);
  if (requireEvidence && expectedEvidenceIndexes.length === 0) {
    failedCoverage.push("stage5-evidence-index-baseline");
  }
  if (requireEvidence && missingStage5EvidenceIndexes.length > 0) {
    failedCoverage.push(
      ...missingStage5EvidenceIndexes.map(
        (filePath) => `stage5-evidence-index-missing:${filePath}`,
      ),
    );
  }
  const failedRequirementIds = [
    ...missingRequiredSourcePaths.map((filePath) => `required:${filePath}`),
    ...failedCoverage,
  ];
  return {
    result: failedRequirementIds.length === 0 ? "PASS" : "FAIL",
    filesScanned: paths.length,
    missingRequiredSourcePaths,
    stage5EvidenceIndexes,
    expectedStage5EvidenceIndexes: expectedEvidenceIndexes,
    missingStage5EvidenceIndexes,
    unexpectedStage5EvidenceIndexes,
    coverage,
    failedRequirementIds,
  };
};

export const collectStage5SourceFiles = async ({
  root = process.cwd(),
  requireEvidence = true,
} = {}) => {
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
  sourceFiles.push(
    ...(await readRegularFiles(root, "docs/reviews/phase-1-m1")).filter((filePath) =>
      /^docs\/reviews\/phase-1-m1\/STAGE_5_.*[.]md$/u.test(filePath),
    ),
    ...(await readStage5EvidenceFiles(root)),
    ...rootFiles,
  );
  const files = sortedUnique(sourceFiles);
  const expectedStage5EvidenceIndexes = files.filter((filePath) =>
    /^docs\/evidence\/phase-1-m1\/stage-5(?:-[^/]+)?\/EVIDENCE_INDEX[.]json$/u.test(filePath),
  );
  const validation = validateStage5SourceCoverage(files, {
    requireEvidence,
    expectedStage5EvidenceIndexes,
  });
  if (validation.result !== "PASS") {
    throw new Error(`Stage 5 source scan coverage is incomplete: ${JSON.stringify(validation)}`);
  }
  return { files, ...validation };
};
