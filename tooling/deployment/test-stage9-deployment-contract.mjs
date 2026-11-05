import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";

import {
  verifyStage9DeploymentContract,
  verifyStage9ExtensionShape,
} from "./verify-stage9-deployment-contract.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const extension = JSON.parse(
  await readFile(path.join(repositoryRoot, "deploy/contracts/stage-9-extension.v1.json"), "utf8"),
);
const baseContractSha256 = extension.extends.sha256;
const successorExtension = JSON.parse(
  await readFile(
    path.join(repositoryRoot, "deploy/contracts/stage-9-extension.v3.json"),
    "utf8",
  ).catch(() => "{}"),
);

test("Stage 9 deployment extension preserves the accepted runtime and release boundaries", async () => {
  const report = await verifyStage9DeploymentContract();
  assert.equal(report.result, "PASS");
  assert.equal(report.contractId, "travelos-stage9-staff-invitations-v3");
  assert.equal(report.expectedCurrentArtifactId, "travelos-stage9-gen10-724605fc");
  assert.equal(report.predecessorArtifactId, "travelos-stage8-gen03-3d6c977d");
  assert.equal(report.expectedCurrentMigrationHead, "0015_stage9_trip_workspace_writes");
  assert.equal(report.migrationHead, "0016_stage9_staff_invitations");
  assert.equal(report.migrationPath, "migrations/0016_stage9_staff_invitations.cjs");
  assert.equal(
    report.migrationSha256,
    "a1734cef25a350d22de35b1a967282375c46b894c434601d781f925e33eb6070",
  );
  assert.equal(report.migrationExecution, "CONTROLLED_MIGRATOR_UP_AFTER_VERIFIED_RESTORE");
  assert.deepEqual(report.migrationChanges, [
    "migrations/0015_stage9_trip_workspace_writes.cjs",
    "migrations/0016_stage9_staff_invitations.cjs",
    "migrations/checksums.json",
  ]);
  assert.equal(
    report.caddyConfigurationSha256,
    "1d48af95032be05aed01cbab7cd9f59e8265adced1af1c3cf0205e10e5165740",
  );
  assert.equal(report.caddyConfigurationChanges, false);
  assert.equal(report.caddyApplyAction, "NONE");
  assert.equal(report.currentArtifactId, "travelos-stage9-gen10-724605fc");
  assert.deepEqual(report.restartServices, [
    "travelos-admin-api.service",
    "travelos-portal-api.service",
  ]);
  assert.equal(report.stage10Actions, 0);
});

test("Stage 9 v3 pins Gen10, immutable v2 lineage and the approved successor baseline", async () => {
  assert.doesNotThrow(() => verifyStage9ExtensionShape(successorExtension, baseContractSha256));
  assert.deepEqual(successorExtension.supersedes, {
    path: "deploy/contracts/stage-9-extension.v2.json",
    sha256: "8938b958ca3bc1dd20b1a232a29b00ab81f2970874f5070ce347c4c98e32bb2b",
  });
  const v1Bytes = await readFile(
    path.join(repositoryRoot, "deploy/contracts/stage-9-extension.v2.json"),
  );
  assert.equal(
    createHash("sha256").update(v1Bytes).digest("hex"),
    successorExtension.supersedes.sha256,
  );
  const migrationBytes = await readFile(
    path.join(repositoryRoot, successorExtension.database.migrationPath),
  );
  assert.equal(
    createHash("sha256").update(migrationBytes).digest("hex"),
    successorExtension.database.migrationSha256,
  );
  const checksums = JSON.parse(
    await readFile(path.join(repositoryRoot, "migrations/checksums.json"), "utf8"),
  );
  assert.deepEqual(checksums.migrations.at(-1), {
    file: "0016_stage9_staff_invitations.cjs",
    sha256: successorExtension.database.migrationSha256,
  });
  const baselineBytes = await readFile(
    path.join(repositoryRoot, successorExtension.approvedSuccessorBaseline.path),
  );
  assert.equal(
    createHash("sha256").update(baselineBytes).digest("hex"),
    successorExtension.approvedSuccessorBaseline.sha256,
  );
  assert.equal(
    successorExtension.artifact.expectedCurrentArtifactSha256,
    "e8b0d027217bd8ed24f8650b35b518fc23481b1b45fe93a1a2bc32e378667626",
  );
});

