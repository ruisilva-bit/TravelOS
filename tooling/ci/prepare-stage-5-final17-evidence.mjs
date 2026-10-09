import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { spawnSync } from "node:child_process";

import {
  STAGE5_FINAL14_ARCHIVE_MANIFEST,
  STAGE5_FINAL14_CANDIDATE_FREEZE,
  STAGE5_FINAL14_CANDIDATE_VALIDATION,
  STAGE5_FINAL14_CORRECTION_MATRIX,
  STAGE5_FINAL14_EVIDENCE_DIRECTORY,
  STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL14_REVIEW_NO_GO,
  STAGE5_FINAL14_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL16_BASELINE_SHA256,
  STAGE5_FINAL16_EVIDENCE_DIRECTORY,
  STAGE5_FINAL16_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL16_PACKAGE_SHA256,
  STAGE5_FINAL16_PREFLIGHT_FAILURE_LOG,
  STAGE5_FINAL16_PREFLIGHT_FAILURE_LOG_SHA256,
  STAGE5_FINAL16_PREFLIGHT_FAILURE_RECEIPT,
  STAGE5_FINAL16_PREFLIGHT_FAILURE_RECEIPT_SHA256,
  STAGE5_FINAL16_RUNNER_SHA256,
  STAGE5_FINAL14_SOURCE_ARCHIVE,
  STAGE5_FINAL17_CI_EXECUTION_PLACEHOLDER,
  STAGE5_FINAL17_CI_LOG_PLACEHOLDER,
  STAGE5_FINAL17_EVIDENCE_DIRECTORY,
  STAGE5_FINAL17_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL17_PREDECESSOR_EVIDENCE_NAMES,
  STAGE5_FINAL15_EVIDENCE_DIRECTORY,
  STAGE5_FINAL15_FAILED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL15_FAILED_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL15_BASELINE_FAILURE_RECEIPT,
  STAGE5_FINAL15_BASELINE_FAILURE_LOG,
  STAGE5_FINAL15_FAILED_BASELINE_COPY,
  STAGE5_FINAL15_SOURCE_INPUTS_MANIFEST,
  STAGE5_FINAL15_SOURCE_INPUTS,
} from "./stage-5-candidate-contract.mjs";
import {
  writeStage5Final17CorrectionMatrix,
  verifyStage5Final17FindingLineage,
} from "./stage-5-final17-finding-lineage.mjs";
import { STAGE5_SECURITY_EXTENSION_BASELINE_PATH } from "./verify-stage-5-security-extension-baseline.mjs";
import { verifyStage5Final17Predecessor } from "./stage-5-final17-evidence-index.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.join(root, STAGE5_FINAL17_EVIDENCE_DIRECTORY);
const qualificationDirectory = path.resolve(
  process.env.TRAVELOS_STAGE5_FINAL17_QUALIFICATION_DIR ??
    "/home/hermes/.hermes/cache/scratch/travelos-stage5-final17-source-bound-20261006",
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const writeVerifiedFile = async (file, expectedBytes) => {
  try {
    const existingBytes = await readFile(file);
    assert.deepEqual(
      existingBytes,
      expectedBytes,
      `refusing to overwrite divergent evidence: ${file}`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(file, expectedBytes, { flag: "wx" });
  }
};
const writeJson = async (file, value) =>
  writeVerifiedFile(file, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));

assert.equal(process.version, "v24.19.0", "FINAL-17 evidence preparation requires Node 24.19.0");
const corepackVersion = spawnSync("corepack", ["--version"], { encoding: "utf8" });
const pnpmVersion = spawnSync("corepack", ["pnpm", "--version"], { encoding: "utf8" });
assert.equal(corepackVersion.status, 0);
assert.equal(pnpmVersion.status, 0);
assert.equal(corepackVersion.stdout.trim(), "0.35.0");
assert.equal(pnpmVersion.stdout.trim(), "11.21.0");
const priorBytes = await readFile(path.join(root, STAGE5_SECURITY_EXTENSION_BASELINE_PATH));
assert.equal(digest(priorBytes), STAGE5_FINAL16_BASELINE_SHA256);
const final14BaselineBytes = await readFile(
  path.join(root, STAGE5_FINAL15_EVIDENCE_DIRECTORY, "final14-security-extension-baseline.json"),
);
assert.equal(digest(final14BaselineBytes), STAGE5_FINAL14_SECURITY_BASELINE_SHA256);
try {
  const directoryStat = await lstat(evidenceDirectory);
  assert(directoryStat.isDirectory() && !directoryStat.isSymbolicLink());
  const existingEntries = await readdir(evidenceDirectory, { withFileTypes: true });
  const expectedNames = new Set(STAGE5_FINAL17_EXPECTED_EVIDENCE_ARTIFACT_NAMES);
  assert(
    existingEntries.every(
      (entry) => entry.isFile() && !entry.isSymbolicLink() && expectedNames.has(entry.name),
    ),
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  await mkdir(evidenceDirectory, { recursive: false });
}
try {
  await lstat(path.join(root, ".hermes/state/stage5-final17-ci-verify-invocation.json"));
  throw new Error("Refusing evidence preparation after FINAL-17 CI authorization was consumed");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const sourceEntries = await readdir(path.join(root, STAGE5_FINAL14_EVIDENCE_DIRECTORY), {
  withFileTypes: true,
});
assert(sourceEntries.every((entry) => entry.isFile() && !entry.isSymbolicLink()));
for (const name of STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES) {
  const sourceBytes = await readFile(path.join(root, STAGE5_FINAL14_EVIDENCE_DIRECTORY, name));
  await writeVerifiedFile(path.join(evidenceDirectory, `final14-${name}`), sourceBytes);
}
for (const [target, source] of [
  ["final14-EVIDENCE_INDEX.json", `${STAGE5_FINAL14_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`],
  ["final14-correction-matrix.json", STAGE5_FINAL14_CORRECTION_MATRIX],
  ["final14-candidate-validation.md", STAGE5_FINAL14_CANDIDATE_VALIDATION],
  ["final14-candidate-freeze.md", STAGE5_FINAL14_CANDIDATE_FREEZE],
  ["final14-independent-review-no-go.json", STAGE5_FINAL14_REVIEW_NO_GO],
  ["final14-archive-manifest.json", STAGE5_FINAL14_ARCHIVE_MANIFEST],
  ["final14-frozen-source-snapshot.tar.gz", STAGE5_FINAL14_SOURCE_ARCHIVE],
]) {
  await writeVerifiedFile(
    path.join(evidenceDirectory, target),
    await readFile(path.join(root, source)),
  );
}
await writeVerifiedFile(
  path.join(evidenceDirectory, "final14-security-extension-baseline.json"),
  final14BaselineBytes,
);
const final15EvidenceDirectory = path.join(root, STAGE5_FINAL15_EVIDENCE_DIRECTORY);
const final15Entries = await readdir(final15EvidenceDirectory, { withFileTypes: true });
assert(final15Entries.every((entry) => entry.isFile() && !entry.isSymbolicLink()));
assert.deepEqual(
  final15Entries.map((entry) => entry.name).toSorted(),
  [...STAGE5_FINAL15_FAILED_EVIDENCE_ARTIFACT_NAMES],
  "FINAL-15 partial evidence set differs from its preserved expected contents",
);
for (const name of STAGE5_FINAL15_FAILED_EVIDENCE_ARTIFACT_NAMES) {
  await writeVerifiedFile(
    path.join(evidenceDirectory, `final15-${name}`),
    await readFile(path.join(final15EvidenceDirectory, name)),
  );
}
const final15PreservedFiles = [
  ["final15-baseline-generation-failure.json", STAGE5_FINAL15_BASELINE_FAILURE_RECEIPT],
  ["final15-baseline-generation-failure.log", STAGE5_FINAL15_BASELINE_FAILURE_LOG],
  ["final15-failed-security-extension-baseline.json", STAGE5_FINAL15_FAILED_BASELINE_COPY],
  ["final15-source-inputs-manifest.json", STAGE5_FINAL15_SOURCE_INPUTS_MANIFEST],
  ["final15-package.json", STAGE5_FINAL15_SOURCE_INPUTS.packageJson],
  ["final15-runner.mjs", STAGE5_FINAL15_SOURCE_INPUTS.runner],
  [
    "final15-security-extension-document.md",
    STAGE5_FINAL15_SOURCE_INPUTS.securityExtensionDocument,
  ],
];
for (const [target, source] of final15PreservedFiles) {
  await writeVerifiedFile(
    path.join(evidenceDirectory, target),
    await readFile(path.join(root, source)),
  );
}
assert.equal(
  digest(
    await readFile(path.join(evidenceDirectory, "final15-failed-security-extension-baseline.json")),
  ),
  STAGE5_FINAL15_FAILED_SECURITY_BASELINE_SHA256,
);

const final16EvidenceDirectory = path.join(root, STAGE5_FINAL16_EVIDENCE_DIRECTORY);
const final16Entries = await readdir(final16EvidenceDirectory, { withFileTypes: true });
assert(final16Entries.every((entry) => entry.isFile() && !entry.isSymbolicLink()));
assert.deepEqual(
  final16Entries.map((entry) => entry.name).toSorted(),
  [...STAGE5_FINAL16_EXPECTED_EVIDENCE_ARTIFACT_NAMES, "EVIDENCE_INDEX.json"].toSorted(),
  "FINAL-16 evidence path set differs from its preserved exact index contract",
);
for (const name of STAGE5_FINAL16_EXPECTED_EVIDENCE_ARTIFACT_NAMES) {
  await writeVerifiedFile(
    path.join(evidenceDirectory, `final16-${name}`),
    await readFile(path.join(final16EvidenceDirectory, name)),
  );
}
await writeVerifiedFile(
  path.join(evidenceDirectory, "final16-EVIDENCE_INDEX.json"),
  await readFile(path.join(final16EvidenceDirectory, "EVIDENCE_INDEX.json")),
);
for (const [target, source] of [
  ["final16-preflight-failure.json", STAGE5_FINAL16_PREFLIGHT_FAILURE_RECEIPT],
  ["final16-preflight-failure.log", STAGE5_FINAL16_PREFLIGHT_FAILURE_LOG],
]) {
  await writeVerifiedFile(
    path.join(evidenceDirectory, target),
    await readFile(path.join(root, source)),
  );
}
await writeVerifiedFile(
  path.join(evidenceDirectory, "final16-security-extension-baseline.json"),
  priorBytes,
);
const preservedFinal16Package = await readFile(
  path.join(evidenceDirectory, "final16-package.json"),
);
assert.equal(digest(preservedFinal16Package), STAGE5_FINAL16_PACKAGE_SHA256);
await writeVerifiedFile(
  path.join(evidenceDirectory, "final16-runner.mjs"),
  await readFile(path.join(root, "tooling/ci/run-stage-5-final16-authoritative-ci.mjs")),
);
assert.equal(
  digest(await readFile(path.join(evidenceDirectory, "final16-security-extension-baseline.json"))),
  STAGE5_FINAL16_BASELINE_SHA256,
);
assert.equal(
  digest(await readFile(path.join(evidenceDirectory, "final16-preflight-failure.json"))),
  STAGE5_FINAL16_PREFLIGHT_FAILURE_RECEIPT_SHA256,
);
assert.equal(
  digest(await readFile(path.join(evidenceDirectory, "final16-preflight-failure.log"))),
  STAGE5_FINAL16_PREFLIGHT_FAILURE_LOG_SHA256,
);
assert.equal(
  digest(await readFile(path.join(evidenceDirectory, "final16-package.json"))),
  STAGE5_FINAL16_PACKAGE_SHA256,
);
assert.equal(
  digest(await readFile(path.join(evidenceDirectory, "final16-runner.mjs"))),
  STAGE5_FINAL16_RUNNER_SHA256,
);
await verifyStage5Final17Predecessor({ root });

const postgresNames = [
  ["postgresql-integration-test-execution.json", "integration-test-execution.json"],
  ["postgresql-disposable-cleanup.json", "disposable-cleanup.json"],
  ["postgresql-package-build.json", "package-build.json"],
  ["postgresql-package-provenance.json", "postgresql-package-provenance.json"],
  ["postgresql-runtime.json", "postgresql-runtime.json"],
  ["postgresql-integration-tests.log", "integration-tests.log"],
  ["postgresql-qualification-execution.json", "qualification-execution.json"],
  ["postgresql-qualification-runner.log", "qualification-runner.log"],
];
const copied = {};
for (const [target, source] of postgresNames) {
  const bytes = await readFile(path.join(qualificationDirectory, source));
  await writeVerifiedFile(path.join(evidenceDirectory, target), bytes);
  copied[target] = { bytes: bytes.length, sha256: digest(bytes) };
}
const qualificationExecution = await readJson(
  path.join(qualificationDirectory, "qualification-execution.json"),
);
assert.equal(qualificationExecution.candidate, "FINAL-17");
assert.equal(qualificationExecution.result, "PASS");
assert.equal(
  qualificationExecution.integrationTestSha256,
  digest(await readFile(path.join(root, qualificationExecution.integrationTestPath))),
);
assert.equal(
  qualificationExecution.packageJsonSha256,
  digest(await readFile(path.join(root, "package.json"))),
);
const integrationExecution = await readJson(
  path.join(qualificationDirectory, "integration-test-execution.json"),
);
const disposableCleanup = await readJson(
  path.join(qualificationDirectory, "disposable-cleanup.json"),
);
const qualification = {
  schemaVersion: 1,
  candidate: "FINAL-17",
  result: "PASS",
  integrationExecution: {
    ...integrationExecution,
    sha256: copied["postgresql-integration-test-execution.json"].sha256,
  },
  disposableCleanup: {
    ...disposableCleanup,
    sha256: copied["postgresql-disposable-cleanup.json"].sha256,
  },
  packageBuild: await readJson(path.join(qualificationDirectory, "package-build.json")),
  packageProvenance: await readJson(
    path.join(qualificationDirectory, "postgresql-package-provenance.json"),
  ),
  postgresqlRuntime: await readJson(path.join(qualificationDirectory, "postgresql-runtime.json")),
  qualificationExecution,
  integrationLog: copied["postgresql-integration-tests.log"],
  runnerLog: copied["postgresql-qualification-runner.log"],
  sourceTestPath: qualificationExecution.integrationTestPath,
  sourceTestSha256: qualificationExecution.integrationTestSha256,
  packageJsonSha256: qualificationExecution.packageJsonSha256,
  stage6Actions: 0,
};
assert.equal(qualification.disposableCleanup.result, "PASS");
assert.equal(qualification.integrationExecution.result, "PASS");
assert.equal(qualificationExecution.integrationTestsPassed, 29);
await writeJson(path.join(evidenceDirectory, "postgresql-qualification.json"), qualification);

const focusedReceipt = await readJson(path.join(evidenceDirectory, "focused-test-execution.json"));
const focusedLog = await readFile(path.join(evidenceDirectory, "focused-tests.log"), "utf8");
assert.equal(focusedReceipt.candidate, "FINAL-17");
assert.equal(focusedReceipt.result, "PASS");
assert.deepEqual(focusedReceipt.toolchain, {
  node: "v24.19.0",
  corepack: "0.35.0",
  pnpm: "11.21.0",
  processExecPath: process.execPath,
});
assert(focusedLog.includes("Tests  65 passed (65)"));
for (const [relativePath, expectedHash] of Object.entries(focusedReceipt.sourceHashes)) {
  assert.equal(
    digest(await readFile(path.join(root, relativePath))),
    expectedHash,
    `FINAL-17 focused evidence source changed: ${relativePath}`,
  );
}
assert.equal(
  focusedReceipt.sourceHashes["package.json"],
  digest(await readFile(path.join(root, "package.json"))),
);

const matrixPath = path.join(
  root,
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_17_CORRECTION_MATRIX.json",
);
let matrixResult;
try {
  await lstat(matrixPath);
  matrixResult = await verifyStage5Final17FindingLineage({ root });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  matrixResult = await writeStage5Final17CorrectionMatrix({ root });
}
assert.equal(matrixResult.result, "PASS");
const matrixBytes = await readFile(matrixPath);
await writeVerifiedFile(
  path.join(evidenceDirectory, "final17-correction-matrix.json"),
  matrixBytes,
);
const lineage = await verifyStage5Final17FindingLineage({ root });
await writeJson(path.join(evidenceDirectory, "finding-lineage.json"), lineage);
await writeVerifiedFile(
  path.join(evidenceDirectory, "ci-verify.log"),
  Buffer.from(STAGE5_FINAL17_CI_LOG_PLACEHOLDER),
);
await writeVerifiedFile(
  path.join(evidenceDirectory, "ci-verify-execution.json"),
  Buffer.from(STAGE5_FINAL17_CI_EXECUTION_PLACEHOLDER),
);
await writeJson(path.join(evidenceDirectory, "readiness-preflight.json"), {
  schemaVersion: 1,
  candidate: "FINAL-17",
  phase: "PRE_CI",
  result: "PENDING",
  ciVerifyInvoked: false,
  invocationCount: 0,
  expectedCommand: "corepack pnpm ci:verify",
  stage6Actions: 0,
});
const actualNames = (await readdir(evidenceDirectory)).toSorted();
const pendingPreflightNames = new Set([
  "baseline-generation.json",
  "format-check.json",
  "format-check.log",
  "lint-check.json",
  "lint-check.log",
]);
const expectedPreparedNames = STAGE5_FINAL17_EXPECTED_EVIDENCE_ARTIFACT_NAMES.filter(
  (name) => !pendingPreflightNames.has(name),
);
const missingNames = expectedPreparedNames.filter((name) => !actualNames.includes(name));
const unexpectedNames = actualNames.filter(
  (name) => !STAGE5_FINAL17_EXPECTED_EVIDENCE_ARTIFACT_NAMES.includes(name),
);
assert.deepEqual({ missingNames, unexpectedNames }, { missingNames: [], unexpectedNames: [] });
const result = {
  result: "PASS",
  candidate: "FINAL-17",
  copiedPredecessorArtifacts: STAGE5_FINAL17_PREDECESSOR_EVIDENCE_NAMES.length,
  postgresqlArtifactsCopied: Object.keys(copied).length,
  postgresqlTestsPassed: qualificationExecution.integrationTestsPassed,
  focusedTestFiles: focusedReceipt.files,
  focusedTestsPassed: focusedReceipt.tests,
  findingCount: matrixResult.findingCount,
  baselineGenerated: false,
  baselineHashCaptureAllowedAfter:
    "all candidate-specific package/tooling/document/source inputs are finalized",
  stage6Actions: 0,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
