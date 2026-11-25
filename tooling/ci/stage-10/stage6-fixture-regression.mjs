// Fixed historical fixture coverage, not a Stage 10 operator/migration authority.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { corepackInvocation } from "./candidate.mjs";
import { PREDECESSOR } from "./constants.mjs";
import { _runBoundedProcess } from "./gate-process.mjs";
import { regularBytes, sha256 } from "./io.mjs";

const suites = Object.freeze({
  "stage6-baseline-tests": {
    test: "tooling/ci/test-stage-6-successor-baseline.mjs",
    sources: ["tooling/ci/stage-6-successor-baseline.mjs"],
    assertions: 9,
    negativeControls: 8,
  },
  "stage6-bootstrap": {
    test: "tooling/deployment/test-stage6-migrator-bootstrap.mjs",
    sources: [
      "tooling/deployment/run-stage6-migrations.mjs",
      "deploy/contracts/deployment-contract.v1.json",
    ],
    scenarios: 6,
    negativeFixtures: [
      "missing-helper-host",
      "mismatched-database-role",
      "missing-credential-file",
      "inline-password-rejected",
      "helper-environment-contract-drift",
    ],
  },
});
export function validateStage6FixtureReport(gate, report) {
  const suite = suites[gate];
  assert.ok(suite, "Unknown Stage 6 fixture gate");
  assert.equal(report.result, "PASS");
  if (gate === "stage6-baseline-tests") {
    assert.equal(report.assertions, suite.assertions);
    assert.equal(report.negativeControls, suite.negativeControls);
  } else {
    assert.equal(report.scenarios, suite.scenarios);
    assert.deepEqual(report.negativeFixtures, suite.negativeFixtures);
    assert.equal(report.credentialValuesEmitted, false);
  }
  return report;
}
export async function runStage6FixtureRegression({ root, gate, outputDirectory }) {
  const suite = suites[gate];
  assert.ok(suite, "Unknown Stage 6 fixture gate");
  for (const file of [suite.test, ...suite.sources]) {
    const accepted = execFileSync("git", ["show", `${PREDECESSOR.commit}:${file}`], {
      cwd: root,
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.deepEqual(
      await regularBytes(path.join(root, file)),
      accepted,
      "Historical Stage 6 fixture source changed",
    );
  }
  const invocation = corepackInvocation();
  const result = await _runBoundedProcess({
    label: gate,
    root,
    outputDirectory,
    command: invocation.command,
    args: [path.join(root, suite.test)],
    environment: {
      PATH: invocation.path,
      HOME: "/home/hermes",
      TMPDIR: process.env.TMPDIR,
      LANG: "C.UTF-8",
      CI: "true",
      COREPACK_ENABLE_NETWORK: "0",
    },
    timeout: 180000,
    outputLimit: 16 * 1024 * 1024,
  });
  assert.equal(result.status, "PASS", "Historical Stage 6 fixture execution failed");
  const stdout = await regularBytes(path.join(outputDirectory, `${gate}.stdout`));
  const report = validateStage6FixtureReport(gate, JSON.parse(stdout));
  return {
    result: "PASS",
    gate,
    report,
    stdoutSha256: sha256(stdout),
    scope: "UNCHANGED_HISTORICAL_FIXTURES_NOT_CURRENT_RUNTIME_OR_OPERATIONAL_AUTHORITY",
  };
}
