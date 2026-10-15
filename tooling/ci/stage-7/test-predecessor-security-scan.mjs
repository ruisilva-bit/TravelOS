import assert from "node:assert/strict";
import path from "node:path";
import { STAGE7_BASE_COMMIT } from "../stage-7-successor-baseline.mjs";

let predecessorScan;
try {
  predecessorScan = await import("./scan-predecessor-security.mjs");
} catch {
  predecessorScan = null;
}
assert.ok(predecessorScan, "Stage 7 predecessor security-scan adapter must exist");

const { resolveStage6PredecessorWorktree, runStage7PredecessorSecurityScan } = predecessorScan;
assert.equal(typeof resolveStage6PredecessorWorktree, "function");
assert.equal(typeof runStage7PredecessorSecurityScan, "function");

const predecessorWorktree = path.resolve("/tmp/travelos-stage6-detached");
const matchingWorktrees = [
  {
    path: predecessorWorktree,
    head: STAGE7_BASE_COMMIT,
    detached: true,
    branch: null,
  },
  {
    path: path.resolve("/tmp/travelos-stage7-candidate"),
    head: "a".repeat(40),
    detached: false,
    branch: "refs/heads/phase-1/stage-7",
  },
];
assert.equal(
  resolveStage6PredecessorWorktree({ worktrees: matchingWorktrees }),
  predecessorWorktree,
);
assert.throws(
  () => resolveStage6PredecessorWorktree({ worktrees: matchingWorktrees.slice(1) }),
  /Exactly one detached Stage 6 predecessor worktree/u,
);
assert.throws(
  () =>
    resolveStage6PredecessorWorktree({
      worktrees: [...matchingWorktrees, { ...matchingWorktrees[0], path: "/tmp/duplicate" }],
    }),
  /Exactly one detached Stage 6 predecessor worktree/u,
);

let scannerInvocation;
const scanResult = await runStage7PredecessorSecurityScan({
  root: "/tmp/travelos-stage7-candidate",
  generation: "gen04",
  verifyPredecessor: async ({ root, generation }) => {
    assert.equal(root, "/tmp/travelos-stage7-candidate");
    assert.equal(generation, "gen04");
    return { result: "PASS" };
  },
  readWorktrees: async () => matchingWorktrees,
  runScanner: async (input) => {
    scannerInvocation = input;
    return {
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        result: "PASS",
        phase: "STAGE6_CURRENT_SOURCE",
        findingCount: 0,
      }),
      stderr: "",
    };
  },
});
assert.deepEqual(scannerInvocation, {
  cwd: predecessorWorktree,
  scriptPath: path.join(predecessorWorktree, "tooling/ci/scan-stage-6-current-source.mjs"),
});
assert.equal(scanResult.result, "PASS");
assert.equal(scanResult.predecessorCommit, STAGE7_BASE_COMMIT);
assert.equal(scanResult.scan.phase, "STAGE6_CURRENT_SOURCE");

let forbiddenScanCalls = 0;
await assert.rejects(
  runStage7PredecessorSecurityScan({
    root: "/tmp/travelos-stage7-candidate",
    generation: "gen04",
    verifyPredecessor: async () => ({ result: "FAIL" }),
    readWorktrees: async () => matchingWorktrees,
    runScanner: async () => {
      forbiddenScanCalls += 1;
      return { status: 0, stdout: "{}", stderr: "" };
    },
  }),
  /Stage 6 predecessor verification must pass/u,
);
assert.equal(forbiddenScanCalls, 0);

await assert.rejects(
  runStage7PredecessorSecurityScan({
    root: "/tmp/travelos-stage7-candidate",
    generation: "gen04",
    verifyPredecessor: async () => ({ result: "PASS" }),
    readWorktrees: async () => matchingWorktrees,
    runScanner: async () => ({ status: 1, stdout: "scan failed", stderr: "" }),
  }),
  /Stage 6 predecessor sensitive-data scan failed/u,
);

console.log(
  JSON.stringify({
    result: "PASS",
    cases: 5,
    requiresUniqueDetachedPredecessor: true,
    bindsScannerToImmutableStage6Commit: true,
    failClosedBeforeScan: true,
    stage8Actions: 0,
  }),
);
