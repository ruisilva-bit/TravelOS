import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL11_CI_EXECUTION,
  STAGE5_FINAL11_CI_EXECUTION_SHA256,
  STAGE5_FINAL11_CI_FAILED_EVIDENCE_INDEX,
  STAGE5_FINAL11_CI_FAILED_INDEX_SHA256,
  STAGE5_FINAL11_CI_LOG,
  STAGE5_FINAL11_CI_LOG_SHA256,
  STAGE5_FINAL11_INVOCATION_GUARD_PATH,
  STAGE5_FINAL11_INVOCATION_GUARD_SHA256,
  STAGE5_FINAL11_PRE_FORMAT_SNAPSHOT_SHA256,
  STAGE5_FINAL11_REJECTION_RECORD,
  STAGE5_FINAL11_REJECTION_RECORD_SHA256,
  STAGE5_FINAL11_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL11_CORRECTION_MATRIX,
  STAGE5_FINAL11_CORRECTION_MATRIX_SHA256,
  STAGE5_FINAL12_CORRECTION_MATRIX,
  STAGE5_FINAL12_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assertBytes = async (root, relativePath, expectedSha256) => {
  const absolutePath = path.join(root, relativePath);
  const metadata = await lstat(absolutePath);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `${relativePath} must be a regular file`);
  const bytes = await readFile(absolutePath);
  assert.equal(sha256(bytes), expectedSha256, `${relativePath} historical bytes changed`);
  return bytes;
};

