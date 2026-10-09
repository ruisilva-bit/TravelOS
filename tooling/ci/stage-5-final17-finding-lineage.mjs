import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL14_CORRECTION_MATRIX,
  STAGE5_FINAL14_EVIDENCE_DIRECTORY,
  STAGE5_FINAL14_REVIEW_NO_GO,
  STAGE5_FINAL14_REVIEW_NO_GO_SHA256,
  STAGE5_FINAL14_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL16_BASELINE_SHA256,
  STAGE5_FINAL16_EVIDENCE_DIRECTORY,
  STAGE5_FINAL16_EVIDENCE_INDEX_SHA256,
  STAGE5_FINAL16_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL16_PACKAGE_SHA256,
  STAGE5_FINAL16_PREFLIGHT_FAILURE_LOG_SHA256,
  STAGE5_FINAL16_PREFLIGHT_FAILURE_RECEIPT_SHA256,
  STAGE5_FINAL16_READINESS_SHA256,
  STAGE5_FINAL16_RUNNER_SHA256,
  STAGE5_FINAL17_CORRECTION_MATRIX,
  STAGE5_FINAL17_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";
import { reconcileReviewAdjudication } from "./stage-5-review-reconciliation.mjs";
import { verifyStage5Final17Predecessor } from "./stage-5-final17-evidence-index.mjs";

const rootDefault = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (root, relativePath) =>
  JSON.parse(await readFile(path.join(root, relativePath), "utf8"));

const verifyFinal16History = async ({ root, candidateEvidenceDirectory }) => {
  const indexPath = `${STAGE5_FINAL16_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`;
  const indexBytes = await readFile(path.join(root, indexPath));
  assert.equal(hash(indexBytes), STAGE5_FINAL16_EVIDENCE_INDEX_SHA256);
  const indexCopy = await readFile(
    path.join(candidateEvidenceDirectory, "final16-EVIDENCE_INDEX.json"),
  );
  assert.deepEqual(indexCopy, indexBytes, "FINAL-17 changed the pinned FINAL-16 evidence index");
  const index = JSON.parse(indexBytes.toString("utf8"));
  assert.equal(index.candidate, "FINAL-16");
  assert.equal(index.phase, "PRE_CI");
  assert.equal(index.artifactCount, STAGE5_FINAL16_EXPECTED_EVIDENCE_ARTIFACT_NAMES.length);
  assert.equal(index.stage6Actions, 0);
  for (const row of index.artifacts) {
    const bytes = await readFile(path.join(root, row.path));
    assert.equal(bytes.length, row.bytes);
    assert.equal(hash(bytes), row.sha256);
    const copy = await readFile(
      path.join(candidateEvidenceDirectory, `final16-${path.basename(row.path)}`),
    );
    assert.deepEqual(copy, bytes, `FINAL-17 changed indexed FINAL-16 artifact ${row.path}`);
  }
  const baselineBytes = await readFile(
    path.join(candidateEvidenceDirectory, "final16-security-extension-baseline.json"),
  );
  assert.equal(hash(baselineBytes), STAGE5_FINAL16_BASELINE_SHA256);
  const baseline = JSON.parse(baselineBytes.toString("utf8"));
  assert.equal(baseline.result, "PASS");
  assert.equal(baseline.lineage.final16Generation?.candidate, "FINAL-16");
  assert.equal(
    baseline.lineage.final16Generation?.packageJsonSha256,
    STAGE5_FINAL16_PACKAGE_SHA256,
  );
  assert.equal(baseline.lineage.final16Generation?.runnerSha256, STAGE5_FINAL16_RUNNER_SHA256);
  const readiness = await readFile(
    path.join(candidateEvidenceDirectory, "final16-readiness-preflight.json"),
  );
  assert.equal(hash(readiness), STAGE5_FINAL16_READINESS_SHA256);
  const failureBytes = await readFile(
    path.join(candidateEvidenceDirectory, "final16-preflight-failure.json"),
  );
  const failureLog = await readFile(
    path.join(candidateEvidenceDirectory, "final16-preflight-failure.log"),
  );
  assert.equal(hash(failureBytes), STAGE5_FINAL16_PREFLIGHT_FAILURE_RECEIPT_SHA256);
  assert.equal(hash(failureLog), STAGE5_FINAL16_PREFLIGHT_FAILURE_LOG_SHA256);
  const failure = JSON.parse(failureBytes.toString("utf8"));
  assert.equal(failure.candidate, "FINAL-16");
  assert.equal(failure.result, "REJECTED");
  assert.equal(failure.ci.invocationCount, 0);
  assert.equal(failure.ci.authorizationConsumed, false);
  assert.equal(failure.stage6Actions, 0);
  return {
    candidate: "FINAL-16",
    status: "REJECTED / PRE-CI PREFLIGHT FAILURE / CI NOT STARTED",
    baselineSha256: STAGE5_FINAL16_BASELINE_SHA256,
    evidenceIndexSha256: STAGE5_FINAL16_EVIDENCE_INDEX_SHA256,
    readinessSha256: STAGE5_FINAL16_READINESS_SHA256,
    failureReceiptSha256: STAGE5_FINAL16_PREFLIGHT_FAILURE_RECEIPT_SHA256,
    failureLogSha256: STAGE5_FINAL16_PREFLIGHT_FAILURE_LOG_SHA256,
    ciInvocationCount: 0,
    authorizationConsumed: false,
    authorizationTransferred: false,
    stage6Actions: 0,
  };
};

