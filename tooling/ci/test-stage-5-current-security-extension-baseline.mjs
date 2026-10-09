import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  assertNoStaleStage5CandidateReferences,
  assertStage5CandidateManifest,
  assertStage5CandidateCoherenceInputs,
} from "./stage-5-candidate-coherence.mjs";
import { verifyStage5CurrentSecurityExtensionBaseline } from "./verify-stage-5-current-security-extension-baseline.mjs";
import { verifyStage5CurrentPredecessorEvidence } from "./prepare-stage-5-current-correction-matrix.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const manifest = assertStage5CandidateManifest(
  JSON.parse(await readFile(path.join(root, "tooling/ci/stage-5-current-candidate.json"), "utf8")),
);
const packageManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "travelos-current-predecessor-"));
try {
  const archive = JSON.parse(
    await readFile(path.join(root, manifest.historicalInputs.predecessorArchiveManifest), "utf8"),
  );
  const required = [
    manifest.paths.manifest,
    manifest.historicalInputs.predecessorFailureReceipt,
    manifest.historicalInputs.predecessorRejectionRecord,
    manifest.historicalInputs.predecessorBaselinePath,
    manifest.historicalInputs.predecessorCorrectionMatrix,
    `${manifest.historicalInputs.predecessorEvidenceDirectory}/security-extension-baseline-generation.json`,
    manifest.historicalInputs.predecessorCiReceipt,
    manifest.historicalInputs.predecessorEvidenceIndex,
    manifest.historicalInputs.predecessorValidation,
    manifest.historicalInputs.predecessorFreeze,
    manifest.historicalInputs.predecessorFinalScan,
    manifest.historicalInputs.predecessorArchiveManifest,
    archive.archivePath,
  ];
  for (const relativePath of required) {
    const target = path.join(fixtureRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(path.join(root, relativePath)));
  }
  const predecessor = await verifyStage5CurrentPredecessorEvidence(manifest.predecessor, {
    candidateRoot: fixtureRoot,
  });
  assert.equal(predecessor.receipt.ciConsumed, "YES");
  assert.equal(predecessor.receipt.disposition, "FROZEN_REJECTED_POST_FREEZE_PROVENANCE");
  for (const relativePath of required.slice(1)) {
    const target = path.join(fixtureRoot, relativePath);
    const original = await readFile(target);
    await writeFile(target, Buffer.concat([original, Buffer.from("tampered\n")]));
    await assert.rejects(
      verifyStage5CurrentPredecessorEvidence(manifest.predecessor, { candidateRoot: fixtureRoot }),
      /Expected values to be strictly equal|Immutable predecessor input changed/u,
      `Predecessor tampering must fail closed: ${relativePath}`,
    );
    await writeFile(target, original);
  }
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
const staleReference = {
  component: "regression-fixture",
  path: "fixture.mjs",
  text: `run candidate ${manifest.predecessor}`,
};
assert.throws(
  () => assertNoStaleStage5CandidateReferences(manifest.candidate, [staleReference]),
  /hard-coded predecessor candidate reference/u,
  "Readiness coherence must reject an injected predecessor reference",
);
const activeSources = [];
for (const [component, relativePath] of Object.entries(manifest.paths)) {
  if (component === "manifest") continue;
  activeSources.push({
    component,
    path: relativePath,
    text: await readFile(path.join(root, relativePath), "utf8"),
  });
}
for (const exception of manifest.historicalReferenceExceptions) {
  if (!activeSources.some(({ path: sourcePath }) => sourcePath === exception.path)) {
    activeSources.push({
      component: "historicalReferenceException",
      path: exception.path,
      text: await readFile(path.join(root, exception.path), "utf8"),
    });
  }
}
assert.throws(
  () =>
    assertStage5CandidateCoherenceInputs({
      manifest,
      activeSources: [...activeSources, staleReference],
      packageManifest,
    }),
  /hard-coded predecessor candidate reference/u,
  "The complete readiness coherence contract must fail closed before CI",
);
const preBaseline = process.argv.includes("--pre-baseline");
const baseline = preBaseline ? null : await verifyStage5CurrentSecurityExtensionBaseline();
if (baseline) {
  assert.equal(baseline.result, "PASS");
  assert.equal(baseline.candidate, manifest.candidate);
  assert.equal(baseline.predecessor, manifest.predecessor);
  assert.equal(baseline.stage6Actions, 0);
}
process.stdout.write(
  `${JSON.stringify(
    {
      result: "PASS",
      candidate: manifest.candidate,
      stalePredecessorFixture: "FROZEN_REJECTED_POST_FREEZE_PROVENANCE",
      baselineSha256: baseline?.baselineSha256 ?? null,
      protectedFiles: baseline?.phase1.protectedFileCount ?? null,
      stage6Actions: 0,
    },
    null,
    2,
  )}\n`,
);
