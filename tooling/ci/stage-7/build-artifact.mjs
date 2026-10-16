import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { STAGE7_DEFAULT_GENERATION } from "../stage-7-successor-baseline.mjs";
import { verifyStage7DeploymentContract } from "./verify-deployment-contract.mjs";
import { verifyStage7Artifact } from "./verify-artifact.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const expectedToolchain = Object.freeze({ node: "24.19.0", corepack: "0.35.0", pnpm: "11.21.0" });
const migrationName = "0012_stage7_portal_trip_access.cjs";
const bytewise = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashPath = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve({ sha256: hash.digest("hex"), bytes }));
  });
const safeJsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const assertGeneration = (generation) => {
  assert.match(generation, /^gen[0-9]{2,}$/u, "Invalid Stage 7 generation");
  assert.ok(Number(generation.slice(3)) > 0, "Invalid Stage 7 generation");
};
const stage7Paths = (root, generation) => {
  const prefix = `.hermes/state/stage7-${generation}-artifact`;
  return {
    artifactRoot: path.join(root, prefix),
    archivePath: path.join(root, `${prefix}.tar.gz`),
    receiptPath: path.join(root, `${prefix}-build.json`),
  };
};

export const createStage7ReleaseMetadata = ({
  generation,
  branch,
  commit,
  tree,
  successorBaselineSha256,
  lockfileSha256,
  nodeBinarySha256,
  migrationSha256,
  migrationChecksumManifestSha256,
  deploymentContractSha256,
  stage7DeploymentContractSha256,
  stage7VerifierSha256,
  runtimeAcceptanceSha256,
}) => {
  assertGeneration(generation);
  assert.equal(branch, "phase-1/stage-7", "Stage 7 source branch mismatch");
  assert.match(commit, /^[a-f0-9]{40}$/u, "Invalid Stage 7 source commit");
  assert.match(tree, /^[a-f0-9]{40}$/u, "Invalid Stage 7 source tree");
  for (const [name, value] of Object.entries({
    successorBaselineSha256,
    lockfileSha256,
    nodeBinarySha256,
    migrationSha256,
    migrationChecksumManifestSha256,
    deploymentContractSha256,
    stage7DeploymentContractSha256,
    stage7VerifierSha256,
    runtimeAcceptanceSha256,
  })) {
    assert.match(value ?? "", /^[a-f0-9]{64}$/u, `Invalid ${name}`);
  }
  return {
    schemaVersion: 1,
    artifactId: `travelos-phase-1-m1-stage-7-${generation}-${commit.slice(0, 8)}`,
    designation: "DEVELOPMENT_CANDIDATE_UNQUALIFIED",
    productionSigning: { status: "NOT_PRODUCTION_SIGNED" },
    source: {
      branch,
      commit,
      tree,
      successorBaselineGeneration: generation,
      successorBaselineSha256,
      lockfilePath: "provenance/pnpm-lock.yaml",
      lockfileSha256,
    },
    toolchain: { ...expectedToolchain },
    qualification: { canonicalCi: "PENDING_ONE_AUTHORIZED_RUN", runCountForGeneration: 0 },
    database: {
      migrationHead: migrationName,
      migrationFileSha256: migrationSha256,
      migrationChecksumManifestPath: "migrations/checksums.json",
      migrationChecksumManifestSha256,
      runnerEntrypoint: "migrator/dist/packages/migrator/src/run-migrations.js",
      canonicalRunner: "migrator/dist/tooling/database/migration-runner.js",
      deploymentEntrypoint: "migrator/run-stage6-migrations.mjs",
      identityContract: {
        sessionUser: "travelos_migrator",
        roleSwitch: "SET ROLE travelos_owner",
        currentUser: "travelos_owner",
      },
    },
    deployables: [
      { name: "Admin SPA", path: "admin-web" },
      { name: "Portal SPA", path: "portal-web" },
      { name: "Admin API", path: "apps/admin-api" },
      { name: "Portal API", path: "apps/portal-api" },
      { name: "Worker", path: "apps/worker" },
      { name: "Canonical database migrator", path: "migrator" },
      { name: "Database migrations", path: "migrations" },
    ],
    runtime: {
      node: {
        version: "24.19.0",
        path: "runtime/node",
        binaryPath: "runtime/node/bin/node",
        binarySha256: nodeBinarySha256,
      },
    },
    deploymentContract: {
      path: "deployment/deployment-contract.v1.json",
      schemaVersion: 1,
      sha256: deploymentContractSha256,
    },
    stage7DeploymentContract: {
      path: "deployment/stage-7-extension.v1.json",
      schemaVersion: 1,
      sha256: stage7DeploymentContractSha256,
    },
    stage7Verifier: {
      path: "deployment/verify-stage7-artifact.mjs",
      sha256: stage7VerifierSha256,
    },
    runtimeAcceptance: {
      sourcePath: "tooling/ci/stage-7/runtime-acceptance-runner.mjs",
      runnerPath: "operator/stage7-runtime-acceptance.mjs",
      sha256: runtimeAcceptanceSha256,
      executionMode: "DEVELOPMENT_OPERATOR_ONE_SHOT",
      operatorOnly: true,
      persistentService: false,
      listener: false,
      publicSignupEndpoint: false,
      credentialDirectoryEnv: "CREDENTIALS_DIRECTORY",
    },
  };
};

