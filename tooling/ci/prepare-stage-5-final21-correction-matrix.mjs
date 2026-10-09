import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL20_CORRECTION_MATRIX,
  STAGE5_FINAL20_CORRECTION_MATRIX_SHA256,
  STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT,
  STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT_SHA256,
  STAGE5_FINAL20_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL21_CORRECTION_MATRIX,
} from "./stage-5-candidate-contract.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const inputPath = path.join(root, STAGE5_FINAL20_CORRECTION_MATRIX);
const failurePath = path.join(root, STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT);
const outputPath = path.join(root, STAGE5_FINAL21_CORRECTION_MATRIX);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `${file} must be a regular file`);
  return readFile(file);
};

export const prepareStage5Final21CorrectionMatrix = async ({ write = false } = {}) => {
  const predecessorBytes = await readRegular(inputPath);
  assert.equal(hash(predecessorBytes), STAGE5_FINAL20_CORRECTION_MATRIX_SHA256);
  const predecessor = JSON.parse(predecessorBytes.toString("utf8"));
  const failureBytes = await readRegular(failurePath);
  assert.equal(hash(failureBytes), STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT_SHA256);
  const failure = JSON.parse(failureBytes.toString("utf8"));
  assert.equal(predecessor.candidate, "FINAL-20");
  assert.equal(predecessor.findings.length, 49);
  assert.equal(predecessor.summary.authorClosedCount, 0);
  assert.equal(failure.candidate, "FINAL-20");
  assert.equal(failure.phase, "FINAL_CANDIDATE");
  assert.equal(failure.result, "FAIL");
  assert.equal(failure.ciVerify.result, "PASS");
  assert.equal(failure.ciVerify.invocationCount, 1);
  assert.equal(failure.freeze.readbackIntegrity, "PASS");
  assert.equal(failure.stage6Actions, 0);

  const matrix = globalThis.structuredClone(predecessor);
  matrix.candidate = "FINAL-21";
  matrix.result = "PENDING_EXECUTION";
  matrix.predecessor = {
    candidate: "FINAL-20",
    disposition: "CI PASS / FROZEN / FINAL-CANDIDATE SCAN BLOCKED BEFORE SCANNER",
    baselineSha256: STAGE5_FINAL20_SECURITY_BASELINE_SHA256,
    correctionMatrixPath: STAGE5_FINAL20_CORRECTION_MATRIX,
    correctionMatrixSha256: hash(predecessorBytes),
    failureReceiptPath: STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT,
    failureReceiptSha256: hash(failureBytes),
    scanResult: "NOT_RUN",
    scanFailureGate: failure.failureGate,
    freezeSha256: failure.freeze.sha256,
    evidenceIndexCreated: true,
    ciVerifyInvoked: true,
    ciVerifyInvocationCount: 1,
    ciAuthorizationConsumed: true,
    ciAuthorizationTransferred: false,
    stage6Actions: 0,
  };
  matrix.stage6Actions = 0;
  matrix.statusPolicy =
    "FINAL-20 remains preserved with CI PASS, consumed authorization and verified freeze. Its FINAL_CANDIDATE scan was blocked before scanner execution because the collector required FINAL-18 validation/freeze artifacts that never existed. Do not fabricate historical artifacts or alter FINAL-20 evidence; FINAL-21 corrects the lifecycle evidence model and carries all 49 findings without author closure.";
  for (const finding of matrix.findings) {
    finding.final21Status = "PENDING_FINAL21_INDEPENDENT_ADJUDICATION";
    finding.authorClosed = false;
    finding.currentEvidenceReferences = [
      ...new Set(finding.currentEvidenceReferences ?? []),
    ].toSorted();
  }
  matrix.successorToolingCorrection = {
    id: "FINAL21-EVIDENCE-LIFECYCLE-001",
    status: "PENDING_FINAL21_IMPLEMENTATION_AND_QUALIFICATION",
    failureReceipt: {
      path: STAGE5_FINAL20_FINAL_CANDIDATE_SCAN_FAILURE_RECEIPT,
      sha256: hash(failureBytes),
    },
    requiredBehavior:
      "Model each predecessor lifecycle explicitly; require only artifacts applicable to its reached state, retain fail-closed checks for applicable artifacts, detect unexpected historical artifacts, and verify pinned hashes without modifying FINAL-20 records.",
    requiredTests: [
      "missing required artifact fails",
      "non-applicable lifecycle artifact absence passes",
      "fabricated unexpected artifact is detected",
      "duplicate generation, invalid transition and predecessor gaps fail",
      "wrong hash fails",
      "FINAL-18 rejected before validation is accepted without fabricated artifacts",
      "FINAL-20 records and hashes remain exact",
    ],
    ciAuthorization:
      "Use only after the FINAL-21 readiness verifier returns PASS; invoke ci:verify once at most.",
  };
  matrix.summary.carriedFindingCount = 49;
  matrix.summary.totalFindingCount = 49;
  matrix.summary.authorClosedCount = 0;
  matrix.summary.independentPendingCount = 49;
  const bytes = Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`);

  if (write) {
    try {
      const existing = await readRegular(outputPath);
      assert.deepEqual(existing, bytes, "Existing FINAL-21 matrix differs; refusing to overwrite");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeFile(outputPath, bytes, { flag: "wx" });
    }
  }
  const actual = await readRegular(outputPath);
  assert.deepEqual(
    actual,
    bytes,
    "FINAL-21 matrix does not match deterministic successor projection",
  );
  const parsed = JSON.parse(actual.toString("utf8"));
  assert.equal(parsed.findings.length, 49);
  assert.equal(parsed.summary.authorClosedCount, 0);
  assert.equal(parsed.summary.independentPendingCount, 49);
  assert(parsed.findings.every((finding) => finding.authorClosed === false));
  assert(
    parsed.findings.every(
      (finding) => finding.final21Status === "PENDING_FINAL21_INDEPENDENT_ADJUDICATION",
    ),
  );
  assert.equal(parsed.stage6Actions, 0);
  return {
    result: "PASS",
    candidate: "FINAL-21",
    predecessorCandidate: "FINAL-20",
    predecessorBaselineSha256: STAGE5_FINAL20_SECURITY_BASELINE_SHA256,
    predecessorFailureReceiptSha256: hash(failureBytes),
    findings: parsed.findings.length,
    authorClosed: parsed.summary.authorClosedCount,
    independentPending: parsed.summary.independentPendingCount,
    matrixSha256: hash(actual),
    stage6Actions: 0,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareStage5Final21CorrectionMatrix({
    write: process.argv.includes("--write"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
