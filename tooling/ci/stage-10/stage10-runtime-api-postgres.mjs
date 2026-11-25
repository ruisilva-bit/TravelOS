// Disposable local API/PG subset, not Stage 10 qualification or browser evidence.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  createRuntimeTotpGenerator,
  resolveRuntimePackageImport,
} from "../stage-7/runtime-acceptance-runner.mjs";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, appendFile, rm, copyFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const artifact = process.env.TRAVELOS_STAGE10_EXTRACTED_ROOT;
const pgRoot = process.env.TRAVELOS_STAGE10_PG_ROOT;
const bin = pgRoot && path.join(pgRoot, "usr/lib/postgresql/18/bin");
const node = artifact && path.join(artifact, "runtime/node/bin/node");
const run = (program, args, env, cwd = repo) => {
  const r = spawnSync(program, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 90000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0)
    throw new Error(`command failed: ${path.basename(program)} (${r.status ?? "timeout"})`);
  return r.stdout;
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
const request = (p, host, route, options = {}) =>
  new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: p,
        path: route,
        method: payload ? "POST" : "GET",
        headers: {
          host,
          origin: `http://${host}`,
          ...(payload ? { "content-type": "application/json" } : {}),
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
        timeout: 2000,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (x) => {
          body += x;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode, body, cookies: res.headers["set-cookie"] ?? [] }),
        );
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", reject);
    req.end(payload);
  });
