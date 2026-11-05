import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import { prunePackagedTestFiles } from "../stage-7/build-artifact.mjs";
import { verifyStage9DeploymentContract } from "../../deployment/verify-stage9-deployment-contract.mjs";
import { hashFile, inventory, jsonBytes, sha256, verifyArtifact } from "./artifact-integrity.mjs";
import {
  NODE_VERSION,
  PNPM_VERSION,
  STAGE8_ACCEPTED_ARTIFACT_ID,
  STAGE8_ACCEPTED_ARTIFACT_SHA256,
  STAGE9_BRANCH,
  STAGE9_CURRENT_ARTIFACT_ID,
  STAGE9_MIGRATION_HEAD,
  STAGE9_PREDECESSOR,
  STAGE9_STAGE,
  STAGE9_V1_CONTRACT_PATH,
  STAGE9_V2_CONTRACT_PATH,
  STAGE9_V3_CONTRACT_PATH,
  STAGE9_BASELINE_PATH,
} from "./constants.mjs";
import { sourceSnapshot } from "./source-snapshot.mjs";

const repository = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const run = (command, args, env = process.env) =>
  execFileSync(command, args, {
    cwd: repository,
    env,
    stdio: "pipe",
    maxBuffer: 128 * 1024 * 1024,
  });
export const createProductionArtifactBuildEnvironment = (environment = process.env) => ({
  ...environment,
  CI: "true",
  NODE_ENV: "production",
});
const requireGeneration = (candidate) => {
  assert.match(candidate, /^gen[0-9]{2}$/u, "Invalid Stage 9 generation");
  assert.notEqual(candidate, "gen00", "Invalid Stage 9 generation");
};

export const validateBuildRequest = ({
  repositoryRoot = repository,
  output,
  candidate,
  branch,
  nodeVersion,
  pnpmVersion,
}) => {
  requireGeneration(candidate);
  assert.equal(branch, STAGE9_BRANCH, "Stage 9 source branch mismatch");
  assert.equal(nodeVersion, `v${NODE_VERSION}`, "Node version mismatch");
  assert.equal(pnpmVersion, PNPM_VERSION, "pnpm version mismatch");
  assert.ok(typeof output === "string" && output.length > 0, "Artifact output path is required");

  const workspace = path.resolve(repositoryRoot);
  const destination = path.resolve(workspace, output);
  const expected = path.join(workspace, ".hermes", "state", `stage9-${candidate}-artifact`);
  assert.equal(destination, expected, "Artifact must use the candidate's local .hermes/state path");
  return destination;
};

