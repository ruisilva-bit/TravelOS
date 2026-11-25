import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verifyBaseline, verifyPredecessor } from "./candidate.mjs";

// This verifies inherited bytes against the accepted Stage 9 commit/artifact.
// It does not rerun historical one-shot CI or relabel predecessor-bound dynamic
// verifiers as successor-compatible. Their branch guards remain unchanged.
export async function verifyInheritedBaseline(root) {
  const predecessor = await verifyPredecessor(
    root,
    path.join(root, ".hermes/state/stage9-gen11-artifact.tar.gz"),
  );
  const baseline = await verifyBaseline(root);
  assert.equal(baseline.predecessor, predecessor.commit);
  assert.deepEqual(baseline.allowedExistingFileDeltas, []);
  return {
    result: "PASS",
    scope: "ACCEPTED_PREDECESSOR_BYTES_AND_ARCHIVE_ONLY",
    predecessor,
    matchedFiles: baseline.matched,
    historicalCiRerun: false,
    currentStageCiQualification: false,
    stage11Actions: 0,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    assert.equal(process.argv.length, 2, "No command-line overrides accepted");
    console.log(JSON.stringify(await verifyInheritedBaseline(process.cwd())));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
