import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const resolveHelper = async (candidates) => {
  for (const candidate of candidates) {
    try {
      return await realpath(candidate);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error("STAGE9_HELPER_MODULE_MISSING");
};
const verifierPath = await resolveHelper([
  path.join(moduleDirectory, "../deployment/verify-artifact.mjs"),
  path.join(moduleDirectory, "../ci/stage-9/artifact-integrity.mjs"),
]);
const constantsPath = await resolveHelper([
  path.join(moduleDirectory, "../deployment/constants.mjs"),
  path.join(moduleDirectory, "../ci/stage-9/constants.mjs"),
]);
const { verifyArtifact } = await import(pathToFileURL(verifierPath).href);
const {
  STAGE9_CURRENT_ARTIFACT_ID,
  STAGE9_CURRENT_ARTIFACT_SHA256,
  STAGE9_CURRENT_MIGRATION_HEAD,
  STAGE9_MIGRATION_HEAD,
  STAGE9_MIGRATION_PATH,
  STAGE9_MIGRATION_SHA256,
  STAGE9_STAGE,
} = await import(pathToFileURL(constantsPath).href);

const RELEASE_ROOT = "/opt/travelos/releases";
const CURRENT_RELEASE = "/opt/travelos/current";
const CADDY_CONFIG = "/etc/caddy/Caddyfile";
const CADDY_UNIT = "caddy.service";
const API_UNITS = Object.freeze(["travelos-admin-api.service", "travelos-portal-api.service"]);
const ALLOWED_RESTART_UNITS = new Set(API_UNITS);
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const HEALTH_REQUEST_TIMEOUT_MS = 2_000;
const HEALTH_READINESS_TIMEOUT_MS = 30_000;
const HEALTH_POLL_INTERVAL_MS = 250;

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout ?? 30_000,
    maxBuffer: 1024 * 1024,
  });

const assertOperationalScope = ({ artifactId, extension, candidateCaddyConfig }) => {
  assert.match(artifactId, /^travelos-stage9-gen[0-9]{2}-[a-f0-9]{8}$/u);
  assert.equal(extension.stage, STAGE9_STAGE);
  assert.equal(extension.stage10Actions, 0);
  assert.equal(extension.artifact.expectedCurrentArtifactId, STAGE9_CURRENT_ARTIFACT_ID);
  assert.equal(extension.artifact.expectedCurrentArtifactSha256, STAGE9_CURRENT_ARTIFACT_SHA256);
  assert.equal(extension.routing.caddyConfigurationChanges, false);
  assert.equal(extension.routing.caddy.targetPath, CADDY_CONFIG);
  assert.equal(extension.routing.caddy.artifactPath, "deployment/Caddyfile");
  assert.equal(extension.routing.caddy.adminApi, "OFF");
  assert.equal(extension.routing.caddy.applyAction, "NONE");
  assert.equal(extension.services.restartCaddyForConfiguration, false);
  assert.equal(
    extension.routing.caddy.expectedCurrentSha256,
    extension.routing.caddy.configurationSha256,
  );
  assert.equal(extension.database.expectedCurrentMigrationHead, STAGE9_CURRENT_MIGRATION_HEAD);
  assert.equal(extension.database.migrationHead, STAGE9_MIGRATION_HEAD);
  assert.equal(extension.database.migrationChanges, true);
  assert.equal(extension.database.migrationPath, STAGE9_MIGRATION_PATH);
  assert.equal(extension.database.migrationSha256, STAGE9_MIGRATION_SHA256);
  assert.equal(
    extension.database.migrationExecution,
    "CONTROLLED_MIGRATOR_UP_AFTER_VERIFIED_RESTORE",
  );
  assert.deepEqual(extension.services.restartServices, API_UNITS);
  assert.deepEqual(extension.services.doNotRestartServices, ["travelos-worker.service"]);
  assert.deepEqual(extension.routing.newExternallyReachablePorts, []);
  assert.equal(extension.routing.dnsChanges, false);
  assert.equal(extension.routing.requestHostSelectsAgency, false);
  assert.match(extension.routing.caddy.expectedCurrentSha256, /^[a-f0-9]{64}$/u);
  assert.equal(hash(candidateCaddyConfig), extension.routing.caddy.configurationSha256);
};

