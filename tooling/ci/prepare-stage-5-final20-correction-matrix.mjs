import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL19_CORRECTION_MATRIX,
  STAGE5_FINAL19_CORRECTION_MATRIX_SHA256,
  STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT,
  STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT_SHA256,
  STAGE5_FINAL19_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL20_CORRECTION_MATRIX,
} from "./stage-5-candidate-contract.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const inputPath = path.join(root, STAGE5_FINAL19_CORRECTION_MATRIX);
const failurePath = path.join(root, STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT);
const outputPath = path.join(root, STAGE5_FINAL20_CORRECTION_MATRIX);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `${file} must be a regular file`);
  return readFile(file);
};

export const prepareStage5Final20CorrectionMatrix = async ({ write = false } = {}) => {
  const predecessorBytes = await readRegular(inputPath);
  assert.equal(hash(predecessorBytes), STAGE5_FINAL19_CORRECTION_MATRIX_SHA256);
  const predecessor = JSON.parse(predecessorBytes.toString("utf8"));
  const failureBytes = await readRegular(failurePath);
  assert.equal(hash(failureBytes), STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT_SHA256);
  const failure = JSON.parse(failureBytes.toString("utf8"));
  assert.equal(predecessor.candidate, "FINAL-19");
  assert.equal(predecessor.findings.length, 49);
  assert.equal(predecessor.summary.authorClosedCount, 0);
  assert.equal(failure.candidate, "FINAL-19");
  assert.equal(failure.result, "REJECTED_PRE_CI_EVIDENCE_INDEX_INCOMPLETE");
  assert.equal(
    failure.failure.missingArtifact,
    "docs/evidence/phase-1-m1/stage-5-final-19/migration-checksums.json",
  );
  assert.equal(failure.evidenceIndex.created, false);
  assert.equal(failure.ciVerifyInvoked, false);
  assert.equal(failure.ciVerifyInvocationCount, 0);
  assert.equal(failure.stage6Actions, 0);

  const matrix = globalThis.structuredClone(predecessor);
  matrix.candidate = "FINAL-20";
  matrix.result = "PENDING_EXECUTION";
  matrix.predecessor = {
    candidate: "FINAL-19",
    disposition: "REJECTED / PRE-CI EVIDENCE INDEX INCOMPLETE / CI NOT STARTED",
    baselineSha256: STAGE5_FINAL19_SECURITY_BASELINE_SHA256,
    correctionMatrixPath: STAGE5_FINAL19_CORRECTION_MATRIX,
    correctionMatrixSha256: hash(predecessorBytes),
    failureReceiptPath: STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT,
    failureReceiptSha256: hash(failureBytes),
    missingArtifact: failure.failure.missingArtifact,
    readinessResult: failure.readiness.result,
    evidenceIndexCreated: false,
    ciVerifyInvoked: false,
    ciVerifyInvocationCount: 0,
    ciAuthorizationConsumed: false,
    ciAuthorizationTransferred: false,
    stage6Actions: 0,
  };
  matrix.stage6Actions = 0;
  matrix.statusPolicy =
    "FINAL-19 is rejected before readiness PASS because the first PRE_CI evidence-index write failed on a missing migration-checksums.json artifact. Preserve its exact active baseline, 78 written evidence artifacts, pending readiness report, and failure receipt. Do not fabricate its missing migration-checksums artifact, evidence index, freeze guard, or CI result. FINAL-20 is the explicitly authorized sequential successor; carry all 49 findings without author closure and keep Stage 6 actions at zero.";
  for (const finding of matrix.findings) {
    finding.final20Status = "PENDING_FINAL20_INDEPENDENT_ADJUDICATION";
    finding.authorClosed = false;
    finding.currentEvidenceReferences = [
      ...new Set(finding.currentEvidenceReferences ?? []),
    ].toSorted();
  }
  matrix.successorToolingCorrection = {
    id: "FINAL19-EVIDENCE-MIGRATION-CHECKSUMS-001",
    status: "PENDING_FINAL20_IMPLEMENTATION_AND_QUALIFICATION",
    failureReceipt: {
      path: STAGE5_FINAL19_PREFLIGHT_FAILURE_RECEIPT,
      sha256: hash(failureBytes),
    },
    requiredBehavior:
      "Before the first FINAL-20 evidence index write, copy the exact bytes of migrations/checksums.json into FINAL-20 migration-checksums.json, verify byte count and SHA-256, and include the receipt in the exact expected evidence set. Index creation must fail closed if the copy is absent or divergent.",
    requiredTests: [
      "migration checksum evidence is materialized before initial index creation",
      "copied checksum bytes exactly match migrations/checksums.json",
      "missing checksum evidence fails before readiness can report PASS",
      "predecessor FINAL-19 missing-index evidence is preserved without reconstruction",
    ],
    ciAuthorization:
      "Use only after the independent FINAL-20 readiness verifier returns PASS; invoke ci:verify once at most.",
  };
  matrix.summary.carriedFindingCount = 49;
  matrix.summary.totalFindingCount = 49;
  matrix.summary.authorClosedCount = 0;
  matrix.summary.independentPendingCount = 49;
  const bytes = Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`);

  if (write) {
    try {
      const existing = await readRegular(outputPath);
      assert.deepEqual(existing, bytes, "Existing FINAL-20 matrix differs; refusing to overwrite");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeFile(outputPath, bytes, { flag: "wx" });
    }
  }
  const actual = await readRegular(outputPath);
  assert.deepEqual(
    actual,
    bytes,
    "FINAL-20 matrix does not match deterministic successor projection",
  );
  const parsed = JSON.parse(actual.toString("utf8"));
  assert.equal(parsed.findings.length, 49);
  assert.equal(parsed.summary.authorClosedCount, 0);
  assert.equal(parsed.summary.independentPendingCount, 49);
  assert(parsed.findings.every((finding) => finding.authorClosed === false));
  assert(
    parsed.findings.every(
      (finding) => finding.final20Status === "PENDING_FINAL20_INDEPENDENT_ADJUDICATION",
    ),
  );
  assert.equal(parsed.stage6Actions, 0);
  return {
    result: "PASS",
    candidate: "FINAL-20",
    predecessorCandidate: "FINAL-19",
    predecessorBaselineSha256: STAGE5_FINAL19_SECURITY_BASELINE_SHA256,
    predecessorFailureReceiptSha256: hash(failureBytes),
    findings: parsed.findings.length,
    authorClosed: parsed.summary.authorClosedCount,
    independentPending: parsed.summary.independentPendingCount,
    matrixSha256: hash(actual),
    stage6Actions: 0,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareStage5Final20CorrectionMatrix({
    write: process.argv.includes("--write"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
