import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

import { PREDECESSOR } from "./source-snapshot.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const predecessorRef = "travelos-phase-1-m1-stage-7-gen15-go";
const regressionScripts = Object.freeze([
  ["stage7-artifact", "test:stage7:artifact"],
  ["stage7-deployment-contract", "test:stage7:deployment-contract"],
  ["stage7-predecessor-security-scan", "security:scan:stage4"],
]);
const environmentKeys = ["COREPACK_HOME", "HOME", "PATH", "PNPM_HOME", "TMPDIR", "XDG_CACHE_HOME"];

const childEnvironment = (tempDirectory) => ({
  ...Object.fromEntries(
    environmentKeys.filter((name) => process.env[name]).map((name) => [name, process.env[name]]),
  ),
  CI: "true",
  NODE_ENV: "development",
  TMPDIR: tempDirectory,
});

const defaultRunCommand = (command, args, options) =>
  spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });

const assertCommandPassed = (result, command) => {
  assert.equal(result?.status, 0, `Stage 7 predecessor command failed: ${command}`);
};

export const runStage7PredecessorRegressionSuite = async ({
  root = repositoryRoot,
  tempDirectory = process.env.TMPDIR ?? os.tmpdir(),
  runCommand = defaultRunCommand,
} = {}) => {
  const workspace = path.resolve(root);
  const scratchRoot = await realpath(tempDirectory);
  const checkoutRoot = await mkdtemp(path.join(scratchRoot, "travelos-stage8-stage7-predecessor-"));
  const env = childEnvironment(scratchRoot);
  const commands = [];
  let worktreeAdded = false;
  let failedCommand = null;
  let failureCode = null;

  try {
    const tag = runCommand("git", ["rev-parse", `${predecessorRef}^{commit}`], {
      cwd: workspace,
      env,
    });
    assertCommandPassed(tag, "resolve-stage7-predecessor-tag");
    assert.equal(tag.stdout.trim(), PREDECESSOR, "Stage 7 predecessor tag moved");

    const add = runCommand("git", ["worktree", "add", "--detach", checkoutRoot, PREDECESSOR], {
      cwd: workspace,
      env,
    });
    assertCommandPassed(add, "create-stage7-predecessor-worktree");
    worktreeAdded = true;

    const head = runCommand("git", ["rev-parse", "HEAD"], { cwd: checkoutRoot, env });
    assertCommandPassed(head, "verify-stage7-predecessor-worktree");
    assert.equal(head.stdout.trim(), PREDECESSOR, "Stage 7 worktree is not the accepted commit");
    const status = runCommand("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: checkoutRoot,
      env,
    });
    assertCommandPassed(status, "verify-clean-stage7-predecessor-worktree");
    assert.equal(status.stdout.trim(), "", "Stage 7 predecessor worktree is not clean");

    const invocations = [
      {
        label: "predecessor-offline-install",
        args: ["pnpm", "install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
      },
      ...regressionScripts.map(([label, script]) => ({
        label,
        args: ["pnpm", "--silent", "run", script],
      })),
    ];
    for (const invocation of invocations) {
      failedCommand = invocation.label;
      const child = runCommand("corepack", invocation.args, {
        cwd: checkoutRoot,
        env,
      });
      const stdout = String(child?.stdout ?? "");
      const stderr = String(child?.stderr ?? "");
      const output = `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`;
      const exitCode = Number.isInteger(child?.status) ? child.status : 1;
      commands.push({
        label: invocation.label,
        command: ["corepack", ...invocation.args].join(" "),
        result: exitCode === 0 ? "PASS" : "FAIL",
        exitCode,
        outputBytes: Buffer.byteLength(output),
        outputSha256: createHash("sha256").update(output).digest("hex"),
        output,
      });
      if (exitCode !== 0) {
        failureCode =
          invocation.label === "predecessor-offline-install"
            ? "PREDECESSOR_OFFLINE_INSTALL_FAILED"
            : invocation.label === "stage7-predecessor-security-scan"
              ? "STAGE7_PREDECESSOR_SECURITY_SCAN_FAILED"
              : "STAGE7_PREDECESSOR_REGRESSION_FAILED";
        break;
      }
    }
  } catch {
    failureCode ??= "STAGE7_PREDECESSOR_SETUP_FAILED";
  } finally {
    if (worktreeAdded) {
      const removal = runCommand("git", ["worktree", "remove", "--force", checkoutRoot], {
        cwd: workspace,
        env,
      });
      if (removal?.status === 0) worktreeAdded = false;
      else {
        failedCommand = "predecessor-worktree-cleanup";
        failureCode = "PREDECESSOR_WORKTREE_CLEANUP_FAILED";
      }
    }
    if (!worktreeAdded) await rm(checkoutRoot, { recursive: true, force: true });
  }

  const result = failureCode === null ? "PASS" : "FAIL";
  return {
    schemaVersion: 1,
    result,
    stage: "PHASE_1_M1_STAGE_8",
    predecessor: PREDECESSOR,
    predecessorRef,
    commands,
    failedCommand: result === "FAIL" ? failedCommand : null,
    failureCode,
    stage9Actions: 0,
  };
};

const directEntry =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (directEntry) {
  try {
    const result = await runStage7PredecessorRegressionSuite();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.result !== "PASS") process.exitCode = 1;
  } catch {
    process.stderr.write('{"result":"FAIL","failureCode":"STAGE7_PREDECESSOR_RUNNER_FAILED"}\n');
    process.exitCode = 1;
  }
}
