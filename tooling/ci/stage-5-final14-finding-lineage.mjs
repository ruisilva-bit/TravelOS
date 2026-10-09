import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL13_ARCHIVE_MANIFEST,
  STAGE5_FINAL13_ARCHIVE_MANIFEST_SHA256,
  STAGE5_FINAL13_CANDIDATE_FREEZE,
  STAGE5_FINAL13_CANDIDATE_VALIDATION,
  STAGE5_FINAL13_CORRECTION_MATRIX,
  STAGE5_FINAL13_CORRECTION_MATRIX_SHA256,
  STAGE5_FINAL13_CI_VERIFY_INVOCATION_GUARD,
  STAGE5_FINAL13_EVIDENCE_DIRECTORY,
  STAGE5_FINAL13_FREEZE_SHA256,
  STAGE5_FINAL13_INDEX_SHA256,
  STAGE5_FINAL13_REVIEW_NO_GO,
  STAGE5_FINAL13_REVIEW_NO_GO_SHA256,
  STAGE5_FINAL13_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL13_SOURCE_ARCHIVE,
  STAGE5_FINAL13_SOURCE_ARCHIVE_SHA256,
  STAGE5_FINAL13_VALIDATION_SHA256,
  STAGE5_FINAL14_CANDIDATE_FREEZE,
  STAGE5_FINAL14_CORRECTION_MATRIX,
  STAGE5_FINAL14_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final13EvidenceIndex } from "./stage-5-final13-evidence-index.mjs";
import { verifyStage5Final13FindingLineage } from "./stage-5-final13-finding-lineage.mjs";

const rootDefault = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const STAGE5_FINAL14_FREEZE_SHA256 =
  "282be00d175690e7e42ab925d09dd601cd7d310648b38b4ca475b1ba2a5b05bf";
const readPinned = async (root, relativePath, expectedSha256) => {
  const absolutePath = path.join(root, relativePath);
  const metadata = await lstat(absolutePath);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `${relativePath} must be a regular file`);
  const bytes = await readFile(absolutePath);
  assert.equal(hash(bytes), expectedSha256, `${relativePath} historical hash changed`);
  return bytes;
};
const freezeRows = (text) =>
  text
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("| "))
    .map((line) =>
      line
        .replace(/^\||\|$/gu, "")
        .split("|")
        .map((field) => field.trim().replace(/^`|`$/gu, "")),
    )
    .filter((fields) => fields.length === 4 && /^\d+$/u.test(fields[0]))
    .map((fields) => ({ path: fields[1], bytes: Number(fields[2]), sha256: fields[3] }));
const sorted = (values) => [...values].toSorted();

