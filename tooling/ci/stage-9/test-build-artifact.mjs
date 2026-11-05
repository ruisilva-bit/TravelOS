import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

import { NODE_VERSION, PNPM_VERSION, STAGE9_BRANCH, STAGE9_MIGRATION_HEAD } from "./constants.mjs";

const builderPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "build-artifact.mjs");
const builder = await import(pathToFileURL(builderPath).href).catch(() => null);
assert.equal(
  typeof builder?.createStage9ReleaseMetadata,
  "function",
  "Stage 9 must expose deterministic release metadata before packaging",
);
assert.equal(
  typeof builder?.validateBuildRequest,
  "function",
  "Stage 9 must validate local build scope before running packaging commands",
);
assert.equal(
  typeof builder?.assertBuildOutputsAvailable,
  "function",
  "Stage 9 must refuse existing output files before any build or cleanup",
);
assert.equal(
  typeof builder?.createProductionArtifactBuildEnvironment,
  "function",
  "Stage 9 artifact builds must force production mode for Vite bundles",
);
assert.deepEqual(
  builder.createProductionArtifactBuildEnvironment({
    CI: "false",
    NODE_ENV: "development",
    TRAVELOS_BUILD_ENV_SENTINEL: "preserved",
  }),
  {
    CI: "true",
    NODE_ENV: "production",
    TRAVELOS_BUILD_ENV_SENTINEL: "preserved",
  },
);

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const sourceCommit = "a".repeat(40);
const snapshotSha256 = "b".repeat(64);
const deploymentExtensionSha256 = "c".repeat(64);
const request = {
  repositoryRoot,
  output: path.join(repositoryRoot, ".hermes/state/stage9-gen01-artifact"),
  candidate: "gen01",
  branch: STAGE9_BRANCH,
  nodeVersion: `v${NODE_VERSION}`,
  pnpmVersion: PNPM_VERSION,
};

assert.equal(builder.validateBuildRequest(request), path.resolve(request.output));
assert.throws(
  () => builder.validateBuildRequest({ ...request, output: "/tmp/stage9-artifact" }),
  /local .*\.hermes\/state/u,
);
assert.throws(
  () => builder.validateBuildRequest({ ...request, branch: "phase-1/stage-8" }),
  /branch mismatch/u,
);
assert.throws(
  () => builder.validateBuildRequest({ ...request, nodeVersion: "v24.20.0" }),
  /Node version mismatch/u,
);
assert.throws(
  () => builder.validateBuildRequest({ ...request, pnpmVersion: "11.22.0" }),
  /pnpm version mismatch/u,
);
assert.throws(
  () => builder.validateBuildRequest({ ...request, candidate: "gen00" }),
  /Invalid Stage 9 generation/u,
);

const temporaryDirectory = await mkdtemp(
  path.join(process.env.TMPDIR, "stage9-artifact-preflight-"),
);
try {
  const archive = path.join(temporaryDirectory, "stage9-gen01-artifact.tar.gz");
  await writeFile(archive, "existing evidence");
  await assert.rejects(
    builder.assertBuildOutputsAvailable(path.join(temporaryDirectory, "stage9-gen01-artifact")),
    /already exists/u,
  );
  assert.equal(await readFile(archive, "utf8"), "existing evidence");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

const release = builder.createStage9ReleaseMetadata({
  candidate: "gen01",
  sourceCommit,
  snapshotSha256,
  deploymentExtensionSha256,
});
assert.equal(release.schemaVersion, 1);
assert.equal(release.stage, "PHASE_1_M1_STAGE_9");
assert.equal(release.environment, "DEVELOPMENT");
assert.equal(release.candidate, "gen01");
assert.equal(release.artifactId, "travelos-stage9-gen01-bbbbbbbb");
assert.equal(release.source.baselineCommit, sourceCommit);
assert.equal(release.source.snapshotSha256, snapshotSha256);
assert.equal(release.deploymentExtensionSha256, deploymentExtensionSha256);
assert.deepEqual(release.toolchain, { node: "24.19.0", pnpm: "11.21.0" });
assert.equal(release.migrationHead, STAGE9_MIGRATION_HEAD);
assert.equal(release.productionSigning, "NOT_PRODUCTION_SIGNED");
assert.equal(release.qualification, "EXTERNAL_CANONICAL_CI_RECEIPT_REQUIRED");
assert.equal(release.stage10Actions, 0);

process.stdout.write(`${JSON.stringify({ result: "PASS", cases: 9 })}\n`);
