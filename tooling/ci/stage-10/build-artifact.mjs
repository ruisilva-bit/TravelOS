import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { sealPayload } from "./artifact.mjs";
import { verifyInputs } from "./candidate.mjs";
import { STATE } from "./constants.mjs";
import {
  digest,
  exclusiveBytes,
  jsonBytes,
  parseCandidate,
  parseCli,
  privateDirectory,
  regularBytes,
  sha256,
  strictOptions,
} from "./io.mjs";
import { claimOnce, finishOnce } from "./one-shot.mjs";
import { bindingFor, materializeProvenance, runProductionRecipe } from "./production-recipe.mjs";
import { qualifyExtractedArtifact } from "./qualify-artifact.mjs";
import { assertPipelineReady } from "./run-canonical-ci.mjs";

export const buildPaths = (root, candidate) => {
  parseCandidate(candidate);
  const directory = path.join(path.resolve(root), STATE, "builds", candidate);
  return {
    directory,
    payload: path.join(directory, "payload"),
    archive: path.join(directory, "artifact.tar.gz"),
    extracted: path.join(directory, "extracted"),
    receipt: path.join(directory, "build.json"),
    qualification: path.join(directory, "package-checks.json"),
    logs: path.join(directory, "commands"),
    ledger: path.join(path.resolve(root), STATE, "build-ledger"),
  };
};
// Fixed recipe is implemented, but final pipeline review/preflight and runtime
// adapters remain mandatory. Keep the independent readiness brake BEFORE all
// output/ledger writes; do not make a candidate merely to test this module.
export const buildArtifact = async (options = {}) => {
  strictOptions(options, ["root", "candidate"]);
  parseCandidate(options.candidate);
  assertPipelineReady();
  const root = path.resolve(options.root);
  const predecessorArchive = path.join(root, ".hermes/state/stage9-gen11-artifact.tar.gz");
  const inputs = await verifyInputs({ root, candidate: options.candidate, predecessorArchive });
  const nodeSha256 = sha256(await regularBytes(process.execPath));
  assert.equal(inputs.runtimeNodeSha256, nodeSha256, "Frozen actual Node digest mismatch");
  const paths = buildPaths(root, options.candidate);
  try {
    await lstat(paths.directory);
    throw new Error("Build output exists; preserve previous attempt and never retry");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await privateDirectory(path.dirname(paths.directory));
  // mkdir in claimOnce is the consuming operation, before install or compile.
  // Labels never change this identity. No cleanup/resume/retry path exists.
  const claim = await claimOnce(paths.ledger, inputs.inputDigest, {
    operation: "PRODUCTION_BUILD_ONCE",
    candidate: options.candidate,
    binding: bindingFor(inputs),
    nodeSha256,
  });
  try {
    await mkdir(paths.directory, { mode: 0o700 });
    await mkdir(paths.payload, { mode: 0o700 });
    const commands = await runProductionRecipe({
      root,
      payload: paths.payload,
      inputs,
      logDirectory: paths.logs,
    });
    await verifyInputs({ root, candidate: options.candidate, predecessorArchive });
    const release = await materializeProvenance({
      root,
      payload: paths.payload,
      inputs,
      candidate: options.candidate,
    });
    const receipt = await sealPayload({
      payload: paths.payload,
      archive: paths.archive,
      binding: release.binding,
    });
    await exclusiveBytes(paths.receipt, jsonBytes(receipt));
    await mkdir(paths.extracted, { mode: 0o700 });
    // Archive was just constructed from our inventoried local tree, not an
    // untrusted upload. External archives must first use a safe extraction guard.
    const extraction = spawnSync(
      "tar",
      [
        "--extract",
        "--gzip",
        `--file=${paths.archive}`,
        "--directory",
        paths.extracted,
        "--no-same-owner",
        "--no-same-permissions",
      ],
      { encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
    );
    assert.equal(extraction.error, undefined, "Local exact archive extraction failed");
    assert.equal(extraction.status, 0, "Local exact archive extraction failed");
    const qualification = await qualifyExtractedArtifact({
      payload: paths.extracted,
      archive: paths.archive,
      receipt,
      expectedReceiptSha256: digest(receipt),
      inputs,
      expectedNodeSha256: nodeSha256,
    });
    await verifyInputs({ root, candidate: options.candidate, predecessorArchive });
    assert.equal(sha256(await regularBytes(process.execPath)), nodeSha256, "Build Node drift");
    await exclusiveBytes(
      paths.qualification,
      jsonBytes({
        ...qualification,
        receiptPinAuthority: "SAME_BUILD_SELF_CHECK_NOT_INDEPENDENT_RECEIPT_AUTHORITY",
        commandsSha256: digest(commands),
        compileCount: 1,
        compileOnCt200: false,
      }),
    );
    await finishOnce(paths.ledger, inputs.inputDigest, {
      result: "PASS",
      scope: "PRODUCTION_PACKAGE_CHECKS_ONLY_NOT_RELEASE_QUALIFIED",
      buildReceiptSha256: digest(receipt),
      packageChecksSha256: sha256(await regularBytes(paths.qualification)),
    });
    return { receipt, qualification, claimDirectory: claim.directory };
  } catch (error) {
    await finishOnce(paths.ledger, inputs.inputDigest, {
      result: "FAIL",
      code: "PRODUCTION_BUILD_FAILED_PRESERVE_ALL_PARTIAL_OUTPUT",
    });
    throw error;
  }
};
const direct =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (direct) {
  try {
    const result = await buildArtifact({
      root: path.resolve(fileURLToPath(new URL("../../..", import.meta.url))),
      ...parseCli(process.argv.slice(2)),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