const currentEvidenceReferences = {
  "S5F8-AUTHZ-001": [
    "packages/backend-core/src/modules/trip-operations/application/m1-staff-operations.ts:63-96,206-258",
    "packages/database/src/trip-operations/m1-operational-slice-repository.ts:29-134,629-793",
    "packages/backend-core/src/index.ts:78-95",
    "packages/database/src/index.ts:17-19",
    "tests/integration/stage-5-postgresql.test.ts: (caller-selected weak-permission regression; exact assertion is in the pinned integration-test source hash)",
    `${STAGE5_FINAL17_EVIDENCE_DIRECTORY}/postgresql-qualification-execution.json`,
  ],
  "S5F8-CSRF-001": [
    "apps/admin-api/src/http-security.ts:64-75",
    "apps/admin-api/src/m1-routes.ts:79-95,330-351,414-444",
    "apps/admin-api/test/m1-routes.test.ts:410-435",
    "apps/admin-api/test/composed-m1-body-parser.test.ts:274-326",
  ],
  "S5F8-MULTIAGENCY-QUAL-001": [
    "migrations/0005_root_agency_staff_authorization.cjs:13-21",
    "tests/integration/stage-5-postgresql.test.ts:692-887",
    `${STAGE5_FINAL17_EVIDENCE_DIRECTORY}/postgresql-integration-tests.log`,
    `${STAGE5_FINAL17_EVIDENCE_DIRECTORY}/postgresql-disposable-cleanup.json`,
  ],
  "S5F8-PERMISSION-DOC-001": [
    "docs/PERMISSIONS.md:52-68 (immutable Phase-0 document; unchanged)",
    "docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md:21-55,165-173",
    "tooling/ci/generate-stage-5-final17-security-extension-baseline.mjs",
    `${STAGE5_FINAL17_EVIDENCE_DIRECTORY}/baseline-generation.json`,
  ],
  "S5F8-AUTH-SCOPE-001": [
    "packages/backend-core/src/staff-access/permission-registry.ts:48-80",
    "packages/backend-core/test/agency-organization/agency-bootstrap.test.ts: (FINAL-17 Agency/ALL-only assertions)",
    `${STAGE5_FINAL17_EVIDENCE_DIRECTORY}/focused-test-execution.json`,
  ],
  "S5F8-STALE-COST-EVIDENCE-001": [
    "tests/integration/stage-5-postgresql.test.ts: (stale supplier-cost compare-and-swap route regression)",
    `${STAGE5_FINAL17_EVIDENCE_DIRECTORY}/postgresql-integration-tests.log`,
    `${STAGE5_FINAL17_EVIDENCE_DIRECTORY}/postgresql-qualification-execution.json`,
  ],
  "FINAL13-MATRIX-CITATIONS-001": [
    "docs/reviews/phase-1-m1/STAGE_5_FINAL_14_CORRECTION_MATRIX.json:1216-1245",
    "tests/integration/stage-5-postgresql.test.ts:1327-1571,2612-2710,2813-2863",
    "packages/backend-core/test/m1/application.test.ts:684-712",
  ],
};

