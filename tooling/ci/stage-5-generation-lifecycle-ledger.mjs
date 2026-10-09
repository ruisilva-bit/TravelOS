import assert from "node:assert/strict";

import ledger from "./stage-5-generation-lifecycle-ledger.json" with { type: "json" };

const CANDIDATE_PATTERN = /^FINAL-(\d+)$/u;
const LIFECYCLE_STATES = new Set([
  "REJECTED_PRE_CI",
  "CI_FAILED",
  "CI_PASSED_PRE_FREEZE",
  "FROZEN_REJECTED",
  "PREPARING",
  "CLOSED",
]);
const ARTIFACT_REQUIREMENTS = new Set(["REQUIRED", "FORBIDDEN", "OPTIONAL"]);

export const STAGE5_GENERATION_LIFECYCLE_LEDGER = ledger;

export const validateStage5GenerationLifecycleLedger = (
  candidateArtifactPaths = [],
  candidateArtifactHashes,
  manifest = STAGE5_GENERATION_LIFECYCLE_LEDGER,
) => {
  const errors = [];
  const fail = (message) => errors.push(message);
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.generations)) {
    return { result: "FAIL", errors: ["invalid lifecycle ledger schema"] };
  }
  if (!manifest.chainAnchor || typeof manifest.chainAnchor.candidate !== "string") {
    fail("missing lifecycle chain anchor");
  }

  const entries = manifest.generations;
  const candidates = new Set();
  const expectedArtifacts = new Map();
  for (const artifact of manifest.chainAnchor.expectedArtifacts ?? []) {
    if (expectedArtifacts.has(artifact.path))
      fail(`duplicate expected artifact path: ${artifact.path}`);
    expectedArtifacts.set(artifact.path, {
      ...artifact,
      candidate: manifest.chainAnchor.candidate,
    });
  }
  let previous = manifest.chainAnchor?.candidate;
  let previousNumber = Number(CANDIDATE_PATTERN.exec(previous ?? "")?.[1]);

  for (const entry of entries) {
    const parsed = CANDIDATE_PATTERN.exec(entry?.candidate ?? "");
    if (!parsed) {
      fail(`invalid candidate identifier: ${entry?.candidate}`);
      continue;
    }
    const candidateNumber = Number(parsed[1]);
    if (candidates.has(entry.candidate)) fail(`duplicate generation entry: ${entry.candidate}`);
    candidates.add(entry.candidate);
    if (candidateNumber !== previousNumber + 1) {
      fail(`predecessor gap before ${entry.candidate}`);
    }
    if (entry.predecessor !== previous) {
      fail(`invalid predecessor for ${entry.candidate}`);
    }
    if (!LIFECYCLE_STATES.has(entry.lifecycleState)) {
      fail(`invalid lifecycle state for ${entry.candidate}`);
    }

    const state = entry.lifecycleState;
    const ci = entry.ciStatus;
    if (state === "REJECTED_PRE_CI" && (ci !== "NOT_RUN" || entry.freezeStatus !== "NOT_CREATED")) {
      fail(`invalid REJECTED_PRE_CI transition for ${entry.candidate}`);
    }
    if (state === "CI_FAILED" && (ci !== "FAIL" || entry.closureStatus === "CLOSED")) {
      fail(`invalid CI_FAILED transition for ${entry.candidate}`);
    }
    if (
      state === "CI_PASSED_PRE_FREEZE" &&
      (ci !== "PASS" ||
        entry.validationStatus !== "CREATED" ||
        entry.freezeStatus !== "NOT_CREATED")
    ) {
      fail(`invalid CI_PASSED_PRE_FREEZE transition for ${entry.candidate}`);
    }
    if (
      state === "FROZEN_REJECTED" &&
      (!new Set(["VERIFIED", "RETROSPECTIVE_ONLY"]).has(entry.freezeStatus) ||
        entry.closureStatus === "CLOSED")
    ) {
      fail(`invalid FROZEN_REJECTED transition for ${entry.candidate}`);
    }
    if (
      state === "PREPARING" &&
      (ci !== "NOT_RUN" || entry.reviewStatus !== "NOT_RUN" || entry.closureStatus !== "NOT_CLOSED")
    ) {
      fail(`invalid PREPARING transition for ${entry.candidate}`);
    }
    if (
      state === "CLOSED" &&
      (ci !== "PASS" ||
        entry.validationStatus !== "CREATED" ||
        entry.freezeStatus !== "VERIFIED" ||
        entry.reviewStatus !== "GO" ||
        entry.closureStatus !== "CLOSED")
    ) {
      fail(`invalid CLOSED transition for ${entry.candidate}`);
    }

    if (!Array.isArray(entry.expectedArtifacts)) {
      fail(`expectedArtifacts missing for ${entry.candidate}`);
    } else {
      for (const artifact of entry.expectedArtifacts) {
        if (
          !artifact ||
          typeof artifact.path !== "string" ||
          !ARTIFACT_REQUIREMENTS.has(artifact.requirement)
        ) {
          fail(`invalid expected artifact in ${entry.candidate}`);
          continue;
        }
        if (expectedArtifacts.has(artifact.path))
          fail(`duplicate expected artifact path: ${artifact.path}`);
        expectedArtifacts.set(artifact.path, { ...artifact, candidate: entry.candidate });
        if (artifact.sha256 && !/^[a-f0-9]{64}$/u.test(artifact.sha256)) {
          fail(`invalid expected hash for ${artifact.path}`);
        }
      }
    }
    previous = entry.candidate;
    previousNumber = candidateNumber;
  }

  const actual = new Set();
  for (const artifactPath of candidateArtifactPaths) {
    if (actual.has(artifactPath)) fail(`duplicate actual candidate artifact: ${artifactPath}`);
    actual.add(artifactPath);
    if (!expectedArtifacts.has(artifactPath))
      fail(`unexpected candidate artifact: ${artifactPath}`);
  }
  for (const [artifactPath, expected] of expectedArtifacts) {
    const exists = actual.has(artifactPath);
    if (expected.requirement === "REQUIRED" && !exists)
      fail(`missing required artifact: ${artifactPath}`);
    if (expected.requirement === "FORBIDDEN" && exists)
      fail(`unexpected forbidden artifact: ${artifactPath}`);
    const actualHash = candidateArtifactHashes?.[artifactPath];
    if (exists && expected.sha256 && candidateArtifactHashes && actualHash !== expected.sha256) {
      fail(`wrong hash for ${artifactPath}`);
    }
  }

  return { result: errors.length === 0 ? "PASS" : "FAIL", errors, entryCount: entries.length };
};

export const assertValidStage5GenerationLifecycleLedger = (...args) => {
  const result = validateStage5GenerationLifecycleLedger(...args);
  assert.equal(result.result, "PASS", result.errors.join("; "));
  return result;
};
