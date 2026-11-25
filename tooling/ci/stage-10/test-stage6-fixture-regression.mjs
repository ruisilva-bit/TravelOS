import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  runStage6FixtureRegression,
  validateStage6FixtureReport,
} from "./stage6-fixture-regression.mjs";
const root = fileURLToPath(new URL("../../..", import.meta.url));
test("fixture evidence rejects incomplete assertion counts and unknown gates", () => {
  const good = { result: "PASS", assertions: 9, negativeControls: 8 };
  assert.equal(validateStage6FixtureReport("stage6-baseline-tests", good), good);
  for (const changed of [
    { ...good, result: "FAIL" },
    { ...good, assertions: 8 },
    { ...good, negativeControls: 7 },
  ])
    assert.throws(() => validateStage6FixtureReport("stage6-baseline-tests", changed));
  assert.throws(() => validateStage6FixtureReport("unknown", good), /Unknown/u);
});
for (const gate of ["stage6-baseline-tests", "stage6-bootstrap"]) {
  test(`executes unchanged ${gate} fixtures with retained bounded output`, async () => {
    const directory = await mkdtemp(path.join(process.env.TMPDIR, "stage6-fixtures-"));
    try {
      const result = await runStage6FixtureRegression({ root, gate, outputDirectory: directory });
      assert.equal(result.result, "PASS");
      assert.equal(
        result.scope,
        "UNCHANGED_HISTORICAL_FIXTURES_NOT_CURRENT_RUNTIME_OR_OPERATIONAL_AUTHORITY",
      );
      assert.match(result.stdoutSha256, /^[a-f0-9]{64}$/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
