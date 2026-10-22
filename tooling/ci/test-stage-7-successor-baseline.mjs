import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import * as stage7 from "./stage-7-successor-baseline.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytewise = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
assert.equal(stage7.STAGE7_DEFAULT_GENERATION, "gen13");
assert.equal(
  stage7.stage7ExtensionPathFor("gen13"),
  "deploy/contracts/stage-7-extension.v2-gen13.json",
);
assert.equal(
  stage7.stage7AuthorizedPathsPathFor("gen09"),
  "docs/reviews/phase-1-m1/stage-7/STAGE_7_AUTHORIZED_PATHS.json",
);
assert.equal(
  stage7.stage7AuthorizedPathsPathFor("gen10"),
  "docs/reviews/phase-1-m1/stage-7/STAGE_7_AUTHORIZED_PATHS_GEN10.json",
);
assert.equal(
  stage7.stage7AuthorizedPathsPathFor("gen11"),
  "docs/reviews/phase-1-m1/stage-7/STAGE_7_AUTHORIZED_PATHS_GEN11.json",
);
assert.equal(
  stage7.stage7AuthorizedPathsPathFor("gen12"),
  "docs/reviews/phase-1-m1/stage-7/STAGE_7_AUTHORIZED_PATHS_GEN12.json",
);
assert.equal(stage7.stage7ExtensionPathFor("gen09"), "deploy/contracts/stage-7-extension.v1.json");
assert.equal(stage7.stage7ExtensionPathFor("gen10"), "deploy/contracts/stage-7-extension.v2.json");
assert.equal(
  stage7.stage7ExtensionPathFor("gen11"),
  "deploy/contracts/stage-7-extension.v2-gen11.json",
);
assert.equal(
  stage7.stage7ExtensionPathFor("gen12"),
  "deploy/contracts/stage-7-extension.v2-gen12.json",
);
assert.equal(
  stage7.stage7ExtensionArtifactPathFor("gen10"),
  "deployment/stage-7-extension.v2.json",
);
assert.equal(
  stage7.stage7ExtensionArtifactPathFor("gen11"),
  "deployment/stage-7-extension.v2.json",
);
assert.equal(
  stage7.stage7ExtensionArtifactPathFor("gen12"),
  "deployment/stage-7-extension.v2.json",
);
const authorizedPathsDocument = JSON.parse(
  await readFile(
    new URL("../../docs/reviews/phase-1-m1/stage-7/STAGE_7_AUTHORIZED_PATHS.json", import.meta.url),
    "utf8",
  ),
);
const legacyContractBytes = await readFile(
  new URL("../../deploy/contracts/stage-7-extension.v1.json", import.meta.url),
);
const successorContractBytes = await readFile(
  new URL("../../deploy/contracts/stage-7-extension.v2.json", import.meta.url),
);
const gen11SuccessorContractBytes = await readFile(
  new URL("../../deploy/contracts/stage-7-extension.v2-gen11.json", import.meta.url),
);
const gen12SuccessorContractBytes = await readFile(
  new URL("../../deploy/contracts/stage-7-extension.v2-gen12.json", import.meta.url),
);
const gen12SuccessorContract = JSON.parse(gen12SuccessorContractBytes.toString("utf8"));
assert.deepEqual(gen12SuccessorContract.candidate, {
  generation: "gen12",
  sourceBranch: "stage7/runtime-acceptance-cleanup-successor",
  artifactIdPrefix: "travelos-phase-1-m1-stage-7-gen12-",
  successorBaselinePath: "docs/reviews/phase-1-m1/STAGE_7_SUCCESSOR_BASELINE_GEN12.json",
});
assert.equal(
  gen12SuccessorContract.artifact.successorBaselinePath,
  "provenance/stage7-successor-baseline-gen12.json",
);
const successorImplementationDocument = await readFile(
  new URL(
    "../../docs/implementation/M1_STAGE_7_RUNTIME_ACCEPTANCE_CLEANUP_SUCCESSOR.md",
    import.meta.url,
  ),
  "utf8",
);
const successorDecisionDocument = await readFile(
  new URL("../../docs/reviews/phase-1-m1/stage-7/GEN11_PO_DECISION_ADJUSTMENT.md", import.meta.url),
  "utf8",
);
const requiredCleanupExtensionMarkers = [
  "Stage 7 Runtime Acceptance Cleanup Successor",
  "POST /api/admin/runtime-acceptance-fixtures/:fixtureRunId/cleanup",
  "DEVELOPMENT_ONLY",
  "EXACT_DEVELOPMENT_MANIFEST_ALLOWLIST",
  "EXISTING_ADMIN_API",
  "runtime_acceptance.fixture.manage",
  "same Agency",
  "creator",
  "registered fixture run",
  "recent MFA",
  "immutable publication snapshots",
  "audit/outbox history",
  "0013_stage7_runtime_acceptance_cleanup.cjs",
  "CHECKSUM_MANIFEST_AND_SUCCESSOR_SOURCE_BASELINE",
  "Stage 7 actions = 1",
  "Stage 8 actions = 0",
];
const requiredGen11DecisionMarkers = [
  "Product Owner decision adjustment",
  "Rui approved the narrow DEVELOPMENT cleanup route on the existing Admin API listener.",
  "Immutable publication snapshots and audit/outbox history remain retained.",
  "Candidate rollover only; no product-scope expansion.",
  "Stage 8 actions = 0",
];
const gen12DecisionDocument = await readFile(
  new URL("../../docs/reviews/phase-1-m1/stage-7/GEN12_PO_DECISION_ADJUSTMENT.md", import.meta.url),
  "utf8",
);
const requiredGen12DecisionMarkers = [
  "Product Owner decision adjustment",
  "Rui explicitly authorized one additional successor, gen12, and exactly one monitored canonical-CI invocation",
  "Gen11 remains `INTERRUPTED`",
  "does not authorize gen13",
  "Stage 8 actions = 0",
];
assert.deepEqual(
  {
    extension: requiredCleanupExtensionMarkers.filter(
      (marker) => !successorImplementationDocument.includes(marker),
    ),
    decision: requiredGen11DecisionMarkers.filter(
      (marker) => !successorDecisionDocument.includes(marker),
    ),
  },
  { extension: [], decision: [] },
  "The gen11 implementation and carried-forward decision document must satisfy every verifier marker",
);
assert.deepEqual(
  requiredGen12DecisionMarkers.filter((marker) => !gen12DecisionDocument.includes(marker)),
  [],
  "The gen12 decision record must bind the one-time CI authorization and preserve the prior interruption",
);
const gen09BaselineBytes = await readFile(
  new URL("../../docs/reviews/phase-1-m1/STAGE_7_SUCCESSOR_BASELINE_GEN09.json", import.meta.url),
);
const gen09CanonicalCiReceiptBytes = await readFile(
  new URL(
    "../../docs/evidence/phase-1-m1/stage-7/gen09/canonical-ci-execution.json",
    import.meta.url,
  ),
);
const gen09Stage6Receipt = JSON.parse(
  await readFile(
    new URL(
      "../../docs/reviews/phase-1-m1/stage-7/GEN09_STAGE6_PREDECESSOR_BASELINE_VERIFY.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
assert.deepEqual(
  authorizedPathsDocument,
  stage7.STAGE7_AUTHORIZED_PATHS_V1,
  "The historical gen09 authorized-path document must match its immutable v1 allowlist",
);
const gen11AuthorizedPathsDocument = JSON.parse(
  await readFile(
    new URL(
      "../../docs/reviews/phase-1-m1/stage-7/STAGE_7_AUTHORIZED_PATHS_GEN11.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const gen12AuthorizedPathsDocument = JSON.parse(
  await readFile(
    new URL(
      "../../docs/reviews/phase-1-m1/stage-7/STAGE_7_AUTHORIZED_PATHS_GEN12.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
assert.deepEqual(
  stage7.stage7AuthorizedPathsFor("gen11"),
  gen11AuthorizedPathsDocument,
  "The historical gen11 authorized-path document must remain bound to its own allowlist",
);
assert.deepEqual(
  stage7.stage7AuthorizedPathsFor("gen12"),
  gen12AuthorizedPathsDocument,
  "The gen12 authorized-path document must exactly match the verifier-owned v2 allowlist",
);
const gen13AuthorizedPathsDocument = JSON.parse(
  await readFile(
    new URL(
      "../../docs/reviews/phase-1-m1/stage-7/STAGE_7_AUTHORIZED_PATHS_GEN13.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
assert.deepEqual(stage7.STAGE7_AUTHORIZED_PATHS, gen13AuthorizedPathsDocument);
assert.ok(
  stage7.STAGE7_AUTHORIZED_PATHS.exactSourceFiles.includes(
    "deploy/contracts/stage-7-extension.v2-gen12.json",
  ),
);
assert.equal(stage7.stage7AuthorizedPathsFor("gen10").candidateGeneration, "gen10");
assert.equal(stage7.stage7AuthorizedPathsFor("gen11").candidateGeneration, "gen11");
assert.equal(stage7.stage7AuthorizedPathsFor("gen12").candidateGeneration, "gen12");
assert.ok(
  stage7
    .stage7AuthorizedPathsFor("gen10")
    .exactSourceFiles.includes("deploy/contracts/stage-7-extension.v2.json"),
);
assert.ok(
  !stage7
    .stage7AuthorizedPathsFor("gen10")
    .exactSourceFiles.includes("deploy/contracts/stage-7-extension.v2-gen11.json"),
);
assert.ok(
  stage7
    .stage7AuthorizedPathsFor("gen11")
    .exactSourceFiles.includes("deploy/contracts/stage-7-extension.v2-gen11.json"),
);
assert.ok(
  stage7
    .stage7AuthorizedPathsFor("gen11")
    .exactSourceFiles.includes("deploy/contracts/stage-7-extension.v2.json"),
  "Gen11 authorization must retain gen10's source contract as historical candidate input",
);
assert.ok(
  stage7
    .stage7AuthorizedPathsFor("gen12")
    .exactSourceFiles.includes("deploy/contracts/stage-7-extension.v2-gen11.json"),
  "Gen12 authorization must retain gen11's source contract as historical candidate input",
);
assert.ok(
  stage7
    .stage7AuthorizedPathsFor("gen12")
    .exactSourceFiles.includes("deploy/contracts/stage-7-extension.v2-gen12.json"),
  "Gen12 authorization must include its generation-specific active contract",
);
const currentHistory = JSON.parse(
  await readFile(
    new URL("../../tooling/ci/stage-7/prior-candidate-dispositions.json", import.meta.url),
    "utf8",
  ),
);
const failedGen10 = currentHistory.priorCandidates.find(({ generation }) => generation === "gen10");
const interruptedGen11 = currentHistory.priorCandidates.find(
  ({ generation }) => generation === "gen11",
);
assert.equal(currentHistory.candidateGeneration, "gen13");
assert.equal(currentHistory.priorCandidates.at(-1).generation, "gen12");
assert.equal(currentHistory.priorCandidates.at(-1).canonicalCiStatus, "PASS");
assert.equal(interruptedGen11.generation, "gen11");
assert.equal(interruptedGen11.canonicalCiStatus, "INTERRUPTED");
assert.equal(interruptedGen11.canonicalCiReceipt, null);
assert.equal(
  interruptedGen11.canonicalCiInterruption.path,
  "docs/evidence/phase-1-m1/stage-7/gen11/canonical-ci-interruption.json",
);
assert.equal(failedGen10.generation, "gen10");
assert.equal(failedGen10.candidateCommit, "0670b9ff46b2870ee97b118181f7d0136c566b54");
assert.equal(
  failedGen10.baseline.sha256,
  "8435480b3fc053e27d1921d024dc81d523bb78fd18172b61bb9b5dd6575b092e",
);
assert.equal(
  failedGen10.artifact.sha256,
  "4f628985cb0b726597b032ca921b059d46ce883d223b62c1fe94729a5e546417",
);
assert.equal(failedGen10.canonicalCiStatus, "FAIL");
assert.equal(
  failedGen10.canonicalCiReceipt.sha256,
  "2a6696ed345e076ca63ce49f88ee6a4cc4d90815681433cdeb2b639af71f7f40",
);
const aggregate = (rows) =>
  sha256(rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join(""));

const PREDECESSOR_FIXTURE = {
  tag: "travelos-phase-1-m1-stage-6-gen07-revision-04-go",
  commit: "6242e023953ccb8fe883bff97a0d62e64af8b66a",
  annotatedTagObject: "8d951cbf739a69695ea98e2a31b5532ee0b0d951",
  stage6SourceBaseline: {
    path: "docs/reviews/phase-1-m1/STAGE_6_SUCCESSOR_BASELINE_GENERATION_07_REVISION_03.json",
    sha256: "bb8890cacb720d43360997ff0e5c5ac0c6fa945b3dc5f87fb298d80c6e4e1695",
    sourceCount: 61,
    sourceAggregateSha256: "a736add8226933ac9d2a78268357dd654d16322f722fe377cdb28bbd9a8cde6b",
  },
  stage6CandidateFreeze: {
    path: "docs/reviews/phase-1-m1/stage-6/GEN07_REVISION_04_CANDIDATE_FREEZE.json",
    sha256: "df844f6ac08adca1779bde325f9b1da9c134396c38ec8448cf13d718e4286ebc",
  },
  stage6IndependentReview: {
    path: "docs/reviews/phase-1-m1/stage-6/GEN07_REVISION_04_INDEPENDENT_REVIEW.json",
    sha256: "0c899b6696749075d8c5de7db66df6f92351896e10457cc5ba15f23a2db792b4",
  },
  stage6FinalDecision: {
    path: "docs/reviews/phase-1-m1/stage-6/GEN07_REVISION_04_FINAL_DECISION.json",
    sha256: "f7d51f7eac9ed194f3f1ada129d61bb6467f7cb02c9b4886d43f321bc55ed571",
  },
  stage6Verification: {
    result: "PASS",
    branch: "phase-1/stage-6",
    sourceCommit: "6242e023953ccb8fe883bff97a0d62e64af8b66a",
    stage6BaselinePath:
      "docs/reviews/phase-1-m1/STAGE_6_SUCCESSOR_BASELINE_GENERATION_07_REVISION_03.json",
    stage6BaselineSha256: "bb8890cacb720d43360997ff0e5c5ac0c6fa945b3dc5f87fb298d80c6e4e1695",
    sourceCount: 61,
    sourceAggregateSha256: "a736add8226933ac9d2a78268357dd654d16322f722fe377cdb28bbd9a8cde6b",
    predecessor: {
      result: "PASS",
      tag: "phase-1-stage-5-go",
      commit: "8dd62157d14e88400a9df1e97452a3807f3ed50e",
      phase0BaselineSha256: "bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb",
      stage5BaselineSha256: "ff41985b197738faa9585af2b4686612d420a9c118801a801c8d38087f1d29b6",
      stage5ProtectedFileCount: 38,
      stage5AggregateSha256: "decc422c49ab17d44e700331b95ac3fdf0bee8d6058b244682ecdc6ab8940255",
      stage6Actions: 0,
    },
    stage6Actions: 1,
    stage7Actions: 0,
  },
};
const PREDECESSOR_RECEIPT_FIXTURE = {
  schemaVersion: 1,
  result: "PASS",
  branch: "phase-1/stage-6",
  sourceCommit: "6242e023953ccb8fe883bff97a0d62e64af8b66a",
  stage6BaselinePath:
    "docs/reviews/phase-1-m1/STAGE_6_SUCCESSOR_BASELINE_GENERATION_07_REVISION_03.json",
  stage6BaselineSha256: "bb8890cacb720d43360997ff0e5c5ac0c6fa945b3dc5f87fb298d80c6e4e1695",
  sourceCount: 61,
  sourceAggregateSha256: "a736add8226933ac9d2a78268357dd654d16322f722fe377cdb28bbd9a8cde6b",
  predecessor: PREDECESSOR_FIXTURE.stage6Verification.predecessor,
  stage6Actions: 1,
  stage7Actions: 0,
};

const extensionText = Buffer.from(
  [
    "TripAccessGrant",
    "trip.access.manage",
    "trip.view_current",
    "authorization epoch",
    "Grant revocation increments that Portal principal's authorization epoch",
    "Portal sessions carry and check the epoch",
    "PortalTripSnapshotV1",
    "0012_stage7_portal_trip_access.cjs",
    "travelos_portal_api",
    "travelos_portal_runtime",
    "travelos_migrator",
    "travelos_owner",
    "6242e023953ccb8fe883bff97a0d62e64af8b66a",
    "travelos-phase-1-m1-stage-6-gen07-revision-04-go",
    "8d951cbf739a69695ea98e2a31b5532ee0b0d951",
    "INTERNAL_ONLY",
    "No Better Auth runtime migrations",
    "Stage 7 actions = 1",
    "Stage 8 actions = 0",
  ].join("\n") + "\n",
);
const successorExtensionText = Buffer.from(
  [
    "Stage 7 Runtime Acceptance Cleanup Successor",
    "POST /api/admin/runtime-acceptance-fixtures/:fixtureRunId/cleanup",
    "DEVELOPMENT_ONLY",
    "EXACT_DEVELOPMENT_MANIFEST_ALLOWLIST",
    "EXISTING_ADMIN_API",
    "runtime_acceptance.fixture.manage",
    "same Agency",
    "creator",
    "registered fixture run",
    "recent MFA",
    "immutable publication snapshots",
    "audit/outbox history",
    "0013_stage7_runtime_acceptance_cleanup.cjs",
    "CHECKSUM_MANIFEST_AND_SUCCESSOR_SOURCE_BASELINE",
    "Stage 7 actions = 1",
    "Stage 8 actions = 0",
  ].join("\n") + "\n",
);
const successorDecisionText = Buffer.from(
  [
    "Product Owner decision adjustment — 2026-10-20",
    "Rui approved the narrow DEVELOPMENT cleanup route on the existing Admin API listener.",
    "Immutable publication snapshots and audit/outbox history remain retained.",
    "Stage 8 actions = 0",
  ].join("\n") + "\n",
);
const sourceText = Buffer.from("export const stage7BaselineFixture = true;\n");

const makeFixture = (generation = "gen01") => {
  const authorizedPaths = stage7.stage7AuthorizedPathsFor(generation);
  const authorizedPathsPath = stage7.stage7AuthorizedPathsPathFor(generation);
  const extensionPath = stage7.stage7ExtensionDocumentPathFor(generation);
  const extension = stage7.stage7SemanticExtensionFor(generation);
  const isV2 = Number(generation.slice(3)) >= 10;
  const actualExtensionText = isV2 ? successorExtensionText : extensionText;
  const decisionPath = stage7.stage7DecisionDocumentPathFor(generation);
  const contractPath = stage7.stage7ExtensionPathFor(generation);
  const contractBytes =
    generation === "gen11" ? gen11SuccessorContractBytes : successorContractBytes;
  const allowlistBytes = Buffer.from(`${JSON.stringify(authorizedPaths, null, 2)}\n`);
  const predecessorReceiptBytes = Buffer.from(
    `${JSON.stringify(PREDECESSOR_RECEIPT_FIXTURE, null, 2)}\n`,
  );
  const predecessorReceiptPath = `docs/reviews/phase-1-m1/stage-7/${generation.toUpperCase()}_STAGE6_PREDECESSOR_BASELINE_VERIFY.json`;
  const bytesByPath = new Map([
    [extensionPath, actualExtensionText],
    [contractPath, isV2 ? contractBytes : legacyContractBytes],
    ["tooling/ci/test-stage-7-successor-baseline.mjs", sourceText],
  ]);
  const sourceFiles = [...bytesByPath.entries()]
    .map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) }))
    .sort((left, right) => bytewise(left.path, right.path));
  if (isV2) {
    bytesByPath.set(decisionPath, successorDecisionText);
    bytesByPath.set(stage7.STAGE7_GEN09_PREDECESSOR.baseline.path, gen09BaselineBytes);
    bytesByPath.set(
      stage7.STAGE7_GEN09_PREDECESSOR.canonicalCiReceipt.path,
      gen09CanonicalCiReceiptBytes,
    );
  }
  return {
    manifest: {
      schemaVersion: 1,
      candidateGeneration: generation,
      candidateId: `travelos-phase-1-m1-stage-7-${generation}`,
      candidateCommit: "1111111111111111111111111111111111111111",
      stage: "PHASE_1_M1_STAGE_7",
      stage7Actions: 1,
      stage8Actions: 0,
      predecessor: globalThis.structuredClone(PREDECESSOR_FIXTURE),
      predecessorReceiptDocument: {
        path: predecessorReceiptPath,
        sha256: sha256(predecessorReceiptBytes),
      },
      extension: globalThis.structuredClone(extension),
      extensionDocument: {
        path: extensionPath,
        sha256: sha256(actualExtensionText),
      },
      authorizedPathsDocument: {
        path: authorizedPathsPath,
        sha256: sha256(allowlistBytes),
      },
      sourceCount: sourceFiles.length,
      sourceFiles,
      sourceAggregateSha256: aggregate(sourceFiles),
      ...(isV2
        ? {
            previousCandidate: globalThis.structuredClone(stage7.STAGE7_GEN09_PREDECESSOR),
            decisionDocument: { path: decisionPath, sha256: sha256(successorDecisionText) },
            contractDocument: { path: contractPath, sha256: sha256(contractBytes) },
          }
        : {}),
    },
    bytesByPath: new Map([
      ...bytesByPath.entries(),
      [authorizedPathsPath, allowlistBytes],
      [predecessorReceiptPath, predecessorReceiptBytes],
    ]),
  };
};
const readFor = (bytesByPath) => async (file) => {
  const bytes = bytesByPath.get(file);
  assert.ok(bytes, `Unexpected fixture path: ${file}`);
  return bytes;
};
const expectedPathsFor = (manifest) => manifest.sourceFiles.map(({ path }) => path);

const valid = makeFixture();
assert.equal(typeof stage7.stage7AuthorizedPathsFor, "function");
assert.equal(typeof stage7.stage7SemanticExtensionFor, "function");
assert.equal(typeof stage7.verifyStage7Predecessor, "function");
assert.equal(typeof stage7.collectStage7SourceRows, "function");
assert.equal(typeof stage7.createStage7SuccessorManifest, "function");
assert.equal(typeof stage7.verifyStage7SuccessorBaseline, "function");
assert.equal(
  typeof stage7.validateStage7PredecessorReceipt,
  "function",
  "Stage 7 verifier must validate the Stage 6 predecessor receipt",
);
assert.deepEqual(stage7.validateStage7PredecessorReceipt(PREDECESSOR_RECEIPT_FIXTURE), {
  result: "PASS",
  sourceCommit: "6242e023953ccb8fe883bff97a0d62e64af8b66a",
  sourceCount: 61,
  sourceAggregateSha256: "a736add8226933ac9d2a78268357dd654d16322f722fe377cdb28bbd9a8cde6b",
});
const verified = await stage7.validateStage7SuccessorManifest({
  manifest: valid.manifest,
  readBytes: readFor(valid.bytesByPath),
  expectedSourcePaths: expectedPathsFor(valid.manifest),
});
assert.deepEqual(verified, {
  sourceCount: 3,
  sourceAggregateSha256: valid.manifest.sourceAggregateSha256,
});
const nextGeneration = makeFixture("gen02");
await stage7.validateStage7SuccessorManifest({
  manifest: nextGeneration.manifest,
  readBytes: readFor(nextGeneration.bytesByPath),
  expectedSourcePaths: expectedPathsFor(nextGeneration.manifest),
});
assert.equal(
  stage7.stage7BaselinePathFor("gen02"),
  "docs/reviews/phase-1-m1/STAGE_7_SUCCESSOR_BASELINE_GEN02.json",
);
assert.equal(
  stage7.stage7PredecessorReceiptPathFor("gen02"),
  "docs/reviews/phase-1-m1/stage-7/GEN02_STAGE6_PREDECESSOR_BASELINE_VERIFY.json",
);
assert.equal(
  typeof stage7.stage7PredecessorReportPathFor,
  "function",
  "Stage 7 predecessor proof path must be generation-bound",
);
assert.equal(
  stage7.stage7PredecessorReportPathFor("gen02"),
  "docs/reviews/phase-1-m1/stage-7/GEN02_STAGE7_PREDECESSOR_VERIFY.json",
);

const wrongPredecessor = makeFixture();
wrongPredecessor.manifest.predecessor.commit = "0".repeat(40);
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: wrongPredecessor.manifest,
    readBytes: readFor(wrongPredecessor.bytesByPath),
    expectedSourcePaths: expectedPathsFor(wrongPredecessor.manifest),
  }),
  /predecessor/i,
);

const badPredecessorReceipt = globalThis.structuredClone(PREDECESSOR_RECEIPT_FIXTURE);
badPredecessorReceipt.sourceAggregateSha256 = "0".repeat(64);
assert.throws(
  () => stage7.validateStage7PredecessorReceipt(badPredecessorReceipt),
  /Stage 6 predecessor verification/i,
);

const tamperedPredecessorReceipt = makeFixture();
tamperedPredecessorReceipt.bytesByPath.set(
  "docs/reviews/phase-1-m1/stage-7/GEN01_STAGE6_PREDECESSOR_BASELINE_VERIFY.json",
  Buffer.from("{}\n"),
);
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: tamperedPredecessorReceipt.manifest,
    readBytes: readFor(tamperedPredecessorReceipt.bytesByPath),
    expectedSourcePaths: expectedPathsFor(tamperedPredecessorReceipt.manifest),
  }),
  /predecessor receipt hash mismatch/i,
);

const malformedCandidateCommit = makeFixture();
malformedCandidateCommit.manifest.candidateCommit = "not-a-git-sha";
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: malformedCandidateCommit.manifest,
    readBytes: readFor(malformedCandidateCommit.bytesByPath),
    expectedSourcePaths: expectedPathsFor(malformedCandidateCommit.manifest),
  }),
  /candidate commit/i,
);

