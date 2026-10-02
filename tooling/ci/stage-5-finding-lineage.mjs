import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STAGE5_FINAL8_EVIDENCE_AGGREGATE_SHA256,
  STAGE5_FINAL8_EVIDENCE_INDEX_SHA256,
  STAGE5_FINAL8_EVIDENCE_INDEX,
  STAGE5_FINAL8_FREEZE_AGGREGATE_SHA256,
  STAGE5_FINAL8_FREEZE,
  STAGE5_FINAL8_FREEZE_SHA256,
  STAGE5_FINAL8_INDEPENDENT_REVIEW_SHA256,
  STAGE5_FINAL8_REJECTED_TAG,
  STAGE5_FINAL8_REJECTED_TAG_TARGET,
  STAGE5_FINAL9_CANDIDATE_FREEZE,
  STAGE5_FINAL9_CORRECTION_MATRIX,
  STAGE5_FINAL9_EVIDENCE_INDEX,
  STAGE5_FINAL9_EXPECTED_ALL_FINDING_IDS,
  STAGE5_FINAL9_EXPECTED_CARRIED_FINDING_IDS,
  STAGE5_FINAL9_EXPECTED_FINAL8_REVIEW_FINDING_IDS,
  STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT,
} from "./stage-5-candidate-contract.mjs";

const sha256 = (content) => createHash("sha256").update(content).digest("hex");