export const verifyStage5Final12FindingLineage = async ({ root = repositoryRoot } = {}) => {
  const logBytes = await assertBytes(root, STAGE5_FINAL11_CI_LOG, STAGE5_FINAL11_CI_LOG_SHA256);
  const executionBytes = await assertBytes(
    root,
    STAGE5_FINAL11_CI_EXECUTION,
    STAGE5_FINAL11_CI_EXECUTION_SHA256,
  );
  const indexBytes = await assertBytes(
    root,
    STAGE5_FINAL11_CI_FAILED_EVIDENCE_INDEX,
    STAGE5_FINAL11_CI_FAILED_INDEX_SHA256,
  );
  const guardBytes = await assertBytes(
    root,
    STAGE5_FINAL11_INVOCATION_GUARD_PATH,
    STAGE5_FINAL11_INVOCATION_GUARD_SHA256,
  );
  const rejectionBytes = await readFile(path.join(root, STAGE5_FINAL11_REJECTION_RECORD));
  assert.equal(sha256(rejectionBytes), STAGE5_FINAL11_REJECTION_RECORD_SHA256);
  let oldBaseline;
  const preservedBaselinePath = `${STAGE5_FINAL12_EVIDENCE_DIRECTORY}/final11-security-extension-baseline.json`;
  try {
    await lstat(path.join(root, preservedBaselinePath));
    oldBaseline = await assertBytes(
      root,
      preservedBaselinePath,
      STAGE5_FINAL11_SECURITY_BASELINE_SHA256,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    oldBaseline = await assertBytes(
      root,
      "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json",
      STAGE5_FINAL11_SECURITY_BASELINE_SHA256,
    );
  }
  const guard = JSON.parse(guardBytes.toString("utf8"));
  const execution = JSON.parse(executionBytes.toString("utf8"));
  const index = JSON.parse(indexBytes.toString("utf8"));
  const rejection = rejectionBytes.toString("utf8");
  assert.equal(guard.candidate, "FINAL-11");
  assert.equal(guard.invocationCount, 1);
  assert.equal(guard.result, "FAIL");
  assert.equal(guard.exitCode, 1);
  assert.equal(guard.command, "corepack pnpm ci:verify");
  assert.equal(guard.nodeVersion, "v24.19.0");
  assert.equal(guard.corepackVersion, "0.35.0");
  assert.equal(guard.pnpmVersion, "11.21.0");
  assert.equal(guard.logSha256, STAGE5_FINAL11_CI_LOG_SHA256);
  assert.equal(execution.candidate, "FINAL-11");
  assert.equal(execution.invocationCount, 1);
  assert.equal(execution.result, "FAIL");
  assert.equal(execution.exitCode, 1);
  assert.equal(execution.command, "corepack pnpm ci:verify");
  assert.equal(execution.logSha256, sha256(logBytes));
  assert.equal(index.candidate, "FINAL-11");
  assert.equal(index.phase, "CI_FAILED");
  assert.equal(index.artifactCount, 28);
  assert.equal(rejection.includes("REJECTED / CI CONSUMED / FORMAT-GATE FAILURE"), true);
  assert.equal(rejection.includes("candidate-generation/preflight defect"), true);
  assert.equal(rejection.includes(STAGE5_FINAL11_CI_LOG_SHA256), true);
  assert.equal(sha256(oldBaseline), STAGE5_FINAL11_SECURITY_BASELINE_SHA256);

  const matrixBytes = await readFile(path.join(root, STAGE5_FINAL11_CORRECTION_MATRIX));
  assert.equal(sha256(matrixBytes), STAGE5_FINAL11_CORRECTION_MATRIX_SHA256);
  const predecessorMatrix = JSON.parse(matrixBytes.toString("utf8"));
  assert.equal(predecessorMatrix.candidate, "FINAL-11");
  assert.equal(predecessorMatrix.summary.totalFindingCount, 48);
  assert.equal(predecessorMatrix.summary.authorClosedCount, 0);
  assert.equal(predecessorMatrix.summary.independentPendingCount, 48);
  assert.equal(predecessorMatrix.findings.length, 48);
  assert.equal(predecessorMatrix.stage6Actions, 0);
  assert.equal(
    predecessorMatrix.findings.every(
      (finding) =>
        finding.final11Disposition === "PENDING_REMEDIATION_REQUALIFICATION" &&
        finding.final11IndependentStatus === "PENDING_FINAL11_REVIEW",
    ),
    true,
  );
  return {
    schemaVersion: 1,
    result: "PASS",
    candidate: "FINAL-11",
    status: "REJECTED",
    failedGate: "format:check",
    invocationCount: 1,
    command: execution.command,
    exitCode: 1,
    ciLog: { path: STAGE5_FINAL11_CI_LOG, bytes: logBytes.length, sha256: sha256(logBytes) },
    ciExecution: {
      path: STAGE5_FINAL11_CI_EXECUTION,
      bytes: executionBytes.length,
      sha256: sha256(executionBytes),
    },
    evidenceIndex: {
      path: STAGE5_FINAL11_CI_FAILED_EVIDENCE_INDEX,
      bytes: indexBytes.length,
      sha256: sha256(indexBytes),
      artifactCount: index.artifactCount,
      phase: index.phase,
    },
    invocationGuard: {
      path: STAGE5_FINAL11_INVOCATION_GUARD_PATH,
      bytes: guardBytes.length,
      sha256: sha256(guardBytes),
    },
    rejectionRecord: {
      path: STAGE5_FINAL11_REJECTION_RECORD,
      bytes: rejectionBytes.length,
      sha256: sha256(rejectionBytes),
    },
    priorSecurityBaseline: {
      bytes: oldBaseline.length,
      sha256: sha256(oldBaseline),
    },
    preFormatSnapshotSha256: STAGE5_FINAL11_PRE_FORMAT_SNAPSHOT_SHA256,
    predecessorFindingCount: predecessorMatrix.findings.length,
    predecessorAuthorClosedCount: predecessorMatrix.summary.authorClosedCount,
    predecessorIndependentPendingCount: predecessorMatrix.summary.independentPendingCount,
    stage6Actions: 0,
  };
};

export const buildStage5Final12CorrectionMatrix = (lineage, predecessorMatrix) => {
  assert.equal(lineage.result, "PASS");
  assert.equal(lineage.candidate, "FINAL-11");
  assert.equal(lineage.status, "REJECTED");
  assert.equal(lineage.invocationCount, 1);
  assert.equal(lineage.stage6Actions, 0);
  assert.equal(predecessorMatrix.findings.length, 48);
  return {
    schemaVersion: 1,
    result: "PASS",
    stage: "PHASE_1_M1_STAGE_5",
    candidate: "FINAL-12",
    predecessor: {
      candidate: "FINAL-11",
      status: "REJECTED / CI CONSUMED / FORMAT-GATE FAILURE",
      failedGate: "format:check",
      ciInvocationCount: 1,
      ciExitCode: 1,
      ciLogSha256: lineage.ciLog.sha256,
      ciExecutionSha256: lineage.ciExecution.sha256,
      ciFailedEvidenceIndexSha256: lineage.evidenceIndex.sha256,
      invocationGuardSha256: lineage.invocationGuard.sha256,
      rejectionRecordSha256: lineage.rejectionRecord.sha256,
      previousSecurityBaselineSha256: lineage.priorSecurityBaseline.sha256,
      preFormatSnapshotSha256: lineage.preFormatSnapshotSha256,
    },
    stage6Actions: 0,
    statusPolicy: {
      authorMayCloseFindings: false,
      final12IndependentReviewRequired: true,
      authorDisposition: "PENDING_REMEDIATION_REQUALIFICATION",
      independentDisposition: "PENDING_FINAL12_REVIEW",
      priorGenerationFailureAdjudication: "PENDING_FINAL12_REVIEW",
    },
    summary: {
      carriedFindingCount: predecessorMatrix.findings.length,
      totalFindingCount: predecessorMatrix.findings.length,
      authorClosedCount: 0,
      independentPendingCount: predecessorMatrix.findings.length,
      priorGenerationFailureCount: 2,
      priorGenerationFailurePendingReviewCount: 2,
    },
    findings: predecessorMatrix.findings,
  };
};

export const writeStage5Final12CorrectionMatrix = async ({ root = repositoryRoot } = {}) => {
  const lineage = await verifyStage5Final12FindingLineage({ root });
  const oldMatrix = JSON.parse(
    (await readFile(path.join(root, STAGE5_FINAL11_CORRECTION_MATRIX))).toString("utf8"),
  );
  const matrix = buildStage5Final12CorrectionMatrix(lineage, oldMatrix);
  const bytes = Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`);
  const matrixPath = path.join(root, STAGE5_FINAL12_CORRECTION_MATRIX);
  try {
    const existing = await readFile(matrixPath);
    assert.deepEqual(
      existing,
      bytes,
      "existing FINAL-12 correction matrix differs from its deterministic lineage",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(matrixPath, bytes, { flag: "wx" });
  }
  return {
    result: "PASS",
    candidate: "FINAL-12",
    bytes: bytes.length,
    sha256: sha256(bytes),
    stage6Actions: 0,
  };
};

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  const report = process.argv.includes("--write")
    ? await writeStage5Final12CorrectionMatrix()
    : await verifyStage5Final12FindingLineage();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