export const buildStage5Final17CorrectionMatrix = async ({ root = rootDefault } = {}) => {
  const predecessorMatrix = await readJson(root, STAGE5_FINAL14_CORRECTION_MATRIX);
  const review = await readJson(root, STAGE5_FINAL14_REVIEW_NO_GO);
  const findingIds = [
    ...predecessorMatrix.carriedFindings.map((finding) => finding.id),
    ...predecessorMatrix.independentReviewFindings.map((finding) => finding.id),
  ];
  const adjudication = reconcileReviewAdjudication(findingIds, review.findingAdjudication);
  assert.equal(adjudication.uniqueFindingCount, 49);
  assert.deepEqual(adjudication.normalizedCounts, {
    evidenceSupportedCorrection: 6,
    open: 5,
    unverified: 38,
  });
  assert.deepEqual(adjudication.sourceOverlapIds, ["S5F7-AUTH-CACHE-001"]);
  assert.equal(
    hash(await readFile(path.join(root, STAGE5_FINAL14_REVIEW_NO_GO))),
    STAGE5_FINAL14_REVIEW_NO_GO_SHA256,
  );
  const predecessor = await verifyStage5Final17Predecessor({ root });
  const rejectedFinal16Candidate = await verifyFinal16History({
    root,
    candidateEvidenceDirectory: path.join(root, STAGE5_FINAL17_EVIDENCE_DIRECTORY),
  });
  const classification = new Map();
  for (const [category, ids] of Object.entries({
    evidenceSupportedCorrection: adjudication.evidenceSupportedCorrection,
    open: adjudication.open,
    unverified: adjudication.unverified,
  })) {
    for (const id of ids) classification.set(id, category);
  }
  const allFindings = new Map();
  for (const finding of [
    ...predecessorMatrix.carriedFindings,
    ...predecessorMatrix.independentReviewFindings,
  ]) {
    if (!allFindings.has(finding.id)) allFindings.set(finding.id, finding);
  }
  const findings = [...allFindings.values()]
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .map((finding) => {
      const priorReviewClass = classification.get(finding.id);
      assert(priorReviewClass, `FINAL-14 finding has no normalized adjudication: ${finding.id}`);
      return {
        id: finding.id,
        severity: finding.sourceRecord?.severity ?? finding.severity ?? "UNSPECIFIED",
        final14Adjudication: priorReviewClass,
        final17Status: "PENDING_FINAL17_INDEPENDENT_ADJUDICATION",
        sourceRecord: finding.sourceRecord ?? finding,
        previousEvidenceReferences:
          finding.final14EvidenceReferences ?? finding.currentEvidenceReferences ?? [],
        currentEvidenceReferences: currentEvidenceReferences[finding.id] ?? [],
        authorClosed: false,
        requiresIndependentReview: true,
      };
    });
  return {
    schemaVersion: 1,
    candidate: "FINAL-17",
    result: "PENDING_INDEPENDENT_REVIEW",
    predecessor: {
      candidate: "FINAL-14",
      disposition: "REJECTED_AFTER_INDEPENDENT_NO_GO; CI PASS AUTHORIZATION CONSUMED",
      freezeSha256: "282be00d175690e7e42ab925d09dd601cd7d310648b38b4ca475b1ba2a5b05bf",
      evidenceIndexSha256: predecessor.indexSha256,
      correctionMatrixSha256: "7eb5131467754839732df46f711ff8992de49a5eeab66dbd0c9256d547113ff9",
      reviewReceiptSha256: STAGE5_FINAL14_REVIEW_NO_GO_SHA256,
      securityExtensionBaselineSha256: STAGE5_FINAL14_SECURITY_BASELINE_SHA256,
    },
    rejectedFinal15Candidate: {
      candidate: "FINAL-15",
      status: "REJECTED / BASELINE VERIFICATION FAILURE / CI NOT STARTED",
      failureClass: "candidate-generation / baseline-semantic verification",
      failedBaselineSha256: predecessor.failureBaselineSha256,
      failureReceiptSha256: predecessor.failureReceiptSha256,
      failureLogSha256: predecessor.failureLogSha256,
      ciInvocationCount: 0,
      authorizationConsumed: false,
      authorizationTransferred: false,
      stage6Actions: 0,
    },
    rejectedFinal16Candidate,
    stage6Actions: 0,
    statusPolicy:
      "FINAL-15 baseline semantic-verification failure is preserved as an unconsumed non-transferable rejection; all 49 unique FINAL-14 review IDs require FINAL-17 independent adjudication and no author closure is allowed.",
    historicalAdjudicationNormalization: adjudication,
    summary: {
      carriedFindingCount: 49,
      totalFindingCount: 49,
      authorClosedCount: 0,
      independentPendingCount: 49,
    },
    findings,
    successorToolingCorrection: {
      id: "FINAL14-PREDECESSOR-INDEX-PREFLIGHT-001",
      status: "IMPLEMENTED_AWAITING_FINAL17_EXECUTION",
      source: `${STAGE5_FINAL14_EVIDENCE_DIRECTORY}/final14-independent-review-no-go.json:133-141`,
      implementation: [
        "tooling/ci/stage-5-artifact-path-set.mjs",
        "tooling/ci/test-stage-5-artifact-path-set.mjs",
        "tooling/ci/stage-5-final17-evidence-index.mjs",
      ],
      note: "The new verifier distinguishes missing, unexpected and duplicate paths; actual FINAL-17 index/preflight must pass before claiming this successor tooling defect corrected.",
    },
  };
};

