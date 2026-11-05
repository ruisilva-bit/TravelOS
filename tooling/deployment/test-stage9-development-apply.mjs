import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sourceExtension = JSON.parse(
  await readFile(path.join(repositoryRoot, "deploy/contracts/stage-9-extension.v3.json"), "utf8"),
);
let applyModule;
try {
  applyModule = await import("./stage9-development-apply.mjs");
} catch {
  applyModule = undefined;
}
const waitForApiHealth = applyModule?.waitForApiHealth;

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const previousArtifactId = sourceExtension.artifact.expectedCurrentArtifactId;
const artifactId = "travelos-stage9-gen02-abcdef12";
const candidateCaddyConfig = await readFile(
  path.join(repositoryRoot, sourceExtension.routing.caddy.configurationSource),
);
const candidateSha256 = sourceExtension.routing.caddy.configurationSha256;
const baselineCaddyConfig = Buffer.from(candidateCaddyConfig);

const createFixture = ({ failPortalRestart = false, baselineBytes = baselineCaddyConfig } = {}) => {
  const extension = globalThis.structuredClone(sourceExtension);
  const state = {
    releaseId: previousArtifactId,
    caddyConfig: Buffer.from(baselineBytes),
  };
  const calls = [];
  let portalFailuresRemaining = failPortalRestart ? 1 : 0;
  const operations = {
    getCurrentArtifactId: async () => state.releaseId,
    getCurrentCaddyConfig: async () => Buffer.from(state.caddyConfig),
    validateCaddyConfig: async (bytes) => {
      calls.push(["validate-caddy", hash(bytes)]);
    },

    activateRelease: async (release) => {
      calls.push(["activate", release]);
      state.releaseId = release;
    },

    restartService: async (unit) => {
      calls.push(["restart", unit]);
      if (unit === "travelos-portal-api.service" && portalFailuresRemaining > 0) {
        portalFailuresRemaining -= 1;
        throw new Error("synthetic restart failure");
      }
    },
    verifyRuntime: async (release, mode) => {
      calls.push(["verify-runtime", release, mode]);
      assert.equal(state.releaseId, release);
    },
  };
  return { extension, state, calls, operations };
};

test("Stage 9 deployment operator exports the controlled DEVELOPMENT apply function", () => {
  assert.equal(typeof applyModule?.applyStage9Development, "function");
});

test("waits for API health after transient gateway failures", async (context) => {
  assert.equal(typeof waitForApiHealth, "function");
  let attempts = 0;
  const server = createServer((_request, response) => {
    attempts += 1;
    if (attempts < 3) {
      response.writeHead(502, { "content-type": "text/plain" });
      response.end("upstream unavailable");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", environment: "DEVELOPMENT" }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const health = await waitForApiHealth({
    address: "127.0.0.1",
    port: address.port,
    host: "admin.travelos.test",
    timeoutMs: 1_000,
    pollIntervalMs: 1,
  });
  assert.deepEqual(health, { status: "ok", environment: "DEVELOPMENT" });
  assert.equal(attempts, 3);
});

test("Caddy target metadata must remain a root-owned, single-link 0644 regular file", () => {
  assert.equal(typeof applyModule?.assertCaddyTargetMetadata, "function");
  const regularRootFile = {
    isFile: () => true,
    isSymbolicLink: () => false,
    uid: 0,
    gid: 0,
    mode: 0o100644,
    nlink: 1,
  };
  assert.doesNotThrow(() => applyModule.assertCaddyTargetMetadata(regularRootFile));
  assert.throws(
    () => applyModule.assertCaddyTargetMetadata({ ...regularRootFile, gid: 1000 }),
    /CADDY_FILE_GROUP_MISMATCH/u,
  );
  assert.throws(
    () => applyModule.assertCaddyTargetMetadata({ ...regularRootFile, mode: 0o100664 }),
    /CADDY_FILE_MODE_MISMATCH/u,
  );
  assert.throws(
    () => applyModule.assertCaddyTargetMetadata({ ...regularRootFile, nlink: 2 }),
    /CADDY_FILE_LINK_COUNT_MISMATCH/u,
  );
  assert.throws(
    () => applyModule.assertCaddyTargetMetadata({ ...regularRootFile, isSymbolicLink: () => true }),
    /CADDY_FILE_TYPE_MISMATCH/u,
  );
});

test("apply refuses a changed current Caddy configuration before any mutation", async (context) => {
  if (typeof applyModule?.applyStage9Development !== "function") {
    context.skip("Stage 9 deployment operator is not implemented yet");
    return;
  }
  const changedBaseline = Buffer.from("unexpected Caddy configuration\n");
  const fixture = createFixture({ baselineBytes: changedBaseline });
  await assert.rejects(
    applyModule.applyStage9Development({
      artifactId,
      candidateCaddyConfig,
      extension: fixture.extension,
      operations: fixture.operations,
    }),
    /CADDY_BASELINE_MISMATCH/u,
  );
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.state.releaseId, previousArtifactId);
  assert.deepEqual(fixture.state.caddyConfig, changedBaseline);
});

