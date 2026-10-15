import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, URL } from "node:url";

let runner;
try {
  runner = await import("./run-canonical-ci.mjs");
} catch {
  runner = null;
}
assert.ok(runner, "Stage 7 canonical CI runner must exist");

const {
  STAGE7_CANONICAL_CI_GATES,
  captureStage7CandidateSnapshot,
  listStage7LocalStatePaths,
  verifyCandidateFromRepository,
  runStage7CanonicalCi,
  stage7GateArgumentsFor,
} = runner;
assert.ok(Array.isArray(STAGE7_CANONICAL_CI_GATES));
assert.equal(typeof stage7GateArgumentsFor, "function");
assert.deepEqual(
  stage7GateArgumentsFor(
    STAGE7_CANONICAL_CI_GATES.find(({ label }) => label === "stage7-predecessor:pre"),
    "gen04",
  ),
  ["pnpm", "run", "stage7:predecessor:verify", "--generation=gen04"],
);
assert.deepEqual(
  stage7GateArgumentsFor(
    STAGE7_CANONICAL_CI_GATES.find(({ label }) => label === "stage7-successor-baseline:pre"),
    "gen04",
  ),
  ["pnpm", "run", "stage7:successor-baseline:verify", "--generation=gen04"],
);
for (const label of ["stage7-source-scope:pre", "stage7-source-scope:post"]) {
  const gate = STAGE7_CANONICAL_CI_GATES.find((candidateGate) => candidateGate.label === label);
  assert.ok(gate, `Missing canonical Stage 7 gate: ${label}`);
  assert.deepEqual(stage7GateArgumentsFor(gate, "gen04"), [
    "pnpm",
    "run",
    "stage7:source-scope:verify",
    "--generation=gen04",
  ]);
}
const predecessorScanGate = STAGE7_CANONICAL_CI_GATES.find(
  ({ label }) => label === "stage6-predecessor:security-scan",
);
assert.ok(predecessorScanGate, "Stage 6 sensitive scan must target the immutable predecessor");
assert.deepEqual(stage7GateArgumentsFor(predecessorScanGate, "gen04"), [
  "pnpm",
  "run",
  "stage7:predecessor:security-scan",
  "--generation=gen04",
]);
assert.equal(typeof captureStage7CandidateSnapshot, "function");
assert.equal(typeof listStage7LocalStatePaths, "function");
assert.equal(typeof verifyCandidateFromRepository, "function");
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packageManifest = JSON.parse(
  await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
);
assert.equal(
  packageManifest.scripts["stage7:source-scope:verify"],
  "node tooling/ci/stage-7/verify-source-scope.mjs",
);
assert.equal(
  packageManifest.scripts["stage7:predecessor:security-scan"],
  "node tooling/ci/stage-7/scan-predecessor-security.mjs",
);
assert.equal(
  packageManifest.scripts["test:stage7:predecessor-security-scan"],
  "node tooling/ci/stage-7/test-predecessor-security-scan.mjs",
);
const labels = STAGE7_CANONICAL_CI_GATES.map(({ label }) => label);
assert.equal(new Set(labels).size, labels.length, "Canonical CI gate labels must be unique");
for (const { script } of STAGE7_CANONICAL_CI_GATES) {
  assert.equal(
    typeof packageManifest.scripts[script],
    "string",
    `Canonical CI gate script is not wired in package.json: ${script}`,
  );
}
for (const required of [
  "stage7-predecessor:pre",
  "stage7-successor-baseline:pre",
  "stage7-source-scope:pre",
  "stage6-predecessor:security-scan",
  "format:check",
  "lint",
  "build",
  "typecheck",
  "architecture:check",
  "test:unit",
  "test:stage7:successor-baseline",
  "test:stage7:source-scope",
  "test:stage7:predecessor-security-scan",
  "test:stage7:artifact",
  "test:stage7:migrator-package",
  "test:stage7:postgres",
  "stage7-successor-baseline:post",
  "stage7-source-scope:post",
  "protected-baseline:post",
]) {
  assert.ok(labels.includes(required), `Missing canonical Stage 7 gate: ${required}`);
}
assert.ok(!STAGE7_CANONICAL_CI_GATES.some(({ script }) => script === "ci:verify"));
assert.ok(!STAGE7_CANONICAL_CI_GATES.some(({ script }) => script === "security:scan:stage6"));
assert.ok(
  !STAGE7_CANONICAL_CI_GATES.some(({ script }) => script === "stage6:successor-baseline:verify"),
);
assert.ok(!STAGE7_CANONICAL_CI_GATES.some(({ script }) => script === "test:stage6:postgres"));
assert.ok(
  !STAGE7_CANONICAL_CI_GATES.some(({ script }) => script === "test:stage6:migrator-package"),
);

