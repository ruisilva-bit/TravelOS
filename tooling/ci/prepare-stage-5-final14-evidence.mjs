import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, lstat, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL14_CI_VERIFY_INVOCATION_GUARD,
  STAGE5_FINAL13_CANDIDATE_FREEZE,
  STAGE5_FINAL13_CANDIDATE_VALIDATION,
  STAGE5_FINAL13_CORRECTION_MATRIX,
  STAGE5_FINAL13_EVIDENCE_DIRECTORY,
  STAGE5_FINAL13_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL13_REVIEW_NO_GO,
  STAGE5_FINAL13_ARCHIVE_MANIFEST,
  STAGE5_FINAL13_SOURCE_ARCHIVE,
  STAGE5_FINAL14_CORRECTION_MATRIX,
  STAGE5_FINAL14_EVIDENCE_DIRECTORY,
  STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL13_SECURITY_BASELINE_SHA256,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final13EvidenceIndex } from "./stage-5-final13-evidence-index.mjs";
import {
  verifyStage5Final14Predecessor,
  writeStage5Final14CorrectionMatrix,
  verifyStage5Final14FindingLineage,
} from "./stage-5-final14-finding-lineage.mjs";
import { STAGE5_SECURITY_EXTENSION_BASELINE_PATH } from "./verify-stage-5-security-extension-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.join(root, STAGE5_FINAL14_EVIDENCE_DIRECTORY);
const postgresDirectory = path.resolve(
  process.env.TRAVELOS_STAGE5_FINAL14_QUALIFICATION_DIR ??
    "/home/hermes/.hermes/cache/scratch/travelos-stage5-final14-qualification",
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const writeJson = async (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

const predecessor = await verifyStage5Final14Predecessor({ root });
const priorIndex = await verifyStage5Final13EvidenceIndex({
  root,
  allowedPhases: ["FINAL"],
  requiredPhase: "FINAL",
});
assert.equal(priorIndex.indexSha256, predecessor.final13IndexSha256);
await lstat(path.join(root, STAGE5_SECURITY_EXTENSION_BASELINE_PATH));
try {
  await lstat(path.join(root, STAGE5_FINAL14_CI_VERIFY_INVOCATION_GUARD));
  throw new Error(
    "Refusing to regenerate FINAL-14 evidence after its CI authorization was consumed",
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
try {
  await lstat(evidenceDirectory);
  const entries = await readdir(evidenceDirectory, { withFileTypes: true });
  const allowed = new Set([
    ...STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
    "EVIDENCE_INDEX.json",
  ]);
  assert(
    entries.every((entry) => entry.isFile() && !entry.isSymbolicLink() && allowed.has(entry.name)),
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  await mkdir(evidenceDirectory, { recursive: false });
}
for (const name of STAGE5_FINAL13_EXPECTED_EVIDENCE_ARTIFACT_NAMES) {
  await copyFile(
    path.join(root, STAGE5_FINAL13_EVIDENCE_DIRECTORY, name),
    path.join(evidenceDirectory, `final13-${name}`),
  );
}
for (const [target, source] of [
  ["final13-correction-matrix.json", STAGE5_FINAL13_CORRECTION_MATRIX],
  ["final13-candidate-validation.md", STAGE5_FINAL13_CANDIDATE_VALIDATION],
  ["final13-candidate-freeze.md", STAGE5_FINAL13_CANDIDATE_FREEZE],
  ["final13-independent-review-no-go.json", STAGE5_FINAL13_REVIEW_NO_GO],
  ["final13-archive-manifest.json", STAGE5_FINAL13_ARCHIVE_MANIFEST],
  ["final13-frozen-source-snapshot.tar.gz", STAGE5_FINAL13_SOURCE_ARCHIVE],
  ["final13-EVIDENCE_INDEX.json", `${STAGE5_FINAL13_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`],
]) {
  await copyFile(path.join(root, source), path.join(evidenceDirectory, target));
}
const final13BaselineCopyPath = path.join(
  evidenceDirectory,
  "final13-security-extension-baseline.json",
);
let final13BaselineBytes;
try {
  final13BaselineBytes = await readFile(final13BaselineCopyPath);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  final13BaselineBytes = await readFile(path.join(root, STAGE5_SECURITY_EXTENSION_BASELINE_PATH));
  assert.equal(
    hash(final13BaselineBytes),
    STAGE5_FINAL13_SECURITY_BASELINE_SHA256,
    "active baseline is no longer the immutable FINAL-13 predecessor; refusing to copy it",
  );
  await writeFile(final13BaselineCopyPath, final13BaselineBytes, { flag: "wx" });
}
assert.equal(
  hash(final13BaselineBytes),
  STAGE5_FINAL13_SECURITY_BASELINE_SHA256,
  "preserved FINAL-13 baseline copy has unexpected bytes",
);

const sourceFiles = [
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
for (const [target, source] of sourceFiles) {
  const bytes = await readFile(path.join(postgresDirectory, source));
  await writeFile(path.join(evidenceDirectory, target), bytes);
  copied[target] = { bytes: bytes.length, sha256: hash(bytes) };
}
const integrationExecutionBytes = await readFile(
  path.join(postgresDirectory, "integration-test-execution.json"),
);
const cleanupBytes = await readFile(path.join(postgresDirectory, "disposable-cleanup.json"));
const integrationExecution = {
  ...(await readJson(path.join(postgresDirectory, "integration-test-execution.json"))),
  sha256: hash(integrationExecutionBytes),
};
const disposableCleanup = {
  ...(await readJson(path.join(postgresDirectory, "disposable-cleanup.json"))),
  sha256: hash(cleanupBytes),
};
const qualificationExecution = await readJson(
  path.join(postgresDirectory, "qualification-execution.json"),
);
const qualification = {
  schemaVersion: 1,
  candidate: "FINAL-14",
  result: "PASS",
  integrationExecution,
  disposableCleanup,
  packageBuild: await readJson(path.join(postgresDirectory, "package-build.json")),
  packageProvenance: await readJson(
    path.join(postgresDirectory, "postgresql-package-provenance.json"),
  ),
  postgresqlRuntime: await readJson(path.join(postgresDirectory, "postgresql-runtime.json")),
  qualificationExecution,
  integrationLog: copied["postgresql-integration-tests.log"],
  runnerLog: copied["postgresql-qualification-runner.log"],
  sourceTestPath: "tests/integration/stage-5-postgresql.test.ts",
  sourceTestSha256: hash(
    await readFile(path.join(root, "tests/integration/stage-5-postgresql.test.ts")),
  ),
  stage6Actions: 0,
};
await writeJson(path.join(evidenceDirectory, "postgresql-qualification.json"), qualification);
const matrixResult = await writeStage5Final14CorrectionMatrix({ root });
assert.equal(matrixResult.result, "PASS");
const matrixBytes = await readFile(path.join(root, STAGE5_FINAL14_CORRECTION_MATRIX));
await writeFile(path.join(evidenceDirectory, "final14-correction-matrix.json"), matrixBytes);
const lineage = await verifyStage5Final14FindingLineage({ root });
await writeJson(path.join(evidenceDirectory, "finding-lineage.json"), lineage);
const expectedCurrentArtifacts = STAGE5_FINAL14_EXPECTED_EVIDENCE_ARTIFACT_NAMES.filter(
  (name) => !name.startsWith("final13-"),
);
assert(expectedCurrentArtifacts.includes("final14-correction-matrix.json"));
assert.equal(lineage.result, "PASS");
const result = {
  result: "PASS",
  candidate: "FINAL-14",
  predecessor: {
    freezeSha256: predecessor.freezeSha256,
    indexSha256: predecessor.final13IndexSha256,
    reviewDecision: "NO-GO",
  },
  copiedPredecessorArtifacts: STAGE5_FINAL13_EXPECTED_EVIDENCE_ARTIFACT_NAMES.length + 8,
  postgresqlQualification: qualification,
  evidenceArtifactsCopied: Object.keys(copied).length,
  correctionMatrixSha256: matrixResult.sha256,
  findingLineageSha256: hash(Buffer.from(`${JSON.stringify(lineage, null, 2)}\n`)),
  stage6Actions: 0,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