export const verifyStage5Final14Predecessor = async ({ root = rootDefault } = {}) => {
  const freezeBytes = await readPinned(
    root,
    STAGE5_FINAL13_CANDIDATE_FREEZE,
    STAGE5_FINAL13_FREEZE_SHA256,
  );
  await readPinned(root, STAGE5_FINAL13_CANDIDATE_VALIDATION, STAGE5_FINAL13_VALIDATION_SHA256);
  await readPinned(root, STAGE5_FINAL13_CORRECTION_MATRIX, STAGE5_FINAL13_CORRECTION_MATRIX_SHA256);
  const reviewBytes = await readPinned(
    root,
    STAGE5_FINAL13_REVIEW_NO_GO,
    STAGE5_FINAL13_REVIEW_NO_GO_SHA256,
  );
  const archiveManifestBytes = await readPinned(
    root,
    STAGE5_FINAL13_ARCHIVE_MANIFEST,
    STAGE5_FINAL13_ARCHIVE_MANIFEST_SHA256,
  );
  await readPinned(root, STAGE5_FINAL13_SOURCE_ARCHIVE, STAGE5_FINAL13_SOURCE_ARCHIVE_SHA256);
  const review = JSON.parse(reviewBytes.toString("utf8"));
  const archiveManifest = JSON.parse(archiveManifestBytes.toString("utf8"));
  const freezeText = freezeBytes.toString("utf8");
  const rows = freezeRows(freezeText);
  const rowAggregate = hash(
    Buffer.from(rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("")),
  );
  assert.equal(review.candidate, "FINAL-13");
  assert.equal(review.decision, "NO-GO");
  assert.equal(review.readOnly, true);
  assert.equal(review.stage6Actions, 0);
  assert.equal(review.freeze.sha256, STAGE5_FINAL13_FREEZE_SHA256);
  assert.equal(review.freeze.rowsDeclared, 634);
  assert.equal(review.freeze.rowsRecomputed, 634);
  assert.equal(review.adjudicatedFindingIds.length, 48);
  assert.equal(new Set(review.adjudicatedFindingIds).size, 48);
  assert.equal(review.findings.length, 7);
  assert.equal(archiveManifest.candidate, "FINAL-13");
  assert.equal(archiveManifest.freezeSha256, STAGE5_FINAL13_FREEZE_SHA256);
  assert.equal(archiveManifest.declaredRows, 634);
  assert.equal(archiveManifest.reverifiedRows, 634);
  assert.equal(archiveManifest.archiveSha256, STAGE5_FINAL13_SOURCE_ARCHIVE_SHA256);
  assert.equal(archiveManifest.explicitSelfExclusion, true);
  assert.equal(rows.length, 634);
  assert.equal(new Set(rows.map((row) => row.path)).size, 634);
  assert.deepEqual(rows, archiveManifest.files);
  assert.equal(rowAggregate, review.freeze.aggregateSha256);
  assert.equal(rowAggregate, "8cb2467ab8dc3077f279e467c2086b0993ce9aebdcc1da3701e153e9541192f8");
  const final13Index = await verifyStage5Final13EvidenceIndex({
    root,
    allowedPhases: ["FINAL"],
    requiredPhase: "FINAL",
  });
  assert.equal(final13Index.indexSha256, STAGE5_FINAL13_INDEX_SHA256);
  assert.equal(final13Index.artifactCount, 54);
  const final13CiLog = final13Index.artifactBytesManifest.find(
    (row) => row.path === `${STAGE5_FINAL13_EVIDENCE_DIRECTORY}/ci-verify.log`,
  );
  const final13CiExecution = final13Index.artifactBytesManifest.find(
    (row) => row.path === `${STAGE5_FINAL13_EVIDENCE_DIRECTORY}/ci-verify-execution.json`,
  );
  assert(final13CiLog && final13CiExecution);
  assert.equal(final13CiLog.sha256, review.evidence.ciLogSha256);
  const final13CiExecutionBytes = await readFile(
    path.join(root, STAGE5_FINAL13_EVIDENCE_DIRECTORY, "ci-verify-execution.json"),
  );
  assert.equal(hash(final13CiExecutionBytes), final13CiExecution.sha256);
  const final13CiExecutionReceipt = JSON.parse(final13CiExecutionBytes.toString("utf8"));
  assert.equal(final13CiExecutionReceipt.candidate, "FINAL-13");
  assert.equal(final13CiExecutionReceipt.invocationCount, 1);
  assert.equal(final13CiExecutionReceipt.result, "PASS");
  assert.equal(final13CiExecutionReceipt.exitCode, 0);
  const priorLineage = await verifyStage5Final13FindingLineage({ root });
  assert.equal(priorLineage.result, "PASS");
  const baselinePath = "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json";
  const baselineBytes = await readFile(path.join(root, baselinePath));
  const activeBaseline = JSON.parse(baselineBytes.toString("utf8"));
  if (hash(baselineBytes) === STAGE5_FINAL13_SECURITY_BASELINE_SHA256) {
    assert.equal(activeBaseline.lineage.final13Generation?.candidate, "FINAL-13");
  } else {
    const predecessorBaselinePath = path.join(
      root,
      "docs/evidence/phase-1-m1/stage-5-final-14/final13-security-extension-baseline.json",
    );
    const predecessorBaselineBytes = await readFile(predecessorBaselinePath);
    assert.equal(hash(predecessorBaselineBytes), STAGE5_FINAL13_SECURITY_BASELINE_SHA256);
    assert.equal(activeBaseline.lineage.final14Generation?.candidate, "FINAL-14");
    assert.equal(
      activeBaseline.lineage.final14Generation?.previousBaselineSha256,
      STAGE5_FINAL13_SECURITY_BASELINE_SHA256,
    );
  }
  return {
    result: "PASS",
    candidate: "FINAL-13",
    decision: "NO-GO",
    freezeSha256: hash(freezeBytes),
    freezeRows: rows.length,
    aggregateSha256: rowAggregate,
    final13IndexSha256: final13Index.indexSha256,
    final13IndexArtifacts: final13Index.artifactCount,
    final13CiLogSha256: final13CiLog.sha256,
    final13CiExecutionSha256: final13CiExecution.sha256,
    reviewSha256: hash(reviewBytes),
    archiveManifestSha256: hash(archiveManifestBytes),
    archiveSha256: STAGE5_FINAL13_SOURCE_ARCHIVE_SHA256,
    previousPhase1BaselineSha256: STAGE5_FINAL13_SECURITY_BASELINE_SHA256,
    adjudicatedFindingIds: review.adjudicatedFindingIds,
    unresolvedReviewFindingIds: review.findings.map((finding) => finding.id).toSorted(),
    stage6Actions: 0,
  };
};