export const applyStage9Development = async ({
  artifactId,
  candidateCaddyConfig,
  extension,
  operations,
}) => {
  assertOperationalScope({ artifactId, extension, candidateCaddyConfig });
  for (const name of [
    "getCurrentArtifactId",
    "getCurrentCaddyConfig",
    "validateCaddyConfig",
    "activateRelease",
    "restartService",
    "verifyRuntime",
  ])
    assert.equal(typeof operations?.[name], "function", `Missing deployment operation: ${name}`);

  const previousArtifactId = extension.artifact.expectedCurrentArtifactId;
  const observedArtifactId = await operations.getCurrentArtifactId();
  assert.equal(observedArtifactId, previousArtifactId, "CURRENT_RELEASE_MISMATCH");
  const previousCaddyConfig = Buffer.from(await operations.getCurrentCaddyConfig());
  const previousCaddySha256 = hash(previousCaddyConfig);
  assert.equal(
    previousCaddySha256,
    extension.routing.caddy.expectedCurrentSha256,
    "CADDY_BASELINE_MISMATCH",
  );
  const candidate = Buffer.from(candidateCaddyConfig);
  await operations.validateCaddyConfig(candidate);

  try {
    await operations.activateRelease(artifactId);
    for (const unit of API_UNITS) await operations.restartService(unit);
    await operations.verifyRuntime(artifactId, "candidate");
  } catch {
    let rollbackSucceeded = true;
    try {
      const currentArtifactId = await operations.getCurrentArtifactId();
      if (currentArtifactId !== previousArtifactId) {
        await operations.activateRelease(previousArtifactId);
        for (const unit of API_UNITS) await operations.restartService(unit);
      }
      await operations.verifyRuntime(previousArtifactId, "rollback");
    } catch {
      rollbackSucceeded = false;
    }
    throw new Error(
      rollbackSucceeded ? "STAGE9_APPLY_FAILED_ROLLED_BACK" : "STAGE9_APPLY_FAILED_ROLLBACK_FAILED",
    );
  }

  return {
    result: "PASS",
    artifactId,
    previousArtifactId,
    caddyConfigurationSha256: hash(candidate),
    caddyConfigurationChanges: false,
    caddyBackupPath: null,
    restartedUnits: API_UNITS,
    stage10Actions: 0,
  };
};

const readResponse = (host, port, requestHost, requestPath, timeoutMs = REQUEST_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: host,
        port,
        method: "GET",
        path: requestPath,
        headers: { host: requestHost, accept: "*/*" },
        timeout: timeoutMs,
      },
      (response) => {
        let byteCount = 0;
        const chunks = [];
        response.on("data", (chunk) => {
          byteCount += chunk.length;
          if (byteCount > MAX_RESPONSE_BYTES) request.destroy(new Error("response limit"));
          else chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    request.on("timeout", () => request.destroy(new Error("request timeout")));
    request.on("error", () => reject(new Error("CADDY_HTTP_PROBE_FAILED")));
    request.end();
  });

export const waitForApiHealth = async ({
  address,
  port,
  host,
  timeoutMs = HEALTH_READINESS_TIMEOUT_MS,
  pollIntervalMs = HEALTH_POLL_INTERVAL_MS,
}) => {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    let response;
    try {
      response = await readResponse(address, port, host, "/health/live", HEALTH_REQUEST_TIMEOUT_MS);
    } catch (error) {
      if (error?.message !== "CADDY_HTTP_PROBE_FAILED") throw error;
    }

    if (response?.status === 200) {
      assert.match(response.headers["content-type"] ?? "", /application\/json/iu);
      const health = JSON.parse(response.body.toString("utf8"));
      assert.equal(health.status, "ok");
      assert.equal(health.environment, "DEVELOPMENT");
      return health;
    }
    if (response && ![502, 503, 504].includes(response.status))
      throw new Error("CADDY_HEALTH_UNEXPECTED_STATUS");

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("CADDY_HEALTH_READINESS_TIMEOUT");
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)));
  }
};