// pg_ctl's status exit 3 means no server; all other results are running or unknown.
// Bound every attempt, escalate a failed or unverified fast stop, and never infer
// cleanup from the stop command alone (including a timed-out pg_ctl).
export function stopPostgres({ pgCtl, data, env }) {
  const invoke = (args, timeout) =>
    spawnSync(pgCtl, ["-D", data, ...args], {
      env,
      stdio: "ignore",
      timeout,
      killSignal: "SIGKILL",
    });
  const stopped = () => {
    const r = invoke(["status"], 3000);
    return !r.error && r.status === 3;
  };
  const fast = invoke(["-w", "-t", "10", "stop", "-m", "fast"], 12000);
  if (!fast.error && fast.status === 0 && stopped()) return true;
  invoke(["-w", "-t", "10", "stop", "-m", "immediate"], 12000);
  return stopped();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let work,
    started = false,
    completed = false,
    cleanupOk = true,
    phase = "prerequisites";
  const children = [];
  try {
    assert.ok(
      artifact && pgRoot && path.isAbsolute(artifact) && path.isAbsolute(pgRoot),
      "explicit absolute artifact and PG package roots required",
    );
    assert.equal(run(node, ["--version"], process.env).trim(), "v24.19.0");
    phase = "postgres setup";
    const pgEnv = {
      ...process.env,
      LD_LIBRARY_PATH: [
        path.join(pgRoot, "usr/lib/x86_64-linux-gnu"),
        path.join(pgRoot, "usr/lib/postgresql/18/lib"),
      ].join(":"),
    };
    assert.match(run(path.join(bin, "postgres"), ["--version"], pgEnv), / 18\.6\b/u);
    work = await mkdtemp(path.join(os.tmpdir(), "stage10-api-pg-"));
    const data = path.join(work, "data"),
      socket = path.join(work, "socket");
    await mkdir(socket, { mode: 0o700 });
    const dbPort = await port();
    let adminPort = await port(),
      portalPort = await port();
    while (portalPort === adminPort || portalPort === dbPort) portalPort = await port();
    while (adminPort === dbPort || adminPort === portalPort) adminPort = await port();
    run(
      path.join(bin, "initdb"),
      [
        "-D",
        data,
        "-L",
        path.join(pgRoot, "usr/share/postgresql/18"),
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
      `\nlisten_addresses='127.0.0.1'\nport=${dbPort}\nunix_socket_directories='${socket.replaceAll("'", "''")}'\n`,
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
    const version = run(
      path.join(bin, "psql"),
      ["-XAt", "-c", "select current_setting('server_version_num')"],
      pgenv,
    ).trim();
    assert.equal(version, "180006");
    run(
      path.join(bin, "psql"),
      [
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "database_name=travelos_stage10_api",
        "-f",
        path.join(repo, "deploy/database/bootstrap-database-and-roles.sql"),
      ],
      pgenv,
    );
    const migrationEnv = {
      ...pgEnv,
      TRAVELOS_DB_HOST: "127.0.0.1",
      TRAVELOS_DB_PORT: String(dbPort),
      TRAVELOS_DB_NAME: "travelos_stage10_api",
      TRAVELOS_DB_MIGRATOR_ROLE: "travelos_migrator",
      TRAVELOS_DB_OWNER_ROLE: "travelos_owner",
      TRAVELOS_DB_TLS_POLICY: "DISABLED_LOOPBACK_ONLY",
      TRAVELOS_ALLOW_TRUST_AUTH_FOR_TESTS: "true",
    };
    const migrationRunner = path.join(
      artifact,
      "migrator/dist/packages/migrator/src/run-migrations.js",
    );
    const predecessorDir = path.join(work, "predecessor");
    await mkdir(predecessorDir);
    const checksum = JSON.parse(
      await readFile(path.join(artifact, "migrations/checksums.json"), "utf8"),
    );
    const end = checksum.migrations.findIndex((x) => x.file === "0011_stage6_trip_publication.cjs");
    assert.ok(end >= 0);
    checksum.migrations = checksum.migrations.slice(0, end + 1);
    for (const entry of checksum.migrations)
      await copyFile(
        path.join(artifact, "migrations", entry.file),
        path.join(predecessorDir, entry.file),
      );
    const checksumPath = path.join(predecessorDir, "checksums.json");
    await writeFile(checksumPath, JSON.stringify(checksum));
    const { runMigrationChain } = await import(
      path.join(artifact, "migrator/dist/tooling/database/migration-runner.js")
    );
    await runMigrationChain(
      {
        host: "127.0.0.1",
        port: dbPort,
        database: "travelos_stage10_api",
        migratorRole: "travelos_migrator",
        ownerRole: "travelos_owner",
        tls: { mode: "DISABLED_LOOPBACK_ONLY" },
        allowTrustAuthenticationForTests: true,
      },
      { directory: predecessorDir, checksumManifestPath: checksumPath },
    );
    run(
      path.join(bin, "psql"),
      [
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        "travelos_stage10_api",
        "-c",
        `INSERT INTO organization.agency (id, "bootstrapReference", slug) VALUES ('00000000-0000-7000-8000-000000000070','stage10-synthetic','stage10-synthetic')`,
      ],
      pgenv,
    );
    run(node, [migrationRunner, "up"], migrationEnv, artifact);
    phase = "service startup";
    const manifest = JSON.parse(
      await readFile(path.join(artifact, "instance-manifest/development.example.json"), "utf8"),
    );
    manifest.database.name = "travelos_stage10_api";
    manifest.database.port = dbPort;
    manifest.runtime.listeners.adminApi.port = adminPort;
    manifest.runtime.listeners.portalApi.port = portalPort;
    const manifestFile = path.join(work, "manifest.json");
    await writeFile(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
    for (const [service, files] of [
      ["admin-api", ["admin-api-db", "staff-auth-realm"]],
      ["portal-api", ["portal-api-db", "portal-auth-realm"]],
    ]) {
      const dir = path.join(work, service);
      await mkdir(dir, { mode: 0o700 });
      for (const name of files)
        await writeFile(path.join(dir, name), randomBytes(48).toString("hex"), { mode: 0o600 });
      const executable =
        process.env.TRAVELOS_STAGE10_TEST_SPAWN_FAILURE === "1" && service === "admin-api"
          ? path.join(work, "missing-node")
          : node;
      const child = spawn(
        executable,
        [path.join(artifact, "apps", service, "dist/main.js"), `--manifest=${manifestFile}`],
        { env: { ...pgEnv, CREDENTIALS_DIRECTORY: dir }, stdio: "ignore" },
      );
      child.spawnError = false;
      child.on("error", () => {
        child.spawnError = true;
      });
      child.closed = new Promise((resolve) => child.once("close", resolve));
      children.push(child);
    }
    for (const [index, [p, host]] of [
      [adminPort, manifest.hosts.admin],
      [portalPort, manifest.hosts.portal],
    ].entries()) {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (
          children[index].spawnError ||
          children[index].exitCode !== null ||
          children[index].signalCode !== null
        )
          break;
        try {
          if ((await request(p, host, "/health/live")).status === 200) {
            ready = true;
            break;
          }
        } catch {
          /* Service may not be listening yet; retry until the startup deadline. */
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!ready)
        throw new Error(
          `service startup ${index === 0 ? "admin" : "portal"} spawnError=${children[index].spawnError} exit=${children[index].exitCode ?? "none"} signal=${children[index].signalCode ?? "none"}`,
        );
      assert.equal(
        (await request(p, "invalid.travelos.test", "/health/live")).status,
        404,
        "unknown host denial",
      );
    }
    for (const [p, host, wrong] of [
      [adminPort, manifest.hosts.admin, "portal"],
      [portalPort, manifest.hosts.portal, "staff"],
    ]) {
      const response = await request(p, host, `/api/auth/${wrong}/get-session`);
      assert.equal(response.status, 404, "cross-realm route denial");
    }
    phase = "synthetic authentication";
    // Enrollment uses the packaged DEVELOPMENT-only Better Auth operators, not a public signup route.
    const appRoot = path.join(artifact, "apps/admin-api");
    const adapterEntry = await resolveRuntimePackageImport({
      appRoot,
      packageName: "@travelos/auth-adapters",
    });
    const adapter = await import(adapterEntry);
    const realm = await import(new URL("./realm.js", adapterEntry));
    const db = adapter.createAuthRealmPostgresDatabase({
      host: "127.0.0.1",
      port: dbPort,
      database: "travelos_stage10_api",
      user: "postgres",
      password: "",
      tls: { mode: "DISABLED_LOOPBACK_ONLY" },
      applicationName: "stage10-synthetic-fixture",
    });
    try {
      const staff = {
        email: `stage10-${randomUUID()}@example.test`,
        password: randomBytes(32).toString("base64url"),
      };
      const portal = {
        email: `stage10-${randomUUID()}@example.test`,
        password: randomBytes(32).toString("base64url"),
      };
      const staffKey = await readFile(path.join(work, "admin-api/staff-auth-realm"), "utf8");
      const portalKey = await readFile(path.join(work, "portal-api/portal-auth-realm"), "utf8");
      const staffConfig = {
        database: db.database,
        canonicalOrigin: `http://${manifest.hosts.admin}`,
        realmKeyMaterial: staffKey,
        environment: "DEVELOPMENT",
      };
      const portalConfig = {
        database: db.database,
        canonicalOrigin: `http://${manifest.hosts.portal}`,
        realmKeyMaterial: portalKey,
        environment: "DEVELOPMENT",
      };
      const signup = await adapter.createLocalOperatorStaffEnrollmentRealm(staffConfig).handle(
        new globalThis.Request(`${staffConfig.canonicalOrigin}/api/auth/staff/sign-up/email`, {
          method: "POST",
          headers: { origin: staffConfig.canonicalOrigin, "content-type": "application/json" },
          body: JSON.stringify({ ...staff, name: "Synthetic Staff" }),
        }),
      );
      assert.equal(signup.status, 200, "staff enrollment");
      const user = (await signup.json()).user;
      assert.ok(user?.id);
      // Principal ID is issued by Better Auth, while membership is a disposable Stage 9 fixture.
      const membership = randomUUID();
      // Parameterized Kysely SQL via packaged adapter dependency.
      const kysely = await import(createRequire(adapterEntry).resolve("kysely"));
      await kysely.sql`UPDATE "staff_access"."staff_user" SET "emailVerified"=true, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${user.id}`.execute(
        db.database,
      );
      await kysely.sql`INSERT INTO "staff_access"."staff_membership" ("id","agencyId","staffPrincipalId","state") VALUES (${membership}::uuid,'00000000-0000-7000-8000-000000000070'::uuid,${user.id},'ACTIVE')`.execute(
        db.database,
      );
      const role = randomUUID();
      await kysely.sql`INSERT INTO "staff_access"."role" ("id","agencyId","displayName") VALUES (${role}::uuid,'00000000-0000-7000-8000-000000000070'::uuid,'Synthetic reader')`.execute(
        db.database,
      );
      await kysely.sql`INSERT INTO "staff_access"."role_permission" ("roleId","permissionId","scopeKind","accessLevel") VALUES (${role}::uuid,'agency.view','AGENCY','ALL')`.execute(
        db.database,
      );
      await kysely.sql`INSERT INTO "staff_access"."role_assignment" ("id","agencyId","membershipId","roleId","scopeKind") VALUES (${randomUUID()}::uuid,'00000000-0000-7000-8000-000000000070'::uuid,${membership}::uuid,${role}::uuid,'AGENCY')`.execute(
        db.database,
      );
      await realm
        .createLocalOperatorPortalEnrollmentService(portalConfig)
        .enroll({ ...portal, name: "Synthetic Portal" });
      const call = (p, h, realmName, endpoint, body, cookie) =>
        request(p, h, `/api/auth/${realmName}/${endpoint}`, { body, cookie });
      const cookieFrom = (r, prefix) => {
        const c = r.cookies.map((x) => x.split(";", 1)[0]).find((x) => x.startsWith(prefix + "="));
        assert.ok(c, "expected session cookie");
        return c;
      };
      const setup = await call(adminPort, manifest.hosts.admin, "staff", "sign-in/email", staff);
      assert.equal(setup.status, 200, "staff setup sign-in");
      const setupCookie = cookieFrom(setup, "travelos-dev-staff-session");
      const enabled = await call(
        adminPort,
        manifest.hosts.admin,
        "staff",
        "two-factor/enable",
        { password: staff.password },
        setupCookie,
      );
      assert.equal(enabled.status, 200, "staff MFA enable");
      const seed = new URL(JSON.parse(enabled.body).totpURI).searchParams.get("secret");
      const totp = await createRuntimeTotpGenerator(appRoot);
      const verified = await call(
        adminPort,
        manifest.hosts.admin,
        "staff",
        "two-factor/verify-totp",
        { code: await totp(seed) },
        setupCookie,
      );
      assert.equal(verified.status, 200, "staff MFA setup");
      await call(adminPort, manifest.hosts.admin, "staff", "sign-out", {}, setupCookie);
      const challenge = await call(
        adminPort,
        manifest.hosts.admin,
        "staff",
        "sign-in/email",
        staff,
      );
      assert.equal(challenge.status, 200, "staff sign-in");
      assert.equal(JSON.parse(challenge.body).twoFactorRedirect, true, "staff MFA challenge");
      const challengeCookie = challenge.cookies.map((x) => x.split(";", 1)[0]).join("; ");
      const mfa = await call(
        adminPort,
        manifest.hosts.admin,
        "staff",
        "two-factor/verify-totp",
        { code: await totp(seed) },
        challengeCookie,
      );
      assert.equal(mfa.status, 200, "staff MFA sign-in");
      const staffCookie = cookieFrom(mfa, "travelos-dev-staff-session");
      const portalLogin = await call(
        portalPort,
        manifest.hosts.portal,
        "portal",
        "sign-in/email",
        portal,
      );
      assert.equal(portalLogin.status, 200, "portal sign-in");
      const portalCookie = cookieFrom(portalLogin, "travelos-dev-portal-session");
      for (const [p, h, name, own, other] of [
        [adminPort, manifest.hosts.admin, "staff", staffCookie, portalCookie],
        [portalPort, manifest.hosts.portal, "portal", portalCookie, staffCookie],
      ]) {
        const ownSession = await call(p, h, name, "get-session", undefined, own);
        assert.equal(ownSession.status, 200, "own realm session status");
        assert.ok(JSON.parse(ownSession.body)?.user?.id, "own realm session missing");
        const cross = await call(p, h, name, "get-session", undefined, other);
        assert.equal(cross.status, 200, "cross realm response");
        assert.equal(JSON.parse(cross.body), null, "cross realm cookie accepted");
      }
      phase = "browser authenticated journeys";
      const { checkBrowserAuth } = await import("./stage10-runtime-browser-auth.mjs");
      await checkBrowserAuth({
        artifact,
        manifest,
        adminPort,
        portalPort,
        staff,
        portal,
        seed,
        totp,
      });
    } finally {
      await db.destroy();
    }
    completed = true;
  } catch (e) {
    const diagnostic =
      phase === "browser authenticated journeys" &&
      /^browser (launch|staff login|staff mfa|staff dashboard|portal login|portal dashboard|own sessions|cookie domains|cross sessions)$/.test(
        e.message,
      )
        ? e.message
        : phase === "service startup" &&
            typeof e.message === "string" &&
            /^service startup (admin|portal) spawnError=(true|false) exit=(none|-?[0-9]+) signal=(none|SIG[A-Z0-9]+)$/.test(
              e.message,
            )
          ? e.message
          : phase;
    process.stderr.write(
      JSON.stringify({ result: "FAIL", code: "API_PG_REHEARSAL_FAILED", stage: diagnostic }) + "\n",
    );
    process.exitCode = 1;
  } finally {
    for (const child of children) child.kill("SIGTERM");
    await Promise.all(
      children.map(async (child) => {
        const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
        try {
          await Promise.race([
            child.closed,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("child cleanup timeout")), 8000).unref(),
            ),
          ]);
        } catch {
          cleanupOk = false;
          process.exitCode = 1;
          process.stderr.write('{"result":"FAIL","code":"CHILD_CLEANUP_FAILED"}\n');
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    if (started && work && bin) {
      const env = {
        ...process.env,
        LD_LIBRARY_PATH: [
          path.join(pgRoot, "usr/lib/x86_64-linux-gnu"),
          path.join(pgRoot, "usr/lib/postgresql/18/lib"),
        ].join(":"),
      };
      const stopped = stopPostgres({
        pgCtl: path.join(bin, "pg_ctl"),
        data: path.join(work, "data"),
        env,
      });
      if (!stopped || process.env.TRAVELOS_STAGE10_TEST_CLEANUP_FAILURE === "1") {
        cleanupOk = false;
        process.stderr.write(
          JSON.stringify({
            result: "FAIL",
            code: stopped ? "PG_CLEANUP_SIMULATED" : "PG_CLEANUP_FAILED",
          }) + "\n",
        );
        process.exitCode = 1;
      }
    }
    if (work && cleanupOk) await rm(work, { recursive: true, force: true });
  }
  if (completed && cleanupOk)
    process.stdout.write(
      JSON.stringify({
        result: "PASS",
        postgresVersion: "18.6",
        migrations: "PASS",
        services: ["admin-api", "portal-api"],
        realmRouting: "PASS",
        authenticatedSessions: "PASS",
        crossRealmCookies: "PASS",
        browserAuthenticatedViewports: ["desktop", "mobile"],
        cleanup: "PASS",
      }) + "\n",
    );
}
