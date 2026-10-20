import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import {
  STAGE7_DEFAULT_GENERATION,
  stage7CandidateBranchFor,
  stage7ExtensionPathFor,
  verifyStage7SuccessorBaseline,
} from "../stage-7-successor-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

const BASE_CONTRACT_PATH = "deploy/contracts/deployment-contract.v1.json";
const CHECKSUM_MANIFEST_PATH = "migrations/checksums.json";
const PREVIOUS_MIGRATION_V1 = "0011_stage6_trip_publication.cjs";
const REQUIRED_MIGRATION_V1 = "0012_stage7_portal_trip_access.cjs";
const PREVIOUS_MIGRATION_V2 = "0012_stage7_portal_trip_access.cjs";
const REQUIRED_MIGRATION_V2 = "0013_stage7_runtime_acceptance_cleanup.cjs";
const BASE_CONTRACT_SHA256 = "d97709506b69d133f13cbd9c74c1f9a790477180cbcd124b7135c26bb0c75633";
const PREVIOUS_MIGRATION_V1_SHA256 =
  "a6b4924aca43670c2b1034dca7471df349476a4922ac8370dbde9e3bb5ce6503";
const REQUIRED_MIGRATION_V1_SHA256 =
  "4bf653fdc7522443ea321d98d448934ec1b5d0c4e8d4abd904360182ada5ade8";
const CHECKSUM_MANIFEST_SHA256 = "dd545bf5ae7ad0947dee21780cf392a6b873261b8953d8b04ca0962db21b6b81";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytewise = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const generationNumber = (generation) => Number(generation.slice(3));
const previousMigrationFor = (generation) =>
  generationNumber(generation) >= 10 ? PREVIOUS_MIGRATION_V2 : PREVIOUS_MIGRATION_V1;
const requiredMigrationFor = (generation) =>
  generationNumber(generation) >= 10 ? REQUIRED_MIGRATION_V2 : REQUIRED_MIGRATION_V1;
export const validateStage7OperatorUnit = (unit, generation = STAGE7_DEFAULT_GENERATION) => {
  for (const line of [
    "Type=oneshot",
    "User=travelos-stage7-operator",
    "DynamicUser=yes",
    "WorkingDirectory=/opt/travelos/current",
    "UMask=0077",
    "NoNewPrivileges=yes",
    "ProtectSystem=strict",
    "ProtectHome=yes",
    "IPAddressDeny=any",
    "IPAddressAllow=localhost",
    "Restart=no",
    `ExecStartPre=/opt/travelos/current/runtime/node/bin/node /opt/travelos/current/deployment/verify-stage7-artifact.mjs --artifact-root=/opt/travelos/current --release-root=/opt/travelos/releases --generation=${generation}`,
    "ExecStart=/opt/travelos/current/runtime/node/bin/node /opt/travelos/current/operator/stage7-runtime-acceptance.mjs --manifest=/etc/travelos/instances/development.json",
  ]) {
    assert.ok(unit.split("\n").includes(line), `Unsafe Stage 7 operator unit: ${line}`);
  }
  const directives = unit.split("\n").filter((line) => line.includes("=") && !line.startsWith("#"));
  const credentialRows = directives.filter((line) => line.startsWith("LoadCredentialEncrypted="));
  assert.deepEqual(
    credentialRows,
    [
      "portal-api-db",
      "portal-auth-realm",
      "stage7-staff-email",
      "stage7-staff-password",
      "stage7-staff-totp",
    ].map((name) => `LoadCredentialEncrypted=${name}:/etc/credstore.encrypted/travelos-${name}`),
    "Unsafe Stage 7 operator unit credential bindings",
  );
  for (const prefix of ["ExecStart=", "ExecStartPre="]) {
    assert.equal(
      directives.filter((line) => line.startsWith(prefix)).length,
      1,
      "Unsafe Stage 7 operator unit command count",
    );
  }
  assert.ok(
    !directives.some((line) =>
      /^(?:Environment|Group|LoadCredential|ExecStartPost|ExecReload)=/u.test(line),
    ) &&
      !unit.includes("[Install]") &&
      !unit.includes("[Socket]"),
    "Unsafe Stage 7 operator unit directives",
  );
};

