import assert from "node:assert/strict";
import { stopRehearsalChild } from "./rehearsal-cleanup.mjs";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import { qualifyExtractedArtifact } from "./qualify-artifact.mjs";
import { sha256 } from "./io.mjs";
import { PREDECESSOR } from "./constants.mjs";
// Stage 10 owns this harness; the embedded Stage 8 acceptance assertions remain unchanged.
// Pins must be supplied by an independent authority, never derived from the payload.
const verifierArguments = ({
  archive,
  receipt,
  receiptSha256,
  inputs,
  inputsSha256,
  nodeSha256,
  predecessorArchive,
}) => {
  const paths = { archive, receipt, inputs, "predecessor-archive": predecessorArchive };
  const pins = {
    "receipt-sha256": receiptSha256,
    "inputs-sha256": inputsSha256,
    "node-sha256": nodeSha256,
  };
  for (const value of Object.values(paths))
    assert.ok(
      typeof value === "string" && path.isAbsolute(value),
      "Absolute verifier input required",
    );
  for (const value of Object.values(pins))
    assert.match(value ?? "", /^[a-f0-9]{64}$/u, "Independent verifier digest required");
  return Object.entries({ ...paths, ...pins }).map(([key, value]) => `--${key}=${value}`);
};
const verifyArtifact = (artifactRoot, args) => {
  const result = spawnSync(
    path.join(artifactRoot, "runtime/node/bin/node"),
    [path.join(artifactRoot, "deployment/verify-artifact.mjs"), ...args],
    { cwd: artifactRoot, encoding: "utf8", timeout: 300_000, maxBuffer: 8 * 1024 * 1024 },
  );
  assert.equal(result.error, undefined, "Stage 10 verifier execution failed");
  assert.equal(result.status, 0, "Stage 10 packaged verifier rejected candidate");
  const report = JSON.parse(result.stdout);
  assert.equal(report.result, "PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED");
  return report;
};

