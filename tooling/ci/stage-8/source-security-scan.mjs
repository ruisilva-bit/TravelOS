import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import { scanSensitiveFiles } from "../sensitive-data-scanner.mjs";
import { PREDECESSOR } from "./source-snapshot.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Exact, reviewed synthetic inputs and runtime-only credential references; never broaden by path or rule.
export const STAGE8_REVIEWED_SENSITIVE_FINDINGS = Object.freeze(
  [
    { path: "apps/admin-api/test/correlation.test.ts", rule: "email-address", line: 17 },
    { path: "apps/worker/src/main.ts", rule: "high-entropy-secret-assignment", line: 71 },
    { path: "apps/worker/src/main.ts", rule: "secret-assignment", line: 71 },
    { path: "packages/observability/test/telemetry.test.ts", rule: "email-address", line: 29 },
    { path: "packages/observability/test/telemetry.test.ts", rule: "secret-assignment", line: 59 },
    { path: "packages/observability/test/telemetry.test.ts", rule: "email-address", line: 60 },
    { path: "packages/observability/test/telemetry.test.ts", rule: "email-address", line: 73 },
    { path: "tests/integration/stage-8-postgresql.test.ts", rule: "email-address", line: 284 },
    { path: "tests/integration/stage-8-postgresql.test.ts", rule: "email-address", line: 703 },
    {
      path: "tooling/ci/stage-8/controlled-worker.mjs",
      rule: "high-entropy-secret-assignment",
      line: 210,
    },
    { path: "tooling/ci/stage-8/controlled-worker.mjs", rule: "secret-assignment", line: 210 },
    {
      path: "tooling/ci/stage-8/runtime-acceptance.mjs",
      rule: "high-entropy-secret-assignment",
      line: 93,
    },
    { path: "tooling/ci/stage-8/runtime-acceptance.mjs", rule: "secret-assignment", line: 93 },
    {
      path: "tooling/ci/stage-8/runtime-acceptance.mjs",
      rule: "high-entropy-secret-assignment",
      line: 115,
    },
    { path: "tooling/ci/stage-8/runtime-acceptance.mjs", rule: "secret-assignment", line: 115 },
  ].map((entry) => Object.freeze(entry)),
);

const validateRelativeFiles = async (root, files) => {
  assert.ok(
    Array.isArray(files) && files.length > 0,
    "Sensitive-data scan scope must not be empty",
  );
  const unique = [...new Set(files)].toSorted((left, right) => left.localeCompare(right));
  assert.equal(unique.length, files.length, "Sensitive-data scan scope contains duplicate paths");
  for (const file of unique) {
    assert.equal(typeof file, "string");
    assert.ok(file.length > 0 && !path.posix.isAbsolute(file), `Invalid relative path: ${file}`);
    assert.equal(path.posix.normalize(file), file, `Non-canonical relative path: ${file}`);
    assert.ok(!file.split("/").includes(".."), `Path traversal in scan scope: ${file}`);
    const metadata = await lstat(path.join(root, file));
    assert.ok(
      metadata.isFile() && !metadata.isSymbolicLink(),
      `Scan input must be a regular file: ${file}`,
    );
  }
  return unique;
};

export const scanStage8SensitiveFiles = async ({ root = repositoryRoot, files }) => {
  const workspace = path.resolve(root);
  const selected = await validateRelativeFiles(workspace, files);
  const selectedSet = new Set(selected);
  const reviewedAllowlist = STAGE8_REVIEWED_SENSITIVE_FINDINGS.filter((entry) =>
    selectedSet.has(entry.path),
  );
  const unfiltered = await scanSensitiveFiles({ root: workspace, files: selected });
  const staleAllowlist = reviewedAllowlist.filter(
    (entry) =>
      !unfiltered.findings.some(
        (finding) =>
          finding.file === entry.path && finding.rule === entry.rule && finding.line === entry.line,
      ),
  );
  assert.deepEqual(
    staleAllowlist,
    [],
    "A reviewed exception no longer matches its exact source line",
  );

  const scan = await scanSensitiveFiles({
    root: workspace,
    files: selected,
    allowlist: reviewedAllowlist,
  });
  return {
    schemaVersion: 1,
    scanner: "travelos-sensitive-data-scanner-v1",
    result: scan.result,
    filesScanned: scan.fileManifest.length,
    scopeSerialization: scan.scopeSerialization,
    scopeAggregateSha256: scan.scopeAggregateSha256,
    files: scan.fileManifest,
    findingCount: scan.findings.length,
    allowlistedFindingCount: scan.allowlistedFindingCount,
    reviewedAllowlist,
    findings: scan.findings,
    stage9Actions: 0,
  };
};

export const collectStage8CandidateFiles = async ({
  root = repositoryRoot,
  excludeFiles = [],
} = {}) => {
  const workspace = path.resolve(root);
  execFileSync("git", ["merge-base", "--is-ancestor", PREDECESSOR, "HEAD"], {
    cwd: workspace,
    stdio: "ignore",
  });
  const tracked = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", "-z", PREDECESSOR, "--"],
    { cwd: workspace, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  ).split("\0");
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: workspace,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).split("\0");
  const excluded = new Set(excludeFiles);
  const files = [...new Set([...tracked, ...untracked])]
    .filter((file) => file && !file.startsWith(".hermes/") && !excluded.has(file))
    .toSorted((left, right) => left.localeCompare(right));
  await validateRelativeFiles(workspace, files);
  return files;
};

const writeExclusiveOrMatch = async (file, bytes) => {
  try {
    const metadata = await lstat(file);
    assert.ok(
      metadata.isFile() && !metadata.isSymbolicLink(),
      `Report must be a regular file: ${file}`,
    );
    assert.deepEqual(
      await readFile(file),
      bytes,
      `Refusing to overwrite divergent scan report: ${file}`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: "wx" });
  }
};

const argumentValue = (prefix) =>
  process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);

const main = async () => {
  const root = path.resolve(argumentValue("--root=") ?? repositoryRoot);
  const output = argumentValue("--output=");
  let outputPath;
  let outputRelative;
  if (output) {
    outputPath = path.resolve(root, output);
    outputRelative = path.relative(root, outputPath).split(path.sep).join("/");
    assert.ok(
      !outputRelative.startsWith("../") && outputRelative !== "..",
      "Output must stay within repository root",
    );
  }
  const files = await collectStage8CandidateFiles({
    root,
    excludeFiles: outputRelative ? [outputRelative] : [],
  });
  const report = await scanStage8SensitiveFiles({ root, files });
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  if (outputPath) {
    await writeExclusiveOrMatch(outputPath, bytes);
    process.stdout.write(
      `${JSON.stringify({
        result: report.result,
        filesScanned: report.filesScanned,
        findingCount: report.findingCount,
        allowlistedFindingCount: report.allowlistedFindingCount,
        scopeAggregateSha256: report.scopeAggregateSha256,
        reportPath: outputRelative,
        reportSha256: sha256(bytes),
        stage9Actions: 0,
      })}\n`,
    );
  } else {
    process.stdout.write(bytes);
  }
  if (report.result !== "PASS") process.exitCode = 1;
};

if (process.argv[1]) {
  const [entry, moduleFile] = await Promise.all([
    realpath(process.argv[1]),
    realpath(fileURLToPath(import.meta.url)),
  ]);
  if (entry === moduleFile) await main();
}
