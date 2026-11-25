import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const lane = fileURLToPath(new URL("./stage10-full-cumulative-postgres.mjs", import.meta.url));
test("missing explicit target fails before setup", () => {
  const result = spawnSync(process.execPath, [lane], {
    env: { PATH: process.env.PATH },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  const error = JSON.parse(result.stderr.trim());
  assert.equal(error.stage, "inputs");
});
test("real Stage 10 payload executes inherited database subset", { timeout: 180000 }, () => {
  for (const name of [
    "TRAVELOS_STAGE10_EXTRACTED_ROOT",
    "TRAVELOS_STAGE10_PG_ROOT",
    "TRAVELOS_STAGE9_ACCEPTED_ARCHIVE",
  ])
    assert.ok(process.env[name], `required: ${name}`);
  const result = spawnSync(process.execPath, [lane], {
    env: process.env,
    encoding: "utf8",
    timeout: 170000,
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim());
  assert.equal(report.result, "SUBSET_PASS");
  assert.equal(report.additionalStage7to9ProbeCount, 8);
  assert.equal(report.postgresStopped, true);
  assert.ok(report.remaining.includes("full-stage6-9-authenticated-browser-journeys"));
});
