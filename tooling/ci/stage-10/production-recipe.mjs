import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, cp, lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { captureSource, corepackInvocation, inputIdentity, readToolchain } from "./candidate.mjs";
import { BRANCH, MIGRATION_HEAD, PREDECESSOR, STAGE, TOOLCHAIN } from "./constants.mjs";
import { PACKAGE_COPIES, RUNTIME_ROOTS, deploymentContract } from "./deployment-contract.mjs";
import {
  digest,
  exclusiveBytes,
  jsonBytes,
  regularBytes,
  safeAncestors,
  sha256,
  strictOptions,
} from "./io.mjs";
import { inspectRuntimeDependencies } from "./qualify-artifact.mjs";

const environment = (nodeEnvironment) => ({
  CI: "true",
  NODE_ENV: nodeEnvironment,
  COREPACK_ENABLE_NETWORK: "0",
  npm_config_offline: "true",
});
// There is no injected runner, shell, callback or environment-controlled command.
export const productionSteps = (payload) => [
  {
    label: "offline-frozen-install",
    command: "corepack",
    args: ["pnpm", "install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
    environment: environment("development"),
  },
  {
    label: "production-build-once",
    command: "corepack",
    args: ["pnpm", "run", "build"],
    environment: environment("production"),
  },
  ...RUNTIME_ROOTS.map((row) => ({
    label: `deploy-${row.name.slice("@travelos/".length)}`,
    command: "corepack",
    args: [
      "pnpm",
      "--config.inject-workspace-packages=true",
      "--filter",
      row.name,
      "deploy",
      "--prod",
      "--offline",
      "--ignore-scripts",
      path.join(payload, row.target),
    ],
    environment: environment("production"),
  })),
];
const restoreStep = {
  label: "restore-offline-workspace",
  command: "corepack",
  args: ["pnpm", "install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
  environment: environment("development"),
};
const cleanChildEnvironment = (root, additions) => ({
  // Explicit environment allowlist: no NODE_OPTIONS/NODE_PATH, npm hooks or
  // caller-supplied PASS variables/credentials are inherited by the compiler.
  PATH: corepackInvocation().path,
  HOME: "/home/hermes",
  TMPDIR: process.env.TMPDIR,

  PWD: root,
  TZ: "UTC",
  LANG: "C.UTF-8",
  SOURCE_DATE_EPOCH: "0",
  ...additions,
});
export const runProductionRecipe = async (options) => {
  strictOptions(options, ["root", "payload", "inputs", "logDirectory"]);
  const { root, payload, inputs, logDirectory } = options;
  assert.equal(inputIdentity(inputs), inputs.inputDigest, "Production input identity mismatch");
  assert.deepEqual(inputs.toolchain, TOOLCHAIN);
  await safeAncestors(payload, true);
  assert.deepEqual(await readdir(payload), [], "Production payload must start empty");
  await mkdir(logDirectory, { mode: 0o700 });
  const records = [];
  let primaryError;
  const run = async (step) => {
    readToolchain(root);
    assert.deepEqual(
      await captureSource(root),
      inputs.source,
      "Source drift before recipe command",
    );
    assert.equal(step.command, "corepack", "Only fixed Corepack recipe steps are permitted");
    const invocation = corepackInvocation();
    const args = [...invocation.prefix, ...step.args];
    const result = spawnSync(invocation.command, args, {
      cwd: root,
      env: cleanChildEnvironment(root, step.environment),
      encoding: "buffer",
      timeout: 15 * 60 * 1000,
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024 * 1024,
    });
    const stdout = result.stdout ?? Buffer.alloc(0);
    const stderr = result.stderr ?? Buffer.alloc(0);
    await exclusiveBytes(path.join(logDirectory, `${step.label}.stdout`), stdout);
    await exclusiveBytes(path.join(logDirectory, `${step.label}.stderr`), stderr);
    const record = {
      label: step.label,
      command: [invocation.command, ...args],
      environment: step.environment,
      exitCode: result.status,
      signal: result.signal,
      spawnError: result.error?.code ?? null,
      stdout: { bytes: stdout.length, sha256: sha256(stdout) },
      stderr: { bytes: stderr.length, sha256: sha256(stderr) },
    };
    await exclusiveBytes(path.join(logDirectory, `${step.label}.json`), jsonBytes(record));
    records.push(record);
    assert.equal(result.error, undefined, `Recipe spawn failed: ${step.label}`);
    assert.equal(result.status, 0, `Recipe command failed: ${step.label}`);
    assert.equal(result.signal, null, `Recipe interrupted: ${step.label}`);
    assert.deepEqual(await captureSource(root), inputs.source, "Source drift after recipe command");
  };
  try {
    for (const step of productionSteps(payload)) {
      if (step.label.startsWith("deploy-"))
        await mkdir(path.dirname(step.args.at(-1)), { recursive: true });
      await run(step);
    }
  } catch (error) {
    primaryError = error;
  }
  // pnpm deploy can alter the injected workspace layout. Restore only generated
  // dependency state, never payload/source/ledger, on success and failure.
  try {
    await run(restoreStep);
  } catch (error) {
    if (!primaryError) primaryError = error;
  }
  if (primaryError) throw primaryError;
  return records;
};

export const bindingFor = (inputs) => ({
  inputDigest: inputs.inputDigest,
  sourceSha256: digest(inputs.source),
  migrationSha256: digest(inputs.migration),
  toolchain: inputs.toolchain,
  predecessorCommit: inputs.predecessor.commit,
  predecessorArchiveSha256: inputs.predecessor.archiveSha256,
});
const output = async (root, file, bytes, executable = false) => {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await exclusiveBytes(path.join(root, file), bytes);
  await chmod(path.join(root, file), executable ? 0o755 : 0o644);
};
// Narrowly remove tests from production dependency packages, preserving runtime
// .node/JSON/SQL/assets/licenses. Never follow symlinks while pruning.
export const pruneProductionTests = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (
      (entry.isDirectory() && ["test", "tests", "__tests__"].includes(entry.name)) ||
      (entry.isFile() &&
        /\.(?:test|spec)\.(?:[cm]?js|[cm]?ts|jsx|tsx)(?:\.map)?$/u.test(entry.name))
    ) {
      await rm(target, { recursive: true });
    } else if (entry.isDirectory()) await pruneProductionTests(target);
  }
};
export const pruneRuntimeRoot = async (directory) => {
  // pnpm deploy includes app src/ and tsconfigs when the manifest lacks a files
  // allowlist. Keep runtime output/dependency metadata only; compilation is over.
  const allowed = new Set(["dist", "node_modules", "package.json", "pnpm-lock.yaml"]);
  for (const name of await readdir(directory))
    if (!allowed.has(name)) await rm(path.join(directory, name), { recursive: true });
  await pruneProductionTests(directory);
};
export const materializeProvenance = async (options) => {
  strictOptions(options, ["root", "payload", "inputs", "candidate"]);
  const { root, payload, inputs, candidate } = options;
  assert.equal(inputIdentity(inputs), inputs.inputDigest, "Production input identity mismatch");
  assert.deepEqual(inputs.predecessor, PREDECESSOR, "Production predecessor must be gen11");
  const sourceRows = new Map(inputs.source.files.map((row) => [row.path, row]));
  assert.equal(sourceRows.size, inputs.source.files.length, "Duplicate source input");
  const source = async (file) => {
    const row = sourceRows.get(file);
    assert.ok(row, `Required source input missing: ${file}`);
    const bytes = await regularBytes(path.join(root, file));
    assert.equal(bytes.length, row.bytes, `Source byte drift: ${file}`);
    assert.equal(sha256(bytes), row.sha256, `Source hash drift: ${file}`);
    assert.equal(
      ((await lstat(path.join(root, file))).mode & 0o111) !== 0,
      row.executable,
      `Source mode drift: ${file}`,
    );
    return bytes;
  };
  for (const row of inputs.source.files) {
    assert.ok(
      !path.isAbsolute(row.path) &&
        !row.path.split("/").some((part) => ["", ".", ".."].includes(part)),
      "Unsafe source path",
    );
    await output(payload, `provenance/source/${row.path}`, await source(row.path), row.executable);
  }
  for (const row of RUNTIME_ROOTS) await pruneRuntimeRoot(path.join(payload, row.target));
  for (const [from, to] of PACKAGE_COPIES) await output(payload, to, await source(from));
  await output(payload, "provenance/pnpm-lock.yaml", await source("pnpm-lock.yaml"));
  for (const row of inputs.migration.files) {
    assert.ok(row.path.startsWith("migrations/"), "Unsafe migration input");
    const bytes = await source(row.path);
    await output(payload, row.path, bytes, row.executable);
    await output(payload, `migrator/${row.path}`, bytes, row.executable);
  }
  for (const surface of ["admin", "portal"]) {
    const from = path.join(root, `apps/${surface}-web/dist`);
    await safeAncestors(from, true);
    await cp(from, path.join(payload, `${surface}-web`), {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
    });
  }
  const node = await regularBytes(process.execPath);
  await output(payload, "runtime/node/bin/node", node, true);
  await output(payload, "provenance/source-snapshot.json", jsonBytes(inputs.source));
  await output(payload, "provenance/inputs.json", jsonBytes(inputs));
  await output(payload, "deployment/stage10-contract.json", jsonBytes(deploymentContract()));
  const dependencies = await inspectRuntimeDependencies(payload, { inputs });
  await output(payload, "provenance/runtime-dependencies.json", jsonBytes(dependencies));
  const release = {
    schemaVersion: 1,
    stage: STAGE,
    candidate,
    artifactId: `travelos-stage10-${candidate}-${inputs.inputDigest.slice(0, 8)}`,
    environment: "DEVELOPMENT",
    designation: "DEVELOPMENT_CANDIDATE_UNQUALIFIED",
    source: {
      branch: BRANCH,
      identity: "WORKING_TREE_CONTENT_SNAPSHOT_NOT_BASELINE_COMMIT",
      snapshotSha256: digest(inputs.source),
      predecessor: PREDECESSOR,
    },
    binding: bindingFor(inputs),
    toolchain: inputs.toolchain,
    migrationHead: MIGRATION_HEAD,
    expectedCurrentArtifactId: PREDECESSOR.artifactId,
    expectedCurrentArtifactSha256: PREDECESSOR.archiveSha256,
    nodeSha256: sha256(node),
    deploymentContractSha256: digest(deploymentContract()),
    runtimeDependenciesSha256: digest(dependencies),
    productionSigning: "NOT_PRODUCTION_SIGNED",
    qualification: "PENDING_CANONICAL_CI_RUNTIME_SIGNATURE_PRIVACY_REVIEW",
    stage11Actions: 0,
  };
  await output(payload, "release.json", jsonBytes(release));
  return release;
};
