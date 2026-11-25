import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const fixture = async (t, mode = "expected") => {
  const root = await mkdtemp(path.join(process.env.TMPDIR, "stage10-bootstrap-preflight-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "runtime/node/bin"), { recursive: true });
  await copyFile(process.execPath, path.join(root, "runtime/node/bin/node"));
  for (const service of ["admin-api", "portal-api", "worker"]) {
    const directory = path.join(root, "apps", service, "dist");
    await mkdir(directory, { recursive: true });
    const code =
      mode === "missing-import"
        ? 'require("./missing-production-dependency");'
        : `console.error(JSON.stringify({event:"process_bootstrap_failed",service:${JSON.stringify(service)}})); ${mode === "unexpected-output" ? 'console.log("unexpected");' : ""} process.exitCode=1;`;
    await writeFile(path.join(directory, "main.js"), code);
  }
  return {
    payload: root,
    expectedNodeSha256: createHash("sha256")
      .update(await readFile(process.execPath))
      .digest("hex"),
  };
};

test("bootstrap failure preflight is implemented", async () => {
  const module = await import("./bootstrap-preflight.mjs").catch(() => null);
  assert.equal(typeof module?.probeBootstrapFailure, "function", "Missing bootstrap preflight");
});

test("credential-free entry preflight accepts only the exact expected missing-manifest failure", async (t) => {
  const { probeBootstrapFailure } = await import("./bootstrap-preflight.mjs");
  const result = await probeBootstrapFailure(await fixture(t));
  assert.equal(
    result.scope,
    "CREDENTIAL_FREE_IMPORT_AND_FAIL_CLOSED_PREFLIGHT_NOT_RUNTIME_ACCEPTANCE",
  );
  assert.deepEqual(
    result.services.map((row) => row.service),
    ["admin-api", "portal-api", "worker"],
  );
  assert.equal(result.runtimeQualification, "PENDING_CT200_AUTHENTICATED_ACCEPTANCE");
});

test("missing production imports and unexpected output cannot masquerade as expected failure", async (t) => {
  const { probeBootstrapFailure } = await import("./bootstrap-preflight.mjs");
  for (const mode of ["missing-import", "unexpected-output"])
    await assert.rejects(probeBootstrapFailure(await fixture(t, mode)));
});

test("wrong Node pin and missing entrypoints fail before a successful preflight receipt", async (t) => {
  const { probeBootstrapFailure } = await import("./bootstrap-preflight.mjs");
  const input = await fixture(t);
  await assert.rejects(probeBootstrapFailure({ ...input, expectedNodeSha256: "0".repeat(64) }));
  await rm(path.join(input.payload, "apps/admin-api/dist/main.js"));
  await assert.rejects(probeBootstrapFailure(input));
});
