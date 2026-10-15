import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { validateStage7DeploymentContractSource } from "./verify-deployment-contract.mjs";

const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const readJson = async (relativePath) =>
  JSON.parse(await readFile(new URL(`../../../${relativePath}`, import.meta.url), "utf8"));
const extension = await readJson("deploy/contracts/stage-7-extension.v1.json");
const baseContractBytes = await readFile(
  new URL("../../../deploy/contracts/deployment-contract.v1.json", import.meta.url),
);
const previousMigrationBytes = await readFile(
  new URL("../../../migrations/0011_stage6_trip_publication.cjs", import.meta.url),
);
const migrationBytes = await readFile(
  new URL("../../../migrations/0012_stage7_portal_trip_access.cjs", import.meta.url),
);
const checksumManifestBytes = await readFile(
  new URL("../../../migrations/checksums.json", import.meta.url),
);

const accepted = validateStage7DeploymentContractSource({
  extension,
  baseContractBytes,
  previousMigrationBytes,
  migrationBytes,
  checksumManifestBytes,
  generation: "gen01",
});
assert.equal(accepted.result, "PASS");
assert.equal(accepted.requiredMigration, "0012_stage7_portal_trip_access.cjs");
assert.equal(accepted.stage8Actions, 0);
assert.equal(
  extension.candidate.artifactIdPrefix,
  "travelos-phase-1-m1-stage-7-gen01-",
  "Stage 7 artifact IDs must bind generation and source commit",
);
assert.equal(extension.artifact.releaseMetadataPath, "release.json");
assert.equal(extension.artifact.payloadManifestPath, "payload-manifest.json");
assert.equal(extension.artifact.checksumsPath, "checksums.txt");
assert.equal(extension.artifact.stage7ExtensionPath, "deployment/stage-7-extension.v1.json");
assert.equal(extension.artifact.stage7VerifierPath, "deployment/verify-stage7-artifact.mjs");
assert.equal(
  extension.artifact.successorBaselinePath,
  "provenance/stage7-successor-baseline-gen01.json",
);
assert.equal(extension.artifact.archiveFormat, "tar.gz");
assert.equal(extension.artifact.canonicalCiStatusAtBuild, "PENDING_ONE_AUTHORIZED_RUN");

const internalReadMutation = cloneJson(extension);
internalReadMutation.portal.mutableWorkspaceRead = true;
assert.throws(
  () =>
    validateStage7DeploymentContractSource({
      extension: internalReadMutation,
      baseContractBytes,
      previousMigrationBytes,
      migrationBytes,
      checksumManifestBytes,
      generation: "gen01",
    }),
  /deployment extension differs/u,
);

const changedPredecessor = cloneJson(extension);
changedPredecessor.extends.sha256 = "0".repeat(64);
assert.throws(
  () =>
    validateStage7DeploymentContractSource({
      extension: changedPredecessor,
      baseContractBytes,
      previousMigrationBytes,
      migrationBytes,
      checksumManifestBytes,
      generation: "gen01",
    }),
  /predecessor contract hash mismatch/iu,
);

const malformedChecksum = JSON.parse(checksumManifestBytes.toString("utf8"));
malformedChecksum.migrations.at(-1).sha256 = "0".repeat(64);
assert.throws(
  () =>
    validateStage7DeploymentContractSource({
      extension,
      baseContractBytes,
      previousMigrationBytes,
      migrationBytes,
      checksumManifestBytes: Buffer.from(JSON.stringify(malformedChecksum)),
      generation: "gen01",
    }),
  /migration checksum manifest hash mismatch/iu,
);

process.stdout.write(
  `${JSON.stringify({ result: "PASS", cases: 4, positiveCases: 1, negativeControls: 3 })}\n`,
);
