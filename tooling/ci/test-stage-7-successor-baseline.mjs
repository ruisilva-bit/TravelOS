import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import * as stage7 from "./stage-7-successor-baseline.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytewise = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const authorizedPathsDocument = JSON.parse(
  await readFile(
    new URL("../../docs/reviews/phase-1-m1/stage-7/STAGE_7_AUTHORIZED_PATHS.json", import.meta.url),
    "utf8",
  ),
);
assert.deepEqual(
  authorizedPathsDocument,
  stage7.STAGE7_AUTHORIZED_PATHS,
  "Stage 7 authorized-path document must match the verifier-owned allowlist",
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
const EXTENSION_FIXTURE = {
  schemaVersion: 1,
  stage: "PHASE_1_M1_STAGE_7",
  staffGrantPermission: {
    id: "trip.access.manage",
    registryVersion: 5,
    scope: "AGENCY",
    ownerTemplate: "agency-owner-v1",
  },
  tripAccessGrant: {
    scope: ["agencyId", "portalPrincipalId", "tripId"],
    capability: "trip.view_current",
    issuedAndRevokedActorAndTimestamp: true,
    optionalExpiry: true,
    optionalRelationshipLabelUxOnly: true,
    explicitOnly: true,
    identityOrCustomerInference: false,
    portalSelfGrant: false,
    revocationIncrementsPrincipalAuthorizationEpoch: true,
    portalSessionsCarryAndCheckEpoch: true,
    authorizationCache: false,
  },
  portal: {
    authenticationRealm: "PORTAL_ONLY",
    runtimeLoginRole: "travelos_portal_api",
    runtimeCapabilityRole: "travelos_portal_runtime",
    activePublicationOnly: true,
    contract: "PortalTripSnapshotV1",
    contractVersion: 1,
    mutableWorkspaceRead: false,
    mutableWorkspaceFallback: false,
    unknownFieldPassthrough: false,
    writeCapability: false,
  },
  migration: {
    file: "0012_stage7_portal_trip_access.cjs",
    sessionUser: "travelos_migrator",
    currentUser: "travelos_owner",
    betterAuthRuntimeMigrations: false,
  },
  stage7Actions: 1,
  stage8Actions: 0,
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
const sourceText = Buffer.from("export const stage7BaselineFixture = true;\n");

const makeFixture = (generation = "gen01") => {
  const allowlistBytes = Buffer.from(
    `${JSON.stringify(stage7.STAGE7_AUTHORIZED_PATHS, null, 2)}\n`,
  );
  const predecessorReceiptBytes = Buffer.from(
    `${JSON.stringify(PREDECESSOR_RECEIPT_FIXTURE, null, 2)}\n`,
  );
  const predecessorReceiptPath = `docs/reviews/phase-1-m1/stage-7/${generation.toUpperCase()}_STAGE6_PREDECESSOR_BASELINE_VERIFY.json`;
  const bytesByPath = new Map([
    ["docs/implementation/M1_STAGE_7_PORTAL_ISOLATION.md", extensionText],
    ["tooling/ci/test-stage-7-successor-baseline.mjs", sourceText],
  ]);
  const sourceFiles = [...bytesByPath.entries()]
    .map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) }))
    .sort((left, right) => bytewise(left.path, right.path));
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
      extension: globalThis.structuredClone(EXTENSION_FIXTURE),
      extensionDocument: {
        path: "docs/implementation/M1_STAGE_7_PORTAL_ISOLATION.md",
        sha256: sha256(extensionText),
      },
      authorizedPathsDocument: {
        path: stage7.STAGE7_AUTHORIZED_PATHS_PATH,
        sha256: sha256(allowlistBytes),
      },
      sourceCount: sourceFiles.length,
      sourceFiles,
      sourceAggregateSha256: aggregate(sourceFiles),
    },
    bytesByPath: new Map([
      ...bytesByPath.entries(),
      [stage7.STAGE7_AUTHORIZED_PATHS_PATH, allowlistBytes],
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
  sourceCount: 2,
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
changedAllowlist.bytesByPath.set(stage7.STAGE7_AUTHORIZED_PATHS_PATH, maliciousAllowlistBytes);
changedAllowlist.manifest.authorizedPathsDocument.sha256 = sha256(maliciousAllowlistBytes);
await assert.rejects(
  stage7.validateStage7SuccessorManifest({
    manifest: changedAllowlist.manifest,
    readBytes: readFor(changedAllowlist.bytesByPath),
    expectedSourcePaths: expectedPathsFor(changedAllowlist.manifest),
  }),
  /authorized-path document differs/i,
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
  `${JSON.stringify({ result: "PASS", cases: 16, positiveCases: 3, negativeControls: 13 })}\n`,
);
