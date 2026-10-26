import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { hashFile, jsonBytes, sha256 } from "./artifact-integrity.mjs";

export const PREDECESSOR = "a57789b6662f0e0c0da5948c20eef6eb1e6bf4ec";
export const sourceSnapshot = async (root) => {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  )
    .split("\0")
    .filter(Boolean);
  const selected = [
    ...new Set(
      files.filter(
        (file) =>
          !file.startsWith(".hermes/") &&
          (!file.includes("/") ||
            /^(apps|packages|migrations|tooling|tests|deploy|\.github)\//u.test(file) ||
            file === "docs/implementation/M1_STAGE_8_WORKER_ACTIVITY_OBSERVABILITY.md" ||
            file === "docs/superpowers/plans/stage-8-worker-activity-observability.md" ||
            /^docs\/(adr\/|[A-Z_]+\.md$)/u.test(file)),
      ),
    ),
  ].sort();
  const rows = [];
  for (const file of selected) {
    assert.ok((await lstat(path.join(root, file))).isFile(), `Non-file candidate source: ${file}`);
    rows.push({ path: file, ...(await hashFile(path.join(root, file))) });
  }
  const snapshot = {
    schemaVersion: 1,
    predecessor: PREDECESSOR,
    branch: "phase-1/stage-8",
    serialization: "SHA-256 of UTF-8 JSON two-space indentation with final LF",
    files: rows,
    stage9Actions: 0,
  };
  return { snapshot, bytes: jsonBytes(snapshot), sha256: sha256(jsonBytes(snapshot)) };
};
export const verifySourceSnapshot = async (root, file) => {
  const expected = await readFile(file, "utf8");
  const actual = await sourceSnapshot(root);
  assert.equal(actual.bytes, expected, "Candidate source drift");
  return actual.sha256;
};
