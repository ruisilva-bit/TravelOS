import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { assertStage5CandidateManifest } from "./stage-5-candidate-coherence.mjs";
import { verifyStage5CurrentPredecessorEvidence } from "./prepare-stage-5-current-correction-matrix.mjs";

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
    assert.deepEqual(
      await readRegular(file),
      bytes,
      `Refusing divergent lineage evidence reuse: ${file}`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(file, bytes, { flag: "wx" });
  }
};

export const verifyStage5CurrentFindingLineage = async ({
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
  const matrixBytes = await readRegular(path.join(workspace, manifest.correctionMatrix));
  const matrix = JSON.parse(matrixBytes.toString("utf8"));
  assert.equal(matrix.candidate, manifest.candidate);
  assert.equal(matrix.result, "PENDING_EXECUTION");
  assert.equal(matrix.predecessor?.candidate, manifest.predecessor);
  assert.equal(matrix.predecessor?.disposition, predecessor.receipt.disposition);
  assert.equal(matrix.predecessor?.ciVerifyResult, "PASS");
  assert.equal(matrix.predecessor?.ciVerifyInvocationCount, 1);
  assert.equal(matrix.predecessor?.ciAuthorizationConsumed, true);
  assert.equal(matrix.predecessor?.ciAuthorizationTransferred, false);
  assert.equal(matrix.predecessor?.failureReceiptSha256, predecessor.receiptSha256);
  assert.equal(matrix.predecessor?.rejectionRecordSha256, predecessor.rejectionSha256);
  assert.equal(matrix.predecessor?.baselineGenerationSha256, predecessor.baselineGenerationSha256);
  assert.equal(matrix.predecessor?.baselineSha256, predecessor.baselineSha256);
  assert.equal(matrix.predecessor?.correctionMatrixSha256, predecessor.matrixSha256);
  for (const [field, pinned] of [
    ["ciReceiptSha256", manifest.historicalInputs.predecessorCiReceiptSha256],
    ["evidenceIndexSha256", manifest.historicalInputs.predecessorEvidenceIndexSha256],
    ["validationSha256", manifest.historicalInputs.predecessorValidationSha256],
    ["freezeSha256", manifest.historicalInputs.predecessorFreezeSha256],
    ["finalCandidateScanSha256", manifest.historicalInputs.predecessorFinalScanSha256],
    ["archiveManifestSha256", manifest.historicalInputs.predecessorArchiveManifestSha256],
  ])
    assert.equal(matrix.predecessor?.[field], pinned);

  const ids = matrix.findings.map(({ id }) => id);
  assert.equal(
    new Set(ids).size,
    ids.length,
    "Current correction matrix contains duplicate finding IDs",
  );
  assert.equal(ids.length, predecessor.matrix.findings.length);
  const statusKey = `${manifest.candidate.toLowerCase().replaceAll("-", "")}Status`;
  const currentStatuses = matrix.findings.map((finding) => finding[statusKey]);
  assert(
    currentStatuses.every(
      (status) =>
        status === `PENDING_${manifest.candidate.replaceAll("-", "")}_INDEPENDENT_ADJUDICATION`,
    ),
  );
  const carriedFindings = matrix.findings.map((finding) => {
    const { [statusKey]: _candidateStatus, ...carried } = finding;
    return carried;
  });
  assert.deepEqual(
    carriedFindings,
    predecessor.matrix.findings,
    "Carried finding content changed without independent adjudication",
  );
  assert.equal(matrix.summary?.totalFindingCount, ids.length);
  assert.equal(matrix.summary?.authorClosedCount, 0);
  assert.equal(matrix.summary?.independentPendingCount, ids.length);
  assert.equal(matrix.stage6Actions, 0);

  const bySeverity = Object.fromEntries(
    ["BLOCKER", "HIGH", "MEDIUM", "LOW"].map((severity) => [
      severity,
      matrix.findings.filter((finding) => finding.severity === severity).length,
    ]),
  );
  const report = {
    schemaVersion: 1,
    result: "PASS",
    candidate: manifest.candidate,
    predecessor: manifest.predecessor,
    correctionMatrix: {
      path: manifest.correctionMatrix,
      bytes: matrixBytes.length,
      sha256: hash(matrixBytes),
    },
    predecessorEvidence: {
      failureReceiptPath: predecessor.receiptPath,
      failureReceiptSha256: predecessor.receiptSha256,
      rejectionRecordPath: predecessor.rejectionPath,
      rejectionRecordSha256: predecessor.rejectionSha256,
      baselineGenerationPath: predecessor.baselineGenerationPath,
      baselineGenerationSha256: predecessor.baselineGenerationSha256,
      baselineSha256: predecessor.baselineSha256,
      lifecycleState: predecessor.receipt.disposition,
      ciInvocationCount: 1,
      ciResult: "PASS",
      finalCandidateScanSha256: manifest.historicalInputs.predecessorFinalScanSha256,
      freezeSha256: manifest.historicalInputs.predecessorFreezeSha256,
    },
    findings: {
      total: ids.length,
      authorClosed: 0,
      pendingIndependent: ids.length,
      bySeverity,
      ids: [...ids].sort(),
    },
    stage6Actions: manifest.stage6Actions,
  };
  if (write) {
    const evidenceDirectory = path.join(workspace, manifest.evidenceDirectory);
    await mkdir(evidenceDirectory, { recursive: true });
    await writeExclusiveOrMatch(
      path.join(evidenceDirectory, "finding-lineage.json"),
      Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
    );
  }
  return report;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await verifyStage5CurrentFindingLineage({
    write: process.argv.includes("--write"),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
