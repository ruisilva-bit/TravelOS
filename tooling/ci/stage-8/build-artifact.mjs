import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, copyFile, cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { prunePackagedTestFiles } from "../stage-7/build-artifact.mjs";
import { hashFile, inventory, jsonBytes, verifyArtifact } from "./artifact-integrity.mjs";
import { sourceSnapshot, PREDECESSOR } from "./source-snapshot.mjs";

const repository = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const run = (command, args, env = process.env) =>
  execFileSync(command, args, {
    cwd: repository,
    env,
    stdio: "pipe",
    maxBuffer: 128 * 1024 * 1024,
  });
export const buildArtifact = async ({ output, candidate = "gen01" }) => {
  assert.match(candidate, /^gen[0-9]{2}$/u);
  assert.equal(process.version, "v24.19.0");
  assert.equal(run("corepack", ["pnpm", "--version"]).toString().trim(), "11.21.0");
  assert.equal(
    run("git", ["rev-parse", "travelos-phase-1-m1-stage-7-gen15-go^{}"]).toString().trim(),
    PREDECESSOR,
  );
  const root = path.resolve(output);
  assert.ok(
    root.startsWith(path.join(repository, ".hermes/state/")),
    "Artifact must use local stage workspace",
  );
  await mkdir(root, { recursive: false });
  const snapshot = await sourceSnapshot(repository);
  const sourceCommit = run("git", ["rev-parse", "HEAD"]).toString().trim();
  run("corepack", ["pnpm", "build"], { ...process.env, CI: "true", NODE_ENV: "development" });
  try {
    for (const [name, target] of [
      ["admin-api", "apps/admin-api"],
      ["portal-api", "apps/portal-api"],
      ["worker", "apps/worker"],
      ["migrator", "migrator"],
    ]) {
      const destination = path.join(root, target);
      await mkdir(path.dirname(destination), { recursive: true });
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
    ["tooling/ci/stage-8/artifact-integrity.mjs", "deployment/verify-artifact.mjs"],
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
    ["deploy/manifests/development.example.json", "instance-manifest/development.example.json"],
    ["pnpm-lock.yaml", "provenance/pnpm-lock.yaml"],
  ])
    await copyFile(path.join(repository, from), path.join(root, to));
  await copyFile(process.execPath, path.join(root, "runtime/node/bin/node"));
  await chmod(path.join(root, "runtime/node/bin/node"), 0o755);
  await writeFile(path.join(root, "provenance/source-snapshot.json"), snapshot.bytes, {
    flag: "wx",
  });
  const release = {
    schemaVersion: 1,
    stage: "PHASE_1_M1_STAGE_8",
    environment: "DEVELOPMENT",
    candidate,
    artifactId: `travelos-stage8-${candidate}-${snapshot.sha256.slice(0, 8)}`,
    source: {
      baselineCommit: sourceCommit,
      snapshotSha256: snapshot.sha256,
      identity: "WORKING_TREE_CONTENT_SNAPSHOT_NOT_BASELINE_COMMIT",
      predecessor: PREDECESSOR,
    },
    toolchain: { node: "24.19.0", pnpm: "11.21.0", postgresql: "18.6" },
    migrationHead: "0014_stage8_worker_activity",
    productionSigning: "NOT_PRODUCTION_SIGNED",
    qualification: "EXTERNAL_CANONICAL_CI_RECEIPT_REQUIRED",
    stage9Actions: 0,
  };
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
  assert.equal((await sourceSnapshot(repository)).sha256, snapshot.sha256, "Build mutated source");
  const archive = `${root}.tar.gz`;
  await writeFile(archive, "", { flag: "wx" });
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
  };
  await writeFile(`${root}-build.json`, jsonBytes(receipt), { flag: "wx" });
  return receipt;
};
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const output = process.argv[2];
  assert.ok(output, "Output directory required");
  console.log(
    JSON.stringify(await buildArtifact({ output, candidate: process.argv[3] ?? "gen01" })),
  );
}
