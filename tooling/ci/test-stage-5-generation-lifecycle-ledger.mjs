import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_GENERATION_LIFECYCLE_LEDGER,
  validateStage5GenerationLifecycleLedger,
} from "./stage-5-generation-lifecycle-ledger.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const reviewDirectory = "docs/reviews/phase-1-m1";
const entries = await readdir(path.join(root, reviewDirectory), { withFileTypes: true });
const candidateArtifactPaths = entries
  .filter(
    (entry) =>
      entry.isFile() &&
      /^STAGE_5_FINAL_\d+_CANDIDATE_(?:VALIDATION|FREEZE)[.](?:md|json)$/u.test(entry.name),
  )
  .map((entry) => `${reviewDirectory}/${entry.name}`)
  .toSorted();
const candidateArtifactHashes = {};
for (const artifact of STAGE5_GENERATION_LIFECYCLE_LEDGER.generations.flatMap(
  (generation) => generation.expectedArtifacts,
)) {
  if (artifact.sha256) {
    candidateArtifactHashes[artifact.path] = createHash("sha256")
      .update(await readFile(path.join(root, artifact.path)))
      .digest("hex");
  }
}
const valid = validateStage5GenerationLifecycleLedger(
  candidateArtifactPaths,
  candidateArtifactHashes,
);
assert.equal(valid.result, "PASS", valid.errors.join("; "));
assert.equal(valid.entryCount, 17);
const final22 = STAGE5_GENERATION_LIFECYCLE_LEDGER.generations.find(
  (generation) => generation.candidate === "FINAL-22",
);
assert.equal(final22.lifecycleState, "REJECTED_PRE_CI");
assert.equal(final22.ciStatus, "NOT_RUN");
assert(final22.expectedArtifacts.every((artifact) => artifact.requirement === "FORBIDDEN"));
const final23 = STAGE5_GENERATION_LIFECYCLE_LEDGER.generations.find(
  (generation) => generation.candidate === "FINAL-23",
);
assert.equal(final23.lifecycleState, "FROZEN_REJECTED");
assert.equal(final23.ciStatus, "PASS");
assert(final23.expectedArtifacts.every((artifact) => artifact.requirement === "REQUIRED"));
const final24 = STAGE5_GENERATION_LIFECYCLE_LEDGER.generations.find(
  (generation) => generation.candidate === "FINAL-24",
);
assert.equal(final24.lifecycleState, "FROZEN_REJECTED");
assert.equal(final24.ciStatus, "PASS");
assert(final24.expectedArtifacts.every((artifact) => artifact.requirement === "REQUIRED"));
const final25 = STAGE5_GENERATION_LIFECYCLE_LEDGER.generations.find(
  (generation) => generation.candidate === "FINAL-25",
);
assert.equal(final25.lifecycleState, "PREPARING");
assert(final25.expectedArtifacts.every((artifact) => artifact.requirement === "OPTIONAL"));

const final18 = STAGE5_GENERATION_LIFECYCLE_LEDGER.generations.find(
  (generation) => generation.candidate === "FINAL-18",
);
assert.equal(final18.lifecycleState, "REJECTED_PRE_CI");
assert.equal(final18.ciStatus, "NOT_RUN");
assert.equal(final18.validationStatus, "NOT_CREATED");
assert.equal(final18.freezeStatus, "NOT_CREATED");
assert(
  candidateArtifactPaths.includes(
    "docs/reviews/phase-1-m1/STAGE_5_FINAL_17_CANDIDATE_VALIDATION.md",
  ),
);
assert(
  !candidateArtifactPaths.includes(
    "docs/reviews/phase-1-m1/STAGE_5_FINAL_18_CANDIDATE_VALIDATION.md",
  ),
);
assert(
  !candidateArtifactPaths.includes("docs/reviews/phase-1-m1/STAGE_5_FINAL_18_CANDIDATE_FREEZE.md"),
);

const requiredMissing = candidateArtifactPaths.filter(
  (artifactPath) =>
    artifactPath !== "docs/reviews/phase-1-m1/STAGE_5_FINAL_9_CANDIDATE_VALIDATION.md",
);
assert.match(
  validateStage5GenerationLifecycleLedger(requiredMissing, candidateArtifactHashes).errors.join(
    "; ",
  ),
  /missing required artifact/u,
);

