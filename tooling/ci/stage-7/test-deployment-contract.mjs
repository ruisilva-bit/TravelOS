import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import {
  STAGE7_DEFAULT_GENERATION,
  stage7ExtensionPathFor,
} from "../stage-7-successor-baseline.mjs";
import {
  renderStage7OperatorUnitForGeneration,
  validateStage7DeploymentContractSource,
  validateStage7OperatorUnit,
} from "./verify-deployment-contract.mjs";

const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const legacyGeneration = "gen09";
const generation = STAGE7_DEFAULT_GENERATION;
assert.equal(generation, "gen14");
const readJson = async (relativePath) =>
  JSON.parse(await readFile(new URL(`../../../${relativePath}`, import.meta.url), "utf8"));
const legacyExtension = await readJson("deploy/contracts/stage-7-extension.v1.json");
const extension = await readJson(stage7ExtensionPathFor(generation));
const legacyContractBytes = await readFile(
  new URL("../../../deploy/contracts/stage-7-extension.v1.json", import.meta.url),
);
assert.equal(
  sha256(legacyContractBytes),
  "27f7ee63c3afde0e54b13795d34a5ba0ac774d7429aecb10cd74eb4959e01afb",
  "The gen09 v1 contract bytes are immutable",
);
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
const currentChecksumManifest = JSON.parse(checksumManifestBytes.toString("utf8"));
const legacyMigrationIndex = currentChecksumManifest.migrations.findIndex(
  (row) => row.file === legacyExtension.database.requiredMigration,
);
assert.ok(legacyMigrationIndex >= 0, "Current chain retains the accepted gen09 migration");
const legacyChecksumManifestBytes = Buffer.from(
  `${JSON.stringify(
    {
      schemaVersion: currentChecksumManifest.schemaVersion,
      algorithm: currentChecksumManifest.algorithm,
      migrations: currentChecksumManifest.migrations.slice(0, legacyMigrationIndex + 1),
    },
    null,
    2,
  )}\n`,
);
assert.equal(
  sha256(legacyChecksumManifestBytes),
  legacyExtension.database.checksumManifestSha256,
  "The current chain must preserve the exact gen09 checksum-manifest prefix",
);
const successorMigrationBytes = await readFile(
  new URL("../../../migrations/0013_stage7_runtime_acceptance_cleanup.cjs", import.meta.url),
);
const successorChecksumManifestBytes = checksumManifestBytes;
const operatorUnit = await readFile(
  new URL("../../../deploy/systemd/travelos-stage7-runtime-acceptance.service", import.meta.url),
  "utf8",
);
assert.match(operatorUnit, /^DynamicUser=yes$/mu);
assert.doesNotMatch(operatorUnit, /^Group=/mu);
validateStage7OperatorUnit(operatorUnit, legacyGeneration);
assert.equal(renderStage7OperatorUnitForGeneration(operatorUnit, legacyGeneration), operatorUnit);
const successorOperatorUnit = renderStage7OperatorUnitForGeneration(operatorUnit, generation);
validateStage7OperatorUnit(successorOperatorUnit, generation);
assert.ok(
  successorOperatorUnit
    .split("\n")
    .includes(
      `ExecStartPre=/opt/travelos/current/runtime/node/bin/node /opt/travelos/current/deployment/verify-stage7-artifact.mjs --artifact-root=/opt/travelos/current --release-root=/opt/travelos/releases --generation=${generation}`,
    ),
  "Post-activation preflight must explicitly bind the current symlink to the release root",
);
assert.throws(
  () =>
    validateStage7OperatorUnit(
      operatorUnit.replace(" --release-root=/opt/travelos/releases", ""),
      legacyGeneration,
    ),
  /operator unit/iu,
);
assert.throws(
  () =>
    validateStage7OperatorUnit(
      operatorUnit.replace(/^DynamicUser=yes$/mu, "DynamicUser=no"),
      legacyGeneration,
    ),
  /operator unit/iu,
);
assert.throws(
  () =>
    validateStage7OperatorUnit(
      operatorUnit.replace(/^LoadCredentialEncrypted=stage7-staff-totp:.*\n/mu, ""),
      legacyGeneration,
    ),
  /operator unit/iu,
);

