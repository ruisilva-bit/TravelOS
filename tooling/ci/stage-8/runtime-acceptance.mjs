import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createControlledWorker } from "./controlled-worker.mjs";
import {
  createRuntimeTotpGenerator,
  readStage7RuntimeCredentials,
  requirePortalPrivilegeDenial,
  resolveRuntimePackageImport,
  runStage7RuntimeAcceptance,
} from "./stage7-regression.mjs";

const requestLoopback =
  (listener, host) =>
  ({ method, path: requestPath, body, cookie, fixtureRunId, correlationId }) =>
    new Promise((resolve, reject) => {
      assert.equal(listener.host, "127.0.0.1");
      assert.ok(requestPath.startsWith("/") && !requestPath.startsWith("//"));
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const headers = { host, accept: "application/json" };
      if (payload !== null) {
        headers["content-type"] = "application/json";
        headers["content-length"] = payload.length;
      }
      if (cookie !== undefined) headers.cookie = cookie;
      if (fixtureRunId !== undefined) headers["x-travelos-acceptance-fixture-run"] = fixtureRunId;
      if (correlationId !== undefined) headers["x-request-id"] = correlationId;
      if (method !== "GET") headers.origin = `http://${host}`;
      const request = http.request(
        {
          hostname: listener.host,
          port: listener.port,
          method,
          path: requestPath,
          headers,
          timeout: 10_000,
        },
        (response) => {
          let bytes = 0;
          const chunks = [];
          response.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > 1_048_576) request.destroy(new Error("RESPONSE_LIMIT"));
            else chunks.push(chunk);
          });
          response.on("end", () => {
            try {
              const text = Buffer.concat(chunks).toString("utf8");
              resolve({
                status: response.statusCode,
                headers: response.headers,
                body: text ? JSON.parse(text) : undefined,
              });
            } catch {
              reject(new Error("INVALID_RESPONSE"));
            }
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error("REQUEST_TIMEOUT")));
      request.on("error", () => reject(new Error("REQUEST_FAILED")));
      if (payload !== null) request.write(payload);
      request.end();
    });