const wrongCandidateCommit = makeFixture();
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: wrongCandidateCommit.manifest,
    readBytes: readFor(wrongCandidateCommit.bytesByPath),
    expectedSourcePaths: expectedPathsFor(wrongCandidateCommit.manifest),
    expectedCommit: "2222222222222222222222222222222222222222",
  }),
  /another commit/i,
);

const stage8Work = makeFixture();
stage8Work.manifest.stage8Actions = 1;
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: stage8Work.manifest,
    readBytes: readFor(stage8Work.bytesByPath),
    expectedSourcePaths: expectedPathsFor(stage8Work.manifest),
  }),
  /Stage 8 actions/i,
);

const changedExtension = makeFixture();
changedExtension.bytesByPath.set(
  "docs/implementation/M1_STAGE_7_PORTAL_ISOLATION.md",
  Buffer.from("tampered extension\n"),
);
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: changedExtension.manifest,
    readBytes: readFor(changedExtension.bytesByPath),
    expectedSourcePaths: expectedPathsFor(changedExtension.manifest),
  }),
  /extension document hash mismatch/i,
);

const changedAllowlist = makeFixture();
const maliciousAllowlistBytes = Buffer.from('{"schemaVersion":1,"stage":"OTHER"}\n');
const changedAllowlistPath = stage7.stage7AuthorizedPathsPathFor("gen01");
changedAllowlist.bytesByPath.set(changedAllowlistPath, maliciousAllowlistBytes);
changedAllowlist.manifest.authorizedPathsDocument.sha256 = sha256(maliciousAllowlistBytes);
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: changedAllowlist.manifest,
    readBytes: readFor(changedAllowlist.bytesByPath),
    expectedSourcePaths: expectedPathsFor(changedAllowlist.manifest),
  }),
  /authorized-path document differs/i,
);

