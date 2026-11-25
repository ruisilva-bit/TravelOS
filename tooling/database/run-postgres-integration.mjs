import {
  appendFile,
  chmod,
  chown,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

import { disposableRootPrefix, provisionPostgresql } from "./provision-postgresql-18.mjs";

// Unified disposable PostgreSQL 18.6 runner for every tests/integration/*.test.ts file.
// Each file gets its own fresh loopback-only cluster (as the historical per-stage runners did);
// nothing is written into the repository except gitignored package build output.
const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const lockPath = path.join(repositoryRoot, "tooling/database/postgresql-18.6-packages.lock.json");
const vitestConfig = "tooling/testing/vitest.postgres.config.ts";
const vitestBin = path.join(repositoryRoot, "node_modules/.bin/vitest");
const corepack = path.join(path.dirname(process.execPath), "corepack");
const only = process.argv.slice(2).filter((argument) => !argument.startsWith("-"));

const runRoot = await mkdtemp(path.join(os.tmpdir(), disposableRootPrefix));
const packageRoot = path.join(runRoot, "postgres-root");
const postgresBin = path.join(packageRoot, "usr/lib/postgresql/18/bin");
const postgresShare = path.join(packageRoot, "usr/share/postgresql/18");
const baseEnvironment = {
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

const run = (command, args, env = baseEnvironment) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? String(result.error) : ""),
  };
};
// PostgreSQL refuses to run as root; when the runner is root, the server-side tools (initdb,
// pg_ctl) are executed as the unprivileged "nobody" uid/gid via setpriv. Clients stay as-is.
const serverUid = 65_534;
const asServer = (command, args) =>
  process.getuid?.() === 0
    ? [
        "setpriv",
        [`--reuid=${serverUid}`, `--regid=${serverUid}`, "--clear-groups", command, ...args],
      ]
    : [command, args];