const verifySurface = async ({ address, port, host, shellMarker, protectedPath, authPath }) => {
  const root = await readResponse(address, port, host, "/");
  assert.equal(root.status, 200, `${host} root status`);
  assert.match(root.headers["content-type"] ?? "", /text\/html/iu);
  assert.match(root.headers["cache-control"] ?? "", /private,\s*no-store/iu);
  const html = root.body.toString("utf8");
  assert.match(html, new RegExp(`id=["']${shellMarker}["']`, "u"));
  assert.match(html, /<html\b[^>]*\blang="pt-PT"/iu);

  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)(?:[?#][^"]*)?"/giu)].map(
    ([, asset]) => asset,
  );
  const javascript = assets.find((asset) => /\.js$/u.test(asset));
  const stylesheet = assets.find((asset) => /\.css$/u.test(asset));
  assert.ok(javascript && stylesheet, `${host} must link local JavaScript and CSS`);
  for (const [asset, contentType] of [
    [javascript, /javascript|ecmascript/iu],
    [stylesheet, /text\/css/iu],
  ]) {
    const response = await readResponse(address, port, host, asset);
    assert.equal(response.status, 200, `${host} static asset status`);
    assert.match(response.headers["content-type"] ?? "", contentType);
    assert.match(response.headers["cache-control"] ?? "", /private,\s*no-store/iu);
    assert.ok(response.body.length > 0);
  }

  const health = await readResponse(address, port, host, "/health/live");
  assert.equal(health.status, 200, `${host} health status`);
  assert.match(health.headers["content-type"] ?? "", /application\/json/iu);
  const healthBody = JSON.parse(health.body.toString("utf8"));
  assert.equal(healthBody.status, "ok");
  assert.equal(healthBody.environment, "DEVELOPMENT");

  const auth = await readResponse(address, port, host, authPath);
  assert.equal(auth.status, 200, `${host} auth realm status`);
  const protectedResponse = await readResponse(address, port, host, protectedPath);
  assert.equal(protectedResponse.status, 401, `${host} protected route status`);

  const unknown = await readResponse(address, port, host, "/__travelos_stage9_unknown_route__");
  assert.equal(unknown.status, 404, `${host} unknown route status`);
  assert.equal(unknown.body.toString("utf8").includes(shellMarker), false);
  const dotfile = await readResponse(address, port, host, "/.env");
  assert.ok([403, 404].includes(dotfile.status), `${host} dotfile status`);

  return {
    rootStatus: root.status,
    assetStatus: 200,
    healthStatus: health.status,
    authStatus: auth.status,
    protectedStatus: protectedResponse.status,
    unknownRouteStatus: unknown.status,
    dotfileStatus: dotfile.status,
  };
};

const verifyCaddyRuntime = async (extension) => {
  const [address, portText] = extension.routing.caddy.listener.split(":");
  const port = Number(portText);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535);
  const surfaces = {
    admin: await verifySurface({
      address,
      port,
      host: extension.routing.adminHost,
      shellMarker: extension.presentation.adminShellMarker,
      authPath: "/api/auth/staff/get-session",
      protectedPath: "/api/staff/session-context",
    }),
    portal: await verifySurface({
      address,
      port,
      host: extension.routing.portalHost,
      shellMarker: extension.presentation.portalShellMarker,
      authPath: "/api/auth/portal/get-session",
      protectedPath: "/api/portal/trips",
    }),
  };
  const unknownHost = await readResponse(address, port, "unlisted.travelos.test", "/");
  assert.equal(unknownHost.status, extension.routing.caddy.unknownHostStatus);
  return { surfaces, unknownHostStatus: unknownHost.status };
};

const unitMainPid = (unit) =>
  Number(run("/usr/bin/systemctl", ["show", unit, "-p", "MainPID", "--value"]).trim());
const requireUnitActive = (unit) => {
  assert.equal(
    run("/usr/bin/systemctl", ["is-active", unit]).trim(),
    "active",
    `${unit} is active`,
  );
};
const currentArtifactId = async () => {
  const current = await realpath(CURRENT_RELEASE);
  const release = JSON.parse(await readFile(path.join(current, "release.json"), "utf8"));
  return release.artifactId;
};
const requireRegularRootFile = async (target) => {
  const directory = path.dirname(target);
  const directoryMetadata = await lstat(directory);
  assert.ok(
    directoryMetadata.isDirectory() && !directoryMetadata.isSymbolicLink(),
    "CADDY_DIRECTORY_TYPE_MISMATCH",
  );
  assert.equal(directoryMetadata.uid, 0, "CADDY_DIRECTORY_OWNER_MISMATCH");
  assert.equal(directoryMetadata.gid, 0, "CADDY_DIRECTORY_GROUP_MISMATCH");
  assert.equal(directoryMetadata.mode & 0o022, 0, "CADDY_DIRECTORY_WRITABLE_BY_UNPRIVILEGED");
  assert.equal(await realpath(directory), directory, "CADDY_DIRECTORY_PATH_MISMATCH");
  const metadata = await lstat(target);
  assertCaddyTargetMetadata(metadata);
  return metadata;
};

