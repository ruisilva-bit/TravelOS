import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_FINAL12_CORRECTION_MATRIX,
  STAGE5_FINAL12_EVIDENCE_DIRECTORY,
  STAGE5_FINAL12_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL12_CI_VERIFY_INVOCATION_GUARD,
  STAGE5_FINAL12_REJECTION_MATRIX,
  STAGE5_FINAL12_REJECTION_RECORD,
  STAGE5_FINAL13_CORRECTION_MATRIX,
  STAGE5_FINAL13_EVIDENCE_DIRECTORY,
  STAGE5_FINAL13_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL13_PREDECESSOR_EVIDENCE_NAMES,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final12EvidenceIndex } from "./stage-5-final12-evidence-index.mjs";
import {
  verifyStage5Final13FindingLineage,
  writeStage5Final13CorrectionMatrix,
} from "./stage-5-final13-finding-lineage.mjs";
const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const regular = async (p) => {
  const s = await lstat(p);
  assert(s.isFile() && !s.isSymbolicLink(), `${p} must be a regular file`);
  return readFile(p);
};
export const prepareStage5Final13Evidence = async () => {
  const predecessor = await verifyStage5Final12EvidenceIndex({
    root,
    allowedPhases: ["CI_FAILED"],
    requiredPhase: "CI_FAILED",
  });
  const dir = path.join(root, STAGE5_FINAL13_EVIDENCE_DIRECTORY);
  await mkdir(dir, { recursive: true });
  const before = (await readdir(dir)).toSorted();
  const notYet = new Set([
    "baseline-generation.json",
    "format-check.json",
    "format-check.log",
    "lint-check.json",
    "lint-check.log",
    "readiness-preflight.json",
    "ci-verify.log",
    "ci-verify-execution.json",
  ]);
  const possible = STAGE5_FINAL13_EXPECTED_EVIDENCE_ARTIFACT_NAMES.filter((n) => !notYet.has(n));
  assert(
    before.every((n) => possible.includes(n)),
    "FINAL-13 refuses unexpected/stale evidence files",
  );
  const copy = async (name, source) => {
    const bytes = await regular(path.join(root, source));
    const target = path.join(dir, name);
    try {
      assert.deepEqual(await regular(target), bytes, `predecessor copy differs: ${name}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeFile(target, bytes, { flag: "wx" });
    }
    return { path: name, bytes: bytes.length, sha256: sha256(bytes) };
  };
  const artifacts = [];
  for (const name of STAGE5_FINAL12_EXPECTED_EVIDENCE_ARTIFACT_NAMES) {
    const targetName =
      name === "security-extension-baseline.json"
        ? "final12-security-extension-baseline-verification.json"
        : `final12-${name}`;
    artifacts.push(await copy(targetName, `${STAGE5_FINAL12_EVIDENCE_DIRECTORY}/${name}`));
  }
  artifacts.push(
    await copy(
      "final12-EVIDENCE_INDEX.json",
      `${STAGE5_FINAL12_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`,
    ),
    await copy("final12-invocation-guard.json", STAGE5_FINAL12_CI_VERIFY_INVOCATION_GUARD),
    await copy("final12-rejection-record.md", STAGE5_FINAL12_REJECTION_RECORD),
    await copy("final12-rejection-matrix.json", STAGE5_FINAL12_REJECTION_MATRIX),
    await copy("final12-correction-matrix.json", STAGE5_FINAL12_CORRECTION_MATRIX),
    await copy(
      "final12-security-extension-baseline.json",
      "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json",
    ),
  );
  assert.equal(predecessor.result, "PASS");
  const lineage = await verifyStage5Final13FindingLineage({ root });
  const matrixResult = await writeStage5Final13CorrectionMatrix({ root });
  artifacts.push(await copy("final13-correction-matrix.json", STAGE5_FINAL13_CORRECTION_MATRIX));
  const names = (await readdir(dir)).toSorted();
  const expected = STAGE5_FINAL13_EXPECTED_EVIDENCE_ARTIFACT_NAMES.filter(
    (n) => !notYet.has(n),
  ).toSorted();
  assert.deepEqual(names, expected, "FINAL-13 predecessor evidence directory must be exact");
  assert.equal(STAGE5_FINAL13_PREDECESSOR_EVIDENCE_NAMES.length, artifacts.length - 1);
  return {
    result: "PASS",
    candidate: "FINAL-13",
    phase: "PRE_CI_PREPARATION",
    copiedArtifacts: artifacts.length,
    predecessorIndexSha256: predecessor.indexSha256,
    final12LineageSha256: lineage.ciLog.sha256,
    correctionMatrixSha256: matrixResult.sha256,
    stage6Actions: 0,
  };
};
const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct)
  process.stdout.write(`${JSON.stringify(await prepareStage5Final13Evidence(), null, 2)}\n`);
