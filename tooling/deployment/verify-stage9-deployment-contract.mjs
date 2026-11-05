import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

import {
  STAGE8_ACCEPTED_ARTIFACT_ID,
  STAGE8_ACCEPTED_ARTIFACT_SHA256,
  STAGE8_MIGRATION_HEAD,
  STAGE9_BRANCH,
  STAGE9_CADDY_SHA256,
  STAGE9_CURRENT_ARTIFACT_ID,
  STAGE9_CURRENT_ARTIFACT_SHA256,
  STAGE9_CURRENT_MIGRATION_HEAD,
  STAGE9_PREVIOUS_MIGRATION_PATH,
  STAGE9_PREVIOUS_MIGRATION_SHA256,
  STAGE9_BASELINE_PATH,
  STAGE9_BASELINE_SHA256,
  STAGE9_MIGRATION_HEAD,
  STAGE9_MIGRATION_PATH,
  STAGE9_MIGRATION_SHA256,
  STAGE9_PREDECESSOR,
  STAGE9_STAGE,
  STAGE9_V1_CONTRACT_PATH,
  STAGE9_V1_CONTRACT_SHA256,
  STAGE9_V2_CONTRACT_PATH,
  STAGE9_V2_CONTRACT_SHA256,
  STAGE9_V3_CONTRACT_PATH,
  STAGE9_V3_CONTRACT_SHA256,
} from "../ci/stage-9/constants.mjs";
import { verifyStage9SuccessorBaseline } from "../ci/stage-9-successor-baseline.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const BASE_CONTRACT_PATH = "deploy/contracts/deployment-contract.v1.json";
const STAGE9_CONTRACT_PATH = STAGE9_V3_CONTRACT_PATH;
const EXPECTED_BASE_CONTRACT_SHA256 =
  "d97709506b69d133f13cbd9c74c1f9a790477180cbcd124b7135c26bb0c75633";
const STAGE8_SYSTEMD_FILES = Object.freeze({
  "deploy/systemd/worker-stage8.conf":
    "0e3a8c4bb1cdbbefe94a7a66161cb0c6649c52b7c42c3f33610b65d81d3c905c",
  "deploy/systemd/travelos-stage8-runtime-acceptance.service":
    "e2698c85b7ec479d1982d31796efbe25405036c00814a11cd9f32a20df8461e3",
  "deploy/systemd/travelos-stage8-controlled-acceptance.service":
    "e7ca6157d6992aa3323c0e7ee6b8d2d346c5da011c8fa008aea041e52a06ac9c",
});

