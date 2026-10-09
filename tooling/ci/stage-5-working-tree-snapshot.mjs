import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (root, args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });

export const captureStage5WorkingTreeSnapshot = async ({ root, excludedPaths = [] }) => {
  const candidateRoot = path.resolve(root);
  const exclusions = new Set(excludedPaths);
  for (const relativePath of exclusions) {
    if (
      typeof relativePath !== "string" ||
      path.isAbsolute(relativePath) ||
      relativePath.split(path.sep).includes("..")
    ) {
      throw new Error(`Invalid Stage 5 snapshot exclusion: ${relativePath}`);
    }
  }
  const statusEntries = git(candidateRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "-z",
  ])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((entry) => !exclusions.has(entry.slice(3)))
    .toSorted();
  const status = Buffer.from(statusEntries.length ? `${statusEntries.join("\0")}\0` : "");
  const diff = git(candidateRoot, ["diff", "HEAD", "--binary", "--"]);
  const untrackedPaths = git(candidateRoot, ["ls-files", "--others", "--exclude-standard", "-z"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((relativePath) => !exclusions.has(relativePath))
    .toSorted();
  const untrackedFiles = [];
  for (const relativePath of untrackedPaths) {
    const fullPath = path.join(candidateRoot, relativePath);
    const metadata = await lstat(fullPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Stage 5 snapshot input must be a regular file: ${relativePath}`);
    }
    const bytes = await readFile(fullPath);
    untrackedFiles.push({ path: relativePath, bytes: bytes.length, sha256: hash(bytes) });
  }
  return {
    commit: git(candidateRoot, ["rev-parse", "HEAD"]).toString("utf8").trim(),
    statusPorcelainBytes: status.length,
    statusPorcelainSha256: hash(status),
    trackedDiffFromHeadBytes: diff.length,
    trackedDiffFromHeadSha256: hash(diff),
    untrackedFiles,
    untrackedFileCount: untrackedFiles.length,
  };
};
