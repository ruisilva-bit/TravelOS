import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { URL } from "node:url";

let predecessorRegression;
try {
  predecessorRegression = await import("./predecessor-regression.mjs");
} catch {
  predecessorRegression = undefined;
}

const repositoryRoot = path.resolve(new URL("../../..", import.meta.url).pathname);

test("Stage 7 regression suites run from a disposable checkout of the accepted predecessor", async () => {
  if (typeof predecessorRegression?.runStage7PredecessorRegressionSuite !== "function") {
    assert.fail("Stage 8 predecessor regression runner is not implemented");
  }

  const scratch = await mkdtemp(
    path.join(tmpdir(), "travelos-stage8-predecessor-regression-test-"),
  );
  const invocations = [];
  let checkoutPath;
  const runCommand = (command, args, options) => {
    if (command !== "corepack")
      return spawnSync(command, args, {
        ...options,
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
      });

    const cwd = options.cwd;
    checkoutPath = cwd;
    invocations.push({ args, cwd });
    assert.ok(cwd.startsWith(scratch + path.sep));
    assert.equal(
      existsSync(path.join(cwd, "tooling/ci/stage-8/run-canonical-ci.mjs")),
      false,
      "Stage 7 tests must not consume successor source files",
    );
    const manifest = JSON.parse(readFileSync(path.join(cwd, "migrations/checksums.json"), "utf8"));
    assert.equal(
      manifest.migrations.some((migration) => migration.file === "0014_stage8_worker_activity.cjs"),
      false,
      "Stage 7 tests must see only the immutable predecessor migration chain",
    );
    return { status: 0, stdout: '{"result":"PASS"}\n', stderr: "" };
  };

  try {
    const result = await predecessorRegression.runStage7PredecessorRegressionSuite({
      root: repositoryRoot,
      tempDirectory: scratch,
      runCommand,
    });
    assert.equal(result.result, "PASS");
    assert.equal(result.stage, "PHASE_1_M1_STAGE_8");
    assert.equal(result.predecessor, "a57789b6662f0e0c0da5948c20eef6eb1e6bf4ec");
    assert.equal(result.stage9Actions, 0);
    assert.deepEqual(
      invocations.map(({ args }) => args),
      [
        ["pnpm", "install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
        ["pnpm", "--silent", "run", "test:stage7:artifact"],
        ["pnpm", "--silent", "run", "test:stage7:deployment-contract"],
        ["pnpm", "--silent", "run", "security:scan:stage4"],
      ],
    );
    for (const invocation of result.commands) {
      assert.equal(invocation.result, "PASS");
      assert.equal(invocation.exitCode, 0);
      assert.match(invocation.outputSha256, /^[a-f0-9]{64}$/u);
    }
    assert.ok(checkoutPath);
    await assert.rejects(readFile(path.join(checkoutPath, "migrations/checksums.json")), {
      code: "ENOENT",
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("a predecessor regression failure is reported and later suites do not run", async (context) => {
  if (typeof predecessorRegression?.runStage7PredecessorRegressionSuite !== "function") {
    context.skip("Stage 8 predecessor regression runner is not implemented yet");
    return;
  }

  const scratch = await mkdtemp(path.join(tmpdir(), "travelos-stage8-predecessor-failure-test-"));
  const commands = [];
  let checkoutPath;
  const runCommand = (command, args, options) => {
    if (command !== "corepack")
      return spawnSync(command, args, {
        ...options,
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
      });
    checkoutPath = options.cwd;
    commands.push(args);
    if (args.includes("test:stage7:artifact"))
      return { status: 1, stdout: "synthetic sanitized failure\n", stderr: "" };
    return { status: 0, stdout: '{"result":"PASS"}\n', stderr: "" };
  };

  try {
    const result = await predecessorRegression.runStage7PredecessorRegressionSuite({
      root: repositoryRoot,
      tempDirectory: scratch,
      runCommand,
    });
    assert.equal(result.result, "FAIL");
    assert.equal(result.failedCommand, "stage7-artifact");
    assert.equal(result.commands.length, 2);
    assert.equal(result.commands[1].exitCode, 1);
    assert.ok(!commands.some((args) => args.includes("test:stage7:deployment-contract")));
    await assert.rejects(readFile(path.join(checkoutPath, "migrations/checksums.json")), {
      code: "ENOENT",
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
