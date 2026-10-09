import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { assertStage5CandidateManifest } from "./stage-5-candidate-coherence.mjs";
import {
  STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
  verifyStage5SecurityExtensionBaseline,
} from "./verify-stage-5-security-extension-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const verifyStage5CurrentSecurityExtensionBaseline = async ({
  candidateRoot = root,
} = {}) => {
  const workspace = path.resolve(candidateRoot);
  const manifest = assertStage5CandidateManifest(
    JSON.parse(
      await readFile(path.join(workspace, "tooling/ci/stage-5-current-candidate.json"), "utf8"),
    ),
  );
  const manifestBytes = await readFile(path.join(workspace, manifest.paths.manifest));
  const baselineBytes = await readFile(
    path.join(workspace, STAGE5_SECURITY_EXTENSION_BASELINE_PATH),
  );
  const baselineSha256 = sha256(baselineBytes);
  const receiptPath = path.join(
    workspace,
    manifest.evidenceDirectory,
    "security-extension-baseline-generation.json",
  );
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.candidate, manifest.candidate);
  assert.equal(receipt.predecessor, manifest.predecessor);
  assert.equal(receipt.baselineSha256, baselineSha256);
  assert.equal(receipt.stage6Actions, manifest.stage6Actions);
  const packageSha256 = sha256(await readFile(path.join(workspace, "package.json")));
  const runnerSha256 = sha256(await readFile(path.join(workspace, manifest.paths.runner)));
  const verifierSha256 = sha256(
    await readFile(path.join(workspace, manifest.paths.baselineVerifier)),
  );
  const sharedVerifierSha256 = sha256(
    await readFile(path.join(workspace, manifest.paths.sharedBaselineVerifier)),
  );
  const candidateManifestSha256 = sha256(manifestBytes);
  const matrixSha256 = sha256(await readFile(path.join(workspace, manifest.correctionMatrix)));
  assert.equal(receipt.packageJsonSha256, packageSha256);
  assert.equal(receipt.runnerSha256, runnerSha256);
  assert.equal(receipt.verifierSha256, verifierSha256);
  assert.equal(receipt.sharedVerifierSha256, sharedVerifierSha256);
  assert.equal(receipt.candidateManifestSha256, candidateManifestSha256);
  assert.equal(receipt.correctionMatrixSha256, matrixSha256);
  assert.deepEqual(receipt.protectedPathDelta, manifest.protectedPathDelta);
  const verification = await verifyStage5SecurityExtensionBaseline({
    root: workspace,
    requireCandidate: manifest.candidate,
    expectedBaselineSha256: baselineSha256,
    currentCandidateManifest: manifest,
  });
  const baseline = JSON.parse(baselineBytes.toString("utf8"));
  const generation = baseline.lineage?.[manifest.generationKey];
  assert.equal(
    generation?.candidate,
    manifest.candidate,
    "Baseline candidate differs from current candidate",
  );
  assert.equal(
    generation?.predecessor,
    manifest.predecessor,
    "Baseline predecessor differs from current candidate manifest",
  );
  assert.equal(generation?.packageJsonSha256, packageSha256);
  assert.equal(
    generation?.runnerSha256,
    runnerSha256,
    "Baseline runner hash differs from current runner",
  );
  assert.equal(
    generation?.verifierSha256,
    verifierSha256,
    "Baseline verifier hash differs from current verifier",
  );
  assert.equal(generation?.sharedVerifierSha256, sharedVerifierSha256);
  assert.equal(generation?.candidateManifestSha256, candidateManifestSha256);
  assert.equal(generation?.correctionMatrixSha256, matrixSha256);
  assert.deepEqual(generation?.protectedPathDelta, manifest.protectedPathDelta);
  assert.equal(generation?.predecessorBaselineSha256, receipt.predecessorBaselineSha256);
  return {
    ...verification,
    candidate: manifest.candidate,
    predecessor: manifest.predecessor,
    baselineSha256,
    runnerSha256,
    verifierSha256,
    candidateManifestSha256,
    correctionMatrixSha256: matrixSha256,
    receiptPath: path.relative(workspace, receiptPath),
    stage6Actions: manifest.stage6Actions,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyStage5CurrentSecurityExtensionBaseline();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
