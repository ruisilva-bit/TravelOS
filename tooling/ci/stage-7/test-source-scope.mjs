import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
const selectedHistory = await loadStage7PriorCandidateDispositions({
  root: repositoryRoot,
  candidateGeneration: "gen12",
});
assert.equal(selectedHistory.priorCandidates.length, 11);
assert.equal(selectedHistory.priorCandidates.at(-1).generation, "gen11");
assert.equal(selectedHistory.priorCandidates.at(-1).canonicalCiStatus, "INTERRUPTED");
assert.equal(
  selectedHistory.priorCandidates.at(-1).candidateCommit,
  "91b109493a9e462f7caea62e7d04c9a99e892cff",
);
assert.equal(selectedHistory.priorCandidates.at(-1).canonicalCiReceipt, null);
assert.equal(
  selectedHistory.priorCandidates.at(-1).canonicalCiInterruption.path,
  "docs/evidence/phase-1-m1/stage-7/gen11/canonical-ci-interruption.json",
);
const historicalGen09Root = await mkdtemp(
  path.join(process.env.TMPDIR ?? tmpdir(), "travelos-stage7-gen09-history-"),
);
const historicalHistoryBytes = execFileSync(
  "git",
  [
    "show",
    "0cf07d04e93171c1de6300629a3759ce888da6a7:tooling/ci/stage-7/prior-candidate-dispositions.json",
  ],
  { cwd: repositoryRoot },
);
let actualHistory;
try {
  const historicalHistoryPath = path.join(
    historicalGen09Root,
    STAGE7_PRIOR_CANDIDATE_DISPOSITIONS_PATH,
  );
  await mkdir(path.dirname(historicalHistoryPath), { recursive: true });
  await writeFile(historicalHistoryPath, historicalHistoryBytes);
  const historicalPriorCandidates = JSON.parse(
    historicalHistoryBytes.toString("utf8"),
  ).priorCandidates;
  const copyHistoricalInput = async (relativePath) => {
    const destinationPath = path.join(historicalGen09Root, relativePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(path.join(repositoryRoot, relativePath), destinationPath);
  };
  for (const candidate of historicalPriorCandidates) {
    await copyHistoricalInput(candidate.baseline.path);
    await copyHistoricalInput(candidate.predecessorReceipts.stage6.path);
    await copyHistoricalInput(candidate.predecessorReceipts.stage7.path);
    if (candidate.canonicalCiReceipt) {
      await copyHistoricalInput(candidate.canonicalCiReceipt.path);
      await copyHistoricalInput(
        `docs/evidence/phase-1-m1/stage-7/${candidate.generation}/canonical-ci.log`,
      );
    }
    if (candidate.validationPath) await copyHistoricalInput(candidate.validationPath);
    if (candidate.freezePath) await copyHistoricalInput(candidate.freezePath);
  }
  actualHistory = await loadStage7PriorCandidateDispositions({
    root: historicalGen09Root,
    candidateGeneration: "gen09",
  });
} finally {
  await rm(historicalGen09Root, { recursive: true, force: true });
}
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

const gen12PriorCiEvidencePaths = [
  ...priorCiEvidencePaths,
  "docs/evidence/phase-1-m1/stage-7/gen09/canonical-ci-execution.json",
  "docs/evidence/phase-1-m1/stage-7/gen09/canonical-ci.log",
  "docs/evidence/phase-1-m1/stage-7/gen10/canonical-ci-execution.json",
  "docs/evidence/phase-1-m1/stage-7/gen10/canonical-ci.log",
  "docs/evidence/phase-1-m1/stage-7/gen11/canonical-ci-interruption.json",
  "docs/evidence/phase-1-m1/stage-7/gen11/canonical-ci.log",
];
const gen12PreFreeze = evaluateStage7PriorEvidenceScope({
  priorCandidates: selectedHistory.priorCandidates,
  sourcePaths: gen12PriorCiEvidencePaths,
});
assert.equal(gen12PreFreeze.result, "PASS");
assert.equal(gen12PreFreeze.candidateCount, 11);
assert.ok(
  gen12PreFreeze.requiredEvidencePaths.includes(
    "docs/evidence/phase-1-m1/stage-7/gen11/canonical-ci-interruption.json",
  ),
);
assert.ok(
  gen12PreFreeze.requiredEvidencePaths.includes(
    "docs/evidence/phase-1-m1/stage-7/gen11/canonical-ci.log",
  ),
);
assert.ok(
  !gen12PreFreeze.requiredEvidencePaths.includes(
    "docs/evidence/phase-1-m1/stage-7/gen11/canonical-ci-execution.json",
  ),
);

const gen11InterruptionPath =
  "docs/evidence/phase-1-m1/stage-7/gen11/canonical-ci-interruption.json";
const gen11PartialLogPath = "docs/evidence/phase-1-m1/stage-7/gen11/canonical-ci.log";
const interruptedGen11 = {
  generation: "gen11",
  lastPassedGate: "stage7-source-scope:post",
  disposition: "CANONICAL_CI_INTERRUPTED_WITHOUT_FINAL_RESULT",
  canonicalCiStatus: "INTERRUPTED",
  canonicalCiReceipt: null,
  canonicalCiInterruption: {
    path: gen11InterruptionPath,
    sha256: "f".repeat(64),
  },
  validationStatus: "NOT_REACHED",
  validationPath: null,
  finalCandidateScan: "NOT_REACHED",
  freezeStatus: "NOT_REACHED",
  freezePath: null,
  stage8Actions: 0,
};
const interruptedScope = evaluateStage7PriorEvidenceScope({
  priorCandidates: [interruptedGen11],
  sourcePaths: [gen11InterruptionPath, gen11PartialLogPath],
});
assert.equal(interruptedScope.result, "PASS");
assert.deepEqual(
  interruptedScope.requiredEvidencePaths,
  [gen11InterruptionPath, gen11PartialLogPath].toSorted(),
);
assert.deepEqual(interruptedScope.missingPaths, []);
assert.deepEqual(interruptedScope.freezeEligibleGenerations, []);

const missingInterruptedRecord = evaluateStage7PriorEvidenceScope({
  priorCandidates: [interruptedGen11],
  sourcePaths: [gen11PartialLogPath],
});
assert.equal(missingInterruptedRecord.result, "FAIL");
assert.deepEqual(missingInterruptedRecord.missingPaths, [gen11InterruptionPath]);
assert.deepEqual(missingInterruptedRecord.freezeEligibleGenerations, []);

const interruptedWithReceipt = evaluateStage7PriorEvidenceScope({
  priorCandidates: [
    {
      ...interruptedGen11,
      canonicalCiReceipt: {
        path: "docs/evidence/phase-1-m1/stage-7/gen11/canonical-ci-execution.json",
        sha256: "e".repeat(64),
      },
    },
  ],
  sourcePaths: [gen11InterruptionPath, gen11PartialLogPath],
});
assert.equal(interruptedWithReceipt.result, "FAIL");
assert.ok(
  interruptedWithReceipt.violations.includes(
    "gen11: interrupted canonical CI must not have an execution receipt",
  ),
);
assert.deepEqual(interruptedWithReceipt.freezeEligibleGenerations, []);

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
  const historicalFixtureHistoryPath = path.join(
    scopeFixtureRoot,
    STAGE7_PRIOR_CANDIDATE_DISPOSITIONS_PATH,
  );
  await mkdir(path.dirname(historicalFixtureHistoryPath), { recursive: true });
  await writeFile(historicalFixtureHistoryPath, historicalHistoryBytes);
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

  const interruptionPath = `${ciEvidenceDirectory}/canonical-ci-interruption.json`;
  const candidate = fixtureHistory.priorCandidates[0];
  const partialLogBytes = Buffer.from(
    [
      "TravelOS Stage 7 canonical CI",
      "Candidate: travelos-phase-1-m1-stage-7-gen01",
      `Commit: ${candidate.candidateCommit}`,
      `Artifact SHA-256: ${candidate.artifact.sha256}`,
      "",
      "=== TravelOS Stage 7 CI gate: lint ===",
      JSON.stringify({ result: "PASS" }),
      "",
    ].join(String.fromCharCode(10)),
  );
  await writeFile(path.join(scopeFixtureRoot, ciLogPath), partialLogBytes);
  await rm(path.join(scopeFixtureRoot, ciReceiptPath), { force: true });
  const partialLogSha256 = createHash("sha256").update(partialLogBytes).digest("hex");
  const interruptionRecord = {
    schemaVersion: 1,
    recordType: "TRAVELOS_STAGE7_CANONICAL_CI_INTERRUPTION",
    stage: "PHASE_1_M1_STAGE_7",
    result: "INTERRUPTED",
    candidateGeneration: "gen01",
    candidateId: "travelos-phase-1-m1-stage-7-gen01",
    candidateCommit: candidate.candidateCommit,
    artifactSha256: candidate.artifact.sha256,
    baseline: candidate.baseline,
    execution: {
      command: "node tooling/ci/stage-7/run-canonical-ci.mjs --generation=gen01",
      invocationCount: 1,
      terminationKind: "TERMINAL_TOOL_TIMEOUT",
      requestedTimeoutSeconds: 600,
      reportedTimeoutSeconds: 420,
      sessionId: "fixture-session",
      toolCallId: "fixture-call",
    },
    oneShotState: {
      claim: {
        path: ".hermes/state/stage7-gen01-canonical-ci-claim.json",
        sha256: "a".repeat(64),
        state: "RUNNING",
        invocationCount: 1,
      },
      guard: {
        path: ".hermes/state/stage7-gen01-canonical-ci-guard.json",
        sha256: "b".repeat(64),
        state: "ARMED",
        invocationCount: 0,
        ciConsumed: "NO",
      },
    },
    partialLog: {
      path: ciLogPath,
      bytes: partialLogBytes.length,
      sha256: partialLogSha256,
      completedGateCount: 1,
      expectedGateCount: 42,
      lastCompletedGate: "lint",
    },
    finalMarkerPresent: false,
    executionReceiptPresent: false,
    stage8Actions: 0,
  };
  const interruptionBytes = Buffer.from(JSON.stringify(interruptionRecord, null, 2));
  await writeFile(path.join(scopeFixtureRoot, interruptionPath), interruptionBytes);
  fixtureHistory.schemaVersion = 2;
  candidate.canonicalCiStatus = "INTERRUPTED";
  candidate.canonicalCiReceipt = null;
  candidate.canonicalCiInterruption = {
    path: interruptionPath,
    sha256: createHash("sha256").update(interruptionBytes).digest("hex"),
  };
  await writeFile(fixtureHistoryPath, JSON.stringify(fixtureHistory, null, 2));
  const historyAfterInterruptedCi = await loadStage7PriorCandidateDispositions({
    root: scopeFixtureRoot,
    candidateGeneration,
  });
  assert.equal(historyAfterInterruptedCi.priorCandidates[0].canonicalCiStatus, "INTERRUPTED");
  const interruptedCandidateBaselineSha256 = await writeCandidateBaseline(coveredSourcePaths);
  const interruptedCandidateScope = await verifyStage7CandidateSourceScope({
    root: scopeFixtureRoot,
    candidateGeneration,
    candidateCommit,
    baselinePath,
    baselineSha256: interruptedCandidateBaselineSha256,
  });
  assert.equal(interruptedCandidateScope.result, "PASS");
  assert.deepEqual(
    interruptedCandidateScope.requiredEvidencePaths,
    [interruptionPath, ciLogPath, ...priorCiEvidencePaths].toSorted(),
  );
  assert.ok(!interruptedCandidateScope.requiredEvidencePaths.includes(ciReceiptPath));

  await writeFile(path.join(scopeFixtureRoot, ciReceiptPath), "{}");
  await assert.rejects(
    () => loadStage7PriorCandidateDispositions({ root: scopeFixtureRoot, candidateGeneration }),
    /gen01 interrupted canonical CI must not have a canonical CI receipt file/u,
  );
  await rm(path.join(scopeFixtureRoot, ciReceiptPath), { force: true });

  const originalPartialLog = { ...interruptionRecord.partialLog };
  const markedLogBytes = Buffer.from(
    `${partialLogBytes.toString("utf8")}=== TRAVELOS_STAGE7_CANONICAL_CI_RESULT ===`,
  );
  interruptionRecord.partialLog.bytes = markedLogBytes.length;
  interruptionRecord.partialLog.sha256 = createHash("sha256").update(markedLogBytes).digest("hex");
  await writeFile(path.join(scopeFixtureRoot, ciLogPath), markedLogBytes);
  const markedInterruptionBytes = Buffer.from(JSON.stringify(interruptionRecord, null, 2));
  await writeFile(path.join(scopeFixtureRoot, interruptionPath), markedInterruptionBytes);
  candidate.canonicalCiInterruption.sha256 = createHash("sha256")
    .update(markedInterruptionBytes)
    .digest("hex");
  await writeFile(fixtureHistoryPath, JSON.stringify(fixtureHistory, null, 2));
  await assert.rejects(
    () => loadStage7PriorCandidateDispositions({ root: scopeFixtureRoot, candidateGeneration }),
    /gen01 interrupted canonical CI log contains a final result marker/u,
  );

  Object.assign(interruptionRecord.partialLog, originalPartialLog);
  await writeFile(path.join(scopeFixtureRoot, ciLogPath), partialLogBytes);
  await writeFile(path.join(scopeFixtureRoot, interruptionPath), interruptionBytes);
  candidate.canonicalCiInterruption.sha256 = createHash("sha256")
    .update(interruptionBytes)
    .digest("hex");
  await writeFile(fixtureHistoryPath, JSON.stringify(fixtureHistory, null, 2));

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
    cases: 19,
    preFreezePredecessors: preFreeze.candidateCount,
    frozenInputsRequired: frozen.requiredEvidencePaths.length,
    freezeEligible: frozen.freezeEligibleGenerations.length,
  }),
);