const portNumber = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const healthStatus = (port, host) =>
  new Promise((resolve, reject) => {
    const request = http.get(
      { hostname: "127.0.0.1", port, path: "/health/live", headers: { host }, timeout: 2000 },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on("timeout", () => request.destroy(new Error("HEALTH_TIMEOUT")));
    request.on("error", reject);
  });
export const rehearseAcceptance = async ({
  artifactRoot,
  verification,
  databaseName,
  port,
  staffEmail,
  staffPassword,
  staffTotpSeed,
  staffRealmKey,
  workRoot,
}) => {
  const verifierArgs = verifierArguments(verification ?? {});
  const root = await mkdtemp(path.join(workRoot, "stage10-authenticated-"));
  const children = [];
  let cleanupVerified;
  let phase = "inventory";
  try {
    const [receiptBytes, inputsBytes, predecessorBytes] = await Promise.all([
      readFile(verification.receipt),
      readFile(verification.inputs),
      readFile(verification.predecessorArchive),
    ]);
    assert.equal(sha256(receiptBytes), verification.receiptSha256);
    assert.equal(sha256(inputsBytes), verification.inputsSha256);
    assert.equal(sha256(predecessorBytes), PREDECESSOR.archiveSha256);
    await qualifyExtractedArtifact({
      payload: artifactRoot,
      archive: verification.archive,
      receipt: JSON.parse(receiptBytes),
      expectedReceiptSha256: verification.receiptSha256,
      inputs: JSON.parse(inputsBytes),
      expectedNodeSha256: verification.nodeSha256,
    });
    verifyArtifact(artifactRoot, verifierArgs);
    await symlink(artifactRoot, path.join(root, "current"));
    const current = path.join(root, "current");
    const node = path.join(current, "runtime/node/bin/node");
    const manifest = JSON.parse(
      await readFile(path.join(current, "instance-manifest/development.example.json"), "utf8"),
    );
    manifest.database.name = databaseName;
    manifest.database.port = port;
    manifest.runtime.listeners.adminApi.port = await portNumber();
    do {
      manifest.runtime.listeners.portalApi.port = await portNumber();
    } while (
      manifest.runtime.listeners.portalApi.port === manifest.runtime.listeners.adminApi.port
    );
    const manifestPath = path.join(root, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
    const portalKey = `${randomUUID()}${randomUUID()}`;
    const credentialSets = {
      admin: { "admin-api-db": randomUUID(), "staff-auth-realm": staffRealmKey },
      portal: { "portal-api-db": randomUUID(), "portal-auth-realm": portalKey },
      worker: { "worker-db": randomUUID() },
      operator: {
        "portal-api-db": randomUUID(),
        "portal-auth-realm": portalKey,
        "worker-db": randomUUID(),
        "stage7-staff-email": staffEmail,
        "stage7-staff-password": staffPassword,
        "stage7-staff-totp": staffTotpSeed,
      },
      missing: {},
      invalid: {
        "portal-api-db": randomUUID(),
        "portal-auth-realm": portalKey,
        "worker-db": randomUUID(),
        "stage7-staff-email": staffEmail,
        "stage7-staff-password": staffPassword,
        "stage7-staff-totp": "123456",
      },
    };
    for (const [name, values] of Object.entries(credentialSets)) {
      await mkdir(path.join(root, name), { mode: 0o700 });
      for (const [key, value] of Object.entries(values))
        await writeFile(path.join(root, name, key), value, { mode: 0o600 });
    }
    await mkdir(path.join(root, "worker-runtime"), { mode: 0o700 });
    const environment = (name) => ({
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      CREDENTIALS_DIRECTORY: path.join(root, name),
      RUNTIME_DIRECTORY: path.join(root, "worker-runtime"),
    });
    phase = "preflight";
    // Replay through the active-release symlink, matching service path semantics.
    verifyArtifact(current, verifierArgs);
    for (const [service, credential] of [
      ["admin-api", "admin"],
      ["portal-api", "portal"],
      ["worker", "worker"],
    ]) {
      const child = spawn(
        node,
        [path.join(current, `apps/${service}/dist/main.js`), "--manifest", manifestPath],
        {
          cwd: path.join(current, `apps/${service}`),
          env: environment(credential),
          stdio: "ignore",
        },
      );
      children.push(child);
    }
    phase = "service-readiness";
    let ready = false;
    let diagnostic = {};
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      try {
        const health = JSON.parse(
          await readFile(path.join(root, "worker-runtime/health.json"), "utf8"),
        );
        const admin = await healthStatus(
          manifest.runtime.listeners.adminApi.port,
          manifest.hosts.admin,
        );
        const portal = await healthStatus(
          manifest.runtime.listeners.portalApi.port,
          manifest.hosts.portal,
        );
        ready = health.ready && admin === 200 && portal === 200;
        diagnostic = { worker: { live: health.live, ready: health.ready }, admin, portal };
      } catch {
        /* bounded readiness polling */
      }
      if (!ready) await delay(100);
    }
    assert.equal(
      ready,
      true,
      JSON.stringify({ ...diagnostic, exits: children.map((child) => child.exitCode) }),
    );
    const execute = (credential, controlled = false) =>
      spawnSync(
        node,
        [
          path.join(current, "operator/stage10-runtime-acceptance.mjs"),
          `--manifest=${manifestPath}`,
          ...(controlled ? ["--controlled-worker"] : []),
        ],
        {
          cwd: current,
          env: environment(credential),
          encoding: "utf8",
          timeout: 180_000,
          maxBuffer: 2_097_152,
        },
      );
    phase = "missing-credentials";
    const missing = execute("missing");
    assert.equal(missing.status, 1);
    const missingReport = JSON.parse(missing.stderr);
    assert.notEqual(
      missingReport.code,
      "STAGE8_ACCEPTANCE_PREFLIGHT_FAILED",
      "Packaged Stage 8 operator rejects Stage 10 release identity; a Stage 10 operator entrypoint is required",
    );
    assert.equal(missingReport.phase, "credentials");
    phase = "invalid-credentials";
    const invalid = execute("invalid");
    assert.equal(invalid.status, 1);
    assert.equal(JSON.parse(invalid.stderr).phase, "credentials");
    phase = "authenticated-acceptance";
    const accepted = execute("operator");
    const report = JSON.parse(accepted.status === 0 ? accepted.stdout : accepted.stderr);
    assert.equal(accepted.status, 0, JSON.stringify(report));
    assert.equal(report.result, "PASS");
    assert.equal(report.stage9Actions, 0);
    assert.ok(report.regressionProbes.includes("publication-v2-visible-v1-immutable"));
    const safe = JSON.stringify(report);
    for (const secret of [staffEmail, staffPassword, staffTotpSeed, staffRealmKey, portalKey])
      assert.ok(!safe.includes(secret));
    verifyArtifact(artifactRoot, verifierArgs);
    console.log(`STAGE10_PACKAGED_REHEARSAL ${safe}`);
    phase = "controlled-failures";
    const workerChild = children[2];
    await new Promise((resolve) => {
      workerChild.once("exit", resolve);
      workerChild.kill("SIGTERM");
    });
    const controlled = execute("operator", true);
    const controlledReport = JSON.parse(
      controlled.status === 0 ? controlled.stdout : controlled.stderr,
    );
    assert.equal(controlled.status, 0, JSON.stringify(controlledReport));
    assert.equal(controlledReport.result, "PASS");
    assert.ok(
      controlledReport.probes.includes("killed-claim-recovered-by-restarted-artifact-worker"),
    );
    console.log(`STAGE10_CONTROLLED_REHEARSAL ${JSON.stringify(controlledReport)}`);
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- Raw auth/credential causes must not enter test evidence.
    throw new Error(
      `Stage 10 packaged rehearsal failed (${phase}): ${error.code === "ERR_ASSERTION" ? error.message : "SAFE_REHEARSAL_FAILURE"}`,
    );
  } finally {
    const stopped = await Promise.all(children.map((child) => stopRehearsalChild(child)));
    cleanupVerified = stopped.every((ok) => ok);
    if (cleanupVerified) await rm(root, { recursive: true, force: true });
  }
  if (!cleanupVerified) throw new Error("STAGE10_REHEARSAL_CLEANUP_UNVERIFIED");
};
