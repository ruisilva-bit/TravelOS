import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { parseArguments, validateExecution } from "./stage10-candidate-gate.mjs";
import { jsonBytes, sha256 } from "./io.mjs";

assert.deepEqual(parseArguments(["--candidate=gen12", "--gate=stage10-baseline"]), {
  candidate: "gen12",
  gate: "stage10-baseline",
});
for (const args of [
  [],
  ["--candidate=gen12", "--gate=evil"],
  ["--candidate=gen0", "--gate=stage10-baseline"],
  ["--gate=stage10-baseline", "--candidate=gen12"],
  ["--candidate=gen12", "--gate=stage10-baseline", "--extra"],
])
  assert.throws(() => parseArguments(args));
const log = Buffer.from(" Test Files  4 passed (4)\n      Tests  95 passed (95)\n");
const binding = {
  artifactId: "artifact",
  candidate: "gen12",
  inputDigest: "a",
  archiveSha256: "b",
  receiptSha256: "c",
  inputsSha256: "d",
  browserAcceptance: true,
};
const receipt = {
  schemaVersion: 1,
  stage: "PHASE_1_M1_STAGE_10",
  result: "PASS",
  postgresVersion: "18.6",
  serverVersionNumber: 180006,
  bindScope: "127.0.0.1 only",
  dataChecksums: true,
  globalPackageInstallation: false,
  stage11Actions: 0,
  testExitCode: 0,
  testLogSha256: sha256(log),
  artifactBinding: binding,
  cleanup: { clusterStartAttempted: true, clusterStopped: true, disposableRootsAbsent: true },
  failure: null,
};
validateExecution(jsonBytes(receipt), log, binding);
assert.throws(() => validateExecution(Buffer.from(JSON.stringify(receipt)), log, binding));
assert.throws(() =>
  validateExecution(jsonBytes({ ...receipt, stage: "PHASE_1_M1_STAGE_9" }), log, binding),
);
assert.throws(() => validateExecution(jsonBytes(receipt), log, { ...binding, candidate: "gen13" }));
assert.throws(() =>
  validateExecution(
    jsonBytes({ ...receipt, cleanup: { ...receipt.cleanup, clusterStopped: false } }),
    log,
    binding,
  ),
);
const skip = Buffer.from(" Test Files  4 passed (4)\n      Tests  95 passed (95) | 1 skipped\n");
assert.throws(() =>
  validateExecution(jsonBytes({ ...receipt, testLogSha256: sha256(skip) }), skip, binding),
);
const script = fileURLToPath(new URL("./stage10-candidate-gate.mjs", import.meta.url));
for (const args of [
  ["--candidate=gen99999", "--gate=stage10-postgres-browser"],
  ["--candidate=gen12", "--gate=invalid"],
]) {
  const child = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(child.status, 1, child.stderr);
  assert.equal(child.stdout, "");
}
console.log("stage10 candidate gate tests PASS");
