import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import manifest from "./stage-5-current-candidate.json" with { type: "json" };
import { assertStage5CandidateManifest } from "./stage-5-candidate-coherence.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
assertStage5CandidateManifest(manifest);
const evidenceDirectory = manifest.evidenceDirectory;
const outputPath = path.join(root, evidenceDirectory, "focused-test-execution.json");
const logPath = path.join(root, evidenceDirectory, "focused-tests.log");
const focusedTests = [
  "packages/contracts/test/admin-m1-contracts.test.ts",
  "apps/admin-api/test/m1-routes.test.ts",
  "apps/admin-api/test/m1-authorization-boundary.test.ts",
  "apps/admin-api/test/health-live.test.ts",
  "apps/admin-api/test/host-auth-routing-boundary.test.ts",
  "apps/admin-api/test/m1-session-resolver.test.ts",
  "apps/admin-api/test/auth-bridge.test.ts",
  "apps/portal-api/test/health-live.test.ts",
  "apps/portal-api/test/host-routing-boundary.test.ts",
  "packages/backend-core/test/m1/application.test.ts",
  "packages/backend-core/test/m1/shared-kernel.test.ts",
  "packages/backend-core/test/agency-organization/agency-bootstrap.test.ts",
  "packages/backend-core/test/staff-access/authorization.test.ts",
  "apps/admin-api/test/composed-m1-body-parser.test.ts",
];
const commandArgs = [
  "pnpm",
  "exec",
  "vitest",
  "run",
  "--config",
  "tooling/testing/vitest.config.ts",
  "--reporter=verbose",
  ...focusedTests,
];
const run = (args) =>
  spawnSync("corepack", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env: process.env,
  });
const corepackVersionResult = run(["--version"]);
const pnpmVersionResult = run(["pnpm", "--version"]);
const execution = run(commandArgs);
const stdout = execution.stdout ?? "";
const stderr = execution.stderr ?? "";
const combined = `${stdout}${stderr}`;
const testFilesMatch = combined.match(/Test Files\s+(\d+) passed/iu);
const testsMatch = combined.match(/Tests\s+(\d+) passed/iu);
const hashFile = async (relativePath) =>
  createHash("sha256")
    .update(await readFile(path.join(root, relativePath)))
    .digest("hex");
const report = {
  schemaVersion: 3,
  candidate: manifest.candidate,
  predecessor: manifest.predecessor,
  result: execution.status === 0 ? "PASS" : "FAIL",
  command: `corepack ${commandArgs.join(" ")}`,
  exitCode: execution.status ?? 1,
  toolchain: {
    node: process.version,
    corepack: (corepackVersionResult.stdout ?? "").trim(),
    pnpm: (pnpmVersionResult.stdout ?? "").trim(),
    processExecPath: process.execPath,
  },
  files: Number.parseInt(testFilesMatch?.[1] ?? "0", 10),
  tests: Number.parseInt(testsMatch?.[1] ?? "0", 10),
  sourceHashes: Object.fromEntries(
    await Promise.all(
      [...focusedTests, "package.json"].map(async (relativePath) => [
        relativePath,
        await hashFile(relativePath),
      ]),
    ),
  ),
  stdoutSha256: createHash("sha256").update(stdout).digest("hex"),
  stderrSha256: createHash("sha256").update(stderr).digest("hex"),
  combinedLogSha256: createHash("sha256").update(combined).digest("hex"),
  redaction: "No passwords, tokens or credential-bearing URLs emitted.",
  ct200Actions: 0,
  stage6Actions: manifest.stage6Actions,
};
const assertNotPrepared = async (filePath) => {
  try {
    await readFile(filePath);
    throw new Error(
      `Current candidate evidence already exists; refusing to overwrite: ${filePath}`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};
await mkdir(path.dirname(outputPath), { recursive: true });
await assertNotPrepared(outputPath);
await assertNotPrepared(logPath);
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
await writeFile(logPath, combined, { flag: "wx" });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (execution.status !== 0) process.exitCode = execution.status ?? 1;
