import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import { STAGE9_PREDECESSOR } from "./constants.mjs";
import { scanSensitiveFiles } from "../sensitive-data-scanner.mjs";

export { STAGE9_PREDECESSOR };
const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Exact reviewed synthetic fixtures and Fetch credential-mode strings; never broaden by path or rule.
export const STAGE9_REVIEWED_SENSITIVE_FINDINGS = Object.freeze(
  [
    { path: "apps/admin-web/src/api.ts", rule: "secret-assignment", line: 81 },
    { path: "apps/admin-web/src/api.ts", rule: "secret-assignment", line: 121 },
    { path: "apps/admin-web/src/auth-client.ts", rule: "secret-assignment", line: 23 },
    { path: "apps/admin-web/test/api.test.ts", rule: "secret-assignment", line: 124 },
    { path: "apps/admin-web/test/api.test.ts", rule: "secret-assignment", line: 137 },
    { path: "apps/admin-web/test/api.test.ts", rule: "secret-assignment", line: 179 },
    { path: "apps/admin-web/test/api.test.ts", rule: "secret-assignment", line: 233 },
    { path: "apps/admin-web/test/api.test.ts", rule: "secret-assignment", line: 267 },
    { path: "apps/admin-web/test/api.test.ts", rule: "secret-assignment", line: 272 },
    { path: "apps/admin-web/test/api.test.ts", rule: "secret-assignment", line: 299 },
    ...[226, 257, 303, 318, 403, 754, 847, 862].map((line) => ({
      path: "apps/admin-web/test/app.test.tsx",
      rule: "secret-assignment",
      line,
    })),
    ...[164, 178, 198, 291, 302, 356].map((line) => ({
      path: "apps/admin-web/test/app.test.tsx",
      rule: "email-address",
      line,
    })),
    ...[178, 198].map((line) => ({
      path: "apps/admin-web/test/app.test.tsx",
      rule: "credential-url-query",
      line,
    })),
    { path: "apps/portal-web/src/api.ts", rule: "secret-assignment", line: 59 },
    { path: "apps/portal-web/src/auth-client.ts", rule: "secret-assignment", line: 6 },
    { path: "apps/portal-web/test/api.test.ts", rule: "secret-assignment", line: 32 },
    { path: "apps/portal-web/test/api.test.ts", rule: "secret-assignment", line: 43 },
    { path: "apps/portal-web/test/api.test.ts", rule: "secret-assignment", line: 64 },
    { path: "apps/portal-web/test/app.test.tsx", rule: "secret-assignment", line: 151 },
    { path: "apps/portal-web/test/app.test.tsx", rule: "secret-assignment", line: 174 },
    { path: "apps/portal-web/test/app.test.tsx", rule: "secret-assignment", line: 193 },
    { path: "apps/portal-web/test/app.test.tsx", rule: "secret-assignment", line: 215 },
    { path: "apps/portal-web/test/app.test.tsx", rule: "email-address", line: 266 },
    { path: "apps/portal-web/test/app.test.tsx", rule: "email-address", line: 277 },
    { path: "apps/portal-web/test/app.test.tsx", rule: "secret-assignment", line: 278 },
    {
      path: "packages/contracts/test/admin-trip-workspace-v1.test.ts",
      rule: "email-address",
      line: 91,
    },
    {
      path: "tests/integration/stage-7-postgresql.test.ts",
      rule: "high-entropy-secret-assignment",
      line: 3827,
    },
    {
      path: "tests/integration/stage-7-postgresql.test.ts",
      rule: "secret-assignment",
      line: 3827,
    },
    {
      path: "tests/integration/stage-7-postgresql.test.ts",
      rule: "high-entropy-secret-assignment",
      line: 5150,
    },
    {
      path: "tests/integration/stage-7-postgresql.test.ts",
      rule: "secret-assignment",
      line: 5150,
    },
    {
      path: "tests/integration/stage-7-postgresql.test.ts",
      rule: "high-entropy-secret-assignment",
      line: 5154,
    },
    {
      path: "tests/integration/stage-7-postgresql.test.ts",
      rule: "secret-assignment",
      line: 5154,
    },
    // Staff-invitation successor: reviewed synthetic fixtures, Fetch mode,
    // runtime-generated disposable passwords, and schema/undefined guards.
    ...[
      [
        "apps/admin-api/test/composed-m1-body-parser.test.ts",
        "high-entropy-secret-assignment",
        [420],
      ],
      ["apps/admin-api/test/composed-m1-body-parser.test.ts", "secret-assignment", [420]],
      ["apps/admin-api/test/staff-invitation-routes.test.ts", "email-address", [58]],
      ["apps/admin-api/test/staff-invitation-routes.test.ts", "authorization-bearer", [338]],
      ["apps/admin-web/src/staff-invitation-api.ts", "secret-assignment", [34, 88, 132]],
      [
        "apps/admin-web/test/staff-invitations-view.test.tsx",
        "email-address",
        [18, 81, 91, 182, 193, 196, 238, 257, 284],
      ],
      [
        "apps/admin-web/test/staff-invitations-view.test.tsx",
        "secret-assignment",
        [55, 88, 108, 123, 130, 137, 173, 200, 321, 327],
      ],
      ["packages/auth-adapters/src/realm.ts", "secret-assignment", [560]],
      ["packages/auth-adapters/test/staff-invitation-token.test.ts", "secret-assignment", [20]],
      [
        "packages/backend-core/test/staff-access/staff-invitation-operations.test.ts",
        "email-address",
        [163, 261, 274, 278, 283, 298, 330, 412, 471],
      ],
      [
        "packages/backend-core/test/staff-access/staff-invitation-operations.test.ts",
        "high-entropy-secret-assignment",
        [319, 427, 445, 461, 470, 488],
      ],
      [
        "packages/backend-core/test/staff-access/staff-invitation-operations.test.ts",
        "secret-assignment",
        [319, 427, 445, 459, 461, 470, 488],
      ],
      [
        "packages/contracts/src/admin/staff/invitation-v1.ts",
        "high-entropy-secret-assignment",
        [53],
      ],
      ["packages/contracts/src/admin/staff/invitation-v1.ts", "secret-assignment", [53]],
      ["packages/contracts/test/admin-staff-invitation-v1.test.ts", "email-address", [21, 52]],
      [
        "packages/contracts/test/admin-staff-invitation-v1.test.ts",
        "high-entropy-secret-assignment",
        [53, 99, 102, 109],
      ],
      [
        "packages/contracts/test/admin-staff-invitation-v1.test.ts",
        "secret-assignment",
        [53, 99, 102, 109],
      ],
      [
        "tests/integration/stage-9-staff-invitations-postgresql.test.ts",
        "high-entropy-secret-assignment",
        [1133, 1160],
      ],
      [
        "tests/integration/stage-9-staff-invitations-postgresql.test.ts",
        "secret-assignment",
        [1133, 1160],
      ],
      ["tooling/testing/playwright/stage9-staff-invitations.spec.ts", "email-address", [21]],
      ["tooling/testing/playwright/stage9-staff-invitations.spec.ts", "credential-url-query", [25]],
      [
        "tooling/testing/playwright/stage9-staff-invitations.spec.ts",
        "secret-assignment",
        [387, 395, 425],
      ],
    ].flatMap(([file, rule, lines]) => lines.map((line) => ({ path: file, rule, line }))),
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
    assert.ok(!file.includes("\\"), `Non-canonical path separator: ${file}`);
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

export const scanStage9SensitiveFiles = async ({ root = repositoryRoot, files }) => {
  const workspace = path.resolve(root);
  const selected = await validateRelativeFiles(workspace, files);
  const selectedSet = new Set(selected);
  const reviewedAllowlist = STAGE9_REVIEWED_SENSITIVE_FINDINGS.filter((entry) =>
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
    stage: "PHASE_1_M1_STAGE_9",
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
    stage10Actions: 0,
  };
};

export const collectStage9CandidateFiles = async ({
  root = repositoryRoot,
  excludeFiles = [],
} = {}) => {
  const workspace = path.resolve(root);
  execFileSync("git", ["merge-base", "--is-ancestor", STAGE9_PREDECESSOR, "HEAD"], {
    cwd: workspace,
    stdio: "ignore",
  });
  const tracked = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", "-z", STAGE9_PREDECESSOR, "--"],
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
      outputRelative.startsWith(".hermes/state/") && !outputRelative.includes("../"),
      "Scan report must stay in local state",
    );
  }
  const files = await collectStage9CandidateFiles({
    root,
    excludeFiles: outputRelative ? [outputRelative] : [],
  });
  const report = await scanStage9SensitiveFiles({ root, files });
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
        stage10Actions: 0,
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
