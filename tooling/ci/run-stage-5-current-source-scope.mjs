import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  assertStage5CandidateManifest,
  verifyStage5CandidateCoherence,
} from "./stage-5-candidate-coherence.mjs";
import { verifyStage5CurrentFindingLineage } from "./stage-5-current-finding-lineage.mjs";
import { verifyStage5CurrentEvidenceIndex } from "./stage-5-current-evidence-index.mjs";
import { verifyStage5CurrentSecurityExtensionBaseline } from "./verify-stage-5-current-security-extension-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `${file} must be a regular non-symlink file`,
  );
  return readFile(file);
};
const verifyLifecycleState = async (workspace, manifest, fileName, expectedCiStatus) => {
  const file = path.join(workspace, manifest.evidenceDirectory, fileName);
  let bytes;
  try {
    bytes = await readRegular(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const state = JSON.parse(bytes.toString("utf8"));
  assert.equal(state.candidate, manifest.candidate);
  assert.equal(state.predecessor, manifest.predecessor);
  assert.equal(state.ciStatus, expectedCiStatus);
  assert.equal(state.stage6Actions, manifest.stage6Actions);
  return {
    path: path.relative(workspace, file),
    sha256: hash(bytes),
    lifecycleState: state.lifecycleState,
    ciStatus: state.ciStatus,
  };
};

export const verifyStage5CurrentSourceScope = async ({
  candidateRoot = root,
  preIndex = false,
} = {}) => {
  const workspace = path.resolve(candidateRoot);
  const manifest = assertStage5CandidateManifest(
    JSON.parse(
      await readFile(path.join(workspace, "tooling/ci/stage-5-current-candidate.json"), "utf8"),
    ),
  );
  for (const relativePath of manifest.protectedPaths) {
    const bytes = await readRegular(path.join(workspace, relativePath));
    assert(bytes.length > 0, `Protected candidate source is empty: ${relativePath}`);
  }
  const historical = spawnSync("corepack", ["pnpm", "run", "test:stage5-source-scope:historical"], {
    cwd: workspace,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env },
  });
  const historicalOutput = Buffer.from(`${historical.stdout ?? ""}${historical.stderr ?? ""}`);
  assert.equal(
    historical.status,
    0,
    `Historical evidence/lifecycle verification failed (${historical.status ?? 1})`,
  );
  const coherence = await verifyStage5CandidateCoherence({ root: workspace });
  const findingLineage = await verifyStage5CurrentFindingLineage({ candidateRoot: workspace });
  const baselineReceipt = path.join(
    workspace,
    manifest.evidenceDirectory,
    "security-extension-baseline-generation.json",
  );
  let baseline = null;
  try {
    await readRegular(baselineReceipt);
    baseline = await verifyStage5CurrentSecurityExtensionBaseline({ candidateRoot: workspace });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (!preIndex)
      throw new Error("Current candidate baseline receipt is required after evidence preparation", {
        cause: error,
      });
  }
  const indexPath = path.join(workspace, manifest.evidenceDirectory, "EVIDENCE_INDEX.json");
  let evidenceIndex = null;
  try {
    await readRegular(indexPath);
    evidenceIndex = await verifyStage5CurrentEvidenceIndex({ candidateRoot: workspace });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (!preIndex)
      throw new Error("Current candidate evidence index is required outside pre-index mode", {
        cause: error,
      });
  }
  const preCiLifecycle = await verifyLifecycleState(
    workspace,
    manifest,
    "lifecycle-state.json",
    "NOT_RUN",
  );
  const finalLifecycle = await verifyLifecycleState(
    workspace,
    manifest,
    "lifecycle-state-final.json",
    "PASS",
  );
  if (!preIndex)
    assert(
      preCiLifecycle || finalLifecycle,
      "Current candidate lifecycle-state evidence is missing",
    );
  return {
    result: "PASS",
    candidate: manifest.candidate,
    predecessor: manifest.predecessor,
    phase: preIndex ? "PRE_INDEX" : (evidenceIndex?.phase ?? "PRE_INDEX"),
    protectedSourceCount: manifest.protectedPaths.length,
    historicalLifecycleAndEvidence: {
      result: "PASS",
      outputBytes: historicalOutput.length,
      outputSha256: hash(historicalOutput),
    },
    candidateCoherence: coherence,
    findingLineage,
    baselineSha256: baseline?.baselineSha256 ?? null,
    evidenceIndex,
    preCiLifecycle,
    finalLifecycle,
    stage6Actions: manifest.stage6Actions,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyStage5CurrentSourceScope({
    preIndex: process.argv.includes("--pre-index"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
