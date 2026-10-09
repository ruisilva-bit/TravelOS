import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_FINAL11_EVIDENCE_DIRECTORY,
  STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL11_INVOCATION_GUARD_PATH,
  STAGE5_FINAL11_REJECTION_RECORD,
  STAGE5_FINAL12_CORRECTION_MATRIX,
  STAGE5_FINAL12_EVIDENCE_DIRECTORY,
  STAGE5_FINAL12_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  STAGE5_FINAL12_PREDECESSOR_EVIDENCE_NAMES,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final11EvidenceIndex } from "./stage-5-evidence-index.mjs";
import { verifyStage5Final12FindingLineage } from "./stage-5-final12-finding-lineage.mjs";
const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const regular = async (p) => {
  const s = await lstat(p);
  assert(s.isFile() && !s.isSymbolicLink(), `${p} must be a regular file`);
  return readFile(p);
};
export const prepareStage5Final12Evidence = async () => {
  const lineage = await verifyStage5Final12FindingLineage({ root });
  const predecessor = await verifyStage5Final11EvidenceIndex({
    root,
    allowedPhases: ["CI_FAILED"],
    requiredPhase: "CI_FAILED",
  });
  assert.equal(predecessor.result, "PASS");
  const dir = path.join(root, STAGE5_FINAL12_EVIDENCE_DIRECTORY);
  const before = (await readdir(dir)).toSorted();
  const notYetCreated = new Set([
    "format-check.json",
    "format-check.log",
    "readiness-preflight.json",
    "ci-verify.log",
    "ci-verify-execution.json",
  ]);
  const possible = STAGE5_FINAL12_EXPECTED_EVIDENCE_ARTIFACT_NAMES.filter(
    (name) => !notYetCreated.has(name),
  );
  assert(
    before.every((name) => possible.includes(name)) &&
      before.includes("baseline-generation.json") &&
      before.includes("final11-security-extension-baseline.json"),
    "FINAL-12 preparation refuses unexpected evidence while allowing verified partial copies",
  );
  const copy = async (name, source) => {
    const bytes = await regular(path.join(root, source));
    const target = path.join(dir, name);
    try {
      const existing = await regular(target);
      assert.deepEqual(existing, bytes, `existing predecessor copy differs: ${name}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeFile(target, bytes, { flag: "wx" });
    }
    return { path: name, bytes: bytes.length, sha256: sha256(bytes) };
  };
  const artifacts = [];
  for (const name of STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES) {
    const targetName =
      name === "security-extension-baseline.json"
        ? "final11-security-extension-baseline-verification.json"
        : `final11-${name}`;
    artifacts.push(await copy(targetName, `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/${name}`));
  }
  artifacts.push(
    await copy(
      "final11-EVIDENCE_INDEX.json",
      `${STAGE5_FINAL11_EVIDENCE_DIRECTORY}/EVIDENCE_INDEX.json`,
    ),
  );
  artifacts.push(await copy("final11-invocation-guard.json", STAGE5_FINAL11_INVOCATION_GUARD_PATH));
  artifacts.push(await copy("final11-rejection-record.md", STAGE5_FINAL11_REJECTION_RECORD));
  artifacts.push(await copy("final12-correction-matrix.json", STAGE5_FINAL12_CORRECTION_MATRIX));
  const names = (await readdir(dir)).toSorted();
  const expected = STAGE5_FINAL12_EXPECTED_EVIDENCE_ARTIFACT_NAMES.filter(
    (n) =>
      ![
        "format-check.json",
        "format-check.log",
        "readiness-preflight.json",
        "ci-verify.log",
        "ci-verify-execution.json",
      ].includes(n),
  ).toSorted();
  assert.deepEqual(names, expected, "FINAL-12 prepared artifact directory must be exact");
  const matrix = JSON.parse(
    (await regular(path.join(dir, "final12-correction-matrix.json"))).toString("utf8"),
  );
  assert.equal(matrix.candidate, "FINAL-12");
  assert.equal(matrix.stage6Actions, 0);
  assert.deepEqual(
    STAGE5_FINAL12_PREDECESSOR_EVIDENCE_NAMES.filter((n) => n.startsWith("final11-")).length,
    STAGE5_FINAL11_EXPECTED_EVIDENCE_ARTIFACT_NAMES.length + 4,
  );
  return {
    result: "PASS",
    candidate: "FINAL-12",
    phase: "PRE_CI_PREPARATION",
    copiedArtifacts: artifacts.length,
    predecessorIndexSha256: predecessor.indexSha256,
    final11LineageSha256: lineage.ciLog.sha256,
    stage6Actions: 0,
  };
};
const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct)
  process.stdout.write(`${JSON.stringify(await prepareStage5Final12Evidence(), null, 2)}\n`);
