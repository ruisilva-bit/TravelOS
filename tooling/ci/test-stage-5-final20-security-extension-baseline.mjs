import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  STAGE5_FINAL19_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL20_SECURITY_BASELINE_SHA256,
  STAGE5_FINAL20_BASELINE_ATTEMPT_01_SHA256,
  STAGE5_FINAL20_EVIDENCE_DIRECTORY,
  STAGE5_FINAL21_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";

const root = process.cwd();
const evidenceDirectory = path.join(root, STAGE5_FINAL20_EVIDENCE_DIRECTORY);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const archivedBaseline = await readFile(
  path.join(root, STAGE5_FINAL21_EVIDENCE_DIRECTORY, "final20-security-extension-baseline.json"),
);
assert.equal(hash(archivedBaseline), STAGE5_FINAL20_SECURITY_BASELINE_SHA256);
const archivedManifest = JSON.parse(archivedBaseline.toString("utf8"));
assert.equal(archivedManifest.result, "PASS");
assert.equal(archivedManifest.lineage.final20Generation?.candidate, "FINAL-20");
assert.equal(archivedManifest.protectedFiles.length, 12);
const aggregateBytes = Buffer.from(
  archivedManifest.protectedFiles
    .map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`)
    .join(""),
);
assert.equal(hash(aggregateBytes), archivedManifest.aggregateSha256);
assert.notEqual(
  hash(Buffer.concat([archivedBaseline, Buffer.from("tamper")])),
  STAGE5_FINAL20_SECURITY_BASELINE_SHA256,
);
const attemptBaseline = await readFile(path.join(evidenceDirectory, "baseline-attempt-01.json"));
assert.equal(hash(attemptBaseline), STAGE5_FINAL20_BASELINE_ATTEMPT_01_SHA256);
const predecessorBaseline = await readFile(
  path.join(evidenceDirectory, "final19-security-extension-baseline.json"),
);
assert.equal(hash(predecessorBaseline), STAGE5_FINAL19_SECURITY_BASELINE_SHA256);
const initialGeneration = JSON.parse(
  await readFile(path.join(evidenceDirectory, "baseline-generation.json"), "utf8"),
);
assert.equal(initialGeneration.baselineSha256, STAGE5_FINAL20_BASELINE_ATTEMPT_01_SHA256);
const finalGeneration = JSON.parse(
  await readFile(path.join(evidenceDirectory, "baseline-generation-final.json"), "utf8"),
);
assert.equal(finalGeneration.baselineSha256, STAGE5_FINAL20_SECURITY_BASELINE_SHA256);
assert.equal(finalGeneration.stage6Actions, 0);
process.stdout.write(
  `${JSON.stringify({ result: "PASS", candidate: "FINAL-20 historical baseline", baselineSha256: STAGE5_FINAL20_SECURITY_BASELINE_SHA256, protectedPathCount: archivedManifest.protectedFiles.length, stage6Actions: 0 }, null, 2)}\n`,
);
