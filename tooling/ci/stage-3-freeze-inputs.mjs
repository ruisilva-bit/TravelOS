import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { collectStage2FreezeInputs } from "./stage-2-freeze-inputs.mjs";

export const STAGE_3_EVIDENCE_DIRECTORY = "docs/evidence/phase-1-m1/stage-3";
export const STAGE_3_EVIDENCE_INDEX = `${STAGE_3_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
export const STAGE_3_CANDIDATE_VALIDATION =
  "docs/reviews/phase-1-m1/STAGE_3_CANDIDATE_VALIDATION.md";
export const STAGE_3_CANDIDATE_FREEZE = "docs/reviews/phase-1-m1/STAGE_3_CANDIDATE_FREEZE.md";
export const STAGE_3_INDEPENDENT_CLOSURE = "docs/reviews/phase-1-m1/STAGE_3_INDEPENDENT_CLOSURE.md";

const STAGE_3_IMPLEMENTATION_DOCUMENT = "docs/implementation/M1_STAGE_3_DATABASE_FOUNDATION.md";
const COLLECTION_MODES = new Set(["FINAL_FREEZE", "PRE_FINAL"]);
const PRE_FINAL_ALLOWED_MISSING_PATHS = [STAGE_3_EVIDENCE_INDEX, STAGE_3_CANDIDATE_VALIDATION];
const IGNORED_DIRECTORY_NAMES = new Set([".git", ".vite", "coverage", "dist", "node_modules"]);
const PROTECTED_STAGE_2_PREDECESSORS = [
  {
    path: "docs/reviews/phase-1-m1/STAGE_2_CORRECTED_CANDIDATE_FREEZE_3.md",
    sha256: "5f2e686c397e7bf9f81b455456e1088cb3c4a897e55e43cd1c09c83fde4ea122",
  },
  {
    path: "docs/reviews/phase-1-m1/STAGE_2_FINAL_INDEPENDENT_CLOSURE.md",
    sha256: "d4171545ee53a34791814d4cddf49080e06f5f0eab131954c3f8ed9baa13ef81",
  },
];
const STAGE_3_MIGRATION_PATHS = [
  "migrations/0001_foundation_schemas.cjs",
  "migrations/0002_runtime_schema_boundaries.cjs",
  "migrations/0003_creator_default_privileges.cjs",
  "migrations/checksums.json",
];
const STAGE_3_TEST_PATHS = [
  "tests/integration/stage-3-postgresql.test.ts",
  "tests/integration/stage3-privilege-probes.ts",
];
const REQUIRED_DATABASE_TOOLING_PATHS = [
  "tooling/database/build-stage-3-evidence-index.mjs",
  "tooling/database/migration-runner.ts",
  "tooling/database/postgresql-18-packages.lock.json",
  "tooling/database/prepare-postgresql-18.mjs",
  "tooling/database/run-migrations.ts",
  "tooling/database/run-stage-3-aggregate.mjs",
  "tooling/database/run-stage-3-ct-validation.ts",
  "tooling/database/run-stage-3-disposable.mjs",
  "tooling/database/stage-3-role-graph.ts",
  "tooling/database/verify-stage-3-corrections.ts",
  "tooling/database/verify-migration-checksums.ts",
];
const REQUIRED_TRANSACTION_PATHS = [
  "packages/backend-core/src/application/transaction.ts",
  "packages/database/src/postgres/postgres-persistence.ts",
];
const REQUIRED_FREEZE_TOOLING_PATHS = [
  "tooling/ci/collect-stage-3-freeze-inputs.mjs",
  "tooling/ci/stage-3-freeze-inputs.mjs",
  "tooling/ci/test-stage-3-freeze-inputs.mjs",
  "tooling/ci/verify-stage-3-candidate-freeze.mjs",
  "tooling/ci/write-stage-3-candidate-freeze.mjs",
];
const EXPECTED_STAGE_3_ARTIFACT_NAMES = [
  "backup-restore.json",
  "ct-200-backup-restore.json",
  "ct-200-bootstrap-migrations.json",
  "ct-200-final-state.json",
  "ct-200-management-pre-state.json",
  "ct-200-postgresql-installation.json",
  "ct-200-runtime-validation.json",
  "ct-200-scope-and-access-cleanup.json",
  "default-public-privileges.json",
  "disposable-bootstrap.json",
  "disposable-cleanup.json",
  "integration-test-execution.json",
  "integration-tests.log",
  "migration-chain.json",
  "migration-concurrency.json",
  "migration-failure-rollback.json",
  "owner-migrator-privileges.json",
  "persistence-build.json",
  "postgresql-package-provenance.json",
  "postgresql-runtime.json",
  "privilege-matrix.json",
  "qualification-summary.json",
  "role-topology.json",
  "stage-2-regression.json",
  "stage-2-regression.log",
  "transaction-results.json",
].toSorted();
const EXPECTED_CT_ARTIFACT_NAMES = EXPECTED_STAGE_3_ARTIFACT_NAMES.filter((name) =>
  name.startsWith("ct-200-"),
);

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
        throw new Error(`Stage 3 freeze inputs may not follow symbolic links: ${relativePath}`);
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
const requiredPathsRequirement = (id, description, paths, requiredPaths) => {
  const pathSet = new Set(paths);
  const matchedPaths = requiredPaths.filter((filePath) => pathSet.has(filePath));
  return requirement(id, description, matchedPaths, matchedPaths.length === requiredPaths.length);
};
const exactPathsRequirement = (id, description, actualPaths, expectedPaths) => {
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

export const validateStage3FreezeInputEntries = ({
  entries,
  requireEvidenceIndex = true,
  requireCandidateValidation = true,
}) => {
  const paths = entries.map((entry) => entry.path);
  const pathSet = new Set(paths);
  const evidencePaths = paths.filter((filePath) =>
    filePath.startsWith(`${STAGE_3_EVIDENCE_DIRECTORY}/`),
  );
  const artifactPaths = evidencePaths.filter((filePath) => filePath !== STAGE_3_EVIDENCE_INDEX);
  const expectedArtifactPaths = EXPECTED_STAGE_3_ARTIFACT_NAMES.map(
    (name) => `${STAGE_3_EVIDENCE_DIRECTORY}/${name}`,
  );
  const ctArtifactPaths = artifactPaths.filter((filePath) =>
    path.posix.basename(filePath).startsWith("ct-200-"),
  );
  const expectedCtArtifactPaths = EXPECTED_CT_ARTIFACT_NAMES.map(
    (name) => `${STAGE_3_EVIDENCE_DIRECTORY}/${name}`,
  );
  const duplicatePaths = paths.filter((filePath, index) => paths.indexOf(filePath) !== index);
  const forbiddenReviewOutputs = [STAGE_3_CANDIDATE_FREEZE, STAGE_3_INDEPENDENT_CLOSURE].filter(
    (filePath) => pathSet.has(filePath),
  );

  const requirements = [
    ...PROTECTED_STAGE_2_PREDECESSORS.map((predecessor) =>
      requiredPathsRequirement(
        `stage-2-predecessor:${predecessor.path}`,
        `Protected Stage 2 predecessor ${predecessor.path} is frozen`,
        paths,
        [predecessor.path],
      ),
    ),
    requiredPathsRequirement(
      "stage-3-implementation-document",
      "The Stage 3 database-foundation contract is frozen",
      paths,
      [STAGE_3_IMPLEMENTATION_DOCUMENT],
    ),
    exactPathsRequirement(
      "stage-3-migrations",
      "The complete Stage 3 migration chain and checksum manifest are frozen",
      paths.filter((filePath) => filePath.startsWith("migrations/")),
      STAGE_3_MIGRATION_PATHS,
    ),
    exactPathsRequirement(
      "stage-3-integration-tests",
      "The complete Stage 3 integration-test set is frozen",
      paths.filter((filePath) => filePath.startsWith("tests/")),
      STAGE_3_TEST_PATHS,
    ),
    requiredPathsRequirement(
      "stage-3-database-bootstrap",
      "The database and role bootstrap is frozen",
      paths,
      ["deploy/database/bootstrap-database-and-roles.sql"],
    ),
    requiredPathsRequirement(
      "stage-3-database-tooling",
      "The Stage 3 database runners, provenance lock, and migration verifier are frozen",
      paths,
      REQUIRED_DATABASE_TOOLING_PATHS,
    ),
    requiredPathsRequirement(
      "stage-3-transaction-boundary",
      "The vendor-neutral transaction contract and PostgreSQL adapter are frozen",
      paths,
      REQUIRED_TRANSACTION_PATHS,
    ),
    requiredPathsRequirement(
      "stage-3-freeze-tooling",
      "The Stage 3 collector, writer, verifier, and regression test are frozen",
      paths,
      REQUIRED_FREEZE_TOOLING_PATHS,
    ),
    exactPathsRequirement(
      "stage-3-authoritative-evidence-artifacts",
      "Exactly the final disposable and seven controlled CT evidence artifacts are frozen",
      artifactPaths,
      expectedArtifactPaths,
    ),
    exactPathsRequirement(
      "stage-3-controlled-ct-evidence",
      "Exactly seven sanitized CT 200 artifacts are frozen",
      ctArtifactPaths,
      expectedCtArtifactPaths,
    ),
    requirement(
      "stage-3-evidence-index",
      "The final Stage 3 evidence index is frozen",
      [STAGE_3_EVIDENCE_INDEX].filter((filePath) => pathSet.has(filePath)),
      !requireEvidenceIndex || pathSet.has(STAGE_3_EVIDENCE_INDEX),
    ),
    requirement(
      "stage-3-candidate-validation",
      "The final Stage 3 candidate validation is frozen",
      [STAGE_3_CANDIDATE_VALIDATION].filter((filePath) => pathSet.has(filePath)),
      !requireCandidateValidation || pathSet.has(STAGE_3_CANDIDATE_VALIDATION),
    ),
    requirement(
      "stage-3-review-output-exclusion",
      "The candidate freeze and independent closure remain outside their own candidate inputs",
      forbiddenReviewOutputs,
      forbiddenReviewOutputs.length === 0,
    ),
    requirement(
      "unique-paths",
      "Stage 3 freeze inputs contain no duplicate paths",
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

export const collectStage3FreezeInputs = async ({
  root = process.cwd(),
  excludedOutputPaths = [],
  mode = "FINAL_FREEZE",
} = {}) => {
  if (!COLLECTION_MODES.has(mode)) throw new Error(`Invalid Stage 3 collection mode: ${mode}`);
  const preFinal = mode === "PRE_FINAL";
  const exclusions = new Set(excludedOutputPaths.map(toPosix));
  for (const filePath of exclusions) {
    if (!isRelativeRepositoryPath(filePath)) {
      throw new Error(`Invalid Stage 3 freeze-output exclusion: ${filePath}`);
    }
    if (filePath !== STAGE_3_CANDIDATE_FREEZE) {
      throw new Error(`Only the Stage 3 candidate freeze may be excluded: ${filePath}`);
    }
  }
  if (!preFinal && !exclusions.has(STAGE_3_CANDIDATE_FREEZE)) {
    throw new Error("FINAL_FREEZE requires explicit exclusion of its own Stage 3 freeze output");
  }
  const preFinalOmissions = new Set(preFinal ? PRE_FINAL_ALLOWED_MISSING_PATHS : []);

  for (const predecessor of PROTECTED_STAGE_2_PREDECESSORS) {
    const bytes = await readFile(path.join(root, predecessor.path));
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== predecessor.sha256) {
      throw new Error(
        `Protected Stage 2 predecessor mismatch: ${predecessor.path} expected ${predecessor.sha256} actual ${actualSha256}`,
      );
    }
  }

  const base = await collectStage2FreezeInputs({ root, mode: "FINAL_FREEZE" });
  const categoriesByPath = new Map();
  for (const entry of base.entries) {
    categoriesByPath.set(entry.path, new Set(entry.categories));
  }
  const add = async (filePath, category) => {
    const normalized = toPosix(filePath);
    if (exclusions.has(normalized) || preFinalOmissions.has(normalized)) return;
    if (!isRelativeRepositoryPath(normalized)) {
      throw new Error(`Invalid Stage 3 freeze input path: ${normalized}`);
    }
    const details = await lstat(path.join(root, normalized));
    if (details.isSymbolicLink() || !details.isFile()) {
      throw new Error(`Stage 3 freeze input is not a regular file: ${normalized}`);
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

  await addDirectory("deploy/database", "stage-3-database-bootstrap");
  await addDirectory("migrations", "stage-3-migration-chain");
  await addDirectory("packages/backend-core/src/application", "stage-3-transaction-contract");
  await addDirectory("packages/database/src/postgres", "stage-3-postgresql-adapter");
  await addDirectory("tests", "stage-3-integration-tests");
  await addDirectory("tooling/database", "stage-3-database-tooling");
  await add(STAGE_3_IMPLEMENTATION_DOCUMENT, "stage-3-implementation-document");
  for (const name of EXPECTED_STAGE_3_ARTIFACT_NAMES) {
    await add(`${STAGE_3_EVIDENCE_DIRECTORY}/${name}`, "stage-3-final-evidence");
  }
  if (!preFinal) {
    await add(STAGE_3_EVIDENCE_INDEX, "stage-3-final-evidence-index");
  }
  if (!preFinal) {
    await add(STAGE_3_CANDIDATE_VALIDATION, "stage-3-candidate-validation");
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

  const completeness = validateStage3FreezeInputEntries({
    entries,
    requireEvidenceIndex: !preFinal,
    requireCandidateValidation: !preFinal,
  });
  if (completeness.result !== "PASS") {
    throw new Error(
      `Stage 3 freeze inputs are incomplete: ${completeness.failedRequirementIds.join(", ")}`,
    );
  }

  return {
    schemaVersion: 1,
    purpose: preFinal
      ? "Deterministic Stage 3 pre-final input set; never eligible to create a freeze"
      : "Deterministic input set eligible for the self-contained Stage 3 candidate freeze",
    result: "PASS",
    mode,
    finalFreezeCreated: false,
    finalFreezeEligible: !preFinal,
    evidenceIndexRequired: !preFinal,
    candidateValidationRequired: !preFinal,
    preFinalAllowedMissingPaths: preFinal ? PRE_FINAL_ALLOWED_MISSING_PATHS : [],
    preFinalOmittedPaths: [...preFinalOmissions].sort((left, right) => left.localeCompare(right)),
    exclusions: [...exclusions].sort((left, right) => left.localeCompare(right)),
    protectedStage2Predecessors: PROTECTED_STAGE_2_PREDECESSORS,
    entryCount: entries.length,
    aggregateAlgorithm: "sha256(path\\0bytes\\0sha256 joined by LF in collector order)",
    aggregateSha256: sha256(
      entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`).join("\n"),
    ),
    completeness,
    entries,
  };
};
