import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  STAGE5_FINAL17_EVIDENCE_DIRECTORY,
  STAGE5_FINAL17_SECURITY_BASELINE_SHA256,
} from "./stage-5-candidate-contract.mjs";

const root = process.cwd();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const evidenceDirectory = path.join(root, "docs/evidence/phase-1-m1/stage-5-final-18");
const archivedBaselineBytes = await readFile(
  path.join(evidenceDirectory, "final17-security-extension-baseline.json"),
);
assert.equal(
  digest(archivedBaselineBytes),
  STAGE5_FINAL17_SECURITY_BASELINE_SHA256,
  "FINAL-17's consumed predecessor baseline must remain byte-identical",
);
const archivedBaseline = JSON.parse(archivedBaselineBytes.toString("utf8"));
assert.equal(archivedBaseline.lineage.final17Generation.candidate, "FINAL-17");
assert.equal(archivedBaseline.lineage.final17Generation.stage6Actions, 0);
assert.deepEqual(
  archivedBaseline.lineage.final17Generation.protectedPathDeltas.map((delta) => delta.path),
  ["package.json"],
);
assert.equal(archivedBaseline.extension.permissionRegistryVersion, 3);
const predecessorIndex = JSON.parse(
  await readFile(path.join(root, STAGE5_FINAL17_EVIDENCE_DIRECTORY, "EVIDENCE_INDEX.json"), "utf8"),
);
assert.equal(predecessorIndex.candidate, "FINAL-17");
assert.equal(predecessorIndex.phase, "FINAL");
const final18Baseline = JSON.parse(
  await readFile(
    path.join(root, "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json"),
    "utf8",
  ),
);
assert.equal(
  final18Baseline.lineage.final18Generation.previousBaselineSha256,
  STAGE5_FINAL17_SECURITY_BASELINE_SHA256,
);
assert.equal(final18Baseline.lineage.rejectedFinal17Candidate.ciInvocationCount, 1);
assert.equal(final18Baseline.lineage.rejectedFinal17Candidate.authorizationConsumed, true);
assert.equal(final18Baseline.lineage.rejectedFinal17Candidate.authorizationTransferred, false);
assert.equal(final18Baseline.lineage.rejectedFinal17Candidate.stage6Actions, 0);
const verified = {
  result: "PASS",
  candidate: "FINAL-17",
  baselineSha256: digest(archivedBaselineBytes),
  predecessorIndexPhase: predecessorIndex.phase,
  successorBaselineSha256: digest(
    await readFile(
      path.join(root, "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json"),
    ),
  ),
  stage6Actions: 0,
};
process.stdout.write(
  `${JSON.stringify(
    {
      result: "PASS",
      candidate: "FINAL-17",
      baselineSha256: verified.baselineSha256,
      predecessorSha256: verified.previousBaselineSha256,
      protectedPathCount: verified.protectedPathCount,
      permittedDeltaPaths: verified.permittedDeltaPaths,
      stage6Actions: 0,
    },
    null,
    2,
  )}\n`,
);
