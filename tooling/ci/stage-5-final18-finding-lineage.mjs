import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

import {
  STAGE5_FINAL17_EVIDENCE_DIRECTORY,
  STAGE5_FINAL17_CORRECTION_MATRIX,
  STAGE5_FINAL18_CORRECTION_MATRIX,
  STAGE5_FINAL18_EVIDENCE_DIRECTORY,
  STAGE5_FINAL18_PREBASELINE_FINDING_LINEAGE_SHA256,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final17EvidenceIndex } from "./stage-5-final17-evidence-index.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readRegularFile = async (filePath) => {
  const metadata = await lstat(filePath);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `${filePath} must be a regular file`);
  return readFile(filePath);
};

export const verifyStage5Final18FindingLineage = async ({
  root: candidateRoot = root,
  write = false,
  supersedePrebaselineAttempt = false,
} = {}) => {
  const candidate = path.resolve(candidateRoot);
  const predecessorIndex = await verifyStage5Final17EvidenceIndex({
    root: candidate,
    allowedPhases: ["FINAL"],
    requiredPhase: "FINAL",
  });
  assert.equal(predecessorIndex.result, "PASS");
  assert.equal(predecessorIndex.candidate, "FINAL-17");
  assert.equal(predecessorIndex.stage6Actions, 0);

  const predecessorCiLogBytes = await readRegularFile(
    path.join(candidate, STAGE5_FINAL17_EVIDENCE_DIRECTORY, "ci-verify.log"),
  );
  const predecessorCiExecutionBytes = await readRegularFile(
    path.join(candidate, STAGE5_FINAL17_EVIDENCE_DIRECTORY, "ci-verify-execution.json"),
  );
  const predecessorCiExecution = JSON.parse(predecessorCiExecutionBytes.toString("utf8"));
  assert.equal(predecessorCiExecution.candidate, "FINAL-17");
  assert.equal(predecessorCiExecution.phase, "FINAL");
  assert.equal(predecessorCiExecution.invocationCount, 1);
  assert.equal(predecessorCiExecution.result, "PASS");
  assert.equal(predecessorCiExecution.exitCode, 0);
  assert.equal(predecessorCiExecution.command, "corepack pnpm ci:verify");
  assert.equal(predecessorCiExecution.gitCommit, "27184b598ae2be2eaf35616d4a9b6c2e623ccd42");
  const scopeFailureReceiptBytes = await readRegularFile(
    path.join(candidate, ".hermes/state/stage5-final17-final-candidate-scope-failure.json"),
  );
  const scopeFailureReceipt = JSON.parse(scopeFailureReceiptBytes.toString("utf8"));
  assert.equal(scopeFailureReceipt.candidate, "FINAL-17");
  assert.equal(scopeFailureReceipt.event, "REJECTED_BEFORE_DETERMINISTIC_FREEZE");
  assert.equal(scopeFailureReceipt.ci.authorizationConsumed, true);
  assert.equal(scopeFailureReceipt.ci.retryForbidden, true);
  assert.equal(scopeFailureReceipt.failedGate.result, "FAIL");
  assert.equal(scopeFailureReceipt.stage6Actions, 0);

  const matrixBytes = await readRegularFile(path.join(candidate, STAGE5_FINAL18_CORRECTION_MATRIX));
  const matrix = JSON.parse(matrixBytes.toString("utf8"));
  const findings = matrix.findings;
  const predecessorMatrixBytes = await readRegularFile(
    path.join(candidate, STAGE5_FINAL17_CORRECTION_MATRIX),
  );
  const predecessorMatrix = JSON.parse(predecessorMatrixBytes.toString("utf8"));
  assert.equal(predecessorMatrix.candidate, "FINAL-17");
  const expectedIds = predecessorMatrix.findings.map((finding) => finding.id).toSorted();
  const actualIds = findings.map((finding) => finding.id).toSorted();
  assert.equal(matrix.schemaVersion, 1);
  assert.equal(matrix.candidate, "FINAL-18");
  assert.equal(matrix.result, "PENDING_INDEPENDENT_REVIEW");
  assert.deepEqual(
    actualIds,
    expectedIds,
    "FINAL-18 must carry every FINAL-17 finding exactly once",
  );
  assert.equal(new Set(actualIds).size, expectedIds.length, "finding IDs must be unique");
  assert.equal(matrix.summary.totalFindingCount, expectedIds.length);
  assert.equal(matrix.summary.authorClosedCount, 0);
  assert.equal(matrix.summary.independentPendingCount, expectedIds.length);
  assert.equal(matrix.predecessorCandidateDisposition.candidate, "FINAL-17");
  assert.equal(
    matrix.predecessorCandidateDisposition.evidenceIndexSha256,
    predecessorIndex.indexSha256,
  );
  assert.equal(matrix.predecessorCandidateDisposition.ciInvocationCount, 1);
  assert.equal(matrix.predecessorCandidateDisposition.ciResult, "PASS");
  assert.equal(matrix.predecessorCandidateDisposition.ciAuthorizationConsumed, true);
  assert.equal(matrix.predecessorCandidateDisposition.ciAuthorizationTransferred, false);
  assert.equal(
    matrix.predecessorCandidateDisposition.candidateFreezeStatus,
    "PROVISIONAL PLACEHOLDER ONLY; NO VALID FREEZE CREATED",
  );
  assert.equal(matrix.stage6Actions, 0);
  for (const finding of findings) {
    assert.equal(finding.authorClosed, false, `author closure is forbidden: ${finding.id}`);
    assert.equal(
      finding.final18Status,
      "PENDING_FINAL18_INDEPENDENT_ADJUDICATION",
      `finding is not pending independent adjudication: ${finding.id}`,
    );
    assert.equal(finding.requiresIndependentReview, true);
  }

  const lineage = {
    schemaVersion: 1,
    result: "PASS",
    candidate: "FINAL-18",
    predecessor: {
      candidate: "FINAL-17",
      disposition: matrix.predecessorCandidateDisposition.disposition,
      evidenceIndexSha256: predecessorIndex.indexSha256,
      evidenceAggregateSha256: predecessorIndex.aggregateSha256,
      ciLogSha256: hash(predecessorCiLogBytes),
      ciExecutionSha256: hash(predecessorCiExecutionBytes),
      scopeFailureReceiptSha256: hash(scopeFailureReceiptBytes),
      ciInvocationCount: matrix.predecessorCandidateDisposition.ciInvocationCount,
      ciResult: matrix.predecessorCandidateDisposition.ciResult,
      ciAuthorizationConsumed: matrix.predecessorCandidateDisposition.ciAuthorizationConsumed,
      ciAuthorizationTransferred: matrix.predecessorCandidateDisposition.ciAuthorizationTransferred,
      candidateFreezeStatus: matrix.predecessorCandidateDisposition.candidateFreezeStatus,
    },
    correctionMatrix: {
      path: STAGE5_FINAL18_CORRECTION_MATRIX,
      bytes: matrixBytes.length,
      sha256: hash(matrixBytes),
    },
    findings: {
      total: findings.length,
      authorClosed: 0,
      pendingIndependent: findings.length,
      ids: actualIds,
    },
    stage6Actions: 0,
  };
  const outputPath = path.join(
    candidate,
    STAGE5_FINAL18_EVIDENCE_DIRECTORY,
    "finding-lineage.json",
  );
  if (write) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    const bytes = Buffer.from(`${JSON.stringify(lineage, null, 2)}\n`);
    try {
      const previousBytes = await readRegularFile(outputPath);
      if (!previousBytes.equals(bytes)) {
        assert.equal(supersedePrebaselineAttempt, true, "refusing divergent lineage receipt");
        assert.equal(
          hash(previousBytes),
          STAGE5_FINAL18_PREBASELINE_FINDING_LINEAGE_SHA256,
          "unexpected prior lineage receipt; refusing unreviewed replacement",
        );
        const archivePath = path.join(
          candidate,
          STAGE5_FINAL18_EVIDENCE_DIRECTORY,
          "finding-lineage-prebaseline-attempt-01.json",
        );
        try {
          assert.deepEqual(await readRegularFile(archivePath), previousBytes);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          await writeFile(archivePath, previousBytes, { flag: "wx" });
        }
        await writeFile(outputPath, bytes);
      }
      assert.deepEqual(await readRegularFile(outputPath), bytes);
    } catch (error) {
      if (error.code === "ENOENT") await writeFile(outputPath, bytes, { flag: "wx" });
      else throw error;
    }
  }
  return {
    ...lineage,
    evidencePath: `${STAGE5_FINAL18_EVIDENCE_DIRECTORY}/finding-lineage.json`,
    evidenceSha256: write ? hash(await readRegularFile(outputPath)) : null,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyStage5Final18FindingLineage({
    write: process.argv.includes("--write"),
    supersedePrebaselineAttempt: process.argv.includes("--supersede-prebaseline-attempt"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
