import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const PHASE_0_BASELINE = "docs/reviews/PHASE_0_ACCEPTED_BASELINE.md";
const APPROVED_M1_PLAN = ".hermes/plans/2026-08-14_105849-travelos-phase-1-m1-implementation.md";
const STAGE_2_REVIEW_DIRECTORY = "docs/reviews/phase-1-m1";
const STAGE_2_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-2";
const STAGE_2_EVIDENCE_INDEX = `${STAGE_2_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
const STAGE_2_CORRECTED_VALIDATION = `${STAGE_2_REVIEW_DIRECTORY}/STAGE_2_CORRECTED_CANDIDATE_VALIDATION.md`;
const COLLECTION_MODES = new Set(["FINAL_FREEZE", "PRE_FINAL"]);
const PRE_FINAL_ALLOWED_MISSING_PATHS = [STAGE_2_EVIDENCE_INDEX, STAGE_2_CORRECTED_VALIDATION];
const IGNORED_DIRECTORY_NAMES = new Set([".git", ".vite", "coverage", "dist", "node_modules"]);
const ROOT_INPUTS = [
  ".gitignore",
  ".node-version",
  ".npmrc",
  ".prettierignore",
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
const REQUIRED_CONFIGURATION_INPUTS = [
  "packages/config/src/index.ts",
  "packages/config/src/instance-manifest-json-schema.ts",
  "packages/config/src/instance-manifest.ts",
  "packages/config/test/instance-manifest.test.ts",
  "tooling/ci/write-instance-manifest-schema.ts",
  "deploy/manifests/development.example.json",
  "deploy/manifests/schema/instance-manifest.schema.json",
];
const REQUIRED_SCANNER_INPUTS = [
  "tooling/ci/scan-browser-bundles.mjs",
  "tooling/ci/scan-source-secrets.mjs",
  "tooling/ci/sensitive-data-scanner.mjs",
  "tooling/ci/test-sensitive-data-scanner.mjs",
];
const REQUIRED_FREEZE_COLLECTOR_INPUTS = [
  "tooling/ci/collect-stage-2-freeze-inputs.mjs",
  "tooling/ci/stage-2-freeze-inputs.mjs",
  "tooling/ci/test-stage-2-freeze-inputs.mjs",
];
const COMPOSITION_ROOTS = ["admin-api", "admin-web", "portal-api", "portal-web", "worker"];

const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const toPosix = (filePath) => filePath.split(path.sep).join("/");
const sortedUnique = (values) =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const isRelativeRepositoryPath = (filePath) =>
  filePath.length > 0 &&
  !path.isAbsolute(filePath) &&
  !filePath.split("/").some((segment) => segment === ".." || segment === "");

const readDirectoryFiles = async (root, relativeDirectory) => {
  const files = [];
  const walk = async (currentDirectory) => {
    const entries = await readdir(path.join(root, currentDirectory), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = path.posix.join(currentDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Freeze inputs may not follow symbolic links: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) await walk(relativePath);
      } else if (!entry.name.endsWith(".tsbuildinfo")) {
        files.push(relativePath);
      }
    }
  };
  await walk(relativeDirectory);
  return files;
};

const parseAcceptedBaseline = (content) => {
  const rows = [...content.matchAll(/^\|\s*`([^`]+)`\s*\|\s*`([a-f0-9]{64})`\s*\|\s*$/gm)].map(
    (match) => ({ path: match[1], sha256: match[2] }),
  );
  if (rows.length !== 40 || new Set(rows.map((row) => row.path)).size !== rows.length) {
    throw new Error(
      `Accepted Phase 0 baseline must contain exactly 40 unique rows; found ${rows.length}`,
    );
  }
  return rows;
};

const requirement = (id, description, matches, predicate = (paths) => paths.length > 0) => ({
  id,
  description,
  matchedPaths: sortedUnique(matches),
  result: predicate(matches) ? "PASS" : "FAIL",
});

