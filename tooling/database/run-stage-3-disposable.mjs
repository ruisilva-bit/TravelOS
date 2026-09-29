import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.resolve(
  process.env["TRAVELOS_STAGE3_EVIDENCE_DIR"] ??
    path.join(repositoryRoot, "docs/evidence/phase-1-m1/stage-3"),
);
if (
  path.dirname(evidenceDirectory) !== path.join(repositoryRoot, "docs/evidence/phase-1-m1") ||
  !["stage-3", "stage-3-focused"].includes(path.basename(evidenceDirectory))
) {
  throw new Error("Stage 3 output must be the final or focused evidence directory");
}
await rm(evidenceDirectory, { recursive: true, force: true });
await mkdir(evidenceDirectory, { recursive: true });

const workRoot = await mkdtemp(path.join(os.tmpdir(), "travelos-stage3-"));
const postgresRoot = path.join(workRoot, "postgres-root");
const dataDirectory = path.join(workRoot, "data");
const socketDirectory = path.join(workRoot, "socket");
const postgresLog = path.join(workRoot, "postgres.log");
const postgresBin = path.join(postgresRoot, "usr/lib/postgresql/18/bin");
const postgresShare = path.join(postgresRoot, "usr/share/postgresql/18");
const corepack = path.join(path.dirname(process.execPath), "corepack");
let clusterStarted = false;
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

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env: options.env ?? postgresEnvironment,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? String(result.error) : ""),
  };
};

const requirePass = (label, result) => {
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed: ${result.stderr.slice(0, 4_000)}`);
  }
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
        reject(new Error("Unable to allocate disposable PostgreSQL port"));
        return;
      }
      const selected = address.port;
      server.close((error) => (error ? reject(error) : resolve(selected)));
    });
  });

const port = await freeLoopbackPort();

try {
  // Rebuild the public persistence package graph before the native import tests.
  const build = requirePass(
    "Stage 3 persistence package build",
    run(corepack, ["pnpm", "--filter", "@travelos/database...", "build"]),
  );
  await writeFile(
    path.join(evidenceDirectory, "persistence-build.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        result: "PASS",
        exitCode: build.exitCode,
        command: "pnpm --filter @travelos/database... build",
        nodeVersion: process.version,
        stdoutSha256: createHash("sha256").update(build.stdout).digest("hex"),
      },
      null,
      2,
    )}\n`,
  );
  requirePass(
    "PostgreSQL package preparation",
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
    `\n# TravelOS Stage 3 disposable qualification\nlisten_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = '${socketDirectory.replaceAll("'", "''")}'\npassword_encryption = 'scram-sha-256'\nssl = off\nfsync = on\nsynchronous_commit = on\nfull_page_writes = on\nlogging_collector = off\nlog_min_messages = warning\nmax_connections = 40\n`,
  );

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

  const runtimeEnvironment = {
    ...postgresEnvironment,
    PGHOST: "127.0.0.1",
    PGPORT: String(port),
    PGUSER: "postgres",
    PGDATABASE: "postgres",
    PGSSLMODE: "disable",
  };
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
      { env: runtimeEnvironment },
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
  const serverVersion = requirePass(
    "postgres --version",
    run(path.join(postgresBin, "postgres"), ["--version"]),
  ).stdout.trim();
  const clientVersion = requirePass(
    "psql --version",
    run(path.join(postgresBin, "psql"), ["--version"]),
  ).stdout.trim();
  await writeFile(
    path.join(evidenceDirectory, "postgresql-runtime.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        result: "PASS",
        serverVersion,
        clientVersion,
        serverVersionNumber: Number(serverVersionNumber),
        dataChecksums,
        listenAddresses,
        bindScope: "loopback-only",
        tls: "disabled only inside disposable loopback qualification",
        globalHostInstallation: false,
        dockerOrPodman: false,
      },
      null,
      2,
    )}\n`,
  );

  const testEnvironment = {
    ...runtimeEnvironment,
    TRAVELOS_STAGE3_PG_BIN: postgresBin,
    TRAVELOS_STAGE3_EVIDENCE_DIR: evidenceDirectory,
    TRAVELOS_STAGE3_WORK_ROOT: workRoot,
  };
  const integration = run(
    corepack,
    [
      "pnpm",
      "exec",
      "vitest",
      "run",
      "--config",
      "tooling/testing/vitest.stage-3.config.ts",
      "--reporter=verbose",
      ...(process.argv.includes("--focused")
        ? ["--testNamePattern=bootstraps|establishes|privilege matrix|commits"]
        : []),
    ],
    { env: testEnvironment },
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
        command: "vitest run --config tooling/testing/vitest.stage-3.config.ts --reporter=verbose",
        exitCode: integration.exitCode,
        stdoutSha256: createHash("sha256").update(integration.stdout).digest("hex"),
        stderrSha256: createHash("sha256").update(integration.stderr).digest("hex"),
        redaction:
          "Synthetic loopback trust-auth cluster; no passwords or credential-bearing URLs used.",
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(integration.stdout);
  process.stderr.write(integration.stderr);
  requirePass("Stage 3 PostgreSQL integration qualification", integration);
} catch (error) {
  primaryFailure = error;
} finally {
  if (clusterStarted) {
    const stop = run(path.join(postgresBin, "pg_ctl"), [
      "--pgdata",
      dataDirectory,
      "--wait",
      "--timeout",
      "30",
      "stop",
      "--mode=fast",
    ]);
    clusterStopped = stop.exitCode === 0;
    if (stop.exitCode !== 0 && primaryFailure === null) {
      primaryFailure = new Error(`pg_ctl stop failed: ${stop.stderr.slice(0, 4_000)}`);
    }
  }
  await rm(workRoot, { recursive: true, force: true });
  const disposableRootAbsent = await stat(workRoot).then(
    () => false,
    () => true,
  );
  await writeFile(
    path.join(evidenceDirectory, "disposable-cleanup.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        result: disposableRootAbsent && clusterStopped ? "PASS" : "FAIL",
        clusterStopped,
        disposableRootAbsent,
        retainedPostgresqlDataDirectories: 0,
        retainedPackageArchives: 0,
        ct200Actions: 0,
      },
      null,
      2,
    )}\n`,
  );
}

if (primaryFailure !== null) throw primaryFailure;
if (!clusterStopped) throw new Error("Disposable cluster shutdown was not confirmed");
process.stdout.write(
  `${JSON.stringify({ schemaVersion: 1, result: "PASS", evidenceDirectory, ct200Actions: 0 })}\n`,
);
