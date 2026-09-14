import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { isProductionSourcePath } from "../architecture/production-source-discovery.mjs";

const root = process.cwd();
const mode = process.argv[2];
if (mode !== "--write" && mode !== "--check") {
  throw new Error("Expected --write or --check");
}

const mutableDirectories = ["apps", "packages", "tooling", "deploy", ".github"];
const mutableRootFiles = [
  "eslint.config.mjs",
  "package.json",
  "playwright.config.ts",
  "pnpm-workspace.yaml",
  "prettier.config.mjs",
  "tsconfig.base.json",
  "tsconfig.json",
  "vitest.workspace.ts",
];
const supportedExtensions = new Set([".css", ".html", ".json", ".yaml", ".yml"]);
const skippedDirectories = new Set(["coverage", "dist", "node_modules", ".vite"]);
const skippedPaths = new Set(["deploy/manifests/schema"]);

const manifest = await readFile(
  path.join(root, "docs/reviews/PHASE_0_ACCEPTED_BASELINE.md"),
  "utf8",
);
const protectedPaths = new Set(
  manifest.split(/\r?\n/).flatMap((line) => {
    if (!line.startsWith("|") || !line.endsWith("|")) return [];
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replace(/^`|`$/g, ""));
    return cells.length >= 2 && /^[0-9a-f]{64}$/.test(cells[1]) ? [cells[0]] : [];
  }),
);

const files = [...mutableRootFiles];
const walk = async (relativeDirectory) => {
  const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name) && !skippedPaths.has(relativePath)) {
        await walk(relativePath);
      }
    } else if (
      isProductionSourcePath(relativePath) ||
      supportedExtensions.has(path.extname(entry.name))
    ) {
      files.push(relativePath);
    }
  }
};
for (const directory of mutableDirectories) await walk(directory);

const uniqueFiles = [...new Set(files)].sort();
const protectedOverlap = uniqueFiles.filter((filePath) => protectedPaths.has(filePath));
if (protectedOverlap.length !== 0) {
  throw new Error(`Formatter target overlaps protected baseline: ${protectedOverlap.join(", ")}`);
}

const result = spawnSync("pnpm", ["exec", "prettier", mode, ...uniqueFiles], {
  cwd: root,
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(
  JSON.stringify({
    schemaVersion: 1,
    result: "PASS",
    mode,
    filesChecked: uniqueFiles.length,
    protectedBaselineFiles: protectedPaths.size,
    protectedOverlap: [],
  }),
);
