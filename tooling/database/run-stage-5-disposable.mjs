import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.resolve(
  process.env["TRAVELOS_STAGE5_EVIDENCE_DIR"] ?? path.join(os.tmpdir(), "travelos-stage5-evidence"),
);
if (!evidenceDirectory.startsWith(`${os.tmpdir()}${path.sep}`)) {
  throw new Error(
    "Stage 5 disposable qualification output must remain outside the evidence/freeze tree",
  );
}
await rm(evidenceDirectory, { recursive: true, force: true });
await mkdir(evidenceDirectory, { recursive: true });

const workRoot = await mkdtemp(path.join(os.tmpdir(), "travelos-stage5-"));
const postgresRoot = path.join(workRoot, "postgres-root");
const dataDirectory = path.join(workRoot, "data");
const socketDirectory = path.join(workRoot, "socket");
const postgresLog = path.join(workRoot, "postgres.log");
const postgresBin = path.join(postgresRoot, "usr/lib/postgresql/18/bin");
const postgresShare = path.join(postgresRoot, "usr/share/postgresql/18");
const corepack = "corepack";
let clusterStarted = false;
let clusterStartAttempted = false;
let clusterStopped = false;
let primaryFailure = null;

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
    const pidText = await readFile(path.join(dataDirectory, "postmaster.pid"), "utf8");
    const pid = Number.parseInt(pidText.split("\n", 1)[0] ?? "", 10);
    if (!Number.isInteger(pid) || pid < 1) return false;
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return true;
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return true;
    return false;
  }
};

const loopbackPortClosed = async () =>
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
const runtimeEnvironment = {
  ...postgresEnvironment,
  PGHOST: "127.0.0.1",
  PGPORT: String(port),
  PGUSER: "postgres",
  PGDATABASE: "postgres",
  PGSSLMODE: "disable",
};

try {
  const build = requirePass(
    "Stage 5 package build",
    run(corepack, ["pnpm", "--filter", "@travelos/admin-api...", "build"]),
  );
  await writeFile(
    path.join(evidenceDirectory, "package-build.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        result: "PASS",
        command: "pnpm --filter @travelos/admin-api... build",
        nodeVersion: process.version,
        stdoutSha256: createHash("sha256").update(build.stdout).digest("hex"),
      },
      null,
      2,
    )}\n`,
  );
  requirePass(
    "PostgreSQL 18.6 package preparation",
    run(process.execPath, [
      "tooling/database/prepare-postgresql-18.mjs",
      "--root",
      postgresRoot,
      "--evidence",
      path.join(evidenceDirectory, "postgresql-package-provenance.json"),
    ]),
  );
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
    `\n# TravelOS Stage 5 disposable qualification\nlisten_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = '${socketDirectory.replaceAll("'", "''")}'\npassword_encryption = 'scram-sha-256'\nssl = off\nfsync = on\nsynchronous_commit = on\nfull_page_writes = on\nlogging_collector = off\nlog_min_messages = warning\nmax_connections = 40\n`,
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
  clusterStarted = true;
  const runtimeProbe = requirePass(
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
  const [serverVersionNumber, dataChecksums, listenAddresses, observedPort] = runtimeProbe.stdout
    .trim()
    .split("|");
  if (
    serverVersionNumber !== "180006" ||
    dataChecksums !== "on" ||
    listenAddresses !== "127.0.0.1" ||
    observedPort !== String(port)
  ) {
    throw new Error(
      `Unexpected disposable PostgreSQL runtime state: ${runtimeProbe.stdout.trim()}`,
    );
  }
  await writeFile(
    path.join(evidenceDirectory, "postgresql-runtime.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        result: "PASS",
        serverVersionNumber: Number(serverVersionNumber),
        dataChecksums,
        listenAddresses,
        bindScope: "loopback-only",
        tls: "disabled only inside disposable loopback qualification",
        globalHostInstallation: false,
        ct200Actions: 0,
      },
      null,
      2,
    )}\n`,
  );
  const integration = run(
    corepack,
    [
      "pnpm",
      "exec",
      "vitest",
      "run",
      "--config",
      "tooling/testing/vitest.stage-5.config.ts",
      "--reporter=verbose",
    ],
    {
      ...runtimeEnvironment,
      TRAVELOS_STAGE5_PG_BIN: postgresBin,
      TRAVELOS_STAGE5_EVIDENCE_DIR: evidenceDirectory,
      TRAVELOS_STAGE5_WORK_ROOT: workRoot,
    },
  );
  await writeFile(
    path.join(evidenceDirectory, "integration-tests.log"),
    `${integration.stdout}${integration.stderr}`,
  );
  await writeFile(
    path.join(evidenceDirectory, "integration-test-execution.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        result: integration.exitCode === 0 ? "PASS" : "FAIL",
        command: "vitest run --config tooling/testing/vitest.stage-5.config.ts --reporter=verbose",
        exitCode: integration.exitCode,
        stdoutSha256: createHash("sha256").update(integration.stdout).digest("hex"),
        stderrSha256: createHash("sha256").update(integration.stderr).digest("hex"),
        redaction:
          "Synthetic loopback trust-auth cluster; no passwords or credential-bearing URLs emitted.",
        ct200Actions: 0,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(integration.stdout);
  process.stderr.write(integration.stderr);
  requirePass("Stage 5 PostgreSQL integration qualification", integration);
} catch (error) {
  primaryFailure = error;
} finally {
  let stopExitCode = null;
  let immediateStopExitCode = null;
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
    if (stop.exitCode !== 0) {
      const immediate = run(path.join(postgresBin, "pg_ctl"), [
        "--pgdata",
        dataDirectory,
        "--wait",
        "--timeout",
        "30",
        "stop",
        "--mode=immediate",
      ]);
      immediateStopExitCode = immediate.exitCode;
      if (immediate.exitCode !== 0 && primaryFailure === null) {
        primaryFailure = new Error(`pg_ctl stop failed: ${immediate.stderr.slice(0, 4_000)}`);
      }
    }
    const serverProcessAbsent = await processAbsent();
    const portClosed = await loopbackPortClosed();
    clusterStopped = serverProcessAbsent && portClosed;
    if (!clusterStopped && primaryFailure === null) {
      primaryFailure = new Error(
        "Disposable PostgreSQL process or loopback listener remained active",
      );
    }
  }
  if (!clusterStartAttempted) clusterStopped = true;
  const disposableRootAbsent = clusterStopped
    ? await rm(workRoot, { recursive: true, force: true }).then(
        () => true,
        () => false,
      )
    : false;
  await writeFile(
    path.join(evidenceDirectory, "disposable-cleanup.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        result: disposableRootAbsent && clusterStopped ? "PASS" : "FAIL",
        clusterStartAttempted,
        clusterStarted,
        clusterStopped,
        stopExitCode,
        immediateStopExitCode,
        disposableRootAbsent,
        retainedPostgresqlDataDirectories: disposableRootAbsent ? 0 : 1,
        retainedPackageArchives: disposableRootAbsent ? 0 : 1,
        ct200Actions: 0,
      },
      null,
      2,
    )}\n`,
  );
}

if (primaryFailure !== null) throw primaryFailure;
if (!clusterStopped) throw new Error("Disposable PostgreSQL shutdown was not confirmed");
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, result: "PASS", ct200Actions: 0 })}\n`);
