import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { captureSource } from "./candidate.mjs";
import { verifyInheritedBaseline } from "./predecessor-baseline-adapter.mjs";
import { BRANCH, PREDECESSOR } from "./constants.mjs";

const historicalLocal = new Set([
  ".hermes/phase0-sources.json",
  ".hermes/plans/2026-08-14_105849-travelos-phase-1-m1-implementation.md",
  ".hermes/plans/phase-0-architecture-planning.md",
]);
const additions = [
  /^docs\/implementation\/M1_STAGE_10_[A-Z0-9_]+\.md$/u,
  /^docs\/reviews\/phase-1-m1\/stage-10\//u,
  /^tooling\/ci\/stage-10\//u,
  /^tooling\/deployment\/(?:stage10-|test-stage10-|run-stage10-|travelos-stage10-)[^/]+$/u,
  /^tooling\/deployment\/\.gitignore$/u,
  /^tooling\/database\/run-stage-10-postgres-disposable\.mjs$/u,
  /^tooling\/testing\/vitest\.stage-10\.config\.ts$/u,
];

export function validateSourceScope(source, acceptedPaths) {
  const accepted = new Set(acceptedPaths);
  assert.equal(accepted.size, acceptedPaths.length, "Duplicate accepted path");
  const rows = new Map();
  for (const row of source.files) {
    assert.ok(typeof row.path === "string" && !path.posix.isAbsolute(row.path));
    assert.equal(path.posix.normalize(row.path), row.path);
    assert.ok(!row.path.split("/").includes("..") && !row.path.includes("\\"));
    assert.ok(![...row.path].some((c) => c.codePointAt(0) < 32 || c.codePointAt(0) === 127));
    assert.match(row.sha256, /^[a-f0-9]{64}$/u);
    assert.ok(Number.isSafeInteger(row.bytes) && row.bytes >= 0);
    assert.ok(!rows.has(row.path), "Duplicate source path");
    assert.ok(!row.path.startsWith(".hermes/"), "Local state is not candidate source");
    assert.ok(
      accepted.has(row.path) || additions.some((pattern) => pattern.test(row.path)),
      "Unapproved Stage 10 addition",
    );
    rows.set(row.path, row);
  }
  for (const name of accepted)
    assert.ok(rows.has(name) || historicalLocal.has(name), "Accepted evidence/source omitted");
  return {
    result: "PASS",
    inheritedSourceFiles: acceptedPaths.filter((name) => rows.has(name)).length,
    inheritedLocalExclusions: acceptedPaths.filter((name) => historicalLocal.has(name)),
    newStage10Files: [...rows.keys()].filter((name) => !accepted.has(name)).length,
    scope: "COMPLETE_CURRENT_SOURCE_AND_INHERITED_EVIDENCE_PATH_COVERAGE_NOT_PRIVACY_ACCEPTANCE",
  };
}

export async function verifyCurrentSourceScope({ root, source }) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(git("branch", "--show-current").trim(), BRANCH);
  const baseline = await verifyInheritedBaseline(root);
  const accepted = git("ls-tree", "-r", "--name-only", "-z", PREDECESSOR.commit)
    .split("\0")
    .filter(Boolean);
  const report = validateSourceScope(source, accepted);
  assert.deepEqual(await captureSource(root), source, "Source scope/content drift");
  return {
    ...report,
    matchedPredecessorFiles: baseline.matchedFiles,
    predecessor: PREDECESSOR.commit,
  };
}
