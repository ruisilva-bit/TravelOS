import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { assertDigest, regularBytes, safeAncestors, sha256, strictOptions } from "./io.mjs";

// Executes only the fixed, source-reviewed entrypoints with no manifest or
// credential environment. It exercises their import/bootstrap-failure path, not
// authentication, listeners, database access, dynamic branches or a sandbox.
export const probeBootstrapFailure = async (options) => {
  strictOptions(options, ["payload", "expectedNodeSha256"]);
  const { payload, expectedNodeSha256 } = options;
  assertDigest(expectedNodeSha256);
  const root = path.resolve(payload);
  await safeAncestors(root, true);
  const node = path.join(root, "runtime/node/bin/node");
  assert.equal(sha256(await regularBytes(node)), expectedNodeSha256, "Bootstrap Node pin mismatch");
  const services = [];
  for (const service of ["admin-api", "portal-api", "worker"]) {
    const directory = path.join(root, "apps", service);
    const entry = path.join(directory, "dist/main.js");
    await regularBytes(entry);
    const child = spawnSync(node, ["--no-addons", entry], {
      cwd: directory,
      env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", LANG: "C.UTF-8", TZ: "UTC" },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 30000,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
    });
    assert.equal(child.error, undefined, "Bootstrap child execution failed");
    assert.equal(child.signal, null, "Bootstrap child interrupted");
    assert.equal(child.status, 1, "Missing-manifest entry must fail closed");
    assert.equal(child.stdout, "", "Unexpected bootstrap stdout");
    const lines = child.stderr.trim().split("\n");
    assert.equal(lines.length, 1, "Unexpected bootstrap diagnostic stream");
    assert.deepEqual(
      JSON.parse(lines[0]),
      { event: "process_bootstrap_failed", service },
      "Expected source-owned bootstrap failure was not reached",
    );
    services.push({
      service,
      exitCode: child.status,
      stdoutBytes: Buffer.byteLength(child.stdout),
      stderrBytes: Buffer.byteLength(child.stderr),
      stderrSha256: sha256(Buffer.from(child.stderr)),
      result: "EXPECTED_MISSING_MANIFEST_FAILURE",
    });
  }
  return {
    scope: "CREDENTIAL_FREE_IMPORT_AND_FAIL_CLOSED_PREFLIGHT_NOT_RUNTIME_ACCEPTANCE",
    nodeSha256: expectedNodeSha256,
    services,
    runtimeQualification: "PENDING_CT200_AUTHENTICATED_ACCEPTANCE",
  };
};
