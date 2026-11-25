import assert from "node:assert/strict";
import { MIGRATION_HEAD, PREDECESSOR, STAGE, TOOLCHAIN } from "./constants.mjs";
import { digest } from "./io.mjs";

export const RUNTIME_ROOTS = Object.freeze(
  [
    {
      name: "@travelos/admin-api",
      source: "apps/admin-api",
      target: "apps/admin-api",
      entrypoint: "dist/main.js",
    },
    {
      name: "@travelos/portal-api",
      source: "apps/portal-api",
      target: "apps/portal-api",
      entrypoint: "dist/main.js",
    },
    {
      name: "@travelos/worker",
      source: "apps/worker",
      target: "apps/worker",
      entrypoint: "dist/main.js",
    },
    {
      name: "@travelos/migrator",
      source: "packages/migrator",
      target: "migrator",
      entrypoint: "dist/packages/migrator/src/run-migrations.js",
    },
  ].map(Object.freeze),
);

// Cumulative Stage 6–9 operational material is preserved byte-for-byte as
// historical/reference input. Its old stage-bound installer/verifier/acceptance
// programs are NOT executable Stage 10 qualification or deployment authority.
export const PACKAGE_COPIES = Object.freeze(
  [
    ["tooling/ci/stage-10/packaged-verifier.mjs", "deployment/verify-artifact.mjs"],
    ["tooling/deployment/run-stage6-migrations.mjs", "migrator/run-stage6-migrations.mjs"],
    ["deploy/contracts/deployment-contract.v1.json", "deployment/deployment-contract.v1.json"],
    ["deploy/contracts/stage-9-extension.v1.json", "deployment/stage-9-extension.v1.json"],
    ["deploy/contracts/stage-9-extension.v2.json", "deployment/stage-9-extension.v2.json"],
    ["deploy/contracts/stage-9-extension.v3.json", "deployment/stage-9-extension.v3.json"],
    [
      "docs/reviews/phase-1-m1/STAGE_9_SUCCESSOR_BASELINE_GEN11.json",
      "provenance/stage9-successor-baseline.json",
    ],
    ["deploy/caddy/Caddyfile.stage9-development", "deployment/Caddyfile"],
    ["tooling/ci/stage-9/artifact-integrity.mjs", "deployment/historical-stage9-verifier.mjs"],
    ["tooling/ci/stage-9/constants.mjs", "deployment/constants.mjs"],
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
    [
      "tooling/ci/stage-10/rehearse-runtime-acceptance.mjs",
      "operator/stage10-runtime-acceptance.mjs",
    ],
    ["tooling/ci/stage-8/controlled-worker.mjs", "operator/controlled-worker.mjs"],
    ["tooling/ci/stage-7/runtime-acceptance-runner.mjs", "operator/stage7-regression.mjs"],
    [
      "tooling/ci/stage-9/static-runtime-acceptance.mjs",
      "operator/stage9-static-runtime-acceptance.mjs",
    ],
    ["tooling/deployment/stage9-development-apply.mjs", "operator/stage9-development-apply.mjs"],
    ["deploy/manifests/development.example.json", "instance-manifest/development.example.json"],
  ].map(Object.freeze),
);

export const deploymentContract = () => ({
  schemaVersion: 1,
  contractId: "travelos-stage10-package-contract-v1",
  stage: STAGE,
  designation: "MUTABLE_IMPLEMENTATION_REQUIRES_INDEPENDENT_REVIEW",
  environment: "CT200_DEVELOPMENT_ONLY",
  predecessor: { ...PREDECESSOR },
  toolchain: { ...TOOLCHAIN },
  database: {
    migrationHead: MIGRATION_HEAD,
    expectedCurrentMigrationHead: MIGRATION_HEAD,
    migrationChanges: false,
    startupMigrates: false,
    dependencySchemaSynchronization: false,
    migrationExecution: "CONTROLLED_CANONICAL_MIGRATOR_ONLY_AFTER_VERIFIED_BACKUP_RESTORE",
    rollback: "SAME_SCHEMA_COMPATIBLE_ARTIFACT_ONLY_OR_VERIFIED_RESTORE_FORWARD_FIX",
  },
  runtime: {
    compileOnCt200: false,
    installOnCt200: false,
    buildOncePromoteSameDigest: true,
    nodePath: "runtime/node/bin/node",
    currentSymlink: "/opt/travelos/current",
    releaseRoot: "/opt/travelos/releases",
    manifest: "/etc/travelos/instances/development.json",
    deployables: RUNTIME_ROOTS.map((row) => ({ ...row })),
    serviceContract: {
      kind: "STAGE10_PATH_ONLY_MAPPING_FROM_HISTORICAL_SERVICES",
      source: "deployment/deployment-contract.v1.json",
      verifier: "deployment/verify-artifact.mjs",
      verifierInterface: "STAGE10_CLI_INDEPENDENT_PINS_NOT_ARTIFACT_ROOT",
      verifierArguments: [
        "archive",
        "receipt",
        "receipt-sha256",
        "inputs",
        "inputs-sha256",
        "node-sha256",
        "predecessor-archive",
      ],
      historicalAcceptanceUnitsAreStage10Authority: false,
    },
    workerOverride: "deployment/worker-stage8.conf",
    caddyConfiguration: "deployment/Caddyfile",
    caddyApplyAction: "NONE",
    dnsChanges: false,
    externallyReachablePortsAdded: [],
    identities: ["travelos-admin", "travelos-portal", "travelos-worker", "travelos-migrator-exec"],
    credentialValuesInArtifact: false,
  },
  packaging: {
    sourceSnapshot: "provenance/source-snapshot.json",
    sourceBytes: "provenance/source/",
    inputs: "provenance/inputs.json",
    lockfile: "provenance/pnpm-lock.yaml",
    dependencyInventory: "provenance/runtime-dependencies.json",
    payloadManifest: "stage10-payload.json",
    historicalProgramsAreStage10Authority: false,
    referenceCopies: PACKAGE_COPIES.map((row) => [...row]),
  },
  activation: {
    status: "BLOCKED_PENDING_HOST_SIGNING_AND_OPERATIONAL_QUALIFICATION",
    requiresExternalCanonicalCi: true,
    requiresExactArtifactRehearsal: true,
    requiresIndependentlyPinnedDevelopmentSignature: true,
    requiresQualifiedLeastPrivilegeHostExecutor: true,
    requiresIndependentlyReviewedRetainedEvidence: true,
    productionPermission: false,
  },
  stage11Actions: 0,
});
export const verifyDeploymentContract = (contract) => {
  assert.deepEqual(contract, deploymentContract(), "Stage 10 deployment contract drift");
  return { result: "CONTRACT_STRUCTURE_ONLY_NOT_OPERATIONAL_ACCEPTANCE", sha256: digest(contract) };
};
