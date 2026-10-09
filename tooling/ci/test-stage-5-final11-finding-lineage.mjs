import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL10_CORRECTION_MATRIX_PATH,
  STAGE5_FINAL10_REJECTED_TAG,
  STAGE5_FINAL10_REJECTED_TAG_TARGET,
  STAGE5_FINAL11_CORRECTION_MATRIX,
  STAGE5_FINAL11_EVIDENCE_INDEX,
} from "./stage-5-candidate-contract.mjs";
import {
  buildStage5Final11CorrectionMatrix,
  verifyStage5Final10RejectedTaggedBytes,
  verifyStage5Final11FindingLineage,
} from "./stage-5-final11-finding-lineage.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const final10Lineage = await verifyStage5Final10RejectedTaggedBytes({ root });
const final10MatrixBytes = execFileSync(
  "git",
  ["show", `${STAGE5_FINAL10_REJECTED_TAG}:${STAGE5_FINAL10_CORRECTION_MATRIX_PATH}`],
  { cwd: root },
);
const final10Matrix = JSON.parse(final10MatrixBytes.toString("utf8"));
const final10Verification = { ...final10Lineage, matrix: final10Matrix };
const expectedMatrix = buildStage5Final11CorrectionMatrix({ final10Lineage: final10Verification });
const currentMatrix = JSON.parse(
  await readFile(path.join(root, STAGE5_FINAL11_CORRECTION_MATRIX), "utf8"),
);
assert.deepEqual(currentMatrix, expectedMatrix);
assert.equal(currentMatrix.candidate, "FINAL-11");
assert.equal(currentMatrix.summary.totalFindingCount, 48);
assert.equal(currentMatrix.summary.authorClosedCount, 0);
assert.equal(currentMatrix.summary.independentPendingCount, 48);
assert.equal(currentMatrix.summary.priorGenerationFailureCount, 1);
assert.equal(currentMatrix.summary.priorGenerationFailurePendingReviewCount, 1);
assert.equal(currentMatrix.stage6Actions, 0);
assert.equal(final10Lineage.tag, STAGE5_FINAL10_REJECTED_TAG);
assert.equal(final10Lineage.target, STAGE5_FINAL10_REJECTED_TAG_TARGET);
assert.equal(final10Lineage.failedGate, "stage5-security-extension:pre");
assert.equal(final10Lineage.invocationCount, 1);
assert.equal(final10Lineage.exitCode, 1);
assert.notEqual(final10Lineage.packageSha256AtCi, final10Lineage.staleBaselinePackageSha256);
assert.equal(final10Lineage.localOnlyInvocationGuard.committed, false);
assert.ok(
  currentMatrix.findings.every(
    (finding) =>
      finding.final11Disposition === "PENDING_REMEDIATION_REQUALIFICATION" &&
      finding.final11IndependentStatus === "PENDING_FINAL11_REVIEW",
  ),
);

const authorClosedMatrix = JSON.parse(JSON.stringify(final10Matrix));
authorClosedMatrix.findings[0].final10Disposition = "CLOSED";
assert.throws(
  () =>
    buildStage5Final11CorrectionMatrix({
      final10Lineage: { ...final10Verification, matrix: authorClosedMatrix },
    }),
  /may not inherit author-closed/u,
);
const malformedSourceMatrix = JSON.parse(JSON.stringify(final10Matrix));
malformedSourceMatrix.findings[0].sourceRecord.id = "SPOOFED-ID";
assert.throws(
  () =>
    buildStage5Final11CorrectionMatrix({
      final10Lineage: { ...final10Verification, matrix: malformedSourceMatrix },
    }),
  /may not inherit author-closed or malformed/u,
);
const missingFindingMatrix = JSON.parse(JSON.stringify(final10Matrix));
missingFindingMatrix.findings.pop();
missingFindingMatrix.summary.totalFindingCount -= 1;
missingFindingMatrix.summary.independentPendingCount -= 1;
assert.throws(
  () =>
    buildStage5Final11CorrectionMatrix({
      final10Lineage: { ...final10Verification, matrix: missingFindingMatrix },
    }),
  /cannot carry an unverified or author-closed FINAL-10 matrix/u,
);
assert.throws(
  () =>
    buildStage5Final11CorrectionMatrix({
      final10Lineage: { ...final10Verification, target: "0".repeat(40) },
    }),
  /unverified or author-closed FINAL-10/u,
);

let fullEvidenceLineageVerified = false;
try {
  await lstat(path.join(root, STAGE5_FINAL11_EVIDENCE_INDEX));
  const full = await verifyStage5Final11FindingLineage({ root });
  assert.equal(full.result, "PASS");
  assert.equal(full.protectedFinal10.tag, STAGE5_FINAL10_REJECTED_TAG);
  assert.equal(full.totalFindingCount, 48);
  assert.equal(full.stage6Actions, 0);
  fullEvidenceLineageVerified = true;
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      result: "PASS",
      candidate: "FINAL-11",
      protectedFinal10Tag: final10Lineage.tag,
      protectedFinal10Target: final10Lineage.target,
      failedCiGate: final10Lineage.failedGate,
      final10InvocationCount: final10Lineage.invocationCount,
      findingsCarried: currentMatrix.summary.totalFindingCount,
      authorClosedFindings: currentMatrix.summary.authorClosedCount,
      pendingIndependentReviews: currentMatrix.summary.independentPendingCount,
      priorGenerationFailurePendingReview:
        currentMatrix.summary.priorGenerationFailurePendingReviewCount,
      fullEvidenceLineageVerified,
      stage6Actions: 0,
    },
    null,
    2,
  ),
);
