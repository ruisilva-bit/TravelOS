// Full-suite superset mapping, not review/authority or a PostgreSQL PASS.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PREDECESSOR } from "./constants.mjs";
import { regularBytes, sha256 } from "./io.mjs";

export const INHERITED_POSTGRES_GATES = Object.freeze([
  "stage6-postgres",
  "stage7-postgres",
  "stage8-postgres",
  "stage9-postgres-browser",
]);
export const isPostgresGate = (label) =>
  label === "stage10-postgres-browser" || INHERITED_POSTGRES_GATES.includes(label);
export const POSTGRES_SUITES = Object.freeze([
  "tests/integration/stage-6-publication-postgresql.test.ts",
  "tests/integration/stage-7-postgresql.test.ts",
  "tests/integration/stage-8-postgresql.test.ts",
  "tests/integration/stage-9-staff-invitations-postgresql.test.ts",
]);
const historicalHarness = [
  "tooling/testing/vitest.stage-9.config.ts",
  "tooling/ci/stage-9/postgres-regression-adapter.mjs",
  "tooling/ci/stage-8/regression-adapter.mjs",
];
// Accepted gen11 bytes exported on the build host. No git history is copied to CT200.
// Same-control transport hashes are not independent provenance or review.
export const ACCEPTED_POSTGRES_SHA256 = Object.freeze({
  "tests/integration/stage-6-publication-postgresql.test.ts": "10240d267038a43abfdb2e955d5d8c752523d1dbd8195b09acf8e5455f542418",
  "tests/integration/stage-7-postgresql.test.ts": "6a7e9d255366390d2319e668ce51d7d15cd8f71c6a8328d15db7a1488fb640a3",
  "tests/integration/stage-8-postgresql.test.ts": "b4d417025449f6257479853b5b24a6c9cbe27151884dcb1bf2ee1af9553e863c",
  "tests/integration/stage-9-staff-invitations-postgresql.test.ts": "383447abbec1bc8ebcf629567d3eec6eabc4b1160febb41b0f614c4e229407c8",
  "tooling/testing/vitest.stage-9.config.ts": "26ba710510617abe72b3afa2cbc9dce0779d5b17b3e979bd1518b4dd6baa5d79",
  "tooling/ci/stage-9/postgres-regression-adapter.mjs": "617fb950b973c467c0153f50050f75bab515096fa89f12714737cfa8b8b480c9",
  "tooling/ci/stage-8/regression-adapter.mjs": "66b98751ba80360382c7a5cc79b409e3f877ca6a0e966d52849a0c1044497f50",
});
const successorHarness = [
  "tooling/testing/vitest.stage-10.config.ts",
  "tooling/database/run-stage-10-postgres-disposable.mjs",
  "tooling/ci/stage-10/rehearse-acceptance.mjs",
  "tooling/ci/stage-10/rehearse-runtime-acceptance.mjs",
  "tooling/ci/stage-10/postgres-successor-coverage.mjs",
  "tooling/ci/stage-10/postgres-assertions.json",
];
const assertionKey = (row) => JSON.stringify([row.suite, row.title]);
const passedAssertions = (assertions) => assertions.map((row) => ({ ...row, status: "passed" }));

function validateAssertionResults(results, expected) {
  assert.ok(Array.isArray(results), "Missing PostgreSQL assertion results");
  assert.equal(results.length, 95, "Incomplete PostgreSQL assertion results");
  assert.deepEqual(
    results
      .map((row) => {
        assert.deepEqual(Object.keys(row).sort(), ["status", "suite", "title"]);
        return JSON.stringify([row.suite, row.title, row.status]);
      })
      .sort(),
    passedAssertions(expected.assertions)
      .map((row) => JSON.stringify([row.suite, row.title, row.status]))
      .sort(),
    "Missing, duplicate, renamed or non-passing PostgreSQL assertion results",
  );
  return results;
}

