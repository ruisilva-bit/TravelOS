import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "travelos-browser-bundle-scan-"));
const scannerPath = path.join(repositoryRoot, "tooling/ci/scan-browser-bundles.mjs");
const syntheticKey = ["api", "Token"].join("");
const syntheticValue = "A".repeat(24);

const runScanner = () =>
  spawnSync(process.execPath, [scannerPath], {
    cwd: temporaryRoot,
    encoding: "utf8",
    timeout: 60_000,
  });

try {
  for (const app of ["admin-web", "portal-web"]) {
    await cp(
      path.join(repositoryRoot, "apps", app, "dist"),
      path.join(temporaryRoot, "apps", app, "dist"),
      { recursive: true },
    );
  }

  const cleanRun = runScanner();
  assert.equal(cleanRun.status, 0, cleanRun.stderr);
  const cleanReport = JSON.parse(cleanRun.stdout);
  assert.equal(cleanReport.result, "PASS");
  assert.equal(cleanReport.allowlistedFindingCount, 0);

  // Inject a synthetic secret assignment into the current-tree Admin bundle: it must fail.
  const assets = path.join(temporaryRoot, "apps/admin-web/dist/assets");
  const bundleName = (await readdir(assets)).find((name) => name.endsWith(".js"));
  assert.ok(bundleName, "admin-web build must emit a JavaScript bundle");
  const bundle = `apps/admin-web/dist/assets/${bundleName}`;
  const bundlePath = path.join(temporaryRoot, bundle);
  const original = await readFile(bundlePath, "utf8");
  await writeFile(bundlePath, `${original}\n${syntheticKey}="${syntheticValue}";\n`, "utf8");

  const tamperedRun = runScanner();
  assert.equal(tamperedRun.status, 1, "a secret assignment in a bundle must fail the scan");
  const tamperedReport = JSON.parse(tamperedRun.stdout);
  assert.equal(tamperedReport.result, "FAIL");
  assert.equal(tamperedReport.matchedValuesEmitted, false);
  assert.ok(
    tamperedReport.findings.some(
      (finding) => finding.file === bundle && finding.rule === "secret-assignment",
    ),
    "the injected secret assignment must be reported",
  );
  assert.ok(!tamperedRun.stdout.includes(syntheticValue));
  assert.ok(!tamperedRun.stderr.includes(syntheticValue));

  console.log(
    JSON.stringify({
      result: "PASS",
      cleanCurrentBundles: "PASS",
      injectedSecretRejected: "PASS",
      matchedValuesEmitted: false,
      stage10Actions: 0,
    }),
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