const currentEvidence = async (root) => {
  const directory = path.join(root, STAGE5_FINAL14_EVIDENCE_DIRECTORY);
  const qualification = JSON.parse(
    await readFile(path.join(directory, "postgresql-qualification.json"), "utf8"),
  );
  assert.equal(qualification.candidate, "FINAL-14");
  assert.equal(qualification.result, "PASS");
  assert.equal(qualification.integrationExecution.result, "PASS");
  assert.equal(qualification.disposableCleanup.result, "PASS");
  const freezeBytes = await readPinned(
    root,
    STAGE5_FINAL14_CANDIDATE_FREEZE,
    STAGE5_FINAL14_FREEZE_SHA256,
  );
  const frozenSourceTest = freezeRows(freezeBytes.toString("utf8")).find(
    (row) => row.path === qualification.sourceTestPath,
  );
  assert(frozenSourceTest, "FINAL-14 freeze is missing its PostgreSQL source-test row");
  assert.equal(
    frozenSourceTest.sha256,
    qualification.sourceTestSha256,
    "FINAL-14 PostgreSQL qualification must match the immutable FINAL-14 frozen source row",
  );
  assert.equal(qualification.stage6Actions, 0);
  return qualification;
};

export const buildStage5Final14CorrectionMatrix = async ({ root = rootDefault } = {}) => {
  const predecessor = await verifyStage5Final14Predecessor({ root });
  const originalMatrixBytes = await readPinned(
    root,
    STAGE5_FINAL13_CORRECTION_MATRIX,
    STAGE5_FINAL13_CORRECTION_MATRIX_SHA256,
  );
  const review = JSON.parse(await readFile(path.join(root, STAGE5_FINAL13_REVIEW_NO_GO), "utf8"));
  const originalMatrix = JSON.parse(originalMatrixBytes.toString("utf8"));
  const qualification = await currentEvidence(root);
  const reviewById = new Map(review.findings.map((finding) => [finding.id, finding]));
  const updatedReferences = {
    "S5F8-REVISION-GUC-001": [
      "tests/integration/stage-5-postgresql.test.ts:1503-1537",
      "tests/integration/stage-5-postgresql.test.ts:1562-1652",
      "docs/evidence/phase-1-m1/stage-5-final-14/postgresql-qualification.json",
    ],
    "S5F8-LOCKVERSION-001": [
      "packages/contracts/src/admin/lock-version.ts:3-11",
      "tests/integration/stage-5-postgresql.test.ts:1031-1083",
      "docs/evidence/phase-1-m1/stage-5-final-14/postgresql-qualification.json",
    ],
    "S5F8-DEADLOCK-001": [
      "tests/integration/stage-5-postgresql.test.ts:1901-2042",
      "docs/evidence/phase-1-m1/stage-5-final-14/postgresql-qualification.json",
    ],
    "S5F8-SCAN-PROVENANCE-001": [
      "tooling/ci/scan-source-secrets.mjs",
      "tooling/ci/stage-5-final14-scan-provenance.mjs",
      "docs/evidence/phase-1-m1/final14-scan-reports/STAGE_5_FINAL_14_POST_FREEZE.json",
    ],
    "S5F7-SOURCE-SCAN-ORDER-001": [
      "tooling/ci/stage-5-source-scope.mjs",
      "tooling/ci/scan-source-secrets.mjs",
      "docs/evidence/phase-1-m1/final14-scan-reports/STAGE_5_FINAL_14_POST_FREEZE.json",
    ],
    "S5F8-STALE-COST-EVIDENCE-001": [
      "tests/integration/stage-5-postgresql.test.ts:2057-2135",
      "apps/admin-api/src/m1-routes.ts:412-443",
      "docs/evidence/phase-1-m1/stage-5-final-14/postgresql-qualification.json",
    ],
  };
  const carriedFindings = originalMatrix.findings.map((finding) => {
    const independentIssue = reviewById.get(finding.id) ?? null;
    const references = updatedReferences[finding.id] ?? null;
    return {
      ...finding,
      final13IndependentReview: independentIssue
        ? { status: "OPEN_IN_FINAL13_REVIEW", severity: independentIssue.severity }
        : { status: "ADJUDICATED_NO_OPEN_ISSUE_REPORTED_IN_FINAL13_REVIEW" },
      final14Disposition: independentIssue
        ? "AUTHOR_REMEDIATION_EVIDENCED_PENDING_FINAL14_INDEPENDENT_CLOSURE"
        : "CARRIED_FORWARD_PENDING_FINAL14_INDEPENDENT_REVIEW",
      final14EvidenceReferences: references,
    };
  });
  const citationFinding = {
    id: "FINAL13-MATRIX-CITATIONS-001",
    severity: "LOW",
    source: {
      candidate: "FINAL-13",
      reviewReceipt: STAGE5_FINAL13_REVIEW_NO_GO,
      reviewReceiptSha256: STAGE5_FINAL13_REVIEW_NO_GO_SHA256,
    },
    evidence: ["docs/reviews/phase-1-m1/STAGE_5_FINAL_13_CORRECTION_MATRIX.json:564,676,690,704"],
    consequence:
      "Several frozen FINAL-13 matrix citations point away from the actual timezone, continuity, normalization, and reparent qualification locations.",
    correction:
      "Preserve FINAL-13 unchanged; this FINAL-14 matrix carries corrected current-source references and requires the independent reviewer to reproduce them.",
    currentEvidenceReferences: [
      "tests/integration/stage-5-postgresql.test.ts:1215-1426",
      "tests/integration/stage-5-postgresql.test.ts:2719-2763",
      "packages/backend-core/test/m1/application.test.ts:683-709",
    ],
    final14Disposition: "AUTHOR_CORRECTED_PENDING_FINAL14_INDEPENDENT_CLOSURE",
  };
  const ids = [...carriedFindings.map((finding) => finding.id), citationFinding.id];
  assert.equal(carriedFindings.length, 48);
  assert.equal(new Set(ids).size, 49);
  assert.deepEqual(
    sorted(carriedFindings.map((finding) => finding.id)),
    sorted(predecessor.adjudicatedFindingIds),
  );
  assert.equal(
    qualification.sourceTestSha256,
    hash(await readFile(path.join(root, "tests/integration/stage-5-postgresql.test.ts"))),
  );
  return {
    schemaVersion: 1,
    candidate: "FINAL-14",
    result: "PENDING_INDEPENDENT_REVIEW",
    predecessor: {
      candidate: "FINAL-13",
      disposition: "REJECTED_AFTER_INDEPENDENT_NO_GO; CI PASS AUTHORIZATION CONSUMED",
      freezeSha256: predecessor.freezeSha256,
      aggregateSha256: predecessor.aggregateSha256,
      reviewReceiptSha256: predecessor.reviewSha256,
      archivedSnapshotSha256: predecessor.archiveSha256,
      sourceMatrixSha256: STAGE5_FINAL13_CORRECTION_MATRIX_SHA256,
    },
    stage6Actions: 0,
    statusPolicy:
      "No finding is author-closed; all 49 IDs require FINAL-14 independent review. Author remediation status is not independent closure.",
    summary: {
      carriedFindingCount: 48,
      newFindingCount: 1,
      totalFindingCount: 49,
      authorClosedCount: 0,
      independentPendingCount: 49,
      final13ReviewOpenFindingCount: review.findings.length,
      final13AdjudicatedFindingCount: predecessor.adjudicatedFindingIds.length,
    },
    carriedFindings,
    independentReviewFindings: [...review.findings, citationFinding],
    postgresqlQualification: {
      result: qualification.result,
      executionSha256: qualification.integrationExecution.sha256,
      cleanupSha256: qualification.disposableCleanup.sha256,
      sourceTestSha256: qualification.sourceTestSha256,
    },
  };
};