const changedGen09Predecessor = makeFixture("gen09");
changedGen09Predecessor.manifest.predecessor.commit = "0".repeat(40);
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: changedGen09Predecessor.manifest,
    readBytes: readFor(changedGen09Predecessor.bytesByPath),
    expectedSourcePaths: expectedPathsFor(changedGen09Predecessor.manifest),
  }),
  /predecessor/i,
);

const gen10Semantics = stage7.stage7SemanticExtensionFor("gen10");
assert.equal(gen10Semantics.schemaVersion, 2);
assert.equal(gen10Semantics.runtimeAcceptanceCleanup.method, "POST");
assert.equal(
  gen10Semantics.runtimeAcceptanceCleanup.path,
  "/api/admin/runtime-acceptance-fixtures/:fixtureRunId/cleanup",
);
assert.equal(gen10Semantics.runtimeAcceptanceCleanup.environment, "DEVELOPMENT_ONLY");
assert.equal(gen10Semantics.runtimeAcceptanceCleanup.listener, "EXISTING_ADMIN_API");
assert.equal(gen10Semantics.runtimeAcceptanceCleanup.acceptsCallerResourceIds, false);
assert.equal(gen10Semantics.stage7Actions, 1);
assert.equal(gen10Semantics.stage8Actions, 0);
assert.ok(
  stage7.STAGE7_AUTHORIZED_PATHS.exactSourceFiles.includes(
    "deploy/contracts/stage-7-extension.v2-gen11.json",
  ),
);
assert.ok(
  stage7.STAGE7_AUTHORIZED_PATHS.exactSourceFiles.includes(
    "deploy/contracts/stage-7-extension.v2.json",
  ),
);
assert.ok(
  stage7.STAGE7_AUTHORIZED_PATHS.exactSourceFiles.includes(
    "docs/implementation/M1_STAGE_7_RUNTIME_ACCEPTANCE_CLEANUP_SUCCESSOR.md",
  ),
);
for (const requiredGen10SourcePath of [
  "apps/admin-api/test/m1-routes.test.ts",
  "apps/admin-api/test/publication-routes.test.ts",
  "packages/backend-core/test/m1/application.test.ts",
  "packages/database/src/customer-presentation/staff-publication-repository.ts",
  "packages/database/src/trip-operations/m1-operational-slice-repository.ts",
  "tests/integration/stage-5-postgresql.test.ts",
]) {
  assert.ok(
    stage7.stage7AuthorizedPathsFor("gen10").exactSourceFiles.includes(requiredGen10SourcePath),
    `The gen10 authorized source list must include ${requiredGen10SourcePath}`,
  );
}
assert.equal(
  stage7.stage7AuthorizedPathsFor("gen10").exactSourceFiles.includes("docs/DATA_MODEL.md"),
  false,
);
assert.equal(
  stage7.stage7AuthorizedPathsFor("gen10").exactSourceFiles.includes("docs/PERMISSIONS.md"),
  false,
);