export const verifyStage9ExtensionShape = (extension, baseContractSha256) => {
  assert.deepEqual(Object.keys(extension).sort(), [
    "approvedSuccessorBaseline",
    "artifact",
    "contractId",
    "database",
    "extends",
    "portal",
    "predecessor",
    "presentation",
    "routing",
    "schemaVersion",
    "services",
    "stage",
    "stage10Actions",
    "supersedes",
  ]);
  assert.equal(extension.schemaVersion, 3);
  assert.equal(extension.contractId, "travelos-stage9-staff-invitations-v3");
  assert.deepEqual(extension.supersedes, {
    path: STAGE9_V2_CONTRACT_PATH,
    sha256: STAGE9_V2_CONTRACT_SHA256,
  });
  assert.deepEqual(extension.approvedSuccessorBaseline, {
    path: STAGE9_BASELINE_PATH,
    sha256: STAGE9_BASELINE_SHA256,
  });
  assert.equal(extension.stage, STAGE9_STAGE);
  assert.deepEqual(extension.extends, {
    path: BASE_CONTRACT_PATH,
    sha256: EXPECTED_BASE_CONTRACT_SHA256,
  });
  assert.equal(baseContractSha256, EXPECTED_BASE_CONTRACT_SHA256);
  assert.deepEqual(extension.predecessor, {
    commit: STAGE9_PREDECESSOR,
    stage: "PHASE_1_M1_STAGE_8",
    artifactId: STAGE8_ACCEPTED_ARTIFACT_ID,
    artifactSha256: STAGE8_ACCEPTED_ARTIFACT_SHA256,
    migrationHead: STAGE8_MIGRATION_HEAD,
  });
  assert.deepEqual(extension.artifact, {
    designation: "DEVELOPMENT_CANDIDATE_UNQUALIFIED",
    sourceBranch: STAGE9_BRANCH,
    artifactIdPattern: "^travelos-stage9-gen[0-9]{2}-[a-f0-9]{8}$",
    productionSigningStatus: "NOT_PRODUCTION_SIGNED",
    canonicalCiStatusAtBuild: "PENDING_ONE_AUTHORIZED_RUN",
    buildOncePromoteSameDigest: true,
    compileOnCt200: false,
    runtimeNodePath: "runtime/node/bin/node",
    adminWebPath: "admin-web",
    portalWebPath: "portal-web",
    adminApiPath: "apps/admin-api",
    portalApiPath: "apps/portal-api",
    currentSymlink: "/opt/travelos/current",
    releaseRoot: "/opt/travelos/releases",
    expectedCurrentArtifactId: STAGE9_CURRENT_ARTIFACT_ID,
    expectedCurrentArtifactSha256: STAGE9_CURRENT_ARTIFACT_SHA256,
  });
  assert.deepEqual(extension.presentation, {
    adminShellMarker: "admin-root",
    portalShellMarker: "portal-root",
    language: "pt-PT",
    sameOriginWithApi: true,
    staticAssetPrefix: "/assets/",
    cacheControl: "private, no-store",
    dotfiles: "deny",
    unknownRouteShellFallback: false,
    noJavaScriptCredentialSubmission: "POST_ONLY",
    publicSignup: false,
  });
  assert.deepEqual(extension.routing, {
    existingExactHostAllowlist: true,
    adminHost: "admin.travelos.test",
    portalHost: "portal.travelos.test",
    caddyConfigurationChanges: false,
    caddy: {
      configurationSource: "deploy/caddy/Caddyfile.stage9-development",
      artifactPath: "deployment/Caddyfile",
      targetPath: "/etc/caddy/Caddyfile",
      expectedCurrentSha256: STAGE9_CADDY_SHA256,
      configurationSha256: STAGE9_CADDY_SHA256,
      adminApi: "OFF",
      listener: "192.168.1.33:80",
      applyAction: "NONE",
      apiPaths: ["/api", "/api/*", "/health", "/health/*"],
      adminStaticRoot: "/opt/travelos/current/admin-web",
      portalStaticRoot: "/opt/travelos/current/portal-web",
      cacheControl: "private, no-store",
      dotfiles: "DENY",
      unknownPathFallback: false,
      unknownHostStatus: 421,
    },
    dnsChanges: false,
    newExternallyReachablePorts: [],
    requestHostSelectsAgency: false,
  });
  assert.deepEqual(extension.database, {
    expectedCurrentMigrationHead: STAGE9_CURRENT_MIGRATION_HEAD,
    migrationHead: STAGE9_MIGRATION_HEAD,
    migrationChanges: true,
    migrationPath: STAGE9_MIGRATION_PATH,
    migrationSha256: STAGE9_MIGRATION_SHA256,
    migrationExecution: "CONTROLLED_MIGRATOR_UP_AFTER_VERIFIED_RESTORE",
    betterAuthRuntimeMigrations: false,
  });
  assert.deepEqual(extension.portal, {
    presentationSource: "AUTHORIZED_PUBLISHED_SNAPSHOTS_ONLY",
    mutableWorkspaceRead: false,
    mutableWorkspaceFallback: false,
    explicitTripAccessGrantRequired: true,
    documentGrantRequiredSeparately: true,
    internalOnlyOutput: false,
    unknownFieldPassthrough: false,
  });
  assert.deepEqual(extension.services, {
    systemdUnitChanges: false,
    restartServices: ["travelos-admin-api.service", "travelos-portal-api.service"],
    doNotRestartServices: ["travelos-worker.service"],
    restartCaddyForConfiguration: false,
    runtimeAcceptanceListenerAdded: false,
  });
  assert.equal(extension.stage10Actions, 0);
};

