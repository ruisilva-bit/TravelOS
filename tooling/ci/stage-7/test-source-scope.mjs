import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

let sourceScope;
try {
  sourceScope = await import("./source-scope.mjs");
} catch {
  sourceScope = null;
}
assert.ok(sourceScope, "Stage 7 source-scope module must exist");

const {
  evaluateStage7PriorEvidenceScope,
  loadStage7PriorCandidateDispositions,
  STAGE7_PRIOR_CANDIDATE_DISPOSITIONS_PATH,
  verifyStage7CandidateSourceScope,
} = sourceScope;
assert.equal(typeof evaluateStage7PriorEvidenceScope, "function");
assert.equal(typeof loadStage7PriorCandidateDispositions, "function");
assert.equal(typeof verifyStage7CandidateSourceScope, "function");

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const actualHistory = await loadStage7PriorCandidateDispositions({
  root: repositoryRoot,
  candidateGeneration: "gen09",
});
assert.deepEqual(
  actualHistory.priorCandidates.map(({ generation, candidateCommit }) => [
    generation,
    candidateCommit,
  ]),
  [
    ["gen01", "e9584c95ce16ef0f51c53dcff656b7d19277cf4e"],
    ["gen02", "d8fb5652880d3e1636a8e6ed9604bb1a232fe94e"],
    ["gen03", "30335fb81cb8d57dbcca08fb3dc16221a0a4f647"],
    ["gen04", "c2f8869cc80fa249cfbacaec70d07ef78ebce653"],
    ["gen05", "886462096c799aaf026a6f710a43fb84cb4d9722"],
    ["gen06", "ec51a8f0c724b77c863a17dbbd27c9510b9e7120"],
    ["gen07", "d8ae418ff825b59845b45b7fbf8b4dfa8c141d7d"],
    ["gen08", "0015a8e1be16195d3333a8c9dfe53c107f83c30b"],
  ],
);
assert.ok(
  actualHistory.priorCandidates
    .slice(0, 3)
    .every((candidate) => candidate.canonicalCiStatus === "NOT_RUN"),
);
assert.equal(actualHistory.priorCandidates[3].canonicalCiStatus, "FAIL");
assert.equal(actualHistory.priorCandidates[4].canonicalCiStatus, "PASS");
assert.equal(actualHistory.priorCandidates[5].canonicalCiStatus, "FAIL");
assert.equal(actualHistory.priorCandidates[6].canonicalCiStatus, "PASS");
assert.equal(actualHistory.priorCandidates[7].canonicalCiStatus, "NOT_RUN");
assert.equal(actualHistory.priorCandidates[7].canonicalCiReceipt, null);
const gen04CiEvidencePaths = [
  "docs/evidence/phase-1-m1/stage-7/gen04/canonical-ci-execution.json",
  "docs/evidence/phase-1-m1/stage-7/gen04/canonical-ci.log",
];
const priorCiEvidencePaths = [
  ...gen04CiEvidencePaths,
  "docs/evidence/phase-1-m1/stage-7/gen05/canonical-ci-execution.json",
  "docs/evidence/phase-1-m1/stage-7/gen05/canonical-ci.log",
  "docs/evidence/phase-1-m1/stage-7/gen06/canonical-ci-execution.json",
  "docs/evidence/phase-1-m1/stage-7/gen06/canonical-ci.log",
  "docs/evidence/phase-1-m1/stage-7/gen07/canonical-ci-execution.json",
  "docs/evidence/phase-1-m1/stage-7/gen07/canonical-ci.log",
];

const preFreeze = evaluateStage7PriorEvidenceScope({
  priorCandidates: actualHistory.priorCandidates,
  sourcePaths: priorCiEvidencePaths,
});
assert.equal(preFreeze.result, "PASS");
assert.deepEqual(preFreeze.requiredEvidencePaths, priorCiEvidencePaths);
assert.deepEqual(preFreeze.missingPaths, []);
assert.deepEqual(preFreeze.freezeEligibleGenerations, []);
assert.equal(preFreeze.candidateCount, 8);

