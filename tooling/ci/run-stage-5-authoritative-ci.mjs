import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";

import {
  STAGE5_FINAL9_CI_EXECUTION_PLACEHOLDER,
  STAGE5_FINAL9_CI_LOG_PLACEHOLDER,
  STAGE5_FINAL9_EVIDENCE_DIRECTORY,
} from "./stage-5-candidate-contract.mjs";
import { verifyStage5Final9EvidenceIndex } from "./stage-5-evidence-index.mjs";
import { verifyStage5Final9FindingLineage } from "./stage-5-finding-lineage.mjs";
import { collectStage5SourceFiles } from "./stage-5-source-scope.mjs";

const REQUIRED_NODE_VERSION = "v24.19.0";
const REQUIRED_COREPACK_VERSION = "0.35.0";
const REQUIRED_PNPM_VERSION = "11.21.0";
const COMMAND = "corepack pnpm ci:verify";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const evidenceFile = (name) => path.join(process.cwd(), STAGE5_FINAL9_EVIDENCE_DIRECTORY, name);

const readCommandVersion = (executable, args) => {
  const result = spawnSync(executable, args, { encoding: "utf8", cwd: process.cwd() });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${executable} ${args.join(" ")} preflight failed: ${result.error?.message ?? result.stderr}`,
    );
  }
  return result.stdout.trim();
};

const verifyToolchain = async () => {
  if (process.version !== REQUIRED_NODE_VERSION) {
    throw new Error(
      `Stage 5 authoritative CI requires Node ${REQUIRED_NODE_VERSION}, received ${process.version}`,
    );
  }
  const packageManifest = JSON.parse(
    await readFile(path.join(process.cwd(), "package.json"), "utf8"),
  );
  if (packageManifest.packageManager !== `pnpm@${REQUIRED_PNPM_VERSION}`) {
    throw new Error("Repository packageManager pin does not match the required Stage 5 toolchain");
  }
  const corepackVersion = readCommandVersion("corepack", ["--version"]);
  const pnpmVersion = readCommandVersion("corepack", ["pnpm", "--version"]);
  if (corepackVersion !== REQUIRED_COREPACK_VERSION || pnpmVersion !== REQUIRED_PNPM_VERSION) {
    throw new Error(
      `Stage 5 authoritative CI requires Corepack ${REQUIRED_COREPACK_VERSION}/pnpm ${REQUIRED_PNPM_VERSION}; received ${corepackVersion}/${pnpmVersion}`,
    );
  }
  return {
    nodeVersion: process.version,
    nodeExecutable: process.execPath,
    corepackVersion,
    pnpmVersion,
  };
};

const captureAuthoritativeCi = async ({ logPath }) => {
  const temporaryRoot = process.env.TMPDIR ?? path.join(os.homedir(), ".hermes/cache/scratch");
  await mkdir(temporaryRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(temporaryRoot, "travelos-stage5-ci-"));
  const temporaryLogPath = path.join(temporaryDirectory, "ci-verify.log");
  const logStream = createWriteStream(temporaryLogPath, { flags: "wx" });
  const child = spawn("corepack", ["pnpm", "ci:verify"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });

  let spawnError = null;
  child.once("error", (error) => {
    spawnError = error;
  });
  const closePromise = once(child, "close");
  const [exitCode, signal] = await closePromise;
  logStream.end();
  await once(logStream, "finish");
  if (spawnError) {
    await writeFile(temporaryLogPath, `${spawnError.message}\n`, { flag: "a" });
  }
  const logBytes = await readFile(temporaryLogPath);
  await writeFile(logPath, logBytes);
  const persistedBytes = await readFile(logPath);
  if (!persistedBytes.equals(logBytes)) {
    throw new Error("Authoritative CI log did not persist byte-for-byte into FINAL-9 evidence");
  }
  return {
    exitCode: typeof exitCode === "number" ? exitCode : 1,
    signal: signal ?? null,
    spawnError: spawnError?.message ?? null,
    logBytes: persistedBytes.length,
    logSha256: sha256(persistedBytes),
    temporaryDirectory,
  };
};

const execute = async () => {
  const root = process.cwd();
  const versions = await verifyToolchain();
  await verifyStage5Final9EvidenceIndex({
    root,
    allowedPhases: ["PRE_CI"],
    requiredPhase: "PRE_CI",
  });
  await verifyStage5Final9FindingLineage({ root });
  const scope = await collectStage5SourceFiles({ root, phase: "FINAL_EVIDENCE" });
  if (scope.result !== "PASS") throw new Error("Stage 5 pre-CI source scope is incomplete");

  const logPath = evidenceFile("ci-verify.log");
  const executionPath = evidenceFile("ci-verify-execution.json");
  if ((await readFile(logPath, "utf8")) !== STAGE5_FINAL9_CI_LOG_PLACEHOLDER) {
    throw new Error("Authoritative CI log is not the exact unused PRE_CI placeholder");
  }
  if ((await readFile(executionPath, "utf8")) !== STAGE5_FINAL9_CI_EXECUTION_PLACEHOLDER) {
    throw new Error(
      "Authoritative CI invocation evidence is not the exact unused PRE_CI placeholder",
    );
  }

  const stateDirectory = path.join(root, ".hermes/state");
  const invocationGuard = path.join(stateDirectory, "stage5-ci-verify-invocation.json");
  await mkdir(stateDirectory, { recursive: true });
  const startedAtUtc = new Date().toISOString();
  const guard = await open(invocationGuard, "wx");
  await guard.writeFile(
    `${JSON.stringify({ schemaVersion: 1, command: COMMAND, phase: "RUNNING", startedAtUtc }, null, 2)}\n`,
  );
  await guard.close();

  let run;
  let result = "FAIL";
  let executionError = null;
  try {
    run = await captureAuthoritativeCi({ logPath });
    result = run.exitCode === 0 && run.spawnError === null ? "PASS" : "FAIL";
  } catch (error) {
    executionError = error.message;
    const fallbackLog = Buffer.from(`${error.stack ?? error.message}\n`, "utf8");
    await writeFile(logPath, fallbackLog);
    run = {
      exitCode: 1,
      signal: null,
      spawnError: error.message,
      logBytes: fallbackLog.length,
      logSha256: sha256(fallbackLog),
      temporaryDirectory: null,
    };
  }

  const finishedAtUtc = new Date().toISOString();
  const execution = {
    schemaVersion: 1,
    phase: "FINAL",
    invocationCount: 1,
    result,
    exitCode: run.exitCode,
    command: COMMAND,
    cwd: root,
    ...versions,
    startedAtUtc,
    finishedAtUtc,
    signal: run.signal,
    spawnError: run.spawnError,
    executionError,
    logBytes: run.logBytes,
    logSha256: run.logSha256,
  };
  await writeFile(executionPath, `${JSON.stringify(execution, null, 2)}\n`);
  const persistedExecution = await readFile(executionPath);
  if (persistedExecution.toString("utf8") !== `${JSON.stringify(execution, null, 2)}\n`) {
    throw new Error("Authoritative CI execution metadata did not persist byte-for-byte");
  }
  const guardReport = { ...execution, guardPath: ".hermes/state/stage5-ci-verify-invocation.json" };
  await writeFile(invocationGuard, `${JSON.stringify(guardReport, null, 2)}\n`);
  if (run.temporaryDirectory) await rm(run.temporaryDirectory, { recursive: true, force: true });
  console.log(JSON.stringify(execution, null, 2));
  if (result !== "PASS") process.exitCode = 1;
};

await execute();