export const assertBuildOutputsAvailable = async (root) => {
  for (const target of [root, `${root}.tar.gz`, `${root}-build.json`]) {
    try {
      await lstat(target);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    throw new Error("Stage 9 build output already exists");
  }
};

export const createStage9ReleaseMetadata = ({
  candidate,
  sourceCommit,
  snapshotSha256,
  deploymentExtensionSha256,
}) => {
  requireGeneration(candidate);
  assert.match(sourceCommit, /^[a-f0-9]{40}$/u, "Invalid Stage 9 source commit");
  assert.match(snapshotSha256, /^[a-f0-9]{64}$/u, "Invalid Stage 9 source snapshot hash");
  assert.match(
    deploymentExtensionSha256,
    /^[a-f0-9]{64}$/u,
    "Invalid Stage 9 deployment extension hash",
  );

  return {
    schemaVersion: 1,
    stage: STAGE9_STAGE,
    environment: "DEVELOPMENT",
    candidate,
    artifactId: `travelos-stage9-${candidate}-${snapshotSha256.slice(0, 8)}`,
    source: {
      baselineCommit: sourceCommit,
      identity: "WORKING_TREE_CONTENT_SNAPSHOT_NOT_BASELINE_COMMIT",
      branch: STAGE9_BRANCH,
      predecessor: STAGE9_PREDECESSOR,
      predecessorArtifactId: STAGE8_ACCEPTED_ARTIFACT_ID,
      predecessorArtifactSha256: STAGE8_ACCEPTED_ARTIFACT_SHA256,
      snapshotSha256,
    },
    toolchain: { node: NODE_VERSION, pnpm: PNPM_VERSION },
    deploymentExtensionSha256,
    expectedCurrentArtifactId: STAGE9_CURRENT_ARTIFACT_ID,
    migrationHead: STAGE9_MIGRATION_HEAD,
    productionSigning: "NOT_PRODUCTION_SIGNED",
    qualification: "EXTERNAL_CANONICAL_CI_RECEIPT_REQUIRED",
    stage10Actions: 0,
  };
};

export const buildArtifact = async ({ output, candidate = "gen01" }) => {
  const branch = run("git", ["branch", "--show-current"]).toString().trim();
  const pnpmVersion = run("corepack", ["pnpm", "--version"]).toString().trim();
  const root = validateBuildRequest({
    output,
    candidate,
    branch,
    nodeVersion: process.version,
    pnpmVersion,
  });
  await assertBuildOutputsAvailable(root);
  await verifyStage9DeploymentContract({ root: repository });
  const snapshot = await sourceSnapshot(repository);
  const sourceCommit = snapshot.snapshot.sourceCommit;
  const extensionBytes = await readFile(path.join(repository, STAGE9_V3_CONTRACT_PATH));
  const archive = `${root}.tar.gz`;
  const receiptPath = `${root}-build.json`;
  let createdRoot = false;
  let createdArchive = false;
  let createdReceipt = false;
  let packageDeploymentStarted = false;
  let completed = false;

  try {
    await mkdir(path.dirname(root), { recursive: true });
    const workspaceRealPath = await realpath(repository);
    const outputParentRealPath = await realpath(path.dirname(root));
    assert.equal(
      path.relative(workspaceRealPath, outputParentRealPath).split(path.sep).join("/"),
      ".hermes/state",
      "Artifact output must remain in the physical local worktree",
    );
    await mkdir(root, { recursive: false });
    createdRoot = true;

    run("corepack", ["pnpm", "build"], createProductionArtifactBuildEnvironment());
    try {
      for (const [name, target] of [
        ["admin-api", "apps/admin-api"],
        ["portal-api", "apps/portal-api"],
        ["worker", "apps/worker"],
        ["migrator", "migrator"],
      ]) {
        const destination = path.join(root, target);
        await mkdir(path.dirname(destination), { recursive: true });
        packageDeploymentStarted = true;
        run(
          "corepack",
          [
            "pnpm",
            "--config.inject-workspace-packages=true",
            "--filter",
            `@travelos/${name}`,
            "deploy",
            "--prod",
            destination,
          ],
          { ...process.env, CI: "true", NODE_ENV: "production" },
        );
        await prunePackagedTestFiles(destination);
      }
    } finally {
      if (packageDeploymentStarted)
        run("corepack", ["pnpm", "install", "--offline", "--frozen-lockfile", "--ignore-scripts"], {
          ...process.env,
          CI: "true",
          NODE_ENV: "development",
        });
    }

    for (const [from, to] of [
      ["apps/admin-web/dist", "admin-web"],
      ["apps/portal-web/dist", "portal-web"],
      ["migrations", "migrations"],
      ["migrations", "migrator/migrations"],
    ])
      await cp(path.join(repository, from), path.join(root, to), {
        recursive: true,
        force: false,
        errorOnExist: true,
      });

    for (const directory of [
      "deployment",
      "operator",
      "provenance",
      "runtime/node/bin",
      "instance-manifest",
    ])
      await mkdir(path.join(root, directory), { recursive: true });

    for (const [from, to] of [
      ["tooling/deployment/run-stage6-migrations.mjs", "migrator/run-stage6-migrations.mjs"],
      ["deploy/contracts/deployment-contract.v1.json", "deployment/deployment-contract.v1.json"],
      [STAGE9_V1_CONTRACT_PATH, "deployment/stage-9-extension.v1.json"],
      [STAGE9_V2_CONTRACT_PATH, "deployment/stage-9-extension.v2.json"],
      [STAGE9_V3_CONTRACT_PATH, "deployment/stage-9-extension.v3.json"],
      [STAGE9_BASELINE_PATH, "provenance/stage9-successor-baseline.json"],
      ["deploy/caddy/Caddyfile.stage9-development", "deployment/Caddyfile"],
      ["tooling/ci/stage-9/artifact-integrity.mjs", "deployment/verify-artifact.mjs"],
      ["tooling/ci/stage-9/constants.mjs", "deployment/constants.mjs"],
      ["tooling/ci/stage-8/install-runtime.mjs", "deployment/install-runtime.mjs"],
      ["deploy/systemd/worker-stage8.conf", "deployment/worker-stage8.conf"],
      [
        "deploy/systemd/travelos-stage8-controlled-acceptance.service",
        "deployment/travelos-stage8-controlled-acceptance.service",
      ],
      [
        "deploy/systemd/travelos-stage8-runtime-acceptance.service",
        "deployment/travelos-stage8-runtime-acceptance.service",
      ],
      ["tooling/ci/stage-8/runtime-acceptance.mjs", "operator/stage8-runtime-acceptance.mjs"],
      ["tooling/ci/stage-8/controlled-worker.mjs", "operator/controlled-worker.mjs"],
      ["tooling/ci/stage-7/runtime-acceptance-runner.mjs", "operator/stage7-regression.mjs"],
      [
        "tooling/ci/stage-9/static-runtime-acceptance.mjs",
        "operator/stage9-static-runtime-acceptance.mjs",
      ],
      ["tooling/deployment/stage9-development-apply.mjs", "operator/stage9-development-apply.mjs"],
      ["deploy/manifests/development.example.json", "instance-manifest/development.example.json"],
      ["pnpm-lock.yaml", "provenance/pnpm-lock.yaml"],
    ])
      await copyFile(path.join(repository, from), path.join(root, to));

    await copyFile(process.execPath, path.join(root, "runtime/node/bin/node"));
    await chmod(path.join(root, "runtime/node/bin/node"), 0o755);
    await writeFile(path.join(root, "provenance/source-snapshot.json"), snapshot.bytes, {
      flag: "wx",
    });
    const release = createStage9ReleaseMetadata({
      candidate,
      sourceCommit,
      snapshotSha256: snapshot.sha256,
      deploymentExtensionSha256: sha256(extensionBytes),
    });
    await writeFile(path.join(root, "release.json"), jsonBytes(release), { flag: "wx" });
    await writeFile(
      path.join(root, "payload-manifest.json"),
      jsonBytes({
        schemaVersion: 1,
        excludes: ["payload-manifest.json"],
        files: await inventory(root),
      }),
      { flag: "wx" },
    );

    const verified = await verifyArtifact(root);
    assert.equal(
      (await sourceSnapshot(repository)).sha256,
      snapshot.sha256,
      "Build mutated source",
    );
    await writeFile(archive, "", { flag: "wx" });
    createdArchive = true;
    run("tar", [
      "--create",
      "--gzip",
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "--format=gnu",
      `--file=${archive}`,
      "--directory",
      root,
      ".",
    ]);
    const receipt = {
      ...verified,
      archive,
      ...(await hashFile(archive)),
      nodeSha256: (await hashFile(path.join(root, "runtime/node/bin/node"))).sha256,
      compilationHost: "LOCAL_WORKTREE",
      compileOnCt200: false,
      stage10Actions: 0,
    };
    await writeFile(receiptPath, jsonBytes(receipt), { flag: "wx" });
    createdReceipt = true;
    completed = true;
    return receipt;
  } finally {
    if (!completed && createdRoot) {
      await rm(root, { recursive: true, force: true });
      if (createdArchive) await rm(archive, { force: true });
      if (createdReceipt) await rm(receiptPath, { force: true });
    }
  }
};

const invokedPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
const modulePath = await realpath(fileURLToPath(import.meta.url));
if (invokedPath !== null && invokedPath === modulePath) {
  try {
    const args = process.argv.slice(2);
    assert.ok(
      args.length >= 1 && args.length <= 2,
      "Usage: build-artifact.mjs OUTPUT [GENERATION]",
    );
    const receipt = await buildArtifact({ output: args[0], candidate: args[1] ?? "gen01" });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch {
    process.stderr.write(
      `${JSON.stringify({ result: "FAIL", code: "STAGE9_ARTIFACT_BUILD_FAILED" })}\n`,
    );
    process.exitCode = 1;
  }
}