const expectedExtensionV1For = (generation) => ({
  schemaVersion: 1,
  contractId: "travelos-stage7-portal-isolation-v1",
  stage: "PHASE_1_M1_STAGE_7",
  extends: { path: BASE_CONTRACT_PATH, sha256: BASE_CONTRACT_SHA256 },
  candidate: {
    generation,
    sourceBranch: "phase-1/stage-7",
    artifactIdPrefix: `travelos-phase-1-m1-stage-7-${generation}-`,
    successorBaselinePath: `docs/reviews/phase-1-m1/STAGE_7_SUCCESSOR_BASELINE_${generation.toUpperCase()}.json`,
  },
  artifact: {
    designation: "DEVELOPMENT_CANDIDATE_UNQUALIFIED",
    releaseMetadataPath: "release.json",
    payloadManifestPath: "payload-manifest.json",
    checksumsPath: "checksums.txt",
    stage7ExtensionPath: "deployment/stage-7-extension.v1.json",
    stage7VerifierPath: "deployment/verify-stage7-artifact.mjs",
    successorBaselinePath: `provenance/stage7-successor-baseline-${generation}.json`,
    archiveFormat: "tar.gz",
    canonicalCiStatusAtBuild: "PENDING_ONE_AUTHORIZED_RUN",
    currentSymlink: "/opt/travelos/current",
    releaseRoot: "/opt/travelos/releases",
    buildOncePromoteSameDigest: true,
    compileOnCT200: false,
    baseRuntimeContractUnchanged: true,
  },
  runtimeAcceptance: {
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
  },
  database: {
    host: "127.0.0.1",
    port: 5432,
    name: "travelos_development",
    tlsPolicy: "DISABLED_LOOPBACK_ONLY",
    previousMigration: PREVIOUS_MIGRATION_V1,
    previousMigrationSha256: PREVIOUS_MIGRATION_V1_SHA256,
    requiredMigration: REQUIRED_MIGRATION_V1,
    requiredMigrationSha256: REQUIRED_MIGRATION_V1_SHA256,
    checksumManifestPath: CHECKSUM_MANIFEST_PATH,
    checksumManifestSha256: CHECKSUM_MANIFEST_SHA256,
    migratorExecutor: "travelos-migrator-exec",
    migratorSessionUser: "travelos_migrator",
    ownerRole: "travelos_owner",
    ownerRoleSwitch: "SET ROLE travelos_owner",
    betterAuthRuntimeMigrations: false,
  },
  portal: {
    authenticationRealm: "PORTAL_ONLY",
    loginRole: "travelos_portal_api",
    capabilityRole: "travelos_portal_runtime",
    activePublicationOnly: true,
    snapshotContract: "PortalTripSnapshotV1",
    explicitTripAccessGrantRequired: true,
    capability: "trip.view_current",
    staffGrantPermission: "trip.access.manage",
    mutableWorkspaceRead: false,
    mutableWorkspaceFallback: false,
    internalOnlyOutput: false,
    unknownFieldPassthrough: false,
  },
  stage7Actions: 1,
  stage8Actions: 0,
});