const v2Baseline = makeFixture("gen10");
await stage7.validateStage7SuccessorManifest({
  manifest: v2Baseline.manifest,
  readBytes: readFor(v2Baseline.bytesByPath),
  expectedSourcePaths: expectedPathsFor(v2Baseline.manifest),
});
const verifiedGen10Predecessor = await stage7.verifyStage7Predecessor({ generation: "gen10" });
assert.equal(verifiedGen10Predecessor.result, "PASS");
assert.deepEqual(verifiedGen10Predecessor.stage6Verification, gen09Stage6Receipt);
assert.equal(
  verifiedGen10Predecessor.gen09Candidate.artifactSha256,
  "272bd285763e9a0aa1c4dcc49f127b9b92f503b1dc44883fc8c8563f0bbad07c",
);
assert.equal(verifiedGen10Predecessor.gen09Candidate.expectedGateCount, 42);
assert.equal(verifiedGen10Predecessor.gen09Candidate.completedGateCount, 42);
assert.equal(verifiedGen10Predecessor.stage8Actions, 0);
const changedGen09Baseline = makeFixture("gen10");
changedGen09Baseline.bytesByPath.set(
  stage7.STAGE7_GEN09_PREDECESSOR.baseline.path,
  Buffer.concat([gen09BaselineBytes, Buffer.from("tampered\n")]),
);
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: changedGen09Baseline.manifest,
    readBytes: readFor(changedGen09Baseline.bytesByPath),
    expectedSourcePaths: expectedPathsFor(changedGen09Baseline.manifest),
  }),
  /Previous candidate baseline hash mismatch/u,
);

