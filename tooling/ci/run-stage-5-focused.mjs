import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = process.cwd();
const outputPath = path.resolve(
  process.env["TRAVELOS_STAGE5_FOCUSED_OUTPUT"] ??
    "docs/evidence/phase-1-m1/stage-5-final-9/focused-test-execution.json",
);
const logPath = path.resolve(
  process.env["TRAVELOS_STAGE5_FOCUSED_LOG"] ??
    "docs/evidence/phase-1-m1/stage-5-final-9/focused-tests.log",
);
const corepack = "corepack";
const focusedTests = [
  "packages/contracts/test/admin-m1-contracts.test.ts",
  "apps/admin-api/test/m1-routes.test.ts",
  "packages/backend-core/test/m1/application.test.ts",
  "packages/backend-core/test/m1/shared-kernel.test.ts",
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
  spawnSync(corepack, args, {
    cwd: repositoryRoot,
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
const report = {
  schemaVersion: 2,
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
  stdoutSha256: createHash("sha256").update(stdout).digest("hex"),
  stderrSha256: createHash("sha256").update(stderr).digest("hex"),
  redaction: "No passwords, tokens or credential-bearing URLs emitted.",
  ct200Actions: 0,
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(logPath, combined);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (execution.status !== 0) process.exitCode = execution.status ?? 1;
