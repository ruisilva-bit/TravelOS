import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeSignature } from "better-auth/crypto";
import { Client } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthSurfacePolicy, PortalAuthRealm } from "@travelos/auth-adapters/portal";
import { createAdminStaffSessionResolver } from "../../apps/admin-api/src/m1-session-resolver.js";
import { createPortalApi } from "../../apps/portal-api/src/app.js";
import * as databaseModule from "../../packages/database/src/index.js";
import { createLocalOperatorPortalEnrollmentService } from "../../packages/auth-adapters/src/realm.js";
import {
  createLocalOperatorStaffEnrollmentRealm,
  createPortalAuthRealm,
  createStaffAuthRealm,
  type AuthRealm,
} from "../../packages/auth-adapters/src/index.js";
import {
  asOpaqueId,
  IdempotencyConflictError,
  M1InputValidationError,
  M1StaffAuthorizationError,
  M1TransactionConflictError,
  type IssueTripAccessGrantCommand,
  type M1StaffTripAccessRepository,
  type RevokeTripAccessGrantCommand,
  type StaffAuthorizationOperationProof,
} from "@travelos/backend-core";
import {
  createPostgresPersistence,
  type PostgresPersistence,
} from "../../packages/database/src/postgres/postgres-persistence.js";
import { createPostgresPortalTripSnapshotReader } from "../../apps/portal-api/src/trip-read-repository.js";
import { PortalTripSnapshotV1Schema } from "../../packages/contracts/src/portal/index.js";

import {
  runMigrationChain,
  type MigrationChain,
  type MigrationRunResult,
  type MigrationTarget,
} from "../../tooling/database/migration-runner.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const host = process.env["PGHOST"] ?? "";
const port = Number.parseInt(process.env["PGPORT"] ?? "", 10);
const postgresBin = process.env["TRAVELOS_STAGE7_PG_BIN"] ?? "";
const workRoot = process.env["TRAVELOS_STAGE7_WORK_ROOT"] ?? "";
const emptyDatabaseName = "travelos_stage7_empty_qualification";
const priorDatabaseName = "travelos_stage7_prior_qualification";
const stage7Head = "0012_stage7_portal_trip_access";
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
let emptyRun: MigrationRunResult;
let emptyStage6Run: MigrationRunResult;
let priorStage6Run: MigrationRunResult;
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
  const client = new Client({
    host,
    port,
    database: databaseName,
    user: "travelos_migrator",
    ssl: false,
  });
  await client.connect();
  try {
    await client.query('SET ROLE "travelos_owner"');
    await client.query(
      `INSERT INTO "organization"."agency" ("id", "bootstrapReference", "slug")
       VALUES ($1::uuid, $2, $3)`,
      [agencyId, `stage7-${suffix}-migration-fixture`, `stage7-${suffix}-migration`],
    );
    await client.query(
      `INSERT INTO "staff_access"."role" ("id", "agencyId", "templateKey", "displayName", "isSystemTemplate")
       VALUES ($1::uuid, $2::uuid, 'agency-owner-v1', 'Owner', true)`,
      [randomUUID(), agencyId],
    );
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    await client.end();
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
         ($1::uuid, 'trip.publish', 'AGENCY', 'ALL')`,
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

const createTripAccessRepository = (): M1StaffTripAccessRepository | null => {
  const factory = (databaseModule as unknown as Record<string, unknown>)[
    "createPostgresM1StaffTripAccessRepository"
  ];
  if (typeof factory !== "function" || tripAccessPersistence === null) return null;
  return (
    factory as (
      persistence: PostgresPersistence<Record<string, never>>,
    ) => M1StaffTripAccessRepository
  )(tripAccessPersistence);
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
  const stage6Migrations = manifest.migrations.filter(
    ({ file }) => file !== "0012_stage7_portal_trip_access.cjs",
  );
  if (stage6Migrations.at(-1)?.file !== "0011_stage6_trip_publication.cjs") {
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
  emptyStage6Run = await runMigrationChain(targetFor(emptyDatabaseName), predecessorChain);
  priorStage6Run = await runMigrationChain(targetFor(priorDatabaseName), predecessorChain);
  await seedRootAgency(emptyDatabaseName, emptyAgencyId, "empty");
  await seedRootAgency(priorDatabaseName, priorAgencyId, "prior");
  await seedPriorPortalState();
  emptyRun = await runMigrationChain(targetFor(emptyDatabaseName), productionChain);
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
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.sequential("Stage 7 PostgreSQL migration qualification", () => {
  it("applies the ordered Stage 7 migration to an empty supported database", () => {
    expect(emptyStage6Run.currentVersion).toBe("0011_stage6_trip_publication");
    expect(emptyStage6Run.verifiedMigrationCount).toBe(11);
    expect(emptyRun.currentVersion).toBe(stage7Head);
    expect(emptyRun.verifiedMigrationCount).toBe(12);
    expect(emptyRun.ledger).toHaveLength(12);
    expect(emptyRun.target.sessionRole).toBe("travelos_migrator");
    expect(emptyRun.target.effectiveRole).toBe("travelos_owner");
  });

  it("upgrades the accepted Stage 6 head through the canonical migrator", () => {
    expect(priorStage6Run.currentVersion).toBe("0011_stage6_trip_publication");
    expect(priorStage7Run.currentVersion).toBe(stage7Head);
    expect(priorStage7Run.appliedMigrations).toEqual([stage7Head]);
    expect(priorStage7Run.target.sessionRole).toBe("travelos_migrator");
    expect(priorStage7Run.target.effectiveRole).toBe("travelos_owner");
  });

  it("verifies the exact checksummed chain and performs deterministic no-op reruns", () => {
    expect(emptyNoOpRun.currentVersion).toBe(stage7Head);
    expect(emptyNoOpRun.appliedMigrations).toEqual([]);
    expect(emptyNoOpRun.verifiedMigrationCount).toBe(12);
    expect(priorNoOpRun.currentVersion).toBe(stage7Head);
    expect(priorNoOpRun.appliedMigrations).toEqual([]);
    expect(priorNoOpRun.verifiedMigrationCount).toBe(12);
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
    ).rejects.toBeInstanceOf(M1InputValidationError);

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
    ).rejects.toBeInstanceOf(M1TransactionConflictError);
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
      const publicationOperations = databaseModule.createPostgresM1StaffTripPublicationOperations(
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
    ).rejects.toBeInstanceOf(M1StaffAuthorizationError);
    expect(await readTripAccessCounts()).toEqual(before);
  });

  it("exports the PostgreSQL Staff Trip access repository", () => {
    expect("createPostgresM1StaffTripAccessRepository" in databaseModule).toBe(true);
  });
});
