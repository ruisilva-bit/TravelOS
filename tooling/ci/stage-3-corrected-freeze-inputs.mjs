import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { collectStage2FreezeInputs } from "./stage-2-freeze-inputs.mjs";
import {
  STAGE_3_EVIDENCE_DIRECTORY,
  STAGE_3_EVIDENCE_INDEX,
  STAGE_3_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  verifyStage3EvidenceIndex,
} from "../database/stage-3-evidence-contract.mjs";

export const STAGE_3_HISTORICAL_REJECTED_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_3_CANDIDATE_FREEZE.md";
export const STAGE_3_HISTORICAL_REJECTED_FREEZE_SHA256 =
  "466693ee8b1ee7a6e36dd630f4484da66c4af0154c5a913ce421f52f4a6fa388";
export const STAGE_3_CORRECTION_MATRIX = "docs/reviews/phase-1-m1/STAGE_3_REVIEW_CORRECTIONS.md";
export const STAGE_3_CORRECTED_CANDIDATE_VALIDATION =
  "docs/reviews/phase-1-m1/STAGE_3_CORRECTED_CANDIDATE_VALIDATION.md";
export const STAGE_3_CORRECTED_CANDIDATE_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_3_CORRECTED_CANDIDATE_FREEZE.md";
export const STAGE_3_CORRECTED_INDEPENDENT_CLOSURE =
  "docs/reviews/phase-1-m1/STAGE_3_CORRECTED_INDEPENDENT_CLOSURE.md";

