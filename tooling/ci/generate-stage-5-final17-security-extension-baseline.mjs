import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL14_REVIEW_NO_GO_SHA256,
  STAGE5_FINAL16_BASELINE_SHA256,
  STAGE5_FINAL16_EVIDENCE_DIRECTORY,
  STAGE5_FINAL16_EVIDENCE_INDEX_SHA256,
  STAGE5_FINAL16_PACKAGE_SHA256,
  STAGE5_FINAL16_PREFLIGHT_FAILURE_LOG,
  STAGE5_FINAL16_PREFLIGHT_FAILURE_LOG_SHA256,
  STAGE5_FINAL16_PREFLIGHT_FAILURE_RECEIPT,
  STAGE5_FINAL16_PREFLIGHT_FAILURE_RECEIPT_SHA256,
  STAGE5_FINAL16_READINESS_SHA256,
  STAGE5_FINAL16_RUNNER_SHA256,
  STAGE5_FINAL17_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final17FindingLineage } from "./stage-5-final17-finding-lineage.mjs";
import {
  STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
  STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
  STAGE5_FINAL17_SECURITY_EXTENSION_PROTECTED_PATHS,
  verifyStage5SecurityExtensionBaseline,
} from "./verify-stage-5-security-extension-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const baselinePath = path.join(root, STAGE5_SECURITY_EXTENSION_BASELINE_PATH);
const STAGE5_FINAL14_CORRECTION_MATRIX_SHA256 =
  "7eb5131467754839732df46f711ff8992de49a5eeab66dbd0c9256d547113ff9";
const STAGE5_FINAL14_FREEZE_SHA256 =
  "282be00d175690e7e42ab925d09dd601cd7d310648b38b4ca475b1ba2a5b05bf";
const STAGE5_FINAL14_INDEX_SHA256 =
  "4c82b8f68547c3ec3b00673a9afcfd265b06013f51c01c78145fbe586add6478";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const serialize = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");
const allowedDeltas = ["package.json"];

export const buildStage5Final17SecurityExtensionBaseline = ({
  previousBaseline,
  currentFiles,
  lineage,
}) => {
  assert.equal(previousBaseline.result, "PASS");
  assert.equal(
    hash(Buffer.from(`${JSON.stringify(previousBaseline, null, 2)}\n`)),
    STAGE5_FINAL16_BASELINE_SHA256,
  );
  assert.equal(previousBaseline.lineage.final14Generation?.candidate, "FINAL-14");
  assert.equal(previousBaseline.lineage.final15Generation?.candidate, "FINAL-15");
  assert.equal(previousBaseline.lineage.final16Generation?.candidate, "FINAL-16");
  assert.equal(lineage.result, "PASS");
  assert.equal(lineage.candidate, "FINAL-17");
  assert.equal(lineage.totalFindingCount, 49);
  assert.equal(lineage.stage6Actions, 0);
  const previousRows = previousBaseline.protectedFiles;
  const rows = currentFiles.map(({ path: relativePath, bytes }) => ({
    path: relativePath,
    bytes: bytes.length,
    sha256: hash(bytes),
  }));
  assert.deepEqual(
    rows.map((row) => row.path),
    [...STAGE5_FINAL17_SECURITY_EXTENSION_PROTECTED_PATHS],
  );
  const previous = new Map(previousRows.map((row) => [row.path, row]));
  const deltas = rows
    .filter((row) => previous.get(row.path)?.sha256 !== row.sha256)
    .map((row) => ({
      path: row.path,
      previousSha256: previous.get(row.path)?.sha256,
      currentSha256: row.sha256,
    }))
    .toSorted((left, right) => left.path.localeCompare(right.path));
  assert.deepEqual(
    deltas.map((delta) => delta.path),
    allowedDeltas,
    "FINAL-17 refuses missing, extra, duplicate or unauthorized protected drift",
  );
  const next = JSON.parse(JSON.stringify(previousBaseline));
  const extensionDocument = currentFiles.find(
    (file) => file.path === STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
  )?.bytes;
  assert(extensionDocument);
  next.extension.permissionRegistryVersion = 3;
  next.lineage.extensionDocument = {
    path: STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
    sha256: hash(extensionDocument),
  };
  const packageBytes = currentFiles.find((file) => file.path === "package.json")?.bytes;
  assert(packageBytes);
  next.lineage.final17Generation = {
    candidate: "FINAL-17",
    previousBaselineSha256: STAGE5_FINAL16_BASELINE_SHA256,
    packageJsonSha256: hash(packageBytes),
    runnerSha256: lineage.runner.sha256,
    correctionMatrixSha256: lineage.correctionMatrix.sha256,
    independentReviewNoGoSha256: STAGE5_FINAL14_REVIEW_NO_GO_SHA256,
    stage6Actions: 0,
    protectedPathDeltas: deltas,
  };
  next.lineage.rejectedFinal15Candidate = lineage.rejectedFinal15Candidate;
  next.lineage.rejectedFinal16Candidate = lineage.rejectedFinal16Candidate;
  next.lineage.rejectedFinal14Candidate = {
    candidate: "FINAL-14",
    status: "REJECTED / CI CONSUMED / CI PASS / INDEPENDENT REVIEW NO-GO",
    ciCommand: "corepack pnpm ci:verify",
    ciInvocationCount: 1,
    ciResult: "PASS",
    ciExitCode: 0,
    ciLogSha256: lineage.final14.ciLogSha256,
    ciExecutionSha256: lineage.final14.ciExecutionSha256,
    invocationGuardSha256: lineage.final14.invocationGuardSha256,
    evidenceIndexSha256: STAGE5_FINAL14_INDEX_SHA256,
    correctionMatrixSha256: STAGE5_FINAL14_CORRECTION_MATRIX_SHA256,
    independentReviewNoGoSha256: STAGE5_FINAL14_REVIEW_NO_GO_SHA256,
    freezeSha256: STAGE5_FINAL14_FREEZE_SHA256,
    stage6Actions: 0,
  };
  next.protectedFiles = rows;
  next.aggregateSha256 = hash(Buffer.from(serialize(rows)));
  return next;
};

