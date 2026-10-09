import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_FINAL20_CORRECTION_MATRIX,
  STAGE5_FINAL20_CORRECTION_MATRIX_SHA256,
  STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT,
  STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT_SHA256,
  STAGE5_FINAL21_CORRECTION_MATRIX,
} from "./stage-5-candidate-contract.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `${file} must be a regular file`);
  return readFile(file);
};

export const verifyStage5Final21FindingLineage = async ({ root: candidateRoot = root } = {}) => {
  const workspace = path.resolve(candidateRoot);
  const matrixBytes = await readRegular(path.join(workspace, STAGE5_FINAL21_CORRECTION_MATRIX));
  const matrix = JSON.parse(matrixBytes.toString("utf8"));
  assert.equal(matrix.candidate, "FINAL-21");
  assert.equal(matrix.result, "PENDING_EXECUTION");
  assert.equal(matrix.findings.length, 49);
  assert.equal(matrix.summary.authorClosedCount, 0);
  assert.equal(matrix.summary.independentPendingCount, 49);
  assert.equal(matrix.stage6Actions, 0);
  assert(matrix.findings.every((finding) => finding.authorClosed === false));
  assert(
    matrix.findings.every(
      (finding) => finding.final21Status === "PENDING_FINAL21_INDEPENDENT_ADJUDICATION",
    ),
  );

  const predecessorMatrixBytes = await readRegular(
    path.join(workspace, STAGE5_FINAL20_CORRECTION_MATRIX),
  );
  assert.equal(hash(predecessorMatrixBytes), STAGE5_FINAL20_CORRECTION_MATRIX_SHA256);
  const predecessorMatrix = JSON.parse(predecessorMatrixBytes.toString("utf8"));
  assert.equal(predecessorMatrix.candidate, "FINAL-20");
  assert.equal(predecessorMatrix.findings.length, 49);
  assert.equal(predecessorMatrix.summary.authorClosedCount, 0);

  const failureBytes = await readRegular(
    path.join(workspace, STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT),
  );
  assert.equal(hash(failureBytes), STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT_SHA256);
  const failure = JSON.parse(failureBytes.toString("utf8"));
  assert.equal(failure.candidate, "FINAL-20");
  assert.equal(failure.phase, "FINAL_CANDIDATE");
  assert.equal(failure.result, "FAIL");
  assert.equal(failure.ciVerify.result, "PASS");
  assert.equal(failure.ciVerify.invocationCount, 1);
  assert.equal(failure.ciVerify.authorizationConsumed, true);
  assert.equal(failure.freeze.readbackIntegrity, "PASS");
  assert.equal(failure.stage6Actions, 0);

  return {
    schemaVersion: 1,
    result: "PASS",
    candidate: "FINAL-21",
    predecessor: {
      candidate: "FINAL-20",
      disposition: "CI PASS / FROZEN / FINAL-CANDIDATE SCAN BLOCKED BEFORE SCANNER",
      correctionMatrixSha256: hash(predecessorMatrixBytes),
      failureReceiptPath: STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT,
      failureReceiptSha256: hash(failureBytes),
      ciVerifyInvoked: true,
      ciVerifyInvocationCount: 1,
      ciAuthorizationConsumed: true,
      freezeSha256: failure.freeze.sha256,
      scanExecuted: false,
      stage6Actions: 0,
    },
    findings: {
      total: matrix.findings.length,
      authorClosed: matrix.summary.authorClosedCount,
      pendingIndependent: matrix.summary.independentPendingCount,
      ids: matrix.findings.map((finding) => finding.id).toSorted(),
    },
    correctionMatrix: {
      path: STAGE5_FINAL21_CORRECTION_MATRIX,
      bytes: matrixBytes.length,
      sha256: hash(matrixBytes),
    },
    stage6Actions: 0,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyStage5Final21FindingLineage();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
