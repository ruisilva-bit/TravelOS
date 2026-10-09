import assert from "node:assert/strict";

import {
  assertExactArtifactPathSet,
  compareArtifactPathSets,
} from "./stage-5-artifact-path-set.mjs";

const expected = ["a.json", "b.json"];
assert.equal(
  assertExactArtifactPathSet(expected, ["b.json", "a.json"], "valid predecessor").result,
  "PASS",
);
const missing = compareArtifactPathSets(expected, ["a.json"]);
assert.deepEqual(missing.missing, ["b.json"]);
assert.deepEqual(missing.unexpected, []);
assert.equal(missing.result, "FAIL");
const unexpected = compareArtifactPathSets(expected, ["a.json", "b.json", "extra.json"]);
assert.deepEqual(unexpected.missing, []);
assert.deepEqual(unexpected.unexpected, ["extra.json"]);
assert.equal(unexpected.result, "FAIL");
const duplicate = compareArtifactPathSets(expected, ["a.json", "a.json", "b.json"]);
assert.deepEqual(duplicate.duplicates, [{ path: "a.json", count: 2 }]);
assert.equal(duplicate.result, "FAIL");
const duplicateExpected = compareArtifactPathSets(["a.json", "a.json"], ["a.json", "a.json"]);
assert.deepEqual(duplicateExpected.expectedDuplicates, [{ path: "a.json", count: 2 }]);
assert.equal(duplicateExpected.result, "FAIL");
assert.throws(
  () => assertExactArtifactPathSet(expected, ["a.json", "extra.json"], "predecessor"),
  /predecessor path-set mismatch.*extra[.]json/u,
);
process.stdout.write(
  "Stage 5 predecessor path-set tests PASS (exact, missing, unexpected, duplicates).\n",
);
