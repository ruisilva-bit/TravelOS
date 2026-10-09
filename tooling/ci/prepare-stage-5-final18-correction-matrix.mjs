import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

import {
  STAGE5_FINAL17_CORRECTION_MATRIX,
  STAGE5_FINAL17_EVIDENCE_INDEX,
  STAGE5_FINAL18_CORRECTION_MATRIX,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final17EvidenceIndex } from "./stage-5-final17-evidence-index.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

const readRegularFile = async (filePath) => {
  const metadata = await lstat(filePath);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `${filePath} must be a regular file`);
  return readFile(filePath);
};

export const prepareStage5Final18CorrectionMatrix = async ({ root: candidateRoot = root } = {}) => {
  const candidate = path.resolve(candidateRoot);
  const historicalIndex = await verifyStage5Final17EvidenceIndex({
    root: candidate,
    allowedPhases: ["FINAL"],
    requiredPhase: "FINAL",
  });
  assert.equal(historicalIndex.result, "PASS");
  assert.equal(historicalIndex.candidate, "FINAL-17");
  assert.equal(historicalIndex.stage6Actions, 0);

  const sourceBytes = await readRegularFile(path.join(candidate, STAGE5_FINAL17_CORRECTION_MATRIX));
  const matrix = JSON.parse(sourceBytes.toString("utf8"));
  assert.equal(matrix.schemaVersion, 1);
  assert.equal(matrix.candidate, "FINAL-17");
  assert.equal(matrix.summary.totalFindingCount, 49);
  assert.equal(matrix.summary.authorClosedCount, 0);
  assert.equal(matrix.summary.independentPendingCount, 49);
  assert.equal(matrix.stage6Actions, 0);
  assert.equal(matrix.findings.length, 49);

  const failureBytes = await readRegularFile(
    path.join(candidate, ".hermes/state/stage5-final17-final-candidate-scope-failure.json"),
  );
  const failure = JSON.parse(failureBytes.toString("utf8"));
  assert.equal(failure.candidate, "FINAL-17");
  assert.equal(failure.event, "REJECTED_BEFORE_DETERMINISTIC_FREEZE");
  assert.equal(failure.ci.command, "corepack pnpm ci:verify");
  assert.equal(failure.ci.invocationCount, 1);
  assert.equal(failure.ci.result, "PASS");
  assert.equal(failure.ci.exitCode, 0);
  assert.equal(failure.ci.authorizationConsumed, true);
  assert.equal(failure.ci.retryForbidden, true);
  assert.equal(failure.failedGate.result, "FAIL");
  assert.equal(
    failure.preservedFinal17Artifacts.candidateFreezeStatus,
    "PROVISIONAL PLACEHOLDER ONLY; NO VALID FREEZE CREATED",
  );
  assert.equal(failure.stage6Actions, 0);

  matrix.candidate = "FINAL-18";
  matrix.result = "PENDING_INDEPENDENT_REVIEW";
  matrix.predecessorCandidateDisposition = {
    candidate: "FINAL-17",
    disposition: "REJECTED_AFTER_CI_PASS_BEFORE_FREEZE / SOURCE-SCOPE FAILURE",
    ciCommand: failure.ci.command,
    ciInvocationCount: failure.ci.invocationCount,
    ciResult: failure.ci.result,
    ciExitCode: failure.ci.exitCode,
    ciAuthorizationConsumed: failure.ci.authorizationConsumed,
    ciAuthorizationTransferred: false,
    ciRetryForbidden: failure.ci.retryForbidden,
    evidenceIndexPath: failure.preservedFinal17Artifacts.evidenceIndexPath,
    evidenceIndexSha256: failure.preservedFinal17Artifacts.evidenceIndexSha256,
    evidenceAggregateSha256: failure.preservedFinal17Artifacts.evidenceAggregateSha256,
    scopeFailureReceiptPath: ".hermes/state/stage5-final17-final-candidate-scope-failure.json",
    scopeFailureReceiptSha256: hash(failureBytes),
    candidateFreezeStatus: failure.preservedFinal17Artifacts.candidateFreezeStatus,
    stage6Actions: 0,
  };
  matrix.statusPolicy =
    "FINAL-17 remains rejected after its single CI PASS because FINAL_CANDIDATE source coverage failed before a valid freeze; its consumed authorization is not transferable. All 49 carried findings remain pending FINAL-18 independent adjudication. Author-side corrections and this matrix do not close findings; Stage 6 actions remain zero.";
  for (const finding of matrix.findings) {
    assert.equal(finding.authorClosed, false, `author closure is forbidden: ${finding.id}`);
    finding.final18Status = "PENDING_FINAL18_INDEPENDENT_ADJUDICATION";
    finding.currentEvidenceReferences = [
      ...new Set(finding.currentEvidenceReferences ?? []),
    ].toSorted();
  }
  matrix.successorToolingCorrection = {
    id: "FINAL14-PREDECESSOR-INDEX-PREFLIGHT-001",
    status: "PENDING_FINAL18_EXECUTION",
    priorSource: "docs/evidence/phase-1-m1/stage-5-final-14/",
    final17FailureReceipt: {
      path: ".hermes/state/stage5-final17-final-candidate-scope-failure.json",
      sha256: hash(failureBytes),
    },
    implementation: [
      "tooling/ci/stage-5-source-scope.mjs",
      "tooling/ci/test-stage-5-source-scope.mjs",
    ],
    verification: {
      historicalFinal17Index: {
        path: STAGE5_FINAL17_EVIDENCE_INDEX,
        sha256: historicalIndex.indexSha256,
        artifactCount: historicalIndex.artifactCount,
        result: "PASS",
      },
      currentFinal18SourceScopeQualification: "PENDING",
    },
    note: "FINAL-17 is preserved as rejected historical evidence. The source-scope correction remains pending FINAL-18 candidate qualification and independent review.",
  };
  matrix.summary.independentPendingCount = matrix.findings.length;
  matrix.summary.authorClosedCount = 0;
  matrix.stage6Actions = 0;

  const outputPath = path.join(candidate, STAGE5_FINAL18_CORRECTION_MATRIX);
  try {
    await lstat(outputPath);
    throw new Error(
      `Refusing to overwrite existing FINAL-18 matrix: ${STAGE5_FINAL18_CORRECTION_MATRIX}`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(outputPath, `${JSON.stringify(matrix, null, 2)}\n`, { flag: "wx" });
  const written = await readRegularFile(outputPath);
  const parsed = JSON.parse(written.toString("utf8"));
  assert.equal(parsed.candidate, "FINAL-18");
  assert.equal(parsed.findings.length, 49);
  assert(
    parsed.findings.every(
      (finding) => finding.final18Status === "PENDING_FINAL18_INDEPENDENT_ADJUDICATION",
    ),
  );
  assert(parsed.findings.every((finding) => finding.authorClosed === false));
  assert.equal(parsed.stage6Actions, 0);

  return {
    result: "PASS",
    candidate: "FINAL-18",
    predecessorCandidate: "FINAL-17",
    predecessorDisposition: matrix.predecessorCandidateDisposition.disposition,
    findings: parsed.findings.length,
    authorClosed: parsed.summary.authorClosedCount,
    independentPending: parsed.summary.independentPendingCount,
    matrixPath: STAGE5_FINAL18_CORRECTION_MATRIX,
    matrixBytes: written.length,
    matrixSha256: hash(written),
    final17EvidenceIndexSha256: historicalIndex.indexSha256,
    final17ScopeFailureReceiptSha256: hash(failureBytes),
    stage6Actions: 0,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareStage5Final18CorrectionMatrix();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