const runServerTool = (command, args) => run(...asServer(command, args));
const requirePass = (label, result) => {
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed: ${result.stderr.slice(0, 4_000)}`);
  }
  return result;
};
const freeLoopbackPort = () =>
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
const portClosed = (port) =>
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

// Stage 3/4/5/7/8/9 suites are pinned to their own migration head; they receive the checksummed prefix
// of the authoritative chain ending at that head (see vitest.postgres.config.ts).
const prefixChainLengths = {
  "stage-3-postgresql.test.ts": 3,
  "stage-4-postgresql.test.ts": 6,
  "stage-5-postgresql.test.ts": 10,
  "stage-7-postgresql.test.ts": 16,
  "stage-8-postgresql.test.ts": 16,
  "stage-9-staff-invitations-postgresql.test.ts": 16,
};
const writePrefixChain = async (directory, length) => {
  const source = path.join(repositoryRoot, "migrations");
  const manifest = JSON.parse(await readFile(path.join(source, "checksums.json"), "utf8"));
  const kept = manifest.migrations.slice(0, length);
  await mkdir(directory, { recursive: true });
  for (const { file } of kept) await cp(path.join(source, file), path.join(directory, file));
  await writeFile(
    path.join(directory, "checksums.json"),
    `${JSON.stringify({ ...manifest, migrations: kept }, null, 2)}\n`,
  );
};

const runFile = async (file, extraEnvironment) => {
  const workRoot = await mkdtemp(path.join(os.tmpdir(), `${disposableRootPrefix}work-`));
  const serverDirectory = path.join(workRoot, "pg");
  const dataDirectory = path.join(serverDirectory, "data");
  const socketDirectory = path.join(serverDirectory, "socket");
  const jsonReport = path.join(workRoot, "vitest-report.json");
  const entry = { file, result: "FAIL", passed: 0, failed: 0, skipped: 0, failures: [] };
  let port = null;
  let started = false;
  let failure = null;
  try {
    port = await freeLoopbackPort();
    await mkdir(serverDirectory, { recursive: true });
    await mkdir(socketDirectory, { recursive: true });
    if (process.getuid?.() === 0) {
      await chmod(workRoot, 0o755);
      for (const directory of [serverDirectory, socketDirectory]) {
        await chown(directory, serverUid, serverUid);
      }
    }
    requirePass(
      "initdb",
      runServerTool(path.join(postgresBin, "initdb"), [
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
      `\n# TravelOS disposable integration cluster\nlisten_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = '${socketDirectory.replaceAll("'", "''")}'\npassword_encryption = 'scram-sha-256'\nssl = off\nfsync = on\nsynchronous_commit = on\nfull_page_writes = on\nlogging_collector = off\nlog_min_messages = warning\nmax_connections = 40\n`,
    );
    started = true;
    requirePass(
      "pg_ctl start",
      runServerTool(path.join(postgresBin, "pg_ctl"), [
        "--pgdata",
        dataDirectory,
        "--log",
        path.join(serverDirectory, "postgres.log"),
        "--wait",
        "--timeout",
        "30",
        "start",
      ]),
    );
    const runtimeEnvironment = {
      ...baseEnvironment,
      PGHOST: "127.0.0.1",
      PGPORT: String(port),
      PGUSER: "postgres",
      PGDATABASE: "postgres",
      PGSSLMODE: "disable",
    };
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
    const [version, checksums, listenAddresses, observedPort] = probe.stdout.trim().split("|");
    if (
      version !== "180006" ||
      checksums !== "on" ||
      listenAddresses !== "127.0.0.1" ||
      observedPort !== String(port)
    ) {
      throw new Error(`Unexpected disposable PostgreSQL state: ${probe.stdout.trim()}`);
    }
    entry.postgresVersion = "18.6";

    const environment = { ...runtimeEnvironment };
    for (const stage of ["3", "4", "5", "6", "7", "8"]) {
      environment[`TRAVELOS_STAGE${stage}_PG_BIN`] = postgresBin;
      environment[`TRAVELOS_STAGE${stage}_WORK_ROOT`] = workRoot;
    }
    // Stage 3 requires the PostgreSQL binaries to live below its work root and writes its own
    // synthetic output files there; everything is removed with the run root.
    environment["TRAVELOS_STAGE3_WORK_ROOT"] = runRoot;
    environment["TRAVELOS_STAGE3_EVIDENCE_DIR"] = path.join(runRoot, "stage3-output");
    for (const inherited of [
      "TRAVELOS_STAGE7_ARTIFACT_ROOT",
      "TRAVELOS_STAGE8_ARTIFACT_ROOT",
      "TRAVELOS_STAGE7_EVIDENCE_DIR",
    ]) {
      delete environment[inherited];
    }
    if (prefixChainLengths[file] !== undefined) {
      environment["TRAVELOS_POSTGRES_PREFIX_CHAIN_DIR"] = path.join(workRoot, "prefix-chain");
      await writePrefixChain(
        environment["TRAVELOS_POSTGRES_PREFIX_CHAIN_DIR"],
        prefixChainLengths[file],
      );
    }
    if (file === "stage-3-postgresql.test.ts") {
      environment["TRAVELOS_POSTGRES_NO_SOURCE_ALIASES"] = "1";
    }
    Object.assign(environment, extraEnvironment);
    const integration = run(
      vitestBin,
      [
        "run",
        "--config",
        vitestConfig,
        `tests/integration/${file}`,
        "--reporter=json",
        `--outputFile.json=${jsonReport}`,
      ],
      environment,
    );
    try {
      const report = JSON.parse(await readFile(jsonReport, "utf8"));
      entry.passed = report.numPassedTests;
      entry.failed = report.numFailedTests;
      entry.skipped = report.numPendingTests + (report.numTodoTests ?? 0);
      for (const suite of report.testResults) {
        if (suite.status === "failed" && suite.message) {
          entry.failures.push({ suite: "(suite)", message: suite.message.slice(0, 1_500) });
        }
        for (const assertion of suite.assertionResults) {
          if (assertion.status === "failed") {
            entry.failures.push({
              test: assertion.fullName,
              message: (assertion.failureMessages ?? []).join("\n").slice(0, 1_500),
            });
          }
        }
      }
    } catch {
      entry.failures.push({
        suite: "(report)",
        message: `${integration.stdout}${integration.stderr}`.slice(0, 3_000),
      });
    }
    if (integration.exitCode !== 0) {
      entry.failures.push({
        suite: "(vitest stderr tail)",
        message: `${integration.stdout}${integration.stderr}`.slice(-2_500),
      });
    }
    entry.result =
      integration.exitCode === 0 && entry.failed === 0 && entry.passed > 0 ? "PASS" : "FAIL";
  } catch (error) {
    failure = error;
    entry.failures.push({ suite: "(runner)", message: String(error).slice(0, 3_000) });
  } finally {
    let clusterStopped = true;
    if (started) {
      const stop = runServerTool(path.join(postgresBin, "pg_ctl"), [
        "--pgdata",
        dataDirectory,
        "--wait",
        "--timeout",
        "30",
        "stop",
        "--mode=fast",
      ]);
      clusterStopped = stop.exitCode === 0 && port !== null && (await portClosed(port));
    }
    if (!clusterStopped) {
      entry.result = "FAIL";
      entry.failures.push({ suite: "(cleanup)", message: "Disposable PostgreSQL did not stop" });
    } else {
      await rm(workRoot, { recursive: true, force: true });
    }
    entry.cleanup = clusterStopped ? "stopped-and-removed" : "cluster-still-running";
    void failure;
  }
  return entry;
};

