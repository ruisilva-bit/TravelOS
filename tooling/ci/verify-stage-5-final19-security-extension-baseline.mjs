import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_FINAL18_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL19_CORRECTION_MATRIX,
  STAGE5_FINAL19_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5SecurityExtensionBaseline } from "./verify-stage-5-security-extension-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const permittedDeltaPaths = [
  "docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md",
  "package.json",
];

export const verifyStage5Final19SecurityExtensionBaseline = async ({
  candidateRoot = root,
} = {}) => {
  const evidenceDirectory = path.join(candidateRoot, STAGE5_FINAL19_EVIDENCE_DIRECTORY);
  const receiptBytes = await readFile(path.join(evidenceDirectory, "baseline-generation.json"));
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  assert.equal(receipt.candidate, "FINAL-19");
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.previousBaselineSha256, STAGE5_FINAL18_SECURITY_BASELINE_SHA256);
  assert.deepEqual(receipt.permittedDeltaPaths, permittedDeltaPaths);
  assert.equal(receipt.protectedPathCount, 12);
  assert.equal(receipt.lineageFindingCount, 49);
  assert.equal(receipt.stage6Actions, 0);

  const baseline = await verifyStage5SecurityExtensionBaseline({
    root: candidateRoot,
    expectedBaselineSha256: receipt.baselineSha256,
    requireCandidate: "FINAL-19",
  });
  assert.equal(baseline.result, "PASS");
  assert.equal(baseline.phase1.baselineSha256, receipt.baselineSha256);

  const baselineBytes = await readFile(
    path.join(candidateRoot, "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json"),
  );
  assert.equal(hash(baselineBytes), receipt.baselineSha256);
  const manifest = JSON.parse(baselineBytes.toString("utf8"));
  const packageBytes = await readFile(path.join(candidateRoot, "package.json"));
  const runnerBytes = await readFile(
    path.join(candidateRoot, "tooling/ci/run-stage-5-final19-authoritative-ci.mjs"),
  );
  const matrixBytes = await readFile(path.join(candidateRoot, STAGE5_FINAL19_CORRECTION_MATRIX));
  assert.equal(hash(packageBytes), manifest.lineage.final19Generation.packageJsonSha256);
  assert.equal(hash(runnerBytes), manifest.lineage.final19Generation.runnerSha256);
  assert.equal(hash(matrixBytes), manifest.lineage.final19Generation.correctionMatrixSha256);
  assert.equal(manifest.lineage.final19Generation.candidate, "FINAL-19");
  assert.equal(manifest.lineage.final19Generation.stage6Actions, 0);
  const result = {
    result: "PASS",
    candidate: "FINAL-19",
    baselineSha256: receipt.baselineSha256,
    packageJsonSha256: hash(packageBytes),
    runnerSha256: hash(runnerBytes),
    correctionMatrixSha256: hash(matrixBytes),
    protectedPathCount: manifest.protectedFiles.length,
    permittedDeltaPaths,
    stage6Actions: 0,
  };
  assert.deepEqual(result.permittedDeltaPaths, permittedDeltaPaths);
  return result;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyStage5Final19SecurityExtensionBaseline();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
