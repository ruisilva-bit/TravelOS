import assert from "node:assert/strict";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_FINAL18_CORRECTION_MATRIX,
  STAGE5_FINAL18_EVIDENCE_DIRECTORY,
  STAGE5_FINAL19_CORRECTION_MATRIX,
  STAGE5_FINAL19_CI_EXECUTION_PLACEHOLDER,
  STAGE5_FINAL19_CI_LOG_PLACEHOLDER,
  STAGE5_FINAL19_EVIDENCE_DIRECTORY,
  STAGE5_FINAL19_PREDECESSOR_EVIDENCE_NAMES,
  STAGE5_FINAL19_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final18EvidenceIndex } from "./stage-5-final18-evidence-index.mjs";
import { verifyStage5Final19FindingLineage } from "./stage-5-final19-finding-lineage.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const priorDirectory = path.join(root, STAGE5_FINAL18_EVIDENCE_DIRECTORY);
const directory = path.join(root, STAGE5_FINAL19_EVIDENCE_DIRECTORY);
const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `${file} must be a regular file`);
  return readFile(file);
};
const copyExclusiveOrMatch = async (source, destination) => {
  const bytes = await readRegular(source);
  await writeBytesExclusiveOrMatch(destination, bytes);
};
const writeBytesExclusiveOrMatch = async (destination, bytes) => {
  try {
    const existing = await readRegular(destination);
    assert.deepEqual(existing, bytes, `Refusing divergent FINAL-19 evidence reuse: ${destination}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(destination, bytes, { flag: "wx" });
  }
};

export const prepareStage5Final19Evidence = async () => {
  const predecessor = await verifyStage5Final18EvidenceIndex({
    root,
    allowedPhases: ["PRE_CI"],
    requiredPhase: "PRE_CI",
  });
  assert.equal(predecessor.result, "PASS");
  const lineage = await verifyStage5Final19FindingLineage({ root });
  assert.equal(lineage.result, "PASS");
  await mkdir(directory, { recursive: true });

  for (const name of STAGE5_FINAL19_PREDECESSOR_EVIDENCE_NAMES) {
    let source;
    if (name === "final18-EVIDENCE_INDEX.json") {
      source = path.join(priorDirectory, "EVIDENCE_INDEX.json");
    } else if (name === "final18-security-extension-baseline.json") {
      source = path.join(directory, "final18-security-extension-baseline.json");
    } else if (name === "final18-correction-matrix.json") {
      source = path.join(root, STAGE5_FINAL18_CORRECTION_MATRIX);
    } else if (name === "final18-preflight-failure-01.json") {
      source = path.join(root, ".hermes/state/stage5-final18-preflight-failure-01.json");
    } else {
      source = path.join(priorDirectory, name.slice("final18-".length));
    }
    await copyExclusiveOrMatch(source, path.join(directory, name));
  }

  await copyExclusiveOrMatch(
    path.join(root, STAGE5_FINAL19_CORRECTION_MATRIX),
    path.join(directory, "final19-correction-matrix.json"),
  );
  await copyExclusiveOrMatch(
    path.join(root, STAGE5_FINAL19_EVIDENCE_DIRECTORY, "finding-lineage.json"),
    path.join(directory, "finding-lineage.json"),
  );
  await writeBytesExclusiveOrMatch(
    path.join(directory, "ci-verify.log"),
    Buffer.from(STAGE5_FINAL19_CI_LOG_PLACEHOLDER),
  );
  await writeBytesExclusiveOrMatch(
    path.join(directory, "ci-verify-execution.json"),
    Buffer.from(STAGE5_FINAL19_CI_EXECUTION_PLACEHOLDER),
  );
  await writeBytesExclusiveOrMatch(
    path.join(directory, "readiness-preflight.json"),
    Buffer.from(
      `${JSON.stringify({ schemaVersion: 1, candidate: "FINAL-19", phase: "PRE_CI", result: "PENDING", ciVerifyInvoked: false, invocationCount: 0, stage6Actions: 0 }, null, 2)}\n`,
    ),
  );

  const expected = [...STAGE5_FINAL19_EXPECTED_EVIDENCE_ARTIFACT_NAMES].toSorted();
  assert(expected.includes("finding-lineage.json"));
  return {
    result: "PREPARED_FOUNDATION",
    candidate: "FINAL-19",
    predecessorIndexSha256: predecessor.indexSha256,
    lineageSha256: lineage.correctionMatrix.sha256,
    predecessorArtifacts: STAGE5_FINAL19_PREDECESSOR_EVIDENCE_NAMES.length,
    expectedArtifactCount: expected.length,
    generatedPredecessorCopies: STAGE5_FINAL19_PREDECESSOR_EVIDENCE_NAMES.length,
    currentEvidencePreparation: "PARTIAL_UNTIL_QUALIFICATION_RECEIPTS_EXIST",
    stage6Actions: 0,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareStage5Final19Evidence();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
