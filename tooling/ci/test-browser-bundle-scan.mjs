import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "travelos-browser-bundle-scan-"));
const scannerPath = path.join(repositoryRoot, "tooling/ci/scan-browser-bundles.mjs");
const reviewedBundle = "apps/admin-web/dist/assets/index-DGPZ55aE.js";
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
  assert.equal(cleanReport.allowlistedFindingCount, 4);

  const bundlePath = path.join(temporaryRoot, reviewedBundle);
  const lines = (await readFile(bundlePath, "utf8")).split("\n");
  assert.ok(lines.length >= 72, "reviewed bundle must retain the reviewed line");
  lines[71] = `${lines[71]};${syntheticKey}="${syntheticValue}";`;
  await writeFile(bundlePath, lines.join("\n"), "utf8");

  const tamperedRun = runScanner();
  assert.equal(tamperedRun.status, 1, "modified bytes at a reviewed path must fail the scan");
  const tamperedReport = JSON.parse(tamperedRun.stdout);
  assert.equal(tamperedReport.result, "FAIL");
  assert.equal(tamperedReport.matchedValuesEmitted, false);
  assert.ok(
    tamperedReport.findings.some(
      (finding) =>
        finding.file === reviewedBundle && finding.rule === "reviewed-bundle-sha256-mismatch",
    ),
    "a changed bundle must invalidate its reviewed finding exceptions",
  );
  assert.ok(
    tamperedReport.findings.some(
      (finding) =>
        finding.file === reviewedBundle &&
        finding.rule === "secret-assignment" &&
        finding.line === 72,
    ),
    "a new secret assignment on a reviewed line must remain visible as a finding",
  );
  assert.ok(!tamperedRun.stdout.includes(syntheticValue));
  assert.ok(!tamperedRun.stderr.includes(syntheticValue));

  console.log(
    JSON.stringify({
      result: "PASS",
      cleanReviewedBundle: "PASS",
      mutatedReviewedBundleRejected: "PASS",
      matchedValuesEmitted: false,
      stage10Actions: 0,
    }),
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