export const validateStage2FreezeInputEntries = ({
  entries,
  requiredBaselinePaths = [],
  requireStage2EvidenceIndex = true,
  requireCorrectedValidation = true,
}) => {
  const paths = entries.map((entry) => entry.path);
  const pathSet = new Set(paths);
  const stage2ReviewInputs = paths.filter((filePath) =>
    new RegExp(`^${STAGE_2_REVIEW_DIRECTORY}/STAGE_2_.*[.]md$`).test(filePath),
  );
  const existingValidationAndCorrectionReports = stage2ReviewInputs.filter((filePath) =>
    /(?:VALIDATION|CORRECTION)/.test(path.posix.basename(filePath)),
  );
  const playwrightInputs = paths.filter(
    (filePath) => filePath === "playwright.config.ts" || /\/playwright[.]config[.]/.test(filePath),
  );
  const requirements = [
    ...[PHASE_0_BASELINE, APPROVED_M1_PLAN, ...ROOT_INPUTS].map((filePath) =>
      requirement(
        `required:${filePath}`,
        `Required review input ${filePath}`,
        [filePath].filter((candidate) => pathSet.has(candidate)),
      ),
    ),
    requirement(
      "phase-0-baseline-content",
      "Every accepted Phase 0 baseline row is frozen",
      requiredBaselinePaths.filter((filePath) => pathSet.has(filePath)),
      (matches) => matches.length === requiredBaselinePaths.length,
    ),
    requirement(
      "stage-1-corrected-decisions",
      "Corrected Stage 1 decisions and closure inputs are frozen",
      paths.filter(
        (filePath) =>
          /^docs\/implementation\/M1_.*_CORRECTED[.]md$/.test(filePath) ||
          /^docs\/reviews\/phase-1-m1\/STAGE_1_/.test(filePath) ||
          /^docs\/evidence\/phase-1-m1\/stage-1\//.test(filePath),
      ),
      (matches) =>
        matches.some((filePath) => filePath.endsWith("M1_BOOTSTRAP_DECISIONS_CORRECTED.md")) &&
        matches.some((filePath) => filePath.endsWith("STAGE_1_CORRECTED_INDEPENDENT_CLOSURE.md")) &&
        matches.some((filePath) => /^docs\/evidence\/phase-1-m1\/stage-1\//.test(filePath)),
    ),
    requirement(
      "workspace-package-manifests",
      "Every app and package workspace manifest is frozen",
      paths.filter((filePath) => /^(?:apps|packages)\/[^/]+\/package[.]json$/.test(filePath)),
      (matches) => matches.length === 14,
    ),
    requirement(
      "typescript-configurations",
      "Root and workspace TypeScript configurations are frozen",
      paths.filter((filePath) => /(?:^|\/)tsconfig(?:[.][^/]+)?[.]json$/.test(filePath)),
      (matches) =>
        matches.length >= 16 &&
        matches.includes("tsconfig.base.json") &&
        matches.includes("tsconfig.json"),
    ),
    requirement(
      "test-and-lint-configurations",
      "ESLint, Vitest, and the present Playwright configuration are frozen",
      paths.filter(
        (filePath) =>
          filePath === "eslint.config.mjs" ||
          filePath === "vitest.workspace.ts" ||
          filePath.endsWith("vitest.config.ts") ||
          playwrightInputs.includes(filePath),
      ),
      (matches) =>
        matches.includes("eslint.config.mjs") &&
        matches.includes("vitest.workspace.ts") &&
        matches.some((filePath) => filePath.endsWith("vitest.config.ts")) &&
        playwrightInputs.every((filePath) => matches.includes(filePath)),
    ),
    requirement(
      "architecture-policy-runners-fixtures",
      "Architecture policy, configuration, runners, and adversarial fixtures are frozen",
      paths.filter((filePath) => filePath.startsWith("tooling/architecture/")),
      (matches) =>
        matches.includes("tooling/architecture/package-boundary-policy.mjs") &&
        matches.includes("tooling/architecture/check.mjs") &&
        matches.some((filePath) => filePath.includes("/fixtures/")),
    ),
    ...REQUIRED_CONFIGURATION_INPUTS.map((filePath) =>
      requirement(
        `configuration:${filePath}`,
        `Configuration contract input ${filePath}`,
        [filePath].filter((candidate) => pathSet.has(candidate)),
      ),
    ),
    requirement(
      "ci-tooling",
      "Repository-owned CI tooling is frozen",
      paths.filter((filePath) => filePath.startsWith("tooling/ci/")),
      (matches) => matches.length > 10,
    ),
    ...REQUIRED_SCANNER_INPUTS.map((filePath) =>
      requirement(
        `scanner:${filePath}`,
        `Security scanner input ${filePath}`,
        [filePath].filter((candidate) => pathSet.has(candidate)),
      ),
    ),
    ...REQUIRED_FREEZE_COLLECTOR_INPUTS.map((filePath) =>
      requirement(
        `collector:${filePath}`,
        `Freeze collector input ${filePath}`,
        [filePath].filter((candidate) => pathSet.has(candidate)),
      ),
    ),
    requirement(
      "github-actions-workflow",
      "GitHub Actions workflow inputs are frozen",
      paths.filter((filePath) => filePath.startsWith(".github/workflows/")),
    ),
    ...COMPOSITION_ROOTS.map((compositionRoot) =>
      requirement(
        `composition-root:${compositionRoot}`,
        `Composition root ${compositionRoot} is frozen in full`,
        paths.filter((filePath) => filePath.startsWith(`apps/${compositionRoot}/`)),
        (matches) =>
          matches.includes(`apps/${compositionRoot}/package.json`) &&
          matches.some((filePath) =>
            new RegExp(`^apps/${compositionRoot}/src/main[.](?:ts|tsx)$`).test(filePath),
          ),
      ),
    ),
    requirement(
      "stage-2-package-source",
      "Stage 2-owned package source is frozen",
      paths.filter((filePath) => /^packages\/[^/]+\/src\//.test(filePath)),
      (matches) => matches.length >= 9,
    ),
    requirement(
      "stage-2-tests",
      "Stage 2 tests and focused correction suites are frozen",
      paths.filter(
        (filePath) =>
          /\/(?:test|tests)\//.test(filePath) ||
          /^tooling\/(?:architecture|ci)\/test-/.test(filePath) ||
          filePath.endsWith("verify-layered-boundary-fixtures.mjs"),
      ),
      (matches) => matches.length >= 7,
    ),
    requirement(
      "stage-2-evidence-index",
      "The Stage 2 evidence index is frozen",
      paths.filter((filePath) => filePath === STAGE_2_EVIDENCE_INDEX),
      (matches) => !requireStage2EvidenceIndex || matches.length === 1,
    ),
    requirement(
      "stage-2-evidence-artifacts",
      "Retained Stage 2 evidence artifacts are frozen",
      paths.filter(
        (filePath) =>
          filePath.startsWith(`${STAGE_2_EVIDENCE_DIRECTORY}/`) &&
          filePath !== `${STAGE_2_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`,
      ),
    ),
    requirement(
      "stage-2-corrected-validation",
      "The final corrected Stage 2 validation report is frozen",
      paths.filter((filePath) => filePath === STAGE_2_CORRECTED_VALIDATION),
      (matches) => !requireCorrectedValidation || matches.length === 1,
    ),
    requirement(
      "stage-2-review-history",
      "Stage 2 freeze, independent review, validation, and correction history are frozen",
      stage2ReviewInputs,
      (matches) =>
        matches.some((filePath) => filePath.endsWith("STAGE_2_CANDIDATE_FREEZE.md")) &&
        matches.some((filePath) => filePath.endsWith("STAGE_2_INDEPENDENT_REVIEW.md")) &&
        existingValidationAndCorrectionReports.length >= 2 &&
        existingValidationAndCorrectionReports.every((filePath) => matches.includes(filePath)),
    ),
  ];
  const duplicatePaths = paths.filter((filePath, index) => paths.indexOf(filePath) !== index);
  if (duplicatePaths.length > 0) {
    requirements.push(
      requirement(
        "unique-paths",
        "Freeze inputs contain no duplicate paths",
        duplicatePaths,
        () => false,
      ),
    );
  }
  const failedRequirements = requirements.filter((item) => item.result !== "PASS");
  return {
    result: failedRequirements.length === 0 ? "PASS" : "FAIL",
    requirementCount: requirements.length,
    requirements,
    failedRequirementIds: failedRequirements.map((item) => item.id),
  };
};

export const collectStage2FreezeInputs = async ({
  root = process.cwd(),
  excludedOutputPaths = [],
  mode = "FINAL_FREEZE",
} = {}) => {
  if (!COLLECTION_MODES.has(mode)) throw new Error(`Invalid freeze-input collection mode: ${mode}`);
  const preFinal = mode === "PRE_FINAL";
  const exclusions = new Set(excludedOutputPaths.map(toPosix));
  const preFinalOmissions = new Set(preFinal ? PRE_FINAL_ALLOWED_MISSING_PATHS : []);
  for (const filePath of exclusions) {
    if (!isRelativeRepositoryPath(filePath))
      throw new Error(`Invalid freeze-output exclusion: ${filePath}`);
  }

  const categoriesByPath = new Map();
  const add = async (filePath, category) => {
    const normalized = toPosix(filePath);
    if (exclusions.has(normalized) || preFinalOmissions.has(normalized)) return;
    if (!isRelativeRepositoryPath(normalized))
      throw new Error(`Invalid freeze input path: ${normalized}`);
    const details = await stat(path.join(root, normalized));
    if (!details.isFile()) throw new Error(`Freeze input is not a regular file: ${normalized}`);
    const categories = categoriesByPath.get(normalized) ?? new Set();
    categories.add(category);
    categoriesByPath.set(normalized, categories);
  };
  const addDirectory = async (relativeDirectory, category) => {
    for (const filePath of await readDirectoryFiles(root, relativeDirectory))
      await add(filePath, category);
  };

  const acceptedBaselineContent = await readFile(path.join(root, PHASE_0_BASELINE), "utf8");
  const acceptedBaselineRows = parseAcceptedBaseline(acceptedBaselineContent);
  await add(PHASE_0_BASELINE, "accepted-phase-0-baseline-reference");
  for (const row of acceptedBaselineRows) {
    const bytes = await readFile(path.join(root, row.path));
    if (sha256(bytes) !== row.sha256) {
      throw new Error(
        `Accepted Phase 0 baseline mismatch while collecting freeze inputs: ${row.path}`,
      );
    }
    await add(row.path, "accepted-phase-0-baseline-content");
  }

  await add(APPROVED_M1_PLAN, "approved-phase-1-m1-plan");
  for (const filePath of ROOT_INPUTS) await add(filePath, "repository-root-contract");
  try {
    await add("playwright.config.ts", "test-configuration");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const implementationRoots = [".github/workflows", "apps", "packages", "tooling", "deploy"];
  for (const implementationRoot of implementationRoots) {
    await addDirectory(implementationRoot, "stage-2-implementation");
  }

  const stage1ReviewFiles = (await readDirectoryFiles(root, STAGE_2_REVIEW_DIRECTORY)).filter(
    (filePath) => /\/STAGE_1_/.test(filePath),
  );
  for (const filePath of stage1ReviewFiles) await add(filePath, "stage-1-corrected-review-input");
  await addDirectory("docs/evidence/phase-1-m1/stage-1", "stage-1-corrected-evidence-input");
  for (const filePath of [
    "docs/implementation/M1_BOOTSTRAP_DECISIONS_CORRECTED.md",
    "docs/implementation/M1_STAGE_1_CT200_BASELINE_CORRECTED.md",
    "docs/implementation/M1_VERSION_COMPATIBILITY_MATRIX_CORRECTED.md",
  ]) {
    await add(filePath, "stage-1-corrected-decision-input");
  }

  const stage2ReviewFiles = (await readDirectoryFiles(root, STAGE_2_REVIEW_DIRECTORY)).filter(
    (filePath) => /\/STAGE_2_/.test(filePath),
  );
  for (const filePath of stage2ReviewFiles) await add(filePath, "stage-2-review-input");
  await addDirectory(STAGE_2_EVIDENCE_DIRECTORY, "stage-2-retained-evidence");
  try {
    await add(
      "docs/implementation/M1_STAGE_2_CONFIGURATION_CONTRACT.md",
      "stage-2-configuration-contract",
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const entries = [];
  for (const filePath of [...categoriesByPath.keys()].sort((left, right) =>
    left.localeCompare(right),
  )) {
    const bytes = await readFile(path.join(root, filePath));
    entries.push({
      path: filePath,
      bytes: bytes.length,
      sha256: sha256(bytes),
      categories: [...categoriesByPath.get(filePath)].sort((left, right) =>
        left.localeCompare(right),
      ),
    });
  }
  const completeness = validateStage2FreezeInputEntries({
    entries,
    requiredBaselinePaths: acceptedBaselineRows.map((row) => row.path),
    requireStage2EvidenceIndex: !preFinal,
    requireCorrectedValidation: !preFinal,
  });
  if (completeness.result !== "PASS") {
    throw new Error(
      `Stage 2 freeze inputs are incomplete: ${completeness.failedRequirementIds.join(", ")}`,
    );
  }
  return {
    schemaVersion: 1,
    purpose:
      mode === "FINAL_FREEZE"
        ? "Deterministic input set eligible for the self-contained Stage 2 corrected freeze"
        : "Deterministic pre-final readiness input set; never eligible to create a freeze",
    result: "PASS",
    mode,
    finalFreezeCreated: false,
    finalFreezeEligible: mode === "FINAL_FREEZE",
    stage2EvidenceIndexRequired: !preFinal,
    correctedValidationRequired: !preFinal,
    preFinalAllowedMissingPaths: preFinal ? PRE_FINAL_ALLOWED_MISSING_PATHS : [],
    preFinalOmittedPaths: [...preFinalOmissions].sort((left, right) => left.localeCompare(right)),
    exclusions: [...exclusions].sort((left, right) => left.localeCompare(right)),
    entryCount: entries.length,
    aggregateSha256: sha256(
      entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`).join("\n"),
    ),
    completeness,
    entries,
  };
};
