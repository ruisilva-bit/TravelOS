import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const STAGE = "PHASE_1_M1_STAGE_9";
const EXPECTED_HOSTS = Object.freeze({
  admin: "admin.travelos.test",
  portal: "portal.travelos.test",
});
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const RESPONSE_TIMEOUT_MS = 10_000;

const resolveRuntimePackageImport = async ({ appRoot, packageName }) => {
  const packageRoot = await realpath(path.join(appRoot, "node_modules", ...packageName.split("/")));
  const packageMetadata = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  );
  const exportPath = packageMetadata.exports?.["."]?.import;
  assert.ok(typeof exportPath === "string" && exportPath.startsWith("./"));
  const entryPath = await realpath(path.join(packageRoot, exportPath));
  assert.ok(entryPath.startsWith(`${packageRoot}${path.sep}`));
  return pathToFileURL(entryPath).href;
};

const requestLoopback = (listener, host, requestPath) =>
  new Promise((resolve, reject) => {
    assert.equal(
      listener?.host,
      "127.0.0.1",
      "Runtime acceptance permits loopback API listeners only",
    );
    assert.ok(Number.isInteger(listener?.port) && listener.port > 0 && listener.port <= 65_535);
    assert.ok(requestPath.startsWith("/") && !requestPath.startsWith("//"));
    const request = httpRequest(
      {
        hostname: listener.host,
        port: listener.port,
        method: "GET",
        path: requestPath,
        headers: { host, accept: "*/*" },
        timeout: RESPONSE_TIMEOUT_MS,
      },
      (response) => {
        let bytes = 0;
        const chunks = [];
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) request.destroy(new Error("RESPONSE_LIMIT"));
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
    request.on("timeout", () => request.destroy(new Error("REQUEST_TIMEOUT")));
    request.on("error", () => reject(new Error("LOOPBACK_REQUEST_FAILED")));
    request.end();
  });

const jsonResponse = (response, expectedStatus, label) => {
  assert.equal(response.status, expectedStatus, `${label} returned unexpected status`);
  assert.match(response.headers["content-type"] ?? "", /application\/json/iu);
  try {
    return JSON.parse(response.body.toString("utf8"));
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
};

const verifyApiSurface = async ({ manifest, surface, artifactShell }) => {
  const app = surface === "admin" ? "admin" : "portal";
  const host = manifest.hosts[app];
  const listener = manifest.runtime.listeners[`${app}Api`];
  assert.equal(
    artifactShell?.entrypoint,
    `${app}-web/index.html`,
    `${app} shell must be part of the verified artifact`,
  );
  assert.ok(
    Number.isInteger(artifactShell.assets) && artifactShell.assets >= 2,
    `${app} artifact shell must include compiled JavaScript and CSS assets`,
  );

  const health = jsonResponse(
    await requestLoopback(listener, host, "/health/live"),
    200,
    `${app} liveness route`,
  );
  assert.deepEqual(health, { status: "ok", service: `${app}-api`, environment: "DEVELOPMENT" });

  const realm = surface === "admin" ? "staff" : "portal";
  jsonResponse(
    await requestLoopback(listener, host, `/api/auth/${realm}/get-session`),
    200,
    `${app} auth realm route`,
  );
  const protectedPath = surface === "admin" ? "/api/staff/session-context" : "/api/portal/trips";
  const protectedResponse = await requestLoopback(listener, host, protectedPath);
  assert.equal(
    protectedResponse.status,
    401,
    `${app} anonymous protected route returned unexpected status`,
  );
  const root = await requestLoopback(listener, host, "/");
  assert.equal(root.status, 404, `${app} API must not serve the static shell`);
  const unknown = await requestLoopback(listener, host, "/__travelos_stage9_unknown_route__");
  assert.equal(unknown.status, 404, `${app} unknown route must not fall back to the SPA shell`);
  assert.equal(
    unknown.body.toString("utf8").includes(`${app}-root`),
    false,
    `${app} unknown route returned the SPA shell`,
  );

  return {
    assets: artifactShell.assets,
    healthStatus: 200,
    authenticationStatus: 200,
    protectedStatus: 401,
    rootStatus: 404,
    unknownRouteStatus: 404,
  };
};

export const runStaticRuntimeAcceptance = async ({ manifest, artifact }) => {
  assert.equal(manifest?.environment, "DEVELOPMENT", "Static acceptance is DEVELOPMENT-only");
  assert.deepEqual(manifest.hosts, EXPECTED_HOSTS);
  assert.equal(artifact?.result, "PASS", "Static acceptance requires a verified artifact");
  assert.equal(artifact.stage10Actions, 0);
  assert.ok(artifact.shells && typeof artifact.shells === "object");
  assert.equal(typeof manifest.runtime?.listeners, "object");
  for (const surface of ["admin", "portal"]) {
    const listener = manifest.runtime.listeners[`${surface}Api`];
    assert.equal(listener?.host, "127.0.0.1");
    assert.ok(Number.isInteger(listener?.port) && listener.port > 0 && listener.port <= 65_535);
  }
  return {
    result: "PASS",
    stage: STAGE,
    surfaces: {
      admin: await verifyApiSurface({
        manifest,
        surface: "admin",
        artifactShell: artifact.shells.admin,
      }),
      portal: await verifyApiSurface({
        manifest,
        surface: "portal",
        artifactShell: artifact.shells.portal,
      }),
    },
    stage10Actions: 0,
  };
};

const runCli = async () => {
  let phase = "arguments";
  try {
    assert.equal(process.argv.length, 3);
    assert.ok(process.argv[2].startsWith("--manifest="));
    const manifestPath = process.argv[2].slice("--manifest=".length);
    assert.ok(path.isAbsolute(manifestPath));
    const artifactRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

    phase = "artifact verification";
    const { verifyArtifact } = await import(
      pathToFileURL(path.join(artifactRoot, "deployment/verify-artifact.mjs")).href
    );
    const artifact = await verifyArtifact(artifactRoot);
    assert.equal(artifact.result, "PASS");
    const release = JSON.parse(await readFile(path.join(artifactRoot, "release.json"), "utf8"));
    assert.equal(release.stage, STAGE);
    assert.equal(release.environment, "DEVELOPMENT");

    phase = "manifest validation";
    const configUrl = await resolveRuntimePackageImport({
      appRoot: path.join(artifactRoot, "apps/admin-api"),
      packageName: "@travelos/config",
    });
    const config = await import(configUrl);
    const manifest = await config.loadDevelopmentInstanceManifest(manifestPath);

    phase = "loopback API checks";
    const report = await runStaticRuntimeAcceptance({ manifest, artifact });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch {
    process.stderr.write(
      `${JSON.stringify({ result: "FAIL", stage: phase, code: "STAGE9_RUNTIME_ACCEPTANCE_FAILED" })}\n`,
    );
    process.exitCode = 1;
  }
};

const invokedPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
const modulePath = await realpath(fileURLToPath(import.meta.url));
if (invokedPath !== null && invokedPath === modulePath) await runCli();