export const generateStage5Final17SecurityExtensionBaseline = async ({
  root: candidateRoot = root,
} = {}) => {
  const rootDir = path.resolve(candidateRoot);
  const evidenceDirectory = path.join(rootDir, STAGE5_FINAL17_EVIDENCE_DIRECTORY);
  const priorBaselinePath = path.join(
    evidenceDirectory,
    "final16-security-extension-baseline.json",
  );
  const currentBaselineBytes = await readFile(
    path.join(rootDir, STAGE5_SECURITY_EXTENSION_BASELINE_PATH),
  );
  const currentHash = hash(currentBaselineBytes);
  assert.equal(
    currentHash,
    STAGE5_FINAL16_BASELINE_SHA256,
    "FINAL-17 baseline generation is one-shot from the immutable FINAL-16 baseline; after capture, verify read-only and create a successor if inputs change",
  );
  const priorBytes = currentBaselineBytes;
  assert.equal(
    hash(priorBytes),
    STAGE5_FINAL16_BASELINE_SHA256,
    "preserved FINAL-16 baseline copy changed",
  );
  const predecessorFailureBytes = await readFile(
    path.join(rootDir, STAGE5_FINAL16_PREFLIGHT_FAILURE_RECEIPT),
  );
  const predecessorFailureLog = await readFile(
    path.join(rootDir, STAGE5_FINAL16_PREFLIGHT_FAILURE_LOG),
  );
  const predecessorFailure = JSON.parse(predecessorFailureBytes.toString("utf8"));
  assert.equal(hash(predecessorFailureBytes), STAGE5_FINAL16_PREFLIGHT_FAILURE_RECEIPT_SHA256);
  assert.equal(hash(predecessorFailureLog), STAGE5_FINAL16_PREFLIGHT_FAILURE_LOG_SHA256);
  assert.equal(predecessorFailure.candidate, "FINAL-16");
  assert.equal(predecessorFailure.result, "REJECTED");
  assert.equal(predecessorFailure.ci.invocationCount, 0);
  assert.equal(predecessorFailure.ci.authorizationConsumed, false);
  assert.equal(predecessorFailure.stage6Actions, 0);
  assert.equal(
    hash(
      await readFile(
        path.join(rootDir, `${STAGE5_FINAL16_EVIDENCE_DIRECTORY}/readiness-preflight.json`),
      ),
    ),
    STAGE5_FINAL16_READINESS_SHA256,
  );
  assert.equal(
    hash(
      await readFile(
        path.join(rootDir, `${STAGE5_FINAL16_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`),
      ),
    ),
    STAGE5_FINAL16_EVIDENCE_INDEX_SHA256,
  );
  assert.equal(
    hash(await readFile(path.join(evidenceDirectory, "final16-package.json"))),
    STAGE5_FINAL16_PACKAGE_SHA256,
  );
  assert.equal(
    hash(await readFile(path.join(rootDir, "tooling/ci/run-stage-5-final16-authoritative-ci.mjs"))),
    STAGE5_FINAL16_RUNNER_SHA256,
  );
  const previousBaseline = JSON.parse(priorBytes.toString("utf8"));
  const lineage = await verifyStage5Final17FindingLineage({ root: rootDir });
  const currentFiles = await Promise.all(
    STAGE5_FINAL17_SECURITY_EXTENSION_PROTECTED_PATHS.map(async (relativePath) => ({
      path: relativePath,
      bytes: await readFile(path.join(rootDir, relativePath)),
    })),
  );
  const baseline = buildStage5Final17SecurityExtensionBaseline({
    previousBaseline,
    currentFiles,
    lineage,
  });
  const bytes = Buffer.from(`${JSON.stringify(baseline, null, 2)}\n`);
  const baselineSha256 = hash(bytes);
  const candidateVerification = await verifyStage5SecurityExtensionBaseline({
    root: rootDir,
    expectedBaselineSha256: baselineSha256,
    requireCandidate: "FINAL-17",
    baselineBytesOverride: bytes,
  });
  assert.equal(candidateVerification.result, "PASS");
  await mkdir(evidenceDirectory, { recursive: true });
  try {
    const existing = await readFile(priorBaselinePath);
    assert.deepEqual(existing, priorBytes, "preserved FINAL-15 failed baseline copy changed");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(priorBaselinePath, priorBytes, { flag: "wx" });
  }
  await writeFile(baselinePath, bytes);
  const verification = await verifyStage5SecurityExtensionBaseline({
    root: rootDir,
    expectedBaselineSha256: baselineSha256,
    requireCandidate: "FINAL-17",
  });
  assert.equal(verification.result, "PASS");
  const receipt = {
    schemaVersion: 1,
    candidate: "FINAL-17",
    result: "PASS",
    generationOrder: [
      "FINAL-17 runner/script references finalized",
      "package.json finalized",
      "candidate-specific tooling/configuration finalized",
      "in-memory FINAL-17 manifest built from final candidate bytes",
      "full semantic baseline verifier passed in-memory before the active manifest was touched",
      "active Phase 1 baseline written once",
      "read-only verification against the written baseline passed",
    ],
    preWriteVerification: {
      result: candidateVerification.result,
      baselineSha256: candidateVerification.phase1.baselineSha256,
      candidate: "FINAL-17",
    },
    previousBaselineSha256: hash(priorBytes),
    baselineSha256,
    baselineBytes: bytes.length,
    protectedPathCount: rowsCount(baseline.protectedFiles),
    permittedDeltaPaths: baseline.lineage.final17Generation.protectedPathDeltas.map(
      (delta) => delta.path,
    ),
    packageJsonSha256: baseline.lineage.final17Generation.packageJsonSha256,
    runnerSha256: baseline.lineage.final17Generation.runnerSha256,
    predecessorFailure: {
      receiptSha256: hash(predecessorFailureBytes),
      logSha256: hash(predecessorFailureLog),
      preflightReadinessSha256: STAGE5_FINAL16_READINESS_SHA256,
      evidenceIndexSha256: STAGE5_FINAL16_EVIDENCE_INDEX_SHA256,
    },
    final16RejectedGeneration: baseline.lineage.rejectedFinal16Candidate,
    final15RejectedGeneration: baseline.lineage.rejectedFinal15Candidate,
    final14ReviewNoGoSha256: STAGE5_FINAL14_REVIEW_NO_GO_SHA256,
    toolchain: { node: process.version },
    stage6Actions: 0,
  };
  await writeFile(
    path.join(evidenceDirectory, "baseline-generation.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
};

function rowsCount(rows) {
  assert.equal(rows.length, STAGE5_FINAL17_SECURITY_EXTENSION_PROTECTED_PATHS.length);
  return rows.length;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
  process.argv.includes("--write")
) {
  const receipt = await generateStage5Final17SecurityExtensionBaseline();
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}
