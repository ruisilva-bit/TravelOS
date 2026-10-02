import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  buildStage5Final10CorrectionMatrix,
  verifyStage5Final8TaggedBytes,
  verifyStage5Final9RejectedTaggedBytes,
} from "./stage-5-finding-lineage.mjs";
import {
  STAGE5_FINAL10_CORRECTION_MATRIX,
  STAGE5_FINAL9_CORRECTION_MATRIX,
  STAGE5_FINAL9_INDEPENDENT_REVIEW,
  STAGE5_FINAL9_REJECTED_TAG,
  STAGE5_FINAL9_REJECTED_TAG_TARGET,
} from "./stage-5-candidate-contract.mjs";

const projectRoot = process.cwd();
const readTagBytes = (relativePath) =>
  execFileSync("git", ["show", `${STAGE5_FINAL9_REJECTED_TAG}:${relativePath}`], {
    cwd: projectRoot,
  });

const protectedFinal8 = await verifyStage5Final8TaggedBytes({ root: projectRoot });
const protectedFinal9 = await verifyStage5Final9RejectedTaggedBytes({ root: projectRoot });
assert.equal(protectedFinal8.result, "PASS");
assert.equal(protectedFinal9.result, "PASS");
assert.equal(protectedFinal9.target, STAGE5_FINAL9_REJECTED_TAG_TARGET);

const historicalMatrixBytes = readTagBytes(STAGE5_FINAL9_CORRECTION_MATRIX);
const historicalMatrix = JSON.parse(historicalMatrixBytes.toString("utf8"));
const final9ReviewBytes = await readFile(path.join(projectRoot, STAGE5_FINAL9_INDEPENDENT_REVIEW));
const expectedMatrix = buildStage5Final10CorrectionMatrix({
  final9Matrix: historicalMatrix,
  final9MatrixBytes: historicalMatrixBytes,
  final9ReviewBytes,
});
const persistedMatrix = JSON.parse(
  await readFile(path.join(projectRoot, STAGE5_FINAL10_CORRECTION_MATRIX), "utf8"),
);

assert.deepEqual(persistedMatrix, expectedMatrix);
assert.equal(expectedMatrix.summary.carriedFinal9FindingCount, 45);
assert.equal(expectedMatrix.summary.final9IndependentReviewFindingCount, 3);
assert.equal(expectedMatrix.summary.totalFindingCount, 48);
assert.equal(expectedMatrix.summary.authorClosedCount, 0);
assert.equal(expectedMatrix.summary.independentPendingCount, 48);
assert.equal(expectedMatrix.stage6Actions, 0);
assert.ok(
  expectedMatrix.findings.every(
    (finding) =>
      finding.final10Disposition === "PENDING_REMEDIATION_REQUALIFICATION" &&
      finding.final10IndependentStatus === "PENDING_FINAL10_REVIEW",
  ),
);

const omittedHistoricalFinding = {
  ...historicalMatrix,
  findings: historicalMatrix.findings.slice(1),
};
assert.throws(
  () =>
    buildStage5Final10CorrectionMatrix({
      final9Matrix: omittedHistoricalFinding,
      final9MatrixBytes: historicalMatrixBytes,
      final9ReviewBytes,
    }),
  /must preserve the exact ordered, duplicate-free finding IDs/u,
);

const alteredReviewMatrix = buildStage5Final10CorrectionMatrix({
  final9Matrix: historicalMatrix,
  final9MatrixBytes: historicalMatrixBytes,
  final9ReviewBytes: Buffer.concat([final9ReviewBytes, Buffer.from("\n", "utf8")]),
});
assert.notEqual(
  alteredReviewMatrix.predecessor.independentReview.sha256,
  persistedMatrix.predecessor.independentReview.sha256,
);

console.log(
  JSON.stringify(
    {
      schemaVersion: 2,
      result: "PASS",
      protectedFinal8Tag: protectedFinal8.tag,
      protectedFinal9Tag: protectedFinal9.tag,
      protectedFinal9Target: protectedFinal9.target,
      carriedFinal9Findings: expectedMatrix.summary.carriedFinal9FindingCount,
      final9IndependentReviewFindings: expectedMatrix.summary.final9IndependentReviewFindingCount,
      totalFindings: expectedMatrix.summary.totalFindingCount,
      omittedHistoricalFindingRejected: true,
      changedReviewBytesDetected: true,
      authorClosed: expectedMatrix.summary.authorClosedCount,
      independentPending: expectedMatrix.summary.independentPendingCount,
      stage6Actions: 0,
    },
    null,
    2,
  ),
);