const changedGen09CiReceipt = makeFixture("gen10");
changedGen09CiReceipt.bytesByPath.set(
  stage7.STAGE7_GEN09_PREDECESSOR.canonicalCiReceipt.path,
  Buffer.concat([gen09CanonicalCiReceiptBytes, Buffer.from("tampered\n")]),
);
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: changedGen09CiReceipt.manifest,
    readBytes: readFor(changedGen09CiReceipt.bytesByPath),
    expectedSourcePaths: expectedPathsFor(changedGen09CiReceipt.manifest),
  }),
  /Previous candidate canonical CI receipt hash mismatch/u,
);

const changedV2Contract = makeFixture("gen10");
const changedContract = JSON.parse(successorContractBytes.toString("utf8"));
changedContract.runtimeAcceptance.fixtureCleanup.path =
  "/api/admin/runtime-acceptance-fixtures/:fixtureRunId/cleanup-all";
const changedContractBytes = Buffer.from(`${JSON.stringify(changedContract, null, 2)}\n`);
changedV2Contract.bytesByPath.set(stage7.stage7ExtensionPathFor("gen10"), changedContractBytes);
changedV2Contract.manifest.contractDocument.sha256 = sha256(changedContractBytes);
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: changedV2Contract.manifest,
    readBytes: readFor(changedV2Contract.bytesByPath),
    expectedSourcePaths: expectedPathsFor(changedV2Contract.manifest),
  }),
  /Stage 7 fixture cleanup contract differs/u,
);

