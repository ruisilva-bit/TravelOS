import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_FINAL11_CI_FAILED_INDEX_SHA256,
  STAGE5_FINAL11_CORRECTION_MATRIX,
  STAGE5_FINAL11_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL12_CORRECTION_MATRIX,
  STAGE5_FINAL12_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";
import {
  buildStage5Final12CorrectionMatrix,
  verifyStage5Final12FindingLineage,
} from "./stage-5-final12-finding-lineage.mjs";
const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const lineage = await verifyStage5Final12FindingLineage({ root });
const prior = JSON.parse(await readFile(path.join(root, STAGE5_FINAL11_CORRECTION_MATRIX), "utf8"));
const matrix = JSON.parse(
  await readFile(path.join(root, STAGE5_FINAL12_CORRECTION_MATRIX), "utf8"),
);
assert.equal(matrix.candidate, "FINAL-12");
assert.equal(matrix.result, "PASS");
assert.equal(matrix.stage6Actions, 0);
assert.equal(matrix.predecessor.candidate, "FINAL-11");
assert.equal(matrix.predecessor.status, "REJECTED / CI CONSUMED / FORMAT-GATE FAILURE");
assert.equal(matrix.predecessor.failedGate, "format:check");
assert.equal(matrix.predecessor.ciInvocationCount, 1);
assert.equal(matrix.predecessor.ciExitCode, 1);
assert.equal(matrix.predecessor.ciLogSha256, lineage.ciLog.sha256);
assert.equal(matrix.predecessor.ciFailedEvidenceIndexSha256, STAGE5_FINAL11_CI_FAILED_INDEX_SHA256);
assert.equal(
  matrix.predecessor.previousSecurityBaselineSha256,
  STAGE5_FINAL11_SECURITY_BASELINE_SHA256,
);
assert.equal(matrix.summary.totalFindingCount, 48);
assert.equal(matrix.summary.authorClosedCount, 0);
assert.equal(matrix.summary.priorGenerationFailureCount, 2);
assert.deepEqual(matrix.findings, prior.findings);
assert.equal(lineage.stage6Actions, 0);
assert.equal(
  sha256(
    await readFile(
      path.join(
        root,
        `${STAGE5_FINAL12_EVIDENCE_DIRECTORY}/final11-security-extension-baseline.json`,
      ),
    ),
  ),
  STAGE5_FINAL11_SECURITY_BASELINE_SHA256,
);
const rebuilt = buildStage5Final12CorrectionMatrix(lineage, prior);
assert.deepEqual(matrix, rebuilt);
process.stdout.write(
  JSON.stringify(
    {
      result: "PASS",
      candidate: "FINAL-12",
      carriedFindings: matrix.findings.length,
      priorFailures: matrix.summary.priorGenerationFailureCount,
      stage6Actions: 0,
    },
    null,
    2,
  ) + "\n",
);
