// Local disposable subset only: never an aggregate Stage 10 qualification receipt.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, appendFile, rm, readFile, writeFile, copyFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PREDECESSOR, MIGRATION_HEAD } from "./constants.mjs";
import { stopPostgres } from "./stage10-runtime-api-postgres.mjs";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const artifact = process.env.TRAVELOS_STAGE10_EXTRACTED_ROOT,
  pg = process.env.TRAVELOS_STAGE10_PG_ROOT,
  archive = process.env.TRAVELOS_STAGE9_ACCEPTED_ARCHIVE;
const run = (program, args, env, cwd = repo) => {
  const r = spawnSync(program, args, {
    env,
    cwd,
    encoding: "utf8",
    timeout: 90000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) throw Error(`command ${path.basename(program)} failed`);
  return r.stdout;
};
const hash = async (file) => {
  const h = createHash("sha256");
  for await (const b of createReadStream(file)) h.update(b);
  return h.digest("hex");
};
const port = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close((e) => (e ? reject(e) : resolve(p)));
    });
  });
let work,
  started = false,
  stopped,
  ok = false,
  phase = "inputs";
let pgEnv, bin, data;
try {
  assert.ok([artifact, pg, archive].every((x) => x && path.isAbsolute(x)));
  assert.equal(await hash(archive), PREDECESSOR.archiveSha256);
  const node = path.join(artifact, "runtime/node/bin/node");
  assert.equal(run(node, ["--version"], process.env).trim(), "v24.19.0");
  bin = path.join(pg, "usr/lib/postgresql/18/bin");
  pgEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LD_LIBRARY_PATH: [
      path.join(pg, "usr/lib/x86_64-linux-gnu"),
      path.join(pg, "usr/lib/postgresql/18/lib"),
    ].join(":"),
  };
  assert.match(run(path.join(bin, "postgres"), ["--version"], pgEnv), / 18\.6\b/u);
  phase = "predecessor extraction";
  work = await mkdtemp(path.join(os.tmpdir(), "stage10-cumulative-pg-"));
  const predecessor = path.join(work, "accepted");
  await mkdir(predecessor, { mode: 0o700 });
  run(
    "tar",
    ["-xzf", archive, "-C", predecessor, "--no-same-owner", "--no-same-permissions"],
    process.env,
  );
  const release = JSON.parse(await readFile(path.join(predecessor, "release.json"), "utf8"));
  assert.equal(release.artifactId, PREDECESSOR.artifactId);
  phase = "postgres setup";
  data = path.join(work, "data");
  const dbPort = await port();
  run(
    path.join(bin, "initdb"),
    [
      "-D",
      data,
      "-L",
      path.join(pg, "usr/share/postgresql/18"),
      "-U",
      "postgres",
      "--encoding=UTF8",
      "--locale=C.UTF-8",
      "--auth-local=trust",
      "--auth-host=trust",
      "--no-instructions",
    ],
    pgEnv,
  );
  await appendFile(
    path.join(data, "postgresql.conf"),
    // Every client below uses the private loopback port. Do not create an
    // unused Unix socket whose path can exceed sockaddr_un in nested adapters.
    `\nlisten_addresses='127.0.0.1'\nport=${dbPort}\nunix_socket_directories=''\n`,
  );
  started = true;
  run(
    path.join(bin, "pg_ctl"),
    ["-D", data, "-l", path.join(work, "postgres.log"), "-w", "-t", "30", "start"],
    pgEnv,
  );
  const pgenv = {
    ...pgEnv,
    PGHOST: "127.0.0.1",
    PGPORT: String(dbPort),
    PGUSER: "postgres",
    PGDATABASE: "postgres",
    PGSSLMODE: "disable",
  };
  assert.equal(
    run(
      path.join(bin, "psql"),
      ["-XAt", "-c", "select current_setting('server_version_num')"],
      pgenv,
    ).trim(),
    "180006",
  );
  run(
    path.join(bin, "psql"),
    [
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "database_name=travelos_cumulative",
      "-f",
      path.join(repo, "deploy/database/bootstrap-database-and-roles.sql"),
    ],
    pgenv,
  );
  const migrationEnv = {
    ...pgEnv,
    TRAVELOS_DB_HOST: "127.0.0.1",
    TRAVELOS_DB_PORT: String(dbPort),
    TRAVELOS_DB_NAME: "travelos_cumulative",
    TRAVELOS_DB_MIGRATOR_ROLE: "travelos_migrator",
    TRAVELOS_DB_OWNER_ROLE: "travelos_owner",
    TRAVELOS_DB_TLS_POLICY: "DISABLED_LOOPBACK_ONLY",
    TRAVELOS_ALLOW_TRUST_AUTH_FOR_TESTS: "true",
  };
  const migrate = (root) => {
    const out = run(
      node,
      [path.join(root, "migrator/dist/packages/migrator/src/run-migrations.js"), "up"],
      migrationEnv,
      root,
    );
    const start = out.indexOf("{");
    assert.ok(start >= 0);
    return JSON.parse(out.slice(start));
  };
  phase = "accepted predecessor migration";
  const partial = path.join(work, "stage6");
  await mkdir(partial);
  const manifest = JSON.parse(
    await readFile(path.join(predecessor, "migrations/checksums.json"), "utf8"),
  );
  const end = manifest.migrations.findIndex((x) => x.file === "0011_stage6_trip_publication.cjs");
  assert.ok(end >= 0);
  manifest.migrations = manifest.migrations.slice(0, end + 1);
  for (const x of manifest.migrations)
    await copyFile(path.join(predecessor, "migrations", x.file), path.join(partial, x.file));
  await writeFile(path.join(partial, "checksums.json"), JSON.stringify(manifest));
  const runner = path.join(predecessor, "migrator/dist/tooling/database/migration-runner.js");
  const code = `import {runMigrationChain} from ${JSON.stringify("file://" + runner)}; await runMigrationChain(${JSON.stringify({ host: "127.0.0.1", port: dbPort, database: "travelos_cumulative", migratorRole: "travelos_migrator", ownerRole: "travelos_owner", tls: { mode: "DISABLED_LOOPBACK_ONLY" }, allowTrustAuthenticationForTests: true })},${JSON.stringify({ directory: partial, checksumManifestPath: path.join(partial, "checksums.json") })});`;
  run(node, ["--input-type=module", "-e", code], migrationEnv, predecessor);
  const sql = (text) =>
    run(
      path.join(bin, "psql"),
      ["-X", "-v", "ON_ERROR_STOP=1", "-d", "travelos_cumulative", "-c", text],
      pgenv,
    );
  sql(
    `INSERT INTO organization.agency (id,"bootstrapReference",slug) VALUES ('00000000-0000-7000-8000-000000000070','stage10-synthetic','stage10-synthetic')`,
  );
  const first = migrate(predecessor);
  assert.equal(first.currentVersion, MIGRATION_HEAD);
  assert.ok(first.appliedMigrations.length > 0);
  phase = "successor compatibility";
  const next = migrate(artifact);
  assert.equal(next.currentVersion, MIGRATION_HEAD);
  assert.deepEqual(next.appliedMigrations, []);
  assert.deepEqual(migrate(artifact).appliedMigrations, []);
  assert.equal(
    run(
      path.join(bin, "psql"),
      [
        "-XAt",
        "-d",
        "travelos_cumulative",
        "-c",
        "SELECT count(*) FROM organization.agency WHERE slug='stage10-synthetic'",
      ],
      pgenv,
    ).trim(),
    "1",
  );
  phase = "constraint and privilege probes";
  sql(
    `DO $$ BEGIN BEGIN INSERT INTO organization.agency (id,"bootstrapReference",slug) VALUES ('00000000-0000-7000-8000-000000000071','stage10-synthetic','stage10-synthetic'); RAISE EXCEPTION 'duplicate accepted'; EXCEPTION WHEN unique_violation THEN NULL; END; END $$`,
  );
  sql(
    `DO $$ BEGIN SET LOCAL ROLE travelos_portal_api; BEGIN PERFORM id FROM staff_access.staff_invitation LIMIT 1; RAISE EXCEPTION 'portal access accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; RESET ROLE; END $$`,
  );
  ok = true;
} catch (error) {
  const kind =
    error.code === "ERR_ASSERTION"
      ? "assertion"
      : error instanceof SyntaxError
        ? "invalid-json"
        : /^command [a-zA-Z0-9._-]+ failed$/.test(error.message)
          ? error.message
          : "error";
  process.stderr.write(
    JSON.stringify({ result: "FAIL", code: "CUMULATIVE_POSTGRES_FAILED", stage: phase, kind }) +
      "\n",
  );
  process.exitCode = 1;
} finally {
  if (started) stopped = stopPostgres({ pgCtl: path.join(bin, "pg_ctl"), data, env: pgEnv });
  else stopped = true;
  if (!stopped) {
    process.stderr.write(
      JSON.stringify({ result: "FAIL", code: "POSTGRES_SHUTDOWN_UNVERIFIED" }) + "\n",
    );
    process.exitCode = 1;
  }
  if (work && stopped) await rm(work, { recursive: true, force: true });
}
if (ok && stopped)
  process.stdout.write(
    JSON.stringify({
      result: "SUBSET_PASS",
      covered: [
        "accepted-predecessor-chain-with-stage6-agency-seed",
        "accepted-predecessor-to-stage10-noop",
        "synthetic-data-preserved",
        "constraint-enforcement",
        "role-denial",
      ],
      remaining: [
        "full-cumulative-stage6-stage9-postgresql-and-browser-gates",
        "other-supported-predecessors-and-representative-data",
        "complete-constraint-and-privilege-matrix",
        "exact-artifact-provenance-and-aggregate-qualification",
        "operational-security-and-deployment",
      ],
      postgresStopped: true,
    }) + "\n",
  );