const frozenValidationPath = "docs/evidence/phase-1-m1/stage-7/gen99/candidate-validation.json";
const frozenManifestPath = "docs/evidence/phase-1-m1/stage-7/gen99/candidate-freeze.json";
const frozenPredecessor = {
  generation: "gen99",
  lastPassedGate: "FINAL_CANDIDATE_SCAN",
  disposition: "FROZEN_AND_SCANNED",
  canonicalCiStatus: "NOT_RUN",
  canonicalCiReceipt: null,
  validationStatus: "CREATED",
  validationPath: frozenValidationPath,
  finalCandidateScan: "PASS",
  freezeStatus: "VERIFIED",
  freezePath: frozenManifestPath,
};
const frozen = evaluateStage7PriorEvidenceScope({
  priorCandidates: [frozenPredecessor],
  sourcePaths: [frozenValidationPath, frozenManifestPath],
});
assert.equal(frozen.result, "PASS");
assert.deepEqual(frozen.requiredEvidencePaths, [frozenManifestPath, frozenValidationPath]);
assert.deepEqual(frozen.missingPaths, []);
assert.deepEqual(frozen.freezeEligibleGenerations, ["gen99"]);

const missingFrozenInput = evaluateStage7PriorEvidenceScope({
  priorCandidates: [frozenPredecessor],
  sourcePaths: [frozenValidationPath],
});
assert.equal(missingFrozenInput.result, "FAIL");
assert.deepEqual(missingFrozenInput.missingPaths, [frozenManifestPath]);
assert.deepEqual(missingFrozenInput.freezeEligibleGenerations, []);

const duplicateFrozenInput = evaluateStage7PriorEvidenceScope({
  priorCandidates: [frozenPredecessor],
  sourcePaths: [frozenValidationPath, frozenManifestPath, frozenManifestPath],
});
assert.equal(duplicateFrozenInput.result, "FAIL");
assert.deepEqual(duplicateFrozenInput.freezeEligibleGenerations, []);

const rejectedFinalScan = evaluateStage7PriorEvidenceScope({
  priorCandidates: [
    {
      ...frozenPredecessor,
      finalCandidateScan: "FAIL",
      disposition: "FINAL_CANDIDATE_SCAN_FAILED",
    },
  ],
  sourcePaths: [frozenValidationPath, frozenManifestPath],
});
assert.equal(rejectedFinalScan.result, "PASS");
assert.deepEqual(rejectedFinalScan.requiredEvidencePaths, [
  frozenManifestPath,
  frozenValidationPath,
]);
assert.deepEqual(rejectedFinalScan.freezeEligibleGenerations, []);

const incompleteFinalCandidateScan = evaluateStage7PriorEvidenceScope({
  priorCandidates: [
    {
      ...frozenPredecessor,
      finalCandidateScan: "PASS",
      freezeStatus: "NOT_REACHED",
      freezePath: null,
    },
  ],
  sourcePaths: [frozenValidationPath],
});
assert.equal(incompleteFinalCandidateScan.result, "FAIL");
assert.ok(
  incompleteFinalCandidateScan.violations.includes(
    "gen99: a passing final-candidate scan requires validation and a verified freeze",
  ),
);

const missingValidation = evaluateStage7PriorEvidenceScope({
  priorCandidates: [
    {
      ...frozenPredecessor,
      validationStatus: "NOT_REACHED",
      validationPath: null,
    },
  ],
  sourcePaths: [frozenManifestPath],
});
assert.equal(missingValidation.result, "FAIL");
assert.ok(
  missingValidation.violations.includes("gen99: freeze requires a created validation document"),
);

