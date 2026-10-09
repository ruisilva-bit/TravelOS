import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL18_CORRECTION_MATRIX,
  STAGE5_FINAL18_EVIDENCE_INDEX,
  STAGE5_FINAL19_CORRECTION_MATRIX,
  STAGE5_FINAL19_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final18EvidenceIndex } from "./stage-5-final18-evidence-index.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `${file} must be a regular file`);
  return readFile(file);
};

export const verifyStage5Final19FindingLineage = async ({
  candidateRoot = root,
  write = false,
} = {}) => {
  const workspace = path.resolve(candidateRoot);
  const predecessorIndex = await verifyStage5Final18EvidenceIndex({
    root: workspace,
    allowedPhases: ["PRE_CI"],
    requiredPhase: "PRE_CI",
  });
  assert.equal(predecessorIndex.candidate, "FINAL-18");
  assert.equal(predecessorIndex.result, "PASS");
  assert.equal(predecessorIndex.stage6Actions, 0);
  const predecessorMatrixBytes = await readRegular(
    path.join(workspace, STAGE5_FINAL18_CORRECTION_MATRIX),
  );
  const predecessorMatrix = JSON.parse(predecessorMatrixBytes.toString("utf8"));
  assert.equal(predecessorMatrix.candidate, "FINAL-18");
  assert.equal(predecessorMatrix.findings.length, 49);
  const failurePath = ".hermes/state/stage5-final18-preflight-failure-01.json";
  const failureBytes = await readRegular(path.join(workspace, failurePath));
  const failure = JSON.parse(failureBytes.toString("utf8"));
  assert.equal(failure.candidate, "FINAL-18");
  assert.equal(failure.result, "REJECTED / PRE-CI FINAL VERIFICATION FAILURE / CI NOT STARTED");
  assert.equal(failure.ciVerifyInvoked, false);
  assert.equal(failure.ciVerifyInvocationCount, 0);
  assert.equal(failure.ciInvocationGuardExists, false);
  assert.equal(failure.stage6Actions, 0);
  const predecessorBaselineArchive = path.join(
    workspace,
    STAGE5_FINAL19_EVIDENCE_DIRECTORY,
    "final18-security-extension-baseline.json",
  );
  let failureBaselineBytes;
  try {
    failureBaselineBytes = await readRegular(predecessorBaselineArchive);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    failureBaselineBytes = await readRegular(path.join(workspace, failure.evidence.baselinePath));
  }
  const failureIndexBytes = await readRegular(
    path.join(workspace, failure.evidence.evidenceIndexPath),
  );
  assert.equal(hash(failureBaselineBytes), failure.evidence.baselineSha256);
  assert.equal(hash(failureIndexBytes), failure.evidence.evidenceIndexSha256);
  assert.equal(hash(failureIndexBytes), predecessorIndex.indexSha256);

  const matrixBytes = await readRegular(path.join(workspace, STAGE5_FINAL19_CORRECTION_MATRIX));
  const matrix = JSON.parse(matrixBytes.toString("utf8"));
  const expectedIds = predecessorMatrix.findings.map((finding) => finding.id).toSorted();
  const actualIds = matrix.findings.map((finding) => finding.id).toSorted();
  assert.equal(matrix.schemaVersion, 1);
  assert.equal(matrix.candidate, "FINAL-19");
  assert.equal(matrix.result, "PENDING_EXECUTION");
  assert.deepEqual(
    actualIds,
    expectedIds,
    "FINAL-19 must carry every FINAL-18 finding exactly once",
  );
  assert.equal(new Set(actualIds).size, expectedIds.length, "finding IDs must be unique");
  assert.equal(matrix.summary.totalFindingCount, 49);
  assert.equal(matrix.summary.authorClosedCount, 0);
  assert.equal(matrix.summary.independentPendingCount, 49);
  assert.equal(matrix.predecessor.candidate, "FINAL-18");
  assert.equal(matrix.predecessor.disposition, failure.result);
  assert.equal(matrix.predecessor.failureReceiptSha256, hash(failureBytes));
  assert.equal(matrix.predecessor.baselineSha256, failure.evidence.baselineSha256);
  assert.equal(matrix.predecessor.evidenceIndexSha256, predecessorIndex.indexSha256);
  assert.equal(matrix.predecessor.ciVerifyInvoked, false);
  assert.equal(matrix.predecessor.ciVerifyInvocationCount, 0);
  assert.equal(matrix.predecessor.ciAuthorizationConsumed, false);
  assert.equal(matrix.predecessor.ciAuthorizationTransferred, false);
  assert.equal(matrix.stage6Actions, 0);
  for (const finding of matrix.findings) {
    assert.equal(finding.authorClosed, false, `author closure is forbidden: ${finding.id}`);
    assert.equal(finding.final19Status, "PENDING_FINAL19_INDEPENDENT_ADJUDICATION");
    assert.equal(finding.requiresIndependentReview, true);
  }

  const lineage = {
    schemaVersion: 1,
    result: "PASS",
    candidate: "FINAL-19",
    predecessor: {
      candidate: "FINAL-18",
      disposition: failure.result,
      baselineSha256: hash(failureBaselineBytes),
      evidenceIndexPath: STAGE5_FINAL18_EVIDENCE_INDEX,
      evidenceIndexSha256: predecessorIndex.indexSha256,
      evidenceAggregateSha256: predecessorIndex.aggregateSha256,
      correctionMatrixPath: STAGE5_FINAL18_CORRECTION_MATRIX,
      correctionMatrixSha256: hash(predecessorMatrixBytes),
      failureReceiptPath: failurePath,
      failureReceiptSha256: hash(failureBytes),
      ciVerifyInvoked: false,
      ciVerifyInvocationCount: 0,
      stage6Actions: 0,
    },
    correctionMatrix: {
      path: STAGE5_FINAL19_CORRECTION_MATRIX,
      bytes: matrixBytes.length,
      sha256: hash(matrixBytes),
    },
    findings: { total: 49, authorClosed: 0, pendingIndependent: 49, ids: actualIds },
    stage6Actions: 0,
  };
  const outputPath = path.join(
    workspace,
    STAGE5_FINAL19_EVIDENCE_DIRECTORY,
    "finding-lineage.json",
  );
  if (write) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(lineage, null, 2)}\n`, { flag: "wx" });
  }
  return {
    ...lineage,
    evidencePath: `${STAGE5_FINAL19_EVIDENCE_DIRECTORY}/finding-lineage.json`,
    evidenceSha256: write ? hash(await readRegular(outputPath)) : null,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyStage5Final19FindingLineage({
    write: process.argv.includes("--write"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
