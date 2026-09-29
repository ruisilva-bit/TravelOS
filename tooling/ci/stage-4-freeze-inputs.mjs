import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  STAGE_4_EVIDENCE_DIRECTORY,
  STAGE_4_EVIDENCE_INDEX,
  STAGE_4_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  verifyStage4EvidenceIndex,
} from "../database/stage-4-evidence-contract.mjs";

export const STAGE_3_PREDECESSOR_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_3_CORRECTED_CANDIDATE_FREEZE.md";
export const STAGE_3_PREDECESSOR_FREEZE_SHA256 =
  "a973ccc403844bd7e6dc10610117965af761abe1c3197d3ee1f3b9b2ad1ed9d7";
export const STAGE_3_PREDECESSOR_CLOSURE =
  "docs/reviews/phase-1-m1/STAGE_3_CORRECTED_INDEPENDENT_CLOSURE.md";
export const STAGE_3_PREDECESSOR_CLOSURE_SHA256 =
  "682fbcd9d42edb277eb76a1d886f1a57337a19deb11742e0ab7e4a1d345ce380";
export const STAGE_4_HISTORICAL_REJECTED_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_4_CANDIDATE_FREEZE.md";
export const STAGE_4_HISTORICAL_REJECTED_FREEZE_SHA256 =
  "f534a15eb11a5773f93ee5f0bdb8b6fcc15781560d1cc0d24c0d9ab8bd92040a";
export const STAGE_4_CANDIDATE_VALIDATION =
  "docs/reviews/phase-1-m1/STAGE_4_CORRECTED_CANDIDATE_VALIDATION.md";
export const STAGE_4_CANDIDATE_FREEZE =
  "docs/reviews/phase-1-m1/STAGE_4_CORRECTED_CANDIDATE_FREEZE.md";