const notApplicableMissing = validateStage5GenerationLifecycleLedger(
  candidateArtifactPaths,
  candidateArtifactHashes,
);
assert.equal(notApplicableMissing.result, "PASS");

const fabricatedHistorical = validateStage5GenerationLifecycleLedger(
  [...candidateArtifactPaths, "docs/reviews/phase-1-m1/STAGE_5_FINAL_18_CANDIDATE_VALIDATION.md"],
  candidateArtifactHashes,
);
assert.match(fabricatedHistorical.errors.join("; "), /unexpected forbidden artifact/u);

const duplicateGeneration = globalThis.structuredClone(STAGE5_GENERATION_LIFECYCLE_LEDGER);
duplicateGeneration.generations.push(
  globalThis.structuredClone(duplicateGeneration.generations.at(-1)),
);
assert.match(
  validateStage5GenerationLifecycleLedger(
    candidateArtifactPaths,
    candidateArtifactHashes,
    duplicateGeneration,
  ).errors.join("; "),
  /duplicate generation entry/u,
);

const invalidTransition = globalThis.structuredClone(STAGE5_GENERATION_LIFECYCLE_LEDGER);
invalidTransition.generations.find((generation) => generation.candidate === "FINAL-18").ciStatus =
  "PASS";
assert.match(
  validateStage5GenerationLifecycleLedger(
    candidateArtifactPaths,
    candidateArtifactHashes,
    invalidTransition,
  ).errors.join("; "),
  /invalid REJECTED_PRE_CI transition/u,
);

const predecessorGap = globalThis.structuredClone(STAGE5_GENERATION_LIFECYCLE_LEDGER);
predecessorGap.generations = predecessorGap.generations.filter(
  (generation) => generation.candidate !== "FINAL-18",
);
assert.match(
  validateStage5GenerationLifecycleLedger(
    candidateArtifactPaths,
    candidateArtifactHashes,
    predecessorGap,
  ).errors.join("; "),
  /predecessor gap/u,
);

const invalidPredecessor = globalThis.structuredClone(STAGE5_GENERATION_LIFECYCLE_LEDGER);
invalidPredecessor.generations.find(
  (generation) => generation.candidate === "FINAL-20",
).predecessor = "FINAL-18";
assert.match(
  validateStage5GenerationLifecycleLedger(
    candidateArtifactPaths,
    candidateArtifactHashes,
    invalidPredecessor,
  ).errors.join("; "),
  /invalid predecessor/u,
);

const wrongHash = {
  ...candidateArtifactHashes,
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_20_CANDIDATE_FREEZE.json": "0".repeat(64),
};
assert.match(
  validateStage5GenerationLifecycleLedger(candidateArtifactPaths, wrongHash).errors.join("; "),
  /wrong hash/u,
);

const final20 = STAGE5_GENERATION_LIFECYCLE_LEDGER.generations.find(
  (generation) => generation.candidate === "FINAL-20",
);
assert.deepEqual(
  {
    lifecycleState: final20.lifecycleState,
    predecessor: final20.predecessor,
    ciStatus: final20.ciStatus,
    validationStatus: final20.validationStatus,
    freezeStatus: final20.freezeStatus,
    reviewStatus: final20.reviewStatus,
    closureStatus: final20.closureStatus,
    hashes: final20.expectedArtifacts.map((artifact) => artifact.sha256),
  },
  {
    lifecycleState: "FROZEN_REJECTED",
    predecessor: "FINAL-19",
    ciStatus: "PASS",
    validationStatus: "CREATED",
    freezeStatus: "VERIFIED",
    reviewStatus: "NOT_RUN",
    closureStatus: "NOT_CLOSED",
    hashes: [
      "3bb32b315298fcbcdab45d20f38f59a5a31401ed4e08c863faf7f61ad9ac11e9",
      "c1f43d4abea1df95bfc12434168ada8a66c3d84161d89afbde7a508fff3af0fa",
    ],
  },
);

console.log(
  JSON.stringify({
    result: "PASS",
    ledgerEntries: valid.entryCount,
    missingRequiredFails: true,
    nonApplicableAbsencePasses: true,
    fabricatedUnexpectedDetected: true,
    duplicateGenerationFails: true,
    invalidTransitionFails: true,
    predecessorGapFails: true,
    invalidPredecessorFails: true,
    wrongHashFails: true,
    final18RejectedPreValidationAccepted: true,
    final20HistoricalRecordExact: true,
  }),
);