const scopeFixtureRoot = await mkdtemp(
  path.join(process.env.TMPDIR ?? tmpdir(), "travelos-stage7-source-scope-"),
);
try {
  const copyRepositoryFile = async (relativePath) => {
    const targetPath = path.join(scopeFixtureRoot, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(path.join(repositoryRoot, relativePath), targetPath);
  };
  await copyRepositoryFile(STAGE7_PRIOR_CANDIDATE_DISPOSITIONS_PATH);
  for (const candidate of actualHistory.priorCandidates) {
    await copyRepositoryFile(candidate.baseline.path);
    await copyRepositoryFile(candidate.predecessorReceipts.stage6.path);
    await copyRepositoryFile(candidate.predecessorReceipts.stage7.path);
    if (candidate.canonicalCiReceipt) {
      await copyRepositoryFile(candidate.canonicalCiReceipt.path);
      await copyRepositoryFile(
        `docs/evidence/phase-1-m1/stage-7/${candidate.generation}/canonical-ci.log`,
      );
    }
    if (candidate.validationPath) await copyRepositoryFile(candidate.validationPath);
    if (candidate.freezePath) await copyRepositoryFile(candidate.freezePath);
  }

  const candidateGeneration = "gen09";
  const candidateCommit = "4".repeat(40);
  const baselinePath = "docs/reviews/phase-1-m1/STAGE_7_SUCCESSOR_BASELINE_GEN09.json";
  const newVerifierPaths = [
    "package.json",
    "tooling/ci/scan-source-secrets.mjs",
    "tooling/ci/stage-7/scan-predecessor-security.mjs",
    "tooling/ci/stage-7/test-predecessor-security-scan.mjs",
  ];
  const coveredSourcePaths = [
    STAGE7_PRIOR_CANDIDATE_DISPOSITIONS_PATH,
    ...newVerifierPaths,
    "tooling/ci/stage-7/source-scope.mjs",
    "tooling/ci/stage-7/test-source-scope.mjs",
    "tooling/ci/stage-7/verify-source-scope.mjs",
    "tooling/ci/stage-7/run-canonical-ci.mjs",
    "tooling/ci/stage-7/test-canonical-ci.mjs",
  ];
  const writeCandidateBaseline = async (sourcePaths) => {
    const baselineBytes = Buffer.from(
      `${JSON.stringify(
        {
          candidateGeneration,
          candidateCommit,
          stage8Actions: 0,
          sourceFiles: sourcePaths.map((filePath) => ({ path: filePath })),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const absoluteBaselinePath = path.join(scopeFixtureRoot, baselinePath);
    await mkdir(path.dirname(absoluteBaselinePath), { recursive: true });
    await writeFile(absoluteBaselinePath, baselineBytes);
    return createHash("sha256").update(baselineBytes).digest("hex");
  };

  const baselineSha256 = await writeCandidateBaseline(coveredSourcePaths);
  const candidateScope = await verifyStage7CandidateSourceScope({
    root: scopeFixtureRoot,
    candidateGeneration,
    candidateCommit,
    baselinePath,
    baselineSha256,
  });
  assert.equal(candidateScope.result, "PASS");
  assert.equal(candidateScope.candidateGeneration, candidateGeneration);
  assert.equal(candidateScope.candidateCount, 8);
  assert.deepEqual(candidateScope.requiredEvidencePaths, priorCiEvidencePaths);
  assert.deepEqual(candidateScope.freezeEligibleGenerations, []);
  assert.ok(/^[a-f0-9]{64}$/u.test(candidateScope.historySha256));

  const missingPredecessorScanSha256 = await writeCandidateBaseline(
    coveredSourcePaths.filter((sourcePath) => !newVerifierPaths.includes(sourcePath)),
  );
  const missingPredecessorScanScope = await verifyStage7CandidateSourceScope({
    root: scopeFixtureRoot,
    candidateGeneration,
    candidateCommit,
    baselinePath,
    baselineSha256: missingPredecessorScanSha256,
  });
  assert.equal(missingPredecessorScanScope.result, "FAIL");
  assert.ok(
    missingPredecessorScanScope.violations.includes(
      "candidate baseline does not bind the Stage 7 source-scope verifier",
    ),
  );

  const fixtureHistoryPath = path.join(scopeFixtureRoot, STAGE7_PRIOR_CANDIDATE_DISPOSITIONS_PATH);
  const fixtureHistory = JSON.parse(await readFile(fixtureHistoryPath, "utf8"));
  fixtureHistory.priorCandidates[0].canonicalCiStatus = "FAIL";
  fixtureHistory.priorCandidates[0].canonicalCiReceipt = null;
  await writeFile(fixtureHistoryPath, `${JSON.stringify(fixtureHistory, null, 2)}\n`);
  await assert.rejects(
    () => loadStage7PriorCandidateDispositions({ root: scopeFixtureRoot, candidateGeneration }),
    /gen01 canonical CI receipt reference is invalid/u,
  );

  const ciEvidenceDirectory = "docs/evidence/phase-1-m1/stage-7/gen01";
  const ciLogPath = `${ciEvidenceDirectory}/canonical-ci.log`;
  const ciReceiptPath = `${ciEvidenceDirectory}/canonical-ci-execution.json`;
  const ciFinalMarker = {
    schemaVersion: 1,
    stage: "PHASE_1_M1_STAGE_7",
    result: "FAIL",
    candidateGeneration: "gen01",
    candidateId: "travelos-phase-1-m1-stage-7-gen01",
    candidateCommit: fixtureHistory.priorCandidates[0].candidateCommit,
    artifactSha256: "b".repeat(64),
    completedGateCount: 1,
    expectedGateCount: 41,
    failedGate: "lint",
    stage8Actions: 0,
  };
  const ciLogBytes = Buffer.from(
    `TravelOS Stage 7 canonical CI\n\n=== TRAVELOS_STAGE7_CANONICAL_CI_RESULT ===\n${JSON.stringify(ciFinalMarker, null, 2)}\n`,
  );
  await mkdir(path.dirname(path.join(scopeFixtureRoot, ciLogPath)), { recursive: true });
  await writeFile(path.join(scopeFixtureRoot, ciLogPath), ciLogBytes);
  const ciReceipt = {
    stage: "PHASE_1_M1_STAGE_7",
    result: "FAIL",
    candidateGeneration: "gen01",
    candidateId: ciFinalMarker.candidateId,
    candidateCommit: ciFinalMarker.candidateCommit,
    artifactSha256: ciFinalMarker.artifactSha256,
    ciConsumed: "YES",
    invocationCount: 1,
    expectedGateCount: ciFinalMarker.expectedGateCount,
    completedGateCount: ciFinalMarker.completedGateCount,
    failedGate: ciFinalMarker.failedGate,
    stage8Actions: 0,
    logPath: ciLogPath,
    logBytes: ciLogBytes.length,
    logSha256: createHash("sha256").update(ciLogBytes).digest("hex"),
    finalMarker: ciFinalMarker,
  };
  const ciReceiptBytes = Buffer.from(`${JSON.stringify(ciReceipt, null, 2)}\n`);
  await writeFile(path.join(scopeFixtureRoot, ciReceiptPath), ciReceiptBytes);
  fixtureHistory.priorCandidates[0].canonicalCiReceipt = {
    path: ciReceiptPath,
    sha256: createHash("sha256").update(ciReceiptBytes).digest("hex"),
  };
  await writeFile(fixtureHistoryPath, `${JSON.stringify(fixtureHistory, null, 2)}\n`);
  const historyAfterConsumedCi = await loadStage7PriorCandidateDispositions({
    root: scopeFixtureRoot,
    candidateGeneration,
  });
  assert.equal(historyAfterConsumedCi.priorCandidates[0].canonicalCiStatus, "FAIL");
  const consumedCiScope = evaluateStage7PriorEvidenceScope({
    priorCandidates: historyAfterConsumedCi.priorCandidates,
    sourcePaths: [ciReceiptPath, ciLogPath, ...priorCiEvidencePaths],
  });
  assert.equal(consumedCiScope.result, "PASS");
  assert.deepEqual(
    consumedCiScope.requiredEvidencePaths,
    [ciReceiptPath, ciLogPath, ...priorCiEvidencePaths].toSorted(),
  );

  const incompleteBaselineSha256 = await writeCandidateBaseline([
    "tooling/ci/stage-7/prior-candidate-dispositions.json",
  ]);
  const incompleteCandidateScope = await verifyStage7CandidateSourceScope({
    root: scopeFixtureRoot,
    candidateGeneration,
    candidateCommit,
    baselinePath,
    baselineSha256: incompleteBaselineSha256,
  });
  assert.equal(incompleteCandidateScope.result, "FAIL");
  assert.ok(
    incompleteCandidateScope.violations.includes(
      "candidate baseline does not bind the Stage 7 source-scope verifier",
    ),
  );
} finally {
  await rm(scopeFixtureRoot, { recursive: true, force: true });
}

console.log(
  JSON.stringify({
    result: "PASS",
    cases: 13,
    preFreezePredecessors: preFreeze.candidateCount,
    frozenInputsRequired: frozen.requiredEvidencePaths.length,
    freezeEligible: frozen.freezeEligibleGenerations.length,
  }),
);