const COLLECTION_MODES = new Set(["FINAL_FREEZE", "PRE_FINAL"]);
const IGNORED_DIRECTORY_NAMES = new Set([".git", ".vite", "coverage", "dist", "node_modules"]);
const ROOT_FILE_PATHS = [
  ".node-version",
  ".npmrc",
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
const CANONICAL_DOCUMENT_PATHS = [
  "docs/ARCHITECTURE.md",
  "docs/DATA_MODEL.md",
  "docs/DOMAIN_MODEL.md",
  "docs/PERMISSIONS.md",
  "docs/PRODUCT_BLUEPRINT.md",
  "docs/SECURITY_MODEL.md",
  "docs/implementation/M1_BOOTSTRAP_DECISIONS.md",
  "docs/implementation/M1_STAGE_3_DATABASE_FOUNDATION.md",
  "docs/implementation/M1_STAGE_4_AUTHENTICATION_AND_AUTHORIZATION.md",
];
const ROOT_DIRECTORIES = [
  "apps",
  "deploy",
  "migrations",
  "packages",
  "tests",
  "tooling",
  "docs/adr",
  STAGE_4_EVIDENCE_DIRECTORY,
  "docs/evidence/phase-1-m1/stage-4-corrected",
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const toPosix = (filePath) => filePath.split(path.sep).join("/");
const sortedUnique = (values) => [...new Set(values)].toSorted();
const isRelativeRepositoryPath = (filePath) =>
  filePath.length > 0 &&
  !path.isAbsolute(filePath) &&
  !filePath.split("/").some((segment) => segment === "" || segment === "..");

const readDirectoryFiles = async (root, relativeDirectory) => {
  const files = [];
  const walk = async (currentDirectory) => {
    const entries = await readdir(path.join(root, currentDirectory), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = path.posix.join(currentDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Stage 4 freeze inputs may not follow symbolic links: ${relativePath}`);
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

export const validateStage4FreezeInputEntries = ({ entries, requireAuthorValidation = true }) => {
  const paths = entries.map((entry) => entry.path);
  const pathSet = new Set(paths);
  const expectedEvidencePaths = [
    ...STAGE_4_EXPECTED_EVIDENCE_ARTIFACT_NAMES.map(
      (name) => `${STAGE_4_EVIDENCE_DIRECTORY}/${name}`,
    ),
    STAGE_4_EVIDENCE_INDEX,
  ].toSorted();
  const actualEvidencePaths = paths
    .filter((filePath) => filePath.startsWith(`${STAGE_4_EVIDENCE_DIRECTORY}/`))
    .toSorted();
  const duplicatePaths = paths.filter((filePath, index) => paths.indexOf(filePath) !== index);
  const forbiddenReviewOutputs = [
    STAGE_4_CANDIDATE_FREEZE,
    "docs/reviews/phase-1-m1/STAGE_4_INDEPENDENT_REVIEW.json",
    "docs/reviews/phase-1-m1/STAGE_4_INDEPENDENT_CLOSURE.md",
  ].filter((filePath) => pathSet.has(filePath));
  const requiredPaths = [
    ...ROOT_FILE_PATHS,
    ...CANONICAL_DOCUMENT_PATHS,
    STAGE_3_PREDECESSOR_FREEZE,
    STAGE_3_PREDECESSOR_CLOSURE,
    "migrations/0004_authentication_realms.cjs",
    "migrations/0005_root_agency_staff_authorization.cjs",
    "migrations/0006_stage4_authorization_hardening.cjs",
    "tests/integration/stage-4-postgresql.test.ts",
    "tooling/auth/bootstrap-first-owner.ts",
    "tooling/auth/verify-better-auth-schema-drift.ts",
    "tooling/database/run-stage-4-disposable.mjs",
    "tooling/database/stage-4-evidence-contract.mjs",
    "tooling/database/build-stage-4-evidence-index.mjs",
    "tooling/database/verify-stage-4-evidence-index.mjs",
    "tooling/ci/stage-4-freeze-inputs.mjs",
    "tooling/ci/write-stage-4-candidate-freeze.mjs",
    "tooling/ci/verify-stage-4-candidate-freeze.mjs",
  ];
  const requirements = [
    requirement(
      "required-stage-4-inputs",
      "Canonical documents, Stage 4 migrations/tests/tooling, and Stage 3 closed predecessor are frozen",
      requiredPaths.filter((filePath) => pathSet.has(filePath)),
      requiredPaths.every((filePath) => pathSet.has(filePath)),
    ),
    requirement(
      "stage-4-evidence-exact",
      "The definitive Stage 4 evidence directory is represented exactly",
      actualEvidencePaths,
      actualEvidencePaths.length === expectedEvidencePaths.length &&
        actualEvidencePaths.every((filePath, index) => filePath === expectedEvidencePaths[index]),
    ),
    requirement(
      "author-validation",
      "The Stage 4 author validation is frozen before independent review",
      [STAGE_4_CANDIDATE_VALIDATION].filter((filePath) => pathSet.has(filePath)),
      !requireAuthorValidation || pathSet.has(STAGE_4_CANDIDATE_VALIDATION),
    ),
    requirement(
      "review-output-exclusion",
      "The candidate freeze and later independent review/closure are excluded from candidate inputs",
      forbiddenReviewOutputs,
      forbiddenReviewOutputs.length === 0,
    ),
    requirement(
      "unique-paths",
      "Stage 4 freeze inputs contain no duplicate paths",
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

export const collectStage4FreezeInputs = async ({
  root = process.cwd(),
  excludedOutputPaths = [],
  mode = "FINAL_FREEZE",
} = {}) => {
  if (!COLLECTION_MODES.has(mode)) throw new Error(`Invalid Stage 4 collection mode: ${mode}`);
  const preFinal = mode === "PRE_FINAL";
  const exclusions = new Set(excludedOutputPaths.map(toPosix));
  for (const filePath of exclusions) {
    if (!isRelativeRepositoryPath(filePath) || filePath !== STAGE_4_CANDIDATE_FREEZE) {
      throw new Error(`Invalid Stage 4 freeze-output exclusion: ${filePath}`);
    }
  }
  if (!preFinal && !exclusions.has(STAGE_4_CANDIDATE_FREEZE)) {
    throw new Error("FINAL_FREEZE requires explicit exclusion of the Stage 4 freeze output");
  }

  const predecessorFreeze = await readFile(path.join(root, STAGE_3_PREDECESSOR_FREEZE));
  const predecessorClosure = await readFile(path.join(root, STAGE_3_PREDECESSOR_CLOSURE));
  if (
    sha256(predecessorFreeze) !== STAGE_3_PREDECESSOR_FREEZE_SHA256 ||
    sha256(predecessorClosure) !== STAGE_3_PREDECESSOR_CLOSURE_SHA256
  ) {
    throw new Error("Accepted Stage 3 predecessor integrity mismatch");
  }

  const evidenceVerification = await verifyStage4EvidenceIndex({ root });
  if (evidenceVerification.result !== "PASS")
    throw new Error("Stage 4 evidence index is not exact");

  const categoriesByPath = new Map();
  const add = async (filePath, category) => {
    const normalized = toPosix(filePath);
    if (exclusions.has(normalized)) return;
    if (!isRelativeRepositoryPath(normalized)) {
      throw new Error(`Invalid Stage 4 freeze input path: ${normalized}`);
    }
    const details = await lstat(path.join(root, normalized));
    if (details.isSymbolicLink() || !details.isFile()) {
      throw new Error(`Stage 4 freeze input is not a regular file: ${normalized}`);
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

  for (const filePath of ROOT_FILE_PATHS) await add(filePath, "repository-root-contract");
  for (const filePath of CANONICAL_DOCUMENT_PATHS) await add(filePath, "canonical-documentation");
  for (const directory of ROOT_DIRECTORIES) await addDirectory(directory, "stage-4-implementation");
  await add(STAGE_3_PREDECESSOR_FREEZE, "accepted-stage-3-predecessor-freeze");
  await add(STAGE_3_PREDECESSOR_CLOSURE, "accepted-stage-3-predecessor-closure");
  if (!preFinal) await add(STAGE_4_CANDIDATE_VALIDATION, "stage-4-author-validation");

  const entries = [];
  for (const filePath of [...categoriesByPath.keys()].toSorted()) {
    const bytes = await readFile(path.join(root, filePath));
    entries.push({
      path: filePath,
      bytes: bytes.length,
      sha256: sha256(bytes),
      categories: [...categoriesByPath.get(filePath)].toSorted(),
    });
  }
  const completeness = validateStage4FreezeInputEntries({
    entries,
    requireAuthorValidation: !preFinal,
  });
  if (completeness.result !== "PASS") {
    throw new Error(
      `Stage 4 freeze inputs are incomplete: ${completeness.failedRequirementIds.join(", ")}`,
    );
  }

  return {
    schemaVersion: 1,
    purpose: preFinal
      ? "Deterministic Stage 4 pre-final input set; never freeze eligible"
      : "Deterministic exact input set eligible for Stage 4 independent review",
    result: "PASS",
    mode,
    finalFreezeCreated: false,
    finalFreezeEligible: !preFinal,
    exclusions: [...exclusions].toSorted(),
    predecessor: {
      freeze: {
        path: STAGE_3_PREDECESSOR_FREEZE,
        bytes: predecessorFreeze.length,
        sha256: sha256(predecessorFreeze),
      },
      closure: {
        path: STAGE_3_PREDECESSOR_CLOSURE,
        bytes: predecessorClosure.length,
        sha256: sha256(predecessorClosure),
      },
    },
    evidenceVerification,
    entryCount: entries.length,
    aggregateAlgorithm: "sha256(path\\0bytes\\0sha256 joined by LF in collector order)",
    aggregateSha256: sha256(
      entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`).join("\n"),
    ),
    completeness,
    entries,
  };
};