test("apply validates unchanged Caddy, activates and restarts only Stage 9 APIs", async (context) => {
  if (typeof applyModule?.applyStage9Development !== "function") {
    context.skip("Stage 9 deployment operator is not implemented yet");
    return;
  }
  const fixture = createFixture();
  const report = await applyModule.applyStage9Development({
    artifactId,
    candidateCaddyConfig,
    extension: fixture.extension,
    operations: fixture.operations,
  });
  assert.equal(report.result, "PASS");
  assert.equal(report.artifactId, artifactId);
  assert.equal(report.previousArtifactId, previousArtifactId);
  assert.equal(report.caddyConfigurationSha256, candidateSha256);
  assert.equal(report.caddyConfigurationChanges, false);
  assert.deepEqual(report.restartedUnits, [
    "travelos-admin-api.service",
    "travelos-portal-api.service",
  ]);
  assert.equal(report.stage10Actions, 0);
  assert.equal(fixture.state.releaseId, artifactId);
  assert.deepEqual(fixture.state.caddyConfig, candidateCaddyConfig);
  assert.deepEqual(fixture.calls, [
    ["validate-caddy", candidateSha256],
    ["activate", artifactId],
    ["restart", "travelos-admin-api.service"],
    ["restart", "travelos-portal-api.service"],
    ["verify-runtime", artifactId, "candidate"],
  ]);
  assert.ok(fixture.calls.every(([, value]) => value !== "travelos-worker.service"));
});

test("failed API restart restores the previous release without changing or restarting Caddy", async (context) => {
  if (typeof applyModule?.applyStage9Development !== "function") {
    context.skip("Stage 9 deployment operator is not implemented yet");
    return;
  }
  const fixture = createFixture({ failPortalRestart: true });
  await assert.rejects(
    applyModule.applyStage9Development({
      artifactId,
      candidateCaddyConfig,
      extension: fixture.extension,
      operations: fixture.operations,
    }),
    /STAGE9_APPLY_FAILED_ROLLED_BACK/u,
  );
  assert.equal(fixture.state.releaseId, previousArtifactId);
  assert.deepEqual(fixture.state.caddyConfig, baselineCaddyConfig);
  assert.deepEqual(
    fixture.calls.filter(([action]) => action === "restart").map(([, unit]) => unit),
    [
      "travelos-admin-api.service",
      "travelos-portal-api.service",
      "travelos-admin-api.service",
      "travelos-portal-api.service",
    ],
  );
  assert.ok(fixture.calls.every(([, value]) => value !== "travelos-worker.service"));
});

test("candidate runtime failure verifies the restored baseline without Stage 9 UI routes", async (context) => {
  if (typeof applyModule?.applyStage9Development !== "function") {
    context.skip("Stage 9 deployment operator is not implemented yet");
    return;
  }
  const fixture = createFixture();
  const verificationModes = [];
  const operations = {
    ...fixture.operations,
    verifyRuntime: async (release, mode) => {
      verificationModes.push([release, mode]);
      if (mode === "candidate") {
        assert.equal(release, artifactId);
        assert.equal(fixture.state.releaseId, artifactId);
        assert.deepEqual(fixture.state.caddyConfig, candidateCaddyConfig);
        throw new Error("synthetic candidate runtime rejection");
      }
      assert.equal(mode, "rollback");
      assert.equal(release, previousArtifactId);
      assert.equal(fixture.state.releaseId, previousArtifactId);
      assert.deepEqual(fixture.state.caddyConfig, baselineCaddyConfig);
    },
  };

  await assert.rejects(
    applyModule.applyStage9Development({
      artifactId,
      candidateCaddyConfig,
      extension: fixture.extension,
      operations,
    }),
    /STAGE9_APPLY_FAILED_ROLLED_BACK/u,
  );
  assert.deepEqual(verificationModes, [
    [artifactId, "candidate"],
    [previousArtifactId, "rollback"],
  ]);
  assert.equal(fixture.state.releaseId, previousArtifactId);
  assert.deepEqual(fixture.state.caddyConfig, baselineCaddyConfig);
});