const changedV2Decision = makeFixture("gen10");
const omittedSuccessorSource = makeFixture("gen10");
const expectedSuccessorSourcePaths = expectedPathsFor(omittedSuccessorSource.manifest);
const omittedContractPath = stage7.stage7ExtensionPathFor("gen10");
omittedSuccessorSource.manifest.sourceFiles = omittedSuccessorSource.manifest.sourceFiles.filter(
  ({ path }) => path !== omittedContractPath,
);
omittedSuccessorSource.manifest.sourceFiles.sort((left, right) => bytewise(left.path, right.path));
omittedSuccessorSource.manifest.sourceCount = omittedSuccessorSource.manifest.sourceFiles.length;
omittedSuccessorSource.manifest.sourceAggregateSha256 = aggregate(
  omittedSuccessorSource.manifest.sourceFiles,
);
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: omittedSuccessorSource.manifest,
    readBytes: readFor(omittedSuccessorSource.bytesByPath),
    expectedSourcePaths: expectedSuccessorSourcePaths,
  }),
  /exact Stage 7 source delta/i,
  "A gen10 source manifest must not omit its selected v2 contract",
);

const successorBaselineHashMismatch = makeFixture("gen10");
successorBaselineHashMismatch.manifest.sourceFiles.find(
  ({ path }) => path === omittedContractPath,
).sha256 = "0".repeat(64);
successorBaselineHashMismatch.manifest.sourceAggregateSha256 = aggregate(
  successorBaselineHashMismatch.manifest.sourceFiles,
);
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: successorBaselineHashMismatch.manifest,
    readBytes: readFor(successorBaselineHashMismatch.bytesByPath),
    expectedSourcePaths: expectedPathsFor(successorBaselineHashMismatch.manifest),
  }),
  /source hash mismatch/i,
  "A gen10 successor baseline must reject a tampered source digest",
);

