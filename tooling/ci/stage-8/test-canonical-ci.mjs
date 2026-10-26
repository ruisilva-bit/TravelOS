import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { URL } from "node:url";

let canonicalCi;
try {
  canonicalCi = await import("./run-canonical-ci.mjs");
} catch {
  canonicalCi = undefined;
}

const candidateRecordFor = (candidate) => ({
  result: "PASS",
  stage: "PHASE_1_M1_STAGE_8",
  candidate,
  predecessor: "a57789b6662f0e0c0da5948c20eef6eb1e6bf4ec",
  sourceSnapshotSha256: "a".repeat(64),
  artifactSha256: "b".repeat(64),
  preflightSha256: "c".repeat(64),
  buildReceiptSha256: "d".repeat(64),
  migrationHead: "0014_stage8_worker_activity",
  toolchain: { node: "v24.19.0", corepack: "0.35.0", pnpm: "11.21.0" },
  stage9Actions: 0,
});

test("Stage 8 canonical CI exposes a one-shot candidate runner", () => {
  assert.equal(typeof canonicalCi?.consumeStage8CanonicalCi, "function");
  assert.equal(typeof canonicalCi?.stage8CanonicalCiPathsFor, "function");
});

test("canonical CI includes repository, predecessor, and Stage 8 evidence gates", (context) => {
  if (!canonicalCi?.STAGE8_CANONICAL_CI_GATES) {
    context.skip("Stage 8 canonical CI is not implemented yet");
    return;
  }
  const labels = canonicalCi.STAGE8_CANONICAL_CI_GATES.map((gate) => gate.label);
  for (const required of [
    "protected-baseline:pre",
    "format:check",
    "lint",
    "build",
    "typecheck",
    "architecture:check",
    "test:unit",
    "stage7-predecessor-regression",
    "test:stage6-deployment-contract",
    "stage8-artifact-tests",
    "stage8-extracted-artifact-integrity",
    "stage8-postgresql-runtime-acceptance",
    "stage8-source-security-scan",
    "protected-baseline:post",
  ])
    assert.ok(labels.includes(required), `Missing canonical gate: ${required}`);
  assert.equal(new Set(labels).size, labels.length, "Canonical CI gate labels must be unique");
  assert.ok(!labels.includes("repository-ci"), "Canonical CI must report its executable gates");
  assert.ok(
    !canonicalCi.STAGE8_CANONICAL_CI_GATES.some((gate) => gate.script === "ci:verify"),
    "Stage 8 must not invoke the incompatible Stage 6 wrapper",
  );
  assert.ok(
    !canonicalCi.STAGE8_CANONICAL_CI_GATES.some((gate) => gate.script === "test:stage6:postgres"),
    "Stage 8 PostgreSQL tests replace the historical migration-head test",
  );
  assert.ok(
    !canonicalCi.STAGE8_CANONICAL_CI_GATES.some((gate) => gate.script === "security:scan:stage4"),
    "The legacy Stage 4 scanner must run against the immutable predecessor, not Stage 8 files",
  );
});

test("every canonical CI package gate is wired to a root script", async (context) => {
  if (!canonicalCi?.STAGE8_CANONICAL_CI_GATES) {
    context.skip("Stage 8 canonical CI is not implemented yet");
    return;
  }
  const packageManifest = JSON.parse(
    await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  );
  for (const gate of canonicalCi.STAGE8_CANONICAL_CI_GATES) {
    if (!gate.script) continue;
    assert.equal(
      typeof packageManifest.scripts[gate.script],
      "string",
      `Canonical CI gate script is missing: ${gate.script}`,
    );
  }
});

