import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { URL } from "node:url";

let installer;
try {
  installer = await import("./install-operator-unit.mjs");
} catch {
  installer = null;
}
assert.ok(installer, "Versioned one-shot unit installer must exist");
const rehearsal = await import("./rehearse-packaged-operator.mjs");
assert.equal(
  typeof rehearsal.stage7RehearsalGeneration,
  "function",
  "Packaged rehearsal must accept the successor identity",
);
for (const generation of ["gen09", "gen13"]) {
  assert.equal(
    rehearsal.stage7RehearsalGeneration({
      artifactId: `travelos-phase-1-m1-stage-7-${generation}-0015a8e1`,
      source: { successorBaselineGeneration: generation },
    }),
    generation,
  );
}
assert.throws(() =>
  rehearsal.stage7RehearsalGeneration({
    artifactId: "travelos-phase-1-m1-stage-7-gen09-0015a8e1",
    source: { successorBaselineGeneration: "gen13" },
  }),
);
const root = await mkdtemp(path.join(os.tmpdir(), "stage7-install-test-"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  const releaseRoot = path.join(root, "releases");
  const artifactRoot = path.join(releaseRoot, "travelos-stage7-gen13-0015a8e1");
  await mkdir(path.join(artifactRoot, "operator"), { recursive: true });
  await mkdir(path.join(artifactRoot, "deployment"));
  const unit = await readFile(
    new URL("../../../deploy/systemd/travelos-stage7-runtime-acceptance.service", import.meta.url),
    "utf8",
  );
  const candidateUnit = unit.replaceAll("--generation=gen09", "--generation=gen13");
  await writeFile(
    path.join(artifactRoot, "operator/travelos-stage7-runtime-acceptance.service"),
    candidateUnit,
  );
  const release = Buffer.from(
    JSON.stringify({
      artifactId: "travelos-phase-1-m1-stage-7-gen13-0015a8e1",
      source: {
        successorBaselineGeneration: "gen13",
        commit: "0015a8e1be16195d3333a8c9dfe53c107f83c30b",
      },
      runtimeAcceptance: { operatorUnitSha256: digest(candidateUnit) },
    }),
  );
  await writeFile(path.join(artifactRoot, "release.json"), release);
  await writeFile(
    path.join(artifactRoot, "deployment/verify-stage7-artifact.mjs"),
    'export const verifyStage7Artifact = async () => ({ result: "PASS" });\n',
  );
  const receipt = Buffer.from(
    JSON.stringify({
      candidateGeneration: "gen13",
      candidateCommit: "0015a8e1be16195d3333a8c9dfe53c107f83c30b",
      result: "PASS",
      ciConsumed: "YES",
      invocationCount: 1,
      completedGateCount: 42,
      expectedGateCount: 42,
      gates: Array.from({ length: 42 }, () => ({ result: "PASS", exitCode: 0 })),
      stage8Actions: 0,
    }),
  );
  const ciReceiptPath = path.join(root, "ci.json");
  await writeFile(ciReceiptPath, receipt);
  const options = {
    artifactRoot,
    releaseRoot,
    generation: "gen13",
    expectedReleaseSha256: digest(release),
    ciReceiptPath,
    expectedCiReceiptSha256: digest(receipt),
  };
  const prepared = await installer.prepareOperatorUnitInstall(options);
  assert.equal(prepared.result, "PASS");
  assert.equal(prepared.unitSha256, digest(candidateUnit));
  for (const overrides of [
    { generation: "gen09" },
    { expectedReleaseSha256: "0".repeat(64) },
    { expectedCiReceiptSha256: "0".repeat(64) },
    { artifactRoot: root },
  ]) {
    await assert.rejects(installer.prepareOperatorUnitInstall({ ...options, ...overrides }));
  }
  await writeFile(
    path.join(artifactRoot, "operator/travelos-stage7-runtime-acceptance.service"),
    candidateUnit.replace("DynamicUser=yes", "DynamicUser=no"),
  );
  await assert.rejects(installer.prepareOperatorUnitInstall(options));
  process.stdout.write(JSON.stringify({ result: "PASS", cases: 6, mutatingCommands: 0 }) + "\n");
} finally {
  await rm(root, { recursive: true, force: true });
}