export const verifyStage9DeploymentContract = async ({ root = repositoryRoot } = {}) => {
  const workspace = path.resolve(root);
  const [baseBytes, v1Bytes, extensionBytes] = await Promise.all([
    readFile(path.join(workspace, BASE_CONTRACT_PATH)),
    readFile(path.join(workspace, STAGE9_V1_CONTRACT_PATH)),
    readFile(path.join(workspace, STAGE9_CONTRACT_PATH)),
  ]);
  const baseContractSha256 = hash(baseBytes);
  assert.equal(baseContractSha256, EXPECTED_BASE_CONTRACT_SHA256);
  assert.equal(hash(v1Bytes), STAGE9_V1_CONTRACT_SHA256);
  assert.equal(
    hash(await readFile(path.join(workspace, STAGE9_V2_CONTRACT_PATH))),
    STAGE9_V2_CONTRACT_SHA256,
  );
  assert.equal(hash(extensionBytes), STAGE9_V3_CONTRACT_SHA256);
  assert.equal(
    hash(await readFile(path.join(workspace, STAGE9_BASELINE_PATH))),
    STAGE9_BASELINE_SHA256,
  );
  await verifyStage9SuccessorBaseline({ root: workspace });
  const extension = JSON.parse(extensionBytes.toString("utf8"));
  verifyStage9ExtensionShape(extension, baseContractSha256);
  const caddyBytes = await readFile(
    path.join(workspace, extension.routing.caddy.configurationSource),
  );
  assert.equal(
    hash(caddyBytes),
    extension.routing.caddy.configurationSha256,
    "Stage 9 Caddy configuration digest mismatch",
  );

  const branch = execFileSync("git", ["branch", "--show-current"], {
    cwd: workspace,
    encoding: "utf8",
  }).trim();
  assert.equal(branch, STAGE9_BRANCH);
  execFileSync("git", ["merge-base", "--is-ancestor", STAGE9_PREDECESSOR, "HEAD"], {
    cwd: workspace,
    stdio: "ignore",
  });

  const migrationChanges = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", "-z", STAGE9_PREDECESSOR, "--", "migrations"],
    { cwd: workspace, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const untrackedMigrations = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z", "--", "migrations"],
    { cwd: workspace, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const changedMigrationPaths = [...new Set([...migrationChanges, ...untrackedMigrations])].sort();
  assert.deepEqual(changedMigrationPaths, [
    STAGE9_PREVIOUS_MIGRATION_PATH,
    STAGE9_MIGRATION_PATH,
    "migrations/checksums.json",
  ]);
  assert.equal(
    hash(await readFile(path.join(workspace, STAGE9_PREVIOUS_MIGRATION_PATH))),
    STAGE9_PREVIOUS_MIGRATION_SHA256,
  );
  const migrationBytes = await readFile(path.join(workspace, STAGE9_MIGRATION_PATH));
  assert.equal(hash(migrationBytes), STAGE9_MIGRATION_SHA256);
  assert.match(migrationBytes.toString("utf8"), /exports\.down\s*=\s*false\s*;/u);
  const migrationChecksums = JSON.parse(
    await readFile(path.join(workspace, "migrations/checksums.json"), "utf8"),
  );
  assert.equal(migrationChecksums.migrations.at(-3).file, `${STAGE8_MIGRATION_HEAD}.cjs`);
  assert.deepEqual(migrationChecksums.migrations.at(-2), {
    file: path.basename(STAGE9_PREVIOUS_MIGRATION_PATH),
    sha256: STAGE9_PREVIOUS_MIGRATION_SHA256,
  });
  assert.deepEqual(migrationChecksums.migrations.at(-1), {
    file: path.basename(STAGE9_MIGRATION_PATH),
    sha256: STAGE9_MIGRATION_SHA256,
  });

  for (const [file, expectedSha256] of Object.entries(STAGE8_SYSTEMD_FILES)) {
    assert.equal(
      hash(await readFile(path.join(workspace, file))),
      expectedSha256,
      `${file} drifted`,
    );
  }
  const [adminMain, portalMain, adminApp, portalApp] = await Promise.all([
    readFile(path.join(workspace, "apps/admin-api/src/main.ts"), "utf8"),
    readFile(path.join(workspace, "apps/portal-api/src/main.ts"), "utf8"),
    readFile(path.join(workspace, "apps/admin-api/src/app.ts"), "utf8"),
    readFile(path.join(workspace, "apps/portal-api/src/app.ts"), "utf8"),
  ]);
  assert.equal(extension.artifact.adminWebPath, "admin-web");
  assert.equal(extension.artifact.portalWebPath, "portal-web");
  assert.equal(extension.presentation.sameOriginWithApi, true);
  assert.equal(extension.routing.caddyConfigurationChanges, false);
  assert.equal(
    extension.routing.caddy.expectedCurrentSha256,
    extension.routing.caddy.configurationSha256,
  );
  assert.doesNotMatch(adminMain, /resolveAdminWebRoot|webRoot/u);
  assert.doesNotMatch(portalMain, /resolvePortalWebRoot|webRoot/u);
  for (const app of [adminApp, portalApp]) {
    assert.doesNotMatch(app, /useStaticAssets|webRoot|node:path/u);
  }

  return {
    result: "PASS",
    contractId: extension.contractId,
    baseContractSha256,
    predecessorArtifactId: extension.predecessor.artifactId,
    predecessorArtifactSha256: extension.predecessor.artifactSha256,
    currentArtifactId: extension.artifact.expectedCurrentArtifactId,
    expectedCurrentArtifactId: extension.artifact.expectedCurrentArtifactId,
    expectedCurrentMigrationHead: extension.database.expectedCurrentMigrationHead,
    migrationHead: extension.database.migrationHead,
    migrationPath: extension.database.migrationPath,
    migrationSha256: extension.database.migrationSha256,
    migrationExecution: extension.database.migrationExecution,
    migrationChanges: changedMigrationPaths,
    restartServices: extension.services.restartServices,
    caddyConfigurationChanges: extension.routing.caddyConfigurationChanges,
    caddyConfigurationSha256: extension.routing.caddy.configurationSha256,
    caddyApplyAction: extension.routing.caddy.applyAction,
    stage10Actions: 0,
  };
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    assert.equal(process.argv.length, 2);
    process.stdout.write(`${JSON.stringify(await verifyStage9DeploymentContract())}\n`);
  } catch {
    process.stderr.write(
      `${JSON.stringify({ result: "FAIL", code: "DEPLOYMENT_CONTRACT_FAILED" })}\n`,
    );
    process.exitCode = 1;
  }
}
