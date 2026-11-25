import { createHash } from "node:crypto";
import { appendFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { qualifyExtractedArtifact } from "../ci/stage-10/qualify-artifact.mjs";
import { stopPostgres } from "../ci/stage-10/stage10-runtime-api-postgres.mjs";
import { nativePostgresVersionAccepted } from "../ci/stage-10/native-postgres-version.mjs";
import {
  postgresCoverage,
  summarizePostgresResults,
} from "../ci/stage-10/postgres-successor-coverage.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const stageLabel = "Stage 10 inherited full PostgreSQL regression";
const vitestConfig = "tooling/testing/vitest.stage-10.config.ts";
const evidenceDirectory = path.resolve(
  process.env["TRAVELOS_STAGE10_EVIDENCE_DIR"] ??
    path.join(repositoryRoot, ".hermes/state", `stage10-full-pg-${process.pid}`),
);
const outputPath = path.join(evidenceDirectory, "execution.json");
let clusterStartAttempted = false;
let clusterStopped = true;
let stopExitCode = null;
let primaryFailure = null;
let testExitCode = null;
let testLogSha256 = null;
let artifactBinding = null;
let assertionCoverage = null;
let assertionResults = null;

if (!evidenceDirectory.startsWith(`${path.join(repositoryRoot, ".hermes/state")}${path.sep}`)) {
  throw new Error("Stage 10 qualification receipts must remain in local .hermes/state");
}
await mkdir(evidenceDirectory, { recursive: true });
// Refuse every occupied leaf (including dangling symlinks) before scratch
// allocation. Errors other than ENOENT, including our own refusal, propagate.
try {
  await lstat(outputPath);
  throw new Error("Refusing to overwrite existing Stage 10 qualification receipt");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const packageRoot = await mkdtemp(path.join(os.tmpdir(), "travelos-stage6-"));
const workRoot = await mkdtemp(path.join(os.tmpdir(), "travelos-stage10-full-pg-"));
const dataDirectory = path.join(workRoot, "data");
const socketDirectory = path.join(workRoot, "socket");
const postgresLog = path.join(workRoot, "postgres.log");
const nativeBin = process.env.TRAVELOS_STAGE10_NATIVE_PG_BIN;
if (nativeBin !== undefined)
  assert.equal(nativeBin, "/usr/lib/postgresql/18/bin", "Unexpected native PostgreSQL binary root");
const postgresBin = nativeBin ?? path.join(packageRoot, "usr/lib/postgresql/18/bin");
const postgresShare = nativeBin
  ? "/usr/share/postgresql/18"
  : path.join(packageRoot, "usr/share/postgresql/18");

const run = (command, args, env = postgresEnvironment) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? String(result.error) : ""),
  };
};
const requirePass = (label, result) => {
  if (result.exitCode !== 0) throw new Error(`${label} failed: ${result.stderr.slice(0, 4_000)}`);
  return result;
};
const freeLoopbackPort = async () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a disposable PostgreSQL port"));
        return;
      }
      const selected = address.port;
      server.close((error) => (error ? reject(error) : resolve(selected)));
    });
  });
const processAbsent = async () => {
  try {
    const text = await readFile(path.join(dataDirectory, "postmaster.pid"), "utf8");
    const pid = Number.parseInt(text.split("\n", 1)[0] ?? "", 10);
    if (!Number.isInteger(pid) || pid < 1) return false;
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (
      error instanceof Error && "code" in error && ["ENOENT", "ESRCH"].includes(String(error.code))
    );
  }
};
const listenerClosed = async (port) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (closed) => {
      socket.destroy();
      resolve(closed);
    };
    socket.once("connect", () => finish(false));
    socket.once("error", () => finish(true));
    socket.setTimeout(1_000, () => finish(true));
  });

