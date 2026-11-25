import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
const lane = fileURLToPath(new URL("./stage10-runtime-cumulative-postgres.mjs", import.meta.url));
test("fails closed without explicitly selected inputs", () => {
  const result = spawnSync(process.execPath, [lane], {
    env: { PATH: process.env.PATH },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CUMULATIVE_POSTGRES_FAILED/);
});
test(
  "real disposable artifact and accepted predecessor subset",
  { skip: !process.env.TRAVELOS_STAGE10_CUMULATIVE_INTEGRATION, timeout: 180000 },
  () => {
    const result = spawnSync(process.execPath, [lane], {
      env: process.env,
      encoding: "utf8",
      timeout: 170000,
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.result, "SUBSET_PASS");
    assert.ok(report.covered.includes("accepted-predecessor-to-stage10-noop"));
    assert.ok(report.covered.includes("constraint-enforcement"));
    assert.ok(report.covered.includes("role-denial"));
    assert.ok(report.remaining.length > 0);
    assert.equal(report.postgresStopped, true);
  },
);
