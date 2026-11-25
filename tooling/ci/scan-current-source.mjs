// Steady-state sensitive-data gate for the current tracked source tree (ADR-015).
// Every scanner finding must match a reviewed entry in current-source-findings.json by
// exact path + rule + SHA-256 of the line bytes. Unclassified findings and stale entries fail.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import { scanSensitiveFiles } from "./sensitive-data-scanner.mjs";

const SCOPED_DIRECTORIES = [
  "apps",
  "packages",
  "migrations",
  "deploy",
  "tests",
  "tooling",
  ".github",
];
const BINARY_EXTENSION = /\.(?:png|jpe?g|gif|ico|webp|woff2?|ttf|gz|tgz|tar|zip|pdf)$/iu;
export const FINDINGS_PATH = "tooling/ci/current-source-findings.json";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const keyOf = ({ path: file, rule, lineSha256 }) => `${file}\0${rule}\0${lineSha256}`;

export const listCurrentSourceFiles = (root) =>
  execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter(
      (file) =>
        (!file.includes("/") || SCOPED_DIRECTORIES.some((dir) => file.startsWith(`${dir}/`))) &&
        file !== FINDINGS_PATH &&
        !BINARY_EXTENSION.test(file),
    )
    .sort();

export const evaluateCurrentSource = async ({ root, files, classifiedEntries }) => {
  const scan = await scanSensitiveFiles({ root, files });
  const lineCache = new Map();
  const lineSha256For = async (file, line) => {
    if (!lineCache.has(file)) {
      lineCache.set(file, (await readFile(path.join(root, file), "utf8")).split(/\r?\n/u));
    }
    return sha256(lineCache.get(file)[line - 1] ?? "");
  };
  const classified = new Set(classifiedEntries.map(keyOf));
  const matched = new Set();
  const unclassified = [];
  for (const finding of scan.findings) {
    const key = keyOf({
      path: finding.file,
      rule: finding.rule,
      lineSha256: await lineSha256For(finding.file, finding.line),
    });
    if (classified.has(key)) matched.add(key);
    else unclassified.push({ file: finding.file, line: finding.line, rule: finding.rule });
  }
  const stale = classifiedEntries
    .filter((entry) => !matched.has(keyOf(entry)))
    .map(({ path: file, rule }) => ({ file, rule }));
  return {
    result: unclassified.length === 0 && stale.length === 0 ? "PASS" : "FAIL",
    filesScanned: files.length,
    scopeAggregateSha256: scan.scopeAggregateSha256,
    classifiedFindingCount: matched.size,
    unclassified,
    stale,
  };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const { entries } = JSON.parse(await readFile(path.join(root, FINDINGS_PATH), "utf8"));
  const files = listCurrentSourceFiles(root);
  const outcome = await evaluateCurrentSource({ root, files, classifiedEntries: entries });
  process.stdout.write(`${JSON.stringify({ phase: "CURRENT_SOURCE", ...outcome }, null, 2)}\n`);
  if (outcome.result !== "PASS") process.exitCode = 1;
}
