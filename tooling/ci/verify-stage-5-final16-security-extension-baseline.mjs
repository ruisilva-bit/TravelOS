import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL14_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL15_FAILED_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL16_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5SecurityExtensionBaseline } from "./verify-stage-5-security-extension-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const verifyStage5Final15SecurityExtensionBaseline = async ({
  root: candidateRoot = root,
} = {}) => {
  const evidenceDirectory = path.join(candidateRoot, STAGE5_FINAL16_EVIDENCE_DIRECTORY);
  const receiptBytes = await readFile(path.join(evidenceDirectory, "baseline-generation.json"));
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  assert.equal(receipt.candidate, "FINAL-16");
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.previousBaselineSha256, STAGE5_FINAL15_FAILED_SECURITY_BASELINE_SHA256);
  assert.deepEqual(receipt.permittedDeltaPaths, [
    "docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md",
    "package.json",
  ]);
  assert.equal(receipt.stage6Actions, 0);
  const baseline = await verifyStage5SecurityExtensionBaseline({
    root: candidateRoot,
    expectedBaselineSha256: receipt.baselineSha256,
    requireCandidate: "FINAL-16",
  });
  assert.equal(baseline.result, "PASS");
  assert.equal(baseline.phase1.baselineSha256, receipt.baselineSha256);
  const baselineFileBytes = await readFile(
    path.join(candidateRoot, "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json"),
  );
  assert.equal(hash(baselineFileBytes), receipt.baselineSha256);
  const manifest = JSON.parse(baselineFileBytes.toString("utf8"));
  assert.equal(
    manifest.lineage.final16Generation.packageJsonSha256,
    hash(await readFile(path.join(candidateRoot, "package.json"))),
  );
  assert.equal(
    manifest.lineage.final16Generation.runnerSha256,
    hash(
      await readFile(
        path.join(candidateRoot, "tooling/ci/run-stage-5-final16-authoritative-ci.mjs"),
      ),
    ),
  );
  const predecessorBytes = await readFile(
    path.join(evidenceDirectory, "final14-security-extension-baseline.json"),
  );
  assert.equal(hash(predecessorBytes), STAGE5_FINAL14_SECURITY_BASELINE_SHA256);
  return {
    result: "PASS",
    candidate: "FINAL-16",
    baselineSha256: receipt.baselineSha256,
    previousBaselineSha256: hash(predecessorBytes),
    packageJsonSha256: manifest.lineage.final16Generation.packageJsonSha256,
    runnerSha256: manifest.lineage.final16Generation.runnerSha256,
    protectedPathCount: manifest.protectedFiles.length,
    permittedDeltaPaths: receipt.permittedDeltaPaths,
    stage6Actions: 0,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${JSON.stringify(await verifyStage5Final15SecurityExtensionBaseline(), null, 2)}\n`,
  );
}