let port = null;
let postgresEnvironment = process.env;
let commandRecords = [];
try {
  assertionCoverage = await postgresCoverage(repositoryRoot);
  const payload = process.env.TRAVELOS_STAGE10_EXTRACTED_ROOT;
  for (const name of [
    "TRAVELOS_STAGE10_EXTRACTED_ROOT",
    "TRAVELOS_STAGE10_ARCHIVE",
    "TRAVELOS_STAGE10_RECEIPT",
    "TRAVELOS_STAGE10_INPUTS",
  ])
    assert.ok(
      process.env[name] && path.isAbsolute(process.env[name]),
      "Explicit Stage 10 qualification paths required",
    );
  const receiptBytes = await readFile(process.env.TRAVELOS_STAGE10_RECEIPT);
  const inputsBytes = await readFile(process.env.TRAVELOS_STAGE10_INPUTS);
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha(receiptBytes), process.env.TRAVELOS_STAGE10_RECEIPT_SHA256);
  assert.equal(sha(inputsBytes), process.env.TRAVELOS_STAGE10_INPUTS_SHA256);
  const receipt = JSON.parse(receiptBytes);
  const inputs = JSON.parse(inputsBytes);
  await qualifyExtractedArtifact({
    payload,
    archive: process.env.TRAVELOS_STAGE10_ARCHIVE,
    receipt,
    expectedReceiptSha256: sha(receiptBytes),
    inputs,
    expectedNodeSha256: process.env.TRAVELOS_STAGE10_NODE_SHA256,
  });
  const release = JSON.parse(await readFile(path.join(payload, "release.json"), "utf8"));
  assert.equal(release.stage, "PHASE_1_M1_STAGE_10");
  artifactBinding = {
    artifactId: release.artifactId,
    candidate: release.candidate,
    inputDigest: inputs.inputDigest,
    archiveSha256: receipt.archiveSha256,
    receiptSha256: sha(receiptBytes),
    inputsSha256: sha(inputsBytes),
    browserAcceptance: true,
  };
  const preparation = nativeBin
    ? requirePass("Native PostgreSQL 18.6", run(path.join(postgresBin, "postgres"), ["--version"]))
    : requirePass(
        "PostgreSQL 18.6 package preparation",
        run(
          process.execPath,
          [
            "tooling/database/prepare-postgresql-18.mjs",
            "--root",
            packageRoot,
            "--evidence",
            path.join(evidenceDirectory, "postgresql-package-provenance.json"),
          ],
          {
            ...process.env,
            PATH: `${path.dirname(process.execPath)}:${process.env["PATH"] ?? ""}`,
          },
        ),
      );
  if (nativeBin) {
    const digest = createHash("sha256")
      .update(await readFile(path.join(postgresBin, "postgres")))
      .digest("hex");
    assert.ok(
      nativePostgresVersionAccepted(preparation.stdout.trim(), digest),
      "Unexpected native PostgreSQL executable",
    );
  }
  commandRecords.push({
    command: nativeBin
      ? "native postgres --version"
      : "node tooling/database/prepare-postgresql-18.mjs",
    exitCode: preparation.exitCode,
    stdoutSha256: createHash("sha256").update(preparation.stdout).digest("hex"),
    stderrSha256: createHash("sha256").update(preparation.stderr).digest("hex"),
  });

  port = await freeLoopbackPort();
  postgresEnvironment = nativeBin
    ? {
        ...process.env,
        PATH: `${postgresBin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
      }
    : {
        ...process.env,
        PATH: `${postgresBin}:${path.dirname(process.execPath)}:${process.env["PATH"] ?? ""}`,
        LD_LIBRARY_PATH: [
          path.join(packageRoot, "usr/lib/x86_64-linux-gnu"),
          path.join(packageRoot, "usr/lib/postgresql/18/lib"),
          process.env["LD_LIBRARY_PATH"] ?? "",
        ]
          .filter(Boolean)
          .join(":"),
      };
  const runtimeEnvironment = {
    ...postgresEnvironment,
    PGHOST: "127.0.0.1",
    PGPORT: String(port),
    PGUSER: "postgres",
    PGDATABASE: "postgres",
    PGSSLMODE: "disable",
  };
  await mkdir(socketDirectory, { recursive: true });
  requirePass(
    "initdb",
    run(path.join(postgresBin, "initdb"), [
      "--pgdata",
      dataDirectory,
      "--encoding=UTF8",
      "--locale=C.UTF-8",
      "--data-checksums",
      "--username=postgres",
      "--auth-local=trust",
      "--auth-host=trust",
      "--no-instructions",
      "-L",
      postgresShare,
    ]),
  );
  await appendFile(
    path.join(dataDirectory, "postgresql.conf"),
    `\n# TravelOS Stage 9 disposable qualification\nlisten_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = '${socketDirectory.replaceAll("'", "''")}'\npassword_encryption = 'scram-sha-256'\nssl = off\nfsync = on\nsynchronous_commit = on\nfull_page_writes = on\nlogging_collector = off\nlog_min_messages = warning\nmax_connections = 40\n`,
  );
  clusterStartAttempted = true;
  requirePass(
    "pg_ctl start",
    run(path.join(postgresBin, "pg_ctl"), [
      "--pgdata",
      dataDirectory,
      "--log",
      postgresLog,
      "--wait",
      "--timeout",
      "30",
      "start",
    ]),
  );
  const probe = requirePass(
    "PostgreSQL runtime probe",
    run(
      path.join(postgresBin, "psql"),
      [
        "--no-psqlrc",
        "--tuples-only",
        "--no-align",
        "--command",
        "SELECT current_setting('server_version_num'), current_setting('data_checksums'), current_setting('listen_addresses'), current_setting('port'), current_setting('data_directory'), current_setting('unix_socket_directories')",
      ],
      runtimeEnvironment,
    ),
  );
  const fields = probe.stdout.trim().split("|");
  const [version, checksums, listenAddresses, observedPort, observedData, observedSocket] = fields;
  if (
    fields.length !== 6 ||
    version !== "180006" ||
    checksums !== "on" ||
    listenAddresses !== "127.0.0.1" ||
    observedPort !== String(port) ||
    observedData !== dataDirectory ||
    observedSocket !== socketDirectory
  ) {
    throw new Error("Unexpected or foreign disposable PostgreSQL endpoint");
  }

  const reporterPath = path.join(workRoot, "vitest-results.json");
  const integrationArgs = [
    "run",
    "--config",
    vitestConfig,
    "--reporter=verbose",
    "--reporter=json",
    `--outputFile.json=${reporterPath}`,
  ];
  const integration = run(path.join(repositoryRoot, "node_modules/.bin/vitest"), integrationArgs, {
    ...runtimeEnvironment,
    TRAVELOS_STAGE8_PG_BIN: postgresBin,
    TRAVELOS_STAGE8_WORK_ROOT: workRoot,
    TRAVELOS_STAGE8_ARTIFACT_ROOT: process.env.TRAVELOS_STAGE10_EXTRACTED_ROOT,
    TRAVELOS_STAGE9_ARTIFACT_ROOT: process.env.TRAVELOS_STAGE10_EXTRACTED_ROOT,
    TRAVELOS_STAGE9_CANDIDATE: artifactBinding.candidate,
    TRAVELOS_STAGE10_PREDECESSOR_ARCHIVE: process.env.TRAVELOS_STAGE10_PREDECESSOR_ARCHIVE,
    TRAVELOS_STAGE9_BROWSER_ACCEPTANCE: "1",
    TRAVELOS_STAGE7_PG_BIN: postgresBin,
    TRAVELOS_STAGE7_WORK_ROOT: workRoot,
    TRAVELOS_STAGE7_ARTIFACT_ROOT: process.env.TRAVELOS_STAGE10_EXTRACTED_ROOT,
    TRAVELOS_STAGE6_PG_BIN: postgresBin,
    TRAVELOS_STAGE6_WORK_ROOT: workRoot,
  });
  testExitCode = integration.exitCode;
  const integrationLog = `${integration.stdout}${integration.stderr}`;
  testLogSha256 = createHash("sha256").update(integrationLog).digest("hex");
  await writeFile(path.join(evidenceDirectory, "integration-tests.log"), integrationLog, {
    flag: "wx",
    mode: 0o600,
  });
  commandRecords.push({
    command:
      "vitest run --config tooling/testing/vitest.stage-10.config.ts --reporter=verbose --reporter=json --outputFile.json=<private-disposable-root>/vitest-results.json",
    exitCode: integration.exitCode,
    logSha256: testLogSha256,
  });
  process.stdout.write(integration.stdout);
  process.stderr.write(integration.stderr);
  requirePass(`${stageLabel} PostgreSQL integration qualification`, integration);
  assert.deepEqual(
    await postgresCoverage(repositoryRoot),
    assertionCoverage,
    "PostgreSQL assertion source changed during execution",
  );
  assertionResults = summarizePostgresResults(
    JSON.parse(await readFile(reporterPath, "utf8")),
    assertionCoverage,
    repositoryRoot,
  );
} catch (error) {
  primaryFailure = error;
} finally {
  if (clusterStartAttempted) {
    let stopped = false;
    try {
      stopped = stopPostgres({
        pgCtl: path.join(postgresBin, "pg_ctl"),
        data: dataDirectory,
        env: postgresEnvironment,
      });
    } catch {
      // An indeterminate stop is never cleanup; retain roots and receipt.
      if (primaryFailure === null) primaryFailure = new Error("Disposable PostgreSQL stop unknown");
    }
    // The bounded helper verifies pg_ctl status after fast/immediate attempts.
    // Its boolean is not a subprocess exit code; retain null for that old field.
    stopExitCode = null;
    clusterStopped =
      stopped && (await processAbsent()) && (port === null || (await listenerClosed(port)));
    if (!clusterStopped && primaryFailure === null) {
      primaryFailure = new Error("Disposable PostgreSQL process/listener remained active");
    }
  }
  const rootAbsent = async (root) => {
    try {
      await lstat(root);
      return false;
    } catch (error) {
      return error instanceof Error && "code" in error && error.code === "ENOENT";
    }
  };
  const disposableRootsAbsent = clusterStopped
    ? await Promise.all(
        [workRoot, packageRoot].map(async (root) => {
          try {
            await rm(root, { recursive: true, force: true });
            return await rootAbsent(root);
          } catch {
            return false;
          }
        }),
      ).then((results) => results.every(Boolean))
    : false;
  if (!disposableRootsAbsent && primaryFailure === null) {
    primaryFailure = new Error("Disposable PostgreSQL roots cleanup was not confirmed");
  }
  const result =
    primaryFailure === null && clusterStopped && disposableRootsAbsent ? "PASS" : "FAIL";
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        stage: "PHASE_1_M1_STAGE_10",
        result,
        postgresVersion: "18.6",
        serverVersionNumber: 180006,
        bindScope: "127.0.0.1 only",
        dataChecksums: true,
        globalPackageInstallation: false,
        stage11Actions: 0,
        testExitCode,
        testLogSha256,
        artifactBinding,
        assertionCoverage,
        assertionResults,
        commands: commandRecords,
        cleanup: { clusterStartAttempted, clusterStopped, stopExitCode, disposableRootsAbsent },
        failure: primaryFailure === null ? null : String(primaryFailure),
      },
      null,
      2,
    )}\n`,
    { flag: "wx", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify({ evidence: evidenceDirectory, result })}\n`);
}
if (primaryFailure !== null) throw primaryFailure;
if (!clusterStopped) throw new Error("Disposable PostgreSQL shutdown was not confirmed");
