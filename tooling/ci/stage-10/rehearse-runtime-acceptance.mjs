// Release packaging must copy this entrypoint beside stage8-runtime-acceptance.mjs.
// The caller must independently authenticate the Stage 10 payload before execution.
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAcceptance } from "./stage8-runtime-acceptance.mjs";

try {
  assert.ok(
    process.argv.length === 3 ||
      (process.argv.length === 4 && process.argv[3] === "--controlled-worker"),
  );
  assert.ok(process.argv[2].startsWith("--manifest="));
  const manifestPath = process.argv[2].slice("--manifest=".length);
  assert.ok(path.isAbsolute(manifestPath) && path.normalize(manifestPath) === manifestPath);
  const root = path.resolve(path.dirname(await realpath(fileURLToPath(import.meta.url))), "..");
  const release = JSON.parse(await readFile(path.join(root, "release.json"), "utf8"));
  assert.equal(release.stage, "PHASE_1_M1_STAGE_10");
  console.log(
    JSON.stringify(
      await runAcceptance(root, manifestPath, process.argv[3] === "--controlled-worker"),
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      error.receipt ?? { result: "FAIL", code: "STAGE10_ACCEPTANCE_PREFLIGHT_FAILED" },
    ),
  );
  process.exitCode = 1;
}