const HISTORICAL_REJECTED_FREEZE_BYTES = 41_784;
const ORIGINAL_VALIDATION = "docs/reviews/phase-1-m1/STAGE_3_CANDIDATE_VALIDATION.md";
const IMPLEMENTATION_DOCUMENT = "docs/implementation/M1_STAGE_3_DATABASE_FOUNDATION.md";
const COLLECTION_MODES = new Set(["FINAL_FREEZE", "PRE_FINAL"]);
const PRE_FINAL_ALLOWED_MISSING_PATHS = [
  STAGE_3_EVIDENCE_INDEX,
  STAGE_3_CORRECTED_CANDIDATE_VALIDATION,
];
const IGNORED_DIRECTORY_NAMES = new Set([".git", ".vite", "coverage", "dist", "node_modules"]);
const MIGRATION_PATHS = [
  "migrations/0001_foundation_schemas.cjs",
  "migrations/0002_runtime_schema_boundaries.cjs",
  "migrations/0003_creator_default_privileges.cjs",
  "migrations/checksums.json",
];
const TEST_PATHS = [
  "tests/integration/stage-3-postgresql.test.ts",
  "tests/integration/stage3-privilege-probes.ts",
];
const REQUIRED_DATABASE_TOOLING_PATHS = [
  "tooling/database/build-stage-3-correction-evidence.mjs",
  "tooling/database/build-stage-3-evidence-index.mjs",
  "tooling/database/run-stage-3-ct-validation.ts",
  "tooling/database/stage-3-evidence-contract.mjs",
  "tooling/database/stage-3-role-graph.ts",
  "tooling/database/verify-stage-3-corrections.ts",
  "tooling/database/verify-stage-3-ct-role-graph.ts",
  "tooling/database/verify-stage-3-evidence-index.mjs",
];
const REQUIRED_CORRECTED_FREEZE_TOOLING_PATHS = [
  "tooling/ci/collect-stage-3-corrected-freeze-inputs.mjs",
  "tooling/ci/stage-3-corrected-freeze-inputs.mjs",
  "tooling/ci/verify-stage-3-corrected-candidate-freeze.mjs",
  "tooling/ci/write-stage-3-corrected-candidate-freeze.mjs",
];
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
        throw new Error(`Corrected freeze inputs may not follow symbolic links: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) await walk(relativePath);
      } else if (entry.isFile() && !entry.name.endsWith(".tsbuildinfo")) {
        files.push(relativePath);
      }
    }
  };
  await walk(relativeDirectory);
  return files;
};

const requirement = (id, description, matchedPaths, passed) => ({
  id,
  description,
  matchedPaths: sortedUnique(matchedPaths),
  result: passed ? "PASS" : "FAIL",
});
const exactPathRequirement = (id, description, actualPaths, expectedPaths) => {
  const actual = sortedUnique(actualPaths);
  const expected = sortedUnique(expectedPaths);
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return {
    ...requirement(
      id,
      description,
      actual,
      actual.length === expected.length && actual.every((filePath) => expectedSet.has(filePath)),
    ),
    missingPaths: expected.filter((filePath) => !actualSet.has(filePath)),
    unexpectedPaths: actual.filter((filePath) => !expectedSet.has(filePath)),
  };
};

export const validateStage3CorrectedFreezeInputEntries = ({
  entries,
  requireEvidenceIndex = true,
  requireCorrectedValidation = true,
}) => {
  const paths = entries.map((entry) => entry.path);
  const pathSet = new Set(paths);
  const expectedEvidencePaths = [
    ...STAGE_3_EXPECTED_EVIDENCE_ARTIFACT_NAMES.map(
      (name) => `${STAGE_3_EVIDENCE_DIRECTORY}/${name}`,
    ),
    STAGE_3_EVIDENCE_INDEX,
  ].toSorted();
  const actualEvidencePaths = paths.filter((filePath) =>
    filePath.startsWith(`${STAGE_3_EVIDENCE_DIRECTORY}/`),
  );
  const evidencePathsForMode = requireEvidenceIndex
    ? expectedEvidencePaths
    : expectedEvidencePaths.filter((filePath) => filePath !== STAGE_3_EVIDENCE_INDEX);
  const duplicatePaths = paths.filter((filePath, index) => paths.indexOf(filePath) !== index);
  const forbiddenReviewOutputs = [
    STAGE_3_CORRECTED_CANDIDATE_FREEZE,
    STAGE_3_CORRECTED_INDEPENDENT_CLOSURE,
  ].filter((filePath) => pathSet.has(filePath));
  const requiredPaths = [
    STAGE_3_HISTORICAL_REJECTED_FREEZE,
    STAGE_3_CORRECTION_MATRIX,
    ORIGINAL_VALIDATION,
    IMPLEMENTATION_DOCUMENT,
    "deploy/database/bootstrap-database-and-roles.sql",
    ...REQUIRED_DATABASE_TOOLING_PATHS,
    ...REQUIRED_CORRECTED_FREEZE_TOOLING_PATHS,
  ];
  const requirements = [
    requirement(
      "required-corrected-stage-inputs",
      "Historical rejection, correction matrix, implementation, bootstrap, and corrected tooling are frozen",
      requiredPaths.filter((filePath) => pathSet.has(filePath)),
      requiredPaths.every((filePath) => pathSet.has(filePath)),
    ),
    exactPathRequirement(
      "stage-3-migrations",
      "The Stage 3 migration chain is exact",
      paths.filter((filePath) => filePath.startsWith("migrations/")),
      MIGRATION_PATHS,
    ),
    exactPathRequirement(
      "stage-3-integration-tests",
      "The Stage 3 integration-test set is exact",
      paths.filter((filePath) => filePath.startsWith("tests/")),
      TEST_PATHS,
    ),
    exactPathRequirement(
      "stage-3-corrected-evidence",
      "The definitive corrected Stage 3 evidence directory is exact",
      actualEvidencePaths,
      evidencePathsForMode,
    ),
    requirement(
      "stage-3-corrected-validation",
      "The corrected author validation is frozen",
      [STAGE_3_CORRECTED_CANDIDATE_VALIDATION].filter((filePath) => pathSet.has(filePath)),
      !requireCorrectedValidation || pathSet.has(STAGE_3_CORRECTED_CANDIDATE_VALIDATION),
    ),
    requirement(
      "review-output-exclusion",
      "The corrected freeze and later closure are excluded from their candidate inputs",
      forbiddenReviewOutputs,
      forbiddenReviewOutputs.length === 0,
    ),
    requirement(
      "unique-paths",
      "Corrected freeze inputs contain no duplicate paths",
      duplicatePaths,
      duplicatePaths.length === 0,
    ),
  ];
  const failedRequirements = requirements.filter((item) => item.result !== "PASS");
  return {
    result: failedRequirements.length === 0 ? "PASS" : "FAIL",
    requirementCount: requirements.length,
    requirements,
    failedRequirementIds: failedRequirements.map((item) => item.id),
  };
};

const verifyCorrectionDispositions = async (root) => {
  const readJson = async (relativePath) =>
    JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
  const finding001 = await readJson(`${STAGE_3_EVIDENCE_DIRECTORY}/correction-tos-s3-001.json`);
  const finding002 = await readJson(`${STAGE_3_EVIDENCE_DIRECTORY}/correction-tos-s3-002.json`);
  const ci = await readJson(`${STAGE_3_EVIDENCE_DIRECTORY}/correction-ci-verify.json`);
  const ct = await readJson(`${STAGE_3_EVIDENCE_DIRECTORY}/ct-200-focused-role-topology.json`);
  const expectedStatus = "CORRECTED — PENDING INDEPENDENT CLOSURE";
  const checks = {
    finding001: finding001.result === "PASS" && finding001.status === expectedStatus,
    finding002: finding002.result === "PASS" && finding002.status === expectedStatus,
    ci: ci.result === "PASS" && ci.exitCode === 0,
    ct:
      ct.result === "PASS" &&
      ct.exactGraph?.actualCount === 4 &&
      ct.exactGraph?.missing?.length === 0 &&
      ct.exactGraph?.unexpected?.length === 0 &&
      ct.exactGraph?.duplicateActual?.length === 0,
  };
  return { result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL", checks };
};

export const collectStage3CorrectedFreezeInputs = async ({
  root = process.cwd(),
  excludedOutputPaths = [],
  mode = "FINAL_FREEZE",
} = {}) => {
  if (!COLLECTION_MODES.has(mode)) {
    throw new Error(`Invalid corrected Stage 3 collection mode: ${mode}`);
  }
  const preFinal = mode === "PRE_FINAL";
  const exclusions = new Set(excludedOutputPaths.map(toPosix));
  for (const filePath of exclusions) {
    if (!isRelativeRepositoryPath(filePath)) {
      throw new Error(`Invalid corrected freeze-output exclusion: ${filePath}`);
    }
    if (filePath !== STAGE_3_CORRECTED_CANDIDATE_FREEZE) {
      throw new Error(`Only the corrected Stage 3 freeze may be excluded: ${filePath}`);
    }
  }
  if (!preFinal && !exclusions.has(STAGE_3_CORRECTED_CANDIDATE_FREEZE)) {
    throw new Error("FINAL_FREEZE requires explicit exclusion of its corrected freeze output");
  }
  const preFinalOmissions = new Set(preFinal ? PRE_FINAL_ALLOWED_MISSING_PATHS : []);

  const historicalFreeze = await readFile(path.join(root, STAGE_3_HISTORICAL_REJECTED_FREEZE));
  if (
    historicalFreeze.length !== HISTORICAL_REJECTED_FREEZE_BYTES ||
    sha256(historicalFreeze) !== STAGE_3_HISTORICAL_REJECTED_FREEZE_SHA256
  ) {
    throw new Error("Historical rejected Stage 3 freeze integrity mismatch");
  }

  const base = await collectStage2FreezeInputs({ root, mode: "FINAL_FREEZE" });
  const categoriesByPath = new Map();
  for (const entry of base.entries) categoriesByPath.set(entry.path, new Set(entry.categories));
  const add = async (filePath, category) => {
    const normalized = toPosix(filePath);
    if (exclusions.has(normalized) || preFinalOmissions.has(normalized)) return;
    if (!isRelativeRepositoryPath(normalized)) {
      throw new Error(`Invalid corrected Stage 3 freeze input path: ${normalized}`);
    }
    const details = await lstat(path.join(root, normalized));
    if (details.isSymbolicLink() || !details.isFile()) {
      throw new Error(`Corrected Stage 3 freeze input is not a regular file: ${normalized}`);
    }
    const categories = categoriesByPath.get(normalized) ?? new Set();
    categories.add(category);
    categoriesByPath.set(normalized, categories);
  };
  const addDirectory = async (relativeDirectory, category) => {
    for (const filePath of await readDirectoryFiles(root, relativeDirectory)) {
      await add(filePath, category);
    }
  };

  await addDirectory("migrations", "stage-3-migration-chain");
  await addDirectory("tests", "stage-3-integration-tests");
  await addDirectory("tooling/database", "stage-3-database-tooling");
  await addDirectory("deploy/database", "stage-3-database-bootstrap");
  await addDirectory("packages/backend-core/src/application", "stage-3-transaction-contract");
  await addDirectory("packages/database/src/postgres", "stage-3-postgresql-adapter");
  await add(IMPLEMENTATION_DOCUMENT, "stage-3-implementation-document");
  for (const name of STAGE_3_EXPECTED_EVIDENCE_ARTIFACT_NAMES) {
    await add(`${STAGE_3_EVIDENCE_DIRECTORY}/${name}`, "stage-3-corrected-evidence");
  }
  if (!preFinal) await add(STAGE_3_EVIDENCE_INDEX, "stage-3-corrected-evidence-index");
  await add(STAGE_3_HISTORICAL_REJECTED_FREEZE, "stage-3-historical-rejected-freeze");
  await add(ORIGINAL_VALIDATION, "stage-3-historical-author-validation");
  await add(STAGE_3_CORRECTION_MATRIX, "stage-3-correction-matrix");
  if (!preFinal) {
    await add(STAGE_3_CORRECTED_CANDIDATE_VALIDATION, "stage-3-corrected-validation");
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
  const completeness = validateStage3CorrectedFreezeInputEntries({
    entries,
    requireEvidenceIndex: !preFinal,
    requireCorrectedValidation: !preFinal,
  });
  if (completeness.result !== "PASS") {
    throw new Error(
      `Corrected Stage 3 freeze inputs are incomplete: ${completeness.failedRequirementIds.join(", ")}`,
    );
  }
  const evidenceVerification = preFinal
    ? { result: "NOT_FINAL" }
    : await verifyStage3EvidenceIndex({ root });
  const correctionDispositions = await verifyCorrectionDispositions(root);
  if (!preFinal && evidenceVerification.result !== "PASS") {
    throw new Error("Corrected Stage 3 evidence index is not exact");
  }
  if (correctionDispositions.result !== "PASS") {
    throw new Error("Corrected Stage 3 evidence dispositions are inconsistent");
  }

  return {
    schemaVersion: 1,
    purpose: preFinal
      ? "Deterministic corrected Stage 3 pre-final input set; never freeze eligible"
      : "Deterministic exact input set eligible for corrected Stage 3 independent review",
    result: "PASS",
    mode,
    finalFreezeCreated: false,
    finalFreezeEligible: !preFinal,
    preFinalAllowedMissingPaths: preFinal ? PRE_FINAL_ALLOWED_MISSING_PATHS : [],
    exclusions: [...exclusions].sort((left, right) => left.localeCompare(right)),
    historicalRejectedFreeze: {
      path: STAGE_3_HISTORICAL_REJECTED_FREEZE,
      bytes: historicalFreeze.length,
      sha256: sha256(historicalFreeze),
    },
    evidenceVerification,
    correctionDispositions,
    entryCount: entries.length,
    aggregateAlgorithm: "sha256(path\\0bytes\\0sha256 joined by LF in collector order)",
    aggregateSha256: sha256(
      entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`).join("\n"),
    ),
    completeness,
    entries,
  };
};
