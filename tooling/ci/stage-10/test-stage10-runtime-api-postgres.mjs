import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";

const script = path.join(import.meta.dirname, "stage10-runtime-api-postgres.mjs");
const result = spawnSync(process.execPath, [script], {
  encoding: "utf8",
  timeout: 180000,
  env: process.env,
});
assert.equal(result.status, 0, `API/PG rehearsal failed: ${result.stderr}`);
const report = JSON.parse(result.stdout);
assert.equal(report.result, "PASS");
assert.equal(report.postgresVersion, "18.6");
assert.equal(report.migrations, "PASS");
assert.deepEqual(report.services, ["admin-api", "portal-api"]);
assert.equal(report.realmRouting, "PASS");
assert.equal(report.authenticatedSessions, "PASS");
assert.equal(report.crossRealmCookies, "PASS");
assert.deepEqual(report.browserAuthenticatedViewports, ["desktop", "mobile"]);
assert.equal(report.cleanup, "PASS");
console.log("stage10 runtime API/PostgreSQL rehearsal: PASS");

// A failed child spawn must return a sanitized error and finish cleanup rather than hang.
const failure = spawnSync(process.execPath, [script], {
  encoding: "utf8",
  timeout: 180000,
  env: { ...process.env, TRAVELOS_STAGE10_TEST_SPAWN_FAILURE: "1" },
});
assert.equal(failure.status, 1, "spawn failure did not fail cleanly");
assert.match(failure.stderr, /service startup admin spawnError=true/);
assert.doesNotMatch(failure.stderr, /example\.test|session=|password|missing-node/);
console.log("stage10 runtime API spawn failure cleanup: PASS");

// Simulate a failed cleanup result after a real PostgreSQL stop, in an isolated scratch root.
const scratch = mkdtempSync(path.join(os.tmpdir(), "stage10-cleanup-test-"));
let stopped = false;
try {
  const cleanupFailure = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    timeout: 180000,
    env: {
      ...process.env,
      TMPDIR: scratch,
      TRAVELOS_STAGE10_TEST_SPAWN_FAILURE: "1",
      TRAVELOS_STAGE10_TEST_CLEANUP_FAILURE: "1",
    },
  });
  assert.equal(cleanupFailure.status, 1);
  assert.match(cleanupFailure.stderr, /PG_CLEANUP_SIMULATED/);
  stopped = true;
  assert.equal(
    readdirSync(scratch).filter((name) => name.startsWith("stage10-api-pg-")).length,
    1,
    "failed cleanup must retain work for inspection",
  );
} finally {
  if (stopped) rmSync(scratch, { recursive: true, force: true });
}
console.log("stage10 runtime simulated cleanup failure: PASS");