export const assertCaddyTargetMetadata = (metadata) => {
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), "CADDY_FILE_TYPE_MISMATCH");
  assert.equal(metadata.uid, 0, "CADDY_FILE_OWNER_MISMATCH");
  assert.equal(metadata.gid, 0, "CADDY_FILE_GROUP_MISMATCH");
  assert.equal(metadata.mode, 0o100644, "CADDY_FILE_MODE_MISMATCH");
  assert.equal(metadata.nlink, 1, "CADDY_FILE_LINK_COUNT_MISMATCH");
};

export const createRuntimeVerifier =
  ({ artifactId, extension, operations }) =>
  async (expectedArtifactId, verificationMode) => {
    assert.ok(["candidate", "rollback"].includes(verificationMode));
    assert.equal(
      expectedArtifactId,
      verificationMode === "candidate" ? artifactId : extension.artifact.expectedCurrentArtifactId,
      "RUNTIME_VERIFICATION_ARTIFACT_MISMATCH",
    );
    assert.equal(
      await operations.getCurrentArtifactId(),
      expectedArtifactId,
      "CURRENT_RELEASE_READBACK_MISMATCH",
    );
    const expectedCaddySha256 =
      verificationMode === "candidate"
        ? extension.routing.caddy.configurationSha256
        : extension.routing.caddy.expectedCurrentSha256;
    assert.equal(
      await operations.getCurrentCaddySha256(),
      expectedCaddySha256,
      "CADDY_RUNTIME_READBACK_MISMATCH",
    );
    for (const unit of [CADDY_UNIT, ...API_UNITS]) await operations.requireUnitActive(unit);
    const expectedNode = await operations.getExpectedNodeExecutable();
    for (const unit of API_UNITS)
      assert.equal(
        await operations.getApiProcessExecutable(unit),
        expectedNode,
        `${unit} must run the active release Node binary`,
      );
    const [address, portText] = extension.routing.caddy.listener.split(":");
    const port = Number(portText);
    await operations.waitForApiHealth({ address, port, host: extension.routing.adminHost });
    await operations.waitForApiHealth({ address, port, host: extension.routing.portalHost });
    if (verificationMode === "rollback")
      return {
        result: "ROLLBACK_BASELINE_PASS",
        artifactId: expectedArtifactId,
        caddyConfigurationSha256: expectedCaddySha256,
        apiHealth: "ok",
      };
    return operations.verifyCaddyRuntime(extension);
  };

const makeOperations = ({ artifactId, extension, candidatePath }) => {
  const verifyRuntime = createRuntimeVerifier({
    artifactId,
    extension,
    operations: {
      getCurrentArtifactId: currentArtifactId,
      getCurrentCaddySha256: async () => hash(await readFile(CADDY_CONFIG)),
      requireUnitActive,
      getExpectedNodeExecutable: async () =>
        path.join(await realpath(CURRENT_RELEASE), "runtime/node/bin/node"),
      getApiProcessExecutable: (unit) => {
        const pid = unitMainPid(unit);
        assert.ok(Number.isInteger(pid) && pid > 0, `${unit} must have a process`);
        return run("/usr/bin/readlink", ["-f", `/proc/${pid}/exe`]).trim();
      },
      waitForApiHealth,
      verifyCaddyRuntime,
    },
  });

  return {
    getCurrentArtifactId: currentArtifactId,
    getCurrentCaddyConfig: async () => {
      await requireRegularRootFile(CADDY_CONFIG);
      return readFile(CADDY_CONFIG);
    },
    validateCaddyConfig: async () => {
      try {
        run("/usr/bin/caddy", ["validate", "--config", candidatePath, "--adapter", "caddyfile"]);
      } catch {
        throw new Error("CADDY_VALIDATION_FAILED");
      }
    },
    activateRelease: (release) => {
      assert.ok([artifactId, extension.artifact.expectedCurrentArtifactId].includes(release));
      run("/usr/local/bin/travelos-agentctl", ["activate-release", release]);
    },
    restartService: (unit) => {
      assert.ok(ALLOWED_RESTART_UNITS.has(unit), "SERVICE_RESTART_NOT_ALLOWLISTED");
      run("/usr/bin/systemctl", ["restart", unit], { timeout: 120_000 });
      requireUnitActive(unit);
    },
    verifyRuntime,
  };
};

