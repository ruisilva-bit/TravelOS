import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL19_CORRECTION_MATRIX,
  STAGE5_FINAL19_CORRECTION_MATRIX_SHA256,
  STAGE5_FINAL19_EVIDENCE_DIRECTORY,
  STAGE5_FINAL19_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT,
  STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT_SHA256,
  STAGE5_FINAL19_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL20_CORRECTION_MATRIX,
  STAGE5_FINAL20_EVIDENCE_DIRECTORY,
  STAGE5_FINAL20_PREDECESSOR_EVIDENCE_NAMES,
} from "./stage-5-candidate-contract.mjs";

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
const serialize = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");

export const verifyStage5Final20FindingLineage = async ({ root: candidateRoot = root } = {}) => {
  const workspace = path.resolve(candidateRoot);
  const matrixBytes = await readRegular(path.join(workspace, STAGE5_FINAL20_CORRECTION_MATRIX));
  const matrix = JSON.parse(matrixBytes.toString("utf8"));
  assert.equal(matrix.candidate, "FINAL-20");
  assert.equal(matrix.result, "PENDING_EXECUTION");
  assert.equal(matrix.findings.length, 49);
  assert.equal(matrix.summary.authorClosedCount, 0);
  assert.equal(matrix.summary.independentPendingCount, 49);
  assert.equal(matrix.stage6Actions, 0);

  const predecessorMatrixBytes = await readRegular(
    path.join(workspace, STAGE5_FINAL19_CORRECTION_MATRIX),
  );
  assert.equal(hash(predecessorMatrixBytes), STAGE5_FINAL19_CORRECTION_MATRIX_SHA256);
  const predecessorMatrix = JSON.parse(predecessorMatrixBytes.toString("utf8"));
  assert.equal(predecessorMatrix.candidate, "FINAL-19");
  assert.equal(predecessorMatrix.findings.length, 49);
  assert.equal(predecessorMatrix.summary.authorClosedCount, 0);

  const failureBytes = await readRegular(
    path.join(workspace, STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT),
  );
  assert.equal(hash(failureBytes), STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT_SHA256);
  const failure = JSON.parse(failureBytes.toString("utf8"));
  assert.equal(failure.candidate, "FINAL-19");
  assert.equal(failure.result, "REJECTED_PRE_CI_EVIDENCE_INDEX_INCOMPLETE");
  assert.equal(failure.evidenceIndex.created, false);
  assert.equal(failure.ciVerifyInvoked, false);
  assert.equal(failure.ciVerifyInvocationCount, 0);
  assert.equal(failure.preCiFreezeGuardCreated, false);
  assert.equal(failure.stage6Actions, 0);

  const predecessorDirectory = path.join(workspace, STAGE5_FINAL19_EVIDENCE_DIRECTORY);
  const predecessorExpected = [...STAGE5_FINAL19_EXPECTED_EVIDENCE_ARTIFACT_NAMES]
    .filter((name) => name !== "migration-checksums.json")
    .toSorted();
  const predecessorActual = (await readdir(predecessorDirectory)).toSorted();
  assert.deepEqual(predecessorActual, predecessorExpected);
  const predecessorRows = [];
  for (const name of predecessorExpected) {
    const sourcePath = path.join(predecessorDirectory, name);
    const sourceBytes = await readRegular(sourcePath);
    const archivedName = `final19-${name}`;
    assert(STAGE5_FINAL20_PREDECESSOR_EVIDENCE_NAMES.includes(archivedName));
    const archivedBytes = await readRegular(
      path.join(workspace, STAGE5_FINAL20_EVIDENCE_DIRECTORY, archivedName),
    );
    assert.deepEqual(archivedBytes, sourceBytes, `FINAL-19 predecessor copy differs: ${name}`);
    predecessorRows.push({
      path: `${STAGE5_FINAL19_EVIDENCE_DIRECTORY}/${name}`,
      bytes: sourceBytes.length,
      sha256: hash(sourceBytes),
    });
  }
  predecessorRows.sort((left, right) => left.path.localeCompare(right.path));
  const lineage = {
    schemaVersion: 1,
    result: "PASS",
    candidate: "FINAL-20",
    predecessor: {
      candidate: "FINAL-19",
      disposition: "REJECTED / PRE-CI EVIDENCE INDEX INCOMPLETE / CI NOT STARTED",
      baselineSha256: STAGE5_FINAL19_SECURITY_BASELINE_SHA256,
      correctionMatrixPath: STAGE5_FINAL19_CORRECTION_MATRIX,
      correctionMatrixSha256: hash(predecessorMatrixBytes),
      readinessPath: `${STAGE5_FINAL19_EVIDENCE_DIRECTORY}/readiness-preflight.json`,
      readinessSha256: hash(
        await readRegular(path.join(predecessorDirectory, "readiness-preflight.json")),
      ),
      failureReceiptPath: STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT,
      failureReceiptSha256: hash(failureBytes),
      missingArtifact: failure.failure.missingArtifact,
      evidenceIndexCreated: false,
      copiedEvidenceArtifactCount: predecessorRows.length,
      copiedEvidenceAggregateSha256: hash(Buffer.from(serialize(predecessorRows))),
      ciVerifyInvoked: false,
      ciVerifyInvocationCount: 0,
      stage6Actions: 0,
    },
    findings: {
      total: matrix.findings.length,
      authorClosed: matrix.summary.authorClosedCount,
      pendingIndependent: matrix.summary.independentPendingCount,
    },
    correctionMatrix: {
      path: STAGE5_FINAL20_CORRECTION_MATRIX,
      bytes: matrixBytes.length,
      sha256: hash(matrixBytes),
    },
    stage6Actions: 0,
  };
  return lineage;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyStage5Final20FindingLineage();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
