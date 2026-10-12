import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.resolve(
  process.env["TRAVELOS_STAGE6_EVIDENCE_DIR"] ??
    path.join(repositoryRoot, ".hermes/state", `stage6-postgresql-${process.pid}`),
);
const workRoot = await mkdtemp(path.join(os.tmpdir(), "travelos-stage6-"));
const postgresRoot = path.join(workRoot, "postgres-root");
const dataDirectory = path.join(workRoot, "data");
const socketDirectory = path.join(workRoot, "socket");
const postgresLog = path.join(workRoot, "postgres.log");
const postgresBin = path.join(postgresRoot, "usr/lib/postgresql/18/bin");
const postgresShare = path.join(postgresRoot, "usr/share/postgresql/18");
const outputPath = path.join(evidenceDirectory, "execution.json");
let clusterStartAttempted = false;
let clusterStopped;
let primaryFailure = null;

if (!evidenceDirectory.startsWith(`${path.join(repositoryRoot, ".hermes/state")}${path.sep}`)) {
  throw new Error("Stage 6 qualification receipts must remain in local .hermes/state");
}
await mkdir(evidenceDirectory, { recursive: true });
try {
  await readFile(outputPath, "utf8");
  throw new Error(`Refusing to overwrite existing Stage 6 qualification receipt: ${outputPath}`);
} catch (error) {
  if (error instanceof Error && "code" in error && error.code !== "ENOENT") throw error;
}

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

const port = await freeLoopbackPort();
const postgresEnvironment = {
  ...process.env,
  PATH: `${postgresBin}:${path.dirname(process.execPath)}:${process.env["PATH"] ?? ""}`,
  LD_LIBRARY_PATH: [
    path.join(postgresRoot, "usr/lib/x86_64-linux-gnu"),
    path.join(postgresRoot, "usr/lib/postgresql/18/lib"),
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
const commandRecords = [];
try {
  const preparation = requirePass(
    "PostgreSQL 18.6 package preparation",
    run(
      process.execPath,
      [
        "tooling/database/prepare-postgresql-18.mjs",
        "--root",
        postgresRoot,
        "--evidence",
        path.join(evidenceDirectory, "postgresql-package-provenance.json"),
      ],
      { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env["PATH"] ?? ""}` },
    ),
  );
  commandRecords.push({
    command: "node tooling/database/prepare-postgresql-18.mjs",
    exitCode: preparation.exitCode,
    stdoutSha256: createHash("sha256").update(preparation.stdout).digest("hex"),
    stderrSha256: createHash("sha256").update(preparation.stderr).digest("hex"),
  });
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
    `\n# TravelOS Stage 6 disposable qualification\nlisten_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = '${socketDirectory.replaceAll("'", "''")}'\npassword_encryption = 'scram-sha-256'\nssl = off\nfsync = on\nsynchronous_commit = on\nfull_page_writes = on\nlogging_collector = off\nlog_min_messages = warning\nmax_connections = 40\n`,
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
        "SELECT current_setting('server_version_num'), current_setting('data_checksums'), current_setting('listen_addresses'), current_setting('port')",
      ],
      runtimeEnvironment,
    ),
  );
  const [serverVersionNumber, dataChecksums, listenAddresses, observedPort] = probe.stdout
    .trim()
    .split("|");
  if (
    serverVersionNumber !== "180006" ||
    dataChecksums !== "on" ||
    listenAddresses !== "127.0.0.1" ||
    observedPort !== String(port)
  ) {
    throw new Error(`Unexpected disposable PostgreSQL state: ${probe.stdout.trim()}`);
  }
  const integration = run(
    path.join(repositoryRoot, "node_modules/.bin/vitest"),
    ["run", "--config", "tooling/testing/vitest.stage-6.config.ts", "--reporter=verbose"],
    {
      ...runtimeEnvironment,
      TRAVELOS_STAGE6_PG_BIN: postgresBin,
      TRAVELOS_STAGE6_WORK_ROOT: workRoot,
    },
  );
  await writeFile(
    path.join(evidenceDirectory, "integration-tests.log"),
    `${integration.stdout}${integration.stderr}`,
  );
  commandRecords.push({
    command: "vitest run --config tooling/testing/vitest.stage-6.config.ts --reporter=verbose",
    exitCode: integration.exitCode,
    stdoutSha256: createHash("sha256").update(integration.stdout).digest("hex"),
    stderrSha256: createHash("sha256").update(integration.stderr).digest("hex"),
  });
  process.stdout.write(integration.stdout);
  process.stderr.write(integration.stderr);
  requirePass("Stage 6 PostgreSQL integration qualification", integration);
} catch (error) {
  primaryFailure = error;
} finally {
  let stopExitCode = null;
  if (clusterStartAttempted) {
    const stop = run(path.join(postgresBin, "pg_ctl"), [
      "--pgdata",
      dataDirectory,
      "--wait",
      "--timeout",
      "30",
      "stop",
      "--mode=fast",
    ]);
    stopExitCode = stop.exitCode;
    if (stop.exitCode !== 0 && primaryFailure === null) {
      primaryFailure = new Error(`pg_ctl stop failed: ${stop.stderr.slice(0, 4_000)}`);
    }
    clusterStopped = (await processAbsent()) && (await listenerClosed(port));
    if (!clusterStopped && primaryFailure === null)
      primaryFailure = new Error("Disposable PostgreSQL process/listener remained active");
  } else {
    clusterStopped = true;
  }
  const disposableRootAbsent = clusterStopped
    ? await rm(workRoot, { recursive: true, force: true }).then(
        () => true,
        () => false,
      )
    : false;
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        result: primaryFailure === null && clusterStopped && disposableRootAbsent ? "PASS" : "FAIL",
        postgresVersion: "18.6",
        serverVersionNumber: 180006,
        bindScope: "127.0.0.1 only",
        dataChecksums: true,
        globalPackageInstallation: false,
        ct200Actions: 0,
        commands: commandRecords,
        cleanup: { clusterStartAttempted, clusterStopped, stopExitCode, disposableRootAbsent },
        failure: primaryFailure === null ? null : String(primaryFailure),
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ evidence: evidenceDirectory, result: primaryFailure === null && clusterStopped && disposableRootAbsent ? "PASS" : "FAIL" })}\n`,
  );
}
if (primaryFailure !== null) throw primaryFailure;
if (!clusterStopped) throw new Error("Disposable PostgreSQL shutdown was not confirmed");