const parseArguments = (arguments_) => {
  assert.equal(arguments_.length, 2, "USAGE");
  const [artifactOption, modeOption] = arguments_;
  assert.ok(artifactOption.startsWith("--artifact-root="), "USAGE");
  assert.ok(["--mode=check", "--mode=apply"].includes(modeOption), "USAGE");
  const providedRoot = artifactOption.slice("--artifact-root=".length);
  assert.ok(path.isAbsolute(providedRoot), "ARTIFACT_ROOT_MUST_BE_ABSOLUTE");
  const artifactRoot = path.resolve(providedRoot);
  return { artifactRoot, mode: modeOption.slice("--mode=".length) };
};

const runCli = async () => {
  try {
    const { artifactRoot, mode } = parseArguments(process.argv.slice(2));
    const verification = await verifyArtifact(artifactRoot);
    assert.equal(verification.result, "PASS");
    const root = await realpath(artifactRoot);
    assert.equal(root, artifactRoot, "ARTIFACT_ROOT_MUST_NOT_BE_SYMLINK");
    const releaseMetadata = JSON.parse(await readFile(path.join(root, "release.json"), "utf8"));
    assert.equal(
      root,
      path.join(RELEASE_ROOT, releaseMetadata.artifactId),
      "UNEXPECTED_RELEASE_ROOT",
    );
    const releaseMetadataStat = await lstat(root);
    assert.ok(releaseMetadataStat.isDirectory() && !releaseMetadataStat.isSymbolicLink());
    assert.equal(releaseMetadataStat.uid, 0, "RELEASE_MUST_BE_SEALED_ROOT_OWNED");
    const extension = JSON.parse(
      await readFile(path.join(root, "deployment/stage-9-extension.v3.json"), "utf8"),
    );
    const candidatePath = path.join(root, extension.routing.caddy.artifactPath);
    const candidateCaddyConfig = await readFile(candidatePath);
    assert.equal(hash(candidateCaddyConfig), extension.routing.caddy.configurationSha256);
    assert.equal(await currentArtifactId(), extension.artifact.expectedCurrentArtifactId);
    await requireRegularRootFile(CADDY_CONFIG);
    const currentCaddyConfig = await readFile(CADDY_CONFIG);
    assert.equal(hash(currentCaddyConfig), extension.routing.caddy.expectedCurrentSha256);
    for (const unit of [CADDY_UNIT, ...API_UNITS, "travelos-worker.service"])
      requireUnitActive(unit);
    run("/usr/bin/caddy", ["validate", "--config", candidatePath, "--adapter", "caddyfile"]);

    if (mode === "check") {
      process.stdout.write(
        `${JSON.stringify({
          result: "PASS",
          mode,
          artifactId: releaseMetadata.artifactId,
          currentArtifactId: extension.artifact.expectedCurrentArtifactId,
          caddyConfigurationSha256: hash(candidateCaddyConfig),
          caddyBaselineSha256: hash(currentCaddyConfig),
          caddyConfigurationChanges: false,
          expectedCurrentMigrationHead: extension.database.expectedCurrentMigrationHead,
          candidateMigrationHead: extension.database.migrationHead,
          migrationExecution: extension.database.migrationExecution,
          caddyParsed: true,
          stage10Actions: 0,
        })}\n`,
      );
      return;
    }

    assert.equal(typeof process.getuid, "function");
    assert.equal(process.getuid(), 0, "ROOT_REQUIRED_FOR_APPLY");
    const report = await applyStage9Development({
      artifactId: releaseMetadata.artifactId,
      candidateCaddyConfig,
      extension,
      operations: makeOperations({
        artifactId: releaseMetadata.artifactId,
        extension,
        candidatePath,
      }),
    });
    process.stdout.write(`${JSON.stringify({ ...report, mode })}\n`);
  } catch (error) {
    const safeCodes = new Set([
      "USAGE",
      "CURRENT_RELEASE_MISMATCH",
      "CADDY_BASELINE_MISMATCH",
      "CADDY_VALIDATION_FAILED",
      "ROOT_REQUIRED_FOR_APPLY",
      "STAGE9_APPLY_FAILED_ROLLED_BACK",
      "STAGE9_APPLY_FAILED_ROLLBACK_FAILED",
    ]);
    const code = safeCodes.has(error?.message) ? error.message : "STAGE9_DEVELOPMENT_APPLY_FAILED";
    process.stderr.write(`${JSON.stringify({ result: "FAIL", code, stage10Actions: 0 })}\n`);
    process.exitCode = 1;
  }
};

const invokedPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
const modulePath = await realpath(fileURLToPath(import.meta.url));
if (invokedPath !== null && invokedPath === modulePath) await runCli();
