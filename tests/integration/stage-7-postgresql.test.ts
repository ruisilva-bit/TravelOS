import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeSignature } from "better-auth/crypto";
import { Client } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthSurfacePolicy, PortalAuthRealm } from "@travelos/auth-adapters/portal";
import { createAdminApi } from "../../apps/admin-api/src/app.js";
import { createAdminStaffSessionResolver } from "../../apps/admin-api/src/staff-session-resolver.js";
import { createPortalApi } from "../../apps/portal-api/src/app.js";
import * as portalTripReadRepositoryModule from "../../apps/portal-api/src/trip-read-repository.js";
import * as databaseModule from "../../packages/database/src/index.js";
import { createStaffAccessRepository } from "../../packages/database/src/index.js";
import { createPostgresStaffTripWorkspaceRepository } from "../../packages/database/src/trip-operations/staff-trip-workspace-repository.js";
import { createLocalOperatorPortalEnrollmentService } from "../../packages/auth-adapters/src/realm.js";
import {
  createOneTimeOperatorToken,
  createLocalOperatorStaffEnrollmentRealm,
  createPortalAuthRealm,
  createStaffAuthRealm,
  type AuthRealm,
} from "../../packages/auth-adapters/src/index.js";
import {
  asOpaqueId,
  bootstrapRootAgency,
  createRuntimeAcceptanceFixtureOperations,
  createStaffTripAccessOperations,
  createStaffTripWorkspaceOperations,
  createMoney,
  createScheduledLocalDateTime,
  authorizeOperation,
  IdempotencyConflictError,
  RUNTIME_ACCEPTANCE_FIXTURE_MANAGE_PERMISSION_REQUIREMENTS,
  InputValidationError,
  OptimisticConflictError,
  StaffAuthorizationError,
  TransactionConflictError,
  TripNotFoundError,
  UnsupportedTripStateError,
  type IssueTripAccessGrantCommand,
  type StaffTripAccessRepository,
  type RuntimeAcceptanceFixtureCleanupRepository,
  type RevokeTripAccessGrantCommand,
  type StaffAuthorizationOperationProof,
  type CreateTripSliceInput,
  type StaffTripWorkspaceWriteOperations,
} from "@travelos/backend-core";
import { AdminTripPublicationPreviewV1Schema } from "../../packages/contracts/src/admin/index.js";
import {
  createPostgresPersistence,
  type PostgresPersistence,
} from "../../packages/database/src/postgres/postgres-persistence.js";
import { createPostgresPortalTripSnapshotReader } from "../../apps/portal-api/src/trip-read-repository.js";
import { PortalTripSnapshotV1Schema } from "../../packages/contracts/src/portal/index.js";
import type { CurrentAuthorizedPortalTripListReader } from "@travelos/portal-safe-core/customer-presentation";
import {
  resolveStage9BrowserWebRoot,
  runStage9BrowserJourney,
  startBuiltBrowserHost,
} from "./helpers/stage9-browser-acceptance.js";

import {
  runMigrationChain,
  type MigrationChain,
  type MigrationRunResult,
  type MigrationTarget,
} from "../../tooling/database/migration-runner.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const { createRuntimeTotpGenerator, signInStaff } = (await import(
  pathToFileURL(path.join(repositoryRoot, "tooling/ci/stage-7/runtime-acceptance-runner.mjs")).href
)) as {
  createRuntimeTotpGenerator: (appRoot: string) => Promise<(seed: string) => Promise<string>>;
  signInStaff: (input: {
    requestAdmin: (request: {
      method: string;
      path: string;
      body: object;
      cookie?: string;
    }) => Promise<{ status: number; headers: { "set-cookie": string[] }; body: unknown }>;
    credentials: {
      staffEmail: string;
      staffPassword: string;
      staffTotpSeed: string;
    };
    makeStaffTotpCode: (seed: string) => Promise<string>;
  }) => Promise<string>;
};
const host = process.env["PGHOST"] ?? "";
const port = Number.parseInt(process.env["PGPORT"] ?? "", 10);
const postgresBin = process.env["TRAVELOS_STAGE7_PG_BIN"] ?? "";
const workRoot = process.env["TRAVELOS_STAGE7_WORK_ROOT"] ?? "";
const emptyDatabaseName = "travelos_stage7_empty_qualification";
const priorDatabaseName = "travelos_stage7_prior_qualification";
const stage7Head = "0013_stage7_runtime_acceptance_cleanup";
const freeLoopbackPort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate an ephemeral Stage 7 API port"));
        return;
      }
      const selected = address.port;
      server.close((error) => (error ? reject(error) : resolve(selected)));
    });
  });

const runPackagedOperatorRehearsal = async ({
  artifactRoot,
  staffEmail,
  staffPassword,
  staffTotpSeed,
}: {
  artifactRoot: string;
  staffEmail: string;
  staffPassword: string;
  staffTotpSeed: string;
}): Promise<void> => {
  const rehearsalRoot = await mkdtemp(path.join(workRoot, "stage7-packaged-rehearsal-"));
  const adminCredentials = path.join(rehearsalRoot, "admin-credentials");
  const portalCredentials = path.join(rehearsalRoot, "portal-credentials");
  const operatorCredentials = path.join(rehearsalRoot, "operator-credentials");
  const missingCredentials = path.join(rehearsalRoot, "missing-credentials");
  const invalidCredentials = path.join(rehearsalRoot, "invalid-credentials");
  const manifestPath = path.join(rehearsalRoot, "development.json");
  const reportPath = path.join(rehearsalRoot, "report.json");
  const etcUpper = path.join(rehearsalRoot, "etc-upper");
  const etcWork = path.join(rehearsalRoot, "etc-work");
  const directoryPaths = [
    adminCredentials,
    portalCredentials,
    operatorCredentials,
    missingCredentials,
    invalidCredentials,
    etcUpper,
    etcWork,
  ];
  const writeCredential = async (directory: string, name: string, value: string): Promise<void> => {
    await writeFile(path.join(directory, name), value, { mode: 0o600, flag: "wx" });
  };
  try {
    await Promise.all(directoryPaths.map((directory) => mkdir(directory, { mode: 0o700 })));
    const portalRealmKey = `${randomUUID()}${randomUUID()}`;
    await Promise.all([
      writeCredential(
        adminCredentials,
        "admin-api-db",
        "synthetic-admin-api-db-password-not-used-with-trust-auth",
      ),
      writeCredential(adminCredentials, "staff-auth-realm", stage7RealmKey),
      writeCredential(
        portalCredentials,
        "portal-api-db",
        "synthetic-portal-api-db-password-not-used-with-trust-auth",
      ),
      writeCredential(portalCredentials, "portal-auth-realm", portalRealmKey),
      writeCredential(
        operatorCredentials,
        "portal-api-db",
        "synthetic-portal-api-db-password-not-used-with-trust-auth",
      ),
      writeCredential(operatorCredentials, "portal-auth-realm", portalRealmKey),
      writeCredential(operatorCredentials, "stage7-staff-email", staffEmail),
      writeCredential(operatorCredentials, "stage7-staff-password", staffPassword),
      writeCredential(operatorCredentials, "stage7-staff-totp", staffTotpSeed),
      writeCredential(
        invalidCredentials,
        "portal-api-db",
        "synthetic-portal-api-db-password-not-used-with-trust-auth",
      ),
      writeCredential(invalidCredentials, "portal-auth-realm", portalRealmKey),
      writeCredential(invalidCredentials, "stage7-staff-email", staffEmail),
      writeCredential(invalidCredentials, "stage7-staff-password", staffPassword),
      writeCredential(invalidCredentials, "stage7-staff-totp", "123456"),
    ]);
    for (const directory of [
      adminCredentials,
      portalCredentials,
      operatorCredentials,
      missingCredentials,
      invalidCredentials,
    ]) {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
    }
    for (const [directory, names] of [
      [adminCredentials, ["admin-api-db", "staff-auth-realm"]],
      [portalCredentials, ["portal-api-db", "portal-auth-realm"]],
      [
        operatorCredentials,
        [
          "portal-api-db",
          "portal-auth-realm",
          "stage7-staff-email",
          "stage7-staff-password",
          "stage7-staff-totp",
        ],
      ],
      [
        invalidCredentials,
        [
          "portal-api-db",
          "portal-auth-realm",
          "stage7-staff-email",
          "stage7-staff-password",
          "stage7-staff-totp",
        ],
      ],
    ] as const) {
      for (const name of names)
        expect((await stat(path.join(directory, name))).mode & 0o777).toBe(0o600);
    }

    const manifest = JSON.parse(
      await readFile(path.join(artifactRoot, "instance-manifest/development.example.json"), "utf8"),
    ) as {
      database: { name: string; port: number };
      runtime: { listeners: { adminApi: { port: number }; portalApi: { port: number } } };
    };
    manifest.database.name = emptyDatabaseName;
    manifest.database.port = port;
    manifest.runtime.listeners.adminApi.port = await freeLoopbackPort();
    manifest.runtime.listeners.portalApi.port = await freeLoopbackPort();
    while (manifest.runtime.listeners.portalApi.port === manifest.runtime.listeners.adminApi.port) {
      manifest.runtime.listeners.portalApi.port = await freeLoopbackPort();
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

    const rehearsalResult = spawnSync(
      process.execPath,
      ["tooling/ci/stage-7/rehearse-packaged-operator.mjs", `--artifact-root=${artifactRoot}`],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        timeout: 300_000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          PATH: process.env["PATH"] ?? "/usr/bin:/bin",
          HOME: process.env["HOME"] ?? "",
          TMPDIR: os.tmpdir(),
          TRAVELOS_STAGE7_REHEARSAL_REPORT: reportPath,
          TRAVELOS_STAGE7_REHEARSAL_MANIFEST: manifestPath,
          TRAVELOS_STAGE7_REHEARSAL_ADMIN_CREDENTIALS: adminCredentials,
          TRAVELOS_STAGE7_REHEARSAL_PORTAL_CREDENTIALS: portalCredentials,
          TRAVELOS_STAGE7_REHEARSAL_OPERATOR_CREDENTIALS: operatorCredentials,
          TRAVELOS_STAGE7_REHEARSAL_MISSING_CREDENTIALS: missingCredentials,
          TRAVELOS_STAGE7_REHEARSAL_INVALID_CREDENTIALS: invalidCredentials,
          TRAVELOS_STAGE7_REHEARSAL_ETC_UPPER: etcUpper,
          TRAVELOS_STAGE7_REHEARSAL_ETC_WORK: etcWork,
        },
      },
    );
    const report = JSON.parse(rehearsalResult.stdout) as {
      result: string;
      artifactId: string;
      preActivationVerifier: { result: string; artifactId: string };
      postActivationVerifier: { result: string; artifactId: string };
      missingCredentials: { status: number; stage: string };
      invalidCredentials: { status: number; stage: string };
      runner: { result: string; probes: string[]; stage8Actions: number };
      services: {
        adminStarted: boolean;
        portalStarted: boolean;
        stopped: boolean;
        listenersClosed: boolean;
      };
    };
    const diagnostic = report as typeof report & {
      stage?: string | null;
      code?: string | null;
      acceptedOneShot?: {
        preflightStatus: number | null;
        status: number | null;
        failure: { stage: string; code: string; completedProbes?: string[] } | null;
      };
    };
    expect(
      rehearsalResult.status,
      `Packaged operator rehearsal failed: ${JSON.stringify({
        result: report.result,
        stage: diagnostic.stage ?? null,
        code: diagnostic.code ?? null,
        artifactId: report.artifactId ?? null,
        preActivation: report.preActivationVerifier?.result ?? null,
        postActivation: report.postActivationVerifier?.result ?? null,
        missingCredentialStatus: report.missingCredentials?.status ?? null,
        invalidCredentialStatus: report.invalidCredentials?.status ?? null,
        runner: report.runner?.result ?? null,
        acceptedOneShot: diagnostic.acceptedOneShot ?? null,
        services: report.services ?? null,
      })}`,
    ).toBe(0);
    expect(rehearsalResult.stderr).toBe("");
    expect(report.result).toBe("PASS");
    expect(report.preActivationVerifier).toMatchObject({
      result: "PASS",
      artifactId: report.artifactId,
    });
    expect(report.postActivationVerifier).toMatchObject({
      result: "PASS",
      artifactId: report.artifactId,
    });
    expect(report.missingCredentials).toMatchObject({ status: 1, stage: "credential delivery" });
    expect(report.invalidCredentials).toMatchObject({ status: 1, stage: "credential delivery" });
    expect(report.runner.result).toBe("PASS");
    expect(report.runner.stage8Actions).toBe(0);
    expect(report.runner.probes).toContain("cross-trip-access-denied");
    expect(report.runner.probes).toContain("publication-v2-visible-v1-immutable");
    expect(report.runner.probes).toContain("portal-role-denies-workspace-and-internal-table-reads");
    expect(report.runner.probes).toContain("portal-session-revoked-after-sign-out");
    expect(report.runner.probes).toContain("staff-session-revoked-after-sign-out");
    expect(report.services).toEqual({
      adminStarted: true,
      portalStarted: true,
      stopped: true,
      listenersClosed: true,
    });
    const sanitizedReport = JSON.stringify(report);
    for (const secret of [
      staffEmail,
      staffPassword,
      staffTotpSeed,
      stage7RealmKey,
      "synthetic-admin-api-db-password-not-used-with-trust-auth",
      "synthetic-portal-api-db-password-not-used-with-trust-auth",
      portalRealmKey,
    ]) {
      expect(sanitizedReport).not.toContain(secret);
    }
    process.stdout.write(
      `STAGE7_PACKAGED_REHEARSAL ${JSON.stringify({
        result: report.result,
        artifactId: report.artifactId,
        preActivationVerifier: report.preActivationVerifier,
        postActivationVerifier: report.postActivationVerifier,
        missingCredentials: report.missingCredentials,
        invalidCredentials: report.invalidCredentials,
        probes: report.runner.probes,
        services: report.services,
        stage8Actions: report.runner.stage8Actions,
      })}\n`,
    );
  } finally {
    await rm(rehearsalRoot, { recursive: true, force: true });
  }
};
const emptyAgencyId = "00000000-0000-7000-8000-000000000070";
const priorAgencyId = "00000000-0000-7000-8000-000000000071";
const primaryTripId = "00000000-0000-7000-8000-000000000072";
const stage7PublicationId = "00000000-0000-7000-8000-000000000081";
const secondaryTripId = "00000000-0000-7000-8000-000000000074";
const staffRoleId = "00000000-0000-7000-8000-000000000075";
const staffMembershipId = "00000000-0000-7000-8000-000000000076";
const staffAssignmentId = "00000000-0000-7000-8000-000000000077";
const primaryPersonId = "00000000-0000-7000-8000-000000000078";
const primaryCustomerId = "00000000-0000-7000-8000-000000000079";
const tripTravellerId = "00000000-0000-7000-8000-000000000080";
const staffPrincipalId = "stage7-staff-principal";
const staffSessionId = "stage7-staff-session";
const staffSessionToken = randomUUID();
const priorPortalPrincipalId = "stage7-prior-portal-principal";
const priorPortalSessionId = "stage7-prior-portal-session";
const priorPortalSessionToken = randomUUID();
const stage7RealmKey = `${randomUUID()}${randomUUID()}`;
const stage7PublicationIdInvalid = "00000000-0000-7000-8000-000000000083";
const stage7SnapshotPayload = JSON.stringify({
  schemaVersion: 1,
  trip: { title: "Stage 7 Published Snapshot", startDate: "2026-10-15", endDate: "2026-10-16" },
  items: [],
});
const stage7ProjectionHash = createHash("sha256")
  .update(stage7SnapshotPayload, "utf8")
  .digest("hex");
const stage7SnapshotPayloadInvalid = JSON.stringify({
  schemaVersion: 1,
  trip: { title: "Stage 7 Invalid Snapshot", startDate: "2026-10-15", endDate: "2026-10-16" },
  items: [],
  supplierCost: "INTERNAL_ONLY-stage7-snapshot-sentinel",
});
const productionChain: MigrationChain = {
  directory: path.join(repositoryRoot, "migrations"),
  checksumManifestPath: path.join(repositoryRoot, "migrations/checksums.json"),
};
let predecessorMigrationDirectory: string | null = null;
let stage7V1MigrationDirectory: string | null = null;
let emptyRun: MigrationRunResult;
let emptyStage6Run: MigrationRunResult;
let priorStage6Run: MigrationRunResult;
let priorStage7V1Run: MigrationRunResult;
let priorStage7Run: MigrationRunResult;
let emptyNoOpRun: MigrationRunResult;
let priorNoOpRun: MigrationRunResult;
let tripAccessPersistence: PostgresPersistence<Record<string, never>> | null = null;
let portalAuthPersistence: PostgresPersistence<Record<string, never>> | null = null;
let staffRealm: AuthRealm;
let portalRealm: AuthRealm;
let staffAuthorization: StaffAuthorizationOperationProof;
let issuedGrantId: string | null = null;

const signedSessionCookie = async (realm: AuthRealm, token: string): Promise<string> =>
  `${realm.cookieName}=${token}.${await makeSignature(token, stage7RealmKey)}`;

const targetFor = (database: string): MigrationTarget => ({
  host,
  port,
  database,
  migratorRole: "travelos_migrator",
  ownerRole: "travelos_owner",
  tls: { mode: "DISABLED_LOOPBACK_ONLY" },
  allowTrustAuthenticationForTests: true,
});

const bootstrapDatabase = (databaseName: string): void => {
  const result = spawnSync(
    path.join(postgresBin, "psql"),
    [
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--set",
      `database_name=${databaseName}`,
      "--dbname",
      "postgres",
      "--file",
      path.join(repositoryRoot, "deploy/database/bootstrap-database-and-roles.sql"),
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PGHOST: host,
        PGPORT: String(port),
        PGDATABASE: "postgres",
        PGUSER: "postgres",
        PGSSLMODE: "disable",
      },
    },
  );
  if (result.status !== 0) {
    throw new Error(`Stage 7 database bootstrap failed: ${result.stderr}`);
  }
};

const seedRootAgency = async (
  databaseName: string,
  agencyId: string,
  suffix: string,
): Promise<void> => {
  const persistence = createPostgresPersistence<Record<string, never>>({
    host,
    port,
    database: databaseName,
    user: "travelos_admin_api",
    tls: { mode: "DISABLED_LOOPBACK_ONLY" },
    applicationName: `travelos-stage7-root-bootstrap-${suffix}`,
    maxConnections: 2,
  });
  try {
    await bootstrapRootAgency(createStaffAccessRepository(persistence), {
      agencyId,
      bootstrapReference: `stage7-${suffix}-migration-fixture`,
      slug: `stage7-${suffix}-migration`,
    });
  } finally {
    await persistence.destroy();
  }
};

const seedPriorPortalState = async (): Promise<void> => {
  const client = new Client({
    host,
    port,
    database: priorDatabaseName,
    user: "travelos_migrator",
    ssl: false,
  });
  await client.connect();
  try {
    await client.query('SET ROLE "travelos_owner"');
    await client.query(
      `INSERT INTO "portal_access"."portal_user" ("id", "name", "email", "emailVerified")
       VALUES ($1, 'Stage 7 Synthetic Principal', 'stage7-shared-realm-marker', true)`,
      [priorPortalPrincipalId],
    );
    await client.query(
      `INSERT INTO "portal_access"."portal_session" ("id", "expiresAt", "token", "updatedAt", "userId")
       VALUES ($1, clock_timestamp() + interval '1 day', $2, clock_timestamp(), $3)`,
      [priorPortalSessionId, priorPortalSessionToken, priorPortalPrincipalId],
    );
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    await client.end();
  }
};