const legacyAccepted = validateStage7DeploymentContractSource({
  extension: legacyExtension,
  baseContractBytes,
  previousMigrationBytes,
  migrationBytes,
  checksumManifestBytes: legacyChecksumManifestBytes,
  generation: legacyGeneration,
});
assert.equal(legacyAccepted.result, "PASS");
assert.equal(legacyAccepted.requiredMigration, "0012_stage7_portal_trip_access.cjs");
const mutatedLegacyExtension = cloneJson(legacyExtension);
mutatedLegacyExtension.schemaVersion = 2;
assert.throws(
  () =>
    validateStage7DeploymentContractSource({
      extension: mutatedLegacyExtension,
      baseContractBytes,
      previousMigrationBytes,
      migrationBytes,
      checksumManifestBytes: legacyChecksumManifestBytes,
      generation: legacyGeneration,
    }),
  /approved contract/iu,
  "A changed gen09 v1 contract must not be accepted as the historical contract",
);
assert.throws(
  () =>
    validateStage7DeploymentContractSource({
      extension,
      baseContractBytes,
      previousMigrationBytes,
      migrationBytes,
      checksumManifestBytes: legacyChecksumManifestBytes,
      generation: legacyGeneration,
    }),
  /approved contract/iu,
  "The gen10 v2 contract must not be selected for gen09",
);

const accepted = validateStage7DeploymentContractSource({
  extension,
  baseContractBytes,
  previousMigrationBytes: migrationBytes,
  migrationBytes: successorMigrationBytes,
  checksumManifestBytes: successorChecksumManifestBytes,
  generation,
});
assert.equal(accepted.result, "PASS");
assert.equal(extension.candidate.generation, generation);
assert.equal(accepted.requiredMigration, "0013_stage7_runtime_acceptance_cleanup.cjs");
assert.equal(accepted.stage8Actions, 0);
assert.equal(extension.schemaVersion, 2);
assert.equal(extension.contractId, "travelos-stage7-runtime-acceptance-cleanup-v2");
assert.equal(extension.candidate.sourceBranch, "stage7/runtime-acceptance-cleanup-successor");
assert.equal(
  extension.candidate.artifactIdPrefix,
  `travelos-phase-1-m1-stage-7-${generation}-`,
  "Stage 7 artifact IDs must bind generation and source commit",
);
assert.equal(extension.artifact.releaseMetadataPath, "release.json");
assert.equal(extension.artifact.payloadManifestPath, "payload-manifest.json");
assert.equal(extension.artifact.checksumsPath, "checksums.txt");
assert.equal(extension.artifact.stage7ExtensionPath, "deployment/stage-7-extension.v2.json");
assert.equal(extension.artifact.stage7VerifierPath, "deployment/verify-stage7-artifact.mjs");
assert.equal(
  extension.artifact.successorBaselinePath,
  `provenance/stage7-successor-baseline-${generation}.json`,
);
assert.equal(extension.artifact.archiveFormat, "tar.gz");
assert.equal(extension.artifact.canonicalCiStatusAtBuild, "PENDING_ONE_AUTHORIZED_RUN");
const alteredGen09Prefix = JSON.parse(successorChecksumManifestBytes.toString("utf8"));
alteredGen09Prefix.migrations[0].sha256 = "0".repeat(64);
assert.throws(
  () =>
    validateStage7DeploymentContractSource({
      extension,
      baseContractBytes,
      previousMigrationBytes: migrationBytes,
      migrationBytes: successorMigrationBytes,
      checksumManifestBytes: Buffer.from(`${JSON.stringify(alteredGen09Prefix, null, 2)}\n`),
      generation,
    }),
  /accepted gen09 prefix/iu,
);
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
  fixtureCleanup: {
    method: "POST",
    path: "/api/admin/runtime-acceptance-fixtures/:fixtureRunId/cleanup",
    environment: "DEVELOPMENT_ONLY",
    hostPolicy: "EXACT_DEVELOPMENT_MANIFEST_ALLOWLIST",
    listener: "EXISTING_ADMIN_API",
    permissionIds: [
      "runtime_acceptance.fixture.manage",
      "trip.access.manage",
      "trip.edit",
      "trip.withdraw_publication",
    ],
    staffRealm: "STAFF_ONLY",
    activeMembershipRequired: true,
    exactAgencyScopeRequired: true,
    recentMfaWindowSeconds: 300,
    scope: "SAME_AGENCY_AND_CREATOR_REGISTERED_FIXTURE_RUN",
    acceptsCallerSuppliedResourceIds: false,
    maxTrips: 2,
    maxPortalPrincipals: 1,
    allowedFixtureStates: ["OPEN", "CLEANUP_PENDING"],
    terminalFixtureState: "CLEANED",
    retrySafe: true,
    revokesTripAccessGrants: true,
    invalidatesPortalSessions: true,
    withdrawsActivePublication: true,
    cancelsTrips: true,
    retiresPortalPrincipal: true,
    preservesPublicationSnapshots: true,
    preservesPublicationPayloads: true,
    preservesAuditAndOutboxHistory: true,
    preservesTripWorkspace: true,
    newListener: false,
    newExternallyReachablePorts: [],
  },
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
      previousMigrationBytes: migrationBytes,
      migrationBytes: successorMigrationBytes,
      checksumManifestBytes: successorChecksumManifestBytes,
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
      previousMigrationBytes: migrationBytes,
      migrationBytes: successorMigrationBytes,
      checksumManifestBytes: successorChecksumManifestBytes,
      generation,
    }),
  /predecessor contract hash mismatch/iu,
);

