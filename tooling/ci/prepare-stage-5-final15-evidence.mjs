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
  STAGE5_FINAL14_SOURCE_ARCHIVE,
  STAGE5_FINAL15_CI_EXECUTION_PLACEHOLDER,
  STAGE5_FINAL15_CI_LOG_PLACEHOLDER,
  STAGE5_FINAL15_EVIDENCE_DIRECTORY,
  STAGE5_FINAL15_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
} from "./stage-5-candidate-contract.mjs";
import {
  writeStage5Final15CorrectionMatrix,
  verifyStage5Final15FindingLineage,
} from "./stage-5-final15-finding-lineage.mjs";
import { STAGE5_SECURITY_EXTENSION_BASELINE_PATH } from "./verify-stage-5-security-extension-baseline.mjs";
import { verifyStage5Final15Predecessor } from "./stage-5-final15-evidence-index.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.join(root, STAGE5_FINAL15_EVIDENCE_DIRECTORY);
const qualificationDirectory = path.resolve(
  process.env.TRAVELOS_STAGE5_FINAL15_QUALIFICATION_DIR ??
    "/home/hermes/.hermes/cache/scratch/travelos-stage5-final15-source-bound-20261006",
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

assert.equal(process.version, "v24.19.0", "FINAL-15 evidence preparation requires Node 24.19.0");
const corepackVersion = spawnSync("corepack", ["--version"], { encoding: "utf8" });
const pnpmVersion = spawnSync("corepack", ["pnpm", "--version"], { encoding: "utf8" });
assert.equal(corepackVersion.status, 0);
assert.equal(pnpmVersion.status, 0);
assert.equal(corepackVersion.stdout.trim(), "0.35.0");
assert.equal(pnpmVersion.stdout.trim(), "11.21.0");
const priorBytes = await readFile(path.join(root, STAGE5_SECURITY_EXTENSION_BASELINE_PATH));
assert.equal(digest(priorBytes), STAGE5_FINAL14_SECURITY_BASELINE_SHA256);
try {
  const directoryStat = await lstat(evidenceDirectory);
  assert(directoryStat.isDirectory() && !directoryStat.isSymbolicLink());
  const existingEntries = await readdir(evidenceDirectory, { withFileTypes: true });
  const expectedNames = new Set(STAGE5_FINAL15_EXPECTED_EVIDENCE_ARTIFACT_NAMES);
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
  await lstat(path.join(root, ".hermes/state/stage5-final15-ci-verify-invocation.json"));
  throw new Error("Refusing evidence preparation after FINAL-15 CI authorization was consumed");
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
  priorBytes,
);
await verifyStage5Final15Predecessor({ root });

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
assert.equal(qualificationExecution.candidate, "FINAL-15");
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
  candidate: "FINAL-15",
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

const focused = spawnSync(process.execPath, ["tooling/ci/run-stage-5-final15-focused.mjs"], {
  cwd: root,
  env: process.env,
  encoding: "utf8",
  maxBuffer: 50 * 1024 * 1024,
});
assert.equal(focused.error, undefined, focused.error?.message);
assert.equal(
  focused.status,
  0,
  `FINAL-15 focused tests failed\n${focused.stdout}\n${focused.stderr}`,
);
const focusedReceipt = await readJson(path.join(evidenceDirectory, "focused-test-execution.json"));
assert.equal(focusedReceipt.candidate, "FINAL-15");
assert.equal(focusedReceipt.result, "PASS");
assert.deepEqual(focusedReceipt.toolchain, {
  node: "v24.19.0",
  corepack: "0.35.0",
  pnpm: "11.21.0",
  processExecPath: process.execPath,
});
assert.equal(
  focusedReceipt.sourceHashes["package.json"],
  digest(await readFile(path.join(root, "package.json"))),
);

const matrixPath = path.join(
  root,
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_15_CORRECTION_MATRIX.json",
);
let matrixResult;
try {
  await lstat(matrixPath);
  matrixResult = await verifyStage5Final15FindingLineage({ root });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  matrixResult = await writeStage5Final15CorrectionMatrix({ root });
}
assert.equal(matrixResult.result, "PASS");
const matrixBytes = await readFile(matrixPath);
await writeVerifiedFile(
  path.join(evidenceDirectory, "final15-correction-matrix.json"),
  matrixBytes,
);
const lineage = await verifyStage5Final15FindingLineage({ root });
await writeJson(path.join(evidenceDirectory, "finding-lineage.json"), lineage);
await writeVerifiedFile(
  path.join(evidenceDirectory, "ci-verify.log"),
  Buffer.from(STAGE5_FINAL15_CI_LOG_PLACEHOLDER),
);
await writeVerifiedFile(
  path.join(evidenceDirectory, "ci-verify-execution.json"),
  Buffer.from(STAGE5_FINAL15_CI_EXECUTION_PLACEHOLDER),
);
await writeJson(path.join(evidenceDirectory, "readiness-preflight.json"), {
  schemaVersion: 1,
  candidate: "FINAL-15",
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
const expectedPreparedNames = STAGE5_FINAL15_EXPECTED_EVIDENCE_ARTIFACT_NAMES.filter(
  (name) => !pendingPreflightNames.has(name),
);
const missingNames = expectedPreparedNames.filter((name) => !actualNames.includes(name));
const unexpectedNames = actualNames.filter(
  (name) => !STAGE5_FINAL15_EXPECTED_EVIDENCE_ARTIFACT_NAMES.includes(name),
);
assert.deepEqual({ missingNames, unexpectedNames }, { missingNames: [], unexpectedNames: [] });
const result = {
  result: "PASS",
  candidate: "FINAL-15",
  copiedPredecessorArtifacts: STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES.length + 8,
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