const expectedExtensionV2For = (generation) => ({
  schemaVersion: 2,
  contractId: "travelos-stage7-runtime-acceptance-cleanup-v2",
  stage: "PHASE_1_M1_STAGE_7",
  extends: { path: BASE_CONTRACT_PATH, sha256: BASE_CONTRACT_SHA256 },
  candidate: {
    generation,
    sourceBranch: stage7CandidateBranchFor(generation),
    artifactIdPrefix: `travelos-phase-1-m1-stage-7-${generation}-`,
    successorBaselinePath: `docs/reviews/phase-1-m1/STAGE_7_SUCCESSOR_BASELINE_${generation.toUpperCase()}.json`,
  },
  artifact: {
    designation: "DEVELOPMENT_CANDIDATE_UNQUALIFIED",
    releaseMetadataPath: "release.json",
    payloadManifestPath: "payload-manifest.json",
    checksumsPath: "checksums.txt",
    stage7ExtensionPath: "deployment/stage-7-extension.v2.json",
    stage7VerifierPath: "deployment/verify-stage7-artifact.mjs",
    successorBaselinePath: `provenance/stage7-successor-baseline-${generation}.json`,
    archiveFormat: "tar.gz",
    canonicalCiStatusAtBuild: "PENDING_ONE_AUTHORIZED_RUN",
    currentSymlink: "/opt/travelos/current",
    releaseRoot: "/opt/travelos/releases",
    buildOncePromoteSameDigest: true,
    compileOnCT200: false,
    baseRuntimeContractUnchanged: true,
  },
  runtimeAcceptance: {
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
  },
  database: {
    host: "127.0.0.1",
    port: 5432,
    name: "travelos_development",
    tlsPolicy: "DISABLED_LOOPBACK_ONLY",
    previousMigration: PREVIOUS_MIGRATION_V2,
    previousMigrationSha256: REQUIRED_MIGRATION_V1_SHA256,
    requiredMigration: REQUIRED_MIGRATION_V2,
    requiredMigrationIntegrity: "CHECKSUM_MANIFEST_AND_SUCCESSOR_SOURCE_BASELINE",
    checksumManifestPath: CHECKSUM_MANIFEST_PATH,
    predecessorChecksumManifestSha256: CHECKSUM_MANIFEST_SHA256,
    migratorExecutor: "travelos-migrator-exec",
    migratorSessionUser: "travelos_migrator",
    ownerRole: "travelos_owner",
    ownerRoleSwitch: "SET ROLE travelos_owner",
    betterAuthRuntimeMigrations: false,
  },
  portal: {
    authenticationRealm: "PORTAL_ONLY",
    loginRole: "travelos_portal_api",
    capabilityRole: "travelos_portal_runtime",
    activePublicationOnly: true,
    snapshotContract: "PortalTripSnapshotV1",
    explicitTripAccessGrantRequired: true,
    capability: "trip.view_current",
    staffGrantPermission: "trip.access.manage",
    mutableWorkspaceRead: false,
    mutableWorkspaceFallback: false,
    internalOnlyOutput: false,
    unknownFieldPassthrough: false,
  },
  stage7Actions: 1,
  stage8Actions: 0,
});

const expectedExtensionFor = (generation) =>
  generationNumber(generation) >= 10
    ? expectedExtensionV2For(generation)
    : expectedExtensionV1For(generation);

export const renderStage7OperatorUnitForGeneration = (
  sourceUnit,
  generation = STAGE7_DEFAULT_GENERATION,
) => {
  generationNumber(generation);
  const sourceGenerationArgument = "--generation=gen09";
  const selectedGenerationArgument = `--generation=${generation}`;
  const occurrences = sourceUnit.split(sourceGenerationArgument).length - 1;
  let unit = sourceUnit;
  if (generation !== "gen09") {
    assert.equal(
      occurrences,
      1,
      "Stage 7 operator unit must have exactly one historical generation placeholder",
    );
    unit = sourceUnit.replace(sourceGenerationArgument, selectedGenerationArgument);
  }
  validateStage7OperatorUnit(unit, generation);
  return unit;
};

const assertRegularFile = async (workspace, relativePath) => {
  const absolutePath = path.resolve(workspace, relativePath);
  assert.ok(absolutePath.startsWith(`${path.resolve(workspace)}${path.sep}`));
  const metadata = await lstat(absolutePath);
  assert.ok(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `Expected regular file: ${relativePath}`,
  );
  return readFile(absolutePath);
};