const candidate = {
  result: "PASS",
  candidateGeneration: "gen01",
  candidateId: "travelos-phase-1-m1-stage-7-gen01",
  candidateCommit: "a".repeat(40),
  baselinePath: "docs/reviews/phase-1-m1/STAGE_7_SUCCESSOR_BASELINE_GEN01.json",
  baselineSha256: "e".repeat(64),
  artifactSha256: "b".repeat(64),
  deploymentContractSha256: "f".repeat(64),
  priorEvidenceScope: {
    result: "PASS",
    candidateGeneration: "gen01",
    candidateCommit: "a".repeat(40),
    baselineSha256: "e".repeat(64),
    historySha256: "1".repeat(64),
  },
  stage8Actions: 0,
};
const snapshot = {
  commit: candidate.candidateCommit,
  statusPorcelainBytes: 0,
  statusPorcelainSha256: "c".repeat(64),
  trackedDiffFromHeadBytes: 0,
  trackedDiffFromHeadSha256: "d".repeat(64),
  untrackedFiles: [],
  untrackedFileCount: 0,
};
const runCanonicalCiInTest = (options) =>
  runStage7CanonicalCi({ listLocalStatePaths: async () => [], ...options });
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "travelos-stage7-ci-"));
try {
  const priorEvidenceScope = {
    result: "PASS",
    candidateGeneration: "gen01",
    candidateCommit: "a".repeat(40),
    baselineSha256: "e".repeat(64),
    historyPath: "tooling/ci/stage-7/prior-candidate-dispositions.json",
    historySha256: "1".repeat(64),
    candidateCount: 0,
    requiredEvidencePaths: [],
    freezeEligibleGenerations: [],
    violations: [],
  };
  let sourceScopeInvocationCount = 0;
  let artifactVerificationCount = 0;
  const candidatePreflightInputs = (verifySourceScope) => ({
    root: repositoryRoot,
    generation: "gen01",
    verifyBaseline: async () => ({
      result: "PASS",
      currentBranch: "phase-1/stage-7",
      currentHead: "a".repeat(40),
      candidateCommit: "a".repeat(40),
      candidateId: "travelos-phase-1-m1-stage-7-gen01",
      baselinePath: "docs/reviews/phase-1-m1/STAGE_7_SUCCESSOR_BASELINE_GEN01.json",
      baselineSha256: "e".repeat(64),
      stage8Actions: 0,
    }),
    verifySourceScope,
    verifyDeployment: async () => ({
      result: "PASS",
      candidateCommit: "a".repeat(40),
      contractSha256: "f".repeat(64),
    }),
    verifyArtifact: async (input) => {
      artifactVerificationCount += 1;
      assert.equal(
        input.artifactRoot,
        path.join(repositoryRoot, ".hermes/state/stage7-gen01-artifact"),
      );
      assert.equal(
        input.archivePath,
        path.join(repositoryRoot, ".hermes/state/stage7-gen01-artifact.tar.gz"),
      );
      assert.equal(input.expectedCommit, "a".repeat(40));
      assert.equal(
        input.expectedTree,
        execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
          cwd: repositoryRoot,
          encoding: "utf8",
        }).trim(),
      );
      assert.equal(input.expectedBaselineSha256, "e".repeat(64));
      assert.equal(
        input.expectedLockfileSha256,
        createHash("sha256")
          .update(await readFile(path.join(repositoryRoot, "pnpm-lock.yaml")))
          .digest("hex"),
      );
      return { result: "PASS", artifactSha256: "b".repeat(64) };
    },
  });
  const artifactPreflight = await verifyCandidateFromRepository({
    ...candidatePreflightInputs(async (input) => {
      sourceScopeInvocationCount += 1;
      assert.equal(input.root, repositoryRoot);
      assert.equal(input.candidateGeneration, "gen01");
      assert.equal(input.candidateCommit, "a".repeat(40));
      assert.equal(
        input.baselinePath,
        "docs/reviews/phase-1-m1/STAGE_7_SUCCESSOR_BASELINE_GEN01.json",
      );
      assert.equal(input.baselineSha256, "e".repeat(64));
      return priorEvidenceScope;
    }),
  });
  assert.equal(artifactPreflight.artifactSha256, "b".repeat(64));
  assert.equal(artifactPreflight.deploymentContractSha256, "f".repeat(64));
  assert.deepEqual(artifactPreflight.priorEvidenceScope, priorEvidenceScope);
  assert.equal(sourceScopeInvocationCount, 1);
  assert.equal(artifactVerificationCount, 1);
  await assert.rejects(
    () =>
      verifyCandidateFromRepository({
        ...candidatePreflightInputs(async () => ({
          ...priorEvidenceScope,
          result: "FAIL",
          violations: ["gen01: missing final-candidate validation"],
        })),
      }),
    /Prior-evidence source-scope verification must pass/u,
  );
  assert.equal(
    artifactVerificationCount,
    1,
    "Source-scope failure must stop before artifact verification",
  );

  const localStateRoot = await mkdtemp(path.join(tmpdir(), "travelos-stage7-local-state-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: localStateRoot });
    execFileSync("git", ["config", "user.email", "stage7-ci-test@example.invalid"], {
      cwd: localStateRoot,
    });
    execFileSync("git", ["config", "user.name", "Stage 7 CI Test"], {
      cwd: localStateRoot,
    });
    await writeFile(path.join(localStateRoot, "tracked.txt"), "candidate\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: localStateRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "candidate fixture"], {
      cwd: localStateRoot,
    });
    const unreadableState = path.join(localStateRoot, ".hermes/state/historical-receipt.json");
    await mkdir(path.dirname(unreadableState), { recursive: true });
    await symlink("/missing-sensitive-local-state-target", unreadableState);
    const localStatePaths = await listStage7LocalStatePaths(localStateRoot);
    assert.deepEqual(localStatePaths, [".hermes/state/historical-receipt.json"]);
    const localStateSnapshot = await captureStage7CandidateSnapshot({
      root: localStateRoot,
      generation: "gen01",
      localStatePaths,
    });
    assert.deepEqual(localStateSnapshot.untrackedFiles, []);
    assert.equal(localStateSnapshot.statusPorcelainBytes, 0);

    await writeFile(path.join(localStateRoot, ".hermes/state/new-unexpected.json"), "new\n");
    const postSnapshot = await captureStage7CandidateSnapshot({
      root: localStateRoot,
      generation: "gen01",
      localStatePaths,
    });
    assert.deepEqual(
      postSnapshot.untrackedFiles.map(({ path: file }) => file),
      [".hermes/state/new-unexpected.json"],
      "new local state must not be silently added to the fixed exclusion set",
    );
  } finally {
    await rm(localStateRoot, { recursive: true, force: true });
  }

  let gateCalls = 0;
  const pass = await runCanonicalCiInTest({
    root: temporaryRoot,
    generation: "gen01",
    verifyCandidate: async () => candidate,
    captureSnapshot: async () => snapshot,
    toolchain: async () => ({ node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" }),
    runGate: async ({ label }) => {
      gateCalls += 1;
      return { exitCode: 0, output: `${label}: PASS\n` };
    },
    onGate: () => {},
    now: () => "2026-10-15T12:00:00.000Z",
  });
  assert.equal(pass.result, "PASS");
  assert.equal(pass.stage8Actions, 0);
  assert.equal(pass.candidateCommit, candidate.candidateCommit);
  assert.equal(pass.artifactSha256, candidate.artifactSha256);
  assert.equal(gateCalls, STAGE7_CANONICAL_CI_GATES.length);
  const passPaths = pass.paths;
  assert.equal(
    JSON.parse(await readFile(path.join(temporaryRoot, passPaths.receiptPath), "utf8")).result,
    "PASS",
  );
  assert.match(
    await readFile(path.join(temporaryRoot, passPaths.logPath), "utf8"),
    /"result": "PASS"/,
  );
  await assert.rejects(
    stat(path.join(temporaryRoot, passPaths.claimPath)).then(() =>
      runStage7CanonicalCi({ root: temporaryRoot, generation: "gen01" }),
    ),
    /One-shot Stage 7 CI state already exists/,
  );

  const failedRoot = await mkdtemp(path.join(tmpdir(), "travelos-stage7-ci-fail-"));
  try {
    let failedGateCalls = 0;
    const failed = await runCanonicalCiInTest({
      root: failedRoot,
      generation: "gen01",
      verifyCandidate: async () => candidate,
      captureSnapshot: async () => snapshot,
      toolchain: async () => ({ node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" }),
      runGate: async ({ gate }) => {
        failedGateCalls += 1;
        return {
          exitCode: gate.label === labels[0] ? 1 : 0,
          output: `${gate.label}: result\n`,
        };
      },
      onGate: () => {},
      now: () => "2026-10-15T12:00:00.000Z",
    });
    assert.equal(failed.result, "FAIL");
    assert.equal(failed.failedGate, labels[0]);
    assert.equal(failedGateCalls, 1);
    await assert.rejects(
      runStage7CanonicalCi({
        root: failedRoot,
        generation: "gen01",
        verifyCandidate: async () => candidate,
        captureSnapshot: async () => snapshot,
        toolchain: async () => ({ node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" }),
        runGate: async () => ({ exitCode: 0, output: "unexpected retry" }),
      }),
      /One-shot Stage 7 CI state already exists/,
    );
  } finally {
    await rm(failedRoot, { recursive: true, force: true });
  }

  const preflightRoot = await mkdtemp(path.join(tmpdir(), "travelos-stage7-ci-preflight-"));
  try {
    let preflightGateCalls = 0;
    await assert.rejects(
      runStage7CanonicalCi({
        root: preflightRoot,
        generation: "gen01",
        verifyCandidate: async () => ({ ...candidate, result: "FAIL" }),
        captureSnapshot: async () => snapshot,
        toolchain: async () => ({ node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" }),
        runGate: async () => {
          preflightGateCalls += 1;
          return { exitCode: 0, output: "not allowed" };
        },
        onGate: () => {},
      }),
      /Candidate preflight must pass before one-shot CI/,
    );
    assert.equal(preflightGateCalls, 0);
  } finally {
    await rm(preflightRoot, { recursive: true, force: true });
  }

  const mutationRoot = await mkdtemp(path.join(tmpdir(), "travelos-stage7-ci-mutation-"));
  try {
    let captureCount = 0;
    let mutationGateCalls = 0;
    await assert.rejects(
      runCanonicalCiInTest({
        root: mutationRoot,
        generation: "gen01",
        verifyCandidate: async () => candidate,
        captureSnapshot: async () =>
          captureCount++ === 0 ? snapshot : { ...snapshot, trackedDiffFromHeadBytes: 1 },
        toolchain: async () => ({ node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" }),
        runGate: async () => {
          mutationGateCalls += 1;
          return { exitCode: 0, output: "not allowed" };
        },
        onGate: () => {},
      }),
      /Candidate state changed while arming one-shot CI/,
    );
    assert.equal(mutationGateCalls, 0);
  } finally {
    await rm(mutationRoot, { recursive: true, force: true });
  }

  const unexpectedStateRoot = await mkdtemp(path.join(tmpdir(), "travelos-stage7-ci-state-drift-"));
  try {
    let unexpectedStateGateCalls = 0;
    await assert.rejects(
      runCanonicalCiInTest({
        root: unexpectedStateRoot,
        generation: "gen01",
        verifyCandidate: async () => candidate,
        captureSnapshot: async () => ({
          ...snapshot,
          untrackedFiles: [
            {
              path: ".hermes/state/new-unexpected.json",
              bytes: 4,
              sha256: "1".repeat(64),
            },
          ],
          untrackedFileCount: 1,
        }),
        toolchain: async () => ({ node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" }),
        runGate: async () => {
          unexpectedStateGateCalls += 1;
          return { exitCode: 0, output: "not allowed" };
        },
        onGate: () => {},
      }),
      /Unexpected untracked path before canonical CI: \.hermes\/state\/new-unexpected\.json/,
    );
    assert.equal(unexpectedStateGateCalls, 0);
  } finally {
    await rm(unexpectedStateRoot, { recursive: true, force: true });
  }

  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        result: "PASS",
        gateCount: labels.length,
        cases: 6,
        oneShotPass: true,
        oneShotFailureIsConsumed: true,
        preflightIsRequired: true,
        candidateMutationFailsClosed: true,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