export const writeStage5Final14CorrectionMatrix = async ({ root = rootDefault } = {}) => {
  const matrix = await buildStage5Final14CorrectionMatrix({ root });
  const bytes = Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`);
  await writeFile(path.join(root, STAGE5_FINAL14_CORRECTION_MATRIX), bytes);
  return {
    result: "PASS",
    candidate: "FINAL-14",
    path: STAGE5_FINAL14_CORRECTION_MATRIX,
    bytes: bytes.length,
    sha256: hash(bytes),
    findingCount: matrix.summary.totalFindingCount,
    stage6Actions: 0,
  };
};

export const verifyStage5Final14FindingLineage = async ({ root = rootDefault } = {}) => {
  const predecessor = await verifyStage5Final14Predecessor({ root });
  const matrixBytes = await readFile(path.join(root, STAGE5_FINAL14_CORRECTION_MATRIX));
  const matrix = JSON.parse(matrixBytes.toString("utf8"));
  const ids = [
    ...matrix.carriedFindings.map((finding) => finding.id),
    ...matrix.independentReviewFindings
      .map((finding) => finding.id)
      .filter((id) => id === "FINAL13-MATRIX-CITATIONS-001"),
  ];
  assert.equal(matrix.candidate, "FINAL-14");
  assert.equal(matrix.result, "PENDING_INDEPENDENT_REVIEW");
  assert.equal(matrix.stage6Actions, 0);
  assert.equal(matrix.summary.carriedFindingCount, 48);
  assert.equal(matrix.summary.totalFindingCount, 49);
  assert.equal(matrix.summary.authorClosedCount, 0);
  assert.equal(matrix.summary.independentPendingCount, 49);
  assert.equal(new Set(ids).size, 49);
  assert.equal(matrix.predecessor.freezeSha256, predecessor.freezeSha256);
  const qualification = await currentEvidence(root);
  assert.equal(
    matrix.postgresqlQualification.executionSha256,
    qualification.integrationExecution.sha256,
  );
  const review = JSON.parse(await readFile(path.join(root, STAGE5_FINAL13_REVIEW_NO_GO), "utf8"));
  const ciLogBytes = await readFile(
    path.join(root, STAGE5_FINAL13_EVIDENCE_DIRECTORY, "ci-verify.log"),
  );
  const ciExecutionBytes = await readFile(
    path.join(root, STAGE5_FINAL13_EVIDENCE_DIRECTORY, "ci-verify-execution.json"),
  );
  const invocationGuardBytes = await readFile(
    path.join(root, STAGE5_FINAL13_CI_VERIFY_INVOCATION_GUARD),
  );
  const ciExecution = JSON.parse(ciExecutionBytes.toString("utf8"));
  const invocationGuard = JSON.parse(invocationGuardBytes.toString("utf8"));
  assert.equal(hash(ciLogBytes), review.evidence.ciLogSha256);
  assert.equal(hash(ciExecutionBytes), predecessor.final13CiExecutionSha256);
  assert.equal(ciExecution.candidate, "FINAL-13");
  assert.equal(ciExecution.invocationCount, 1);
  assert.equal(ciExecution.result, "PASS");
  assert.equal(ciExecution.exitCode, 0);
  assert.equal(invocationGuard.candidate, "FINAL-13");
  assert.equal(invocationGuard.invocationCount, 1);
  assert.equal(invocationGuard.result, "PASS");
  const runnerPath = "tooling/ci/run-stage-5-final14-authoritative-ci.mjs";
  const runnerBytes = await readFile(path.join(root, runnerPath));
  return {
    result: "PASS",
    candidate: "FINAL-14",
    totalFindingCount: 49,
    authorClosedCount: 0,
    independentPendingCount: 49,
    predecessorReview: "NO-GO_PRESERVED",
    postgresQualification: qualification,
    runner: { path: runnerPath, sha256: hash(runnerBytes) },
    correctionMatrix: { path: STAGE5_FINAL14_CORRECTION_MATRIX, sha256: hash(matrixBytes) },
    final13: {
      ciLogSha256: hash(ciLogBytes),
      ciExecutionSha256: predecessor.final13CiExecutionSha256,
      invocationGuardSha256: hash(invocationGuardBytes),
      invocationGuardPath: STAGE5_FINAL13_CI_VERIFY_INVOCATION_GUARD,
    },
    stage6Actions: 0,
  };
};

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct && process.argv.includes("--write")) {
  const result = await writeStage5Final14CorrectionMatrix();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else if (direct && process.argv.includes("--verify")) {
  const result = await verifyStage5Final14FindingLineage();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
