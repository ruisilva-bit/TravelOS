import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

let canonicalCi;
try {
  canonicalCi = await import("./run-canonical-ci.mjs");
} catch {
  canonicalCi = undefined;
}

const candidateRecordFor = (candidate) => ({
  result: "PASS",
  stage: "PHASE_1_M1_STAGE_9",
  candidate,
  predecessor: "a5cac93bbaa0214456739f7b571795ca8080bfb6",
  sourceSnapshotSha256: "a".repeat(64),
  artifactSha256: "b".repeat(64),
  artifactId: `travelos-stage9-${candidate}-${"a".repeat(8)}`,
  buildReceiptSha256: "c".repeat(64),
  preflightSha256: "d".repeat(64),
  migrationHead: "0016_stage9_staff_invitations",
  predecessorArtifactId: "travelos-stage8-gen03-3d6c977d",
  predecessorArtifactSha256: "224747dff536535f94c49a55ab1ef1719fa7a5ccd6c44606d3c5ee8faaff98fb",
  predecessorArtifactRoot: "/verified/stage8-gen03-extracted",
  predecessorArchivePath: "/verified/stage8-gen03-artifact.tar.gz",
  extractedRoot: `.hermes/state/stage9-${candidate}-extracted`,
  toolchain: { node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" },
  stage10Actions: 0,
});

test("Stage 9 canonical CI exposes candidate-scoped one-shot runner and paths", () => {
  assert.equal(typeof canonicalCi?.runStage9CanonicalCi, "function");
  assert.equal(typeof canonicalCi?.consumeStage9CanonicalCi, "function");
  assert.equal(typeof canonicalCi?.stage9CandidatePathsFor, "function");
  assert.equal(typeof canonicalCi?.stage9CanonicalCiPathsFor, "function");
});

test("Stage 9 canonical gates cover code, artifact, database, browser, and security checks", (context) => {
  if (!canonicalCi?.STAGE9_CANONICAL_CI_GATES) {
    context.skip("Stage 9 canonical CI gate list is not implemented yet");
    return;
  }
  const gates = canonicalCi.STAGE9_CANONICAL_CI_GATES;
  const labels = gates.map((gate) => gate.label);
  for (const required of [
    "stage9-pinned-toolchain",
    "protected-baseline:pre",
    "stage9-successor-baseline-tests",
    "stage9-clean-install",
    "stage9-migration-checksums",
    "auth:schema:verify",
    "format:check",
    "lint",
    "build",
    "typecheck",
    "architecture:check",
    "test:unit",
    "stage9-deployment-contract",
    "stage9-artifact-tests",
    "stage9-extracted-artifact-integrity",
    "stage9-postgresql-browser-acceptance",
    "test:smoke",
    "stage9-source-security-scan",
    "protected-baseline:post",
  ])
    assert.ok(labels.includes(required), `Missing canonical gate: ${required}`);
  assert.equal(new Set(labels).size, labels.length, "Canonical CI gate labels must be unique");
  assert.ok(
    !gates.some((gate) => gate.script === "test:stage8:postgres"),
    "Stage 9 integration must run through its Stage 9 disposable adapter",
  );
  assert.ok(
    !gates.some((gate) => gate.script === "stage8:canonical-ci"),
    "Stage 9 must not consume or mutate the Stage 8 candidate runner",
  );
});

test("canonical build gate receives production NODE_ENV while other gates retain development mode", () => {
  const candidateRecord = candidateRecordFor("gen10");
  const buildGate = canonicalCi.STAGE9_CANONICAL_CI_GATES.find((gate) => gate.script === "build");
  const smokeGate = canonicalCi.STAGE9_CANONICAL_CI_GATES.find(
    (gate) => gate.script === "test:smoke",
  );
  assert.ok(buildGate, "canonical CI must define its build gate");
  assert.ok(smokeGate, "canonical CI must define its smoke gate");
  assert.equal(typeof canonicalCi.stage9CanonicalCiEnvironmentFor, "function");

  const environment = { NODE_ENV: "test", PATH: "/bin", STAGE9_TEST_SENTINEL: "preserved" };
  const buildEnvironment = canonicalCi.stage9CanonicalCiEnvironmentFor({
    root: "/workspace",
    candidateRecord,
    gate: buildGate,
    environment,
  });
  assert.equal(buildEnvironment.NODE_ENV, "production");
  assert.equal(buildEnvironment.CI, "true");
  assert.equal(buildEnvironment.STAGE9_TEST_SENTINEL, "preserved");
  assert.equal(buildEnvironment.TRAVELOS_STAGE9_CANDIDATE, "gen10");

  const smokeEnvironment = canonicalCi.stage9CanonicalCiEnvironmentFor({
    root: "/workspace",
    candidateRecord,
    gate: smokeGate,
    environment,
  });
  assert.equal(smokeEnvironment.NODE_ENV, "development");
});

test("candidate paths are canonical and scoped to the generation", (context) => {
  if (typeof canonicalCi?.stage9CandidatePathsFor !== "function") {
    context.skip("Stage 9 canonical CI paths are not implemented yet");
    return;
  }
  assert.deepEqual(canonicalCi.stage9CandidatePathsFor("gen06"), {
    artifactRoot: ".hermes/state/stage9-gen06-artifact",
    archivePath: ".hermes/state/stage9-gen06-artifact.tar.gz",
    extractedRoot: ".hermes/state/stage9-gen06-extracted",
    buildReceiptPath: ".hermes/state/stage9-gen06-artifact-build.json",
    preflightPath: ".hermes/state/stage9-gen06-preflight.json",
  });
  assert.throws(() => canonicalCi.stage9CandidatePathsFor("gen6"), /Invalid Stage 9 candidate/u);
  assert.throws(
    () => canonicalCi.stage9CandidatePathsFor("gen06/../gen07"),
    /Invalid Stage 9 candidate/u,
  );
  assert.deepEqual(canonicalCi.stage9CanonicalCiPathsFor("gen06"), {
    claimPath: ".hermes/state/stage9-gen06-canonical-ci-claim.json",
    logPath: ".hermes/state/stage9-gen06-canonical-ci.log",
    receiptPath: ".hermes/state/stage9-gen06-canonical-ci-receipt.json",
    postgresEvidenceDirectory: ".hermes/state/stage9-gen06-canonical-ci-postgresql",
    browserEvidenceDirectory: ".hermes/state/stage9-gen06-canonical-ci-browser",
  });
});

test("every package gate is wired to a root script", async (context) => {
  if (!canonicalCi?.STAGE9_CANONICAL_CI_GATES) {
    context.skip("Stage 9 canonical CI gate list is not implemented yet");
    return;
  }
  const packageManifest = JSON.parse(
    await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  );
  for (const gate of canonicalCi.STAGE9_CANONICAL_CI_GATES) {
    if (!gate.script) continue;
    assert.equal(
      typeof packageManifest.scripts[gate.script],
      "string",
      `Canonical CI gate script is missing: ${gate.script}`,
    );
  }
});

test("failed candidate CI is persisted as consumed and cannot be rerun", async (context) => {
  if (typeof canonicalCi?.consumeStage9CanonicalCi !== "function") {
    context.skip("Stage 9 canonical CI runner is not implemented yet");
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), "travelos-stage9-canonical-ci-fail-"));
  const candidateRecord = candidateRecordFor("gen06");
  let gateCalls = 0;
  const run = () =>
    canonicalCi.consumeStage9CanonicalCi({
      root,
      candidate: "gen06",
      candidateRecord,
      toolchainRecord: candidateRecord.toolchain,
      captureSnapshot: async () => ({ sha256: candidateRecord.sourceSnapshotSha256 }),
      runGate: async () => {
        gateCalls += 1;
        return { exitCode: 1, output: "synthetic gate failure" };
      },
    });
  try {
    const first = await run();
    assert.equal(first.result, "FAIL");
    assert.equal(first.completedGateCount, 1);
    assert.equal(gateCalls, 1);
    const paths = canonicalCi.stage9CanonicalCiPathsFor("gen06");
    const claim = JSON.parse(await readFile(path.join(root, paths.claimPath), "utf8"));
    const receipt = JSON.parse(await readFile(path.join(root, paths.receiptPath), "utf8"));
    assert.equal(claim.state, "CONSUMED");
    assert.equal(claim.invocationCount, 1);
    assert.equal(receipt.result, "FAIL");
    assert.equal(receipt.failedGate, canonicalCi.STAGE9_CANONICAL_CI_GATES[0].label);
    await assert.rejects(run(), /already exists/u);
    assert.equal(gateCalls, 1, "A consumed candidate must not execute any gate again");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("passing candidate records every gate and cannot be consumed twice", async (context) => {
  if (typeof canonicalCi?.consumeStage9CanonicalCi !== "function") {
    context.skip("Stage 9 canonical CI runner is not implemented yet");
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), "travelos-stage9-canonical-ci-pass-"));
  const candidateRecord = candidateRecordFor("gen07");
  let gateCalls = 0;
  try {
    const receipt = await canonicalCi.consumeStage9CanonicalCi({
      root,
      candidate: "gen07",
      candidateRecord,
      toolchainRecord: candidateRecord.toolchain,
      captureSnapshot: async () => ({ sha256: candidateRecord.sourceSnapshotSha256 }),
      runGate: async ({ gate }) => {
        gateCalls += 1;
        const output =
          gate.label === "stage9-pinned-toolchain"
            ? `> verify:pins\n${JSON.stringify({
                result: "PASS",
                toolchain: {
                  ...candidateRecord.toolchain,
                  node: candidateRecord.toolchain.node.slice(1),
                },
              })}\n`
            : `${gate.label}: PASS\n`;
        return { exitCode: 0, output };
      },
      onGate: () => {},
    });
    assert.equal(receipt.result, "PASS");
    assert.equal(receipt.stage10Actions, 0);
    assert.equal(receipt.completedGateCount, canonicalCi.STAGE9_CANONICAL_CI_GATES.length);
    assert.equal(gateCalls, canonicalCi.STAGE9_CANONICAL_CI_GATES.length);
    const paths = canonicalCi.stage9CanonicalCiPathsFor("gen07");
    const persisted = JSON.parse(await readFile(path.join(root, paths.receiptPath), "utf8"));
    assert.deepEqual(persisted, receipt);
    await assert.rejects(
      canonicalCi.consumeStage9CanonicalCi({
        root,
        candidate: "gen07",
        candidateRecord,
        toolchainRecord: candidateRecord.toolchain,
        captureSnapshot: async () => ({ sha256: candidateRecord.sourceSnapshotSha256 }),
        runGate: async () => {
          gateCalls += 1;
          return { exitCode: 0, output: "unexpected rerun" };
        },
      }),
      /already exists/u,
    );
    assert.equal(gateCalls, canonicalCi.STAGE9_CANONICAL_CI_GATES.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate qualification failure happens before one-shot state or gate execution", async (context) => {
  if (typeof canonicalCi?.runStage9CanonicalCi !== "function") {
    context.skip("Stage 9 canonical CI runner is not implemented yet");
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), "travelos-stage9-canonical-ci-preflight-"));
  let toolchainCalls = 0;
  let gateCalls = 0;
  const paths = canonicalCi.stage9CanonicalCiPathsFor("gen08");
  try {
    await assert.rejects(
      canonicalCi.runStage9CanonicalCi({
        root,
        candidate: "gen08",
        verifyCandidate: async () => {
          throw new Error("synthetic qualification rejection");
        },
        toolchain: async () => {
          toolchainCalls += 1;
          return candidateRecordFor("gen08").toolchain;
        },
        runGate: async () => {
          gateCalls += 1;
          return { exitCode: 0, output: "unexpected gate" };
        },
      }),
      /synthetic qualification rejection/u,
    );
    assert.equal(toolchainCalls, 0);
    assert.equal(gateCalls, 0);
    for (const file of [paths.claimPath, paths.logPath, paths.receiptPath])
      await assert.rejects(readFile(path.join(root, file)), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical run binds the verified predecessor inputs before consuming one-shot CI", async (context) => {
  if (typeof canonicalCi?.runStage9CanonicalCi !== "function") {
    context.skip("Stage 9 canonical CI runner is not implemented yet");
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), "travelos-stage9-canonical-ci-verified-inputs-"));
  const candidateRecord = candidateRecordFor("gen10");
  const toolchainRecord = candidateRecord.toolchain;
  const stage8ArtifactRoot = "/verified/stage8-gen03-extracted";
  const stage8ArchivePath = "/verified/stage8-gen03-artifact.tar.gz";
  let gateCalls = 0;
  try {
    const receipt = await canonicalCi.runStage9CanonicalCi({
      root,
      candidate: "gen10",
      stage8ArtifactRoot,
      stage8ArchivePath,
      verifyCandidate: async (input) => {
        assert.equal(input.root, root);
        assert.equal(input.candidate, "gen10");
        assert.equal(input.stage8ArtifactRoot, stage8ArtifactRoot);
        assert.equal(input.stage8ArchivePath, stage8ArchivePath);
        assert.deepEqual(input.paths, canonicalCi.stage9CandidatePathsFor("gen10"));
        return candidateRecord;
      },
      toolchain: async (inputRoot) => {
        assert.equal(inputRoot, root);
        return toolchainRecord;
      },
      captureSnapshot: async () => ({ sha256: candidateRecord.sourceSnapshotSha256 }),
      runGate: async ({ gate }) => {
        gateCalls += 1;
        const output =
          gate.label === "stage9-pinned-toolchain"
            ? JSON.stringify({
                result: "PASS",
                toolchain: {
                  ...toolchainRecord,
                  node: toolchainRecord.node.slice(1),
                },
              })
            : `${gate.label}: PASS\n`;
        return { exitCode: 0, output };
      },
      onGate: () => {},
    });
    assert.equal(receipt.result, "PASS");
    assert.equal(receipt.candidate, "gen10");
    assert.equal(receipt.predecessorArtifactId, "travelos-stage8-gen03-3d6c977d");
    assert.equal(receipt.invocationCount, 1);
    assert.equal(receipt.completedGateCount, canonicalCi.STAGE9_CANONICAL_CI_GATES.length);
    assert.equal(gateCalls, canonicalCi.STAGE9_CANONICAL_CI_GATES.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source drift after a gate consumes the candidate and prevents later gates", async (context) => {
  if (typeof canonicalCi?.consumeStage9CanonicalCi !== "function") {
    context.skip("Stage 9 canonical CI runner is not implemented yet");
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), "travelos-stage9-canonical-ci-drift-"));
  const candidateRecord = candidateRecordFor("gen09");
  const changedSnapshotSha256 = "e".repeat(64);
  let snapshotCalls = 0;
  let gateCalls = 0;
  try {
    const receipt = await canonicalCi.consumeStage9CanonicalCi({
      root,
      candidate: "gen09",
      candidateRecord,
      toolchainRecord: candidateRecord.toolchain,
      captureSnapshot: async () => ({
        sha256: ++snapshotCalls < 3 ? candidateRecord.sourceSnapshotSha256 : changedSnapshotSha256,
      }),
      runGate: async () => {
        gateCalls += 1;
        return {
          exitCode: 0,
          output: JSON.stringify({
            result: "PASS",
            toolchain: {
              node: "24.19.0",
              corepack: candidateRecord.toolchain.corepack,
              pnpm: candidateRecord.toolchain.pnpm,
            },
          }),
        };
      },
      onGate: () => {},
    });
    assert.equal(receipt.result, "FAIL");
    assert.equal(receipt.failedGate, "stage9-pinned-toolchain:source-after");
    assert.equal(receipt.failureCode, "CANDIDATE_SOURCE_DRIFT");
    assert.equal(gateCalls, 1);
    const paths = canonicalCi.stage9CanonicalCiPathsFor("gen09");
    const claim = JSON.parse(await readFile(path.join(root, paths.claimPath), "utf8"));
    assert.equal(claim.state, "CONSUMED");
    assert.equal(claim.result, "FAIL");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const { name, args, diagnostic } of [
  {
    name: "accepts documented digit-bearing predecessor flags before candidate validation",
    args: [
      "--candidate=invalid",
      "--stage8-artifact-root=/unused/predecessor",
      "--stage8-archive=/unused/predecessor.tar.gz",
    ],
    diagnostic: /Invalid Stage 9 candidate identifier/u,
  },
  {
    name: "rejects duplicate digit-bearing flags before candidate validation",
    args: [
      "--candidate=invalid",
      "--stage8-artifact-root=/unused/first",
      "--stage8-artifact-root=/unused/second",
    ],
    diagnostic: /Duplicate Stage 9 canonical CI argument: --stage8-artifact-root/u,
  },
  {
    name: "rejects unallowlisted digit-bearing flags before candidate validation",
    args: ["--candidate=invalid", "--stage9-unrecognized=/unused/path"],
    diagnostic: /Unknown Stage 9 canonical CI argument: --stage9-unrecognized/u,
  },
  {
    name: "rejects option names that start with a digit",
    args: ["--candidate=invalid", "--8stage-artifact-root=/unused/path"],
    diagnostic: /Unexpected Stage 9 canonical CI argument: --8stage-artifact-root/u,
  },
]) {
  test(`canonical CLI ${name}`, () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./run-canonical-ci.mjs", import.meta.url)), ...args],
      { encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024 },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, diagnostic);
  });
}