const run = (command, args, { cwd = repositoryRoot, env = process.env, label = command } = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `${label} failed${result.signal ? ` (${result.signal})` : ""}: ${(result.stderr || result.stdout || result.error?.message || "").slice(-4000)}`,
  );
  return result.stdout.trim();
};
const verifyPinnedToolchain = () => {
  const actual = {
    node: process.version.slice(1),
    corepack: run("corepack", ["--version"], { label: "Corepack version check" }),
    pnpm: run("corepack", ["pnpm", "--version"], { label: "pnpm version check" }),
  };
  assert.deepEqual(
    actual,
    expectedToolchain,
    "Artifact build requires the pinned Stage 7 toolchain",
  );
  return actual;
};
const assertAbsent = async (absolutePath) => {
  try {
    await lstat(absolutePath);
    throw new Error(`Refusing to overwrite existing Stage 7 artifact output: ${absolutePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};
const copyDirectory = async (source, destination) =>
  cp(source, destination, { recursive: true, errorOnExist: true, force: false });
const deployPackage = (packageName, destination, env, cwd) =>
  run(
    "corepack",
    [
      "pnpm",
      "--config.inject-workspace-packages=true",
      "--filter",
      packageName,
      "deploy",
      "--prod",
      destination,
    ],
    { cwd, env, label: `Production package deploy ${packageName}` },
  );

export const prunePackagedTestFiles = async (packageRoot) => {
  const removed = [];
  const testDirectories = new Set(["test", "tests", "__tests__"]);
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(directory, entry.name);
      const relativePath = path.relative(packageRoot, entryPath).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (testDirectories.has(entry.name)) {
          await rm(entryPath, { recursive: true });
          removed.push(relativePath);
        } else if (entry.name !== "node_modules") {
          await visit(entryPath);
        }
      } else if (entry.isFile() && /\.(?:test|spec)\.[^.]+$/u.test(entry.name)) {
        await rm(entryPath);
        removed.push(relativePath);
      }
    }
  };

  await visit(packageRoot);
  return removed.sort(bytewise);
};

const inventoryArtifact = async (root) => {
  const rows = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => bytewise(left.name, right.name));
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      const relativePath = path.relative(root, file).split(path.sep).join("/");
      if (["payload-manifest.json", "checksums.txt"].includes(relativePath)) continue;
      const metadata = await lstat(file);
      if (metadata.isSymbolicLink()) {
        const target = await readlink(file);
        const resolved = await realpath(file);
        assert.ok(
          resolved === root || resolved.startsWith(`${root}${path.sep}`),
          `Artifact symlink escapes release root: ${relativePath}`,
        );
        rows.push({
          path: relativePath,
          type: "symlink",
          target,
          targetSha256: sha256(Buffer.from(target)),
        });
      } else if (metadata.isDirectory()) {
        await visit(file);
      } else {
        assert.ok(metadata.isFile(), `Unsupported artifact entry: ${relativePath}`);
        const digest = await hashPath(file);
        rows.push({ path: relativePath, type: "file", bytes: digest.bytes, sha256: digest.sha256 });
      }
    }
  };
  await visit(root);
  return rows.sort((left, right) => bytewise(left.path, right.path));
};
const writePayloadManifests = async (root) => {
  const files = await inventoryArtifact(root);
  await writeFile(
    path.join(root, "payload-manifest.json"),
    safeJsonBytes({
      schemaVersion: 1,
      fileManifestExcludes: ["payload-manifest.json", "checksums.txt"],
      files,
    }),
    { flag: "wx", mode: 0o644 },
  );
  await writeFile(
    path.join(root, "checksums.txt"),
    files
      .filter((row) => row.type === "file")
      .map((row) => `${row.sha256}  ${row.path}\n`)
      .join(""),
    { flag: "wx", mode: 0o644 },
  );
  return { entries: files.length, files: files.filter((row) => row.type === "file").length };
};

const prepareArtifactPayload = async ({ root, generation, stagingRoot, toolchain }) => {
  const deployment = await verifyStage7DeploymentContract({ root, generation });
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const sourceTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const sourceBranch = execFileSync("git", ["branch", "--show-current"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const lockfileBytes = await readFile(path.join(root, "pnpm-lock.yaml"));
  const committedLockfileBytes = execFileSync("git", ["show", "HEAD:pnpm-lock.yaml"], {
    cwd: root,
  });
  assert.deepEqual(
    lockfileBytes,
    committedLockfileBytes,
    "Candidate lockfile differs from committed bytes",
  );
  const baselineBytes = await readFile(path.join(root, deployment.baselinePath));
  assert.equal(
    sha256(baselineBytes),
    deployment.baselineSha256,
    "Candidate baseline changed after verification",
  );
  const baseContractBytes = await readFile(
    path.join(root, "deploy/contracts/deployment-contract.v1.json"),
  );
  const extensionBytes = await readFile(
    path.join(root, "deploy/contracts/stage-7-extension.v1.json"),
  );
  const verifierBytes = await readFile(path.join(root, "tooling/ci/stage-7/verify-artifact.mjs"));
  const migrationBytes = await readFile(path.join(root, "migrations", migrationName));
  const migrationChecksumBytes = await readFile(path.join(root, "migrations/checksums.json"));
  const runtimeAcceptanceBytes = await readFile(
    path.join(root, "tooling/ci/stage-7/runtime-acceptance-runner.mjs"),
  );
  const nodeBinary = process.execPath;
  const nodeBinaryDigest = await hashPath(nodeBinary);

  run("corepack", ["pnpm", "run", "build"], {
    cwd: root,
    env: { ...process.env, CI: "true", NODE_ENV: "development" },
    label: "Pinned workspace production build",
  });
  const env = { ...process.env, CI: "true", NODE_ENV: "production" };
  for (const [packageName, relativeTarget] of [
    ["@travelos/admin-api", "apps/admin-api"],
    ["@travelos/portal-api", "apps/portal-api"],
    ["@travelos/worker", "apps/worker"],
    ["@travelos/migrator", "migrator"],
  ]) {
    const target = path.join(stagingRoot, relativeTarget);
    await mkdir(path.dirname(target), { recursive: true });
    deployPackage(packageName, target, env, root);
    await prunePackagedTestFiles(target);
  }

  await copyDirectory(path.join(root, "apps/admin-web/dist"), path.join(stagingRoot, "admin-web"));
  await copyDirectory(
    path.join(root, "apps/portal-web/dist"),
    path.join(stagingRoot, "portal-web"),
  );
  await copyDirectory(path.join(root, "migrations"), path.join(stagingRoot, "migrations"));
  await copyDirectory(path.join(root, "migrations"), path.join(stagingRoot, "migrator/migrations"));
  await mkdir(path.join(stagingRoot, "deployment"), { recursive: true });
  await mkdir(path.join(stagingRoot, "instance-manifest"), { recursive: true });
  await mkdir(path.join(stagingRoot, "provenance"), { recursive: true });
  await mkdir(path.join(stagingRoot, "operator"), { recursive: true });
  await mkdir(path.join(stagingRoot, "runtime/node/bin"), { recursive: true });
  await copyFile(
    path.join(root, "tooling/deployment/run-stage6-migrations.mjs"),
    path.join(stagingRoot, "migrator/run-stage6-migrations.mjs"),
  );
  await copyFile(
    path.join(root, "deploy/contracts/deployment-contract.v1.json"),
    path.join(stagingRoot, "deployment/deployment-contract.v1.json"),
  );
  await copyFile(
    path.join(root, "deploy/contracts/stage-7-extension.v1.json"),
    path.join(stagingRoot, "deployment/stage-7-extension.v1.json"),
  );
  await copyFile(
    path.join(root, "tooling/ci/stage-7/verify-artifact.mjs"),
    path.join(stagingRoot, "deployment/verify-stage7-artifact.mjs"),
  );
  await copyFile(
    path.join(root, "tooling/ci/stage-7/runtime-acceptance-runner.mjs"),
    path.join(stagingRoot, "operator/stage7-runtime-acceptance.mjs"),
  );
  await copyFile(
    path.join(root, "deploy/manifests/development.example.json"),
    path.join(stagingRoot, "instance-manifest/development.example.json"),
  );
  await copyFile(
    path.join(root, "pnpm-lock.yaml"),
    path.join(stagingRoot, "provenance/pnpm-lock.yaml"),
  );
  await copyFile(
    path.join(root, deployment.baselinePath),
    path.join(stagingRoot, `provenance/stage7-successor-baseline-${generation}.json`),
  );
  await copyFile(nodeBinary, path.join(stagingRoot, "runtime/node/bin/node"));
  const nodeMetadata = await lstat(path.join(stagingRoot, "runtime/node/bin/node"));
  await chmod(path.join(stagingRoot, "runtime/node/bin/node"), nodeMetadata.mode & 0o777);

  const release = createStage7ReleaseMetadata({
    generation,
    branch: sourceBranch,
    commit: sourceCommit,
    tree: sourceTree,
    successorBaselineSha256: sha256(baselineBytes),
    lockfileSha256: sha256(lockfileBytes),
    nodeBinarySha256: nodeBinaryDigest.sha256,
    migrationSha256: sha256(migrationBytes),
    migrationChecksumManifestSha256: sha256(migrationChecksumBytes),
    deploymentContractSha256: sha256(baseContractBytes),
    stage7DeploymentContractSha256: sha256(extensionBytes),
    stage7VerifierSha256: sha256(verifierBytes),
    runtimeAcceptanceSha256: sha256(runtimeAcceptanceBytes),
  });
  assert.deepEqual(release.toolchain, toolchain);
  await writeFile(path.join(stagingRoot, "release.json"), safeJsonBytes(release), {
    flag: "wx",
    mode: 0o644,
  });
  const inventory = await writePayloadManifests(stagingRoot);
  return {
    sourceCommit,
    baselineSha256: sha256(baselineBytes),
    lockfileSha256: sha256(lockfileBytes),
    inventory,
  };
};

export const buildStage7CandidateArtifact = async ({
  root = repositoryRoot,
  generation = STAGE7_DEFAULT_GENERATION,
  attempt = "01",
} = {}) => {
  assertGeneration(generation);
  assert.match(attempt, /^[0-9]{2,}$/u, "Invalid Stage 7 artifact attempt");
  const workspace = path.resolve(root);
  const output = stage7Paths(workspace, generation);
  const stagingRoot = path.join(
    path.dirname(output.artifactRoot),
    `stage7-${generation}-artifact-attempt-${attempt}`,
  );
  const stagingArchive = `${stagingRoot}.tar.gz`;
  const stagingReceipt = `${stagingRoot}-build.json`;
  for (const candidatePath of [
    output.artifactRoot,
    output.archivePath,
    output.receiptPath,
    stagingRoot,
    stagingArchive,
    stagingReceipt,
  ]) {
    await assertAbsent(candidatePath);
  }

  const verifiedDeployment = await verifyStage7DeploymentContract({ root: workspace, generation });
  assert.equal(verifiedDeployment.result, "PASS");
  const toolchain = verifyPinnedToolchain();
  await mkdir(stagingRoot, { recursive: false });
  let packageDeployAttempted = false;
  try {
    packageDeployAttempted = true;
    const payload = await prepareArtifactPayload({
      root: workspace,
      generation,
      stagingRoot,
      toolchain,
    });
    execFileSync(
      "tar",
      [
        "--create",
        "--gzip",
        "--sort=name",
        "--mtime=@0",
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        "--format=posix",
        `--file=${stagingArchive}`,
        "--directory",
        stagingRoot,
        ".",
      ],
      { cwd: workspace, stdio: "ignore" },
    );
    const verified = await verifyStage7Artifact({
      artifactRoot: stagingRoot,
      archivePath: stagingArchive,
      generation,
      expectedCommit: payload.sourceCommit,
      expectedBaselineSha256: payload.baselineSha256,
      expectedLockfileSha256: payload.lockfileSha256,
    });
    await rename(stagingRoot, output.artifactRoot);
    await rename(stagingArchive, output.archivePath);
    const readBack = await verifyStage7Artifact({
      artifactRoot: output.artifactRoot,
      archivePath: output.archivePath,
      generation,
      expectedCommit: payload.sourceCommit,
      expectedBaselineSha256: payload.baselineSha256,
      expectedLockfileSha256: payload.lockfileSha256,
    });
    assert.deepEqual(
      readBack,
      verified,
      "Promoted artifact differs from pre-promotion verification",
    );
    const receipt = {
      schemaVersion: 1,
      stage: "PHASE_1_M1_STAGE_7",
      result: "PASS",
      generation,
      attempt,
      candidateCommit: payload.sourceCommit,
      artifactId: readBack.artifactId,
      artifactRoot: path.relative(workspace, output.artifactRoot).split(path.sep).join("/"),
      archivePath: path.relative(workspace, output.archivePath).split(path.sep).join("/"),
      artifactSha256: readBack.artifactSha256,
      artifactBytes: readBack.artifactBytes,
      releaseMetadataSha256: readBack.releaseMetadataSha256,
      baselineSha256: payload.baselineSha256,
      lockfileSha256: payload.lockfileSha256,
      payloadEntries: readBack.payloadEntries,
      payloadFiles: readBack.payloadFiles,
      payloadSymlinks: readBack.payloadSymlinks,
      toolchain,
      stage8Actions: 0,
    };
    await writeFile(output.receiptPath, safeJsonBytes(receipt), { flag: "wx", mode: 0o644 });
    return receipt;
  } finally {
    if (packageDeployAttempted) {
      run("corepack", ["pnpm", "install", "--offline", "--frozen-lockfile", "--ignore-scripts"], {
        cwd: workspace,
        env: { ...process.env, CI: "true", NODE_ENV: "development" },
        label: "Restore pinned development dependencies after package deployment",
      });
    }
  }
};

const parseArguments = (argumentsList) => {
  const options = {};
  const seen = new Set();
  for (const argument of argumentsList) {
    const separator = argument.indexOf("=");
    assert.ok(argument.startsWith("--") && separator > 2, `Unsupported argument: ${argument}`);
    const name = argument.slice(2, separator);
    assert.ok(!seen.has(name), `Duplicate argument: --${name}`);
    seen.add(name);
    const value = argument.slice(separator + 1);
    if (name === "generation") options.generation = value;
    else if (name === "attempt") options.attempt = value;
    else throw new Error(`Unsupported argument: ${argument}`);
  }
  return options;
};

const directEntry =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (directEntry) {
  try {
    const receipt = await buildStage7CandidateArtifact(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
