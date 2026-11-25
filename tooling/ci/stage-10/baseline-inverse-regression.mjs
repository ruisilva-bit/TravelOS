import assert from "node:assert/strict";
import path from "node:path";
import { corepackInvocation } from "./candidate.mjs";
import { _runBoundedProcess } from "./gate-process.mjs";
import { regularBytes, sha256 } from "./io.mjs";

// Fixed test selection and clean environment; no caller command/SQL overrides.
export async function runBaselineInverseRegression({ root, outputDirectory }) {
  const invocation = corepackInvocation();
  const label = "successor-baseline-inverses";
  const result = await _runBoundedProcess({
    root,
    label,
    outputDirectory,
    command: invocation.command,
    args: [
      "--test",
      "--test-reporter=tap",
      ...[
        "test-predecessor-baseline-inverse.mjs",
        "test-successor-baseline.mjs",
        "test-source-scope.mjs",
      ].map((name) => path.join(root, "tooling/ci/stage-10", name)),
    ],
    environment: {
      PATH: invocation.path,
      HOME: "/home/hermes",
      TMPDIR: process.env.TMPDIR,
      LANG: "C.UTF-8",
      CI: "true",
      COREPACK_ENABLE_NETWORK: "0",
    },
    timeout: 10 * 60 * 1000,
    outputLimit: 16 * 1024 * 1024,
  });
  assert.equal(result.status, "PASS", "Successor baseline inverse regression failed");
  const stdout = await regularBytes(path.join(outputDirectory, `${label}.stdout`));
  for (const marker of [
    /^# tests 10$/mu,
    /^# pass 10$/mu,
    /^# fail 0$/mu,
    /^# cancelled 0$/mu,
    /^# skipped 0$/mu,
    /^# todo 0$/mu,
  ])
    assert.match(stdout.toString("utf8"), marker);
  return {
    result: "PASS",
    tests: 10,
    skipped: 0,
    stdoutSha256: sha256(stdout),
    scope: "EXECUTED_BASELINE_LINEAGE_SCOPE_AND_REAL_ISOLATED_REPOSITORY_INVERSES_NOT_CANONICAL_CI",
  };
}