const buildEnvironment = {
  ...process.env,
  PATH: `${path.dirname(process.execPath)}:${process.env["PATH"] ?? ""}`,
};
const files = [];
let fatal = null;
const summary = {
  result: "FAIL",
  postgresVersion: null,
  bindScope: "127.0.0.1 only",
  files,
};
try {
  const all = (await readdir(path.join(repositoryRoot, "tests/integration")))
    .filter((name) => name.endsWith(".test.ts"))
    .sort();
  const selected = only.length === 0 ? all : all.filter((name) => only.includes(name));
  if (selected.length === 0) throw new Error("No integration test files selected");

  const provisioned = await provisionPostgresql({ lockPath, root: packageRoot });
  await chmod(runRoot, 0o755);
  await chmod(packageRoot, 0o755);
  summary.postgresVersion = provisioned.postgresql.serverVersion;
  for (const filter of [
    "@travelos/database...",
    "@travelos/admin-api...",
    "@travelos/portal-api...",
    "@travelos/worker...",
  ]) {
    const build = run(corepack, ["pnpm", "--filter", filter, "build"], buildEnvironment);
    if (build.exitCode !== 0) {
      process.stderr.write(`${build.stdout}${build.stderr}`.slice(-4_000));
    }
    requirePass(`build ${filter}`, build);
  }
  // Stage 6 runs its packaged-migrator regression against an extracted artifact root that holds
  // only the standalone migrator package (built by the repository's own packaging script).
  const stage6ArtifactRoot = path.join(runRoot, "stage6-artifact");
  if (selected.includes("stage-6-publication-postgresql.test.ts")) {
    await mkdir(stage6ArtifactRoot, { recursive: true });
    requirePass(
      "@travelos/migrator build",
      run(corepack, ["pnpm", "--filter", "@travelos/migrator...", "build"], buildEnvironment),
    );
    // Same packaging as tooling/ci/test-stage6-migrator-package.mjs minus its historical
    // migration-head assertion (which that script pins to 0011).
    const migratorTarget = path.join(stage6ArtifactRoot, "migrator");
    requirePass(
      "standalone migrator package",
      run(
        corepack,
        [
          "pnpm",
          "--config.inject-workspace-packages=true",
          "--filter",
          "@travelos/migrator",
          "deploy",
          "--prod",
          migratorTarget,
        ],
        { ...buildEnvironment, CI: "true", NODE_ENV: "development" },
      ),
    );
    await cp(path.join(repositoryRoot, "migrations"), path.join(migratorTarget, "migrations"), {
      recursive: true,
      errorOnExist: true,
    });
  }
  for (const file of selected) {
    const extraEnvironment =
      file === "stage-6-publication-postgresql.test.ts"
        ? { TRAVELOS_STAGE8_ARTIFACT_ROOT: stage6ArtifactRoot }
        : {};
    const entry = await runFile(file, extraEnvironment);
    files.push(entry);
  }
  summary.result =
    files.length === selected.length && files.every((entry) => entry.result === "PASS")
      ? "PASS"
      : "FAIL";
} catch (error) {
  fatal = error;
  summary.error = String(error).slice(0, 3_000);
} finally {
  await rm(runRoot, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
if (fatal !== null || summary.result !== "PASS") process.exitCode = 1;