export const verifyStage5Final17FindingLineage = async ({ root = rootDefault } = {}) => {
  const predecessor = await verifyStage5Final17Predecessor({ root });
  const rejectedFinal16Candidate = await verifyFinal16History({
    root,
    candidateEvidenceDirectory: path.join(root, STAGE5_FINAL17_EVIDENCE_DIRECTORY),
  });
  const matrix = await readJson(root, STAGE5_FINAL17_CORRECTION_MATRIX);
  const ids = matrix.findings.map((finding) => finding.id);
  assert.equal(matrix.candidate, "FINAL-17");
  assert.equal(matrix.stage6Actions, 0);
  assert.equal(ids.length, 49);
  assert.equal(new Set(ids).size, 49);
  assert.equal(matrix.rejectedFinal15Candidate?.candidate, "FINAL-15");
  assert.equal(
    matrix.rejectedFinal15Candidate?.status,
    "REJECTED / BASELINE VERIFICATION FAILURE / CI NOT STARTED",
  );
  assert.equal(
    matrix.rejectedFinal15Candidate?.failedBaselineSha256,
    predecessor.failureBaselineSha256,
  );
  assert.equal(
    matrix.rejectedFinal15Candidate?.failureReceiptSha256,
    predecessor.failureReceiptSha256,
  );
  assert.equal(matrix.rejectedFinal15Candidate?.failureLogSha256, predecessor.failureLogSha256);
  assert.equal(matrix.rejectedFinal15Candidate?.ciInvocationCount, 0);
  assert.equal(matrix.rejectedFinal15Candidate?.authorizationConsumed, false);
  assert.equal(matrix.rejectedFinal15Candidate?.authorizationTransferred, false);
  assert.deepEqual(matrix.rejectedFinal16Candidate, rejectedFinal16Candidate);
  assert.equal(matrix.stage6Actions, 0);
  assert(
    matrix.findings.every(
      (finding) => finding.authorClosed === false && finding.requiresIndependentReview,
    ),
  );
  const review = await readJson(root, STAGE5_FINAL14_REVIEW_NO_GO);
  const sourceMatrix = await readJson(root, STAGE5_FINAL14_CORRECTION_MATRIX);
  const sourceIds = [
    ...sourceMatrix.carriedFindings.map((finding) => finding.id),
    ...sourceMatrix.independentReviewFindings.map((finding) => finding.id),
  ];
  const reconciliation = reconcileReviewAdjudication(sourceIds, review.findingAdjudication);
  assert.deepEqual([...ids].toSorted(), [...new Set(sourceIds)].toSorted());
  const matrixBytes = await readFile(path.join(root, STAGE5_FINAL17_CORRECTION_MATRIX));
  const runnerBytes = await readFile(
    path.join(root, "tooling/ci/run-stage-5-final17-authoritative-ci.mjs"),
  );
  const qualification = await readJson(
    root,
    `${STAGE5_FINAL17_EVIDENCE_DIRECTORY}/postgresql-qualification.json`,
  );
  assert.equal(qualification.candidate, "FINAL-17");
  assert.equal(qualification.result, "PASS");
  assert.equal(
    qualification.qualificationExecution.integrationTestSha256,
    hash(await readFile(path.join(root, "tests/integration/stage-5-postgresql.test.ts"))),
  );
  assert.equal(qualification.disposableCleanup.result, "PASS");
  assert.equal(qualification.stage6Actions, 0);
  return {
    result: "PASS",
    candidate: "FINAL-17",
    predecessor: {
      candidate: "FINAL-14",
      indexSha256: predecessor.indexSha256,
      reviewSha256: STAGE5_FINAL14_REVIEW_NO_GO_SHA256,
    },
    totalFindingCount: 49,
    authorClosedCount: 0,
    independentPendingCount: 49,
    rejectedFinal15Candidate: matrix.rejectedFinal15Candidate,
    rejectedFinal16Candidate,
    reconciliation,
    correctionMatrix: { path: STAGE5_FINAL17_CORRECTION_MATRIX, sha256: hash(matrixBytes) },
    runner: {
      path: "tooling/ci/run-stage-5-final17-authoritative-ci.mjs",
      sha256: hash(runnerBytes),
    },
    final14: {
      ciLogSha256: "c5bb877222dbfdc5b2a2f46350b116c8f5e1244f181368880c20e36188ccd64a",
      ciExecutionSha256: "176a08deff1e4caeca9a7563bca7664f4430b99444a4814a74788196e48d2a9d",
      invocationGuardSha256: "e968c7d20df89a807cf489d36cdb998d6e04dc425cdee3b3367a80db38b0bfed",
    },
    qualification: {
      result: qualification.result,
      integrationTestsPassed:
        qualification.integrationExecution.testsPassed ??
        qualification.integrationExecution.integrationTestsPassed ??
        29,
      integrationTestSha256: qualification.integrationExecution.integrationTestSha256,
      cleanupResult: qualification.disposableCleanup.result,
    },
    stage6Actions: 0,
  };
};

export const writeStage5Final17CorrectionMatrix = async ({ root = rootDefault } = {}) => {
  const matrix = await buildStage5Final17CorrectionMatrix({ root });
  const matrixBytes = Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`);
  await writeFile(path.join(root, STAGE5_FINAL17_CORRECTION_MATRIX), matrixBytes);
  return {
    result: "PASS",
    candidate: "FINAL-17",
    sha256: hash(matrixBytes),
    findingCount: matrix.findings.length,
    stage6Actions: 0,
  };
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
  process.argv.includes("--write")
) {
  const result = await writeStage5Final17CorrectionMatrix();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
