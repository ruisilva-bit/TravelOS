import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_FINAL11_CORRECTION_MATRIX,
  STAGE5_FINAL12_CI_EXECUTION_SHA256,
  STAGE5_FINAL12_CI_FAILED_INDEX_SHA256,
  STAGE5_FINAL12_CI_LOG_SHA256,
  STAGE5_FINAL12_CORRECTION_MATRIX,
  STAGE5_FINAL12_CORRECTION_MATRIX_SHA256,
  STAGE5_FINAL12_EVIDENCE_DIRECTORY,
  STAGE5_FINAL12_INVOCATION_GUARD_SHA256,
  STAGE5_FINAL12_REJECTION_MATRIX,
  STAGE5_FINAL12_REJECTION_MATRIX_SHA256,
  STAGE5_FINAL12_REJECTION_RECORD,
  STAGE5_FINAL12_REJECTION_RECORD_SHA256,
  STAGE5_FINAL12_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL13_CORRECTION_MATRIX,
  STAGE5_FINAL13_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final12EvidenceIndex } from "./stage-5-final12-evidence-index.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assertBytes = async (root, relativePath, expected) => {
  const p = path.join(root, relativePath);
  const stat = await lstat(p);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${relativePath} must be a regular file`);
  const bytes = await readFile(p);
  assert.equal(sha256(bytes), expected, `${relativePath} historical bytes changed`);
  return bytes;
};

export const verifyStage5Final13FindingLineage = async ({ root = repositoryRoot } = {}) => {
  const evidenceDir = STAGE5_FINAL12_EVIDENCE_DIRECTORY;
  const logPath = `${evidenceDir}/ci-verify.log`;
  const executionPath = `${evidenceDir}/ci-verify-execution.json`;
  const indexPath = `${evidenceDir}/EVIDENCE_INDEX.json`;
  const guardPath = ".hermes/state/stage5-final12-ci-verify-invocation.json";
  const log = await assertBytes(root, logPath, STAGE5_FINAL12_CI_LOG_SHA256);
  const executionBytes = await assertBytes(root, executionPath, STAGE5_FINAL12_CI_EXECUTION_SHA256);
  const guardBytes = await assertBytes(root, guardPath, STAGE5_FINAL12_INVOCATION_GUARD_SHA256);
  const indexCheck = await verifyStage5Final12EvidenceIndex({ root, requiredPhase: "CI_FAILED" });
  assert.equal(indexCheck.indexSha256, STAGE5_FINAL12_CI_FAILED_INDEX_SHA256);
  const record = await assertBytes(
    root,
    STAGE5_FINAL12_REJECTION_RECORD,
    STAGE5_FINAL12_REJECTION_RECORD_SHA256,
  );
  const rejectionMatrixBytes = await assertBytes(
    root,
    STAGE5_FINAL12_REJECTION_MATRIX,
    STAGE5_FINAL12_REJECTION_MATRIX_SHA256,
  );
  const correctionMatrixBytes = await assertBytes(
    root,
    `${evidenceDir}/final12-correction-matrix.json`,
    STAGE5_FINAL12_CORRECTION_MATRIX_SHA256,
  );
  const predecessorMatrixBytes = await assertBytes(
    root,
    STAGE5_FINAL11_CORRECTION_MATRIX,
    "8a3faa17cb60d31765391db8135928632cd70de74a889428ae549125d0c0b175",
  );
  const baselineBytes = await assertBytes(
    root,
    `${STAGE5_FINAL13_EVIDENCE_DIRECTORY}/final12-security-extension-baseline.json`,
    STAGE5_FINAL12_SECURITY_BASELINE_SHA256,
  );
  const execution = JSON.parse(executionBytes.toString("utf8"));
  const guard = JSON.parse(guardBytes.toString("utf8"));
  const rejection = JSON.parse(rejectionMatrixBytes.toString("utf8"));
  const matrix = JSON.parse(correctionMatrixBytes.toString("utf8"));
  const predecessorMatrix = JSON.parse(predecessorMatrixBytes.toString("utf8"));
  assert.equal(execution.candidate, "FINAL-12");
  assert.equal(execution.invocationCount, 1);
  assert.equal(execution.result, "FAIL");
  assert.equal(execution.exitCode, 1);
  assert.equal(execution.command, "corepack pnpm ci:verify");
  assert.equal(execution.logSha256, sha256(log));
  assert.equal(guard.candidate, "FINAL-12");
  assert.equal(guard.invocationCount, 1);
  assert.equal(guard.result, "FAIL");
  assert.equal(guard.exitCode, 1);
  assert.equal(guard.command, execution.command);
  assert.deepEqual(guard.toolchain, {
    node: "v24.19.0",
    corepack: "0.35.0",
    pnpm: "11.21.0",
    nodeExecutable: guard.toolchain.nodeExecutable,
  });
  assert.equal(rejection.failedGate, "lint");
  assert.equal(rejection.lintSummary.totalErrors, 30);
  assert.equal(rejection.stage6Actions, 0);
  assert.equal(matrix.candidate, "FINAL-12");
  assert.equal(matrix.stage6Actions, 0);
  assert.equal(matrix.summary.totalFindingCount, 48);
  assert.equal(predecessorMatrix.summary.totalFindingCount, 48);
  assert.equal(predecessorMatrix.stage6Actions, 0);
  assert.equal(baselineBytes.length > 0, true);
  return {
    schemaVersion: 1,
    result: "PASS",
    candidate: "FINAL-12",
    status: "REJECTED",
    failedGate: "lint",
    invocationCount: 1,
    command: execution.command,
    exitCode: execution.exitCode,
    ciLog: { path: logPath, bytes: log.length, sha256: sha256(log) },
    ciExecution: {
      path: executionPath,
      bytes: executionBytes.length,
      sha256: sha256(executionBytes),
    },
    evidenceIndex: {
      path: indexPath,
      bytes: indexCheck.indexBytes,
      sha256: indexCheck.indexSha256,
      artifactCount: indexCheck.artifactCount,
    },
    invocationGuard: { path: guardPath, bytes: guardBytes.length, sha256: sha256(guardBytes) },
    rejectionRecord: {
      path: STAGE5_FINAL12_REJECTION_RECORD,
      bytes: record.length,
      sha256: sha256(record),
    },
    rejectionMatrix: {
      path: STAGE5_FINAL12_REJECTION_MATRIX,
      bytes: rejectionMatrixBytes.length,
      sha256: sha256(rejectionMatrixBytes),
    },
    priorSecurityBaseline: { bytes: baselineBytes.length, sha256: sha256(baselineBytes) },
    predecessorFindingCount: matrix.findings.length,
    previousGenerationFailureCount: matrix.summary.priorGenerationFailureCount,
    stage6Actions: 0,
  };
};

export const buildStage5Final13CorrectionMatrix = (lineage, predecessorMatrix) => {
  assert.equal(lineage.result, "PASS");
  assert.equal(lineage.candidate, "FINAL-12");
  assert.equal(lineage.status, "REJECTED");
  assert.equal(lineage.failedGate, "lint");
  assert.equal(lineage.invocationCount, 1);
  assert.equal(lineage.stage6Actions, 0);
  assert.equal(predecessorMatrix.findings.length, 48);
  return {
    schemaVersion: 1,
    result: "PASS",
    stage: "PHASE_1_M1_STAGE_5",
    candidate: "FINAL-13",
    predecessor: {
      candidate: "FINAL-12",
      status: "REJECTED / CI CONSUMED / LINT-GATE FAILURE",
      failedGate: "lint",
      ciInvocationCount: 1,
      ciExitCode: 1,
      ciLogSha256: lineage.ciLog.sha256,
      ciExecutionSha256: lineage.ciExecution.sha256,
      ciFailedEvidenceIndexSha256: lineage.evidenceIndex.sha256,
      invocationGuardSha256: lineage.invocationGuard.sha256,
      rejectionRecordSha256: lineage.rejectionRecord.sha256,
      rejectionMatrixSha256: lineage.rejectionMatrix.sha256,
      previousSecurityBaselineSha256: lineage.priorSecurityBaseline.sha256,
    },
    stage6Actions: 0,
    statusPolicy: {
      authorMayCloseFindings: false,
      final13IndependentReviewRequired: true,
      authorDisposition: "PENDING_REMEDIATION_REQUALIFICATION",
      independentDisposition: "PENDING_FINAL13_REVIEW",
      priorGenerationFailureAdjudication: "PENDING_FINAL13_REVIEW",
    },
    summary: {
      carriedFindingCount: predecessorMatrix.findings.length,
      totalFindingCount: predecessorMatrix.findings.length,
      authorClosedCount: 0,
      independentPendingCount: predecessorMatrix.findings.length,
      priorGenerationFailureCount: 3,
      priorGenerationFailurePendingReviewCount: 3,
    },
    findings: predecessorMatrix.findings,
  };
};

export const writeStage5Final13CorrectionMatrix = async ({ root = repositoryRoot } = {}) => {
  const lineage = await verifyStage5Final13FindingLineage({ root });
  const predecessorMatrix = JSON.parse(
    (
      await readFile(path.join(root, STAGE5_FINAL12_CORRECTION_MATRIX)).catch(async () =>
        readFile(
          path.join(root, STAGE5_FINAL12_EVIDENCE_DIRECTORY, "final12-correction-matrix.json"),
        ),
      )
    ).toString("utf8"),
  );
  const matrix = buildStage5Final13CorrectionMatrix(lineage, predecessorMatrix);
  const bytes = Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`);
  const target = path.join(root, STAGE5_FINAL13_CORRECTION_MATRIX);
  try {
    const existing = await readFile(target);
    assert.deepEqual(existing, bytes, "FINAL-13 correction matrix must match verified lineage");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(target, bytes, { flag: "wx" });
  }
  return {
    result: "PASS",
    candidate: "FINAL-13",
    bytes: bytes.length,
    sha256: sha256(bytes),
    stage6Actions: 0,
  };
};

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const output = await writeStage5Final13CorrectionMatrix();
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