test("rollback runtime verifier checks the restored baseline without requiring Stage 9 UI routes", async () => {
  const createRuntimeVerifier = applyModule?.createRuntimeVerifier;
  assert.equal(typeof createRuntimeVerifier, "function");

  const extension = globalThis.structuredClone(sourceExtension);
  const state = {
    releaseId: previousArtifactId,
    caddySha256: extension.routing.caddy.expectedCurrentSha256,
    apiExecutableOverride: undefined,
  };
  const calls = [];
  const operations = {
    getCurrentArtifactId: async () => {
      calls.push(["current-release"]);
      return state.releaseId;
    },
    getCurrentCaddySha256: async () => {
      calls.push(["caddy-hash"]);
      return state.caddySha256;
    },
    requireUnitActive: async (unit) => calls.push(["unit-active", unit]),
    getExpectedNodeExecutable: async () => {
      calls.push(["expected-node"]);
      return `/opt/travelos/releases/${state.releaseId}/runtime/node/bin/node`;
    },
    getApiProcessExecutable: async (unit) => {
      calls.push(["api-executable", unit]);
      return (
        state.apiExecutableOverride ??
        `/opt/travelos/releases/${state.releaseId}/runtime/node/bin/node`
      );
    },
    waitForApiHealth: async ({ address, port, host }) => {
      calls.push(["api-health", address, port, host]);
    },
    verifyCaddyRuntime: async () => {
      calls.push(["candidate-ui-acceptance"]);
      return { result: "CANDIDATE_CADDY_PASS" };
    },
  };
  const verifyRuntime = createRuntimeVerifier({ artifactId, extension, operations });

  const rollbackReport = await verifyRuntime(previousArtifactId, "rollback");
  assert.deepEqual(rollbackReport, {
    result: "ROLLBACK_BASELINE_PASS",
    artifactId: previousArtifactId,
    caddyConfigurationSha256: extension.routing.caddy.expectedCurrentSha256,
    apiHealth: "ok",
  });
  assert.deepEqual(calls, [
    ["current-release"],
    ["caddy-hash"],
    ["unit-active", "caddy.service"],
    ["unit-active", "travelos-admin-api.service"],
    ["unit-active", "travelos-portal-api.service"],
    ["expected-node"],
    ["api-executable", "travelos-admin-api.service"],
    ["api-executable", "travelos-portal-api.service"],
    ["api-health", "192.168.1.33", 80, "admin.travelos.test"],
    ["api-health", "192.168.1.33", 80, "portal.travelos.test"],
  ]);

  state.caddySha256 = "0".repeat(64);
  await assert.rejects(
    verifyRuntime(previousArtifactId, "rollback"),
    /CADDY_RUNTIME_READBACK_MISMATCH/u,
  );
  state.caddySha256 = extension.routing.caddy.expectedCurrentSha256;
  state.releaseId = artifactId;
  await assert.rejects(
    verifyRuntime(previousArtifactId, "rollback"),
    /CURRENT_RELEASE_READBACK_MISMATCH/u,
  );
  state.releaseId = previousArtifactId;

  state.apiExecutableOverride = "/opt/travelos/releases/unexpected/runtime/node/bin/node";
  await assert.rejects(
    verifyRuntime(previousArtifactId, "rollback"),
    /travelos-admin-api.service must run the active release Node binary/u,
  );

  calls.length = 0;
  state.apiExecutableOverride = undefined;
  state.releaseId = artifactId;
  state.caddySha256 = extension.routing.caddy.configurationSha256;
  assert.deepEqual(await verifyRuntime(artifactId, "candidate"), {
    result: "CANDIDATE_CADDY_PASS",
  });
  assert.equal(calls.filter(([name]) => name === "candidate-ui-acceptance").length, 1);
});
