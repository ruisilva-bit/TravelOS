import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { STAGE7_DEFAULT_GENERATION } from "../stage-7-successor-baseline.mjs";
import {
  validateStage7DeploymentContractSource,
  validateStage7OperatorUnit,
} from "./verify-deployment-contract.mjs";

const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const generation = "gen09";
assert.equal(STAGE7_DEFAULT_GENERATION, generation);
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
const operatorUnit = await readFile(
  new URL("../../../deploy/systemd/travelos-stage7-runtime-acceptance.service", import.meta.url),
  "utf8",
);
assert.match(operatorUnit, /^DynamicUser=yes$/mu);
assert.doesNotMatch(operatorUnit, /^Group=/mu);
validateStage7OperatorUnit(operatorUnit);
assert.ok(
  operatorUnit
    .split("\n")
    .includes(
      `ExecStartPre=/opt/travelos/current/runtime/node/bin/node /opt/travelos/current/deployment/verify-stage7-artifact.mjs --artifact-root=/opt/travelos/current --release-root=/opt/travelos/releases --generation=${generation}`,
    ),
  "Post-activation preflight must explicitly bind the current symlink to the release root",
);
assert.throws(
  () =>
    validateStage7OperatorUnit(operatorUnit.replace(" --release-root=/opt/travelos/releases", "")),
  /operator unit/iu,
);
assert.throws(
  () => validateStage7OperatorUnit(operatorUnit.replace(/^DynamicUser=yes$/mu, "DynamicUser=no")),
  /operator unit/iu,
);
assert.throws(
  () =>
    validateStage7OperatorUnit(
      operatorUnit.replace(/^LoadCredentialEncrypted=stage7-staff-totp:.*\n/mu, ""),
    ),
  /operator unit/iu,
);

const accepted = validateStage7DeploymentContractSource({
  extension,
  baseContractBytes,
  previousMigrationBytes,
  migrationBytes,
  checksumManifestBytes,
  generation,
});
assert.equal(accepted.result, "PASS");
assert.equal(extension.candidate.generation, generation);
assert.equal(accepted.requiredMigration, "0012_stage7_portal_trip_access.cjs");
assert.equal(accepted.stage8Actions, 0);
assert.equal(
  extension.candidate.artifactIdPrefix,
  `travelos-phase-1-m1-stage-7-${generation}-`,
  "Stage 7 artifact IDs must bind generation and source commit",
);
assert.equal(extension.artifact.releaseMetadataPath, "release.json");
assert.equal(extension.artifact.payloadManifestPath, "payload-manifest.json");
assert.equal(extension.artifact.checksumsPath, "checksums.txt");
assert.equal(extension.artifact.stage7ExtensionPath, "deployment/stage-7-extension.v1.json");
assert.equal(extension.artifact.stage7VerifierPath, "deployment/verify-stage7-artifact.mjs");
assert.equal(
  extension.artifact.successorBaselinePath,
  `provenance/stage7-successor-baseline-${generation}.json`,
);
assert.equal(extension.artifact.archiveFormat, "tar.gz");
assert.equal(extension.artifact.canonicalCiStatusAtBuild, "PENDING_ONE_AUTHORIZED_RUN");
assert.deepEqual(extension.runtimeAcceptance, {
  sourcePath: "tooling/ci/stage-7/runtime-acceptance-runner.mjs",
  runnerPath: "operator/stage7-runtime-acceptance.mjs",
  operatorUnitSourcePath: "deploy/systemd/travelos-stage7-runtime-acceptance.service",
  operatorUnitPath: "operator/travelos-stage7-runtime-acceptance.service",
  executionMode: "DEVELOPMENT_OPERATOR_ONE_SHOT",
  operatorOnly: true,
  persistentService: false,
  listener: false,
  publicSignupEndpoint: false,
  newExternallyReachablePorts: [],
  credentialDirectoryEnv: "CREDENTIALS_DIRECTORY",
  staffTotpCredentialKind: "BETTER_AUTH_BASE32_SEED",
  requiredCredentialNames: [
    "portal-api-db",
    "portal-auth-realm",
    "stage7-staff-email",
    "stage7-staff-password",
    "stage7-staff-totp",
  ],
  runtimeDependencies: [
    { appRoot: "apps/portal-api", packageName: "@travelos/config", exportName: "." },
    {
      appRoot: "apps/portal-api",
      packageName: "@travelos/auth-adapters",
      exportName: "./portal",
    },
    {
      appRoot: "apps/portal-api",
      packageName: "@travelos/auth-adapters",
      internalModule: "dist/realm.js",
    },
  ],
});

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
      generation,
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
      generation,
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
      generation,
    }),
  /migration checksum manifest hash mismatch/iu,
);

process.stdout.write(
  `${JSON.stringify({ result: "PASS", cases: 7, positiveCases: 2, negativeControls: 5 })}\n`,
);