// Read the actual pinned Vitest JSON reporter output. Retain only the allowlisted
// case identity/status projection, never failure messages, stacks, metadata or paths.
export function summarizePostgresResults(report, coverage, root) {
  assert.equal(report.success, true, "PostgreSQL reporter did not succeed");
  for (const [key, value] of Object.entries({
    numTotalTests: 95,
    numPassedTests: 95,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTestSuites: 0,
  }))
    assert.equal(report[key], value, "Incomplete PostgreSQL reporter totals");
  assert.equal(report.testResults.length, 4, "Unexpected PostgreSQL suite count");
  const rows = report.testResults.flatMap((file) => {
    assert.equal(file.status, "passed");
    assert.equal(file.message, "");
    assert.ok(path.isAbsolute(file.name), "Absolute reporter suite path required");
    const suite = path.relative(root, file.name);
    assert.ok(POSTGRES_SUITES.includes(suite), "Unexpected PostgreSQL reporter suite");
    return file.assertionResults.map((result) => {
      assert.deepEqual(result.failureMessages, []);
      return { suite, title: result.title, status: result.status };
    });
  });
  return validateAssertionResults(rows, coverage);
}
export async function postgresCoverage(root, { acceptedBlobs } = {}) {
  const configuredBlobs = process.env.TRAVELOS_STAGE10_ACCEPTED_BLOBS;
  if (configuredBlobs !== undefined) {
    assert.ok(path.isAbsolute(configuredBlobs), "Invalid accepted blob path");
    assert.ok(acceptedBlobs === undefined || acceptedBlobs === configuredBlobs,
      "Conflicting accepted blob path");
    acceptedBlobs = configuredBlobs;
  }
  assert.deepEqual(Object.keys(ACCEPTED_POSTGRES_SHA256).sort(),
    [...POSTGRES_SUITES, ...historicalHarness].sort());
  const rows = [];
  for (const file of [...POSTGRES_SUITES, ...historicalHarness, ...successorHarness]) {
    const bytes = await regularBytes(path.join(root, file));
    const accepted = POSTGRES_SUITES.includes(file) || historicalHarness.includes(file);
    if (accepted) {
      assert.equal(sha256(bytes), ACCEPTED_POSTGRES_SHA256[file],
        "Historical PostgreSQL assertion/harness source changed");
      const reference = acceptedBlobs
        ? await regularBytes(path.join(acceptedBlobs, file))
        : execFileSync("git", ["show", `${PREDECESSOR.commit}:${file}`], {
          cwd: root,
          timeout: 30000,
          maxBuffer: 4 * 1024 * 1024,
        });
      assert.deepEqual(bytes, reference, "Historical PostgreSQL assertion/harness source changed");
    }
    rows.push({ path: file, sha256: sha256(bytes), acceptedPredecessorBytes: accepted });
  }
  const catalog = JSON.parse(
    await regularBytes(path.join(root, "tooling/ci/stage-10/postgres-assertions.json")),
  );
  assert.equal(catalog.schemaVersion, 1);
  const assertions = catalog.assertions;
  assert.equal(assertions.length, 95, "Incomplete PostgreSQL assertion catalog");
  assert.equal(new Set(assertions.map(assertionKey)).size, 95, "Duplicate PostgreSQL assertion");
  for (const [i, suite] of POSTGRES_SUITES.entries()) {
    const selected = assertions.filter((row) => row.suite === suite);
    assert.equal(selected.length, [3, 46, 34, 12][i], "Per-suite assertion count drift");
    for (const row of selected) {
      assert.deepEqual(Object.keys(row).sort(), ["suite", "title"]);
      assert.ok(typeof row.title === "string" && row.title.length > 0);
    }
  }
  const labelMappings = [...INHERITED_POSTGRES_GATES, "stage10-postgres-browser"].map((gate, i) => {
    const suites = POSTGRES_SUITES.slice(0, Math.min(i + 1, 4));
    return {
      gate,
      suites,
      requiredAssertions: assertions.filter((row) => suites.includes(row.suite)).length,
      executionPolicy: "REQUIRE_ALL_95_CURRENT_ARTIFACT_CASES_NO_PARTIAL_PASS",
    };
  });
  return {
    schemaVersion: 2,
    scope: "FULL_INHERITED_SUITE_SUPERSET_NOT_INDEPENDENT_REVIEW",
    assertions,
    labelMappings,
    gates: [...INHERITED_POSTGRES_GATES, "stage10-postgres-browser"],
    suiteFiles: [...POSTGRES_SUITES],
    expectedFiles: 4,
    expectedTests: 95,
    browserAcceptance: true,
    sources: rows,
  };
}
export function validatePostgresCoverage(actual, expected, log, results) {
  assert.deepEqual(actual, expected, "PostgreSQL assertion mapping/source drift");
  assert.equal(expected.expectedFiles, 4);
  assert.equal(expected.expectedTests, 95);
  assert.equal(expected.browserAcceptance, true);
  assert.deepEqual(expected.suiteFiles, POSTGRES_SUITES);
  assert.deepEqual(expected.gates, [...INHERITED_POSTGRES_GATES, "stage10-postgres-browser"]);
  // The existing 4-file/95-test/zero-skip summary is checked separately. Require
  // each verbose suite path too: a different four-file selection is not coverage.
  for (const suite of POSTGRES_SUITES)
    assert.ok(log.toString("utf8").includes(suite), "Missing inherited PostgreSQL suite output");
  validateAssertionResults(results, expected);
  return actual;
}
