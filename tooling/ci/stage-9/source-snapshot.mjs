import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import { hashFile, jsonBytes, sha256 } from "./artifact-integrity.mjs";
import { STAGE9_BRANCH, STAGE9_PREDECESSOR, STAGE9_STAGE } from "./constants.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const stage9Plan = "docs/superpowers/plans/2026-10-26-stage-9-first-usable-admin-portal.md";
export const selectedPath = (file) =>
  !file.startsWith(".hermes/") &&
  (!file.includes("/") ||
    /^(apps|packages|migrations|tooling|tests|deploy|\.github|\.taste-skill)\//u.test(file) ||
    file === stage9Plan ||
    file === "docs/superpowers/specs/2026-11-02-stage9-staff-invitation-design.md" ||
    file === "docs/superpowers/plans/2026-11-02-stage9-staff-invitation-implementation-plan.md" ||
    file === "docs/reviews/phase-1-m1/STAGE_9_SUCCESSOR_BASELINE_GEN11.json" ||
    /^docs\/(adr\/|[A-Z_]+\.md$)/u.test(file));

export const sourceSnapshot = async (root = repositoryRoot) => {
  const workspace = path.resolve(root);
  const branch = execFileSync("git", ["branch", "--show-current"], {
    cwd: workspace,
    encoding: "utf8",
  }).trim();
  assert.equal(branch, STAGE9_BRANCH);
  execFileSync("git", ["merge-base", "--is-ancestor", STAGE9_PREDECESSOR, "HEAD"], {
    cwd: workspace,
    stdio: "ignore",
  });
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: workspace,
    encoding: "utf8",
  }).trim();
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: workspace, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  )
    .split("\0")
    .filter(Boolean)
    .filter(selectedPath)
    .toSorted();
  assert.ok(files.length > 0, "Candidate source snapshot must not be empty");
  assert.equal(
    new Set(files).size,
    files.length,
    "Candidate source snapshot contains duplicate paths",
  );

  const rows = [];
  for (const file of files) {
    const metadata = await lstat(path.join(workspace, file));
    assert.ok(
      metadata.isFile() && !metadata.isSymbolicLink(),
      `Non-file candidate source: ${file}`,
    );
    rows.push({ path: file, ...(await hashFile(path.join(workspace, file))) });
  }
  const snapshot = {
    schemaVersion: 1,
    stage: STAGE9_STAGE,
    predecessor: STAGE9_PREDECESSOR,
    branch,
    sourceCommit,
    serialization: "SHA-256 of UTF-8 JSON two-space indentation with final LF",
    files: rows,
    stage10Actions: 0,
  };
  const bytes = Buffer.from(jsonBytes(snapshot));
  return { snapshot, bytes, sha256: sha256(bytes) };
};

export const verifySourceSnapshot = async (root, file) => {
  const expected = await readFile(file);
  const actual = await sourceSnapshot(root);
  assert.deepEqual(actual.bytes, expected, "Candidate source drift");
  return actual.sha256;
};
