import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { PENDING_INTEGRATIONS } from "./constants.mjs";
import { GATES, hasCandidateAdapter, validateGateCoverage } from "./gates.mjs";
import { digest, parseCandidate, parseCli, regularBytes, sha256, strictOptions } from "./io.mjs";
import { verifyInputs } from "./candidate.mjs";
import { verifyArtifactBinding } from "./artifact.mjs";
import { bindingFor } from "./production-recipe.mjs";
import { inspectClaim } from "./one-shot.mjs";
import { runGate } from "./gate-process.mjs";
import { executeSequence } from "./canonical-sequence.mjs";

export const assertPipelineReady = () => {
  validateGateCoverage(GATES);
  const incompleteGates = GATES.filter((gate) => gate.status !== "IMPLEMENTED_AND_REVIEWED");
  assert.ok(
    PENDING_INTEGRATIONS.length === 0 && incompleteGates.length === 0,
    `Stage 10 canonical CI pending/unimplemented; no claim consumed:\n${PENDING_INTEGRATIONS.join("\n")}\nUnqualified gate definitions: ${incompleteGates.length}`,
  );
};
export const runCanonicalCi = async (options = {}) => {
  strictOptions(options, ["root", "candidate"]);
  parseCandidate(options.candidate);
  assertPipelineReady();
  const root = path.resolve(options.root);
  const manifest = JSON.parse(await regularBytes(path.join(root, "package.json")));
  for (const gate of GATES) {
    if (hasCandidateAdapter(gate.label)) continue;
    assert.ok(gate.script, `Missing dedicated adapter for ${gate.label}; no claim consumed`);
    assert.ok(
      typeof manifest.scripts?.[gate.script] === "string" && manifest.scripts[gate.script].trim(),
      `Missing gate script for ${gate.label}; no claim consumed`,
    );
  }
  const { buildPaths } = await import("./build-artifact.mjs");
  const paths = buildPaths(root, options.candidate);
  const predecessorArchive = path.join(root, ".hermes/state/stage9-gen11-artifact.tar.gz");
  const readInputs = () => verifyInputs({ root, candidate: options.candidate, predecessorArchive });
  const inputs = await readInputs();
  const receipt = JSON.parse(await regularBytes(paths.receipt));
  const checksBytes = await regularBytes(paths.qualification);
  const checks = JSON.parse(checksBytes);
  const build = await inspectClaim(paths.ledger, inputs.inputDigest);
  assert.equal(build.state, "PASSED_CONSUMED", "Build claim not passed");
  assert.equal(build.outcome.receipt.buildReceiptSha256, digest(receipt));
  assert.equal(build.outcome.receipt.packageChecksSha256, sha256(checksBytes));
  assert.equal(checks.result, "PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED");
  assert.equal(sha256(await regularBytes(process.execPath)), inputs.runtimeNodeSha256);
  const verify = async () => {
    assert.deepEqual(await readInputs(), inputs, "CI input drift");
    assert.equal(
      sha256(await regularBytes(process.execPath)),
      inputs.runtimeNodeSha256,
      "Node drift",
    );
    await verifyArtifactBinding({
      payload: paths.extracted,
      archive: paths.archive,
      receipt,
      expectedReceiptSha256: build.outcome.receipt.buildReceiptSha256,
      binding: bindingFor(inputs),
    });
  };
  await verify();
  return executeSequence({
    root,
    ledger: path.join(root, ".hermes/state/stage10/ci-ledger"),
    inputDigest: inputs.inputDigest,
    candidate: options.candidate,
    gates: GATES,
    run: runGate,
    verify,
  });
};
const direct =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (direct) {
  try {
    await runCanonicalCi({
      root: path.resolve(fileURLToPath(new URL("../../..", import.meta.url))),
      ...parseCli(process.argv.slice(2)),
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
