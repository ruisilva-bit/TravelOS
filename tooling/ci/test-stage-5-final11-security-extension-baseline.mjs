import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE5_FINAL9_REJECTED_TAG,
  STAGE5_FINAL10_REJECTED_TAG,
  STAGE5_FINAL10_PHASE1_BASELINE_EXPECTED_PACKAGE_SHA256,
} from "./stage-5-candidate-contract.mjs";
import {
  STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
  STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS,
} from "./verify-stage-5-security-extension-baseline.mjs";
import { buildStage5Final11SecurityExtensionBaseline } from "./generate-stage-5-final11-security-extension-baseline.mjs";
import { verifyStage5Final10RejectedTaggedBytes } from "./stage-5-final11-finding-lineage.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const serializeRows = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");
const readTagged = (tag, relativePath) =>
  execFileSync("git", ["show", `${tag}:${relativePath}`], {
    cwd: repositoryRoot,
    maxBuffer: 8 * 1024 * 1024,
  });

const predecessorBytes = readTagged(
  STAGE5_FINAL9_REJECTED_TAG,
  STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
);
const previousBaseline = JSON.parse(predecessorBytes.toString("utf8"));
const currentFiles = await Promise.all(
  STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS.map(async (relativePath) => {
    const bytes = await readFile(path.join(repositoryRoot, relativePath));
    return { path: relativePath, bytes, sha256: sha256(bytes) };
  }),
);
const final10Lineage = await verifyStage5Final10RejectedTaggedBytes({ root: repositoryRoot });
const final10PackageSha256 = sha256(readTagged(STAGE5_FINAL10_REJECTED_TAG, "package.json"));
const predecessorVerification = {
  result: "PASS",
  baselineSha256: final10Lineage.phase1Baseline.sha256,
};
const baseline = buildStage5Final11SecurityExtensionBaseline({
  previousBaseline,
  currentFiles,
  final10Lineage,
  final10PackageSha256,
  predecessorVerification,
});

assert.equal(baseline.result, "PASS");
assert.equal(baseline.baselineId, previousBaseline.baselineId);
assert.equal(baseline.lineage.predecessorPhase1ExtensionBaseline.tag, STAGE5_FINAL9_REJECTED_TAG);
assert.equal(baseline.lineage.rejectedFinal10Candidate.tag, STAGE5_FINAL10_REJECTED_TAG);
assert.equal(
  baseline.lineage.rejectedFinal10Candidate.staleBaselinePackageSha256,
  STAGE5_FINAL10_PHASE1_BASELINE_EXPECTED_PACKAGE_SHA256,
);
assert.equal(baseline.lineage.rejectedFinal10Candidate.stage6Actions, 0);
assert.equal(baseline.lineage.final11Generation.candidate, "FINAL-11");
assert.equal(baseline.lineage.final11Generation.stage6Actions, 0);
assert.deepEqual(
  baseline.lineage.final11Generation.protectedPathDeltas.map((entry) => entry.path),
  ["docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md", "package.json"],
);
assert.equal(
  sha256(Buffer.from(serializeRows(baseline.protectedFiles), "utf8")),
  baseline.aggregateSha256,
);
assert.notEqual(final10PackageSha256, STAGE5_FINAL10_PHASE1_BASELINE_EXPECTED_PACKAGE_SHA256);

const unauthorizedPathMutation = currentFiles.map((entry) => ({ ...entry }));
unauthorizedPathMutation.find((entry) => entry.path === "apps/admin-api/src/m1-routes.ts").bytes =
  Buffer.from("unauthorized protected path change");
assert.throws(
  () =>
    buildStage5Final11SecurityExtensionBaseline({
      previousBaseline,
      currentFiles: unauthorizedPathMutation,
      final10Lineage,
      final10PackageSha256,
      predecessorVerification,
    }),
  /unapproved protected-byte delta/u,
);

const alteredFinal10Proof = { ...final10Lineage, invocationCount: 2 };
assert.throws(
  () =>
    buildStage5Final11SecurityExtensionBaseline({
      previousBaseline,
      currentFiles,
      final10Lineage: alteredFinal10Proof,
      final10PackageSha256,
      predecessorVerification,
    }),
  /exact verification of the consumed rejected FINAL-10/u,
);

const alteredPredecessor = JSON.parse(JSON.stringify(previousBaseline));
alteredPredecessor.protectedFiles[0].sha256 = "0".repeat(64);
assert.throws(
  () =>
    buildStage5Final11SecurityExtensionBaseline({
      previousBaseline: alteredPredecessor,
      currentFiles,
      final10Lineage,
      final10PackageSha256,
      predecessorVerification,
    }),
  /predecessor rows with changed paths or aggregate bytes/u,
);

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      candidate: "FINAL-11",
      result: "PASS",
      test: "security-extension-baseline-generation",
      protectedPathCount: baseline.protectedFiles.length,
      permittedDeltaPaths: baseline.lineage.final11Generation.protectedPathDeltas.map(
        (entry) => entry.path,
      ),
      rejectedFinal10InvocationCount: baseline.lineage.rejectedFinal10Candidate.invocationCount,
      stage6Actions: baseline.lineage.final11Generation.stage6Actions,
    },
    null,
    2,
  ),
);
