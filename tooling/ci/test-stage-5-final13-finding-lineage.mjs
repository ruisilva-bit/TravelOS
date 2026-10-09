import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_FINAL12_CORRECTION_MATRIX,
  STAGE5_FINAL12_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL13_CORRECTION_MATRIX,
} from "./stage-5-candidate-contract.mjs";
import {
  buildStage5Final13CorrectionMatrix,
  verifyStage5Final13FindingLineage,
} from "./stage-5-final13-finding-lineage.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lineage = await verifyStage5Final13FindingLineage({ root });
const previous = JSON.parse(
  await readFile(path.join(root, STAGE5_FINAL12_CORRECTION_MATRIX), "utf8"),
);
const matrixBytes = await readFile(path.join(root, STAGE5_FINAL13_CORRECTION_MATRIX));
const matrix = JSON.parse(matrixBytes.toString("utf8"));
assert.equal(matrix.candidate, "FINAL-13");
assert.equal(matrix.result, "PASS");
assert.equal(matrix.predecessor.candidate, "FINAL-12");
assert.equal(matrix.predecessor.status, "REJECTED / CI CONSUMED / LINT-GATE FAILURE");
assert.equal(matrix.predecessor.failedGate, "lint");
assert.equal(matrix.predecessor.ciInvocationCount, 1);
assert.equal(matrix.predecessor.ciExitCode, 1);
assert.equal(matrix.predecessor.ciLogSha256, lineage.ciLog.sha256);
assert.equal(matrix.predecessor.ciFailedEvidenceIndexSha256, lineage.evidenceIndex.sha256);
assert.equal(
  matrix.predecessor.previousSecurityBaselineSha256,
  STAGE5_FINAL12_SECURITY_BASELINE_SHA256,
);
assert.equal(matrix.summary.totalFindingCount, 48);
assert.equal(matrix.summary.authorClosedCount, 0);
assert.equal(matrix.summary.priorGenerationFailureCount, 3);
assert.deepEqual(matrix.findings, previous.findings);
assert.equal(lineage.stage6Actions, 0);
assert.deepEqual(matrix, buildStage5Final13CorrectionMatrix(lineage, previous));
process.stdout.write(
  `${JSON.stringify(
    {
      result: "PASS",
      candidate: "FINAL-13",
      matrixSha256: sha256(matrixBytes),
      carriedFindings: matrix.findings.length,
      priorFailures: matrix.summary.priorGenerationFailureCount,
      stage6Actions: 0,
    },
    null,
    2,
  )}\n`,
);