const changedCleanupRoute = cloneJson(extension);
changedCleanupRoute.runtimeAcceptance.fixtureCleanup.path =
  "/api/admin/runtime-acceptance-fixtures/:fixtureRunId/cleanup-anything";
assert.throws(
  () =>
    validateStage7DeploymentContractSource({
      extension: changedCleanupRoute,
      baseContractBytes,
      previousMigrationBytes: migrationBytes,
      migrationBytes: successorMigrationBytes,
      checksumManifestBytes: successorChecksumManifestBytes,
      generation,
    }),
  /deployment extension differs/u,
);

const exposedPort = cloneJson(extension);
exposedPort.runtimeAcceptance.newExternallyReachablePorts.push(9000);
assert.throws(
  () =>
    validateStage7DeploymentContractSource({
      extension: exposedPort,
      baseContractBytes,
      previousMigrationBytes: migrationBytes,
      migrationBytes: successorMigrationBytes,
      checksumManifestBytes: successorChecksumManifestBytes,
      generation,
    }),
  /deployment extension differs/u,
);

const malformedChecksum = JSON.parse(successorChecksumManifestBytes.toString("utf8"));
malformedChecksum.migrations.at(-1).sha256 = "0".repeat(64);
assert.throws(
  () =>
    validateStage7DeploymentContractSource({
      extension,
      baseContractBytes,
      previousMigrationBytes: migrationBytes,
      migrationBytes: successorMigrationBytes,
      checksumManifestBytes: Buffer.from(JSON.stringify(malformedChecksum)),
      generation,
    }),
  /checksum|migration/iu,
);

const malformedLegacyChecksum = JSON.parse(checksumManifestBytes.toString("utf8"));
malformedLegacyChecksum.migrations.at(-1).sha256 = "0".repeat(64);
assert.throws(
  () =>
    validateStage7DeploymentContractSource({
      extension: legacyExtension,
      baseContractBytes,
      previousMigrationBytes,
      migrationBytes,
      checksumManifestBytes: Buffer.from(JSON.stringify(malformedLegacyChecksum)),
      generation: legacyGeneration,
    }),
  /migration checksum manifest hash mismatch/iu,
);

process.stdout.write(
  `${JSON.stringify({ result: "PASS", cases: 12, positiveCases: 3, negativeControls: 9 })}\n`,
);
