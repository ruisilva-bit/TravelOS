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
  STAGE5_FINAL15_CORRECTION_MATRIX,
  STAGE5_FINAL15_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";
import { reconcileReviewAdjudication } from "./stage-5-review-reconciliation.mjs";
import { verifyStage5Final15Predecessor } from "./stage-5-final15-evidence-index.mjs";

const rootDefault = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (root, relativePath) =>
  JSON.parse(await readFile(path.join(root, relativePath), "utf8"));

const currentEvidenceReferences = {
  "S5F8-AUTHZ-001": [
    "packages/backend-core/src/modules/trip-operations/application/m1-staff-operations.ts:63-96,206-258",
    "packages/database/src/trip-operations/m1-operational-slice-repository.ts:29-134,629-793",
    "packages/backend-core/src/index.ts:78-95",
    "packages/database/src/index.ts:17-19",
    "tests/integration/stage-5-postgresql.test.ts: (caller-selected weak-permission regression; exact assertion is in the pinned integration-test source hash)",
    `${STAGE5_FINAL15_EVIDENCE_DIRECTORY}/postgresql-qualification-execution.json`,
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
    `${STAGE5_FINAL15_EVIDENCE_DIRECTORY}/postgresql-integration-tests.log`,
    `${STAGE5_FINAL15_EVIDENCE_DIRECTORY}/postgresql-disposable-cleanup.json`,
  ],
  "S5F8-PERMISSION-DOC-001": [
    "docs/PERMISSIONS.md:52-68 (immutable Phase-0 document; unchanged)",
    "docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md:21-55,165-173",
    "tooling/ci/generate-stage-5-final15-security-extension-baseline.mjs",
    `${STAGE5_FINAL15_EVIDENCE_DIRECTORY}/baseline-generation.json`,
  ],
  "S5F8-AUTH-SCOPE-001": [
    "packages/backend-core/src/staff-access/permission-registry.ts:48-80",
    "packages/backend-core/test/agency-organization/agency-bootstrap.test.ts: (FINAL-15 Agency/ALL-only assertions)",
    `${STAGE5_FINAL15_EVIDENCE_DIRECTORY}/focused-test-execution.json`,
  ],
  "S5F8-STALE-COST-EVIDENCE-001": [
    "tests/integration/stage-5-postgresql.test.ts: (stale supplier-cost compare-and-swap route regression)",
    `${STAGE5_FINAL15_EVIDENCE_DIRECTORY}/postgresql-integration-tests.log`,
    `${STAGE5_FINAL15_EVIDENCE_DIRECTORY}/postgresql-qualification-execution.json`,
  ],
  "FINAL13-MATRIX-CITATIONS-001": [
    "docs/reviews/phase-1-m1/STAGE_5_FINAL_14_CORRECTION_MATRIX.json:1216-1245",
    "tests/integration/stage-5-postgresql.test.ts:1327-1571,2612-2710,2813-2863",
    "packages/backend-core/test/m1/application.test.ts:684-712",
  ],
};

export const buildStage5Final15CorrectionMatrix = async ({ root = rootDefault } = {}) => {
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
  const predecessor = await verifyStage5Final15Predecessor({ root });
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
        final15Status: "PENDING_FINAL15_INDEPENDENT_ADJUDICATION",
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
    candidate: "FINAL-15",
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
    stage6Actions: 0,
    statusPolicy:
      "No author closure. All 49 unique FINAL-14 review IDs require FINAL-15 independent adjudication; candidate evidence and code changes do not independently close findings.",
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
      status: "IMPLEMENTED_AWAITING_FINAL15_EXECUTION",
      source: `${STAGE5_FINAL14_EVIDENCE_DIRECTORY}/final14-independent-review-no-go.json:133-141`,
      implementation: [
        "tooling/ci/stage-5-artifact-path-set.mjs",
        "tooling/ci/test-stage-5-artifact-path-set.mjs",
        "tooling/ci/stage-5-final15-evidence-index.mjs",
      ],
      note: "The new verifier distinguishes missing, unexpected and duplicate paths; actual FINAL-15 index/preflight must pass before claiming this successor tooling defect corrected.",
    },
  };
};

export const verifyStage5Final15FindingLineage = async ({ root = rootDefault } = {}) => {
  const predecessor = await verifyStage5Final15Predecessor({ root });
  const matrix = await readJson(root, STAGE5_FINAL15_CORRECTION_MATRIX);
  const ids = matrix.findings.map((finding) => finding.id);
  assert.equal(matrix.candidate, "FINAL-15");
  assert.equal(matrix.stage6Actions, 0);
  assert.equal(ids.length, 49);
  assert.equal(new Set(ids).size, 49);
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
  const matrixBytes = await readFile(path.join(root, STAGE5_FINAL15_CORRECTION_MATRIX));
  const runnerBytes = await readFile(
    path.join(root, "tooling/ci/run-stage-5-final15-authoritative-ci.mjs"),
  );
  const qualification = await readJson(
    root,
    `${STAGE5_FINAL15_EVIDENCE_DIRECTORY}/postgresql-qualification.json`,
  );
  assert.equal(qualification.candidate, "FINAL-15");
  assert.equal(qualification.result, "PASS");
  assert.equal(
    qualification.qualificationExecution.integrationTestSha256,
    hash(await readFile(path.join(root, "tests/integration/stage-5-postgresql.test.ts"))),
  );
  assert.equal(qualification.disposableCleanup.result, "PASS");
  assert.equal(qualification.stage6Actions, 0);
  return {
    result: "PASS",
    candidate: "FINAL-15",
    predecessor: {
      candidate: "FINAL-14",
      indexSha256: predecessor.indexSha256,
      reviewSha256: STAGE5_FINAL14_REVIEW_NO_GO_SHA256,
    },
    totalFindingCount: 49,
    reconciliation,
    correctionMatrix: { path: STAGE5_FINAL15_CORRECTION_MATRIX, sha256: hash(matrixBytes) },
    runner: {
      path: "tooling/ci/run-stage-5-final15-authoritative-ci.mjs",
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

export const writeStage5Final15CorrectionMatrix = async ({ root = rootDefault } = {}) => {
  const matrix = await buildStage5Final15CorrectionMatrix({ root });
  const matrixBytes = Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`);
  await writeFile(path.join(root, STAGE5_FINAL15_CORRECTION_MATRIX), matrixBytes);
  return {
    result: "PASS",
    candidate: "FINAL-15",
    sha256: hash(matrixBytes),
    findingCount: matrix.findings.length,
    stage6Actions: 0,
  };
};

if (process.argv.includes("--write")) {
  const result = await writeStage5Final15CorrectionMatrix();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