export const validateStage7DeploymentContractSource = ({
  extension,
  baseContractBytes,
  previousMigrationBytes,
  migrationBytes,
  checksumManifestBytes,
  generation = STAGE7_DEFAULT_GENERATION,
}) => {
  assert.match(generation, /^gen[0-9]{2,}$/u, "Invalid Stage 7 generation");
  const isV2 = generationNumber(generation) >= 10;
  const previousMigration = previousMigrationFor(generation);
  const requiredMigration = requiredMigrationFor(generation);
  const expectedPreviousMigrationSha256 = isV2
    ? REQUIRED_MIGRATION_V1_SHA256
    : PREVIOUS_MIGRATION_V1_SHA256;
  assert.equal(
    sha256(baseContractBytes),
    BASE_CONTRACT_SHA256,
    "Predecessor contract hash mismatch",
  );
  assert.equal(
    sha256(previousMigrationBytes),
    expectedPreviousMigrationSha256,
    "Previous migration bytes differ from the accepted predecessor",
  );
  if (!isV2) {
    assert.equal(
      sha256(migrationBytes),
      REQUIRED_MIGRATION_V1_SHA256,
      "Stage 7 migration hash mismatch",
    );
    assert.equal(
      sha256(checksumManifestBytes),
      CHECKSUM_MANIFEST_SHA256,
      "Migration checksum manifest hash mismatch",
    );
  }
  assert.equal(
    extension?.extends?.sha256,
    sha256(baseContractBytes),
    "Predecessor contract hash mismatch",
  );

  const baseContract = JSON.parse(Buffer.from(baseContractBytes).toString("utf8"));
  assert.equal(baseContract.contractId, "travelos-stage6-ct-runtime-v1");
  assert.equal(baseContract.artifact.currentSymlink, "/opt/travelos/current");
  assert.equal(baseContract.artifact.releaseRoot, "/opt/travelos/releases");
  assert.equal(baseContract.artifact.requiredMigrationPath, `migrations/${PREVIOUS_MIGRATION_V1}`);
  assert.equal(baseContract.database.host, "127.0.0.1");
  assert.equal(baseContract.database.port, 5432);
  assert.equal(baseContract.database.tlsPolicy, "DISABLED_LOOPBACK_ONLY");
  assert.equal(baseContract.database.runtimeIdentities.portalApi.roleName, "travelos_portal_api");

  const checksumManifest = JSON.parse(Buffer.from(checksumManifestBytes).toString("utf8"));
  assert.deepEqual(Object.keys(checksumManifest).sort(bytewise), [
    "algorithm",
    "migrations",
    "schemaVersion",
  ]);
  assert.equal(checksumManifest.schemaVersion, 1);
  assert.equal(checksumManifest.algorithm, "sha256");
  assert.ok(Array.isArray(checksumManifest.migrations));
  for (const row of checksumManifest.migrations) {
    assert.deepEqual(Object.keys(row).sort(bytewise), ["file", "sha256"]);
    assert.match(row.file, /^[0-9]{4}_[a-z0-9_]+\.cjs$/u);
    assert.match(row.sha256, /^[a-f0-9]{64}$/u);
  }
  if (isV2) {
    const predecessorManifestBytes = Buffer.from(
      `${JSON.stringify(
        {
          schemaVersion: checksumManifest.schemaVersion,
          algorithm: checksumManifest.algorithm,
          migrations: checksumManifest.migrations.slice(0, -1),
        },
        null,
        2,
      )}\n`,
    );
    assert.equal(
      sha256(predecessorManifestBytes),
      CHECKSUM_MANIFEST_SHA256,
      "Migration checksum manifest does not preserve the accepted gen09 prefix",
    );
  }
  const previousIndex = checksumManifest.migrations.findIndex(
    (row) => row.file === previousMigration,
  );
  const migrationIndex = checksumManifest.migrations.findIndex(
    (row) => row.file === requiredMigration,
  );
  assert.ok(previousIndex >= 0, "Migration chain is missing the Stage 6 predecessor");
  assert.equal(
    migrationIndex,
    checksumManifest.migrations.length - 1,
    `${requiredMigration} must be chain head`,
  );
  assert.equal(
    previousIndex,
    migrationIndex - 1,
    "Stage 7 migration must follow Stage 6 migration",
  );
  assert.equal(checksumManifest.migrations[previousIndex].sha256, sha256(previousMigrationBytes));
  assert.equal(
    checksumManifest.migrations[migrationIndex].sha256,
    sha256(migrationBytes),
    "Migration checksum row differs from migration bytes",
  );

  assert.deepEqual(
    extension,
    expectedExtensionFor(generation),
    "Stage 7 deployment extension differs from its approved contract",
  );
  return {
    result: "PASS",
    generation,
    contractSha256: sha256(Buffer.from(`${JSON.stringify(extension, null, 2)}\n`)),
    baseContractSha256: sha256(baseContractBytes),
    checksumManifestSha256: sha256(checksumManifestBytes),
    previousMigration,
    requiredMigration,
    requiredMigrationSha256: sha256(migrationBytes),
    stage7Actions: 1,
    stage8Actions: 0,
  };
};