const waitUntil = async (predicate) => {
  const end = Date.now() + 30_000;
  do {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  } while (Date.now() < end);
  throw new Error("WORKER_COMPLETION_TIMEOUT");
};
export const runAcceptance = async (root, manifestPath, controlledWorker = false) => {
  let portalDatabase;
  let workerDatabase;
  let credentials;
  let controlled;
  let phase = "dependencies";
  const probes = [];
  try {
    const portalRoot = path.join(root, "apps/portal-api");
    const workerRoot = path.join(root, "apps/worker");
    const load = (appRoot, packageName, exportName = ".") =>
      resolveRuntimePackageImport({ appRoot, packageName, exportName }).then((url) => import(url));
    const config = await load(portalRoot, "@travelos/config");
    phase = "manifest";
    const manifest = await config.loadDevelopmentInstanceManifest(manifestPath);
    assert.equal(manifest.environment, "DEVELOPMENT");
    phase = "credentials";
    credentials = await readStage7RuntimeCredentials({ manifest });
    const portalAuth = await load(portalRoot, "@travelos/auth-adapters", "./portal");
    const adapterRoot = await realpath(
      path.join(portalRoot, "node_modules/@travelos/auth-adapters"),
    );
    const adapterRealm = await import(pathToFileURL(path.join(adapterRoot, "dist/realm.js")).href);
    portalDatabase = portalAuth.createAuthRealmPostgresDatabase({
      host: manifest.database.host,
      port: manifest.database.port,
      database: manifest.database.name,
      user: manifest.database.runtimeRoles.portalApi.roleName,
      password: credentials.portalDatabasePassword,
      tls: { mode: manifest.database.tlsPolicy },
      applicationName: "travelos-stage8-acceptance-portal",
      maxConnections: 2,
    });
    const database = await load(workerRoot, "@travelos/database");
    workerDatabase = database.createPostgresPersistence({
      host: manifest.database.host,
      port: manifest.database.port,
      database: manifest.database.name,
      user: manifest.database.runtimeRoles.worker.roleName,
      password: await config.readSystemdCredentialText(
        manifest.database.runtimeRoles.worker.credentialReference,
      ),
      tls: { mode: manifest.database.tlsPolicy },
      applicationName: "travelos-stage8-acceptance-worker",
      maxConnections: 2,
    });
    const repository = database.createWorkerRepository(workerDatabase);
    assert.equal(await repository.ready(), true);
    probes.push("worker-credential-role-and-privileges");
    if (controlledWorker)
      controlled = await createControlledWorker({
        root,
        manifestPath,
        repository,
        persistence: workerDatabase,
        load,
        probes,
      });
    const enrollment = adapterRealm.createLocalOperatorPortalEnrollmentService({
      database: portalDatabase.database,
      canonicalOrigin: `http://${manifest.hosts.portal}`,
      realmKeyMaterial: credentials.portalRealmKey,
      environment: manifest.environment,
    });
    const rawAdmin = requestLoopback(manifest.runtime.listeners.adminApi, manifest.hosts.admin);
    const requestPortal = requestLoopback(
      manifest.runtime.listeners.portalApi,
      manifest.hosts.portal,
    );
    const sourceRows = (tripId) =>
      workerDatabase.withConnection((connection) =>
        connection
          .selectFrom("integration.activity_source")
          .select(["agencyId", "messageId", "eventType", "actorStaffPrincipalId", "publicationId"])
          .where("tripId", "=", tripId)
          .orderBy("messageId")
          .limit(100)
          .execute(),
      );
    const knownTrips = new Set();
    const requestAdmin = async (request) => {
      const tripId = /^\/api\/admin\/trips\/([a-f0-9-]{36})\//u.exec(request.path)?.[1];
      if (tripId) knownTrips.add(tripId);
      const preview = request.method === "GET" && request.path.endsWith("/publication-preview");
      const before = (await Promise.all([...knownTrips].map(sourceRows))).flat();
      const correlationId = randomUUID();
      const response = await rawAdmin({ ...request, correlationId });
      assert.equal(response.headers["x-request-id"], correlationId);
      if (preview) {
        assert.deepEqual((await Promise.all([...knownTrips].map(sourceRows))).flat(), before);
        probes.push("preview-no-outbox-writes");
      }
      if (request.method === "POST" && response.status >= 200 && response.status < 300) {
        const rows = (await Promise.all([...knownTrips].map(sourceRows))).flat();
        const added = rows.filter(
          (row) => !before.some((prior) => prior.messageId === row.messageId),
        );
        if (controlled) await controlled.process(added);
        for (const source of added) {
          await waitUntil(async () =>
            workerDatabase.withConnection(async (connection) => {
              const row = await connection
                .selectFrom("job_runtime.job")
                .select("state")
                .where("agencyId", "=", source.agencyId)
                .where("messageId", "=", source.messageId)
                .where("consumer", "=", "ACTIVITY_V1")
                .executeTakeFirst();
              return row?.state === (controlled?.expected(source.messageId) ?? "SUCCEEDED");
            }),
          );
          await workerDatabase.withConnection(async (connection) => {
            const entries = await connection
              .selectFrom("activity.entry")
              .select(["eventType", "actorStaffPrincipalId", "publicationId"])
              .where("agencyId", "=", source.agencyId)
              .where("messageId", "=", source.messageId)
              .limit(2)
              .execute();
            assert.deepEqual(
              entries,
              controlled?.expected(source.messageId) !== undefined &&
                controlled.expected(source.messageId) !== "SUCCEEDED"
                ? []
                : [
                    {
                      eventType: source.eventType,
                      actorStaffPrincipalId: source.actorStaffPrincipalId,
                      publicationId: source.publicationId,
                    },
                  ],
            );
          });
        }
        if (added.length > 0) {
          const captured = await workerDatabase.withConnection((connection) =>
            connection
              .selectFrom("integration.event_context")
              .select("correlationId")
              .where("correlationId", "=", correlationId)
              .limit(1)
              .executeTakeFirst(),
          );
          assert.ok(captured);
          probes.push("legitimate-outbox-activity-audit-linkage-and-correlation");
        }
        if (request.path.endsWith("/publications")) {
          const replay = await rawAdmin({ ...request, correlationId: randomUUID() });
          assert.equal(replay.status, response.status);
          assert.deepEqual(replay.body, response.body);
          assert.deepEqual((await Promise.all([...knownTrips].map(sourceRows))).flat(), rows);
          probes.push("publish-replay-no-duplicate-outbox-or-activity");
        }
      }
      return response;
    };
    phase = "authenticated-regressions";
    const regression = await runStage7RuntimeAcceptance({
      manifest,
      credentials,
      requestAdmin,
      requestPortal,
      enrollment,
      makeStaffTotpCode: await createRuntimeTotpGenerator(portalRoot),
      readImmutablePublication: async ({ tripId, version }) =>
        portalDatabase.database
          .selectFrom("trip_ops.publication_version as version")
          .innerJoin(
            "trip_ops.publication_snapshot as snapshot",
            "snapshot.publicationId",
            "version.publicationId",
          )
          .select([
            "version.projectionHash as projectionHash",
            "snapshot.canonicalPayload as canonicalPayload",
          ])
          .where("version.tripId", "=", tripId)
          .where("version.version", "=", version)
          .executeTakeFirst(),
    });
    assert.equal(regression.result, "PASS");
    await controlled?.finish();
    phase = "portal-isolation";
    for (const [table, column] of [
      ["activity.entry", "messageId"],
      ["job_runtime.job", "messageId"],
      ["integration.event_context", "messageId"],
      ["audit.trip_publication_event", "auditId"],
      ["trip_ops.trip", "id"],
    ])
      await requirePortalPrivilegeDenial(portalDatabase.database, table, column);
    probes.push("portal-denies-activity-audit-jobs-context-and-workspace");
    return {
      result: "PASS",
      stage: "PHASE_1_M1_STAGE_8",
      mode: controlledWorker ? "CONTROLLED_FAILURES_AND_PROCESS_RESTART" : "NORMAL_SYSTEMD_WORKER",
      probes,
      regressionProbes: regression.probes,
      probeCount: probes.length + regression.probes.length,
      stats: await repository.inspect(),
      stage9Actions: 0,
    };
  } catch (error) {
    const safe = new Error("Stage 8 acceptance failed");
    safe.receipt = {
      result: "FAIL",
      phase,
      code:
        typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(error.code)
          ? error.code
          : "STAGE8_ACCEPTANCE_FAILED",
      probes,
      completedRegressionProbes: error.completedProbes ?? [],
      stage9Actions: 0,
    };
    throw safe;
  } finally {
    await controlled?.close();
    if (credentials) for (const key of Object.keys(credentials)) credentials[key] = "";
    await Promise.all([portalDatabase?.destroy(), workerDatabase?.destroy()]);
  }
};
if (process.argv[1] && (await realpath(process.argv[1])) === fileURLToPath(import.meta.url)) {
  try {
    assert.ok(
      process.argv.length === 3 ||
        (process.argv.length === 4 && process.argv[3] === "--controlled-worker"),
    );
    assert.ok(process.argv[2].startsWith("--manifest="));
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const release = JSON.parse(await readFile(path.join(root, "release.json"), "utf8"));
    assert.equal(release.stage, "PHASE_1_M1_STAGE_8");
    console.log(
      JSON.stringify(
        await runAcceptance(
          root,
          process.argv[2].slice("--manifest=".length),
          process.argv[3] === "--controlled-worker",
        ),
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        error.receipt ?? { result: "FAIL", code: "STAGE8_ACCEPTANCE_PREFLIGHT_FAILED" },
      ),
    );
    process.exitCode = 1;
  }
}
