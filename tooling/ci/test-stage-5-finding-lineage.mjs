import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildStage5Final9CorrectionMatrix,
  verifyStage5Final8TaggedBytes,
  verifyStage5Final9FindingLineageData,
} from "./stage-5-finding-lineage.mjs";
import {
  STAGE5_FINAL9_CORRECTION_MATRIX,
  STAGE5_FINAL9_EVIDENCE_INDEX,
  STAGE5_FINAL9_EVIDENCE_DIRECTORY,
  STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT,
} from "./stage-5-candidate-contract.mjs";

const projectRoot = process.cwd();
const protectedPredecessor = await verifyStage5Final8TaggedBytes({ root: projectRoot });
assert.equal(protectedPredecessor.result, "PASS");
assert.equal(protectedPredecessor.target, "294657132bf8a5b47181efd90732d5d8f2530c8e");
assert.equal(protectedPredecessor.files.length, 2);
assert.ok(protectedPredecessor.files.every((entry) => entry.matchesRejectedTag));
const reviewBytes = await readFile(path.join(projectRoot, STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT));
const review = JSON.parse(reviewBytes.toString("utf8"));
const matrix = buildStage5Final9CorrectionMatrix({ review, reviewBytes });
const root = await mkdtemp(path.join(os.tmpdir(), "travelos-stage5-finding-lineage-"));
const evidenceDirectory = path.join(root, STAGE5_FINAL9_EVIDENCE_DIRECTORY);
const reviewPath = path.join(root, STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT);
const matrixPath = path.join(root, STAGE5_FINAL9_CORRECTION_MATRIX);
const indexPath = path.join(root, STAGE5_FINAL9_EVIDENCE_INDEX);

const writeFixture = async () => {
  await mkdir(evidenceDirectory, { recursive: true });
  await mkdir(path.dirname(matrixPath), { recursive: true });
  await writeFile(reviewPath, reviewBytes);
  await writeFile(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);
  await writeFile(
    indexPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        phase: "PRE_CI",
        artifacts: [{ path: STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT }],
      },
      null,
      2,
    )}\n`,
  );
};

try {
  await writeFixture();
  const valid = await verifyStage5Final9FindingLineageData({ root });
  assert.equal(valid.result, "PASS");
  assert.equal(valid.final8ReviewFindingCount, 19);
  assert.equal(valid.carriedHistoricalFindingCount, 26);
  assert.equal(valid.totalFindingCount, 45);
  assert.equal(valid.authorClosedCount, 0);
  assert.equal(valid.independentPendingCount, 45);
  assert.equal(valid.stage6Actions, 0);

  const originalMatrixBytes = await readFile(matrixPath);
  const missing = { ...matrix, findings: matrix.findings.slice(1) };
  await writeFile(matrixPath, `${JSON.stringify(missing, null, 2)}\n`);
  await assert.rejects(
    verifyStage5Final9FindingLineageData({ root }),
    /omits, changes, closes, or misattributes/u,
  );

  const closed = {
    ...matrix,
    findings: matrix.findings.map((finding, index) =>
      index === 0 ? { ...finding, final9IndependentStatus: "CLOSED" } : finding,
    ),
  };
  await writeFile(matrixPath, `${JSON.stringify(closed, null, 2)}\n`);
  await assert.rejects(
    verifyStage5Final9FindingLineageData({ root }),
    /omits, changes, closes, or misattributes/u,
  );
  await writeFile(matrixPath, originalMatrixBytes);

  await writeFile(reviewPath, Buffer.concat([reviewBytes, Buffer.from(" ", "utf8")]));
  await assert.rejects(verifyStage5Final9FindingLineageData({ root }), /bytes do not match/u);
  await writeFile(reviewPath, reviewBytes);

  await writeFile(
    indexPath,
    `${JSON.stringify({ schemaVersion: 1, phase: "PRE_CI", artifacts: [] }, null, 2)}\n`,
  );
  await assert.rejects(verifyStage5Final9FindingLineageData({ root }), /evidence index omits/u);

  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        result: "PASS",
        protectedPredecessor: {
          tag: protectedPredecessor.tag,
          target: protectedPredecessor.target,
          matchedProtectedFiles: protectedPredecessor.files.length,
        },
        final8ReviewFindings: valid.final8ReviewFindingCount,
        carriedHistoricalFindings: valid.carriedHistoricalFindingCount,
        totalFindings: valid.totalFindingCount,
        omittedFindingRejected: true,
        authorClosureRejected: true,
        mutatedSourceRejected: true,
        unindexedReviewSourceRejected: true,
        stage6Actions: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