const withPortalLogin = async <Result>(
  work: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const client = new Client({
    host,
    port,
    database: priorDatabaseName,
    user: "travelos_portal_api",
    ssl: false,
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
};

const withWorkerLogin = async <Result>(
  work: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const client = new Client({
    host,
    port,
    database: priorDatabaseName,
    user: "travelos_worker",
    ssl: false,
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
};

const withOwnerLogin = async <Result>(
  database: string,
  work: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const client = new Client({ host, port, database, user: "travelos_migrator", ssl: false });
  await client.connect();
  try {
    await client.query('SET ROLE "travelos_owner"');
    return await work(client);
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    await client.end();
  }
};

const insertFixtureTrip = async (client: Client, agencyId: string, tripId: string) =>
  client.query(
    `WITH fixture_trip AS (
       INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
       VALUES ($1::uuid, $2::uuid, 'Stage 7 Fixture Trip', '2026-10-15', '2026-10-16', 'DRAFT')
       RETURNING "id", "agencyId"
     )
     INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
     SELECT $3::uuid, fixture_trip."agencyId", fixture_trip."id", $4::uuid, 'PRIMARY_TRAVELLER'
       FROM fixture_trip`,
    [tripId, agencyId, databaseModule.createUuidV7(), primaryPersonId],
  );

const insertFixtureRun = async (client: Client, agencyId: string, fixtureRunId: string) =>
  client.query(
    `INSERT INTO "portal_access"."runtime_acceptance_fixture_run"
       ("agencyId", "fixtureRunId", "createdByStaffPrincipalId")
     VALUES ($1::uuid, $2::uuid, $3)`,
    [agencyId, fixtureRunId, staffPrincipalId],
  );

const linkFixtureTrip = async (
  client: Client,
  agencyId: string,
  fixtureRunId: string,
  slot: number,
  tripId: string,
) =>
  client.query(
    `INSERT INTO "portal_access"."runtime_acceptance_fixture_trip"
       ("agencyId", "fixtureRunId", "slot", "tripId")
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid)`,
    [agencyId, fixtureRunId, slot, tripId],
  );

const seedTripAccessRepositoryState = async (): Promise<void> => {
  await withOwnerLogin(priorDatabaseName, async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName", "email")
         VALUES ($1::uuid, $2::uuid, 'Synthetic', 'Traveller', NULL)`,
        [primaryPersonId, priorAgencyId],
      );
      await client.query(
        `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
         VALUES ($1::uuid, $2::uuid, 'Stage 7 Synthetic Customer')`,
        [primaryCustomerId, priorAgencyId],
      );
      await client.query(
        `INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'PRIMARY_CONTACT', true)`,
        [priorAgencyId, primaryCustomerId, primaryPersonId],
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
         VALUES ($1::uuid, $2::uuid, 'Stage 7 Primary Trip', '2026-10-15', '2026-10-16', 'DRAFT')`,
        [primaryTripId, priorAgencyId],
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'PRIMARY_TRAVELLER')`,
        [tripTravellerId, priorAgencyId, primaryTripId, primaryPersonId],
      );
      await client.query(
        `INSERT INTO "staff_access"."staff_user" ("id", "name", "email", "emailVerified", "twoFactorEnabled")
       VALUES ($1, 'Stage 7 Synthetic Staff', 'stage7-shared-realm-marker', true, true)`,
        [staffPrincipalId],
      );
      await client.query(
        `INSERT INTO "staff_access"."staff_membership" ("id", "agencyId", "staffPrincipalId", "state")
       VALUES ($1::uuid, $2::uuid, $3, 'ACTIVE')`,
        [staffMembershipId, priorAgencyId, staffPrincipalId],
      );
      await client.query(
        `INSERT INTO "staff_access"."staff_session" ("id", "expiresAt", "token", "updatedAt", "userId")
       VALUES ($1, clock_timestamp() + interval '1 hour', $2, clock_timestamp(), $3)`,
        [staffSessionId, staffSessionToken, staffPrincipalId],
      );
      await client.query(
        `INSERT INTO "staff_access"."role" ("id", "agencyId", "displayName")
       VALUES ($1::uuid, $2::uuid, 'Stage 7 Synthetic Grant Manager')`,
        [staffRoleId, priorAgencyId],
      );
      await client.query(
        `INSERT INTO "staff_access"."role_permission" ("roleId", "permissionId", "scopeKind", "accessLevel")
       VALUES
         ($1::uuid, 'trip.access.manage', 'AGENCY', 'ALL'),
         ($1::uuid, 'trip.view', 'AGENCY', 'ALL'),
         ($1::uuid, 'trip.preview', 'AGENCY', 'ALL'),
         ($1::uuid, 'trip.publish', 'AGENCY', 'ALL'),
         ($1::uuid, 'trip.edit', 'AGENCY', 'ALL'),
         ($1::uuid, 'trip.withdraw_publication', 'AGENCY', 'ALL'),
         ($1::uuid, 'runtime_acceptance.fixture.manage', 'AGENCY', 'ALL'),
         ($1::uuid, 'customer.view', 'AGENCY', 'ALL'),
         ($1::uuid, 'traveller.view_sensitive', 'AGENCY', 'ALL'),
         ($1::uuid, 'reservation.view', 'AGENCY', 'ALL'),
         ($1::uuid, 'finance.view_costs', 'AGENCY', 'ALL'),
         ($1::uuid, 'customer.edit', 'AGENCY', 'ALL'),
         ($1::uuid, 'traveller.edit', 'AGENCY', 'ALL'),
         ($1::uuid, 'reservation.edit', 'AGENCY', 'ALL'),
         ($1::uuid, 'finance.manage_costs', 'AGENCY', 'ALL')`,
        [staffRoleId],
      );
      await client.query(
        `INSERT INTO "staff_access"."role_assignment" ("id", "agencyId", "membershipId", "roleId", "scopeKind", "organizationUnitId", "active")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'AGENCY', NULL, true)`,
        [staffAssignmentId, priorAgencyId, staffMembershipId, staffRoleId],
      );
      await client.query(
        `INSERT INTO "staff_access"."staff_session_context" ("sessionId", "staffPrincipalId", "agencyId", "authorizationEpoch", "recentMfaVerifiedAt")
       SELECT $1, membership."staffPrincipalId", membership."agencyId", membership."authorizationEpoch", clock_timestamp()
         FROM "staff_access"."staff_membership" AS membership
        WHERE membership."id" = $2::uuid`,
        [staffSessionId, staffMembershipId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });

  const authorizationEpoch = await withOwnerLogin(priorDatabaseName, async (client) => {
    const result = await client.query<{ readonly authorizationEpoch: string }>(
      `SELECT "authorizationEpoch"::text AS "authorizationEpoch"
         FROM "staff_access"."staff_session_context"
        WHERE "sessionId" = $1`,
      [staffSessionId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Stage 7 Staff session context fixture missing");
    return BigInt(row.authorizationEpoch);
  });
  const nowEpochMs = Date.now();
  staffAuthorization = {
    session: {
      sessionId: staffSessionId,
      staffPrincipalId,
      agencyId: asOpaqueId(priorAgencyId),
      authorizationEpoch,
      expiresAtEpochMs: nowEpochMs + 60 * 60 * 1_000,
      recentMfaVerifiedAtEpochMs: nowEpochMs,
    },
    requiredPermissionIds: ["trip.access.manage"],
    nowEpochMs,
  };
};

const seedStage7PublishedSnapshot = async (): Promise<void> =>
  withOwnerLogin(priorDatabaseName, async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO "trip_ops"."publication_version"
           ("publicationId", "agencyId", "tripId", "version", "workspaceRevision",
            "schemaVersion", "projectionHash", "publisherStaffPrincipalId", "assuranceVerifiedAt")
         VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 0, 1, $4, $5, statement_timestamp())`,
        [stage7PublicationId, priorAgencyId, primaryTripId, stage7ProjectionHash, staffPrincipalId],
      );
      await client.query(
        `INSERT INTO "trip_ops"."publication_snapshot"
           ("publicationId", "agencyId", "tripId", "canonicalPayload")
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4)`,
        [stage7PublicationId, priorAgencyId, primaryTripId, stage7SnapshotPayload],
      );
      await client.query(
        `INSERT INTO "trip_ops"."publication_pointer"
           ("agencyId", "tripId", "activePublicationId", "activeVersion")
         VALUES ($1::uuid, $2::uuid, $3::uuid, 1)`,
        [priorAgencyId, primaryTripId, stage7PublicationId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });

const expectSqlState = async (work: () => Promise<unknown>, sqlState: string): Promise<void> => {
  let observed: unknown;
  try {
    await work();
  } catch (error) {
    observed = error;
  }
  const code =
    typeof observed === "object" && observed !== null && "code" in observed ? observed.code : null;
  expect(code).toBe(sqlState);
};

const createTripAccessRepository = (): StaffTripAccessRepository | null => {
  const factory = (databaseModule as unknown as Record<string, unknown>)[
    "createPostgresStaffTripAccessRepository"
  ];
  if (typeof factory !== "function" || tripAccessPersistence === null) return null;
  return (
    factory as (
      persistence: PostgresPersistence<Record<string, never>>,
    ) => StaffTripAccessRepository
  )(tripAccessPersistence);
};

const stage7TripInput = (title: string): CreateTripSliceInput => ({
  agencyId: asOpaqueId(priorAgencyId),
  person: {
    givenName: "Synthetic",
    familyName: "Cleanup Traveller",
    email: `stage7-cleanup-${randomUUID()}@example.test`,
  },
  customer: { displayName: "Stage 7 Cleanup Customer" },
  customerPersonRole: "PRIMARY_CONTACT",
  trip: { title, startDate: "2027-10-12", endDate: "2027-10-15", state: "DRAFT" },
  travellerRole: "PRIMARY_TRAVELLER",
  flight: {
    title: "Outbound flight",
    description: "Synthetic flight description",
    carrier: "Example Air",
    flightNumber: "EA100",
    departureAirport: "LIS",
    arrivalAirport: "OPO",
    departure: createScheduledLocalDateTime({
      localDate: "2027-10-12",
      localTime: "09:00",
      timezoneName: "Europe/Lisbon",
      instant: "2027-10-12T08:00:00Z",
    }),
    arrival: createScheduledLocalDateTime({
      localDate: "2027-10-12",
      localTime: "10:00",
      timezoneName: "Europe/Lisbon",
      instant: "2027-10-12T09:00:00Z",
    }),
    terminal: null,
    cabin: "ECONOMY",
    baggage: "One cabin bag",
    seat: null,
    customerBookingReference: "SYNTH-FLIGHT-1",
  },
  accommodation: {
    title: "Synthetic hotel",
    description: "Synthetic accommodation description",
    propertyName: "Example Hotel",
    checkIn: createScheduledLocalDateTime({
      localDate: "2027-10-12",
      localTime: "15:00",
      timezoneName: "Europe/Lisbon",
      instant: "2027-10-12T14:00:00Z",
    }),
    checkOut: createScheduledLocalDateTime({
      localDate: "2027-10-15",
      localTime: "11:00",
      timezoneName: "Europe/Lisbon",
      instant: "2027-10-15T10:00:00Z",
    }),
    roomDescription: "Double room",
    boardType: "BREAKFAST",
    customerBookingReference: "SYNTH-HOTEL-1",
  },
  reservation: {
    supplierName: "Synthetic Supplier",
    supplierReference: `SUP-${randomUUID()}`,
    customerBookingReference: "SYNTH-RES-1",
    state: "CONFIRMED",
  },
  supplierCost: {
    amount: createMoney("12345", "EUR", 2),
    internalNote: "Synthetic cleanup qualification note",
  },
});

const createFixtureTripTestHarness = async () => {
  if (tripAccessPersistence === null) {
    throw new Error("Stage 7 Staff persistence fixture was not initialized");
  }
  const sessionId = `stage7-fixture-create-session-${randomUUID()}`;
  const sessionToken = randomUUID();
  await withOwnerLogin(priorDatabaseName, async (client) => {
    await client.query(
      `INSERT INTO "staff_access"."staff_session" ("id", "expiresAt", "token", "updatedAt", "userId")
       VALUES ($1, clock_timestamp() + interval '1 hour', $2, clock_timestamp(), $3)`,
      [sessionId, sessionToken, staffPrincipalId],
    );
    await client.query(
      `INSERT INTO "staff_access"."staff_session_context"
         ("sessionId", "staffPrincipalId", "agencyId", "authorizationEpoch", "recentMfaVerifiedAt")
       SELECT $1, membership."staffPrincipalId", membership."agencyId",
              membership."authorizationEpoch", clock_timestamp()
         FROM "staff_access"."staff_membership" AS membership
        WHERE membership."id" = $2::uuid AND membership."state" = 'ACTIVE'`,
      [sessionId, staffMembershipId],
    );
  });
  const cookie = await signedSessionCookie(staffRealm, sessionToken);
  const resolver = createAdminStaffSessionResolver(staffRealm, {
    canonicalOrigin: "http://admin.travelos.test",
    expectedHost: "admin.travelos.test",
  });
  const operations = databaseModule.createPostgresStaffTripOperations(
    tripAccessPersistence,
    resolver,
  );
  const createFixtureTrip = (
    input: CreateTripSliceInput,
    fixtureRunId: string,
  ): Promise<unknown> => {
    const create = (
      operations as unknown as {
        createRuntimeAcceptanceFixtureTrip?: (
          cookieHeader: unknown,
          tripInput: unknown,
          runId: unknown,
        ) => Promise<unknown>;
      }
    ).createRuntimeAcceptanceFixtureTrip;
    if (create === undefined) {
      throw new Error("Runtime acceptance fixture Trip creation is not implemented");
    }
    return create.call(operations, cookie, input, fixtureRunId);
  };
  return { createFixtureTrip, sessionId, cookie, resolver };
};

const portalHttpPolicy: AuthSurfacePolicy = {
  canonicalOrigin: "http://portal.travelos.test",
  expectedHost: "portal.travelos.test",
};

const withPortalHttp = async <Result>(
  run: (baseUrl: string) => Promise<Result>,
): Promise<Result> => {
  if (portalAuthPersistence === null) {
    throw new Error("Stage 7 Portal persistence fixture was not initialized");
  }
  const reader = await portalAuthPersistence.withConnection(async (connection) =>
    createPostgresPortalTripSnapshotReader(connection),
  );
  const application = await createPortalApi({
    expectedHost: portalHttpPolicy.expectedHost,
    auth: { realm: portalRealm as PortalAuthRealm, policy: portalHttpPolicy },
    tripSnapshotReader: reader,
  });
  await application.listen(0, "127.0.0.1");
  const address = application.getHttpServer().address();
  if (address === null || typeof address === "string") {
    await application.close();
    throw new Error("Stage 7 Portal HTTP fixture did not bind a TCP address");
  }
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await application.close();
  }
};

const portalTripRequest = (baseUrl: string, tripId: string, cookie: string) =>
  request(baseUrl)
    .get(`/api/portal/trips/${tripId}`)
    .set({ Host: portalHttpPolicy.expectedHost, Cookie: cookie });

const publishSyntheticSnapshot = async (
  publicationId: string,
  version: number,
  workspaceRevision: number,
  canonicalPayload: string,
): Promise<void> =>
  withOwnerLogin(priorDatabaseName, async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO "trip_ops"."publication_version"
           ("publicationId", "agencyId", "tripId", "version", "workspaceRevision",
            "schemaVersion", "projectionHash", "publisherStaffPrincipalId", "assuranceVerifiedAt")
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 1, $6, $7, statement_timestamp())`,
        [
          publicationId,
          priorAgencyId,
          primaryTripId,
          version,
          workspaceRevision,
          createHash("sha256").update(canonicalPayload, "utf8").digest("hex"),
          staffPrincipalId,
        ],
      );
      await client.query(
        `INSERT INTO "trip_ops"."publication_snapshot"
           ("publicationId", "agencyId", "tripId", "canonicalPayload")
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4)`,
        [publicationId, priorAgencyId, primaryTripId, canonicalPayload],
      );
      await client.query(
        `UPDATE "trip_ops"."publication_pointer"
            SET "activePublicationId" = $3::uuid,
                "activeVersion" = $4,
                "updatedAt" = statement_timestamp()
          WHERE "agencyId" = $1::uuid AND "tripId" = $2::uuid`,
        [priorAgencyId, primaryTripId, publicationId, version],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });

const issueCommand = (idempotencyKey: string): IssueTripAccessGrantCommand => ({
  agencyId: asOpaqueId(priorAgencyId),
  portalPrincipalId: priorPortalPrincipalId,
  tripId: asOpaqueId(primaryTripId),
  capabilities: ["trip.view_current"],
  idempotencyKey,
  expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
  relationshipLabel: "Trip companion",
});

const revokeCommand = (grantId: string, idempotencyKey: string): RevokeTripAccessGrantCommand => ({
  agencyId: asOpaqueId(priorAgencyId),
  grantId: asOpaqueId(grantId),
  idempotencyKey,
});

interface TripAccessCounts {
  readonly grantCount: string;
  readonly activeGrantCount: string;
  readonly eventCount: string;
  readonly outboxCount: string;
  readonly idempotencyCount: string;
  readonly principalEpoch: string;
  readonly sessionEpoch: string;
}

const readTripAccessCounts = async (): Promise<TripAccessCounts> =>
  withOwnerLogin(priorDatabaseName, async (client) => {
    const result = await client.query<TripAccessCounts>(
      `
      SELECT (SELECT count(*)::text FROM "portal_access"."trip_access_grant"
               WHERE "agencyId" = $1::uuid) AS "grantCount",
             (SELECT count(*)::text FROM "portal_access"."trip_access_grant"
               WHERE "agencyId" = $1::uuid AND "grantState" = 'ACTIVE') AS "activeGrantCount",
             (SELECT count(*)::text FROM "audit"."trip_access_grant_event"
               WHERE "agencyId" = $1::uuid) AS "eventCount",
             (SELECT count(*)::text FROM "integration"."trip_access_grant_outbox"
               WHERE "agencyId" = $1::uuid) AS "outboxCount",
             (SELECT count(*)::text FROM "portal_access"."trip_access_idempotency"
               WHERE "agencyId" = $1::uuid) AS "idempotencyCount",
             (SELECT "authorizationEpoch"::text FROM "portal_access"."portal_principal_context"
               WHERE "agencyId" = $1::uuid AND "portalPrincipalId" = $2) AS "principalEpoch",
             (SELECT "authorizationEpoch"::text FROM "portal_access"."portal_session_context"
               WHERE "agencyId" = $1::uuid AND "sessionId" = $3) AS "sessionEpoch"
    `,
      [priorAgencyId, priorPortalPrincipalId, priorPortalSessionId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Stage 7 grant counts were not returned");
    return row;
  });

const readGrantState = async (
  grantId: string,
): Promise<{
  readonly grantState: string;
  readonly hasExpiredAt: boolean;
  readonly hasRevokedAt: boolean;
}> =>
  withOwnerLogin(priorDatabaseName, async (client) => {
    const result = await client.query<{
      readonly grantState: string;
      readonly hasExpiredAt: boolean;
      readonly hasRevokedAt: boolean;
    }>(
      `SELECT "grantState",
              "expiredAt" IS NOT NULL AS "hasExpiredAt",
              "revokedAt" IS NOT NULL AS "hasRevokedAt"
         FROM "portal_access"."trip_access_grant"
        WHERE "grantId" = $1::uuid`,
      [grantId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Stage 7 Trip access grant fixture missing");
    return row;
  });

const seedExpiredActiveGrant = async (): Promise<string> => {
  const grantId = randomUUID();
  await withOwnerLogin(priorDatabaseName, (client) =>
    client.query(
      `INSERT INTO "portal_access"."trip_access_grant"
         ("grantId", "agencyId", "portalPrincipalId", "tripId", "capabilities",
          "issuedByStaffPrincipalId", "issuedAt", "expiresAt")
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, ARRAY['trip.view_current']::text[], $5,
               date_trunc('milliseconds', statement_timestamp()) - interval '2 days',
               date_trunc('milliseconds', statement_timestamp()) - interval '1 day')`,
      [grantId, priorAgencyId, priorPortalPrincipalId, primaryTripId, staffPrincipalId],
    ),
  );
  return grantId;
};

const installOutboxFailureTrigger = async (): Promise<void> =>
  withOwnerLogin(priorDatabaseName, async (client) => {
    await client.query(`
      CREATE FUNCTION "integration"."stage7_reject_grant_outbox_test"()
      RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $stage7_failure$
      BEGIN
        RAISE EXCEPTION 'Synthetic Stage 7 outbox failure' USING ERRCODE = '23514';
      END
      $stage7_failure$
    `);
    await client.query(`
      CREATE TRIGGER "stage7_reject_grant_outbox_test_trigger"
      BEFORE INSERT ON "integration"."trip_access_grant_outbox"
      FOR EACH ROW EXECUTE FUNCTION "integration"."stage7_reject_grant_outbox_test"()
    `);
  });

const removeOutboxFailureTrigger = async (): Promise<void> =>
  withOwnerLogin(priorDatabaseName, async (client) => {
    await client.query(`
      DROP TRIGGER "stage7_reject_grant_outbox_test_trigger"
      ON "integration"."trip_access_grant_outbox"
    `);
    await client.query(`DROP FUNCTION "integration"."stage7_reject_grant_outbox_test"()`);
  });

const stage6MigrationChain = async (): Promise<MigrationChain> => {
  const manifest = JSON.parse(await readFile(productionChain.checksumManifestPath, "utf8")) as {
    readonly schemaVersion: number;
    readonly algorithm: string;
    readonly migrations: readonly { readonly file: string; readonly sha256: string }[];
  };
  const stage6MigrationIndex = manifest.migrations.findIndex(
    ({ file }) => file === "0011_stage6_trip_publication.cjs",
  );
  const stage6Migrations = manifest.migrations.slice(0, stage6MigrationIndex + 1);
  if (
    stage6MigrationIndex < 0 ||
    stage6Migrations.at(-1)?.file !== "0011_stage6_trip_publication.cjs"
  ) {
    throw new Error("The supported predecessor chain must end at 0011_stage6_trip_publication.cjs");
  }
  const directory = await mkdtemp(path.join(workRoot, "stage6-migrations-"));
  predecessorMigrationDirectory = directory;
  for (const migration of stage6Migrations) {
    await copyFile(
      path.join(productionChain.directory, migration.file),
      path.join(directory, migration.file),
    );
  }
  const checksumManifestPath = path.join(directory, "checksums.json");
  await writeFile(
    checksumManifestPath,
    `${JSON.stringify({ ...manifest, migrations: stage6Migrations }, null, 2)}\n`,
  );
  return { directory, checksumManifestPath };
};

const stage7V1MigrationChain = async (): Promise<MigrationChain> => {
  const manifest = JSON.parse(await readFile(productionChain.checksumManifestPath, "utf8")) as {
    readonly schemaVersion: number;
    readonly algorithm: string;
    readonly migrations: readonly { readonly file: string; readonly sha256: string }[];
  };
  const stage7V1MigrationIndex = manifest.migrations.findIndex(
    ({ file }) => file === "0012_stage7_portal_trip_access.cjs",
  );
  const stage7V1Migrations = manifest.migrations.slice(0, stage7V1MigrationIndex + 1);
  if (
    stage7V1MigrationIndex < 0 ||
    stage7V1Migrations.at(-1)?.file !== "0012_stage7_portal_trip_access.cjs"
  ) {
    throw new Error(
      "The immutable gen09 predecessor chain must end at 0012_stage7_portal_trip_access.cjs",
    );
  }
  const directory = await mkdtemp(path.join(workRoot, "stage7-v1-migrations-"));
  stage7V1MigrationDirectory = directory;
  for (const migration of stage7V1Migrations) {
    await copyFile(
      path.join(productionChain.directory, migration.file),
      path.join(directory, migration.file),
    );
  }
  const checksumManifestPath = path.join(directory, "checksums.json");
  await writeFile(
    checksumManifestPath,
    `${JSON.stringify({ ...manifest, migrations: stage7V1Migrations }, null, 2)}\n`,
  );
  return { directory, checksumManifestPath };
};

beforeAll(async () => {
  if (
    !/^127\.0\.0\.1$/u.test(host) ||
    !Number.isInteger(port) ||
    postgresBin.length === 0 ||
    !workRoot.startsWith(`${os.tmpdir()}${path.sep}`)
  ) {
    throw new Error(
      "Stage 7 disposable PostgreSQL environment is incomplete or not loopback-bound",
    );
  }
  bootstrapDatabase(emptyDatabaseName);
  bootstrapDatabase(priorDatabaseName);

  const predecessorChain = await stage6MigrationChain();
  const stage7V1Chain = await stage7V1MigrationChain();
  emptyStage6Run = await runMigrationChain(targetFor(emptyDatabaseName), predecessorChain);
  priorStage6Run = await runMigrationChain(targetFor(priorDatabaseName), predecessorChain);
  await seedRootAgency(emptyDatabaseName, emptyAgencyId, "empty");
  await seedRootAgency(priorDatabaseName, priorAgencyId, "prior");
  await seedPriorPortalState();
  emptyRun = await runMigrationChain(targetFor(emptyDatabaseName), productionChain);
  priorStage7V1Run = await runMigrationChain(targetFor(priorDatabaseName), stage7V1Chain);
  priorStage7Run = await runMigrationChain(targetFor(priorDatabaseName), productionChain);
  emptyNoOpRun = await runMigrationChain(targetFor(emptyDatabaseName), productionChain);
  priorNoOpRun = await runMigrationChain(targetFor(priorDatabaseName), productionChain);
  await seedTripAccessRepositoryState();
  await seedStage7PublishedSnapshot();
  tripAccessPersistence = createPostgresPersistence<Record<string, never>>({
    host,
    port,
    database: priorDatabaseName,
    user: "travelos_admin_api",
    tls: { mode: "DISABLED_LOOPBACK_ONLY" },
    applicationName: "travelos-stage7-access-qualification",
    maxConnections: 4,
  });
  portalAuthPersistence = createPostgresPersistence<Record<string, never>>({
    host,
    port,
    database: priorDatabaseName,
    user: "travelos_portal_api",
    tls: { mode: "DISABLED_LOOPBACK_ONLY" },
    applicationName: "travelos-stage7-portal-auth-qualification",
    maxConnections: 3,
  });
  staffRealm = createStaffAuthRealm({
    database: await tripAccessPersistence.withConnection(async (connection) => connection),
    canonicalOrigin: "http://admin.travelos.test",
    realmKeyMaterial: stage7RealmKey,
    environment: "DEVELOPMENT",
  });
  portalRealm = createPortalAuthRealm({
    database: await portalAuthPersistence.withConnection(async (connection) => connection),
    canonicalOrigin: "http://portal.travelos.test",
    realmKeyMaterial: stage7RealmKey,
    environment: "DEVELOPMENT",
  });
}, 120_000);

afterAll(async () => {
  try {
    await Promise.all([tripAccessPersistence?.destroy(), portalAuthPersistence?.destroy()]);
  } finally {
    if (predecessorMigrationDirectory !== null) {
      await rm(predecessorMigrationDirectory, { recursive: true, force: true });
    }
    if (stage7V1MigrationDirectory !== null) {
      await rm(stage7V1MigrationDirectory, { recursive: true, force: true });
    }
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.sequential("Stage 7 PostgreSQL migration qualification", () => {
  it("authenticates the acceptance runner against a real DEVELOPMENT Staff MFA realm", async () => {
    const staffPersistence = createPostgresPersistence<Record<string, never>>({
      host,
      port,
      database: emptyDatabaseName,
      user: "travelos_admin_api",
      tls: { mode: "DISABLED_LOOPBACK_ONLY" },
      applicationName: "travelos-stage7-runner-auth-qualification",
      maxConnections: 2,
    });
    try {
      const adminDatabase = await staffPersistence.withConnection(async (connection) => connection);
      const staffAuthRealm = createStaffAuthRealm({
        database: adminDatabase,
        canonicalOrigin: "http://admin.travelos.test",
        realmKeyMaterial: stage7RealmKey,
        environment: "DEVELOPMENT",
      });
      const enrollmentRealm = createLocalOperatorStaffEnrollmentRealm({
        database: adminDatabase,
        canonicalOrigin: "http://admin.travelos.test",
        realmKeyMaterial: stage7RealmKey,
        environment: "DEVELOPMENT",
      });
      const email = `stage7-runner-${randomUUID()}@example.test`;
      const password = randomBytes(32).toString("base64url");
      const origin = "http://admin.travelos.test";
      const repository = createStaffAccessRepository(staffPersistence);
      const invitation = createOneTimeOperatorToken();
      const issued = await repository.issueFirstOwnerInvitation({
        agencyId: emptyAgencyId,
        targetEmail: email,
        tokenDigest: invitation.digest,
        expiresAt: new Date(Date.now() + 60_000),
        operatorIdentity: "TEST_LOCAL_OPERATOR",
      });
      expect(issued.result).toBe("ISSUED");
      const call = async (realm: AuthRealm, endpoint: string, body: object, cookie?: string) =>
        realm.handle(
          new Request(`${origin}/api/auth/staff/${endpoint}`, {
            method: "POST",
            headers: {
              origin,
              "content-type": "application/json",
              ...(cookie === undefined ? {} : { cookie }),
            },
            body: JSON.stringify(body),
          }),
        );
      const enrolled = await call(enrollmentRealm, "sign-up/email", {
        email,
        name: "Stage 7 Synthetic Runner",
        password,
      });
      expect(enrolled.status).toBe(200);
      const principalId = await repository.findStaffPrincipalIdByEmail(email);
      expect(principalId).not.toBeNull();
      const consumed = await repository.consumeFirstOwnerInvitation({
        tokenDigest: invitation.digest,
        staffPrincipalId: principalId!,
        operatorIdentity: "TEST_LOCAL_OPERATOR",
      });
      expect(consumed.result).toBe("CONSUMED");
      const ownerSnapshot = await repository.getStaffAuthorizationSnapshot(
        principalId!,
        emptyAgencyId,
      );
      expect(ownerSnapshot?.assignments).toContainEqual(
        expect.objectContaining({
          permissionId: "agency.view",
          scopeKind: "AGENCY",
          accessLevel: "ALL",
          active: true,
        }),
      );
      const initial = await call(staffAuthRealm, "sign-in/email", { email, password });
      expect(initial.status).toBe(200);
      const initialCookie = initial.headers
        .getSetCookie()
        .map((row) => row.split(";", 1)[0])
        .join("; ");
      const enabled = await call(staffAuthRealm, "two-factor/enable", { password }, initialCookie);
      expect(enabled.status).toBe(200);
      const totpUri = ((await enabled.json()) as { totpURI: string }).totpURI;
      const seed = new URL(totpUri).searchParams.get("secret");
      expect(seed).toMatch(/^[A-Z2-7]{16,128}$/u);
      const generateTotp = await createRuntimeTotpGenerator(
        path.join(repositoryRoot, "apps/portal-api"),
      );
      const verified = await call(
        staffAuthRealm,
        "two-factor/verify-totp",
        { code: await generateTotp(seed!) },
        initialCookie,
      );
      expect(verified.status).toBe(200);
      const diagnosticChallenge = await call(staffAuthRealm, "sign-in/email", { email, password });
      const diagnosticBody = (await diagnosticChallenge.json()) as { twoFactorRedirect?: boolean };
      const diagnosticCookies = diagnosticChallenge.headers.getSetCookie().map((row) => {
        const pair = row.split(";", 1)[0] ?? "";
        return {
          name: pair.split("=", 1)[0],
          hasValue: pair.slice(pair.indexOf("=") + 1).length > 0,
        };
      });
      expect({ redirect: diagnosticBody.twoFactorRedirect, cookies: diagnosticCookies }).toEqual({
        redirect: true,
        cookies: [
          { name: "travelos-dev-staff-session", hasValue: false },
          { name: "travelos-staff.session_data", hasValue: false },
          { name: "travelos-staff.two_factor", hasValue: true },
        ],
      });
      const requestAdmin = async ({
        path: endpoint,
        body,
        cookie,
      }: {
        path: string;
        body: object;
        cookie?: string;
        method: string;
      }) => {
        const response = await call(
          staffAuthRealm,
          endpoint.replace("/api/auth/staff/", ""),
          body,
          cookie,
        );
        return {
          status: response.status,
          headers: { "set-cookie": response.headers.getSetCookie() },
          body: await response.json(),
        };
      };
      const sessionCookie = await signInStaff({
        requestAdmin,
        credentials: {
          staffEmail: email,
          staffPassword: password,
          staffTotpSeed: seed!,
        },
        makeStaffTotpCode: generateTotp,
      });
      expect(sessionCookie).toMatch(/^travelos-dev-staff-session=/u);
      const signedOut = await call(staffAuthRealm, "sign-out", {}, sessionCookie);
      expect(signedOut.status).toBe(200);
      const artifactRoot = process.env["TRAVELOS_STAGE7_ARTIFACT_ROOT"];
      if (artifactRoot !== undefined) {
        await runPackagedOperatorRehearsal({
          artifactRoot,
          staffEmail: email,
          staffPassword: password,
          staffTotpSeed: seed!,
        });
      }
    } finally {
      await staffPersistence.destroy();
    }
  }, 360_000);

  it("applies the ordered Stage 7 migration to an empty supported database", () => {
    expect(emptyStage6Run.currentVersion).toBe("0011_stage6_trip_publication");
    expect(emptyStage6Run.verifiedMigrationCount).toBe(11);
    expect(emptyRun.currentVersion).toBe(stage7Head);
    expect(emptyRun.verifiedMigrationCount).toBe(13);
    expect(emptyRun.ledger).toHaveLength(13);
    expect(emptyRun.target.sessionRole).toBe("travelos_migrator");
    expect(emptyRun.target.effectiveRole).toBe("travelos_owner");
  });

  it("upgrades the accepted Stage 6 head through the canonical migrator", () => {
    expect(priorStage6Run.currentVersion).toBe("0011_stage6_trip_publication");
    expect(priorStage7V1Run.currentVersion).toBe("0012_stage7_portal_trip_access");
    expect(priorStage7V1Run.appliedMigrations).toEqual(["0012_stage7_portal_trip_access"]);
    expect(priorStage7Run.currentVersion).toBe(stage7Head);
    expect(priorStage7Run.appliedMigrations).toEqual([stage7Head]);
    expect(priorStage7Run.target.sessionRole).toBe("travelos_migrator");
    expect(priorStage7Run.target.effectiveRole).toBe("travelos_owner");
  });

  it("verifies the exact checksummed chain and performs deterministic no-op reruns", () => {
    expect(emptyNoOpRun.currentVersion).toBe(stage7Head);
    expect(emptyNoOpRun.appliedMigrations).toEqual([]);
    expect(emptyNoOpRun.verifiedMigrationCount).toBe(13);
    expect(priorNoOpRun.currentVersion).toBe(stage7Head);
    expect(priorNoOpRun.appliedMigrations).toEqual([]);
    expect(priorNoOpRun.verifiedMigrationCount).toBe(13);
  });

  it("fixtureRunAndFirstTripAssociationAreAtomic", async () => {
    const fixtureRunId = randomUUID();
    const tripId = databaseModule.createUuidV7();
    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query("BEGIN");
      try {
        await insertFixtureTrip(client, priorAgencyId, tripId);
        await insertFixtureRun(client, priorAgencyId, fixtureRunId);
        await linkFixtureTrip(client, priorAgencyId, fixtureRunId, 1, tripId);
        const linked = await client.query(
          `SELECT trip."id"::text AS "tripId", fixture."fixtureRunId"::text AS "fixtureRunId"
             FROM "trip_ops"."trip" AS trip
             JOIN "portal_access"."runtime_acceptance_fixture_trip" AS fixture_trip
               ON fixture_trip."agencyId" = trip."agencyId"
              AND fixture_trip."tripId" = trip."id"
             JOIN "portal_access"."runtime_acceptance_fixture_run" AS fixture
               ON fixture."agencyId" = fixture_trip."agencyId"
              AND fixture."fixtureRunId" = fixture_trip."fixtureRunId"
            WHERE fixture."fixtureRunId" = $1::uuid`,
          [fixtureRunId],
        );
        expect(linked.rows).toEqual([{ tripId, fixtureRunId }]);
        const events = await client.query<{
          readonly eventType: string;
          readonly actorKind: string;
          readonly actorStaffPrincipalId: string | null;
        }>(
          `SELECT "eventType", "actorKind", "actorStaffPrincipalId"
             FROM "audit"."runtime_acceptance_fixture_event"
            WHERE "fixtureRunId" = $1::uuid
            ORDER BY "eventType"`,
          [fixtureRunId],
        );
        expect(events.rows).toEqual([
          {
            eventType: "FIXTURE_RUN_OPENED",
            actorKind: "STAFF",
            actorStaffPrincipalId: staffPrincipalId,
          },
          {
            eventType: "FIXTURE_TRIP_ASSOCIATED",
            actorKind: "STAFF",
            actorStaffPrincipalId: staffPrincipalId,
          },
        ]);
      } finally {
        await client.query("ROLLBACK");
      }

      const persisted = await client.query<{ trips: string; runs: string; links: string }>(
        `SELECT
           (SELECT count(*)::text FROM "trip_ops"."trip" WHERE "id" = $1::uuid) AS "trips",
           (SELECT count(*)::text FROM "portal_access"."runtime_acceptance_fixture_run"
             WHERE "fixtureRunId" = $2::uuid) AS "runs",
           (SELECT count(*)::text FROM "portal_access"."runtime_acceptance_fixture_trip"
             WHERE "fixtureRunId" = $2::uuid) AS "links"`,
        [tripId, fixtureRunId],
      );
      expect(persisted.rows).toEqual([{ trips: "0", runs: "0", links: "0" }]);
    });
  });

  it("fixtureRunAndFirstTripAreAtomic", async () => {
    const fixtureRunId = databaseModule.createUuidV7();
    const { createFixtureTrip } = await createFixtureTripTestHarness();
    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query(`
        CREATE OR REPLACE FUNCTION "trip_ops"."stage7_reject_fixture_trip_insert"()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW."title" = 'Stage 7 atomic failure marker' THEN
            RAISE EXCEPTION 'synthetic Stage 7 Trip insert failure' USING ERRCODE = 'P0001';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await client.query(`
        CREATE TRIGGER "stage7_reject_fixture_trip_insert"
        BEFORE INSERT ON "trip_ops"."trip"
        FOR EACH ROW EXECUTE FUNCTION "trip_ops"."stage7_reject_fixture_trip_insert"()
      `);
    });
    try {
      await expect(
        createFixtureTrip(stage7TripInput("Stage 7 atomic failure marker"), fixtureRunId),
      ).rejects.toBeDefined();
      const failedCounts = await withOwnerLogin(priorDatabaseName, (client) =>
        client.query<{ readonly runs: string; readonly trips: string; readonly links: string }>(
          `SELECT
             (SELECT count(*)::text FROM "portal_access"."runtime_acceptance_fixture_run"
               WHERE "fixtureRunId" = $1::uuid) AS "runs",
             (SELECT count(*)::text FROM "trip_ops"."trip"
               WHERE "title" = 'Stage 7 atomic failure marker') AS "trips",
             (SELECT count(*)::text FROM "portal_access"."runtime_acceptance_fixture_trip"
               WHERE "fixtureRunId" = $1::uuid) AS "links"`,
          [fixtureRunId],
        ),
      );
      expect(failedCounts.rows).toEqual([{ runs: "0", trips: "0", links: "0" }]);
    } finally {
      await withOwnerLogin(priorDatabaseName, async (client) => {
        await client.query(
          `DROP TRIGGER IF EXISTS "stage7_reject_fixture_trip_insert" ON "trip_ops"."trip"`,
        );
        await client.query(
          `DROP FUNCTION IF EXISTS "trip_ops"."stage7_reject_fixture_trip_insert"()`,
        );
      });
    }

    await createFixtureTrip(stage7TripInput("Stage 7 atomic success marker"), fixtureRunId);
    const persisted = await withOwnerLogin(priorDatabaseName, (client) =>
      client.query<{
        readonly runState: string;
        readonly createdByStaffPrincipalId: string;
        readonly linkedTrips: string;
      }>(
        `SELECT fixture."state" AS "runState",
                fixture."createdByStaffPrincipalId",
                count(fixture_trip."tripId")::text AS "linkedTrips"
           FROM "portal_access"."runtime_acceptance_fixture_run" AS fixture
           LEFT JOIN "portal_access"."runtime_acceptance_fixture_trip" AS fixture_trip
             ON fixture_trip."agencyId" = fixture."agencyId"
            AND fixture_trip."fixtureRunId" = fixture."fixtureRunId"
          WHERE fixture."agencyId" = $1::uuid AND fixture."fixtureRunId" = $2::uuid
          GROUP BY fixture."state", fixture."createdByStaffPrincipalId"`,
        [priorAgencyId, fixtureRunId],
      ),
    );
    expect(persisted.rows).toEqual([
      { runState: "OPEN", createdByStaffPrincipalId: staffPrincipalId, linkedTrips: "1" },
    ]);
    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANUP_PENDING'
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, fixtureRunId],
      );
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANED', "cleanedAt" = clock_timestamp()
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, fixtureRunId],
      );
    });
  });

  it("timeoutAfterTripCommitIsRecoverableByRunId", async () => {
    const fixtureRunId = databaseModule.createUuidV7();
    const { createFixtureTrip } = await createFixtureTripTestHarness();
    await createFixtureTrip(stage7TripInput("Stage 7 lost-response recovery marker"), fixtureRunId);

    const recovered = await withOwnerLogin(priorDatabaseName, (client) =>
      client.query<{ readonly tripId: string; readonly runId: string }>(
        `SELECT fixture_trip."tripId"::text AS "tripId",
                fixture_trip."fixtureRunId"::text AS "runId"
           FROM "portal_access"."runtime_acceptance_fixture_trip" AS fixture_trip
          WHERE fixture_trip."agencyId" = $1::uuid AND fixture_trip."fixtureRunId" = $2::uuid`,
        [priorAgencyId, fixtureRunId],
      ),
    );
    expect(recovered.rows).toHaveLength(1);
    expect(recovered.rows[0]?.runId).toBe(fixtureRunId);
    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANUP_PENDING'
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, fixtureRunId],
      );
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANED', "cleanedAt" = clock_timestamp()
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, fixtureRunId],
      );
    });
  });

  it("noNewRunStartsWhileCleanupIsPending", async () => {
    const firstRunId = databaseModule.createUuidV7();
    const secondRunId = databaseModule.createUuidV7();
    const { createFixtureTrip } = await createFixtureTripTestHarness();
    await createFixtureTrip(stage7TripInput("Stage 7 unresolved fixture marker"), firstRunId);
    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANUP_PENDING'
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, firstRunId],
      );
    });

    await expect(
      createFixtureTrip(stage7TripInput("Stage 7 blocked second run marker"), secondRunId),
    ).rejects.toMatchObject({ code: "FIXTURE_RUN_CONFLICT", recoveryFixtureRunId: firstRunId });
    const remaining = await withOwnerLogin(priorDatabaseName, (client) =>
      client.query<{ readonly runCount: string; readonly tripCount: string }>(
        `SELECT
           (SELECT count(*)::text FROM "portal_access"."runtime_acceptance_fixture_run"
             WHERE "agencyId" = $1::uuid AND "state" <> 'CLEANED') AS "runCount",
           (SELECT count(*)::text FROM "portal_access"."runtime_acceptance_fixture_trip"
             WHERE "fixtureRunId" = $2::uuid) AS "tripCount"`,
        [priorAgencyId, secondRunId],
      ),
    );
    expect(remaining.rows).toEqual([{ runCount: "1", tripCount: "0" }]);
    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANED', "cleanedAt" = clock_timestamp()
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, firstRunId],
      );
    });
  });

  it("limitsCleanupAuditReadsToScopeAndEventMetadata", async () => {
    const privileges = await withOwnerLogin(priorDatabaseName, (client) =>
      client.query<{
        readonly grantScope: boolean;
        readonly grantKind: boolean;
        readonly grantActor: boolean;
        readonly cancellationScope: boolean;
        readonly cancellationActor: boolean;
        readonly withdrawalScope: boolean;
        readonly withdrawalReason: boolean;
      }>(`
        SELECT
          has_column_privilege('travelos_admin_api', 'audit.trip_access_grant_event', 'agencyId', 'SELECT')
            AND has_column_privilege('travelos_admin_api', 'audit.trip_access_grant_event', 'tripId', 'SELECT')
            AND has_column_privilege('travelos_admin_api', 'audit.trip_access_grant_event', 'portalPrincipalId', 'SELECT')
            AS "grantScope",
          has_column_privilege('travelos_admin_api', 'audit.trip_access_grant_event', 'eventType', 'SELECT')
            AS "grantKind",
          has_column_privilege('travelos_admin_api', 'audit.trip_access_grant_event', 'actorStaffPrincipalId', 'SELECT')
            AS "grantActor",
          has_column_privilege('travelos_admin_api', 'audit.trip_cancellation_event', 'agencyId', 'SELECT')
            AND has_column_privilege('travelos_admin_api', 'audit.trip_cancellation_event', 'tripId', 'SELECT')
            AS "cancellationScope",
          has_column_privilege('travelos_admin_api', 'audit.trip_cancellation_event', 'actorStaffPrincipalId', 'SELECT')
            AS "cancellationActor",
          has_column_privilege('travelos_admin_api', 'audit.trip_publication_withdrawal_event', 'agencyId', 'SELECT')
            AND has_column_privilege('travelos_admin_api', 'audit.trip_publication_withdrawal_event', 'tripId', 'SELECT')
            AS "withdrawalScope",
          has_column_privilege('travelos_admin_api', 'audit.trip_publication_withdrawal_event', 'reason', 'SELECT')
            AS "withdrawalReason"
      `),
    );
    expect(privileges.rows).toEqual([
      {
        grantScope: true,
        grantKind: true,
        grantActor: false,
        cancellationScope: true,
        cancellationActor: false,
        withdrawalScope: true,
        withdrawalReason: false,
      },
    ]);
  });

  it("cleanupRepositoryAuditsPendingAndCompletedTransitions", async () => {
    const persistence = tripAccessPersistence;
    if (persistence === null)
      throw new Error("Stage 7 Staff persistence fixture was not initialized");
    const repositoryFactory = (
      databaseModule as unknown as {
        readonly createPostgresRuntimeAcceptanceFixtureCleanupRepository?: unknown;
      }
    ).createPostgresRuntimeAcceptanceFixtureCleanupRepository;
    expect(
      repositoryFactory,
      "PostgreSQL fixture cleanup repository factory must be exported",
    ).toBeTypeOf("function");
    if (typeof repositoryFactory !== "function") return;

    const { cookie, resolver } = await createFixtureTripTestHarness();
    const authorization = await authorizeOperation(
      {
        authorizationRepository: createStaffAccessRepository(persistence),
        sessionResolver: resolver,
      },
      cookie,
      null,
      RUNTIME_ACCEPTANCE_FIXTURE_MANAGE_PERMISSION_REQUIREMENTS,
      5 * 60 * 1_000,
    );
    const createRepository = repositoryFactory as (
      value: PostgresPersistence<Record<string, never>>,
    ) => RuntimeAcceptanceFixtureCleanupRepository;
    const repository = createRepository(persistence);
    const fixtureRunId = databaseModule.createUuidV7();
    const command = {
      agencyId: asOpaqueId(priorAgencyId),
      fixtureRunId,
      staffPrincipalId,
      idempotencyKey: "fixture-cleanup-transition-test",
    };
    await withOwnerLogin(priorDatabaseName, (client) =>
      insertFixtureRun(client, priorAgencyId, fixtureRunId),
    );

    try {
      const started = await repository.beginCleanup(command, authorization);
      expect(started).toMatchObject({
        status: "READY",
        plan: {
          agencyId: priorAgencyId,
          fixtureRunId,
          state: "CLEANUP_PENDING",
          tripIds: [],
          activePublicationTripIds: [],
          activeGrants: [],
          portalPrincipalId: null,
          portalPrincipalRetired: false,
          unexpectedResourceCount: 0,
        },
      });
      const completed = await repository.completeCleanup(command, authorization);
      expect(completed).toMatchObject({
        fixtureRunId,
        state: "CLEANED",
        counts: {
          grantsRevoked: 0,
          publicationsWithdrawn: 0,
          tripsCancelled: 0,
          principalsRetired: 0,
        },
        retainedHistoryCounts: { publicationSnapshots: 0, auditRecords: 3 },
        errorCode: null,
      });
      const persisted = await withOwnerLogin(priorDatabaseName, (client) =>
        client.query<{ readonly state: string; readonly auditCount: string }>(
          `SELECT fixture."state",
                  (SELECT count(*)::text FROM "audit"."runtime_acceptance_fixture_event" AS event
                    WHERE event."agencyId" = fixture."agencyId"
                      AND event."fixtureRunId" = fixture."fixtureRunId") AS "auditCount"
             FROM "portal_access"."runtime_acceptance_fixture_run" AS fixture
            WHERE fixture."agencyId" = $1::uuid AND fixture."fixtureRunId" = $2::uuid`,
          [priorAgencyId, fixtureRunId],
        ),
      );
      expect(persisted.rows).toEqual([{ state: "CLEANED", auditCount: "3" }]);
    } finally {
      await withOwnerLogin(priorDatabaseName, async (client) => {
        await client.query(
          `UPDATE "portal_access"."runtime_acceptance_fixture_run"
              SET "state" = 'CLEANUP_PENDING'
            WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid AND "state" = 'OPEN'`,
          [priorAgencyId, fixtureRunId],
        );
        await client.query(
          `UPDATE "portal_access"."runtime_acceptance_fixture_run"
              SET "state" = 'CLEANED', "cleanedAt" = clock_timestamp()
            WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid AND "state" = 'CLEANUP_PENDING'`,
          [priorAgencyId, fixtureRunId],
        );
      });
    }
  });

  it("fixtureRunRejectsCrossAgencyAndExcessResources", async () => {
    const fixtureRunId = randomUUID();
    const tripIds = [
      databaseModule.createUuidV7(),
      databaseModule.createUuidV7(),
      databaseModule.createUuidV7(),
    ];
    await withOwnerLogin(priorDatabaseName, async (client) => {
      await insertFixtureRun(client, priorAgencyId, fixtureRunId);
      for (const tripId of tripIds) await insertFixtureTrip(client, priorAgencyId, tripId);
      await linkFixtureTrip(client, priorAgencyId, fixtureRunId, 1, tripIds[0]!);
      await linkFixtureTrip(client, priorAgencyId, fixtureRunId, 2, tripIds[1]!);

      await expectSqlState(
        () => linkFixtureTrip(client, priorAgencyId, fixtureRunId, 3, tripIds[2]!),
        "23514",
      );
      await expectSqlState(
        () => linkFixtureTrip(client, emptyAgencyId, fixtureRunId, 1, tripIds[0]!),
        "23503",
      );
      const links = await client.query<{ count: string }>(
        `SELECT count(*)::text AS "count"
           FROM "portal_access"."runtime_acceptance_fixture_trip"
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, fixtureRunId],
      );
      expect(links.rows).toEqual([{ count: "2" }]);
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANUP_PENDING' WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, fixtureRunId],
      );
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANED', "cleanedAt" = clock_timestamp()
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, fixtureRunId],
      );
    });
  });

  it("onlyOneUnresolvedFixtureRunExistsPerAgency", async () => {
    const firstRunId = randomUUID();
    const secondRunId = randomUUID();
    await withOwnerLogin(priorDatabaseName, async (client) => {
      await insertFixtureRun(client, priorAgencyId, firstRunId);
      await expectSqlState(() => insertFixtureRun(client, priorAgencyId, secondRunId), "23505");
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANUP_PENDING' WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, firstRunId],
      );
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANED', "cleanedAt" = clock_timestamp()
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, firstRunId],
      );
      await insertFixtureRun(client, priorAgencyId, secondRunId);
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANUP_PENDING' WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, secondRunId],
      );
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANED', "cleanedAt" = clock_timestamp()
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, secondRunId],
      );
      const auditEvents = await client.query<{ readonly eventType: string }>(
        `SELECT "eventType"
           FROM "audit"."runtime_acceptance_fixture_event"
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, secondRunId],
      );
      expect(auditEvents.rows.map(({ eventType }) => eventType).sort()).toEqual([
        "FIXTURE_CLEANUP_PENDING",
        "FIXTURE_RUN_CLEANED",
        "FIXTURE_RUN_OPENED",
      ]);
      const deletePrivileges = await client.query<{
        readonly runDelete: boolean;
        readonly tripDelete: boolean;
        readonly eventDelete: boolean;
      }>(
        `SELECT
           pg_catalog.has_table_privilege(
             'travelos_admin_runtime',
             'portal_access.runtime_acceptance_fixture_run',
             'DELETE'
           ) AS "runDelete",
           pg_catalog.has_table_privilege(
             'travelos_admin_runtime',
             'portal_access.runtime_acceptance_fixture_trip',
             'DELETE'
           ) AS "tripDelete",
           pg_catalog.has_table_privilege(
             'travelos_admin_runtime',
             'audit.runtime_acceptance_fixture_event',
             'DELETE'
           ) AS "eventDelete"`,
      );
      expect(deletePrivileges.rows).toEqual([
        { runDelete: false, tripDelete: false, eventDelete: false },
      ]);
      await expectSqlState(
        () =>
          client.query(
            `DELETE FROM "audit"."runtime_acceptance_fixture_event"
              WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
            [priorAgencyId, secondRunId],
          ),
        "55000",
      );
    });
  });

  it("portalRuntimeCannotReadFixtureRegistry", async () => {
    const fixtureRunId = randomUUID();
    const fixtureFunctionNames = [
      "append_runtime_acceptance_fixture_audit",
      "associate_runtime_acceptance_fixture_portal_principal",
      "enforce_runtime_acceptance_fixture_run_transition",
      "enforce_runtime_acceptance_fixture_trip_insert",
      "reject_runtime_acceptance_fixture_history_mutation",
    ];
    await withPortalLogin(async (client) => {
      await expectSqlState(
        () =>
          client.query(
            `SELECT "fixtureRunId" FROM "portal_access"."runtime_acceptance_fixture_run"`,
          ),
        "42501",
      );
      await expectSqlState(
        () =>
          client.query(
            `INSERT INTO "portal_access"."runtime_acceptance_fixture_run"
               ("agencyId", "fixtureRunId", "createdByStaffPrincipalId")
             VALUES ($1::uuid, $2::uuid, $3)`,
            [priorAgencyId, fixtureRunId, staffPrincipalId],
          ),
        "42501",
      );
      await expectSqlState(
        () =>
          client.query(
            `UPDATE "portal_access"."runtime_acceptance_fixture_run" SET "state" = 'CLEANUP_PENDING'`,
          ),
        "42501",
      );
      await expectSqlState(
        () => client.query(`DELETE FROM "portal_access"."runtime_acceptance_fixture_run"`),
        "42501",
      );
      await expectSqlState(
        () =>
          client.query(`SELECT "tripId" FROM "portal_access"."runtime_acceptance_fixture_trip"`),
        "42501",
      );
      await expectSqlState(
        () =>
          client.query(
            `INSERT INTO "portal_access"."runtime_acceptance_fixture_trip"
               ("agencyId", "fixtureRunId", "slot", "tripId")
             VALUES ($1::uuid, $2::uuid, 1, $3::uuid)`,
            [priorAgencyId, fixtureRunId, randomUUID()],
          ),
        "42501",
      );
      await expectSqlState(
        () => client.query(`SELECT "eventId" FROM "audit"."runtime_acceptance_fixture_event"`),
        "42501",
      );
      await expectSqlState(
        () =>
          client.query(
            `INSERT INTO "audit"."runtime_acceptance_fixture_event"
               ("eventId", "agencyId", "fixtureRunId", "eventType", "actorKind")
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'FIXTURE_RUN_OPENED', 'STAFF')`,
            [randomUUID(), priorAgencyId, fixtureRunId],
          ),
        "42501",
      );
      const functionRights = await client.query<{ routineName: string; canExecute: boolean }>(
        `SELECT proc."proname" AS "routineName",
                pg_catalog.has_function_privilege(session_user, proc."oid", 'EXECUTE') AS "canExecute"
           FROM pg_catalog.pg_proc AS proc
           JOIN pg_catalog.pg_namespace AS schema
             ON schema."oid" = proc."pronamespace"
          WHERE schema."nspname" = 'portal_access'
            AND proc."proname" = ANY($1::text[])
          ORDER BY proc."proname"`,
        [fixtureFunctionNames],
      );
      expect(functionRights.rows).toEqual([
        { routineName: "append_runtime_acceptance_fixture_audit", canExecute: false },
        {
          routineName: "associate_runtime_acceptance_fixture_portal_principal",
          canExecute: true,
        },
        { routineName: "enforce_runtime_acceptance_fixture_run_transition", canExecute: false },
        { routineName: "enforce_runtime_acceptance_fixture_trip_insert", canExecute: false },
        { routineName: "reject_runtime_acceptance_fixture_history_mutation", canExecute: false },
      ]);
    });

    await withWorkerLogin(async (client) => {
      await expectSqlState(
        () =>
          client.query(
            `SELECT "fixtureRunId" FROM "portal_access"."runtime_acceptance_fixture_run"`,
          ),
        "42501",
      );
      await expectSqlState(
        () =>
          client.query(
            `SELECT "portal_access"."associate_runtime_acceptance_fixture_portal_principal"($1::uuid, $2)`,
            [fixtureRunId, priorPortalPrincipalId],
          ),
        "42501",
      );
      const functionRights = await client.query<{ routineName: string; canExecute: boolean }>(
        `SELECT proc."proname" AS "routineName",
                pg_catalog.has_function_privilege(session_user, proc."oid", 'EXECUTE') AS "canExecute"
           FROM pg_catalog.pg_proc AS proc
           JOIN pg_catalog.pg_namespace AS schema
             ON schema."oid" = proc."pronamespace"
          WHERE schema."nspname" = 'portal_access'
            AND proc."proname" = ANY($1::text[])
          ORDER BY proc."proname"`,
        [fixtureFunctionNames],
      );
      expect(functionRights.rows).toEqual(
        fixtureFunctionNames.map((routineName) => ({ routineName, canExecute: false })),
      );
    });

    await withOwnerLogin(priorDatabaseName, async (client) => {
      const functionAcl = await client.query<{
        securityDefiner: boolean;
        settings: string[] | null;
        publicExecute: boolean;
        adminExecute: boolean;
      }>(
        `SELECT proc."prosecdef" AS "securityDefiner",
                proc."proconfig" AS "settings",
                EXISTS (
                  SELECT 1 FROM pg_catalog.aclexplode(proc."proacl") AS acl WHERE acl.grantee = 0
                ) AS "publicExecute",
                pg_catalog.has_function_privilege(
                  'travelos_admin_runtime',
                  'portal_access.associate_runtime_acceptance_fixture_portal_principal(uuid,text)',
                  'EXECUTE'
                ) AS "adminExecute"
           FROM pg_catalog.pg_proc AS proc
          WHERE proc.oid = 'portal_access.associate_runtime_acceptance_fixture_portal_principal(uuid,text)'::regprocedure`,
      );
      expect(functionAcl.rows).toEqual([
        {
          securityDefiner: true,
          settings: ["search_path=pg_catalog"],
          publicExecute: false,
          adminExecute: false,
        },
      ]);
    });
  });

  it("associates only an OPEN fixture with an active verified synthetic Portal Principal", async () => {
    const fixtureRunId = randomUUID();
    const noTripsFixtureRunId = randomUUID();
    const tripId = databaseModule.createUuidV7();
    const verifiedPrincipalId = `stage7-fixture-${randomUUID()}`;
    const unverifiedPrincipalId = `stage7-fixture-${randomUUID()}`;
    const nonSyntheticPrincipalId = `stage7-fixture-${randomUUID()}`;
    const secondVerifiedPrincipalId = `stage7-fixture-${randomUUID()}`;
    const principals = [
      {
        id: verifiedPrincipalId,
        email: `stage7-fixture-${randomUUID()}@example.test`,
        emailVerified: true,
      },
      {
        id: unverifiedPrincipalId,
        email: `stage7-fixture-${randomUUID()}@example.test`,
        emailVerified: false,
      },
      {
        id: nonSyntheticPrincipalId,
        email: `stage7-fixture-${randomUUID()}@example.invalid`,
        emailVerified: true,
      },
      {
        id: secondVerifiedPrincipalId,
        email: `stage7-fixture-${randomUUID()}@example.test`,
        emailVerified: true,
      },
    ];

    await withOwnerLogin(priorDatabaseName, async (client) => {
      await insertFixtureRun(client, priorAgencyId, fixtureRunId);
      await insertFixtureTrip(client, priorAgencyId, tripId);
      await linkFixtureTrip(client, priorAgencyId, fixtureRunId, 1, tripId);
      for (const principal of principals) {
        await client.query(
          `INSERT INTO "portal_access"."portal_user" ("id", "name", "email", "emailVerified")
           VALUES ($1, 'Stage 7 Fixture Principal', $2, $3)`,
          [principal.id, principal.email, principal.emailVerified],
        );
      }
    });

    await withPortalLogin(async (client) => {
      const associate = (runId: string, principalId: string) =>
        client.query<{ associated: boolean }>(
          `SELECT "portal_access"."associate_runtime_acceptance_fixture_portal_principal"(
             $1::uuid, $2
           ) AS "associated"`,
          [runId, principalId],
        );
      expect((await associate(fixtureRunId, verifiedPrincipalId)).rows).toEqual([
        { associated: true },
      ]);
      expect((await associate(fixtureRunId, verifiedPrincipalId)).rows).toEqual([
        { associated: true },
      ]);
      await expectSqlState(() => associate(fixtureRunId, unverifiedPrincipalId), "42501");
      await expectSqlState(() => associate(fixtureRunId, nonSyntheticPrincipalId), "42501");
      await expectSqlState(() => associate(randomUUID(), verifiedPrincipalId), "42501");
      await expectSqlState(() => associate(fixtureRunId, secondVerifiedPrincipalId), "23505");
    });

    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANUP_PENDING'
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, fixtureRunId],
      );
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANED'
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, fixtureRunId],
      );
      await insertFixtureRun(client, priorAgencyId, noTripsFixtureRunId);
    });

    await withPortalLogin(async (client) => {
      await expectSqlState(
        () =>
          client.query(
            `SELECT "portal_access"."associate_runtime_acceptance_fixture_portal_principal"(
               $1::uuid, $2
             )`,
            [noTripsFixtureRunId, verifiedPrincipalId],
          ),
        "23514",
      );
    });

    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANUP_PENDING'
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, noTripsFixtureRunId],
      );
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANED'
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, noTripsFixtureRunId],
      );
    });

    await withOwnerLogin(priorDatabaseName, async (client) => {
      const persisted = await client.query<{
        state: string;
        portalPrincipalId: string | null;
      }>(
        `SELECT "state", "portalPrincipalId"
           FROM "portal_access"."runtime_acceptance_fixture_run"
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, fixtureRunId],
      );
      expect(persisted.rows).toEqual([
        { state: "CLEANED", portalPrincipalId: verifiedPrincipalId },
      ]);
      const associationEvent = await client.query<{
        actorKind: string;
        actorStaffPrincipalId: string | null;
        portalPrincipalId: string | null;
      }>(
        `SELECT "actorKind", "actorStaffPrincipalId", "portalPrincipalId"
           FROM "audit"."runtime_acceptance_fixture_event"
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid
            AND "eventType" = 'FIXTURE_PORTAL_PRINCIPAL_ASSOCIATED'`,
        [priorAgencyId, fixtureRunId],
      );
      expect(associationEvent.rows).toEqual([
        {
          actorKind: "PORTAL_OPERATOR",
          actorStaffPrincipalId: null,
          portalPrincipalId: verifiedPrincipalId,
        },
      ]);
    });
  });

  it("retiredPrincipalHasNoPortalSessionContext", async () => {
    const principalId = `stage7-retired-${randomUUID()}`;
    const sessionId = randomUUID();
    const sessionToken = randomUUID();
    const email = `stage7-retired-${randomUUID()}@example.test`;
    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query(
        `INSERT INTO "portal_access"."portal_user" ("id", "name", "email", "emailVerified")
         VALUES ($1, 'Stage 7 Retired Principal', $2, true)`,
        [principalId, email],
      );
      await client.query(
        `INSERT INTO "portal_access"."portal_session" ("id", "expiresAt", "token", "updatedAt", "userId")
         VALUES ($1, clock_timestamp() + interval '1 day', $2, clock_timestamp(), $3)`,
        [sessionId, sessionToken, principalId],
      );
    });

    const cookie = await signedSessionCookie(portalRealm, sessionToken);
    const beforeRetirement = await portalRealm.getServerSession(
      new Request("http://portal.travelos.test/", { headers: { cookie } }),
    );
    expect(beforeRetirement?.principalId).toBe(principalId);

    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query(
        `UPDATE "portal_access"."portal_principal_context"
            SET "retiredAt" = clock_timestamp()
          WHERE "portalPrincipalId" = $1`,
        [principalId],
      );
    });

    await expect(
      portalRealm.getServerSession(
        new Request("http://portal.travelos.test/", { headers: { cookie } }),
      ),
    ).resolves.toBeNull();
  });

  it("backfills a preexisting Portal principal and session with authorization epoch one", async () => {
    await withPortalLogin(async (client) => {
      const result = await client.query<{
        agencyId: string;
        portalPrincipalId: string;
        sessionId: string;
        sessionPrincipalId: string;
        principalEpoch: string;
        sessionEpoch: string;
      }>(
        `
        SELECT principal."agencyId"::text AS "agencyId",
               principal."portalPrincipalId",
               session."sessionId",
               session."portalPrincipalId" AS "sessionPrincipalId",
               principal."authorizationEpoch"::text AS "principalEpoch",
               session."authorizationEpoch"::text AS "sessionEpoch"
          FROM "portal_access"."portal_principal_context" AS principal
          JOIN "portal_access"."portal_session_context" AS session
            ON session."agencyId" = principal."agencyId"
           AND session."portalPrincipalId" = principal."portalPrincipalId"
         WHERE principal."agencyId" = $1::uuid
           AND principal."portalPrincipalId" = $2
           AND session."sessionId" = $3
      `,
        [priorAgencyId, priorPortalPrincipalId, priorPortalSessionId],
      );
      expect(result.rows).toEqual([
        {
          agencyId: priorAgencyId,
          portalPrincipalId: priorPortalPrincipalId,
          sessionId: priorPortalSessionId,
          sessionPrincipalId: priorPortalPrincipalId,
          principalEpoch: "1",
          sessionEpoch: "1",
        },
      ]);
    });
  });

  it("keeps realm sessions separate when the email fields share one opaque marker", async () => {
    const portalSession = await portalRealm.getServerSession(
      new Request("http://portal.travelos.test/", {
        headers: { cookie: await signedSessionCookie(portalRealm, priorPortalSessionToken) },
      }),
    );
    expect(portalSession).toMatchObject({
      realm: "PORTAL",
      sessionId: priorPortalSessionId,
      principalId: priorPortalPrincipalId,
      agencyId: priorAgencyId,
      authorizationEpoch: 1n,
      recentMfaVerifiedAtEpochMs: null,
    });

    const staffSession = await staffRealm.getServerSession(
      new Request("http://admin.travelos.test/", {
        headers: { cookie: await signedSessionCookie(staffRealm, staffSessionToken) },
      }),
    );
    expect(staffSession).toMatchObject({
      realm: "STAFF",
      sessionId: staffSessionId,
      principalId: staffPrincipalId,
      agencyId: priorAgencyId,
    });
    expect(portalSession?.principalId).not.toBe(staffSession?.principalId);
    await expect(
      portalRealm.getServerSession(
        new Request("http://portal.travelos.test/", {
          headers: { cookie: await signedSessionCookie(staffRealm, staffSessionToken) },
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      staffRealm.getServerSession(
        new Request("http://admin.travelos.test/", {
          headers: { cookie: await signedSessionCookie(portalRealm, priorPortalSessionToken) },
        }),
      ),
    ).resolves.toBeNull();
  });

  it("creates Portal principal and session context on Portal-realm registration", async () => {
    await withPortalLogin(async (client) => {
      const principalId = "stage7-new-portal-principal";
      const sessionId = "stage7-new-portal-session";
      await client.query(
        `INSERT INTO "portal_access"."portal_user" ("id", "name", "email", "emailVerified")
         VALUES ($1, 'Stage 7 New Principal', 'stage7-registration-principal-marker', true)`,
        [principalId],
      );
      await client.query(
        `INSERT INTO "portal_access"."portal_session" ("id", "expiresAt", "token", "updatedAt", "userId")
         VALUES ($1, clock_timestamp() + interval '1 day', $2, clock_timestamp(), $3)`,
        [sessionId, randomUUID(), principalId],
      );
      const result = await client.query<{
        agencyId: string;
        principalEpoch: string;
        sessionEpoch: string;
      }>(
        `
        SELECT principal."agencyId"::text AS "agencyId",
               principal."authorizationEpoch"::text AS "principalEpoch",
               session."authorizationEpoch"::text AS "sessionEpoch"
          FROM "portal_access"."portal_principal_context" AS principal
          JOIN "portal_access"."portal_session_context" AS session
            ON session."agencyId" = principal."agencyId"
           AND session."portalPrincipalId" = principal."portalPrincipalId"
         WHERE principal."portalPrincipalId" = $1
           AND session."sessionId" = $2
      `,
        [principalId, sessionId],
      );
      expect(result.rows).toEqual([
        { agencyId: priorAgencyId, principalEpoch: "1", sessionEpoch: "1" },
      ]);
    });
  });

  it("limits Portal enrollment to local operators and authenticates via the normal Portal realm", async () => {
    const portalDatabase = await portalAuthPersistence!.withConnection(
      async (connection) => connection,
    );
    const localEnrollment = createLocalOperatorPortalEnrollmentService({
      database: portalDatabase,
      canonicalOrigin: "http://portal.travelos.test",
      realmKeyMaterial: stage7RealmKey,
      environment: "DEVELOPMENT",
    });
    expect(() =>
      createLocalOperatorPortalEnrollmentService({
        database: portalDatabase,
        canonicalOrigin: "https://portal.travelos.test",
        realmKeyMaterial: stage7RealmKey,
        environment: "PRODUCTION",
      }),
    ).toThrow(/development/iu);
    expect(() =>
      createLocalOperatorStaffEnrollmentRealm({
        database: portalDatabase,
        canonicalOrigin: "https://admin.travelos.test",
        realmKeyMaterial: stage7RealmKey,
        environment: "PRODUCTION",
      }),
    ).toThrow(/development/iu);

    const email = `stage7-operator-${randomUUID()}@example.test`;
    const syntheticCredential = createHash("sha512")
      .update("travelos-stage-7-disposable-portal-credential")
      .digest("base64url");
    await expect(
      localEnrollment.enroll({
        email: `stage7-operator-${randomUUID()}@external.test`,
        name: "Rejected Non-Synthetic Portal",
        password: syntheticCredential,
      }),
    ).rejects.toThrow(/synthetic.*example\.test/iu);
    const enrolled = await localEnrollment.enroll({
      email,
      name: "Stage 7 Synthetic Portal",
      password: syntheticCredential,
    });

    const principal = await withPortalLogin(async (client) => {
      const result = await client.query<{
        portalPrincipalId: string;
        agencyId: string;
        authorizationEpoch: string;
      }>(
        `SELECT principal."portalPrincipalId", principal."agencyId"::text AS "agencyId",
                principal."authorizationEpoch"::text AS "authorizationEpoch"
           FROM "portal_access"."portal_user" AS user_row
           JOIN "portal_access"."portal_principal_context" AS principal
             ON principal."portalPrincipalId" = user_row."id"
          WHERE user_row."email" = $1`,
        [email],
      );
      return result.rows[0] ?? null;
    });
    expect(principal).toMatchObject({ agencyId: priorAgencyId, authorizationEpoch: "1" });
    expect(principal?.portalPrincipalId).toBe(enrolled.portalPrincipalId);

    const publicSignup = await portalRealm.handle(
      new Request("http://portal.travelos.test/api/auth/portal/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://portal.travelos.test",
        },
        body: JSON.stringify({
          email: `stage7-public-${randomUUID()}@example.test`,
          name: "Denied Public Signup",
          password: syntheticCredential,
        }),
      }),
    );
    expect(publicSignup.status).toBeGreaterThanOrEqual(400);

    const signIn = await portalRealm.handle(
      new Request("http://portal.travelos.test/api/auth/portal/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://portal.travelos.test",
        },
        body: JSON.stringify({ email, password: syntheticCredential }),
      }),
    );
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.getSetCookie()[0]?.split(";", 1)[0];
    if (cookie === undefined)
      throw new Error("Portal sign-in response did not set a session cookie");
    expect(cookie).toMatch(/^travelos-dev-portal-session=/u);
    const portalSession = await portalRealm.getServerSession(
      new Request("http://portal.travelos.test/", { headers: { cookie } }),
    );
    expect(portalSession).toMatchObject({
      realm: "PORTAL",
      principalId: principal?.portalPrincipalId,
      agencyId: priorAgencyId,
      authorizationEpoch: 1n,
    });
    await expect(
      staffRealm.getServerSession(
        new Request("http://admin.travelos.test/", { headers: { cookie } }),
      ),
    ).resolves.toBeNull();
  });

  it("rolls back a synthetic Portal enrollment when native verification fails", async () => {
    const portalDatabase = await portalAuthPersistence!.withConnection(
      async (connection) => connection,
    );
    const localEnrollment = createLocalOperatorPortalEnrollmentService({
      database: portalDatabase,
      canonicalOrigin: "http://portal.travelos.test",
      realmKeyMaterial: stage7RealmKey,
      environment: "DEVELOPMENT",
    });
    const email = `stage7-rollback-${randomUUID()}@example.test`;
    const syntheticCredential = createHash("sha512")
      .update("travelos-stage-7-disposable-portal-credential")
      .digest("base64url");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query(`
        CREATE FUNCTION "portal_access"."stage7_reject_email_verification"()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF OLD."emailVerified" IS FALSE
             AND NEW."emailVerified" IS TRUE
             AND OLD."email" LIKE ('stage7-rollback-%' || chr(64) || 'example.test') THEN
            RAISE EXCEPTION 'synthetic Stage 7 verification failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await client.query(`
        CREATE TRIGGER "stage7_reject_email_verification"
        BEFORE UPDATE OF "emailVerified" ON "portal_access"."portal_user"
        FOR EACH ROW EXECUTE FUNCTION "portal_access"."stage7_reject_email_verification"()
      `);
    });
    try {
      await expect(
        localEnrollment.enroll({
          email,
          name: "Stage 7 Rollback Portal",
          password: syntheticCredential,
        }),
      ).rejects.toThrow(/verification failed/iu);
      const remainingUsers = await withPortalLogin(async (client) =>
        client.query<{ readonly count: string }>(
          `SELECT count(*)::text AS count
             FROM "portal_access"."portal_user"
            WHERE "email" = $1`,
          [email],
        ),
      );
      expect(remainingUsers.rows).toEqual([{ count: "0" }]);
    } finally {
      await withOwnerLogin(priorDatabaseName, async (client) => {
        await client.query(`
          DROP TRIGGER "stage7_reject_email_verification" ON "portal_access"."portal_user"
        `);
        await client.query(`
          DROP FUNCTION "portal_access"."stage7_reject_email_verification"()
        `);
      });
    }
    const enrolled = await localEnrollment.enroll({
      email,
      name: "Stage 7 Rollback Portal",
      password: syntheticCredential,
    });
    const recoveredUser = await withPortalLogin(async (client) =>
      client.query<{ readonly id: string; readonly emailVerified: boolean }>(
        `SELECT "id", "emailVerified"
           FROM "portal_access"."portal_user"
          WHERE "email" = $1`,
        [email],
      ),
    );
    expect(recoveredUser.rows).toEqual([{ id: enrolled.portalPrincipalId, emailVerified: true }]);
  });

  it("portalEnrollmentAssociationRollsBackOnInvalidRun", async () => {
    const portalDatabase = await portalAuthPersistence!.withConnection(
      async (connection) => connection,
    );
    const localEnrollment = createLocalOperatorPortalEnrollmentService({
      database: portalDatabase,
      canonicalOrigin: "http://portal.travelos.test",
      realmKeyMaterial: stage7RealmKey,
      environment: "DEVELOPMENT",
    });
    const email = `stage7-invalid-fixture-${randomUUID()}@example.test`;
    const syntheticCredential = createHash("sha512")
      .update("travelos-stage-7-disposable-portal-credential")
      .digest("base64url");
    const enrollmentInput = {
      email,
      name: "Stage 7 Invalid Fixture Principal",
      password: syntheticCredential,
      fixtureRunId: databaseModule.createUuidV7(),
    };

    await expect(localEnrollment.enroll(enrollmentInput as never)).rejects.toBeDefined();
    const persistedIdentity = await withPortalLogin(async (client) =>
      client.query<{ readonly users: string; readonly contexts: string }>(
        `SELECT
           (SELECT count(*)::text FROM "portal_access"."portal_user" WHERE "email" = $1) AS "users",
           (SELECT count(*)::text
              FROM "portal_access"."portal_user" AS user_row
              JOIN "portal_access"."portal_principal_context" AS context
                ON context."portalPrincipalId" = user_row."id"
             WHERE user_row."email" = $1) AS "contexts"`,
        [email],
      ),
    );
    expect(persistedIdentity.rows).toEqual([{ users: "0", contexts: "0" }]);
  });

  it("keeps concurrent local Portal enrollment for one normalized address to one verified identity", async () => {
    const portalDatabase = await portalAuthPersistence!.withConnection(
      async (connection) => connection,
    );
    const localEnrollment = createLocalOperatorPortalEnrollmentService({
      database: portalDatabase,
      canonicalOrigin: "http://portal.travelos.test",
      realmKeyMaterial: stage7RealmKey,
      environment: "DEVELOPMENT",
    });
    const email = `stage7-concurrent-${randomUUID()}@example.test`;
    const syntheticCredential = createHash("sha512")
      .update("travelos-stage-7-disposable-portal-credential")
      .digest("base64url");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const results = await Promise.allSettled([
      localEnrollment.enroll({
        email,
        name: "Stage 7 Concurrent Portal A",
        password: syntheticCredential,
      }),
      localEnrollment.enroll({
        email: email.toUpperCase(),
        name: "Stage 7 Concurrent Portal B",
        password: syntheticCredential,
      }),
    ]);
    const successfulIds = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.portalPrincipalId] : [],
    );
    const uniqueSuccessfulIds = [...new Set(successfulIds)];
    expect(successfulIds.length).toBeGreaterThan(0);
    expect(uniqueSuccessfulIds).toHaveLength(1);

    const users = await withPortalLogin(async (client) =>
      client.query<{
        readonly id: string;
        readonly email: string;
        readonly emailVerified: boolean;
      }>(
        `SELECT "id", "email", "emailVerified"
           FROM "portal_access"."portal_user"
          WHERE "email" = $1`,
        [email],
      ),
    );
    expect(users.rows).toEqual([{ id: uniqueSuccessfulIds[0], email, emailVerified: true }]);
  });

  it("gives existing Agency Owner templates the Stage 7 grant-management permission", async () => {
    const result = await withOwnerLogin(emptyDatabaseName, (client) =>
      client.query<{ permissionCount: string }>(
        `
        SELECT count(*)::text AS "permissionCount"
          FROM "staff_access"."role" AS role
          JOIN "staff_access"."role_permission" AS permission
            ON permission."roleId" = role."id"
         WHERE role."agencyId" = $1::uuid
           AND role."templateKey" = 'agency-owner-v1'
           AND role."isSystemTemplate"
           AND permission."permissionId" = 'trip.access.manage'
           AND permission."scopeKind" = 'AGENCY'
           AND permission."accessLevel" = 'ALL'
      `,
        [emptyAgencyId],
      ),
    );
    expect(result.rows).toEqual([{ permissionCount: "1" }]);
  });

  it("allows the Portal role only scoped grant, epoch/session, and immutable snapshot reads", async () => {
    await withPortalLogin(async (client) => {
      const identity = await client.query<{
        sessionUser: string;
        currentUser: string;
        isSuperuser: boolean;
        canSetOwner: boolean;
        canSetMigrator: boolean;
        canSetAdminRuntime: boolean;
        canSetWorkerRuntime: boolean;
        canUsePortalRuntime: boolean;
        canUseAdminRuntime: boolean;
        canUseWorkerRuntime: boolean;
      }>(`
        SELECT session_user AS "sessionUser",
               current_user AS "currentUser",
               role.rolsuper AS "isSuperuser",
               pg_has_role(session_user, 'travelos_owner', 'SET') AS "canSetOwner",
               pg_has_role(session_user, 'travelos_migrator', 'SET') AS "canSetMigrator",
               pg_has_role(session_user, 'travelos_admin_runtime', 'SET') AS "canSetAdminRuntime",
               pg_has_role(session_user, 'travelos_worker_runtime', 'SET') AS "canSetWorkerRuntime",
               pg_has_role(session_user, 'travelos_portal_runtime', 'USAGE') AS "canUsePortalRuntime",
               pg_has_role(session_user, 'travelos_admin_runtime', 'USAGE') AS "canUseAdminRuntime",
               pg_has_role(session_user, 'travelos_worker_runtime', 'USAGE') AS "canUseWorkerRuntime"
          FROM pg_catalog.pg_roles AS role
         WHERE role.rolname = session_user
      `);
      expect(identity.rows).toEqual([
        {
          sessionUser: "travelos_portal_api",
          currentUser: "travelos_portal_api",
          isSuperuser: false,
          canSetOwner: false,
          canSetMigrator: false,
          canSetAdminRuntime: false,
          canSetWorkerRuntime: false,
          canUsePortalRuntime: true,
          canUseAdminRuntime: false,
          canUseWorkerRuntime: false,
        },
      ]);

      const roleEdges = await client.query<{
        readonly grantedRole: string;
        readonly memberRole: string;
        readonly adminOption: boolean;
        readonly inheritOption: boolean;
        readonly setOption: boolean;
      }>(`
        SELECT granted.rolname AS "grantedRole",
               member.rolname AS "memberRole",
               membership.admin_option AS "adminOption",
               membership.inherit_option AS "inheritOption",
               membership.set_option AS "setOption"
          FROM pg_catalog.pg_auth_members AS membership
          JOIN pg_catalog.pg_roles AS granted ON granted.oid = membership.roleid
          JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
         WHERE granted.rolname = ANY(ARRAY[
                 'travelos_owner', 'travelos_migrator', 'travelos_admin_runtime',
                 'travelos_portal_runtime', 'travelos_worker_runtime'
               ])
            OR member.rolname = ANY(ARRAY[
                 'travelos_owner', 'travelos_migrator', 'travelos_admin_api',
                 'travelos_portal_api', 'travelos_worker', 'travelos_admin_runtime',
                 'travelos_portal_runtime', 'travelos_worker_runtime'
               ])
         ORDER BY granted.rolname, member.rolname
      `);
      expect(roleEdges.rows).toEqual([
        {
          grantedRole: "travelos_admin_runtime",
          memberRole: "travelos_admin_api",
          adminOption: false,
          inheritOption: true,
          setOption: false,
        },
        {
          grantedRole: "travelos_owner",
          memberRole: "travelos_migrator",
          adminOption: false,
          inheritOption: false,
          setOption: true,
        },
        {
          grantedRole: "travelos_portal_runtime",
          memberRole: "travelos_portal_api",
          adminOption: false,
          inheritOption: true,
          setOption: false,
        },
        {
          grantedRole: "travelos_worker_runtime",
          memberRole: "travelos_worker",
          adminOption: false,
          inheritOption: true,
          setOption: false,
        },
      ]);
      const jobRuntimeSchema = await client.query<{
        readonly canUseJobRuntime: boolean;
      }>(`
        SELECT has_schema_privilege(session_user, 'job_runtime', 'USAGE') AS "canUseJobRuntime"
      `);
      expect(jobRuntimeSchema.rows).toEqual([{ canUseJobRuntime: false }]);

      const allowedReads = [
        `SELECT "authorizationEpoch" FROM "portal_access"."portal_principal_context" LIMIT 0`,
        `SELECT "sessionId", "portalPrincipalId", "agencyId", "authorizationEpoch" FROM "portal_access"."portal_session_context" LIMIT 0`,
        `SELECT "agencyId", "portalPrincipalId", "tripId", "capabilities", "expiresAt", "revokedAt" FROM "portal_access"."trip_access_grant" LIMIT 0`,
        `SELECT "activePublicationId" FROM "trip_ops"."publication_pointer" LIMIT 0`,
        `SELECT "schemaVersion", "projectionHash" FROM "trip_ops"."publication_version" LIMIT 0`,
        `SELECT "canonicalPayload" FROM "trip_ops"."publication_snapshot" LIMIT 0`,
      ];
      for (const statement of allowedReads) await client.query(statement);

      const contextRows = await client.query<{
        readonly agencyId: string;
        readonly principalEpoch: string;
        readonly sessionId: string;
        readonly sessionEpoch: string;
      }>(
        `SELECT principal."agencyId"::text AS "agencyId",
                principal."authorizationEpoch"::text AS "principalEpoch",
                session."sessionId",
                session."authorizationEpoch"::text AS "sessionEpoch"
           FROM "portal_access"."portal_principal_context" AS principal
           JOIN "portal_access"."portal_session_context" AS session
             ON session."agencyId" = principal."agencyId"
            AND session."portalPrincipalId" = principal."portalPrincipalId"
          WHERE principal."agencyId" = $1::uuid
            AND principal."portalPrincipalId" = $2
            AND session."sessionId" = $3`,
        [priorAgencyId, priorPortalPrincipalId, priorPortalSessionId],
      );
      expect(contextRows.rows).toEqual([
        {
          agencyId: priorAgencyId,
          principalEpoch: "1",
          sessionId: priorPortalSessionId,
          sessionEpoch: "1",
        },
      ]);

      const publishedRows = await client.query<{
        readonly publicationId: string;
        readonly version: number;
        readonly schemaVersion: number;
        readonly projectionHash: string;
        readonly canonicalPayload: string;
      }>(
        `SELECT pointer."activePublicationId"::text AS "publicationId",
                version."version",
                version."schemaVersion",
                version."projectionHash",
                snapshot."canonicalPayload"
           FROM "trip_ops"."publication_pointer" AS pointer
           JOIN "trip_ops"."publication_version" AS version
             ON version."publicationId" = pointer."activePublicationId"
            AND version."agencyId" = pointer."agencyId"
            AND version."tripId" = pointer."tripId"
           JOIN "trip_ops"."publication_snapshot" AS snapshot
             ON snapshot."publicationId" = version."publicationId"
            AND snapshot."agencyId" = version."agencyId"
            AND snapshot."tripId" = version."tripId"
          WHERE pointer."agencyId" = $1::uuid AND pointer."tripId" = $2::uuid`,
        [priorAgencyId, primaryTripId],
      );
      expect(publishedRows.rows).toEqual([
        {
          publicationId: stage7PublicationId,
          version: 1,
          schemaVersion: 1,
          projectionHash: stage7ProjectionHash,
          canonicalPayload: stage7SnapshotPayload,
        },
      ]);

      const forbiddenReads = [
        `SELECT "title" FROM "trip_ops"."trip" LIMIT 0`,
        `SELECT "flightNumber" FROM "trip_ops"."flight_item_detail" LIMIT 0`,
        `SELECT "propertyName" FROM "trip_ops"."accommodation_item_detail" LIMIT 0`,
        `SELECT "supplierReference" FROM "trip_ops"."reservation" LIMIT 0`,
        `SELECT "linkRole" FROM "trip_ops"."reservation_item_link" LIMIT 0`,
        `SELECT "state" FROM "staff_access"."staff_membership" LIMIT 0`,
        `SELECT "secret" FROM "staff_access"."staff_two_factor" LIMIT 0`,
        `SELECT "amountMinor" FROM "finance"."supplier_cost_line" LIMIT 0`,
        `SELECT "internalNote" FROM "finance"."supplier_cost_line" LIMIT 0`,
        `SELECT "action" FROM "audit"."trip_publication_event" LIMIT 0`,
        `SELECT "eventType" FROM "integration"."trip_publication_outbox" LIMIT 0`,
        `SELECT "publisherStaffPrincipalId" FROM "trip_ops"."publication_version" LIMIT 0`,
        `SELECT "activeVersion" FROM "trip_ops"."publication_pointer" LIMIT 0`,
        `SELECT "issuedByStaffPrincipalId" FROM "portal_access"."trip_access_grant" LIMIT 0`,
        `SELECT "issuedAt" FROM "portal_access"."trip_access_grant" LIMIT 0`,
        `SELECT "relationshipLabel" FROM "portal_access"."trip_access_grant" LIMIT 0`,
        `INSERT INTO "portal_access"."trip_access_grant" ("grantId") VALUES (gen_random_uuid())`,
      ];
      for (const statement of forbiddenReads) {
        await expectSqlState(() => client.query(statement), "42501");
      }
      await expectSqlState(() => client.query('SET ROLE "travelos_owner"'), "42501");
      await expectSqlState(() => client.query('SET ROLE "travelos_migrator"'), "42501");
      await expectSqlState(() => client.query('SET ROLE "travelos_admin_runtime"'), "42501");
      await expectSqlState(() => client.query('SET ROLE "travelos_worker_runtime"'), "42501");
    });
  });

  it("owns Stage 7 grant and event tables by travelos_owner without PUBLIC ACLs", async () => {
    await withPortalLogin(async (client) => {
      const rows = await client.query<{
        relationName: string;
        ownerName: string;
        publicPrivilege: string | null;
      }>(`
        SELECT relation.relname AS "relationName",
               pg_catalog.pg_get_userbyid(relation.relowner) AS "ownerName",
               public_acl.privilege_type AS "publicPrivilege"
          FROM pg_catalog.pg_class AS relation
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          LEFT JOIN LATERAL (
            SELECT privilege.privilege_type
              FROM pg_catalog.aclexplode(
                COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
              ) AS privilege
             WHERE privilege.grantee = 0
             LIMIT 1
          ) AS public_acl ON true
         WHERE namespace.nspname IN ('portal_access', 'audit', 'integration')
           AND relation.relname IN (
             'portal_principal_context', 'portal_session_context', 'trip_access_grant',
             'trip_access_idempotency', 'trip_access_grant_event', 'trip_access_grant_outbox'
           )
         ORDER BY relation.relname
      `);
      expect(rows.rows.map(({ relationName }) => relationName)).toEqual([
        "portal_principal_context",
        "portal_session_context",
        "trip_access_grant",
        "trip_access_grant_event",
        "trip_access_grant_outbox",
        "trip_access_idempotency",
      ]);
      expect(rows.rows.every((row) => row.ownerName === "travelos_owner")).toBe(true);
      expect(rows.rows.every((row) => row.publicPrivilege === null)).toBe(true);

      const publicSchemaPrivileges = await client.query<{
        readonly schemaName: string;
        readonly privilegeType: string;
      }>(`
        SELECT namespace.nspname AS "schemaName",
               privilege.privilege_type AS "privilegeType"
          FROM pg_catalog.pg_namespace AS namespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
          ) AS privilege
         WHERE namespace.nspname IN ('portal_access', 'trip_ops', 'audit', 'integration', 'job_runtime')
           AND privilege.grantee = 0
         ORDER BY namespace.nspname, privilege.privilege_type
      `);
      expect(publicSchemaPrivileges.rows).toEqual([]);
    });
  });

  it("rejects expired, stale, wrong-scope, and wrong-Agency issue attempts without mutation", async () => {
    const repository = createTripAccessRepository();
    expect(repository).not.toBeNull();
    if (repository === null) return;

    const before = await readTripAccessCounts();
    await expect(
      repository.issueTripAccessGrant(
        {
          ...issueCommand("stage7-expired-issue"),
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        },
        staffAuthorization,
      ),
    ).rejects.toBeInstanceOf(InputValidationError);

    const staleProof: StaffAuthorizationOperationProof = {
      ...staffAuthorization,
      session: {
        ...staffAuthorization.session,
        authorizationEpoch: staffAuthorization.session.authorizationEpoch - 1n,
      },
    };
    await expect(
      repository.issueTripAccessGrant(issueCommand("stage7-stale-proof"), staleProof),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const wrongScopeProof: StaffAuthorizationOperationProof = {
      ...staffAuthorization,
      session: { ...staffAuthorization.session, agencyId: asOpaqueId(emptyAgencyId) },
    };
    await expect(
      repository.issueTripAccessGrant(issueCommand("stage7-wrong-scope-proof"), wrongScopeProof),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      repository.issueTripAccessGrant(
        { ...issueCommand("stage7-wrong-agency"), agencyId: asOpaqueId(emptyAgencyId) },
        staffAuthorization,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      repository.issueTripAccessGrant(
        { ...issueCommand("stage7-unknown-trip"), tripId: asOpaqueId(secondaryTripId) },
        staffAuthorization,
      ),
    ).resolves.toBeNull();
    expect(await readTripAccessCounts()).toEqual(before);
  });

  it("issues one same-Agency grant with atomic immutable event and outbox records", async () => {
    const idempotencyPrivileges = await withOwnerLogin(priorDatabaseName, (client) =>
      client.query<{
        readonly canSelect: boolean;
        readonly canInsert: boolean;
        readonly canUpdate: boolean;
        readonly canSetIssuedAt: boolean;
      }>(`
        SELECT has_table_privilege(
                 'travelos_admin_api', 'portal_access.trip_access_idempotency', 'SELECT'
               ) AS "canSelect",
               has_table_privilege(
                 'travelos_admin_api', 'portal_access.trip_access_idempotency', 'INSERT'
               ) AS "canInsert",
               has_table_privilege(
                 'travelos_admin_api', 'portal_access.trip_access_idempotency', 'UPDATE'
               ) AS "canUpdate",
               has_column_privilege(
                 'travelos_admin_api', 'portal_access.trip_access_grant', 'issuedAt', 'INSERT'
               ) AS "canSetIssuedAt"
      `),
    );
    expect(idempotencyPrivileges.rows).toEqual([
      { canSelect: true, canInsert: true, canUpdate: false, canSetIssuedAt: false },
    ]);

    const repository = createTripAccessRepository();
    expect(repository).not.toBeNull();
    if (repository === null) return;

    const command = issueCommand("stage7-issue-atomic");
    const before = await readTripAccessCounts();
    await installOutboxFailureTrigger();
    try {
      await expect(
        repository.issueTripAccessGrant(command, staffAuthorization),
      ).rejects.toMatchObject({
        code: "23514",
      });
    } finally {
      await removeOutboxFailureTrigger();
    }
    expect(await readTripAccessCounts()).toEqual(before);

    const grant = await repository.issueTripAccessGrant(command, staffAuthorization);
    expect(grant).not.toBeNull();
    if (grant === null) return;
    issuedGrantId = grant.grantId;
    expect(grant).toMatchObject({
      agencyId: asOpaqueId(priorAgencyId),
      portalPrincipalId: priorPortalPrincipalId,
      tripId: asOpaqueId(primaryTripId),
      capabilities: ["trip.view_current"],
      issuedByStaffPrincipalId: staffPrincipalId,
      issuedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u),
      expiresAt: command.expiresAt,
      relationshipLabel: "Trip companion",
      revokedByStaffPrincipalId: null,
      revokedAt: null,
    });

    const replay = await repository.issueTripAccessGrant(command, staffAuthorization);
    expect(replay).toEqual(grant);
    expect(await readTripAccessCounts()).toEqual({
      grantCount: "1",
      activeGrantCount: "1",
      eventCount: "1",
      outboxCount: "1",
      idempotencyCount: "1",
      principalEpoch: "1",
      sessionEpoch: "1",
    });
  });

  it("rejects idempotency-key reuse with a different request and duplicate active grants", async () => {
    const repository = createTripAccessRepository();
    expect(repository).not.toBeNull();
    if (repository === null) return;

    const before = await readTripAccessCounts();
    await expect(
      repository.issueTripAccessGrant(
        { ...issueCommand("stage7-issue-atomic"), relationshipLabel: "Different request" },
        staffAuthorization,
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(
      repository.issueTripAccessGrant(issueCommand("stage7-duplicate-active"), staffAuthorization),
    ).rejects.toBeInstanceOf(TransactionConflictError);
    expect(await readTripAccessCounts()).toEqual(before);
  });

  it("allows Portal runtime to read an issued grant through its explicit columns", async () => {
    expect(issuedGrantId).not.toBeNull();
    if (issuedGrantId === null) return;

    await withPortalLogin(async (client) => {
      const result = await client.query<{
        readonly grantId: string;
        readonly agencyId: string;
        readonly portalPrincipalId: string;
        readonly tripId: string;
        readonly capabilities: readonly string[];
        readonly expiresAt: Date;
        readonly revokedAt: Date | null;
        readonly grantState: string;
      }>(
        `SELECT "grantId"::text AS "grantId",
                "agencyId"::text AS "agencyId",
                "portalPrincipalId",
                "tripId"::text AS "tripId",
                "capabilities",
                "expiresAt",
                "revokedAt",
                "grantState"
           FROM "portal_access"."trip_access_grant"
          WHERE "grantId" = $1::uuid
            AND "agencyId" = $2::uuid
            AND "portalPrincipalId" = $3
            AND "tripId" = $4::uuid`,
        [issuedGrantId, priorAgencyId, priorPortalPrincipalId, primaryTripId],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        grantId: issuedGrantId,
        agencyId: priorAgencyId,
        portalPrincipalId: priorPortalPrincipalId,
        tripId: primaryTripId,
        capabilities: ["trip.view_current"],
        grantState: "ACTIVE",
        revokedAt: null,
      });
      expect(result.rows[0]?.expiresAt).toBeInstanceOf(Date);
    });

    if (portalAuthPersistence === null) {
      throw new Error("Stage 7 Portal persistence fixture was not initialized");
    }
    const snapshot = await portalAuthPersistence.withConnection(async (connection) =>
      createPostgresPortalTripSnapshotReader(connection).readCurrentPublishedTripSnapshot({
        agencyId: priorAgencyId,
        portalPrincipalId: priorPortalPrincipalId,
        portalSessionId: priorPortalSessionId,
        authorizationEpoch: 1n,
        tripId: primaryTripId,
      }),
    );
    expect(snapshot).toEqual(JSON.parse(stage7SnapshotPayload));
    expect(JSON.stringify(snapshot)).not.toContain("INTERNAL_ONLY");
  });

  it("serves only the current immutable snapshot through the Portal HTTP route", async () => {
    const cookie = await signedSessionCookie(portalRealm, priorPortalSessionToken);
    const sentinel = "INTERNAL_ONLY-stage7-snapshot-sentinel";
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await withPortalHttp(async (baseUrl) => {
      const v1 = await portalTripRequest(baseUrl, primaryTripId, cookie);
      expect(v1.status).toBe(200);
      expect(v1.headers["cache-control"]).toBe("no-store, private");
      expect(v1.body).toEqual(JSON.parse(stage7SnapshotPayload));

      const otherTrip = await portalTripRequest(baseUrl, secondaryTripId, cookie);
      expect(otherTrip.status).toBe(404);
      expect(otherTrip.text).toBe("");

      await withOwnerLogin(priorDatabaseName, (client) =>
        client.query(
          `UPDATE "trip_ops"."trip"
              SET "title" = 'Changed unpublished workspace title'
            WHERE "agencyId" = $1::uuid AND "id" = $2::uuid`,
          [priorAgencyId, primaryTripId],
        ),
      );
      const afterWorkspaceMutation = await portalTripRequest(baseUrl, primaryTripId, cookie);
      expect(afterWorkspaceMutation.status).toBe(200);
      expect(afterWorkspaceMutation.body).toEqual(JSON.parse(stage7SnapshotPayload));

      await withOwnerLogin(priorDatabaseName, (client) =>
        client.query(
          `DELETE FROM "trip_ops"."publication_pointer"
            WHERE "agencyId" = $1::uuid AND "tripId" = $2::uuid`,
          [priorAgencyId, primaryTripId],
        ),
      );
      try {
        const noPublication = await portalTripRequest(baseUrl, primaryTripId, cookie);
        expect(noPublication.status).toBe(404);
        expect(noPublication.text).toBe("");
      } finally {
        await withOwnerLogin(priorDatabaseName, (client) =>
          client.query(
            `INSERT INTO "trip_ops"."publication_pointer"
               ("agencyId", "tripId", "activePublicationId", "activeVersion")
             VALUES ($1::uuid, $2::uuid, $3::uuid, 1)
             ON CONFLICT ("agencyId", "tripId") DO UPDATE
               SET "activePublicationId" = EXCLUDED."activePublicationId",
                   "activeVersion" = EXCLUDED."activeVersion",
                   "updatedAt" = statement_timestamp()`,
            [priorAgencyId, primaryTripId, stage7PublicationId],
          ),
        );
      }

      if (tripAccessPersistence === null) {
        throw new Error("Stage 7 Staff persistence fixture was not initialized");
      }
      const staffCookie = await signedSessionCookie(staffRealm, staffSessionToken);
      const publicationOperations = databaseModule.createPostgresStaffTripPublicationOperations(
        tripAccessPersistence,
        createAdminStaffSessionResolver(staffRealm, {
          canonicalOrigin: "http://admin.travelos.test",
          expectedHost: "admin.travelos.test",
        }),
        { validate: (value) => void PortalTripSnapshotV1Schema.parse(value) },
      );
      const tripId = asOpaqueId(primaryTripId);
      const previewV2 = await publicationOperations.previewTrip(staffCookie, tripId);
      const publicationV2 = await publicationOperations.publishTrip(staffCookie, tripId, {
        expectedWorkspaceRevision: previewV2.workspaceRevision.toString(),
        expectedProjectionHash: previewV2.projectionHash,
        idempotencyKey: "stage7-publish-v2-after-workspace-edit",
      });
      expect(publicationV2.version).toBe(2);
      expect(publicationV2.projection.trip.title).toBe("Changed unpublished workspace title");
      const v2 = await portalTripRequest(baseUrl, primaryTripId, cookie);
      expect(v2.status).toBe(200);
      expect(v2.headers["cache-control"]).toBe("no-store, private");
      expect(v2.body).toEqual(publicationV2.projection);

      const originalV1 = await withOwnerLogin(priorDatabaseName, async (client) => {
        const result = await client.query<{ readonly canonicalPayload: string }>(
          `SELECT "canonicalPayload" FROM "trip_ops"."publication_snapshot"
            WHERE "publicationId" = $1::uuid`,
          [stage7PublicationId],
        );
        return result.rows[0]?.canonicalPayload ?? null;
      });
      expect(originalV1).toBe(stage7SnapshotPayload);

      await publishSyntheticSnapshot(
        stage7PublicationIdInvalid,
        3,
        1,
        stage7SnapshotPayloadInvalid,
      );
      const invalidSnapshot = await portalTripRequest(baseUrl, primaryTripId, cookie);
      expect(invalidSnapshot.status).toBe(500);
      expect(invalidSnapshot.text).not.toContain(sentinel);
      expect(log).not.toHaveBeenCalled();

      if (portalAuthPersistence === null) {
        throw new Error("Stage 7 Portal persistence fixture was not initialized");
      }
      const repositoryError = await portalAuthPersistence
        .withConnection((connection) =>
          createPostgresPortalTripSnapshotReader(connection).readCurrentPublishedTripSnapshot({
            agencyId: priorAgencyId,
            portalPrincipalId: priorPortalPrincipalId,
            portalSessionId: priorPortalSessionId,
            authorizationEpoch: 1n,
            tripId: primaryTripId,
          }),
        )
        .catch((error: unknown) => error);
      expect(repositoryError).toBeInstanceOf(Error);
      if (!(repositoryError instanceof Error)) return;
      expect(repositoryError.message).not.toContain(sentinel);
      expect(repositoryError.message).toBe("Portal published snapshot is invalid");
    });
  });

  it("prevents mutation and deletion of grant, audit, and outbox history", async () => {
    expect(issuedGrantId).not.toBeNull();
    if (issuedGrantId === null) return;
    const before = await readTripAccessCounts();

    await withOwnerLogin(priorDatabaseName, async (client) => {
      await expectSqlState(
        () =>
          client.query(
            `UPDATE "portal_access"."trip_access_grant"
                SET "relationshipLabel" = 'Changed history'
              WHERE "grantId" = $1::uuid`,
            [issuedGrantId],
          ),
        "55000",
      );
      await expectSqlState(
        () =>
          client.query(
            `DELETE FROM "portal_access"."trip_access_grant" WHERE "grantId" = $1::uuid`,
            [issuedGrantId],
          ),
        "55000",
      );
      await expectSqlState(
        () =>
          client.query(
            `UPDATE "audit"."trip_access_grant_event"
                SET "eventType" = 'TRIP_ACCESS_GRANT_REVOKED'
              WHERE "grantId" = $1::uuid`,
            [issuedGrantId],
          ),
        "55000",
      );
      await expectSqlState(
        () =>
          client.query(
            `DELETE FROM "integration"."trip_access_grant_outbox" WHERE "grantId" = $1::uuid`,
            [issuedGrantId],
          ),
        "55000",
      );
    });

    expect(await readGrantState(issuedGrantId)).toEqual({
      grantState: "ACTIVE",
      hasExpiredAt: false,
      hasRevokedAt: false,
    });
    expect(await readTripAccessCounts()).toEqual(before);
  });

  it("revokes atomically, increments the Portal authorization epoch, and replays idempotently", async () => {
    expect(issuedGrantId).not.toBeNull();
    if (issuedGrantId === null) return;
    const portalSessionBeforeRevoke = await portalRealm.getServerSession(
      new Request("http://portal.travelos.test/", {
        headers: { cookie: await signedSessionCookie(portalRealm, priorPortalSessionToken) },
      }),
    );
    expect(portalSessionBeforeRevoke?.authorizationEpoch).toBe(1n);
    const repository = createTripAccessRepository();
    expect(repository).not.toBeNull();
    if (repository === null) return;

    const command = revokeCommand(issuedGrantId, "stage7-revoke-atomic");
    const before = await readTripAccessCounts();
    const staleProof: StaffAuthorizationOperationProof = {
      ...staffAuthorization,
      session: {
        ...staffAuthorization.session,
        authorizationEpoch: staffAuthorization.session.authorizationEpoch - 1n,
      },
    };
    await expect(repository.revokeTripAccessGrant(command, staleProof)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(await readTripAccessCounts()).toEqual(before);

    await installOutboxFailureTrigger();
    try {
      await expect(
        repository.revokeTripAccessGrant(command, staffAuthorization),
      ).rejects.toMatchObject({
        code: "23514",
      });
    } finally {
      await removeOutboxFailureTrigger();
    }
    expect(await readTripAccessCounts()).toEqual(before);
    expect(await readGrantState(issuedGrantId)).toEqual({
      grantState: "ACTIVE",
      hasExpiredAt: false,
      hasRevokedAt: false,
    });

    const revoked = await repository.revokeTripAccessGrant(command, staffAuthorization);
    expect(revoked).not.toBeNull();
    if (revoked === null) return;
    await expect(
      portalRealm.getServerSession(
        new Request("http://portal.travelos.test/", {
          headers: { cookie: await signedSessionCookie(portalRealm, priorPortalSessionToken) },
        }),
      ),
    ).resolves.toBeNull();
    await withPortalHttp(async (baseUrl) => {
      const denied = await portalTripRequest(
        baseUrl,
        primaryTripId,
        await signedSessionCookie(portalRealm, priorPortalSessionToken),
      );
      expect(denied.status).toBe(401);
      expect(denied.text).toBe("");
      expect(denied.headers["cache-control"]).toBe("no-store, private");
    });
    expect(revoked).toMatchObject({
      revokedByStaffPrincipalId: staffPrincipalId,
      revokedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u),
    });
    expect(await readGrantState(issuedGrantId)).toEqual({
      grantState: "REVOKED",
      hasExpiredAt: false,
      hasRevokedAt: true,
    });
    const afterRevoke = {
      grantCount: "1",
      activeGrantCount: "0",
      eventCount: "2",
      outboxCount: "2",
      idempotencyCount: "2",
      principalEpoch: "2",
      sessionEpoch: "1",
    };
    expect(await readTripAccessCounts()).toEqual(afterRevoke);
    expect(await repository.revokeTripAccessGrant(command, staffAuthorization)).toEqual(revoked);
    expect(await readTripAccessCounts()).toEqual(afterRevoke);
  });

  it("expires stale active grants before issuing a new grant", async () => {
    const repository = createTripAccessRepository();
    expect(repository).not.toBeNull();
    if (repository === null) return;

    const expiredGrantId = await seedExpiredActiveGrant();
    const currentEpochSessionId = "stage7-portal-session-after-revoke";
    const currentEpochSessionToken = randomUUID();
    await withOwnerLogin(priorDatabaseName, (client) =>
      client.query(
        `INSERT INTO "portal_access"."portal_session"
           ("id", "expiresAt", "token", "updatedAt", "userId")
         VALUES ($1, clock_timestamp() + interval '1 hour', $2, clock_timestamp(), $3)`,
        [currentEpochSessionId, currentEpochSessionToken, priorPortalPrincipalId],
      ),
    );
    await withPortalHttp(async (baseUrl) => {
      const expiredGrant = await portalTripRequest(
        baseUrl,
        primaryTripId,
        await signedSessionCookie(portalRealm, currentEpochSessionToken),
      );
      expect(expiredGrant.status).toBe(404);
      expect(expiredGrant.text).toBe("");
      expect(expiredGrant.headers["cache-control"]).toBe("no-store, private");
    });
    const newGrant = await repository.issueTripAccessGrant(
      issueCommand("stage7-issue-after-expiry"),
      staffAuthorization,
    );
    expect(newGrant).not.toBeNull();
    if (newGrant === null) return;
    expect(await readGrantState(expiredGrantId)).toEqual({
      grantState: "EXPIRED",
      hasExpiredAt: true,
      hasRevokedAt: false,
    });
    expect(await readTripAccessCounts()).toEqual({
      grantCount: "3",
      activeGrantCount: "1",
      eventCount: "4",
      outboxCount: "4",
      idempotencyCount: "3",
      principalEpoch: "2",
      sessionEpoch: "1",
    });
  });

  it("rejects commands after the Staff membership is revoked", async () => {
    const repository = createTripAccessRepository();
    expect(repository).not.toBeNull();
    if (repository === null) return;
    const before = await readTripAccessCounts();

    await withOwnerLogin(priorDatabaseName, (client) =>
      client.query(
        `UPDATE "staff_access"."staff_membership"
            SET "state" = 'REVOKED', "revokedAt" = clock_timestamp()
          WHERE "id" = $1::uuid`,
        [staffMembershipId],
      ),
    );
    await expect(
      repository.issueTripAccessGrant(issueCommand("stage7-revoked-staff"), staffAuthorization),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
    expect(await readTripAccessCounts()).toEqual(before);
  });

  it("withdraws the active snapshot, cancels the registered Trip, and retires only its Portal principal", async () => {
    if (tripAccessPersistence === null) {
      throw new Error("Stage 7 Staff persistence fixture was not initialized");
    }
    await withOwnerLogin(priorDatabaseName, (client) =>
      client.query(
        `UPDATE "staff_access"."staff_membership"
            SET "state" = 'ACTIVE', "revokedAt" = NULL, "updatedAt" = clock_timestamp()
          WHERE "id" = $1::uuid`,
        [staffMembershipId],
      ),
    );

    const fixtureRunId = databaseModule.createUuidV7();
    const fixturePrincipalId = `stage7-cleanup-${randomUUID()}`;
    const fixtureSessionId = `stage7-cleanup-session-${randomUUID()}`;
    const fixtureSessionToken = randomUUID();
    const fixtureEmail = `stage7-cleanup-${randomUUID()}@example.test`;
    const task3StaffSessionId = `stage7-task3-session-${randomUUID()}`;
    const task3StaffSessionToken = randomUUID();
    const authorizationSnapshot = await createStaffAccessRepository(
      tripAccessPersistence,
    ).getStaffAuthorizationSnapshot(staffPrincipalId, asOpaqueId(priorAgencyId));
    expect(authorizationSnapshot?.membershipState).toBe("ACTIVE");
    if (authorizationSnapshot === null) throw new Error("Stage 7 Staff membership fixture missing");
    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query(
        `INSERT INTO "staff_access"."staff_session" ("id", "expiresAt", "token", "updatedAt", "userId")
         VALUES ($1, clock_timestamp() + interval '1 hour', $2, clock_timestamp(), $3)`,
        [task3StaffSessionId, task3StaffSessionToken, staffPrincipalId],
      );
      await client.query(
        `INSERT INTO "staff_access"."staff_session_context"
           ("sessionId", "staffPrincipalId", "agencyId", "authorizationEpoch", "recentMfaVerifiedAt")
         SELECT $1, membership."staffPrincipalId", membership."agencyId",
                membership."authorizationEpoch", clock_timestamp()
           FROM "staff_access"."staff_membership" AS membership
          WHERE membership."id" = $2::uuid AND membership."state" = 'ACTIVE'`,
        [task3StaffSessionId, staffMembershipId],
      );
    });
    const staffCookie = await signedSessionCookie(staffRealm, task3StaffSessionToken);
    const staffSessionResolver = createAdminStaffSessionResolver(staffRealm, {
      canonicalOrigin: "http://admin.travelos.test",
      expectedHost: "admin.travelos.test",
    });
    const authorizationNowEpochMs = Date.now();
    const freshStaffAuthorization: StaffAuthorizationOperationProof = {
      session: {
        sessionId: task3StaffSessionId,
        staffPrincipalId,
        agencyId: asOpaqueId(priorAgencyId),
        authorizationEpoch: authorizationSnapshot.authorizationEpoch,
        expiresAtEpochMs: authorizationNowEpochMs + 60 * 60 * 1_000,
        recentMfaVerifiedAtEpochMs: authorizationNowEpochMs,
      },
      requiredPermissionIds: ["trip.access.manage"],
      nowEpochMs: authorizationNowEpochMs,
    };
    await expect(staffSessionResolver.resolveStaffSession(staffCookie)).resolves.toMatchObject({
      staffPrincipalId,
      agencyId: priorAgencyId,
      authorizationEpoch: authorizationSnapshot.authorizationEpoch,
    });
    expect(
      authorizationSnapshot?.assignments
        .filter((assignment) => assignment.active)
        .map((assignment) => assignment.permissionId),
    ).toEqual(
      expect.arrayContaining([
        "customer.view",
        "traveller.view_sensitive",
        "trip.view",
        "reservation.view",
        "finance.view_costs",
        "customer.edit",
        "traveller.edit",
        "trip.edit",
        "reservation.edit",
        "finance.manage_costs",
        "trip.access.manage",
        "trip.withdraw_publication",
        "runtime_acceptance.fixture.manage",
      ]),
    );
    const tripOperations = databaseModule.createPostgresStaffTripOperations(
      tripAccessPersistence,
      staffSessionResolver,
    );
    const tripSlice = await tripOperations.createTripSlice(
      staffCookie,
      stage7TripInput("Stage 7 runtime cleanup target"),
    );
    const tripId = String(tripSlice.trip.id);
    const initialTripLockVersion = tripSlice.trip.lockVersion;
    const initialTripWorkspaceRevision = tripSlice.trip.workspaceRevision;
    const publicationId = databaseModule.createUuidV7();

    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query("BEGIN");
      try {
        await insertFixtureRun(client, priorAgencyId, fixtureRunId);
        await linkFixtureTrip(client, priorAgencyId, fixtureRunId, 1, tripId);
        await client.query(
          `INSERT INTO "portal_access"."portal_user" ("id", "name", "email", "emailVerified")
           VALUES ($1, 'Stage 7 Cleanup Principal', $2, true)`,
          [fixturePrincipalId, fixtureEmail],
        );
        await client.query(
          `INSERT INTO "portal_access"."portal_session" ("id", "expiresAt", "token", "updatedAt", "userId")
           VALUES ($1, clock_timestamp() + interval '1 day', $2, clock_timestamp(), $3)`,
          [fixtureSessionId, fixtureSessionToken, fixturePrincipalId],
        );
        await client.query(
          `UPDATE "portal_access"."runtime_acceptance_fixture_run"
              SET "portalPrincipalId" = $3
            WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
          [priorAgencyId, fixtureRunId, fixturePrincipalId],
        );
        await client.query(
          `INSERT INTO "trip_ops"."publication_version"
             ("publicationId", "agencyId", "tripId", "version", "workspaceRevision",
              "schemaVersion", "projectionHash", "publisherStaffPrincipalId", "assuranceVerifiedAt", "publishedAt")
           VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 0, 1, $4, $5, clock_timestamp(), clock_timestamp())`,
          [publicationId, priorAgencyId, tripId, stage7ProjectionHash, staffPrincipalId],
        );
        await client.query(
          `INSERT INTO "trip_ops"."publication_snapshot"
             ("publicationId", "agencyId", "tripId", "canonicalPayload")
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4)`,
          [publicationId, priorAgencyId, tripId, stage7SnapshotPayload],
        );
        await client.query(
          `INSERT INTO "trip_ops"."publication_pointer"
             ("agencyId", "tripId", "activePublicationId", "activeVersion")
           VALUES ($1::uuid, $2::uuid, $3::uuid, 1)`,
          [priorAgencyId, tripId, publicationId],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    });

    const tripAccessRepository = createTripAccessRepository();
    expect(tripAccessRepository).not.toBeNull();
    if (tripAccessRepository === null) return;
    const grant = await tripAccessRepository.issueTripAccessGrant(
      {
        agencyId: asOpaqueId(priorAgencyId),
        portalPrincipalId: fixturePrincipalId,
        tripId: asOpaqueId(tripId),
        capabilities: ["trip.view_current"],
        idempotencyKey: `stage7-cleanup-grant-${fixtureRunId}`,
        expiresAt: null,
        relationshipLabel: "Runtime acceptance",
      },
      freshStaffAuthorization,
    );
    expect(grant).not.toBeNull();
    if (grant === null) return;
    const portalCookie = await signedSessionCookie(portalRealm, fixtureSessionToken);
    await withPortalHttp(async (baseUrl) => {
      const beforeCleanup = await portalTripRequest(baseUrl, tripId, portalCookie);
      expect(beforeCleanup.status).toBe(200);
      expect(beforeCleanup.body.trip.title).toBe("Stage 7 Published Snapshot");
    });

    const publicationOperations = databaseModule.createPostgresStaffTripPublicationOperations(
      tripAccessPersistence,
      staffSessionResolver,
      { validate: (value) => void PortalTripSnapshotV1Schema.parse(value) },
    );
    const withdrawn = await publicationOperations.withdrawActivePublication(staffCookie, tripId, {
      reason: "RUNTIME_ACCEPTANCE_CLEANUP",
      idempotencyKey: `withdraw-${fixtureRunId}`,
    });
    expect(withdrawn).toMatchObject({ status: "WITHDRAWN", publicationId, version: 1 });
    expect(
      await publicationOperations.withdrawActivePublication(staffCookie, tripId, {
        reason: "RUNTIME_ACCEPTANCE_CLEANUP",
        idempotencyKey: `withdraw-${fixtureRunId}`,
      }),
    ).toEqual(withdrawn);

    const tripCancelled = await tripOperations.cancelTrip(staffCookie, {
      tripId,
      expectedLockVersion: initialTripLockVersion.toString(),
      idempotencyKey: `cancel-${fixtureRunId}`,
    });
    expect(tripCancelled.trip.state).toBe("CANCELLED");
    expect(tripCancelled.trip.lockVersion).toBe(initialTripLockVersion + 1n);
    expect(tripCancelled.trip.workspaceRevision).toBe(initialTripWorkspaceRevision + 1n);
    expect(
      await tripOperations.cancelTrip(staffCookie, {
        tripId,
        expectedLockVersion: initialTripLockVersion.toString(),
        idempotencyKey: `cancel-${fixtureRunId}`,
      }),
    ).toEqual(tripCancelled);

    const staleTrip = await tripOperations.createTripSlice(
      staffCookie,
      stage7TripInput("Stage 7 stale cleanup target"),
    );
    await expect(
      tripOperations.cancelTrip(staffCookie, {
        tripId: staleTrip.trip.id,
        expectedLockVersion: "99",
        idempotencyKey: `stale-${fixtureRunId}`,
      }),
    ).rejects.toBeInstanceOf(OptimisticConflictError);
    await expect(
      tripOperations.readTripSlice(staffCookie, staleTrip.trip.id),
    ).resolves.toMatchObject({
      trip: { state: "DRAFT", workspaceRevision: staleTrip.trip.workspaceRevision },
    });

    const completedTrip = await tripOperations.createTripSlice(
      staffCookie,
      stage7TripInput("Stage 7 completed cleanup target"),
    );
    await withOwnerLogin(priorDatabaseName, (client) =>
      client.query(
        `UPDATE "trip_ops"."trip" SET "state" = 'COMPLETED'
          WHERE "agencyId" = $1::uuid AND "id" = $2::uuid`,
        [priorAgencyId, completedTrip.trip.id],
      ),
    );
    await expect(
      tripOperations.cancelTrip(staffCookie, {
        tripId: completedTrip.trip.id,
        expectedLockVersion: completedTrip.trip.lockVersion.toString(),
        idempotencyKey: `completed-${fixtureRunId}`,
      }),
    ).rejects.toBeInstanceOf(UnsupportedTripStateError);

    await withOwnerLogin(priorDatabaseName, async (client) => {
      const retained = await client.query<{
        readonly canonicalPayload: string;
        readonly pointerCount: string;
        readonly publicationCount: string;
      }>(
        `SELECT snapshot."canonicalPayload",
                (SELECT count(*)::text FROM "trip_ops"."publication_pointer"
                  WHERE "agencyId" = $1::uuid AND "tripId" = $2::uuid) AS "pointerCount",
                (SELECT count(*)::text FROM "trip_ops"."publication_version"
                  WHERE "agencyId" = $1::uuid AND "tripId" = $2::uuid) AS "publicationCount"
           FROM "trip_ops"."publication_snapshot" AS snapshot
          WHERE snapshot."publicationId" = $3::uuid`,
        [priorAgencyId, tripId, publicationId],
      );
      expect(retained.rows).toEqual([
        { canonicalPayload: stage7SnapshotPayload, pointerCount: "0", publicationCount: "1" },
      ]);
    });

    const unrelatedPrincipalId = `stage7-unrelated-${randomUUID()}`;
    const unrelatedSessionToken = randomUUID();
    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query(
        `INSERT INTO "portal_access"."portal_user" ("id", "name", "email", "emailVerified")
         VALUES ($1, 'Unrelated Stage 7 Principal', $2, true)`,
        [unrelatedPrincipalId, `stage7-unrelated-${randomUUID()}@example.test`],
      );
      await client.query(
        `INSERT INTO "portal_access"."portal_session" ("id", "expiresAt", "token", "updatedAt", "userId")
         VALUES ($1, clock_timestamp() + interval '1 day', $2, clock_timestamp(), $3)`,
        [`stage7-unrelated-session-${randomUUID()}`, unrelatedSessionToken, unrelatedPrincipalId],
      );
    });

    const retirementRepository = createTripAccessRepository();
    expect(retirementRepository).not.toBeNull();
    if (retirementRepository === null) return;
    const retirementAuthorization: StaffAuthorizationOperationProof = {
      ...freshStaffAuthorization,
      requiredPermissionIds: ["runtime_acceptance.fixture.manage", "trip.access.manage"],
    };
    const retirement = await retirementRepository.retireFixturePortalPrincipal(
      {
        agencyId: asOpaqueId(priorAgencyId),
        fixtureRunId: asOpaqueId(fixtureRunId),
        portalPrincipalId: fixturePrincipalId,
        reason: "RUNTIME_ACCEPTANCE_CLEANUP",
      },
      retirementAuthorization,
    );
    expect(retirement).toMatchObject({
      portalPrincipalId: fixturePrincipalId,
      authorizationEpoch: 2n,
    });
    await expect(
      portalRealm.getServerSession(
        new Request("http://portal.travelos.test/", { headers: { cookie: portalCookie } }),
      ),
    ).resolves.toBeNull();
    await expectSqlState(
      () =>
        withOwnerLogin(priorDatabaseName, (client) =>
          client.query(
            `INSERT INTO "portal_access"."portal_session" ("id", "expiresAt", "token", "updatedAt", "userId")
             VALUES ($1, clock_timestamp() + interval '1 day', $2, clock_timestamp(), $3)`,
            [`stage7-retired-new-session-${randomUUID()}`, randomUUID(), fixturePrincipalId],
          ),
        ),
      "23503",
    );
    await expect(
      portalRealm.getServerSession(
        new Request("http://portal.travelos.test/", {
          headers: {
            cookie: await signedSessionCookie(portalRealm, unrelatedSessionToken),
          },
        }),
      ),
    ).resolves.toMatchObject({ principalId: unrelatedPrincipalId });
    await withPortalHttp(async (baseUrl) => {
      const denied = await portalTripRequest(baseUrl, tripId, portalCookie);
      expect(denied.status).toBe(401);
      expect(denied.text).toBe("");
    });
    await withOwnerLogin(priorDatabaseName, async (client) => {
      const evidence = await client.query<{
        readonly retirementEvents: string;
        readonly retirementOutbox: string;
        readonly fixtureRetirementAudits: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM "portal_access"."portal_principal_retirement_event"
             WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid) AS "retirementEvents",
           (SELECT count(*)::text FROM "integration"."portal_principal_retirement_outbox"
             WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid) AS "retirementOutbox",
           (SELECT count(*)::text FROM "audit"."runtime_acceptance_fixture_event"
             WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid
               AND "eventType" = 'FIXTURE_PORTAL_PRINCIPAL_RETIRED') AS "fixtureRetirementAudits"`,
        [priorAgencyId, fixtureRunId],
      );
      expect(evidence.rows).toEqual([
        { retirementEvents: "1", retirementOutbox: "1", fixtureRetirementAudits: "1" },
      ]);
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANUP_PENDING'
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, fixtureRunId],
      );
      await client.query(
        `UPDATE "portal_access"."runtime_acceptance_fixture_run"
            SET "state" = 'CLEANED'
          WHERE "agencyId" = $1::uuid AND "fixtureRunId" = $2::uuid`,
        [priorAgencyId, fixtureRunId],
      );
    });
  });

  it("cleans registered Trips and an enrolled Portal principal through the real Admin HTTP route", async () => {
    const persistence = tripAccessPersistence!;
    const { cookie, resolver } = await createFixtureTripTestHarness();
    const fixtureRunId = databaseModule.createUuidV7();
    const tripOperations = databaseModule.createPostgresStaffTripOperations(persistence, resolver);
    for (const title of ["HTTP cleanup first Trip", "HTTP cleanup second Trip"]) {
      await tripOperations.createRuntimeAcceptanceFixtureTrip(
        cookie,
        stage7TripInput(title),
        fixtureRunId,
      );
    }
    const portalDatabase = await portalAuthPersistence!.withConnection(
      async (connection) => connection,
    );
    const enrollment = createLocalOperatorPortalEnrollmentService({
      database: portalDatabase,
      canonicalOrigin: "http://portal.travelos.test",
      realmKeyMaterial: stage7RealmKey,
      environment: "DEVELOPMENT",
    });
    await enrollment.enroll({
      email: `stage7-http-cleanup-${randomUUID()}@example.test`,
      name: "Stage 7 HTTP cleanup principal",
      password: randomBytes(32).toString("base64url"),
      fixtureRunId,
    });
    const staffAccessRepository = createStaffAccessRepository(persistence);
    const tripAccessOperations = createStaffTripAccessOperations({
      repository: databaseModule.createPostgresStaffTripAccessRepository(persistence),
      authorizationRepository: staffAccessRepository,
      sessionResolver: resolver,
    });
    const publicationOperations = databaseModule.createPostgresStaffTripPublicationOperations(
      persistence,
      resolver,
      { validate: (value) => void PortalTripSnapshotV1Schema.parse(value) },
    );
    const repository =
      databaseModule.createPostgresRuntimeAcceptanceFixtureCleanupRepository(persistence);
    const cleanup = createRuntimeAcceptanceFixtureOperations({
      repository,
      authorizationRepository: staffAccessRepository,
      sessionResolver: resolver,
      tripOperations,
      tripAccessOperations,
      publicationOperations,
    });
    const application = await createAdminApi({
      expectedHost: "admin.travelos.test",
      auth: {
        realm: staffRealm,
        policy: {
          canonicalOrigin: "http://admin.travelos.test",
          expectedHost: "admin.travelos.test",
        },
        environment: "DEVELOPMENT",
        staffAccessRepository,
        tripOperations: tripOperations,
        tripAccessOperations: tripAccessOperations,
        publicationOperations: publicationOperations,
        runtimeAcceptanceFixtureOperations: {
          createFixtureTrip: tripOperations.createRuntimeAcceptanceFixtureTrip,
          cleanupFixture: cleanup.cleanupFixture,
        },
      },
    });
    try {
      const response = await request(application.getHttpServer())
        .post(`/api/admin/runtime-acceptance-fixtures/${fixtureRunId}/cleanup`)
        .set("Host", "admin.travelos.test")
        .set("Origin", "http://admin.travelos.test")
        .set("Cookie", cookie)
        .send({ idempotencyKey: `http-cleanup-${fixtureRunId}` });
      expect({ status: response.status, body: response.body }).toMatchObject({
        status: 200,
        body: {
          fixtureRunId,
          state: "CLEANED",
          errorCode: null,
          counts: { tripsCancelled: 2, principalsRetired: 1 },
        },
      });
      const replay = await request(application.getHttpServer())
        .post(`/api/admin/runtime-acceptance-fixtures/${fixtureRunId}/cleanup`)
        .set("Host", "admin.travelos.test")
        .set("Origin", "http://admin.travelos.test")
        .set("Cookie", cookie)
        .send({ idempotencyKey: `http-cleanup-replay-${fixtureRunId}` });
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual(response.body);
    } finally {
      await application.close();
    }
  });

  it("denies a same-Agency non-creator both cleanup repository paths without changing the fixture", async () => {
    const persistence = tripAccessPersistence!;
    const { cookie, resolver } = await createFixtureTripTestHarness();
    const otherPrincipalId = `stage7-other-fixture-creator-${randomUUID()}`;
    const fixtureRunId = databaseModule.createUuidV7();
    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query(
        `INSERT INTO staff_access.staff_user (id, name, email, "emailVerified") VALUES ($1, 'Other synthetic fixture creator', $2, true)`,
        [otherPrincipalId, `${otherPrincipalId}@example.test`],
      );
      await client.query(
        `INSERT INTO staff_access.staff_membership (id, "agencyId", "staffPrincipalId", state) VALUES ($1::uuid, $2::uuid, $3, 'ACTIVE')`,
        [randomUUID(), priorAgencyId, otherPrincipalId],
      );
      await client.query(
        `INSERT INTO portal_access.runtime_acceptance_fixture_run ("agencyId", "fixtureRunId", "createdByStaffPrincipalId") VALUES ($1::uuid, $2::uuid, $3)`,
        [priorAgencyId, fixtureRunId, otherPrincipalId],
      );
    });
    const authorization = await authorizeOperation(
      {
        authorizationRepository: createStaffAccessRepository(persistence),
        sessionResolver: resolver,
      },
      cookie,
      null,
      RUNTIME_ACCEPTANCE_FIXTURE_MANAGE_PERMISSION_REQUIREMENTS,
      5 * 60 * 1_000,
    );
    const repository =
      databaseModule.createPostgresRuntimeAcceptanceFixtureCleanupRepository(persistence);
    const command = {
      agencyId: asOpaqueId(priorAgencyId),
      fixtureRunId,
      staffPrincipalId,
      idempotencyKey: "non-creator-cleanup",
    };
    expect(await repository.beginCleanup(command, authorization)).toBeNull();
    expect(await repository.completeCleanup(command, authorization)).toBeNull();
    const persisted = await withOwnerLogin(priorDatabaseName, (client) =>
      client.query<{ state: string; auditCount: string }>(
        `SELECT fixture.state, (SELECT count(*)::text FROM audit.runtime_acceptance_fixture_event AS event WHERE event."agencyId"=fixture."agencyId" AND event."fixtureRunId"=fixture."fixtureRunId") AS "auditCount" FROM portal_access.runtime_acceptance_fixture_run AS fixture WHERE fixture."agencyId"=$1::uuid AND fixture."fixtureRunId"=$2::uuid`,
        [priorAgencyId, fixtureRunId],
      ),
    );
    expect(persisted.rows).toEqual([{ state: "OPEN", auditCount: "1" }]);
  });

  it("exports the PostgreSQL Staff Trip access repository", () => {
    expect("createPostgresStaffTripAccessRepository" in databaseModule).toBe(true);
  });

  it("creates_an_authorized_minimal_trip_workspace_with_an_empty_itinerary", async () => {
    const { cookie, resolver } = await createFixtureTripTestHarness();
    if (tripAccessPersistence === null) {
      throw new Error("Stage 7 Staff persistence fixture was not initialized");
    }
    const operations = databaseModule.createPostgresStaffTripOperations(
      tripAccessPersistence,
      resolver,
    );
    const marker = randomUUID();
    const requestBody = {
      customer: { displayName: `Stage 9 synthetic customer ${marker}` },
      primaryTraveller: { givenName: "Stage9", familyName: `Synthetic-${marker}` },
      trip: {
        title: `Stage 9 synthetic trip ${marker}`,
        startDate: "2026-12-01",
        endDate: "2026-12-05",
      },
    };

    const trip = await operations.createTripWorkspace(cookie, requestBody);

    expect(trip).toMatchObject({
      agencyId: asOpaqueId(priorAgencyId),
      title: requestBody.trip.title,
      startDate: requestBody.trip.startDate,
      endDate: requestBody.trip.endDate,
      state: "DRAFT",
      workspaceRevision: 1n,
      lockVersion: 0n,
    });
    const persisted = await withOwnerLogin(priorDatabaseName, (client) =>
      client.query(
        `SELECT trip."agencyId"::text AS "agencyId", trip."title", trip."state",
                trip."workspaceRevision"::text AS "workspaceRevision",
                trip."lockVersion"::text AS "lockVersion", customer."displayName",
                person."givenName", person."familyName", customer_person."role" AS "customerPersonRole",
                customer_person."isPrimary" AS "customerPersonPrimary", traveller."role" AS "travellerRole",
                (SELECT count(*)::text FROM "trip_ops"."itinerary_item" AS item
                  WHERE item."agencyId" = trip."agencyId" AND item."tripId" = trip."id") AS "itemCount",
                (SELECT count(*)::text FROM "trip_ops"."reservation" AS reservation
                  WHERE reservation."agencyId" = trip."agencyId" AND reservation."tripId" = trip."id") AS "reservationCount",
                (SELECT count(*)::text FROM "finance"."supplier_cost_line" AS cost
                  WHERE cost."agencyId" = trip."agencyId" AND cost."tripId" = trip."id") AS "supplierCostCount"
           FROM "trip_ops"."trip" AS trip
           JOIN "trip_ops"."trip_traveller" AS traveller
             ON traveller."agencyId" = trip."agencyId" AND traveller."tripId" = trip."id"
            AND traveller."role" = 'PRIMARY_TRAVELLER'
           JOIN "crm"."person" AS person
             ON person."agencyId" = traveller."agencyId" AND person."id" = traveller."personId"
           JOIN "crm"."customer_person" AS customer_person
             ON customer_person."agencyId" = person."agencyId" AND customer_person."personId" = person."id"
            AND customer_person."isPrimary" = true
           JOIN "crm"."customer" AS customer
             ON customer."agencyId" = customer_person."agencyId" AND customer."id" = customer_person."customerId"
          WHERE trip."id" = $1::uuid`,
        [trip.id],
      ),
    );
    expect(persisted.rows).toEqual([
      {
        agencyId: priorAgencyId,
        title: requestBody.trip.title,
        state: "DRAFT",
        workspaceRevision: "1",
        lockVersion: "0",
        displayName: requestBody.customer.displayName,
        givenName: "Stage9",
        familyName: requestBody.primaryTraveller.familyName,
        customerPersonRole: "PRIMARY_CONTACT",
        customerPersonPrimary: true,
        travellerRole: "PRIMARY_TRAVELLER",
        itemCount: "0",
        reservationCount: "0",
        supplierCostCount: "0",
      },
    ]);
  });

  it("persists Flight, Accommodation and Trip edits with workspace revision and item lock CAS", async () => {
    const { cookie, resolver } = await createFixtureTripTestHarness();
    if (tripAccessPersistence === null) {
      throw new Error("Stage 7 Staff persistence fixture was not initialized");
    }
    const createWriteOperations = Reflect.get(
      databaseModule,
      "createPostgresStaffTripWorkspaceWriteOperations",
    );
    expect(typeof createWriteOperations).toBe("function");
    if (typeof createWriteOperations !== "function") {
      throw new Error("PostgreSQL Staff workspace write operations are not exported");
    }
    const writeOperations = Reflect.apply(createWriteOperations, undefined, [
      tripAccessPersistence,
      resolver,
    ]) as StaffTripWorkspaceWriteOperations;
    const tripOperations = databaseModule.createPostgresStaffTripOperations(
      tripAccessPersistence,
      resolver,
    );
    const marker = randomUUID();
    const trip = await tripOperations.createTripWorkspace(cookie, {
      customer: { displayName: `Stage 9 CAS customer ${marker}` },
      primaryTraveller: { givenName: "Stage9", familyName: `CAS-${marker}` },
      trip: {
        title: `Stage 9 CAS trip ${marker}`,
        startDate: "2027-10-12",
        endDate: "2027-10-15",
      },
    });
    const drafts = stage7TripInput(`Stage 9 CAS draft ${marker}`);

    const withFlight = await writeOperations.createFlight(cookie, trip.id, {
      expectedWorkspaceRevision: 1n,
      flight: drafts.flight,
    });
    expect(withFlight).toMatchObject({
      trip: { id: trip.id, workspaceRevision: 2n, lockVersion: 0n },
      flights: [
        {
          title: drafts.flight.title,
          flightNumber: drafts.flight.flightNumber,
          state: "DRAFT",
          sortOrder: 1,
          lockVersion: 0n,
        },
      ],
      accommodations: [],
    });
    const withAccommodation = await writeOperations.createAccommodation(cookie, trip.id, {
      expectedWorkspaceRevision: 2n,
      accommodation: drafts.accommodation,
    });
    expect(withAccommodation).toMatchObject({
      trip: { id: trip.id, workspaceRevision: 3n, lockVersion: 0n },
      accommodations: [
        {
          title: drafts.accommodation.title,
          propertyName: drafts.accommodation.propertyName,
          state: "DRAFT",
          sortOrder: 2,
          lockVersion: 0n,
        },
      ],
    });
    const flight = withAccommodation.flights[0];
    const accommodation = withAccommodation.accommodations[0];
    expect(flight).toBeDefined();
    expect(accommodation).toBeDefined();
    if (!flight || !accommodation) throw new Error("Created itinerary items were not returned");

    const editedFlight = {
      ...drafts.flight,
      title: "Updated outbound flight",
      description: "Updated synthetic flight details",
      flightNumber: "EA101",
    };
    const withEditedFlight = await writeOperations.updateFlight(cookie, trip.id, flight.id, {
      expectedWorkspaceRevision: 3n,
      expectedLockVersion: 0n,
      flight: editedFlight,
    });
    expect(withEditedFlight).toMatchObject({
      trip: { workspaceRevision: 4n, lockVersion: 0n },
      flights: [
        { id: flight.id, title: "Updated outbound flight", flightNumber: "EA101", lockVersion: 1n },
      ],
    });

    const editedAccommodation = {
      ...drafts.accommodation,
      title: "Updated hotel stay",
      description: "Updated synthetic accommodation details",
      propertyName: "Updated Example Hotel",
    };
    const withEditedAccommodation = await writeOperations.updateAccommodation(
      cookie,
      trip.id,
      accommodation.id,
      {
        expectedWorkspaceRevision: 4n,
        expectedLockVersion: 0n,
        accommodation: editedAccommodation,
      },
    );
    expect(withEditedAccommodation).toMatchObject({
      trip: { workspaceRevision: 5n, lockVersion: 0n },
      accommodations: [
        {
          id: accommodation.id,
          title: "Updated hotel stay",
          propertyName: "Updated Example Hotel",
          lockVersion: 1n,
        },
      ],
    });

    const withEditedTrip = await writeOperations.updateTrip(cookie, trip.id, {
      expectedWorkspaceRevision: 5n,
      expectedLockVersion: 0n,
      trip: {
        title: "Updated Stage 9 CAS trip",
        startDate: "2027-10-12",
        endDate: "2027-10-16",
      },
    });
    expect(withEditedTrip.trip).toMatchObject({
      title: "Updated Stage 9 CAS trip",
      startDate: "2027-10-12",
      endDate: "2027-10-16",
      workspaceRevision: 6n,
      lockVersion: 1n,
    });

    await expect(
      writeOperations.updateAccommodation(cookie, trip.id, accommodation.id, {
        expectedWorkspaceRevision: 5n,
        expectedLockVersion: 1n,
        accommodation: drafts.accommodation,
      }),
    ).rejects.toBeInstanceOf(OptimisticConflictError);
    await expect(
      writeOperations.updateAccommodation(cookie, trip.id, accommodation.id, {
        expectedWorkspaceRevision: 6n,
        expectedLockVersion: 0n,
        accommodation: drafts.accommodation,
      }),
    ).rejects.toBeInstanceOf(OptimisticConflictError);

    const persisted = await withOwnerLogin(priorDatabaseName, (client) =>
      client.query(
        `SELECT trip."title" AS "tripTitle", trip."workspaceRevision"::text AS "workspaceRevision",
                trip."lockVersion"::text AS "tripLockVersion", flight."sortOrder" AS "flightOrder",
                flight."customerTitle" AS "flightTitle", flight."lockVersion"::text AS "flightLockVersion",
                flight_detail."flightNumber", accommodation."sortOrder" AS "accommodationOrder",
                accommodation."customerTitle" AS "accommodationTitle",
                accommodation."lockVersion"::text AS "accommodationLockVersion",
                accommodation_detail."propertyName"
           FROM "trip_ops"."trip" AS trip
           JOIN "trip_ops"."itinerary_item" AS flight
             ON flight."agencyId" = trip."agencyId" AND flight."tripId" = trip."id"
            AND flight."family" = 'FLIGHT'
           JOIN "trip_ops"."flight_item_detail" AS flight_detail
             ON flight_detail."agencyId" = flight."agencyId" AND flight_detail."tripId" = flight."tripId"
            AND flight_detail."itemId" = flight."id"
           JOIN "trip_ops"."itinerary_item" AS accommodation
             ON accommodation."agencyId" = trip."agencyId" AND accommodation."tripId" = trip."id"
            AND accommodation."family" = 'ACCOMMODATION'
           JOIN "trip_ops"."accommodation_item_detail" AS accommodation_detail
             ON accommodation_detail."agencyId" = accommodation."agencyId"
            AND accommodation_detail."tripId" = accommodation."tripId"
            AND accommodation_detail."itemId" = accommodation."id"
          WHERE trip."id" = $1::uuid`,
        [trip.id],
      ),
    );
    expect(persisted.rows).toEqual([
      {
        tripTitle: "Updated Stage 9 CAS trip",
        workspaceRevision: "6",
        tripLockVersion: "1",
        flightOrder: 1,
        flightTitle: "Updated outbound flight",
        flightLockVersion: "1",
        flightNumber: "EA101",
        accommodationOrder: 2,
        accommodationTitle: "Updated hotel stay",
        accommodationLockVersion: "1",
        propertyName: "Updated Example Hotel",
      },
    ]);
  });

  it("does not update an itinerary item through a different Trip scope", async () => {
    const { cookie, resolver } = await createFixtureTripTestHarness();
    if (tripAccessPersistence === null) {
      throw new Error("Stage 7 Staff persistence fixture was not initialized");
    }
    const createWriteOperations = Reflect.get(
      databaseModule,
      "createPostgresStaffTripWorkspaceWriteOperations",
    );
    expect(typeof createWriteOperations).toBe("function");
    if (typeof createWriteOperations !== "function") {
      throw new Error("PostgreSQL Staff workspace write operations are not exported");
    }
    const writeOperations = Reflect.apply(createWriteOperations, undefined, [
      tripAccessPersistence,
      resolver,
    ]) as StaffTripWorkspaceWriteOperations;
    const tripOperations = databaseModule.createPostgresStaffTripOperations(
      tripAccessPersistence,
      resolver,
    );
    const marker = randomUUID();
    const sourceTrip = await tripOperations.createTripWorkspace(cookie, {
      customer: { displayName: `Stage 9 scope source ${marker}` },
      primaryTraveller: { givenName: "Stage9", familyName: `ScopeSource-${marker}` },
      trip: {
        title: `Stage 9 scope source ${marker}`,
        startDate: "2027-10-12",
        endDate: "2027-10-15",
      },
    });
    const targetTrip = await tripOperations.createTripWorkspace(cookie, {
      customer: { displayName: `Stage 9 scope target ${marker}` },
      primaryTraveller: { givenName: "Stage9", familyName: `ScopeTarget-${marker}` },
      trip: {
        title: `Stage 9 scope target ${marker}`,
        startDate: "2027-10-12",
        endDate: "2027-10-15",
      },
    });
    const drafts = stage7TripInput(`Stage 9 scope draft ${marker}`);
    const sourceWorkspace = await writeOperations.createFlight(cookie, sourceTrip.id, {
      expectedWorkspaceRevision: 1n,
      flight: drafts.flight,
    });
    const flight = sourceWorkspace.flights[0];
    expect(flight).toBeDefined();
    if (!flight) throw new Error("Created source Flight was not returned");

    await expect(
      writeOperations.updateFlight(cookie, targetTrip.id, flight.id, {
        expectedWorkspaceRevision: 1n,
        expectedLockVersion: 0n,
        flight: { ...drafts.flight, title: "Cross-Trip update must be rejected" },
      }),
    ).rejects.toBeInstanceOf(TripNotFoundError);

    const persisted = await withOwnerLogin(priorDatabaseName, (client) =>
      client.query(
        `SELECT trip."id"::text AS "tripId",
                trip."workspaceRevision"::text AS "workspaceRevision",
                item."customerTitle" AS "flightTitle",
                item."lockVersion"::text AS "flightLockVersion"
           FROM "trip_ops"."trip" AS trip
           LEFT JOIN "trip_ops"."itinerary_item" AS item
             ON item."agencyId" = trip."agencyId" AND item."tripId" = trip."id"
            AND item."family" = 'FLIGHT'
          WHERE trip."id" = ANY($1::uuid[])
          ORDER BY trip."id"::text`,
        [[sourceTrip.id, targetTrip.id]],
      ),
    );
    const sourceRow = persisted.rows.find((row) => row["tripId"] === sourceTrip.id);
    const targetRow = persisted.rows.find((row) => row["tripId"] === targetTrip.id);
    expect(sourceRow).toMatchObject({
      workspaceRevision: "2",
      flightTitle: drafts.flight.title,
      flightLockVersion: "0",
    });
    expect(targetRow).toMatchObject({
      workspaceRevision: "1",
      flightTitle: null,
      flightLockVersion: null,
    });
  });

  it("rolls back a Flight itinerary row when detail insertion fails", async () => {
    const { cookie, resolver } = await createFixtureTripTestHarness();
    if (tripAccessPersistence === null) {
      throw new Error("Stage 7 Staff persistence fixture was not initialized");
    }
    const createWriteOperations = Reflect.get(
      databaseModule,
      "createPostgresStaffTripWorkspaceWriteOperations",
    );
    expect(typeof createWriteOperations).toBe("function");
    if (typeof createWriteOperations !== "function") {
      throw new Error("PostgreSQL Staff workspace write operations are not exported");
    }
    const writeOperations = Reflect.apply(createWriteOperations, undefined, [
      tripAccessPersistence,
      resolver,
    ]) as StaffTripWorkspaceWriteOperations;
    const tripOperations = databaseModule.createPostgresStaffTripOperations(
      tripAccessPersistence,
      resolver,
    );
    const marker = randomUUID();
    const trip = await tripOperations.createTripWorkspace(cookie, {
      customer: { displayName: `Stage 9 atomic Flight customer ${marker}` },
      primaryTraveller: { givenName: "Stage9", familyName: `AtomicFlight-${marker}` },
      trip: {
        title: `Stage 9 atomic Flight ${marker}`,
        startDate: "2027-10-12",
        endDate: "2027-10-15",
      },
    });
    const drafts = stage7TripInput(`Stage 9 atomic Flight draft ${marker}`);
    await withOwnerLogin(priorDatabaseName, (client) =>
      client.query(`
        CREATE OR REPLACE FUNCTION "trip_ops"."stage9_test_reject_flight_detail_insert"()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $stage9_failure$
        BEGIN
          IF NEW."flightNumber" = 'EA999' THEN
            RAISE EXCEPTION 'Stage 9 test injected Flight detail failure'
              USING ERRCODE = 'P0001';
          END IF;
          RETURN NEW;
        END
        $stage9_failure$;
        CREATE TRIGGER "stage9_test_reject_flight_detail_insert"
          BEFORE INSERT ON "trip_ops"."flight_item_detail"
          FOR EACH ROW EXECUTE FUNCTION "trip_ops"."stage9_test_reject_flight_detail_insert"();
      `),
    );
    try {
      await expect(
        writeOperations.createFlight(cookie, trip.id, {
          expectedWorkspaceRevision: 1n,
          flight: { ...drafts.flight, flightNumber: "EA999" },
        }),
      ).rejects.toThrow("Stage 9 test injected Flight detail failure");
    } finally {
      await withOwnerLogin(priorDatabaseName, (client) =>
        client.query(`
          DROP TRIGGER IF EXISTS "stage9_test_reject_flight_detail_insert"
            ON "trip_ops"."flight_item_detail";
          DROP FUNCTION IF EXISTS "trip_ops"."stage9_test_reject_flight_detail_insert"();
        `),
      );
    }
    const persisted = await withOwnerLogin(priorDatabaseName, (client) =>
      client.query(
        `SELECT trip."workspaceRevision"::text AS "workspaceRevision",
                (SELECT count(*)::text
                   FROM "trip_ops"."itinerary_item" AS item
                  WHERE item."agencyId" = trip."agencyId" AND item."tripId" = trip."id") AS "itemCount",
                (SELECT count(*)::text
                   FROM "trip_ops"."flight_item_detail" AS detail
                  WHERE detail."agencyId" = trip."agencyId" AND detail."tripId" = trip."id") AS "flightDetailCount"
           FROM "trip_ops"."trip" AS trip
          WHERE trip."id" = $1::uuid`,
        [trip.id],
      ),
    );
    expect(persisted.rows).toEqual([
      { workspaceRevision: "1", itemCount: "0", flightDetailCount: "0" },
    ]);
  });

  it("rolls_back_customer_person_and_trip_when_primary_traveller_creation_fails", async () => {
    const { cookie, resolver } = await createFixtureTripTestHarness();
    if (tripAccessPersistence === null) {
      throw new Error("Stage 7 Staff persistence fixture was not initialized");
    }
    const operations = databaseModule.createPostgresStaffTripOperations(
      tripAccessPersistence,
      resolver,
    );
    const marker = randomUUID();
    const requestBody = {
      customer: { displayName: `Stage 9 rollback customer ${marker}` },
      primaryTraveller: { givenName: "Stage9", familyName: `Rollback-${marker}` },
      trip: {
        title: `Stage 9 atomic rollback ${marker}`,
        startDate: "2026-12-01",
        endDate: "2026-12-05",
      },
    };
    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query(`
        CREATE OR REPLACE FUNCTION "trip_ops"."stage9_test_reject_primary_traveller"()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $stage9_failure$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM "trip_ops"."trip" AS trip
             WHERE trip."id" = NEW."tripId"
               AND trip."title" LIKE 'Stage 9 atomic rollback %'
          ) THEN
            RAISE EXCEPTION 'Stage 9 test injected primary traveller failure'
              USING ERRCODE = 'P0001';
          END IF;
          RETURN NEW;
        END
        $stage9_failure$;
        CREATE TRIGGER "stage9_test_reject_primary_traveller"
          BEFORE INSERT ON "trip_ops"."trip_traveller"
          FOR EACH ROW EXECUTE FUNCTION "trip_ops"."stage9_test_reject_primary_traveller"();
      `);
    });
    try {
      await expect(operations.createTripWorkspace(cookie, requestBody)).rejects.toThrow(
        "Stage 9 test injected primary traveller failure",
      );
    } finally {
      await withOwnerLogin(priorDatabaseName, async (client) => {
        await client.query(`
          DROP TRIGGER IF EXISTS "stage9_test_reject_primary_traveller"
            ON "trip_ops"."trip_traveller";
          DROP FUNCTION IF EXISTS "trip_ops"."stage9_test_reject_primary_traveller"();
        `);
      });
    }
    const persisted = await withOwnerLogin(priorDatabaseName, (client) =>
      client.query(
        `SELECT
           (SELECT count(*)::text FROM "crm"."person" WHERE "familyName" = $1) AS "personCount",
           (SELECT count(*)::text FROM "crm"."customer" WHERE "displayName" = $2) AS "customerCount",
           (SELECT count(*)::text FROM "trip_ops"."trip" WHERE "title" = $3) AS "tripCount"`,
        [
          requestBody.primaryTraveller.familyName,
          requestBody.customer.displayName,
          requestBody.trip.title,
        ],
      ),
    );
    expect(persisted.rows).toEqual([{ personCount: "0", customerCount: "0", tripCount: "0" }]);
  });

  it("workspace_list_and_detail_recheck_trip_view_and_agency_without_customer_or_cost_reads", async () => {
    const { cookie, sessionId, resolver } = await createFixtureTripTestHarness();
    const agencyId = asOpaqueId(priorAgencyId);
    const tripId = databaseModule.createUuidV7();
    const tripTravellerId = databaseModule.createUuidV7();
    const flightId = databaseModule.createUuidV7();
    const accommodationId = databaseModule.createUuidV7();
    const roleName = `stage9_workspace_${randomUUID().replaceAll("-", "")}`;
    if (!/^stage9_workspace_[0-9a-f]{32}$/u.test(roleName)) {
      throw new Error("Stage 9 restricted workspace role name is invalid");
    }
    const quotedRole = `"${roleName}"`;
    let restrictedPersistence: PostgresPersistence<Record<string, never>> | null = null;
    let roleCreated = false;

    const createRestrictedRole = async (): Promise<void> => {
      const client = new Client({
        host,
        port,
        database: priorDatabaseName,
        user: "postgres",
        ssl: false,
      });
      await client.connect();
      try {
        await client.query(
          `CREATE ROLE ${quotedRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS`,
        );
        roleCreated = true;
        await client.query(`GRANT CONNECT ON DATABASE "${priorDatabaseName}" TO ${quotedRole}`);
        await client.query(
          `GRANT USAGE ON SCHEMA "staff_access", "trip_ops", "crm", "finance" TO ${quotedRole}`,
        );
        await client.query(
          `GRANT SELECT ON TABLE
             "staff_access"."staff_session",
             "staff_access"."staff_session_context",
             "staff_access"."staff_membership",
             "staff_access"."role_assignment",
             "staff_access"."role_permission",
             "trip_ops"."trip",
             "trip_ops"."itinerary_item",
             "trip_ops"."flight_item_detail",
             "trip_ops"."accommodation_item_detail"
           TO ${quotedRole}`,
        );
        await client.query(
          `GRANT UPDATE ON TABLE
             "staff_access"."staff_session",
             "staff_access"."staff_session_context",
             "staff_access"."staff_membership"
           TO ${quotedRole}`,
        );
      } finally {
        await client.end();
      }
    };

    try {
      await withOwnerLogin(priorDatabaseName, async (client) => {
        await client.query("BEGIN");
        try {
          await client.query(
            `INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
             VALUES ($1::uuid, $2::uuid, 'Stage 9 restricted workspace Trip', '2026-12-01', '2026-12-02', 'DRAFT')`,
            [tripId, priorAgencyId],
          );
          await client.query(
            `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'PRIMARY_TRAVELLER')`,
            [tripTravellerId, priorAgencyId, tripId, primaryPersonId],
          );
          await client.query(
            `INSERT INTO "trip_ops"."itinerary_item"
               ("id", "agencyId", "tripId", "family", "state", "sortOrder", "customerTitle", "customerDescription")
             VALUES
               ($1::uuid, $2::uuid, $3::uuid, 'FLIGHT', 'CONFIRMED', 1, 'Synthetic flight', 'Synthetic flight details'),
               ($4::uuid, $2::uuid, $3::uuid, 'ACCOMMODATION', 'CONFIRMED', 2, 'Synthetic stay', 'Synthetic accommodation details')`,
            [flightId, priorAgencyId, tripId, accommodationId],
          );
          await client.query(
            `INSERT INTO "trip_ops"."flight_item_detail"
               ("agencyId", "tripId", "itemId", "carrier", "flightNumber", "departureAirport", "arrivalAirport",
                "departureDate", "departureTime", "departureTimezone", "departureInstant",
                "arrivalDate", "arrivalTime", "arrivalTimezone", "arrivalInstant")
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'Synthetic Air', 'SA101', 'LIS', 'OPO',
                     '2026-12-01', '10:00:00', 'Europe/Lisbon', '2026-12-01T10:00:00.000Z',
                     '2026-12-01', '12:00:00', 'Europe/Lisbon', '2026-12-01T12:00:00.000Z')`,
            [priorAgencyId, tripId, flightId],
          );
          await client.query(
            `INSERT INTO "trip_ops"."accommodation_item_detail"
               ("agencyId", "tripId", "itemId", "propertyName",
                "checkInDate", "checkInTime", "checkInTimezone", "checkInInstant",
                "checkOutDate", "checkOutTime", "checkOutTimezone", "checkOutInstant")
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'Synthetic Hotel',
                     '2026-12-01', '15:00:00', 'Europe/Lisbon', '2026-12-01T15:00:00.000Z',
                     '2026-12-02', '10:00:00', 'Europe/Lisbon', '2026-12-02T10:00:00.000Z')`,
            [priorAgencyId, tripId, accommodationId],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
      });
      await createRestrictedRole();
      restrictedPersistence = createPostgresPersistence<Record<string, never>>({
        host,
        port,
        database: priorDatabaseName,
        user: roleName,
        tls: { mode: "DISABLED_LOOPBACK_ONLY" },
        applicationName: "travelos-stage9-workspace-least-privilege-test",
        maxConnections: 2,
      });

      const access = createStaffAccessRepository(restrictedPersistence);
      const snapshot = await access.getStaffAuthorizationSnapshot(staffPrincipalId, priorAgencyId);
      expect(snapshot).not.toBeNull();
      if (snapshot === null) return;
      const nowEpochMs = Date.now();
      const authorization: StaffAuthorizationOperationProof = {
        session: {
          sessionId,
          staffPrincipalId,
          agencyId,
          authorizationEpoch: snapshot.authorizationEpoch,
          expiresAtEpochMs: nowEpochMs + 60 * 60 * 1_000,
          recentMfaVerifiedAtEpochMs: nowEpochMs,
        },
        requiredPermissionIds: ["trip.view"],
        nowEpochMs,
      };
      const repository = createPostgresStaffTripWorkspaceRepository(restrictedPersistence);
      const page = await repository.listTrips(agencyId, 50, null, authorization);
      expect(page.items.some((trip) => trip.id === tripId)).toBe(true);
      expect(page.items.every((trip) => trip.agencyId === agencyId)).toBe(true);
      const workspace = await repository.readTripWorkspace(
        agencyId,
        asOpaqueId(tripId),
        authorization,
      );
      expect(workspace).toMatchObject({
        trip: { id: tripId, agencyId, title: "Stage 9 restricted workspace Trip" },
        flights: [{ id: flightId, flightNumber: "SA101" }],
        accommodations: [{ id: accommodationId, propertyName: "Synthetic Hotel" }],
      });
      expect(
        await repository.readTripWorkspace(agencyId, databaseModule.createUuidV7(), authorization),
      ).toBeNull();
      await expect(
        repository.readTripWorkspace(databaseModule.createUuidV7(), tripId, authorization),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        repository.readTripWorkspace(agencyId, asOpaqueId(tripId), {
          ...authorization,
          requiredPermissionIds: ["trip.access.manage"],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const privilegeClient = new Client({
        host,
        port,
        database: priorDatabaseName,
        user: roleName,
        ssl: false,
      });
      await privilegeClient.connect();
      try {
        const privileges = await privilegeClient.query<{
          readonly customer: boolean;
          readonly person: boolean;
          readonly customerPerson: boolean;
          readonly traveller: boolean;
          readonly reservation: boolean;
          readonly cost: boolean;
        }>(
          `SELECT has_table_privilege(current_user, 'crm.customer', 'SELECT') AS customer,
                  has_table_privilege(current_user, 'crm.person', 'SELECT') AS person,
                  has_table_privilege(current_user, 'crm.customer_person', 'SELECT') AS "customerPerson",
                  has_table_privilege(current_user, 'trip_ops.trip_traveller', 'SELECT') AS traveller,
                  has_table_privilege(current_user, 'trip_ops.reservation', 'SELECT') AS reservation,
                  has_table_privilege(current_user, 'finance.supplier_cost_line', 'SELECT') AS cost`,
        );
        expect(privileges.rows).toEqual([
          {
            customer: false,
            person: false,
            customerPerson: false,
            traveller: false,
            reservation: false,
            cost: false,
          },
        ]);
      } finally {
        await privilegeClient.end();
      }

      const serializedWorkspace =
        JSON.stringify(workspace, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ) ?? "";
      expect(serializedWorkspace).not.toContain("INTERNAL_ONLY");
      expect(serializedWorkspace).not.toContain("supplierCosts");
      const piiBearingTrip = await repository.readTripWorkspace(
        agencyId,
        asOpaqueId(primaryTripId),
        authorization,
      );
      expect(piiBearingTrip).not.toBeNull();
      const serializedPiiBearingTrip =
        JSON.stringify(piiBearingTrip, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ) ?? "";
      expect(serializedPiiBearingTrip).not.toContain("Stage 7 Synthetic Customer");
      expect(serializedPiiBearingTrip).not.toContain('"familyName":"Traveller"');

      const appOperations = createStaffTripWorkspaceOperations({
        repository,
        authorizationRepository: access,
        sessionResolver: resolver,
      });
      expect((await appOperations.readTripWorkspace(cookie, asOpaqueId(tripId)))?.trip.id).toBe(
        tripId,
      );
    } finally {
      await restrictedPersistence?.destroy();
      await withOwnerLogin(priorDatabaseName, async (client) => {
        await client.query("BEGIN");
        try {
          await client.query(
            `DELETE FROM "trip_ops"."itinerary_item" WHERE "agencyId" = $1::uuid AND "tripId" = $2::uuid`,
            [priorAgencyId, tripId],
          );
          await client.query(
            `DELETE FROM "trip_ops"."trip_traveller" WHERE "agencyId" = $1::uuid AND "tripId" = $2::uuid`,
            [priorAgencyId, tripId],
          );
          await client.query(
            `DELETE FROM "trip_ops"."trip" WHERE "agencyId" = $1::uuid AND "id" = $2::uuid`,
            [priorAgencyId, tripId],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
      });
      if (roleCreated) {
        const client = new Client({
          host,
          port,
          database: priorDatabaseName,
          user: "postgres",
          ssl: false,
        });
        await client.connect();
        try {
          await client.query(`DROP OWNED BY ${quotedRole}`);
          await client.query(`DROP ROLE ${quotedRole}`);
        } finally {
          await client.end();
        }
      }
    }
  });

  it("lists only active grant-authorized snapshots through the least-privilege Portal role", async () => {
    const persistence = portalAuthPersistence;
    if (persistence === null) {
      throw new Error("Stage 7 Portal persistence fixture was not initialized");
    }

    const factory = (portalTripReadRepositoryModule as unknown as Record<string, unknown>)[
      "createPostgresPortalAuthorizedTripListReader"
    ];
    expect(
      factory,
      "PostgreSQL authorized Portal trip-list reader factory must be exported",
    ).toBeTypeOf("function");
    if (typeof factory !== "function") return;

    const portalPrincipalId = `stage9-list-principal-${randomUUID()}`;
    const portalSessionId = `stage9-list-session-${randomUUID()}`;
    const portalSessionToken = randomUUID();
    const publishedTripId = databaseModule.createUuidV7();
    const noPublicationTripId = databaseModule.createUuidV7();
    const revokedTripId = databaseModule.createUuidV7();
    const expiredTripId = databaseModule.createUuidV7();
    const ungrantedTripId = databaseModule.createUuidV7();
    const publishedGrantId = databaseModule.createUuidV7();
    const noPublicationGrantId = databaseModule.createUuidV7();
    const revokedGrantId = databaseModule.createUuidV7();
    const expiredGrantId = databaseModule.createUuidV7();
    const publicationId = databaseModule.createUuidV7();

    await withOwnerLogin(priorDatabaseName, async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(
          `INSERT INTO "portal_access"."portal_user" ("id", "name", "email", "emailVerified")
           VALUES ($1, 'Stage 9 Synthetic Portal Principal', $2, true)`,
          [portalPrincipalId, `stage9-list-${randomUUID()}@example.test`],
        );
        await client.query(
          `INSERT INTO "portal_access"."portal_session" ("id", "expiresAt", "token", "updatedAt", "userId")
           VALUES ($1, clock_timestamp() + interval '1 day', $2, clock_timestamp(), $3)`,
          [portalSessionId, portalSessionToken, portalPrincipalId],
        );
        for (const tripId of [
          publishedTripId,
          noPublicationTripId,
          revokedTripId,
          expiredTripId,
          ungrantedTripId,
        ]) {
          await insertFixtureTrip(client, priorAgencyId, tripId);
        }

        const projectionHash = createHash("sha256")
          .update(stage7SnapshotPayload, "utf8")
          .digest("hex");
        await client.query(
          `INSERT INTO "trip_ops"."publication_version"
             ("publicationId", "agencyId", "tripId", "version", "workspaceRevision",
              "schemaVersion", "projectionHash", "publisherStaffPrincipalId", "assuranceVerifiedAt")
           VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 0, 1, $4, $5, statement_timestamp())`,
          [publicationId, priorAgencyId, publishedTripId, projectionHash, staffPrincipalId],
        );
        await client.query(
          `INSERT INTO "trip_ops"."publication_snapshot"
             ("publicationId", "agencyId", "tripId", "canonicalPayload")
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4)`,
          [publicationId, priorAgencyId, publishedTripId, stage7SnapshotPayload],
        );
        await client.query(
          `INSERT INTO "trip_ops"."publication_pointer"
             ("agencyId", "tripId", "activePublicationId", "activeVersion")
           VALUES ($1::uuid, $2::uuid, $3::uuid, 1)`,
          [priorAgencyId, publishedTripId, publicationId],
        );
        await client.query(
          `INSERT INTO "portal_access"."trip_access_grant"
             ("grantId", "agencyId", "portalPrincipalId", "tripId", "capabilities",
              "issuedByStaffPrincipalId", "issuedAt", "expiresAt", "relationshipLabel", "grantState",
              "revokedByStaffPrincipalId", "revokedAt", "expiredAt")
           VALUES
             ($1::uuid, $5::uuid, $6, $7::uuid, ARRAY['trip.view_current']::text[], $8,
              statement_timestamp(), statement_timestamp() + interval '1 day', 'Stage 9 published', 'ACTIVE', NULL, NULL, NULL),
             ($2::uuid, $5::uuid, $6, $9::uuid, ARRAY['trip.view_current']::text[], $8,
              statement_timestamp(), statement_timestamp() + interval '1 day', 'Stage 9 unpublished', 'ACTIVE', NULL, NULL, NULL),
             ($3::uuid, $5::uuid, $6, $10::uuid, ARRAY['trip.view_current']::text[], $8,
              statement_timestamp(), statement_timestamp() + interval '1 day', 'Stage 9 revoked', 'REVOKED', $8, statement_timestamp(), NULL),
             ($4::uuid, $5::uuid, $6, $11::uuid, ARRAY['trip.view_current']::text[], $8,
              statement_timestamp() - interval '2 days', statement_timestamp() - interval '1 day',
              'Stage 9 expired', 'EXPIRED', NULL, NULL, statement_timestamp())`,
          [
            publishedGrantId,
            noPublicationGrantId,
            revokedGrantId,
            expiredGrantId,
            priorAgencyId,
            portalPrincipalId,
            publishedTripId,
            staffPrincipalId,
            noPublicationTripId,
            revokedTripId,
            expiredTripId,
          ],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    });

    const reader = await persistence.withConnection(async (connection) =>
      (factory as (database: unknown) => CurrentAuthorizedPortalTripListReader)(connection),
    );
    const sessionContext = await withOwnerLogin(priorDatabaseName, (client) =>
      client.query<{ readonly authorizationEpoch: string }>(
        `SELECT "authorizationEpoch"::text AS "authorizationEpoch"
           FROM "portal_access"."portal_session_context"
          WHERE "sessionId" = $1 AND "portalPrincipalId" = $2`,
        [portalSessionId, portalPrincipalId],
      ),
    );
    expect(sessionContext.rows).toHaveLength(1);
    const authorizationEpoch = BigInt(sessionContext.rows[0]?.authorizationEpoch ?? "0");

    const expectedItems = [
      {
        tripId: publishedTripId,
        publicationState: "PUBLISHED" as const,
        snapshot: JSON.parse(stage7SnapshotPayload) as unknown,
      },
      { tripId: noPublicationTripId, publicationState: "NO_PUBLICATION" as const },
    ].sort((left, right) => left.tripId.localeCompare(right.tripId));
    const listPath = "/api/portal/trips";
    const cookie = await signedSessionCookie(portalRealm, portalSessionToken);
    const application = await createPortalApi({
      expectedHost: portalHttpPolicy.expectedHost,
      auth: { realm: portalRealm as PortalAuthRealm, policy: portalHttpPolicy },
      tripListReader: reader,
    });
    await application.listen(0, "127.0.0.1");
    const address = application.getHttpServer().address();
    if (address === null || typeof address === "string") {
      await application.close();
      throw new Error("Stage 9 Portal list fixture did not bind a TCP address");
    }
    try {
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const listPage = (query = "") =>
        request(baseUrl).get(`${listPath}${query}`).set({
          Host: portalHttpPolicy.expectedHost,
          Cookie: cookie,
        });
      const firstPage = await listPage("?limit=1");
      expect(firstPage.status).toBe(200);
      expect(firstPage.headers["cache-control"]).toBe("no-store, private");
      expect(firstPage.body).toEqual({
        items: [expectedItems[0]],
        nextCursor: expectedItems[0]?.tripId,
      });

      const secondPage = await listPage(`?limit=1&cursor=${expectedItems[0]?.tripId}`);
      expect(secondPage.status).toBe(200);
      expect(secondPage.body).toEqual({ items: [expectedItems[1]], nextCursor: null });

      const allAuthorized = await listPage("?limit=10");
      expect(allAuthorized.status).toBe(200);
      expect(allAuthorized.body).toEqual({ items: expectedItems, nextCursor: null });
      const serialized = JSON.stringify(allAuthorized.body);
      expect(serialized).not.toContain(revokedTripId);
      expect(serialized).not.toContain(expiredTripId);
      expect(serialized).not.toContain(ungrantedTripId);
      expect(serialized).not.toContain("Stage 9 Synthetic Portal Principal");

      const staleEpochPage = await reader.listCurrentAuthorizedTrips({
        agencyId: priorAgencyId,
        portalPrincipalId,
        portalSessionId,
        authorizationEpoch: authorizationEpoch + 1n,
        limit: 10,
        cursor: null,
      });
      expect(staleEpochPage).toEqual({ items: [], nextCursor: null });
    } finally {
      await application.close();
    }

    const portalPrivileges = await withOwnerLogin(priorDatabaseName, (client) =>
      client.query<{
        readonly workspaceTrip: boolean;
        readonly workspaceItems: boolean;
        readonly workspaceTripTitle: boolean;
        readonly workspaceItemTitle: boolean;
        readonly publicationPointer: boolean;
        readonly publicationVersion: boolean;
        readonly publicationSnapshot: boolean;
      }>(
        `SELECT has_table_privilege('travelos_portal_api', 'trip_ops.trip', 'SELECT') AS "workspaceTrip",
                has_table_privilege('travelos_portal_api', 'trip_ops.itinerary_item', 'SELECT') AS "workspaceItems",
                has_column_privilege('travelos_portal_api', 'trip_ops.trip', 'title', 'SELECT') AS "workspaceTripTitle",
                has_column_privilege('travelos_portal_api', 'trip_ops.itinerary_item', 'customerTitle', 'SELECT') AS "workspaceItemTitle",
                has_column_privilege('travelos_portal_api', 'trip_ops.publication_pointer', 'activePublicationId', 'SELECT') AS "publicationPointer",
                has_column_privilege('travelos_portal_api', 'trip_ops.publication_version', 'schemaVersion', 'SELECT') AS "publicationVersion",
                has_column_privilege('travelos_portal_api', 'trip_ops.publication_snapshot', 'canonicalPayload', 'SELECT') AS "publicationSnapshot"`,
      ),
    );
    expect(portalPrivileges.rows).toEqual([
      {
        workspaceTrip: false,
        workspaceItems: false,
        workspaceTripTitle: false,
        workspaceItemTitle: false,
        publicationPointer: true,
        publicationVersion: true,
        publicationSnapshot: true,
      },
    ]);
  });

  describe("Stage 9 production-browser acceptance", () => {
    const browserIt = process.env["TRAVELOS_STAGE9_BROWSER_ACCEPTANCE"] === "1" ? it : it.skip;

    browserIt(
      "exercises the built Admin and Portal journeys against isolated real APIs",
      async () => {
        const adminPersistence = tripAccessPersistence;
        const portalPersistence = portalAuthPersistence;
        expect(adminPersistence).not.toBeNull();
        expect(portalPersistence).not.toBeNull();
        const stage9ArtifactRoot = process.env["TRAVELOS_STAGE9_ARTIFACT_ROOT"];
        const stage9Candidate = process.env["TRAVELOS_STAGE9_CANDIDATE"];
        if (stage9ArtifactRoot === undefined || stage9Candidate === undefined) {
          throw new Error("Stage 9 browser acceptance requires an extracted candidate artifact");
        }
        expect(path.isAbsolute(stage9ArtifactRoot)).toBe(true);
        const artifactRelease = JSON.parse(
          await readFile(path.join(stage9ArtifactRoot, "release.json"), "utf8"),
        ) as {
          readonly stage?: unknown;
          readonly candidate?: unknown;
          readonly artifactId?: unknown;
          readonly source?: { readonly snapshotSha256?: unknown };
          readonly stage10Actions?: unknown;
        };
        expect(artifactRelease.stage).toBe("PHASE_1_M1_STAGE_9");
        expect(artifactRelease.candidate).toBe(stage9Candidate);
        expect(artifactRelease.artifactId).toBe(
          `travelos-stage9-${stage9Candidate}-${String(artifactRelease.source?.snapshotSha256).slice(0, 8)}`,
        );
        expect(artifactRelease.source?.snapshotSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(artifactRelease.stage10Actions).toBe(0);

        const adminHost = await startBuiltBrowserHost({
          root: resolveStage9BrowserWebRoot({
            surface: "admin",
            repositoryRoot,
            artifactRoot: stage9ArtifactRoot,
          }),
          hostname: "admin.travelos.test",
        });
        let portalHost: Awaited<ReturnType<typeof startBuiltBrowserHost>> | null = null;
        let adminApplication: Awaited<ReturnType<typeof createAdminApi>> | null = null;
        let portalApplication: Awaited<ReturnType<typeof createPortalApi>> | null = null;
        try {
          portalHost = await startBuiltBrowserHost({
            root: resolveStage9BrowserWebRoot({
              surface: "portal",
              repositoryRoot,
              artifactRoot: stage9ArtifactRoot,
            }),
            hostname: "portal.travelos.test",
          });
          const adminDatabase = await adminPersistence!.withConnection(
            async (connection) => connection,
          );
          const portalDatabase = await portalPersistence!.withConnection(
            async (connection) => connection,
          );
          const staffPolicy: AuthSurfacePolicy = {
            canonicalOrigin: adminHost.origin,
            expectedHost: adminHost.expectedHost,
          };
          const portalPolicy: AuthSurfacePolicy = {
            canonicalOrigin: portalHost.origin,
            expectedHost: portalHost.expectedHost,
          };
          const browserStaffRealm = createStaffAuthRealm({
            database: adminDatabase,
            canonicalOrigin: adminHost.origin,
            realmKeyMaterial: stage7RealmKey,
            environment: "DEVELOPMENT",
          });
          const staffEnrollmentRealm = createLocalOperatorStaffEnrollmentRealm({
            database: adminDatabase,
            canonicalOrigin: adminHost.origin,
            realmKeyMaterial: stage7RealmKey,
            environment: "DEVELOPMENT",
          });
          const browserPortalRealm = createPortalAuthRealm({
            database: portalDatabase,
            canonicalOrigin: portalHost.origin,
            realmKeyMaterial: stage7RealmKey,
            environment: "DEVELOPMENT",
          });
          const portalEnrollment = createLocalOperatorPortalEnrollmentService({
            database: portalDatabase,
            canonicalOrigin: portalHost.origin,
            realmKeyMaterial: stage7RealmKey,
            environment: "DEVELOPMENT",
          });

          const staffEmail = `stage9-browser-staff-${randomUUID()}@example.test`;
          const staffPassword = randomBytes(32).toString("base64url");
          const staffSignup = await staffEnrollmentRealm.handle(
            new Request(`${adminHost.origin}/api/auth/staff/sign-up/email`, {
              method: "POST",
              headers: { origin: adminHost.origin, "content-type": "application/json" },
              body: JSON.stringify({
                email: staffEmail,
                name: "Stage 9 Synthetic Staff Reader",
                password: staffPassword,
              }),
            }),
          );
          expect(staffSignup.status).toBe(200);
          const staffAccessRepository = createStaffAccessRepository(adminPersistence!);
          const browserStaffPrincipalId =
            await staffAccessRepository.findStaffPrincipalIdByEmail(staffEmail);
          expect(browserStaffPrincipalId).not.toBeNull();

          const browserMembershipId = randomUUID();
          const browserRoleId = randomUUID();
          await withOwnerLogin(priorDatabaseName, async (client) => {
            const verifiedStaff = await client.query(
              `UPDATE "staff_access"."staff_user"
                  SET "emailVerified" = true,
                      "updatedAt" = CURRENT_TIMESTAMP
                WHERE "id" = $1
                RETURNING "id"`,
              [browserStaffPrincipalId!],
            );
            expect(verifiedStaff.rowCount).toBe(1);
            await client.query(
              `INSERT INTO "staff_access"."staff_membership"
                 ("id", "agencyId", "staffPrincipalId", "state")
               VALUES ($1::uuid, $2::uuid, $3, 'ACTIVE')`,
              [browserMembershipId, priorAgencyId, browserStaffPrincipalId!],
            );
            await client.query(
              `INSERT INTO "staff_access"."role" ("id", "agencyId", "displayName")
               VALUES ($1::uuid, $2::uuid, 'Stage 9 Browser Trip Workflow')`,
              [browserRoleId, priorAgencyId],
            );
            await client.query(
              `INSERT INTO "staff_access"."role_permission"
                 ("roleId", "permissionId", "scopeKind", "accessLevel")
               VALUES ($1::uuid, 'agency.view', 'AGENCY', 'ALL'),
                      ($1::uuid, 'trip.view', 'AGENCY', 'ALL'),
                      ($1::uuid, 'trip.edit', 'AGENCY', 'ALL'),
                      ($1::uuid, 'trip.preview', 'AGENCY', 'ALL'),
                      ($1::uuid, 'trip.publish', 'AGENCY', 'ALL'),
                      ($1::uuid, 'customer.edit', 'AGENCY', 'ALL'),
                      ($1::uuid, 'traveller.edit', 'AGENCY', 'ALL')`,
              [browserRoleId],
            );
            await client.query(
              `INSERT INTO "staff_access"."role_assignment"
                 ("id", "agencyId", "membershipId", "roleId", "scopeKind", "organizationUnitId", "active")
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'AGENCY', NULL, true)`,
              [randomUUID(), priorAgencyId, browserMembershipId, browserRoleId],
            );
          });

          const callStaffRealm = (endpoint: string, body: object, cookie?: string) =>
            browserStaffRealm.handle(
              new Request(`${adminHost.origin}/api/auth/staff/${endpoint}`, {
                method: "POST",
                headers: {
                  origin: adminHost.origin,
                  "content-type": "application/json",
                  ...(cookie === undefined ? {} : { cookie }),
                },
                body: JSON.stringify(body),
              }),
            );
          const setupSignIn = await callStaffRealm("sign-in/email", {
            email: staffEmail,
            password: staffPassword,
          });
          expect(setupSignIn.status).toBe(200);
          const setupCookie = setupSignIn.headers
            .getSetCookie()
            .map((row) => row.split(";", 1)[0])
            .join("; ");
          const enabledTotp = await callStaffRealm(
            "two-factor/enable",
            { password: staffPassword },
            setupCookie,
          );
          expect(enabledTotp.status).toBe(200);
          const totpUri = ((await enabledTotp.json()) as { readonly totpURI: string }).totpURI;
          const totpSeed = new URL(totpUri).searchParams.get("secret");
          expect(totpSeed).toMatch(/^[A-Z2-7]{16,128}$/u);
          const makeTotpCode = await createRuntimeTotpGenerator(
            path.join(repositoryRoot, "apps/portal-api"),
          );
          const totpVerified = await callStaffRealm(
            "two-factor/verify-totp",
            { code: await makeTotpCode(totpSeed!) },
            setupCookie,
          );
          expect(totpVerified.status).toBe(200);
          expect((await callStaffRealm("sign-out", {}, setupCookie)).status).toBe(200);

          const authorizedPortal = {
            email: `stage9-browser-authorized-${randomUUID()}@example.test`,
            password: randomBytes(32).toString("base64url"),
          };
          const ungrantedPortal = {
            email: `stage9-browser-ungranted-${randomUUID()}@example.test`,
            password: randomBytes(32).toString("base64url"),
          };
          const authorizedEnrollment = await portalEnrollment.enroll({
            ...authorizedPortal,
            name: "Stage 9 Synthetic Authorized Portal",
          });
          await portalEnrollment.enroll({
            ...ungrantedPortal,
            name: "Stage 9 Synthetic Ungranted Portal",
          });

          const browserTripId = databaseModule.createUuidV7();
          const browserPersonId = databaseModule.createUuidV7();
          const browserTravellerId = databaseModule.createUuidV7();
          const browserCustomerId = databaseModule.createUuidV7();
          const browserUnpublishedTripTitle = "Stage 9 Browser Ungranted Fixture";
          const browserWorkspaceTripTitle = "Stage 9 Browser Snapshot Lifecycle";
          const browserRevisedWorkspaceTripTitle = "Stage 9 Browser Snapshot Lifecycle v2";
          const browserPublishedSnapshotTitle = browserWorkspaceTripTitle;
          const browserFlightTitle = "Stage 9 Browser Flight";
          const browserRevisedFlightTitle = "Stage 9 Browser Flight v2";
          const browserInitialAccommodationTitle = "Stage 9 Browser Accommodation v1";
          const browserRevisedAccommodationTitle = "Stage 9 Browser Accommodation v2";
          await withOwnerLogin(priorDatabaseName, async (client) => {
            await client.query("BEGIN");
            try {
              await client.query(
                `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName", "email")
                 VALUES ($1::uuid, $2::uuid, 'Stage 9 Browser', 'Traveller', NULL)`,
                [browserPersonId, priorAgencyId],
              );
              await client.query(
                `INSERT INTO "trip_ops"."trip"
                   ("id", "agencyId", "title", "startDate", "endDate", "state")
                 VALUES ($1::uuid, $2::uuid, $3,
                         '2026-11-15', '2026-11-16', 'DRAFT')`,
                [browserTripId, priorAgencyId, browserUnpublishedTripTitle],
              );
              await client.query(
                `INSERT INTO "trip_ops"."trip_traveller"
                   ("id", "agencyId", "tripId", "personId", "role")
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'PRIMARY_TRAVELLER')`,
                [browserTravellerId, priorAgencyId, browserTripId, browserPersonId],
              );
              await client.query(
                `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
                 VALUES ($1::uuid, $2::uuid, 'Stage 9 Browser Customer')`,
                [browserCustomerId, priorAgencyId],
              );
              await client.query(
                `INSERT INTO "crm"."customer_person"
                   ("agencyId", "customerId", "personId", "role", "isPrimary")
                 VALUES ($1::uuid, $2::uuid, $3::uuid, 'PRIMARY_CONTACT', true)`,
                [priorAgencyId, browserCustomerId, browserPersonId],
              );
              await client.query("COMMIT");
            } catch (error) {
              await client.query("ROLLBACK").catch(() => undefined);
              throw error;
            }
          });
          const grantCreatedTripAccess = async (createdTripId: string): Promise<void> => {
            await withOwnerLogin(priorDatabaseName, async (client) => {
              const grant = await client.query(
                `INSERT INTO "portal_access"."trip_access_grant"
                 ("grantId", "agencyId", "portalPrincipalId", "tripId", "capabilities",
                  "issuedByStaffPrincipalId", "issuedAt", "expiresAt")
              VALUES ($1::uuid, $2::uuid, $3, $4::uuid, ARRAY['trip.view_current']::text[],
                      $5, statement_timestamp(), NULL)`,
                [
                  randomUUID(),
                  priorAgencyId,
                  authorizedEnrollment.portalPrincipalId,
                  createdTripId,
                  browserStaffPrincipalId!,
                ],
              );
              expect(grant.rowCount).toBe(1);
            });
          };

          const sessionResolver = createAdminStaffSessionResolver(browserStaffRealm, staffPolicy);
          const workspaceOperations = createStaffTripWorkspaceOperations({
            repository: createPostgresStaffTripWorkspaceRepository(adminPersistence!),
            authorizationRepository: staffAccessRepository,
            sessionResolver,
          });
          const workspaceWriteOperations =
            databaseModule.createPostgresStaffTripWorkspaceWriteOperations(
              adminPersistence!,
              sessionResolver,
            );
          const publicationOperations = databaseModule.createPostgresStaffTripPublicationOperations(
            adminPersistence!,
            sessionResolver,
            {
              validate: (value) =>
                void AdminTripPublicationPreviewV1Schema.shape.projection.parse(value),
            },
          );
          adminApplication = await createAdminApi({
            expectedHost: adminHost.expectedHost,
            auth: {
              realm: browserStaffRealm,
              policy: staffPolicy,
              environment: "DEVELOPMENT",
              staffAccessRepository,
              tripOperations: databaseModule.createPostgresStaffTripOperations(
                adminPersistence!,
                sessionResolver,
              ),
              workspaceOperations: workspaceOperations,
              workspaceWriteOperations: workspaceWriteOperations,
              publicationOperations: publicationOperations,
            },
          });
          await adminApplication.listen(0, "127.0.0.1");
          const adminAddress = adminApplication.getHttpServer().address();
          if (adminAddress === null || typeof adminAddress === "string") {
            throw new Error("Stage 9 Admin browser API did not bind a TCP address");
          }
          adminHost.setApiUpstreamPort(adminAddress.port);

          const portalReaders = await portalPersistence!.withConnection(async (connection) => ({
            list: portalTripReadRepositoryModule.createPostgresPortalAuthorizedTripListReader(
              connection,
            ),
            snapshot: createPostgresPortalTripSnapshotReader(connection),
          }));
          portalApplication = await createPortalApi({
            expectedHost: portalHost.expectedHost,
            auth: { realm: browserPortalRealm, policy: portalPolicy },
            tripListReader: portalReaders.list,
            tripSnapshotReader: portalReaders.snapshot,
          });
          await portalApplication.listen(0, "127.0.0.1");
          const portalAddress = portalApplication.getHttpServer().address();
          if (portalAddress === null || typeof portalAddress === "string") {
            throw new Error("Stage 9 Portal browser API did not bind a TCP address");
          }
          portalHost.setApiUpstreamPort(portalAddress.port);

          const browserEvidenceDirectory =
            process.env["TRAVELOS_STAGE7_EVIDENCE_DIR"] ??
            path.join(repositoryRoot, ".hermes/state", `stage9-browser-${process.pid}`);
          const browserResult = await runStage9BrowserJourney({
            adminOrigin: adminHost.origin,
            portalOrigin: portalHost.origin,
            staffCookieName: browserStaffRealm.cookieName,
            portalCookieName: browserPortalRealm.cookieName,
            tripId: browserTripId,
            workspaceTripTitle: browserWorkspaceTripTitle,
            revisedWorkspaceTripTitle: browserRevisedWorkspaceTripTitle,
            publishedSnapshotTitle: browserPublishedSnapshotTitle,
            flightTitle: browserFlightTitle,
            revisedFlightTitle: browserRevisedFlightTitle,
            initialAccommodationTitle: browserInitialAccommodationTitle,
            revisedAccommodationTitle: browserRevisedAccommodationTitle,
            staff: { email: staffEmail, password: staffPassword, totpSeed: totpSeed! },
            authorizedPortal,
            ungrantedPortal,
            artifactIdentity: {
              candidate: stage9Candidate,
              artifactId: artifactRelease.artifactId as string,
              sourceSnapshotSha256: artifactRelease.source?.snapshotSha256 as string,
            },
            makeTotpCode,
            grantCreatedTripAccess,
            evidenceDirectory: browserEvidenceDirectory,
          });
          expect(browserResult.createdTripId).not.toBe(browserTripId);
          expect(browserResult.createdFlightId).toMatch(/^[0-9a-f-]{36}$/iu);
          expect(browserResult.createdAccommodationId).toMatch(/^[0-9a-f-]{36}$/iu);
          expect(browserResult.workspaceRevisions).toEqual(["1", "2", "3", "4", "5", "6"]);
          expect(browserResult.screenshotCount).toBe(12);
          const browserReport = JSON.parse(
            await readFile(path.join(browserEvidenceDirectory, "browser-acceptance.json"), "utf8"),
          ) as {
            workflow?: {
              tripUpdatedThroughAdminUi?: unknown;
              flightUpdatedThroughAdminUi?: unknown;
            };
          };
          expect(browserReport.workflow).toMatchObject({
            tripUpdatedThroughAdminUi: true,
            flightUpdatedThroughAdminUi: true,
          });
          expect(browserResult.axeScanCount).toBeGreaterThanOrEqual(18);
        } finally {
          await Promise.all([
            portalApplication?.close(),
            adminApplication?.close(),
            portalHost?.close(),
            adminHost.close(),
          ]);
        }
      },
      180_000,
    );
  });
});
