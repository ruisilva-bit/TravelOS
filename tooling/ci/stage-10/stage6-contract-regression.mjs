import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { corepackInvocation } from "./candidate.mjs";
import { PREDECESSOR } from "./constants.mjs";
import { deploymentContract, verifyDeploymentContract } from "./deployment-contract.mjs";
import { verifyInheritedBaseline } from "./predecessor-baseline-adapter.mjs";
import { qualifyExtractedArtifact } from "./qualify-artifact.mjs";
import { _runBoundedProcess } from "./gate-process.mjs";
import { regularBytes, sha256 } from "./io.mjs";

// Preserve historical verifier behavior on its own fixtures, and separately
// qualify the real Stage 10 layout. Neither operation authorizes host changes.
export async function runStage6ContractRegression({
  root,
  payload,
  archive,
  receipt,
  expectedReceiptSha256,
  inputs,
  expectedNodeSha256,
  outputDirectory,
}) {
  await qualifyExtractedArtifact({
    payload,
    archive,
    receipt,
    expectedReceiptSha256,
    inputs,
    expectedNodeSha256,
  });
  await verifyInheritedBaseline(root);
  const current = JSON.parse(
    await regularBytes(path.join(payload, "deployment/stage10-contract.json")),
  );
  verifyDeploymentContract(current);
  assert.deepEqual(current, deploymentContract());
  const historical = [
    "tooling/deployment/test-stage6-deployment-contract.mjs",
    "tooling/deployment/verify-stage6-deployment-contract.mjs",
  ];
  for (const file of historical) {
    const accepted = execFileSync("git", ["show", `${PREDECESSOR.commit}:${file}`], {
      cwd: root,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    assert.deepEqual(
      await regularBytes(path.join(root, file)),
      accepted,
      "Historical Stage 6 assertions changed",
    );
  }
  const invocation = corepackInvocation();
  const label = "stage6-contract-reference";
  const execution = await _runBoundedProcess({
    root,
    label,
    outputDirectory,
    command: invocation.command,
    args: [path.join(root, historical[0])],
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
  assert.equal(execution.status, "PASS", "Historical Stage 6 contract fixtures failed");
  const stdout = await regularBytes(path.join(outputDirectory, `${label}.stdout`));
  const report = JSON.parse(stdout.toString("utf8"));
  assert.equal(report.result, "PASS");
  assert.equal(report.assertions, 8);
  assert.deepEqual(report.negativeFixtures, [
    "gen06-root-layout",
    "mismatched-unit-path",
    "secret-file",
    "secret-content",
    "private-key-content",
    "credential-url",
  ]);
  return {
    result: "PASS",
    historicalAssertions: 8,
    historicalNegativeFixtures: report.negativeFixtures,
    historicalStdoutSha256: sha256(stdout),
    currentArtifactId: JSON.parse(await regularBytes(path.join(payload, "release.json")))
      .artifactId,
    scope:
      "UNCHANGED_STAGE6_FIXTURE_REGRESSION_PLUS_QUALIFIED_STAGE10_CONTRACT_NOT_OPERATIONAL_ACCEPTANCE",
  };
}