const changedDecisionBytes = Buffer.from(
  successorDecisionText.toString("utf8").replace("Rui approved", "Rui reviewed"),
);
changedV2Decision.bytesByPath.set(
  stage7.stage7DecisionDocumentPathFor("gen10"),
  changedDecisionBytes,
);
changedV2Decision.manifest.decisionDocument.sha256 = sha256(changedDecisionBytes);
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: changedV2Decision.manifest,
    readBytes: readFor(changedV2Decision.bytesByPath),
    expectedSourcePaths: expectedPathsFor(changedV2Decision.manifest),
  }),
  /Stage 7 decision document is missing marker/u,
);

const v2PredecessorMutation = makeFixture("gen10");
v2PredecessorMutation.manifest.previousCandidate.artifactSha256 = "0".repeat(64);
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: v2PredecessorMutation.manifest,
    readBytes: readFor(v2PredecessorMutation.bytesByPath),
    expectedSourcePaths: expectedPathsFor(v2PredecessorMutation.manifest),
  }),
  /previous candidate/i,
);

const unlistedSource = makeFixture();
const unauthorizedBytes = Buffer.from("not authorized\n");
unlistedSource.bytesByPath.set("tooling/ci/not-authorized.mjs", unauthorizedBytes);
unlistedSource.manifest.sourceFiles.push({
  path: "tooling/ci/not-authorized.mjs",
  bytes: unauthorizedBytes.length,
  sha256: sha256(unauthorizedBytes),
});
unlistedSource.manifest.sourceFiles.sort((left, right) => bytewise(left.path, right.path));
unlistedSource.manifest.sourceCount = unlistedSource.manifest.sourceFiles.length;
unlistedSource.manifest.sourceAggregateSha256 = aggregate(unlistedSource.manifest.sourceFiles);
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: unlistedSource.manifest,
    readBytes: readFor(unlistedSource.bytesByPath),
    expectedSourcePaths: expectedPathsFor(unlistedSource.manifest),
  }),
  /not authorized/i,
);