test("Stage 9 Caddy serves only allowlisted static shells and proxies exact API paths", async () => {
  const caddy = extension.routing.caddy;
  assert.deepEqual(caddy, {
    configurationSource: "deploy/caddy/Caddyfile.stage9-development",
    artifactPath: "deployment/Caddyfile",
    targetPath: "/etc/caddy/Caddyfile",
    expectedCurrentSha256: "0c5a22ecc033b17d2920ddcd63e359dc97631c9ebc6855137aaab3f29a3c7bb4",
    configurationSha256: "1d48af95032be05aed01cbab7cd9f59e8265adced1af1c3cf0205e10e5165740",
    adminApi: "OFF",
    listener: "192.168.1.33:80",
    applyAction: "systemctl restart caddy.service",
    apiPaths: ["/api", "/api/*", "/health", "/health/*"],
    adminStaticRoot: "/opt/travelos/current/admin-web",
    portalStaticRoot: "/opt/travelos/current/portal-web",
    cacheControl: "private, no-store",
    dotfiles: "DENY",
    unknownPathFallback: false,
    unknownHostStatus: 421,
  });
  const source = await readFile(path.join(repositoryRoot, caddy.configurationSource));
  assert.match(caddy.configurationSha256, /^[a-f0-9]{64}$/u);
  assert.equal(createHash("sha256").update(source).digest("hex"), caddy.configurationSha256);
  const config = source.toString("utf8");
  assert.match(config, /^\s*admin off\s*$/mu);
  assert.equal((config.match(/bind 192\.168\.1\.33/gu) ?? []).length, 3);
  assert.match(config, /http:\/\/admin\.travelos\.test\s*\{/u);
  assert.match(config, /http:\/\/portal\.travelos\.test\s*\{/u);
  assert.match(config, /root \* \/opt\/travelos\/current\/admin-web/u);
  assert.match(config, /root \* \/opt\/travelos\/current\/portal-web/u);
  assert.match(config, /reverse_proxy 127\.0\.0\.1:3101/u);
  assert.match(config, /reverse_proxy 127\.0\.0\.1:3102/u);
  assert.match(config, /header_up -X-Forwarded-Host/u);
  assert.equal((config.match(/file_server\s*\{/gu) ?? []).length, 2);
  assert.equal((config.match(/hide \.\*/gu) ?? []).length, 2);
  assert.doesNotMatch(config, /try_files|handle_errors|browse\s*(?:\{|$)/iu);
  assert.match(config, /respond 421/u);
});

test("extension rejects compilation, migration, portal fallback, and extra runtime restarts", () => {
  const cases = [
    (candidate) => {
      candidate.artifact.compileOnCt200 = true;
    },
    (candidate) => {
      candidate.database.migrationExecution = "NONE";
    },
    (candidate) => {
      candidate.database.migrationHead = "0014_stage8_worker_activity";
    },
    (candidate) => {
      candidate.database.migrationSha256 = "0".repeat(64);
    },
    (candidate) => {
      candidate.portal.mutableWorkspaceFallback = true;
    },
    (candidate) => {
      candidate.services.restartServices.push("travelos-worker.service");
    },
    (candidate) => {
      candidate.services.doNotRestartServices.pop();
    },
    (candidate) => {
      candidate.routing.caddy.applyAction = "systemctl reload caddy.service";
    },
    (candidate) => {
      candidate.routing.caddyConfigurationChanges = true;
    },
    (candidate) => {
      candidate.routing.caddy.adminApi = "ENABLED";
    },
    (candidate) => {
      candidate.stage10Actions = 1;
    },
  ];
  for (const mutate of cases) {
    const candidate = JSON.parse(JSON.stringify(successorExtension));
    mutate(candidate);
    assert.throws(() => verifyStage9ExtensionShape(candidate, baseContractSha256));
  }
});

test("extension rejects a changed accepted Stage 6 deployment contract", () => {
  assert.throws(() => verifyStage9ExtensionShape(successorExtension, "0".repeat(64)));
});
