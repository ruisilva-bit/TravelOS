import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import activeManifest from "./stage-5-current-candidate.json" with { type: "json" };
import {
  assertStage5CandidateManifest,
  verifyStage5CandidateCoherence,
} from "./stage-5-candidate-coherence.mjs";
import { verifyStage5CurrentFindingLineage } from "./stage-5-current-finding-lineage.mjs";
import { scanStage5CurrentSource } from "./scan-stage-5-current-source.mjs";
import {
  verifyStage5CurrentEvidenceIndex,
  writeStage5CurrentEvidenceIndex,
} from "./stage-5-current-evidence-index.mjs";
import { verifyStage5CurrentSecurityExtensionBaseline } from "./verify-stage-5-current-security-extension-baseline.mjs";
import { verifyStage5CurrentReadiness } from "./stage-5-current-readiness-preflight.mjs";
import { verifyStage5CurrentSourceScope } from "./run-stage-5-current-source-scope.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const readinessPath = activeManifest.readinessReceipt;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `${file} must be a regular non-symlink file`,
  );
  return readFile(file);
};
const writeExclusiveOrMatch = async (file, bytes) => {
  try {
    assert.deepEqual(
      await readRegular(file),
      bytes,
      `Refusing divergent evidence preparation reuse: ${file}`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(file, bytes, { flag: "wx" });
  }
};
const ensureEvidence = async (workspace, manifest) => {
  const required = [
    manifest.correctionMatrix,
    `${manifest.evidenceDirectory}/current-correction-matrix.json`,
    `${manifest.evidenceDirectory}/finding-lineage.json`,
    `${manifest.evidenceDirectory}/security-extension-baseline-generation.json`,
    `${manifest.evidenceDirectory}/focused-test-execution.json`,
    `${manifest.evidenceDirectory}/focused-tests.log`,
    `${manifest.evidenceDirectory}/postgresql-qualification.json`,
    `${manifest.evidenceDirectory}/postgresql-qualification-execution.json`,
    `${manifest.evidenceDirectory}/postgresql-qualification-runner.log`,
    `${manifest.evidenceDirectory}/postgresql-integration-tests.log`,
    `${manifest.evidenceDirectory}/postgresql-integration-test-execution.json`,
    `${manifest.evidenceDirectory}/postgresql-disposable-cleanup.json`,
    `${manifest.evidenceDirectory}/postgresql-package-build.json`,
    `${manifest.evidenceDirectory}/postgresql-package-provenance.json`,
    `${manifest.evidenceDirectory}/postgresql-runtime.json`,
    `${manifest.evidenceDirectory}/readiness-preflight.json`,
    `${manifest.evidenceDirectory}/lifecycle-state.json`,
  ];
  const missing = [];
  for (const relativePath of required) {
    try {
      await readRegular(path.join(workspace, relativePath));
    } catch (error) {
      if (error.code === "ENOENT") missing.push(relativePath);
      else throw error;
    }
  }
  assert.deepEqual(missing, [], `Current candidate evidence is incomplete: ${missing.join(", ")}`);
  return required;
};

export const prepareStage5CurrentEvidence = async ({
  candidateRoot = root,
  write = false,
} = {}) => {
  const workspace = path.resolve(candidateRoot);
  const manifest = assertStage5CandidateManifest(
    JSON.parse(
      await readFile(path.join(workspace, "tooling/ci/stage-5-current-candidate.json"), "utf8"),
    ),
  );
  const readiness = await verifyStage5CurrentReadiness({ candidateRoot: workspace });
  const readinessBytes = await readRegular(path.join(workspace, readinessPath));
  const evidenceDirectory = path.join(workspace, manifest.evidenceDirectory);
  const readinessEvidencePath = path.join(evidenceDirectory, "readiness-preflight.json");
  const lifecyclePath = path.join(evidenceDirectory, "lifecycle-state.json");
  if (write) {
    await mkdir(evidenceDirectory, { recursive: true });
    await writeExclusiveOrMatch(readinessEvidencePath, readinessBytes);
    const lifecycleState = {
      schemaVersion: 1,
      candidate: manifest.candidate,
      predecessor: manifest.predecessor,
      lifecycleState: "READY_FOR_CI",
      ciStatus: "NOT_RUN",
      validationStatus: "PENDING_CI",
      freezeStatus: "NOT_CREATED",
      reviewStatus: "NOT_RUN",
      closureStatus: "NOT_CLOSED",
      readinessSha256: hash(readinessBytes),
      stage6Actions: manifest.stage6Actions,
    };
    await writeExclusiveOrMatch(
      lifecyclePath,
      Buffer.from(`${JSON.stringify(lifecycleState, null, 2)}\n`),
    );
  }
  const lineage = await verifyStage5CurrentFindingLineage({ candidateRoot: workspace });
  assert.equal(lineage.result, "PASS");
  const baseline = await verifyStage5CurrentSecurityExtensionBaseline({ candidateRoot: workspace });
  assert.equal(baseline.result, "PASS");
  const coherence = await verifyStage5CandidateCoherence({ root: workspace });
  if (write) {
    const sourceScan = await scanStage5CurrentSource({
      candidateRoot: workspace,
      phase: "PRE_CI",
      write: true,
    });
    assert.equal(sourceScan.result, "PASS");
    await writeStage5CurrentEvidenceIndex({ candidateRoot: workspace, phase: "PRE_CI" });
  }
  const requiredArtifacts = await ensureEvidence(workspace, manifest);
  const evidenceIndex = await verifyStage5CurrentEvidenceIndex({ candidateRoot: workspace });
  const sourceScope = await verifyStage5CurrentSourceScope({ candidateRoot: workspace });
  const scanPhase = evidenceIndex.phase === "PRE_CI" ? "PRE_CI" : "FINAL";
  const scanPath = path.join(
    evidenceDirectory,
    `source-security-scan-${scanPhase.toLowerCase().replaceAll("_", "-")}.json`,
  );
  const scanBytes = await readRegular(scanPath);
  const scan = JSON.parse(scanBytes.toString("utf8"));
  assert.equal(scan.result, "PASS");
  assert.equal(scan.phase, scanPhase);
  assert.equal(scan.candidate, manifest.candidate);
  assert.equal(scan.findingCount, 0);
  const sourceScan = {
    result: scan.result,
    phase: scan.phase,
    reportPath: path.relative(workspace, scanPath),
    reportSha256: hash(scanBytes),
    filesScanned: scan.sourceCount,
    findingCount: scan.findingCount,
  };
  if (scanPhase === "PRE_CI") {
    const scanRecheck = await scanStage5CurrentSource({
      candidateRoot: workspace,
      phase: scanPhase,
      write: false,
    });
    assert.equal(scanRecheck.reportSha256, sourceScan.reportSha256);
  }
  return {
    result: "PASS",
    candidate: manifest.candidate,
    predecessor: manifest.predecessor,
    readinessSha256: readiness.readinessSha256,
    baselineSha256: baseline.baselineSha256,
    candidateCoherence: coherence.result,
    findingLineage: lineage.result,
    sourceScan,
    evidenceIndex,
    sourceScope: sourceScope.result,
    requiredArtifactCount: requiredArtifacts.length,
    stage6Actions: manifest.stage6Actions,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareStage5CurrentEvidence({ write: process.argv.includes("--write") });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