export const verifyStage5Final8TaggedBytes = async ({ root = process.cwd() } = {}) => {
  const tagTarget = execFileSync("git", ["rev-parse", `${STAGE5_FINAL8_REJECTED_TAG}^{}`], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (tagTarget !== STAGE5_FINAL8_REJECTED_TAG_TARGET) {
    throw new Error("Rejected FINAL-8 tag target changed from the protected predecessor");
  }
  const protectedPaths = [
    {
      path: STAGE5_FINAL8_FREEZE,
      sha256: STAGE5_FINAL8_FREEZE_SHA256,
    },
    {
      path: STAGE5_FINAL8_EVIDENCE_INDEX,
      sha256: STAGE5_FINAL8_EVIDENCE_INDEX_SHA256,
    },
  ];
  const files = [];
  for (const entry of protectedPaths) {
    const currentPath = path.join(root, entry.path);
    const currentMetadata = await lstat(currentPath);
    if (
      !currentMetadata.isFile() ||
      currentMetadata.isSymbolicLink() ||
      currentMetadata.nlink !== 1
    ) {
      throw new Error(`Protected FINAL-8 input is not a unique regular file: ${entry.path}`);
    }
    const currentBytes = await readFile(currentPath);
    const taggedBytes = execFileSync(
      "git",
      ["show", `${STAGE5_FINAL8_REJECTED_TAG}:${entry.path}`],
      {
        cwd: root,
        maxBuffer: 5 * 1024 * 1024,
      },
    );
    const currentSha256 = sha256(currentBytes);
    if (currentSha256 !== entry.sha256 || !currentBytes.equals(taggedBytes)) {
      throw new Error(`Protected FINAL-8 bytes differ from the rejected tag: ${entry.path}`);
    }
    files.push({
      path: entry.path,
      bytes: currentBytes.length,
      sha256: currentSha256,
      matchesRejectedTag: true,
    });
  }
  return { result: "PASS", tag: STAGE5_FINAL8_REJECTED_TAG, target: tagTarget, files };
};

const assertExactIds = (actual, expected, label) => {
  assert.ok(Array.isArray(actual), `${label} must be an array`);
  assert.deepEqual(
    actual.map((entry) => entry?.id),
    expected,
    `${label} must contain the complete expected ordered finding lineage`,
  );
};

export const validateStage5Final8ReviewSource = (review, reviewBytes) => {
  if (sha256(reviewBytes) !== STAGE5_FINAL8_INDEPENDENT_REVIEW_SHA256) {
    throw new Error(
      "Preserved FINAL-8 independent review bytes do not match their recorded SHA-256",
    );
  }
  if (
    review.reviewer !== "Hermes Agent (gpt-5.6-sol)" ||
    review.role !== "independent non-authoring read-only adversarial reviewer" ||
    !review.recommendation?.startsWith("NO-GO") ||
    review.worktree_mutated !== false ||
    review.stage6_actions !== 0
  ) {
    throw new Error("Preserved FINAL-8 review identity, decision, or Stage 6 boundary is invalid");
  }
  assertExactIds(
    review.findings,
    STAGE5_FINAL9_EXPECTED_FINAL8_REVIEW_FINDING_IDS,
    "FINAL-8 review findings",
  );
  assertExactIds(
    review.prior_findings,
    STAGE5_FINAL9_EXPECTED_CARRIED_FINDING_IDS,
    "carried historical findings",
  );

  const integrity = review.freeze_integrity;
  if (
    integrity.candidate !== "docs/reviews/phase-1-m1/STAGE_5_FINAL_8_CANDIDATE_FREEZE.md" ||
    integrity.candidate_sha256 !== STAGE5_FINAL8_FREEZE_SHA256 ||
    integrity.declared_rows !== 51 ||
    integrity.parsed_rows !== 51 ||
    integrity.matched_rows !== 51 ||
    integrity.missing_rows !== 0 ||
    integrity.mismatched_rows !== 0 ||
    integrity.duplicate_rows !== 0 ||
    integrity.declared_aggregate !== STAGE5_FINAL8_FREEZE_AGGREGATE_SHA256 ||
    integrity.recomputed_aggregate !== STAGE5_FINAL8_FREEZE_AGGREGATE_SHA256 ||
    integrity.evidence_index !== "docs/evidence/phase-1-m1/stage-5-final-8/EVIDENCE_INDEX.json" ||
    integrity.evidence_artifacts_declared !== 14 ||
    integrity.evidence_artifacts_matched !== 14 ||
    integrity.evidence_mismatches !== 0 ||
    integrity.evidence_declared_aggregate !== STAGE5_FINAL8_EVIDENCE_AGGREGATE_SHA256 ||
    integrity.evidence_recomputed_aggregate !== STAGE5_FINAL8_EVIDENCE_AGGREGATE_SHA256
  ) {
    throw new Error(
      "Preserved FINAL-8 independent integrity report does not match the frozen predecessor",
    );
  }
  return {
    sourcePath: STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT,
    bytes: reviewBytes.length,
    sha256: sha256(reviewBytes),
    reviewer: review.reviewer,
    recommendation: "NO-GO",
    final8FreezeSha256: integrity.candidate_sha256,
    final8FreezeAggregateSha256: integrity.recomputed_aggregate,
    final8EvidenceIndexSha256: STAGE5_FINAL8_EVIDENCE_INDEX_SHA256,
    final8EvidenceAggregateSha256: integrity.evidence_recomputed_aggregate,
    currentFindingCount: review.findings.length,
    carriedFindingCount: review.prior_findings.length,
    stage6Actions: review.stage6_actions,
  };
};

export const buildStage5Final9CorrectionMatrix = ({ review, reviewBytes }) => {
  const source = validateStage5Final8ReviewSource(review, reviewBytes);
  const currentFindings = review.findings.map((record) => ({
    id: record.id,
    sourceType: "FINAL_8_INDEPENDENT_REVIEW_FINDING",
    priorStatus: "OPEN",
    final9Disposition: "PENDING_REQUALIFICATION",
    final9IndependentStatus: "PENDING_FINAL9_REVIEW",
    sourceRecord: record,
  }));
  const carriedFindings = review.prior_findings.map((record) => ({
    id: record.id,
    sourceType: "HISTORICAL_FINDING_CARRY_FORWARD",
    priorStatus: record.status,
    final9Disposition: "PENDING_REQUALIFICATION",
    final9IndependentStatus: "PENDING_FINAL9_REVIEW",
    sourceRecord: record,
  }));
  const findings = [...currentFindings, ...carriedFindings];
  assert.deepEqual(
    findings.map((finding) => finding.id),
    STAGE5_FINAL9_EXPECTED_ALL_FINDING_IDS,
    "combined FINAL-9 finding lineage must be exact and duplicate-free",
  );
  return {
    schemaVersion: 1,
    result: "PASS",
    stage: "PHASE_1_M1_STAGE_5",
    candidate: "FINAL-9",
    sourceReview: source,
    stage6Actions: 0,
    statusPolicy: {
      authorMayCloseFindings: false,
      final9IndependentReviewRequired: true,
      authorDisposition: "PENDING_REQUALIFICATION",
      independentDisposition: "PENDING_FINAL9_REVIEW",
    },
    summary: {
      final8ReviewFindingCount: currentFindings.length,
      carriedHistoricalFindingCount: carriedFindings.length,
      totalFindingCount: findings.length,
      authorClosedCount: 0,
      independentPendingCount: findings.length,
    },
    findings,
  };
};

export const verifyStage5Final9FindingLineageData = async ({ root = process.cwd() } = {}) => {
  const reviewPath = path.join(root, STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT);
  const reviewMetadata = await lstat(reviewPath);
  if (!reviewMetadata.isFile() || reviewMetadata.isSymbolicLink()) {
    throw new Error("Preserved FINAL-8 review source is not a regular file");
  }
  const reviewBytes = await readFile(reviewPath);
  let review;
  try {
    review = JSON.parse(reviewBytes.toString("utf8"));
  } catch {
    throw new Error("Preserved FINAL-8 review source is not valid JSON");
  }
  const expectedMatrix = buildStage5Final9CorrectionMatrix({ review, reviewBytes });
  const matrixPath = path.join(root, STAGE5_FINAL9_CORRECTION_MATRIX);
  const matrixMetadata = await lstat(matrixPath);
  if (!matrixMetadata.isFile() || matrixMetadata.isSymbolicLink()) {
    throw new Error("FINAL-9 correction matrix is not a regular file");
  }
  const matrixBytes = await readFile(matrixPath);
  let matrix;
  try {
    matrix = JSON.parse(matrixBytes.toString("utf8"));
  } catch {
    throw new Error("FINAL-9 correction matrix is not valid JSON");
  }
  if (JSON.stringify(matrix) !== JSON.stringify(expectedMatrix)) {
    throw new Error(
      "FINAL-9 correction matrix omits, changes, closes, or misattributes historical findings",
    );
  }

  const evidenceIndexPath = path.join(root, STAGE5_FINAL9_EVIDENCE_INDEX);
  const evidenceIndexMetadata = await lstat(evidenceIndexPath);
  if (!evidenceIndexMetadata.isFile() || evidenceIndexMetadata.isSymbolicLink()) {
    throw new Error("FINAL-9 evidence index is not a regular file");
  }
  const sourceFiles = await readFile(evidenceIndexPath);
  const evidenceIndex = JSON.parse(sourceFiles.toString("utf8"));
  const indexedPaths = new Set((evidenceIndex.artifacts ?? []).map((artifact) => artifact.path));
  if (!indexedPaths.has(STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT)) {
    throw new Error("FINAL-9 evidence index omits the immutable FINAL-8 independent review source");
  }

  return {
    schemaVersion: 1,
    result: "PASS",
    sourceReview: reviewMetadataReport(reviewBytes, review),
    correctionMatrix: {
      path: STAGE5_FINAL9_CORRECTION_MATRIX,
      bytes: matrixBytes.length,
      sha256: sha256(matrixBytes),
      findingCount: matrix.findings.length,
    },
    evidenceIndexIncludesReviewSource: true,
    totalFindingCount: expectedMatrix.summary.totalFindingCount,
    final8ReviewFindingCount: expectedMatrix.summary.final8ReviewFindingCount,
    carriedHistoricalFindingCount: expectedMatrix.summary.carriedHistoricalFindingCount,
    authorClosedCount: 0,
    independentPendingCount: expectedMatrix.summary.independentPendingCount,
    stage6Actions: 0,
  };
};

export const verifyStage5Final9FindingLineage = async ({ root = process.cwd() } = {}) => {
  const protectedPredecessor = await verifyStage5Final8TaggedBytes({ root });
  const lineage = await verifyStage5Final9FindingLineageData({ root });
  return { ...lineage, protectedPredecessor };
};

const reviewMetadataReport = (reviewBytes, review) => ({
  path: STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT,
  bytes: reviewBytes.length,
  sha256: sha256(reviewBytes),
  reviewer: review.reviewer,
  recommendation: "NO-GO",
  currentFindingCount: review.findings.length,
  carriedFindingCount: review.prior_findings.length,
});

export const writeStage5Final9CorrectionMatrix = async ({ root = process.cwd() } = {}) => {
  const protectedPredecessor = await verifyStage5Final8TaggedBytes({ root });
  const freezePath = path.join(root, STAGE5_FINAL9_CANDIDATE_FREEZE);
  try {
    await lstat(freezePath);
    throw new Error("FINAL-9 freeze exists; do not rewrite its correction matrix");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const reviewBytes = await readFile(path.join(root, STAGE5_FINAL9_FINAL8_REVIEW_ARTIFACT));
  const review = JSON.parse(reviewBytes.toString("utf8"));
  const matrix = buildStage5Final9CorrectionMatrix({ review, reviewBytes });
  await writeFile(
    path.join(root, STAGE5_FINAL9_CORRECTION_MATRIX),
    `${JSON.stringify(matrix, null, 2)}\n`,
  );
  return {
    schemaVersion: 1,
    result: "PASS",
    matrixPath: STAGE5_FINAL9_CORRECTION_MATRIX,
    bytes: Buffer.byteLength(`${JSON.stringify(matrix, null, 2)}\n`),
    sha256: sha256(Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`)),
    findingCount: matrix.findings.length,
    stage6Actions: 0,
    protectedPredecessor,
  };
};

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  const report = process.argv.includes("--write")
    ? await writeStage5Final9CorrectionMatrix()
    : await verifyStage5Final9FindingLineage();
  console.log(JSON.stringify(report, null, 2));
}
