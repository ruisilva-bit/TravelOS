import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { corepackInvocation, readToolchain } from "./candidate.mjs";
import { GATES, hasCandidateAdapter } from "./gates.mjs";
import { isPostgresGate } from "./postgres-successor-coverage.mjs";
import {
  exclusiveBytes,
  jsonBytes,
  parseCandidate,
  regularBytes,
  safeAncestors,
  sha256,
  strictOptions,
  syncDirectory,
} from "./io.mjs";

const TIMEOUT = 15 * 60 * 1000;
const OUTPUT_LIMIT = 64 * 1024 * 1024;

// Trusted composition only: root and outputDirectory are controlled by the caller.
// This is not a CI orchestrator or an authority for canonical evidence.
export async function runGate(options) {
  strictOptions(options, ["label", "root", "outputDirectory", "candidate"]);
  const { label, root, outputDirectory, candidate } = options;
  const gate = GATES.find((entry) => entry.label === label);
  if (gate && hasCandidateAdapter(label)) {
    parseCandidate(candidate);
    const invocation = corepackInvocation();
    return _runBoundedProcess({
      label,
      root,
      outputDirectory,
      command: invocation.command,
      args: [
        path.join(
          root,
          !label.startsWith("stage10-") && !isPostgresGate(label)
            ? "tooling/ci/stage-10/inherited-compatibility-adapter.mjs"
            : "tooling/ci/stage-10/stage10-candidate-gate.mjs",
        ),
        `--candidate=${candidate}`,
        `--gate=${label}`,
      ],
      environment: {
        PATH: invocation.path,
        HOME: "/home/hermes",
        TMPDIR: process.env.TMPDIR,
        PWD: root,
        TZ: "UTC",
        LANG: "C.UTF-8",
        CI: "true",
      },
      // The adapter owns a one-hour inner process plus verification and cleanup.
      timeout: isPostgresGate(label) ? 65 * 60 * 1000 : TIMEOUT,
      outputLimit: OUTPUT_LIMIT,
    });
  }
  assert.ok(gate?.script && !gate.status.startsWith("PENDING"), "Unknown or pending gate");
  const manifest = JSON.parse(await regularBytes(path.join(root, "package.json")));
  assert.ok(
    typeof manifest.scripts?.[gate.script] === "string" && manifest.scripts[gate.script].trim(),
    "Missing gate script",
  );
  readToolchain(root);
  const invocation = corepackInvocation();
  return _runBoundedProcess({
    label,
    root,
    outputDirectory,
    command: invocation.command,
    args: [...invocation.prefix, "pnpm", "run", gate.script],
    environment: {
      PATH: invocation.path,
      HOME: "/home/hermes",
      TMPDIR: process.env.TMPDIR,
      PWD: root,
      TZ: "UTC",
      LANG: "C.UTF-8",
      SOURCE_DATE_EPOCH: "0",
      CI: "true",
      NODE_ENV: "development",
      COREPACK_ENABLE_NETWORK: "0",
      npm_config_offline: "true",
    },
    timeout: TIMEOUT,
    outputLimit: OUTPUT_LIMIT,
  });
}

// Internal trusted-composition/test seam; never expose it as a CLI or accept untrusted argv.
export async function _runBoundedProcess({
  label,
  root,
  outputDirectory,
  command,
  args,
  environment,
  timeout,
  outputLimit,
}) {
  assert.match(label, /^[a-z0-9-]+$/u);
  assert.ok(
    Number.isSafeInteger(timeout) &&
      timeout > 0 &&
      Number.isSafeInteger(outputLimit) &&
      outputLimit > 0,
  );
  await safeAncestors(root, true);
  try {
    await mkdir(outputDirectory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await safeAncestors(outputDirectory, true);
  // Reserve both output names before executing. A failed attempt is not silently reusable.
  const stdoutFile = path.join(outputDirectory, `${label}.stdout`);
  const stderrFile = path.join(outputDirectory, `${label}.stderr`);
  await exclusiveBytes(stdoutFile, Buffer.alloc(0));
  await exclusiveBytes(stderrFile, Buffer.alloc(0));
  const chunks = { stdout: [], stderr: [] },
    sizes = { stdout: 0, stderr: 0 };
  let reason = null,
    spawnError = null,
    exitCode = null,
    signal = null;
  const started = Date.now();
  const child = spawn(command, args, {
    cwd: root,
    env: environment,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const kill = (why) => {
    reason ??= why;
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") spawnError ??= error.code;
      }
    }
    // A descendant may retain inherited pipes after leaving the process group.
    // Destroy our read ends so a failed attempt still has a bounded completion.
    child.stdout.destroy();
    child.stderr.destroy();
  };
  const interrupted = () => kill("cancelled");
  process.on("SIGINT", interrupted);
  process.on("SIGTERM", interrupted);
  const timer = setTimeout(() => kill("timeout"), timeout);
  for (const name of ["stdout", "stderr"])
    child[name].on("data", (chunk) => {
      const remaining = outputLimit - sizes[name];
      const part = chunk.subarray(0, Math.max(0, remaining));
      sizes[name] += part.length;
      chunks[name].push(part);
      if (chunk.length > remaining) kill("output-limit");
    });
  child.on("error", (error) => {
    spawnError = error.code ?? "SPAWN_ERROR";
    reason ??= "spawn-error";
  });
  try {
    await new Promise((resolve) =>
      child.on("close", (code, sig) => {
        exitCode = code;
        signal = sig;
        resolve();
      }),
    );
  } finally {
    clearTimeout(timer);
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
    // Kill any remaining members even after their parent exited.
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
        reason ??= "incomplete-tree";
      } catch (error) {
        if (error.code !== "ESRCH") {
          spawnError ??= error.code;
          reason ??= "cleanup-error";
        }
      }
    }
  }
  const { open } = await import("node:fs/promises");
  const logs = {};
  for (const [name, file] of [
    ["stdout", stdoutFile],
    ["stderr", stderrFile],
  ]) {
    const bytes = Buffer.concat(chunks[name]);
    const handle = await open(file, "r+");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    logs[name] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  reason ??=
    exitCode === 0 && signal === null && spawnError === null ? "exit" : signal ? "signal" : "exit";
  const record = {
    label,
    status: reason === "exit" && exitCode === 0 && signal === null && !spawnError ? "PASS" : "FAIL",
    reason,
    exitCode,
    signal,
    spawnError,
    durationMs: Date.now() - started,
    ...logs,
  };
  const temporary = path.join(outputDirectory, `.${label}.${randomUUID()}.tmp`);
  await exclusiveBytes(temporary, jsonBytes(record));
  try {
    await link(temporary, path.join(outputDirectory, `${label}.json`));
    await syncDirectory(outputDirectory);
  } finally {
    await unlink(temporary);
  }
  return record;
}