export const verifyStage7DeploymentContract = async ({
  root: workspace = root,
  generation = STAGE7_DEFAULT_GENERATION,
  expectedCommit,
} = {}) => {
  const previousMigration = previousMigrationFor(generation);
  const requiredMigration = requiredMigrationFor(generation);
  const contractBytes = await assertRegularFile(workspace, stage7ExtensionPathFor(generation));
  const extension = JSON.parse(contractBytes.toString("utf8"));
  await assertRegularFile(workspace, extension.runtimeAcceptance.sourcePath);
  const operatorUnitSource = (
    await assertRegularFile(workspace, extension.runtimeAcceptance.operatorUnitSourcePath)
  ).toString("utf8");
  renderStage7OperatorUnitForGeneration(operatorUnitSource, generation);
  const source = validateStage7DeploymentContractSource({
    extension,
    baseContractBytes: await assertRegularFile(workspace, BASE_CONTRACT_PATH),
    previousMigrationBytes: await assertRegularFile(workspace, `migrations/${previousMigration}`),
    migrationBytes: await assertRegularFile(workspace, `migrations/${requiredMigration}`),
    checksumManifestBytes: await assertRegularFile(workspace, CHECKSUM_MANIFEST_PATH),
    generation,
  });
  const baseline = await verifyStage7SuccessorBaseline({ root: workspace, generation });
  assert.equal(baseline.result, "PASS");
  assert.equal(baseline.currentBranch, stage7CandidateBranchFor(generation));
  assert.equal(baseline.currentHead, baseline.candidateCommit);
  if (expectedCommit !== undefined) assert.equal(baseline.candidateCommit, expectedCommit);
  assert.equal(baseline.baselinePath, extension.candidate.successorBaselinePath);
  return {
    ...source,
    candidateId: baseline.candidateId,
    candidateCommit: baseline.candidateCommit,
    baselinePath: baseline.baselinePath,
    baselineSha256: baseline.baselineSha256,
    sourceCount: baseline.sourceCount,
    sourceAggregateSha256: baseline.sourceAggregateSha256,
    predecessorResult: baseline.predecessorResult,
  };
};

const parseArguments = (argumentsList) => {
  const options = { generation: STAGE7_DEFAULT_GENERATION };
  for (const argument of argumentsList) {
    if (argument.startsWith("--generation=")) {
      assert.equal(options.generation, STAGE7_DEFAULT_GENERATION, "Duplicate generation argument");
      options.generation = argument.split("=", 2)[1];
    } else {
      throw new Error(`Unsupported argument: ${argument}`);
    }
  }
  return options;
};

const directEntry =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (directEntry) {
  try {
    const result = await verifyStage7DeploymentContract(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ result: "FAIL", error: error.message })}\n`);
    process.exitCode = 1;
  }
}