test("a failed one-shot candidate is persisted as consumed and cannot be rerun", async (context) => {
  if (typeof canonicalCi?.consumeStage8CanonicalCi !== "function") {
    context.skip("Stage 8 canonical CI is not implemented yet");
    return;
  }

  const root = await mkdtemp(path.join(tmpdir(), "travelos-stage8-canonical-ci-"));
  const sourceSnapshotSha256 = "a".repeat(64);
  const candidateRecord = {
    ...candidateRecordFor("gen01"),
    sourceSnapshotSha256,
  };
  let gateCalls = 0;
  const run = () =>
    canonicalCi.consumeStage8CanonicalCi({
      root,
      candidate: "gen01",
      candidateRecord,
      toolchainRecord: candidateRecord.toolchain,
      captureSnapshot: async () => ({ sha256: sourceSnapshotSha256 }),
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

    const paths = canonicalCi.stage8CanonicalCiPathsFor("gen01");
    const claim = JSON.parse(await readFile(path.join(root, paths.claimPath), "utf8"));
    const receipt = JSON.parse(await readFile(path.join(root, paths.receiptPath), "utf8"));
    assert.equal(claim.state, "CONSUMED");
    assert.equal(claim.invocationCount, 1);
    assert.equal(receipt.result, "FAIL");
    assert.equal(receipt.failedGate, canonicalCi.STAGE8_CANONICAL_CI_GATES[0].label);
    await assert.rejects(run(), /already exists/u);
    assert.equal(gateCalls, 1, "A consumed candidate must not execute any gate again");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a passing candidate records every gate and cannot be consumed twice", async (context) => {
  if (typeof canonicalCi?.consumeStage8CanonicalCi !== "function") {
    context.skip("Stage 8 canonical CI is not implemented yet");
    return;
  }

  const root = await mkdtemp(path.join(tmpdir(), "travelos-stage8-canonical-ci-pass-"));
  const candidateRecord = candidateRecordFor("gen02");
  let gateCalls = 0;
  try {
    const receipt = await canonicalCi.consumeStage8CanonicalCi({
      root,
      candidate: "gen02",
      candidateRecord,
      toolchainRecord: candidateRecord.toolchain,
      captureSnapshot: async () => ({ sha256: candidateRecord.sourceSnapshotSha256 }),
      runGate: async ({ gate }) => {
        gateCalls += 1;
        const output =
          gate.label === "stage8-pinned-toolchain"
            ? `> verify:pins\n${JSON.stringify(
                {
                  schemaVersion: 1,
                  result: "PASS",
                  toolchain: {
                    ...candidateRecord.toolchain,
                    node: candidateRecord.toolchain.node.slice(1),
                  },
                  policies: { checks: { workspace: { result: "PASS" } } },
                },
                null,
                2,
              )}\n`
            : `${gate.label}: PASS\n`;
        return { exitCode: 0, output };
      },
    });
    assert.equal(receipt.result, "PASS");
    assert.equal(receipt.stage9Actions, 0);
    assert.equal(receipt.completedGateCount, canonicalCi.STAGE8_CANONICAL_CI_GATES.length);
    assert.equal(gateCalls, canonicalCi.STAGE8_CANONICAL_CI_GATES.length);
    const paths = canonicalCi.stage8CanonicalCiPathsFor("gen02");
    const persisted = JSON.parse(await readFile(path.join(root, paths.receiptPath), "utf8"));
    assert.deepEqual(persisted, receipt);
    await assert.rejects(
      canonicalCi.consumeStage8CanonicalCi({
        root,
        candidate: "gen02",
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
    assert.equal(gateCalls, canonicalCi.STAGE8_CANONICAL_CI_GATES.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preflight rejection happens before any one-shot claim or gate execution", async (context) => {
  if (typeof canonicalCi?.runStage8CanonicalCi !== "function") {
    context.skip("Stage 8 canonical CI is not implemented yet");
    return;
  }

  const root = await mkdtemp(path.join(tmpdir(), "travelos-stage8-canonical-ci-preflight-"));
  let toolchainCalls = 0;
  let gateCalls = 0;
  const paths = canonicalCi.stage8CanonicalCiPathsFor("gen03");
  try {
    await assert.rejects(
      canonicalCi.runStage8CanonicalCi({
        root,
        candidate: "gen03",
        verifyCandidate: async () => {
          throw new Error("synthetic qualification rejection");
        },
        toolchain: async () => {
          toolchainCalls += 1;
          return candidateRecordFor("gen03").toolchain;
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

test("source drift after a gate consumes the candidate and prevents later gates", async (context) => {
  if (typeof canonicalCi?.consumeStage8CanonicalCi !== "function") {
    context.skip("Stage 8 canonical CI is not implemented yet");
    return;
  }

  const root = await mkdtemp(path.join(tmpdir(), "travelos-stage8-canonical-ci-drift-"));
  const candidateRecord = candidateRecordFor("gen04");
  const changedSnapshotSha256 = "e".repeat(64);
  let snapshotCalls = 0;
  let gateCalls = 0;
  try {
    const receipt = await canonicalCi.consumeStage8CanonicalCi({
      root,
      candidate: "gen04",
      candidateRecord,
      toolchainRecord: candidateRecord.toolchain,
      captureSnapshot: async () => ({
        sha256: ++snapshotCalls < 3 ? candidateRecord.sourceSnapshotSha256 : changedSnapshotSha256,
      }),
      runGate: async ({ gate }) => {
        gateCalls += 1;
        const output =
          gate.label === "stage8-pinned-toolchain"
            ? JSON.stringify({
                result: "PASS",
                toolchain: {
                  node: "24.19.0",
                  corepack: candidateRecord.toolchain.corepack,
                  pnpm: candidateRecord.toolchain.pnpm,
                },
              })
            : "unexpected later gate";
        return { exitCode: 0, output };
      },
      onGate: () => {},
    });
    assert.equal(receipt.result, "FAIL");
    assert.equal(receipt.failedGate, "stage8-pinned-toolchain:source-after");
    assert.equal(receipt.failureCode, "CANDIDATE_SOURCE_DRIFT");
    assert.equal(gateCalls, 1);
    const paths = canonicalCi.stage8CanonicalCiPathsFor("gen04");
    const claim = JSON.parse(await readFile(path.join(root, paths.claimPath), "utf8"));
    assert.equal(claim.state, "CONSUMED");
    assert.equal(claim.result, "FAIL");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