const sourceHashMismatch = makeFixture();
sourceHashMismatch.manifest.sourceFiles[0].sha256 = "0".repeat(64);
sourceHashMismatch.manifest.sourceAggregateSha256 = aggregate(
  sourceHashMismatch.manifest.sourceFiles,
);
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: sourceHashMismatch.manifest,
    readBytes: readFor(sourceHashMismatch.bytesByPath),
    expectedSourcePaths: expectedPathsFor(sourceHashMismatch.manifest),
  }),
  /source hash mismatch/i,
);

const sourceCountMismatch = makeFixture();
sourceCountMismatch.manifest.sourceCount += 1;
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: sourceCountMismatch.manifest,
    readBytes: readFor(sourceCountMismatch.bytesByPath),
    expectedSourcePaths: expectedPathsFor(sourceCountMismatch.manifest),
  }),
  /source count mismatch/i,
);

const expectedPathMismatch = makeFixture();
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: expectedPathMismatch.manifest,
    readBytes: readFor(expectedPathMismatch.bytesByPath),
    expectedSourcePaths: [
      ...expectedPathsFor(expectedPathMismatch.manifest),
      "tooling/ci/extra.mjs",
    ],
  }),
  /exact Stage 7 source delta/i,
);

const duplicateSource = makeFixture();
duplicateSource.manifest.sourceFiles.push({ ...duplicateSource.manifest.sourceFiles[0] });
duplicateSource.manifest.sourceFiles.sort((left, right) => bytewise(left.path, right.path));
duplicateSource.manifest.sourceCount = duplicateSource.manifest.sourceFiles.length;
duplicateSource.manifest.sourceAggregateSha256 = aggregate(duplicateSource.manifest.sourceFiles);
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: duplicateSource.manifest,
    readBytes: readFor(duplicateSource.bytesByPath),
    expectedSourcePaths: expectedPathsFor(duplicateSource.manifest),
  }),
  /duplicate Stage 7 source manifest path/i,
);

process.stdout.write(
  `${JSON.stringify({ result: "PASS", cases: 21, positiveCases: 4, negativeControls: 17 })}\n`,
);
