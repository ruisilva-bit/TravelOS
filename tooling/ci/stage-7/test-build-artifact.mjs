import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const builderPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "build-artifact.mjs");
const builder = await import(pathToFileURL(builderPath).href).catch(() => null);
assert.equal(
  typeof builder?.createStage7ReleaseMetadata,
  "function",
  "Stage 7 must expose deterministic release metadata construction before packaging",
);

const commit = "a".repeat(40);
const tree = "b".repeat(40);
const hash = "c".repeat(64);
const release = builder.createStage7ReleaseMetadata({
  generation: "gen01",
  branch: "phase-1/stage-7",
  commit,
  tree,
  successorBaselineSha256: hash,
  lockfileSha256: hash,
  nodeBinarySha256: hash,
  migrationSha256: hash,
  migrationChecksumManifestSha256: hash,
  deploymentContractSha256: hash,
  stage7DeploymentContractSha256: hash,
  stage7VerifierSha256: hash,
});
assert.deepEqual(release, {
  schemaVersion: 1,
  artifactId: `travelos-phase-1-m1-stage-7-gen01-${commit.slice(0, 8)}`,
  designation: "DEVELOPMENT_CANDIDATE_UNQUALIFIED",
  productionSigning: { status: "NOT_PRODUCTION_SIGNED" },
  source: {
    branch: "phase-1/stage-7",
    commit,
    tree,
    successorBaselineGeneration: "gen01",
    successorBaselineSha256: hash,
    lockfilePath: "provenance/pnpm-lock.yaml",
    lockfileSha256: hash,
  },
  toolchain: { node: "24.19.0", corepack: "0.35.0", pnpm: "11.21.0" },
  qualification: { canonicalCi: "PENDING_ONE_AUTHORIZED_RUN", runCountForGeneration: 0 },
  database: {
    migrationHead: "0012_stage7_portal_trip_access.cjs",
    migrationFileSha256: hash,
    migrationChecksumManifestPath: "migrations/checksums.json",
    migrationChecksumManifestSha256: hash,
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
      binarySha256: hash,
    },
  },
  deploymentContract: {
    path: "deployment/deployment-contract.v1.json",
    schemaVersion: 1,
    sha256: hash,
  },
  stage7DeploymentContract: {
    path: "deployment/stage-7-extension.v1.json",
    schemaVersion: 1,
    sha256: hash,
  },
  stage7Verifier: {
    path: "deployment/verify-stage7-artifact.mjs",
    sha256: hash,
  },
});
assert.throws(
  () =>
    builder.createStage7ReleaseMetadata({
      generation: "gen01",
      branch: "phase-1/stage-6",
      commit,
      tree,
      successorBaselineSha256: hash,
      lockfileSha256: hash,
      nodeBinarySha256: hash,
      migrationSha256: hash,
      migrationChecksumManifestSha256: hash,
      deploymentContractSha256: hash,
      stage7DeploymentContractSha256: hash,
      stage7VerifierSha256: hash,
    }),
  /source branch mismatch/u,
);
assert.throws(
  () =>
    builder.createStage7ReleaseMetadata({
      generation: "gen00",
      branch: "phase-1/stage-7",
      commit,
      tree,
      successorBaselineSha256: hash,
      lockfileSha256: hash,
      nodeBinarySha256: hash,
      migrationSha256: hash,
      migrationChecksumManifestSha256: hash,
      deploymentContractSha256: hash,
      stage7DeploymentContractSha256: hash,
      stage7VerifierSha256: hash,
    }),
  /Invalid Stage 7 generation/u,
);
process.stdout.write(`${JSON.stringify({ result: "PASS", cases: 3 })}\n`);
