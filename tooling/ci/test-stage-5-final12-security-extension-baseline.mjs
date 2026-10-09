import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  STAGE5_FINAL13_EVIDENCE_DIRECTORY,
  STAGE5_FINAL12_SECURITY_BASELINE_SHA256,
} from "./stage-5-candidate-contract.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const baselinePath = path.join(
  root,
  STAGE5_FINAL13_EVIDENCE_DIRECTORY,
  "final12-security-extension-baseline.json",
);
const bytes = await readFile(baselinePath);
const sha256 = createHash("sha256").update(bytes).digest("hex");
assert.equal(sha256, STAGE5_FINAL12_SECURITY_BASELINE_SHA256);
const baseline = JSON.parse(bytes.toString("utf8"));
assert.equal(baseline.result, "PASS");
assert.equal(baseline.stage6Actions, 0);
assert.equal(baseline.lineage.final12Generation.candidate, "FINAL-12");
assert.equal(baseline.lineage.final12Generation.stage6Actions, 0);
assert.deepEqual(
  baseline.lineage.final12Generation.protectedPathDeltas.map((delta) => delta.path).toSorted(),
  ["docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md", "package.json"].toSorted(),
);
assert.equal(
  baseline.lineage.rejectedFinal11Candidate.status,
  "REJECTED / CI CONSUMED / FORMAT-GATE FAILURE",
);
assert.equal(baseline.lineage.rejectedFinal11Candidate.stage6Actions, 0);
process.stdout.write(
  `${JSON.stringify(
    {
      result: "PASS",
      candidate: "FINAL-12 historical baseline",
      bytes: bytes.length,
      baselineSha256: sha256,
      protectedPathCount: baseline.protectedFiles.length,
      stage6Actions: 0,
    },
    null,
    2,
  )}\n`,
);
