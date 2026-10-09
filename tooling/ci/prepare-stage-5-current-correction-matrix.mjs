import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { assertStage5CandidateManifest } from "./stage-5-candidate-coherence.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `${file} must be a regular non-symlink file`,
  );
  return readFile(file);
};
const writeExclusiveOrMatch = async (file, bytes) => {
  try {
    assert.deepEqual(await readRegular(file), bytes, `Refusing divergent evidence reuse: ${file}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(file, bytes, { flag: "wx" });
  }
};

export const verifyStage5CurrentPredecessorEvidence = async (
  predecessorCandidate,
  { candidateRoot = root } = {},
) => {
  assert.equal(typeof predecessorCandidate, "string");
  const workspace = path.resolve(candidateRoot);
  const manifest = assertStage5CandidateManifest(
    JSON.parse(
      await readFile(path.join(workspace, "tooling/ci/stage-5-current-candidate.json"), "utf8"),
    ),
  );
  assert.equal(predecessorCandidate, manifest.predecessor);
  const historical = manifest.historicalInputs;
  const receiptPath = historical.predecessorFailureReceipt;
  const receiptBytes = await readRegular(path.join(workspace, receiptPath));
  assert.equal(hash(receiptBytes), historical.predecessorFailureReceiptSha256);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  assert.equal(receipt.candidate, predecessorCandidate);
  assert.equal(receipt.result, "FAIL");
  assert.equal(receipt.phase, "POST_FREEZE_PROVENANCE");
  assert.equal(
    receipt.failedAssertion,
    "verifyStage5CurrentCandidateFreeze:108 assert.equal(scope.files.includes(scan), requireScan): false !== true",
  );
  assert.equal(receipt.exitCode, 1);
  assert.equal(receipt.ciConsumed, "YES");
  assert.equal(receipt.ciInvocationCount, 1);
  assert.equal(receipt.ciResult, "PASS");
  assert.equal(receipt.disposition, "FROZEN_REJECTED_POST_FREEZE_PROVENANCE");
  assert.equal(receipt.independentReview, "NOT_ELIGIBLE");
  assert.equal(receipt.stageClosure, "NOT_CLOSED");
  assert.equal(receipt.freezeReadbackMismatches, 0);
  assert.equal(receipt.stage6Actions, 0);
  const rejectionPath = historical.predecessorRejectionRecord;
  const rejectionBytes = await readRegular(path.join(workspace, rejectionPath));
  assert.equal(hash(rejectionBytes), historical.predecessorRejectionRecordSha256);
  assert(rejectionBytes.toString("utf8").includes("post-freeze rejection"));
  const baselinePath = historical.predecessorBaselinePath;
  const baselineBytes = await readRegular(path.join(workspace, baselinePath));
  assert.equal(hash(baselineBytes), historical.predecessorBaselineSha256);
  assert.equal(receipt.baselineSha256, hash(baselineBytes));
  const baselineGenerationPath = `${historical.predecessorEvidenceDirectory}/security-extension-baseline-generation.json`;
  const baselineGenerationBytes = await readRegular(path.join(workspace, baselineGenerationPath));
  assert.equal(hash(baselineGenerationBytes), historical.predecessorBaselineGenerationSha256);

  const baselineGeneration = JSON.parse(baselineGenerationBytes.toString("utf8"));
  assert.equal(baselineGeneration.candidate, predecessorCandidate);
  assert.equal(baselineGeneration.result, "PASS");
  assert.equal(baselineGeneration.baselineSha256, hash(baselineBytes));
  const predecessorBaseline = JSON.parse(baselineBytes.toString("utf8"));
  const predecessorGenerationKey = `${predecessorCandidate.toLowerCase().replaceAll("-", "")}Generation`;
  assert.equal(
    predecessorBaseline.lineage?.[predecessorGenerationKey]?.candidate,
    predecessorCandidate,
  );
  const predecessorMatrixBytes = await readRegular(
    path.join(workspace, historical.predecessorCorrectionMatrix),
  );
  assert.equal(hash(predecessorMatrixBytes), historical.predecessorCorrectionMatrixSha256);
  const predecessorMatrix = JSON.parse(predecessorMatrixBytes.toString("utf8"));
  assert.equal(predecessorMatrix.candidate, predecessorCandidate);
  assert.equal(predecessorMatrix.findings.length, 49);
  assert.equal(predecessorMatrix.summary?.authorClosedCount, 0);
  assert.equal(predecessorMatrix.summary?.independentPendingCount, 49);
  const pinned = async (filePath, sha256) => {
    const bytes = await readRegular(path.join(workspace, filePath));
    assert.equal(hash(bytes), sha256, `Immutable predecessor input changed: ${filePath}`);
    return JSON.parse(bytes.toString("utf8"));
  };
  const ci = await pinned(historical.predecessorCiReceipt, historical.predecessorCiReceiptSha256);
  assert.equal(ci.candidate, predecessorCandidate);
  assert.equal(ci.result, "PASS");
  assert.equal(ci.exitCode, 0);
  assert.equal(ci.invocationCount, 1);
  assert.equal(ci.ciConsumed, "YES");
  assert.equal(ci.completionMarker?.result, "PASS");
  assert.deepEqual(ci.completionMarker.completed, ci.expectedGateLabels);
  assert.equal(receipt.ciReceiptSha256, historical.predecessorCiReceiptSha256);
  const index = await pinned(
    historical.predecessorEvidenceIndex,
    historical.predecessorEvidenceIndexSha256,
  );
  assert.equal(index.candidate, predecessorCandidate);
  assert.equal(index.phase, "FINAL");
  assert.equal(index.ciVerify?.result, "PASS");
  assert.equal(index.ciVerify?.invocationCount, 1);
  assert.equal(receipt.finalEvidenceIndexSha256, historical.predecessorEvidenceIndexSha256);
  const validationBytes = await readRegular(path.join(workspace, historical.predecessorValidation));
  assert.equal(hash(validationBytes), historical.predecessorValidationSha256);
  assert.equal(receipt.validationSha256, historical.predecessorValidationSha256);
  const freeze = await pinned(historical.predecessorFreeze, historical.predecessorFreezeSha256);
  assert.equal(freeze.candidate, predecessorCandidate);
  assert.equal(freeze.collectionPhase, "FINAL_EVIDENCE");
  assert.equal(freeze.entryCount, freeze.entries?.length);
  assert.equal(freeze.postFreezeScanReport?.path, historical.predecessorFinalScan);
  assert.equal(receipt.freezeSha256, historical.predecessorFreezeSha256);
  assert.equal(receipt.freezeEntries, freeze.entryCount);
  const scan = await pinned(historical.predecessorFinalScan, historical.predecessorFinalScanSha256);
  assert.equal(scan.candidate, predecessorCandidate);
  assert.equal(scan.phase, "FINAL_CANDIDATE");
  assert.equal(scan.result, "PASS");
  assert.equal(scan.findingCount, 0);
  assert.equal(scan.sourceCount, scan.files.length);
  for (const [filePath, sha256] of [
    [historical.predecessorEvidenceIndex, historical.predecessorEvidenceIndexSha256],
    [historical.predecessorValidation, historical.predecessorValidationSha256],
    [historical.predecessorFreeze, historical.predecessorFreezeSha256],
  ])
    assert.equal(scan.files.find((file) => file.path === filePath)?.sha256, sha256);
  assert.equal(receipt.finalCandidateScanSha256, historical.predecessorFinalScanSha256);
  assert.equal(receipt.finalCandidateScanResult, "PASS");
  const archive = await pinned(
    historical.predecessorArchiveManifest,
    historical.predecessorArchiveManifestSha256,
  );
  assert.equal(archive.candidate, predecessorCandidate);
  assert.equal(archive.freezeSha256, historical.predecessorFreezeSha256);
  assert.equal(archive.declaredRows, freeze.entryCount);
  assert.equal(archive.matchedArchiveMembers, freeze.entryCount);
  assert.equal(archive.missing, 0);
  assert.equal(archive.mismatched, 0);
  assert.equal(archive.extra, 0);
  const archivedBytes = await readRegular(path.join(workspace, archive.archivePath));
  assert.equal(archivedBytes.length, archive.archiveBytes);
  assert.equal(hash(archivedBytes), archive.archiveSha256);
  return {
    receiptPath,
    receiptBytes,
    receiptSha256: hash(receiptBytes),
    rejectionPath,
    rejectionBytes,
    rejectionSha256: hash(rejectionBytes),
    baselineGenerationPath,
    baselineGenerationBytes,
    baselineGenerationSha256: hash(baselineGenerationBytes),
    baselineBytes,
    baselineSha256: hash(baselineBytes),
    baselinePath,
    matrixPath: historical.predecessorCorrectionMatrix,
    matrixBytes: predecessorMatrixBytes,
    matrixSha256: hash(predecessorMatrixBytes),
    matrix: predecessorMatrix,
    receipt,
    ci,
    index,
    freeze,
    scan,
    archive,
  };
};

export const prepareStage5CurrentCorrectionMatrix = async ({
  candidateRoot = root,
  write = false,
} = {}) => {
  const workspace = path.resolve(candidateRoot);
  const manifest = assertStage5CandidateManifest(
    JSON.parse(
      await readFile(path.join(workspace, "tooling/ci/stage-5-current-candidate.json"), "utf8"),
    ),
  );
  const predecessor = await verifyStage5CurrentPredecessorEvidence(manifest.predecessor, {
    candidateRoot: workspace,
  });

  const matrix = JSON.parse(JSON.stringify(predecessor.matrix));
  matrix.candidate = manifest.candidate;
  matrix.result = "PENDING_EXECUTION";
  matrix.predecessor = {
    candidate: manifest.predecessor,
    disposition: predecessor.receipt.disposition,
    rootCause: predecessor.receipt.diagnostic,
    baselinePath: predecessor.baselinePath,
    baselineSha256: predecessor.baselineSha256,
    baselineGenerationPath: predecessor.baselineGenerationPath,
    baselineGenerationSha256: predecessor.baselineGenerationSha256,
    correctionMatrixPath: predecessor.matrixPath,
    correctionMatrixSha256: predecessor.matrixSha256,
    failureReceiptPath: predecessor.receiptPath,
    failureReceiptSha256: predecessor.receiptSha256,
    rejectionRecordPath: predecessor.rejectionPath,
    rejectionRecordSha256: predecessor.rejectionSha256,
    evidenceIndexPath: manifest.historicalInputs.predecessorEvidenceIndex,
    evidenceIndexSha256: manifest.historicalInputs.predecessorEvidenceIndexSha256,
    validationSha256: manifest.historicalInputs.predecessorValidationSha256,
    freezeSha256: manifest.historicalInputs.predecessorFreezeSha256,
    finalCandidateScanSha256: manifest.historicalInputs.predecessorFinalScanSha256,
    archiveManifestSha256: manifest.historicalInputs.predecessorArchiveManifestSha256,
    ciReceiptSha256: manifest.historicalInputs.predecessorCiReceiptSha256,
    ciVerifyInvoked: true,
    ciVerifyInvocationCount: 1,
    ciVerifyResult: "PASS",
    ciAuthorizationConsumed: true,
    ciAuthorizationTransferred: false,
    stage6Actions: 0,
  };
  matrix.findings = matrix.findings.map((finding) => ({
    ...finding,
    [`${manifest.candidate.toLowerCase().replaceAll("-", "")}Status`]: `PENDING_${manifest.candidate.replaceAll("-", "")}_INDEPENDENT_ADJUDICATION`,
  }));
  matrix.candidateToolingCorrection = {
    id: "STAGE5-CANDIDATE-COHERENCE-001",
    status: "IMPLEMENTED_PENDING_READINESS_QUALIFICATION",
    regressionPath: "tooling/ci/test-stage-5-candidate-coherence.mjs",
    requiredBehavior:
      "Resolve active candidate tooling from one manifest; reject predecessor references and script/path drift before ci:verify; preserve explicit immutable historical inputs.",
  };
  matrix.summary = {
    ...matrix.summary,
    totalFindingCount: matrix.findings.length,
    authorClosedCount: 0,
    independentPendingCount: matrix.findings.length,
  };
  matrix.stage6Actions = 0;
  const matrixBytes = Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`);
  if (write) {
    const evidenceDirectory = path.join(workspace, manifest.evidenceDirectory);
    await mkdir(evidenceDirectory, { recursive: true });
    const predecessorSlug = manifest.predecessor.toLowerCase().replaceAll("-", "");
    const archiveRows = [
      [`${predecessorSlug}-readiness-failure.json`, predecessor.receiptBytes],
      [`${predecessorSlug}-rejection-record.md`, predecessor.rejectionBytes],
      [`${predecessorSlug}-baseline-generation.json`, predecessor.baselineGenerationBytes],
      [`${predecessorSlug}-security-extension-baseline.json`, predecessor.baselineBytes],
      [`${predecessorSlug}-correction-matrix.json`, predecessor.matrixBytes],
    ];
    for (const [name, bytes] of archiveRows)
      await writeExclusiveOrMatch(path.join(evidenceDirectory, name), bytes);
    await writeExclusiveOrMatch(path.join(workspace, manifest.correctionMatrix), matrixBytes);
    await writeExclusiveOrMatch(
      path.join(evidenceDirectory, "current-correction-matrix.json"),
      matrixBytes,
    );
  }
  return {
    result: "PASS",
    candidate: manifest.candidate,
    predecessor: manifest.predecessor,
    carriedFindings: matrix.findings.length,
    authorClosed: matrix.summary.authorClosedCount,
    independentPending: matrix.summary.independentPendingCount,
    predecessorFailureReceiptSha256: predecessor.receiptSha256,
    predecessorRejectionRecordSha256: predecessor.rejectionSha256,
    predecessorBaselineGenerationSha256: predecessor.baselineGenerationSha256,
    predecessorBaselineSha256: predecessor.baselineSha256,
    predecessorCiInvocationCount: predecessor.ci.invocationCount,
    correctionMatrixSha256: hash(matrixBytes),
    stage6Actions: 0,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareStage5CurrentCorrectionMatrix({
    write: process.argv.includes("--write"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
