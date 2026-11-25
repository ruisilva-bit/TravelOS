import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { corepackInvocation } from "./candidate.mjs";
import { deploymentContract } from "./deployment-contract.mjs";
import { verifyInheritedBaseline } from "./predecessor-baseline-adapter.mjs";
import { qualifyExtractedArtifact } from "./qualify-artifact.mjs";
import { historicalPrefix } from "./stage7-contract-regression.mjs";

const stage7 = "a57789b6662f0e0c0da5948c20eef6eb1e6bf4ec";
const stage9 = "f65a64d9c3aabd446ca95a605faed92630a72963";
const suites = [
  ["test-artifact.mjs", 16],
  ["test-build-artifact.mjs", 4],
  ["test-packaged-verifier.mjs", 26],
  ["test-runtime-acceptance-runner.mjs", 15],
  ["test-operator-installer.mjs", 6],
];
const gitBytes = (root, commit, file) =>
  execFileSync("git", ["show", `${commit}:${file}`], {
    cwd: root,
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });

// Historical suites execute unchanged in an isolated exact-commit clone. They
// test historical fixtures, not the separately qualified Stage 10 artifact.
export async function runStage7ArtifactRegression({
  root,
  payload,
  archive,
  receipt,
  expectedReceiptSha256,
  inputs,
  expectedNodeSha256,
}) {
  root = path.resolve(root);
  const invocation = corepackInvocation();
  await qualifyExtractedArtifact({
    payload,
    archive,
    receipt,
    expectedReceiptSha256,
    inputs,
    expectedNodeSha256,
  });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(payload, "deployment/stage10-contract.json"), "utf8")),
    deploymentContract(),
  );
  await verifyInheritedBaseline(root);
  const current = await readFile(path.join(root, "migrations/checksums.json"));
  assert.deepEqual(current, gitBytes(root, stage9, "migrations/checksums.json"));
  assert.deepEqual(current, await readFile(path.join(payload, "migrations/checksums.json")));
  await historicalPrefix(root, current);
  for (const [name] of suites) {
    const file = `tooling/ci/stage-7/${name}`;
    const accepted = gitBytes(root, stage7, file);
    assert.deepEqual(
      accepted,
      gitBytes(root, stage9, file),
      `Stage 9 historical test changed: ${file}`,
    );
    assert.deepEqual(
      await readFile(path.join(root, file)),
      accepted,
      `Historical test changed: ${file}`,
    );
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), "stage10-stage7-artifact-"));
  const clone = path.join(temporary, "checkout");
  const env = {
    PATH: invocation.path,
    HOME: process.env.HOME,
    TMPDIR: temporary,
    LANG: "C.UTF-8",
    TZ: "UTC",
    COREPACK_ENABLE_NETWORK: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
  let success = false;
  try {
    const run = (command, args, cwd, label, timeout = 180000) => {
      const child = spawnSync(command, args, {
        cwd,
        env,
        encoding: "utf8",
        timeout,
        maxBuffer: 4 * 1024 * 1024,
      });
      const evidence = `status=${child.status} signal=${child.signal} error=${child.error?.message ?? "none"}\nstdout:\n${child.stdout ?? ""}\nstderr:\n${child.stderr ?? ""}`;
      assert.equal(child.error, undefined, `${label}\n${evidence}`);
      assert.equal(child.status, 0, `${label}\n${evidence}`);
      return child.stdout;
    };
    run(
      "git",
      ["clone", "--quiet", "--no-hardlinks", "--no-checkout", "--", root, clone],
      temporary,
      "clone",
    );
    run("git", ["checkout", "--quiet", "--detach", stage7], clone, "checkout");
    assert.equal(run("git", ["rev-parse", "HEAD"], clone, "revision").trim(), stage7);
    assert.equal(
      run("git", ["status", "--porcelain", "--untracked-files=all"], clone, "clean checkout"),
      "",
    );
    run(
      invocation.command,
      [
        ...invocation.prefix,
        "pnpm",
        "install",
        "--offline",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--package-import-method=copy",
      ],
      clone,
      "offline dependencies",
    );
    const reports = [];
    for (const [name, count] of suites) {
      const stdout = run(invocation.command, [`tooling/ci/stage-7/${name}`], clone, name);
      await writeFile(path.join(temporary, `${name}.json`), stdout);
      const report = JSON.parse(stdout);
      assert.equal(report.result, "PASS", stdout);
      assert.equal(report.cases, count, stdout);
      if (name === "test-artifact.mjs") {
        assert.equal(report.positiveCases, 2);
        assert.equal(report.negativeControls, 14);
      }
      if (name === "test-operator-installer.mjs") assert.equal(report.mutatingCommands, 0);
      reports.push({ name, count });
    }
    success = true;
    return {
      result: "PASS",
      reports,
      obligations: 67,
      skipped: 0,
      scope: "QUALIFIED_STAGE10_ARTIFACT_AND_UNCHANGED_HISTORICAL_STAGE7_FIXTURES_NOT_CANONICAL_CI",
    };
  } catch (error) {
    error.message += `\nFailure evidence retained at ${temporary}`;
    throw error;
  } finally {
    if (success) await rm(temporary, { recursive: true, force: false });
  }
}
