import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PREDECESSOR } from "./constants.mjs";
import { regularBytes, sha256 } from "./io.mjs";
import path from "node:path";
import {
  STAGE6_BASELINE_PATH,
  validateStage6SuccessorManifest,
  stage6OutputPath,
} from "../stage-6-successor-baseline.mjs";
import { verifyCurrentSourceScope } from "./source-scope.mjs";

export const ACCEPTED_STAGE6 = Object.freeze({
  tag: "travelos-phase-1-m1-stage-6-gen07-revision-04-go",
  commit: "6242e023953ccb8fe883bff97a0d62e64af8b66a",
});
export function assertStage6Lineage(tagCommit, ancestorExitCode) {
  assert.equal(tagCommit, ACCEPTED_STAGE6.commit, "Accepted Stage 6 tag moved");
  assert.equal(ancestorExitCode, 0, "Accepted Stage 6 must precede accepted Stage 9");
}
// Validate the original manifest against ORIGINAL Git blobs, not mutable Stage
// 10 replacements. Current source/branch scope is verified separately below.
export async function verifyAcceptedStage6Baseline({ root }) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    });
  assertStage6Lineage(git("rev-parse", `${ACCEPTED_STAGE6.tag}^{commit}`).toString().trim(), 0);
  git("merge-base", "--is-ancestor", ACCEPTED_STAGE6.commit, PREDECESSOR.commit);
  const readAccepted = (file) => git("show", `${ACCEPTED_STAGE6.commit}:${file}`);
  // Imported historical validator and its fixture suite must remain exact.
  for (const file of [
    "tooling/ci/stage-6-successor-baseline.mjs",
    "tooling/ci/test-stage-6-successor-baseline.mjs",
  ]) {
    assert.deepEqual(
      await regularBytes(path.join(root, file)),
      readAccepted(file),
      "Historical Stage 6 baseline source changed",
    );
  }
  const bytes = readAccepted(STAGE6_BASELINE_PATH);
  const manifest = JSON.parse(bytes);
  const verified = await validateStage6SuccessorManifest({ manifest, readBytes: readAccepted });
  assert.equal(
    git("rev-parse", `${manifest.predecessor.tag}^{commit}`).toString().trim(),
    manifest.predecessor.commit,
    "Accepted Stage 5 tag moved",
  );
  git("merge-base", "--is-ancestor", manifest.predecessor.commit, ACCEPTED_STAGE6.commit);
  const delta = git(
    "diff",
    "--name-only",
    `${manifest.predecessor.commit}..${ACCEPTED_STAGE6.commit}`,
  )
    .toString()
    .trim()
    .split("\n")
    .filter((file) => !stage6OutputPath(file) && file !== STAGE6_BASELINE_PATH)
    .sort();
  assert.deepEqual(
    delta,
    manifest.sourceFiles.map((row) => row.path),
    "Accepted Stage 6 delta differs from its manifest",
  );
  return {
    ...verified,
    acceptedStage6: ACCEPTED_STAGE6,
    manifestSha256: sha256(bytes),
    scope: "ACCEPTED_STAGE6_HISTORY_NOT_CURRENT_CANDIDATE_QUALIFICATION",
  };
}

export const ACCEPTED_STAGE7 = Object.freeze({
  tag: "travelos-phase-1-m1-stage-7-gen15-go",
  commit: "a57789b6662f0e0c0da5948c20eef6eb1e6bf4ec",
});
export function assertStage7Lineage(tagCommit, ancestorExitCode) {
  assert.equal(tagCommit, ACCEPTED_STAGE7.commit, "Accepted Stage 7 tag moved");
  assert.equal(ancestorExitCode, 0, "Accepted Stage 7 must precede accepted Stage 9");
}
export async function verifySuccessorBaseline({ root, source }) {
  const tag = execFileSync("git", ["rev-parse", `${ACCEPTED_STAGE7.tag}^{commit}`], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
  }).trim();
  // This command throws on a nonancestor or missing object; neither is admitted.
  execFileSync("git", ["merge-base", "--is-ancestor", ACCEPTED_STAGE7.commit, PREDECESSOR.commit], {
    cwd: root,
    timeout: 30000,
    stdio: "pipe",
  });
  assertStage7Lineage(tag, 0);
  const report = await verifyCurrentSourceScope({ root, source });
  return {
    ...report,
    acceptedStage7: ACCEPTED_STAGE7,
    scope: "CURRENT_STAGE10_BASELINE_AND_ACCEPTED_STAGE7_LINEAGE_NOT_CANONICAL_CI",
  };
}
