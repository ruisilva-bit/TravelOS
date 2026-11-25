import { randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "kysely";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOpaqueId,
  bootstrapRootAgency,
  InputValidationError,
  LeadIdempotencyConflictError,
  LeadNotFoundError,
  LeadNotOpenError,
  OptimisticConflictError,
  OWNER_ROLE_PERMISSION_IDS,
  StaffAuthorizationError,
  TRIP_OPERATIONS_ROLE_PERMISSION_IDS,
  type Lead,
  type LeadDraft,
  type StaffLeadOperations,
  type StaffSessionResolver,
} from "@travelos/backend-core";
import {
  createPostgresPersistence,
  createPostgresStaffLeadOperations,
  createStaffAccessRepository,
  type PostgresPersistence,
} from "../../packages/database/src/index.js";
import { createUuidV7 } from "../../packages/database/src/uuidv7.js";
import {
  runMigrationChain,
  type MigrationChain,
  type MigrationTarget,
} from "../../tooling/database/migration-runner.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const host = process.env["PGHOST"] ?? "";
const port = Number.parseInt(process.env["PGPORT"] ?? "", 10);
const postgresBin = process.env["TRAVELOS_STAGE8_PG_BIN"] ?? "";
const workRoot = process.env["TRAVELOS_STAGE8_WORK_ROOT"] ?? "";
const freshDatabaseName = "travelos_m2_lead_fresh";
const upgradeDatabaseName = "travelos_m2_lead_upgrade";
const freshAgencyId = "019b0000-0000-7000-8000-000000000001";
const upgradeAgencyId = "019b0000-0000-7000-8000-000000000002";
const otherAgencyId = "019b0000-0000-7000-8000-000000000003";
const migrationHead = "0017_m2_sales_lead";
const predecessorHead = "0016_stage9_staff_invitations";
const syntheticDomain = "synthetic.test";
const chain: MigrationChain = {
  directory: path.join(repositoryRoot, "migrations"),
  checksumManifestPath: path.join(repositoryRoot, "migrations/checksums.json"),
};

type DatabaseShape = Record<string, never>;

interface StaffFixture {
  readonly cookie: string;
  readonly principalId: string;
}

let owner: Client | undefined;
let portal: Client | undefined;
let adminPersistence: PostgresPersistence<DatabaseShape> | undefined;
let secondAdminPersistence: PostgresPersistence<DatabaseShape> | undefined;
let operations: StaffLeadOperations | undefined;
let secondOperations: StaffLeadOperations | undefined;
const temporaryDirectories: string[] = [];
let ownerRoleId = "";
let freshRunApplied: readonly string[] = [];
let upgradeRunApplied: readonly string[] = [];
let upgradeOwnerPermissionsBeforeMigration: readonly string[] = [];
let upgradeOwnerPermissionsAfterMigration: readonly string[] = [];
const sessions = new Map<string, unknown>();
let ownerFixture: StaffFixture | undefined;
let otherAgencyCustomerId = "";
let otherAgencyLeadId = "";

const targetFor = (database: string): MigrationTarget => ({
  host,
  port,
  database,
  migratorRole: "travelos_migrator",
  ownerRole: "travelos_owner",
  tls: { mode: "DISABLED_LOOPBACK_ONLY" },
  allowTrustAuthenticationForTests: true,
});

const createDatabase = (databaseName: string): void => {
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
        PGUSER: "postgres",
        PGDATABASE: "postgres",
        PGSSLMODE: "disable",
      },
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Disposable database bootstrap failed: ${(result.stderr ?? "").slice(0, 2_000)}`,
    );
  }
};

const createOwnerClient = async (database: string): Promise<Client> => {
  const client = new Client({ host, port, database, user: "travelos_migrator", ssl: false });
  await client.connect();
  await client.query('SET ROLE "travelos_owner"');
  return client;
};

const createAdminPersistence = (
  database: string,
  applicationName: string,
): PostgresPersistence<DatabaseShape> =>
  createPostgresPersistence<DatabaseShape>({
    host,
    port,
    database,
    user: "travelos_admin_api",
    tls: { mode: "DISABLED_LOOPBACK_ONLY" },
    applicationName,
    maxConnections: 4,
  });

const ownerQuery = async <Row extends Record<string, unknown>>(
  text: string,
  values: readonly unknown[] = [],
): Promise<readonly Row[]> => (await owner!.query<Row>(text, [...values])).rows;

const ownerPermissions = async (client: Client, agencyId: string): Promise<readonly string[]> =>
  (
    await client.query<{ permissionId: string }>(
      `SELECT permission."permissionId"
         FROM staff_access.role_permission AS permission
         JOIN staff_access.role AS role ON role."id" = permission."roleId"
        WHERE role."agencyId" = $1::uuid AND role."templateKey" = 'agency-owner-v1'
        ORDER BY permission."permissionId"`,
      [agencyId],
    )
  ).rows.map((row) => row.permissionId);

const sessionResolver: StaffSessionResolver = {
  async resolveStaffSession(cookie) {
    return sessions.get(cookie) ?? null;
  },
};

/** Creates a synthetic Staff principal with exactly the given permissions, via a dedicated role. */
const createStaff = async (
  label: string,
  permissionIds: readonly string[],
  options: { readonly roleId?: string; readonly agencyId?: string } = {},
): Promise<StaffFixture> => {
  const agencyId = options.agencyId ?? freshAgencyId;
  const principalId = `m2-${label}-${randomUUID()}`;
  const sessionId = `m2-session-${randomUUID()}`;
  const membershipId = createUuidV7();
  let roleId = options.roleId ?? "";
  await owner!.query(
    'INSERT INTO staff_access.staff_user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1,$2,$3,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',
    [principalId, `Synthetic ${label}`, `${principalId}@${syntheticDomain}`],
  );
  if (roleId === "") {
    roleId = createUuidV7();
    await owner!.query(
      'INSERT INTO staff_access.role (id, "agencyId", "displayName") VALUES ($1::uuid,$2::uuid,$3)',
      [roleId, agencyId, `M2 ${label} ${roleId}`],
    );
    for (const permissionId of permissionIds) {
      await owner!.query(
        `INSERT INTO staff_access.role_permission ("roleId", "permissionId", "scopeKind", "accessLevel")
         VALUES ($1::uuid, $2, 'AGENCY', 'ALL')`,
        [roleId, permissionId],
      );
    }
  }
  await owner!.query(
    `INSERT INTO staff_access.staff_membership (id, "agencyId", "staffPrincipalId", state)
     VALUES ($1::uuid,$2::uuid,$3,'ACTIVE')`,
    [membershipId, agencyId, principalId],
  );
  await owner!.query(
    `INSERT INTO staff_access.role_assignment (id, "agencyId", "membershipId", "roleId", "scopeKind", "active")
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'AGENCY',true)`,
    [createUuidV7(), agencyId, membershipId, roleId],
  );
  const expiresAt = new Date(Date.now() + 60 * 60 * 1_000);
  await owner!.query(
    'INSERT INTO staff_access.staff_session (id, "expiresAt", token, "updatedAt", "userId") VALUES ($1,$2,$3,CURRENT_TIMESTAMP,$4)',
    [sessionId, expiresAt, randomBytes(32).toString("base64url"), principalId],
  );
  const epoch = (
    await owner!.query<{ authorizationEpoch: string }>(
      'SELECT "authorizationEpoch"::text AS "authorizationEpoch" FROM staff_access.staff_membership WHERE id = $1::uuid',
      [membershipId],
    )
  ).rows[0];
  if (epoch === undefined) throw new Error("Synthetic membership disappeared");
  await owner!.query(
    `INSERT INTO staff_access.staff_session_context
       ("sessionId", "staffPrincipalId", "agencyId", "authorizationEpoch", "recentMfaVerifiedAt")
     VALUES ($1,$2,$3::uuid,$4,NULL)`,
    [sessionId, principalId, agencyId, epoch.authorizationEpoch],
  );
  const cookie = `session=${sessionId}`;
  sessions.set(cookie, {
    sessionId,
    staffPrincipalId: principalId,
    agencyId,
    authorizationEpoch: BigInt(epoch.authorizationEpoch),
    expiresAtEpochMs: expiresAt.getTime(),
    recentMfaVerifiedAtEpochMs: null,
  });
  return { cookie, principalId };
};

const draft = (overrides: Partial<LeadDraft> = {}): LeadDraft => ({
  source: "PHONE",
  contactGivenName: "Marta",
  contactFamilyName: "Quintela",
  contactEmail: null,
  contactPhone: "+351 910 000 000",
  internalNote: null,
  ...overrides,
});

const ops = (): StaffLeadOperations => operations!;
const ownerStaff = (): StaffFixture => ownerFixture!;

const count = async (text: string, values: readonly unknown[] = []): Promise<number> =>
  Number((await ownerQuery<{ count: string }>(text, values))[0]?.count ?? "-1");

const createLead = (overrides: Partial<LeadDraft> = {}, idempotencyKey: string | null = null) =>
  ops().createLead(ownerStaff().cookie, { lead: draft(overrides), idempotencyKey });

const expectRejection = async (
  work: Promise<unknown>,
  expected: new (...parameters: never[]) => Error,
): Promise<Error> => {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(expected);
  return error as Error;
};

const sqlStateOf = async (work: Promise<unknown>): Promise<string | undefined> => {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  return (error as { code?: string } | null)?.code;
};

beforeAll(async () => {
  if (!host || !Number.isInteger(port) || port < 1 || !postgresBin || !workRoot) {
    throw new Error("M2 Lead integration requires the pinned disposable PostgreSQL harness");
  }
  await mkdir(workRoot, { recursive: true });
  createDatabase(freshDatabaseName);
  createDatabase(upgradeDatabaseName);

  const manifest = JSON.parse(await readFile(chain.checksumManifestPath, "utf8")) as {
    readonly schemaVersion: 1;
    readonly algorithm: "sha256";
    readonly migrations: readonly { readonly file: string; readonly sha256: string }[];
  };
  // Stage 7 (0012) requires an established root Agency, so every database is migrated to the
  // Stage 6 head, bootstrapped, and only then taken forward (the supported install/upgrade order).
  const chainThrough = async (lastFile: string): Promise<MigrationChain> => {
    const migrations = manifest.migrations.filter(({ file }) => file <= lastFile);
    const directory = await mkdtemp(path.join(workRoot, "m2-lead-chain-"));
    temporaryDirectories.push(directory);
    for (const { file } of migrations) {
      await copyFile(path.join(chain.directory, file), path.join(directory, file));
    }
    const checksumManifestPath = path.join(directory, "checksums.json");
    await writeFile(
      checksumManifestPath,
      JSON.stringify({
        schemaVersion: manifest.schemaVersion,
        algorithm: manifest.algorithm,
        migrations,
      }),
    );
    return { directory, checksumManifestPath };
  };
  const stage6Chain = await chainThrough("0011_stage6_trip_publication.cjs");
  const predecessorChain = await chainThrough("0016_stage9_staff_invitations.cjs");

  // Upgrade database: supported prior release (0016) with an established root Agency.
  await runMigrationChain(targetFor(upgradeDatabaseName), stage6Chain);
  const upgradeBootstrap = createAdminPersistence(upgradeDatabaseName, "m2-lead-upgrade-bootstrap");
  try {
    await bootstrapRootAgency(createStaffAccessRepository(upgradeBootstrap), {
      agencyId: upgradeAgencyId,
      bootstrapReference: "m2-lead-upgrade",
      slug: "m2-lead-upgrade",
    });
  } finally {
    await upgradeBootstrap.destroy();
  }
  expect(
    (await runMigrationChain(targetFor(upgradeDatabaseName), predecessorChain)).currentVersion,
  ).toBe(predecessorHead);
  const upgradeOwner = await createOwnerClient(upgradeDatabaseName);
  try {
    // Simulate an Owner role that predates the Sales capabilities.
    await upgradeOwner.query(
      `DELETE FROM staff_access.role_permission
        WHERE "permissionId" IN ('sales.view', 'sales.edit')
          AND "roleId" IN (SELECT id FROM staff_access.role WHERE "templateKey" = 'agency-owner-v1')`,
    );
    upgradeOwnerPermissionsBeforeMigration = await ownerPermissions(upgradeOwner, upgradeAgencyId);
  } finally {
    await upgradeOwner.end();
  }
  upgradeRunApplied = (await runMigrationChain(targetFor(upgradeDatabaseName), chain))
    .appliedMigrations;
  const upgradeOwnerAfter = await createOwnerClient(upgradeDatabaseName);
  try {
    upgradeOwnerPermissionsAfterMigration = await ownerPermissions(
      upgradeOwnerAfter,
      upgradeAgencyId,
    );
  } finally {
    await upgradeOwnerAfter.end();
  }

  // Fresh database: an empty database taken through the whole chain to the current head.
  expect((await runMigrationChain(targetFor(freshDatabaseName), stage6Chain)).currentVersion).toBe(
    "0011_stage6_trip_publication",
  );
  adminPersistence = createAdminPersistence(freshDatabaseName, "m2-lead-admin-test");
  secondAdminPersistence = createAdminPersistence(freshDatabaseName, "m2-lead-admin-second");
  const bootstrap = await bootstrapRootAgency(createStaffAccessRepository(adminPersistence), {
    agencyId: freshAgencyId,
    bootstrapReference: "m2-lead-fresh",
    slug: "m2-lead-fresh",
  });
  ownerRoleId = bootstrap.ownerRoleId;
  const freshRun = await runMigrationChain(targetFor(freshDatabaseName), chain);
  freshRunApplied = freshRun.appliedMigrations;
  expect(freshRun.currentVersion).toBe(migrationHead);
  owner = await createOwnerClient(freshDatabaseName);
  portal = new Client({
    host,
    port,
    database: freshDatabaseName,
    user: "travelos_portal_api",
    ssl: false,
  });
  await portal.connect();
  operations = createPostgresStaffLeadOperations(adminPersistence, sessionResolver);
  secondOperations = createPostgresStaffLeadOperations(secondAdminPersistence, sessionResolver);
  ownerFixture = await createStaff("owner", [], { roleId: ownerRoleId });

  // A second Agency exists only in this disposable database, to prove same-Agency isolation.
  await owner.query('DROP INDEX "organization"."agency_single_root_idx"');
  await owner.query(
    `INSERT INTO organization.agency (id, "bootstrapReference", slug) VALUES ($1::uuid, 'm2-lead-other', 'm2-lead-other')`,
    [otherAgencyId],
  );
  otherAgencyCustomerId = createUuidV7();
  otherAgencyLeadId = createUuidV7();
  await owner.query(
    `INSERT INTO crm.customer (id, "agencyId", "displayName") VALUES ($1::uuid, $2::uuid, 'Other Agency Customer')`,
    [otherAgencyCustomerId, otherAgencyId],
  );
  await owner.query(
    `INSERT INTO sales.lead (id, "agencyId", source, "contactGivenName", "contactFamilyName", state)
     VALUES ($1::uuid, $2::uuid, 'EMAIL', 'Outra', 'Agencia', 'OPEN')`,
    [otherAgencyLeadId, otherAgencyId],
  );
});

afterAll(async () => {
  await Promise.allSettled([
    ...(adminPersistence === undefined ? [] : [adminPersistence.destroy()]),
    ...(secondAdminPersistence === undefined ? [] : [secondAdminPersistence.destroy()]),
    ...(portal === undefined ? [] : [portal.end()]),
    ...(owner === undefined ? [] : [owner.end()]),
  ]);
  for (const directory of temporaryDirectories) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("M2 slice 1 migration 0017", () => {
  it("applies on an empty database and upgrades a 0016 database applying only 0017", async () => {
    expect(freshRunApplied.at(-1)).toBe(migrationHead);
    expect(freshRunApplied).toHaveLength(6);
    expect(upgradeRunApplied).toEqual([migrationHead]);
    const rerun = await runMigrationChain(targetFor(upgradeDatabaseName), chain);
    expect(rerun.appliedMigrations).toEqual([]);
    expect(rerun.currentVersion).toBe(migrationHead);
  });

  it("seeds sales.view and sales.edit into the existing Owner role on upgrade", async () => {
    expect(upgradeOwnerPermissionsBeforeMigration).not.toContain("sales.view");
    expect(upgradeOwnerPermissionsBeforeMigration).not.toContain("sales.edit");
    expect(upgradeOwnerPermissionsAfterMigration).toEqual(
      expect.arrayContaining(["sales.view", "sales.edit"]),
    );
    expect([...upgradeOwnerPermissionsAfterMigration].toSorted()).toEqual(
      [...OWNER_ROLE_PERMISSION_IDS].toSorted(),
    );
  });

  it("gives a freshly bootstrapped Owner the Sales capabilities but not trip-operations-v1", async () => {
    const permissions = await ownerPermissions(owner!, freshAgencyId);
    expect(permissions).toEqual(expect.arrayContaining(["sales.view", "sales.edit"]));
    expect([...permissions].toSorted()).toEqual([...OWNER_ROLE_PERMISSION_IDS].toSorted());
    const tripOperations = await ownerQuery<{ permissionId: string }>(
      `SELECT permission."permissionId"
         FROM staff_access.role_permission AS permission
         JOIN staff_access.role AS role ON role."id" = permission."roleId"
        WHERE role."agencyId" = $1::uuid AND role."templateKey" = 'trip-operations-v1'
        ORDER BY permission."permissionId"`,
      [freshAgencyId],
    );
    expect(tripOperations.map((row) => row.permissionId)).toEqual(
      [...TRIP_OPERATIONS_ROLE_PERMISSION_IDS].toSorted(),
    );
  });
});

describe("M2 slice 1 PostgreSQL privileges", () => {
  const tables = [
    "sales.lead",
    "sales.lead_idempotency",
    "audit.lead_event",
    "activity.lead_entry",
    "integration.lead_outbox",
  ] as const;

  it("grants the Admin runtime SELECT/INSERT/UPDATE on sales.lead and no DELETE or TRUNCATE", async () => {
    const row = (
      await ownerQuery<Record<string, boolean>>(`
        SELECT has_schema_privilege('travelos_admin_api', 'sales', 'USAGE') AS usage,
               has_table_privilege('travelos_admin_api', 'sales.lead', 'SELECT') AS can_select,
               has_table_privilege('travelos_admin_api', 'sales.lead', 'INSERT') AS can_insert,
               has_table_privilege('travelos_admin_api', 'sales.lead', 'UPDATE') AS can_update,
               has_table_privilege('travelos_admin_api', 'sales.lead', 'DELETE') AS can_delete,
               has_table_privilege('travelos_admin_api', 'sales.lead', 'TRUNCATE') AS can_truncate
      `)
    )[0]!;
    expect(row).toEqual({
      usage: true,
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: false,
      can_truncate: false,
    });
  });

  it("makes Lead history tables insert-only for the Admin runtime", async () => {
    for (const table of tables.slice(1)) {
      const row = (
        await ownerQuery<Record<string, boolean>>(`
          SELECT has_table_privilege('travelos_admin_api', '${table}', 'SELECT') AS can_select,
                 has_table_privilege('travelos_admin_api', '${table}', 'INSERT') AS can_insert,
                 has_table_privilege('travelos_admin_api', '${table}', 'UPDATE') AS can_update,
                 has_table_privilege('travelos_admin_api', '${table}', 'DELETE') AS can_delete
        `)
      )[0]!;
      expect(row, table).toEqual({
        can_select: true,
        can_insert: true,
        can_update: false,
        can_delete: false,
      });
    }
  });

  it("denies the Portal and Worker runtimes every Sales Lead object", async () => {
    for (const role of ["travelos_portal_api", "travelos_worker"]) {
      const schema = await ownerQuery<{ usage: boolean }>(
        `SELECT has_schema_privilege($1, 'sales', 'USAGE') AS usage`,
        [role],
      );
      expect(schema[0]?.usage, `${role} sales schema`).toBe(false);
      for (const table of tables) {
        const privileges = (
          await ownerQuery<{ any: boolean }>(
            `SELECT (has_table_privilege($1, $2, 'SELECT') OR has_table_privilege($1, $2, 'INSERT') OR
                     has_table_privilege($1, $2, 'UPDATE') OR has_table_privilege($1, $2, 'DELETE')) AS "any"`,
            [role, table],
          )
        )[0];
        expect(privileges?.any, `${role} ${table}`).toBe(false);
      }
    }
  });

  it("rejects a real Portal connection reading sales.lead and the Lead history", async () => {
    for (const table of tables) {
      expect(await sqlStateOf(portal!.query(`SELECT 1 FROM ${table} LIMIT 1`)), table).toBe(
        "42501",
      );
    }
  });

  it("rejects Admin runtime DELETE on sales.lead", async () => {
    const state = await sqlStateOf(
      adminPersistence!.withConnection(async (database) => {
        await sql`DELETE FROM "sales"."lead"`.execute(database);
      }),
    );
    expect(state).toBe("42501");
  });
});

describe("M2 slice 1 table constraints", () => {
  const insertLead = async (
    columns: string,
    values: readonly unknown[],
    agencyId = freshAgencyId,
  ): Promise<string | undefined> =>
    sqlStateOf(
      owner!.query(
        `INSERT INTO sales.lead (id, "agencyId", "source", "contactGivenName", "contactFamilyName", ${columns})
         VALUES ($1::uuid, $2::uuid, 'PHONE', 'Ana', 'Silva', ${values.map((_, index) => `$${index + 3}`).join(", ")})`,
        [createUuidV7(), agencyId, ...values],
      ),
    );

  it("accepts a minimal OPEN lead and applies defaults", async () => {
    const id = createUuidV7();
    await owner!.query(
      `INSERT INTO sales.lead (id, "agencyId", source, "contactGivenName", "contactFamilyName", state)
       VALUES ($1::uuid, $2::uuid, 'WEBSITE', 'Ana', 'Silva', 'OPEN')`,
      [id, freshAgencyId],
    );
    const row = (
      await ownerQuery<{ lockVersion: string; closedAt: string | null }>(
        `SELECT "lockVersion"::text AS "lockVersion", "closedAt" FROM sales.lead WHERE id = $1::uuid`,
        [id],
      )
    )[0];
    expect(row).toEqual({ lockVersion: "1", closedAt: null });
  });

  it("enforces state <=> qualifiedCustomerId, disqualificationReason and closedAt", async () => {
    const customerId = createUuidV7();
    await owner!.query(
      `INSERT INTO crm.customer (id, "agencyId", "displayName") VALUES ($1::uuid, $2::uuid, 'Constraint Customer')`,
      [customerId, freshAgencyId],
    );
    // QUALIFIED without a customer, OPEN with a customer, DISQUALIFIED without reason, OPEN with reason.
    expect(await insertLead(`"state", "closedAt"`, ["QUALIFIED", new Date()])).toBe("23514");
    expect(await insertLead(`"state", "qualifiedCustomerId"`, ["OPEN", customerId])).toBe("23514");
    expect(await insertLead(`"state", "closedAt"`, ["DISQUALIFIED", new Date()])).toBe("23514");
    expect(await insertLead(`"state", "disqualificationReason"`, ["OPEN", "OTHER"])).toBe("23514");
    // closedAt is required exactly when not OPEN.
    expect(await insertLead(`"state", "closedAt"`, ["OPEN", new Date()])).toBe("23514");
    expect(await insertLead(`"state", "disqualificationReason"`, ["DISQUALIFIED", "OTHER"])).toBe(
      "23514",
    );
    // Consistent shapes are accepted.
    expect(
      await insertLead(`"state", "disqualificationReason", "closedAt"`, [
        "DISQUALIFIED",
        "NO_RESPONSE",
        new Date(),
      ]),
    ).toBeUndefined();
    expect(
      await insertLead(`"state", "qualifiedCustomerId", "closedAt"`, [
        "QUALIFIED",
        customerId,
        new Date(),
      ]),
    ).toBeUndefined();
  });

  it("rejects a qualified customer that belongs to another Agency (composite FK)", async () => {
    expect(
      await insertLead(`"state", "qualifiedCustomerId", "closedAt"`, [
        "QUALIFIED",
        otherAgencyCustomerId,
        new Date(),
      ]),
    ).toBe("23503");
  });

  it("enforces the enum, text, phone, email and lock-version domains", async () => {
    expect(await insertLead(`"state"`, ["PENDING"])).toBe("23514");
    expect(
      await insertLead(`"disqualificationReason", "state", "closedAt"`, [
        "BORED",
        "DISQUALIFIED",
        new Date(),
      ]),
    ).toBe("23514");
    expect(await insertLead(`"state", "contactEmail"`, ["OPEN", "not-an-email"])).toBe("23514");
    expect(await insertLead(`"state", "contactPhone"`, ["OPEN", "call me"])).toBe("23514");
    expect(await insertLead(`"state", "contactPhone"`, ["OPEN", "9".repeat(41)])).toBe("23514");
    expect(await insertLead(`"state", "internalNote"`, ["OPEN", "   "])).toBe("23514");
    expect(await insertLead(`"state", "internalNote"`, ["OPEN", "n".repeat(4_001)])).toBe("23514");
    expect(await insertLead(`"state", "lockVersion"`, ["OPEN", 0])).toBe("23514");
    expect(
      await sqlStateOf(
        owner!.query(
          `INSERT INTO sales.lead (id, "agencyId", source, "contactGivenName", "contactFamilyName", state)
           VALUES ($1::uuid, $2::uuid, 'FAX', 'Ana', 'Silva', 'OPEN')`,
          [createUuidV7(), freshAgencyId],
        ),
      ),
    ).toBe("23514");
    expect(
      await sqlStateOf(
        owner!.query(
          `INSERT INTO sales.lead (id, "agencyId", source, "contactGivenName", "contactFamilyName", state)
           VALUES ($1::uuid, $2::uuid, 'PHONE', '   ', 'Silva', 'OPEN')`,
          [createUuidV7(), freshAgencyId],
        ),
      ),
    ).toBe("23514");
  });

  it("rejects an unknown Agency and enforces the transition trigger", async () => {
    expect(await insertLead(`"state"`, ["OPEN"], randomUUID())).toBe("23503");
    const id = createUuidV7();
    await owner!.query(
      `INSERT INTO sales.lead (id, "agencyId", source, "contactGivenName", "contactFamilyName", state)
       VALUES ($1::uuid, $2::uuid, 'WEBSITE', 'Ana', 'Silva', 'OPEN')`,
      [id, freshAgencyId],
    );
    // Lock version must advance by exactly one; identity is immutable.
    expect(
      await sqlStateOf(
        owner!.query(`UPDATE sales.lead SET "contactGivenName" = 'Bia' WHERE id = $1::uuid`, [id]),
      ),
    ).toBe("55000");
    expect(
      await sqlStateOf(
        owner!.query(`UPDATE sales.lead SET "lockVersion" = 5 WHERE id = $1::uuid`, [id]),
      ),
    ).toBe("55000");
    expect(
      await sqlStateOf(
        owner!.query(
          `UPDATE sales.lead SET "createdAt" = now() - interval '1 day', "lockVersion" = 2 WHERE id = $1::uuid`,
          [id],
        ),
      ),
    ).toBe("55000");
    await owner!.query(
      `UPDATE sales.lead SET "state" = 'DISQUALIFIED', "disqualificationReason" = 'OTHER',
              "closedAt" = clock_timestamp(), "updatedAt" = clock_timestamp(), "lockVersion" = 2
        WHERE id = $1::uuid`,
      [id],
    );
    // A closed Lead is immutable, even for the table owner.
    expect(
      await sqlStateOf(
        owner!.query(
          `UPDATE sales.lead SET "internalNote" = 'late', "lockVersion" = 3 WHERE id = $1::uuid`,
          [id],
        ),
      ),
    ).toBe("55000");
  });
});

describe("M2 slice 1 Lead use cases", () => {
  it("creates, reads and lists an OPEN Lead scoped to the session Agency", async () => {
    const created = await createLead({
      source: "REFERRAL",
      contactEmail: `ana@${syntheticDomain}`,
      internalNote: "Referral from a synthetic partner",
    });
    expect(created).toMatchObject({
      agencyId: freshAgencyId,
      source: "REFERRAL",
      state: "OPEN",
      lockVersion: 1n,
      qualifiedCustomerId: null,
      disqualificationReason: null,
      closedAt: null,
      contactEmail: `ana@${syntheticDomain}`,
      internalNote: "Referral from a synthetic partner",
    });
    expect(await ops().getLead(ownerStaff().cookie, created.id)).toEqual(created);
    const listed = await ops().listLeads(ownerStaff().cookie, {
      limit: 100,
      cursor: null,
      state: null,
    });
    expect(listed.items.map((lead) => lead.id)).toContain(created.id);
    expect(listed.items.map((lead) => lead.id)).not.toContain(otherAgencyLeadId);
  });

  it("returns NOT_FOUND for another Agency's Lead without confirming it exists", async () => {
    await expectRejection(
      ops().getLead(ownerStaff().cookie, asOpaqueId(otherAgencyLeadId)),
      LeadNotFoundError,
    );
    await expectRejection(
      ops().updateLead(ownerStaff().cookie, asOpaqueId(otherAgencyLeadId), {
        expectedLockVersion: 1n,
        lead: draft(),
      }),
      LeadNotFoundError,
    );
    await expectRejection(
      ops().disqualifyLead(ownerStaff().cookie, asOpaqueId(otherAgencyLeadId), {
        expectedLockVersion: 1n,
        reason: "OTHER",
        idempotencyKey: null,
      }),
      LeadNotFoundError,
    );
    await expectRejection(
      ops().getLead(ownerStaff().cookie, asOpaqueId(createUuidV7())),
      LeadNotFoundError,
    );
    const untouched = await ownerQuery<{ state: string; lockVersion: string }>(
      `SELECT state, "lockVersion"::text AS "lockVersion" FROM sales.lead WHERE id = $1::uuid`,
      [otherAgencyLeadId],
    );
    expect(untouched[0]).toEqual({ state: "OPEN", lockVersion: "1" });
  });

  it("paginates by createdAt DESC, id DESC with a stable cursor and a state filter", async () => {
    for (let index = 0; index < 5; index += 1)
      await createLead({ contactGivenName: `Paginar${index}` });
    const expected = (
      await ownerQuery<{ id: string }>(
        `SELECT id::text AS id FROM sales.lead
          WHERE "agencyId" = $1::uuid AND state = 'OPEN'
          ORDER BY "createdAt" DESC, id DESC`,
        [freshAgencyId],
      )
    ).map((row) => row.id);
    expect(expected.length).toBeGreaterThanOrEqual(5);
    const seen: string[] = [];
    let cursor: ReturnType<typeof asOpaqueId> | null = null;
    for (let pages = 0; pages < 100; pages += 1) {
      const page: Awaited<ReturnType<StaffLeadOperations["listLeads"]>> = await ops().listLeads(
        ownerStaff().cookie,
        { limit: 2, cursor, state: "OPEN" },
      );
      expect(page.items.length).toBeLessThanOrEqual(2);
      expect(page.items.every((lead) => lead.state === "OPEN")).toBe(true);
      seen.push(...page.items.map((lead) => lead.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(expected);
    const none = await ops().listLeads(ownerStaff().cookie, {
      limit: 5,
      cursor: null,
      state: "QUALIFIED",
    });
    expect(none.items.every((lead) => lead.state === "QUALIFIED")).toBe(true);
  });

  it("rejects out-of-range list limits and malformed identifiers as validation errors", async () => {
    await expectRejection(
      ops().listLeads(ownerStaff().cookie, { limit: 101, cursor: null, state: null }),
      InputValidationError,
    );
    await expectRejection(
      ops().listLeads(ownerStaff().cookie, { limit: 0, cursor: null, state: null }),
      InputValidationError,
    );
    await expectRejection(
      ops().getLead(ownerStaff().cookie, "not-a-uuid" as never),
      InputValidationError,
    );
  });

  it("updates an OPEN Lead with an optimistic lock and rejects stale versions", async () => {
    const created = await createLead();
    const updated = await ops().updateLead(ownerStaff().cookie, created.id, {
      expectedLockVersion: created.lockVersion,
      lead: draft({ contactGivenName: "Marta Paula", source: "WALK_IN" }),
    });
    expect(updated.lockVersion).toBe(2n);
    expect(updated.contactGivenName).toBe("Marta Paula");
    expect(updated.source).toBe("WALK_IN");
    await expectRejection(
      ops().updateLead(ownerStaff().cookie, created.id, {
        expectedLockVersion: created.lockVersion,
        lead: draft({ contactGivenName: "Stale" }),
      }),
      OptimisticConflictError,
    );
    const stored = await ops().getLead(ownerStaff().cookie, created.id);
    expect(stored.contactGivenName).toBe("Marta Paula");
    expect(stored.lockVersion).toBe(2n);
  });

  it("makes create idempotent per Staff principal and key, and rejects key reuse with another body", async () => {
    const key = `create-${randomUUID()}`;
    const first = await createLead({ contactGivenName: "Idem" }, key);
    const replay = await createLead({ contactGivenName: "Idem" }, key);
    expect(replay.id).toBe(first.id);
    expect(
      await count(
        `SELECT count(*) FROM sales.lead WHERE "contactGivenName" = 'Idem' AND "agencyId" = $1::uuid`,
        [freshAgencyId],
      ),
    ).toBe(1);
    await expectRejection(
      createLead({ contactGivenName: "Different" }, key),
      LeadIdempotencyConflictError,
    );
  });

  it("serializes two concurrent creates with the same idempotency key into one Lead", async () => {
    const key = `race-${randomUUID()}`;
    const input = { lead: draft({ contactGivenName: "Corrida" }), idempotencyKey: key };
    const [left, right] = await Promise.all([
      ops().createLead(ownerStaff().cookie, input),
      secondOperations!.createLead(ownerStaff().cookie, input),
    ]);
    expect(left.id).toBe(right.id);
    expect(
      await count(
        `SELECT count(*) FROM sales.lead WHERE "contactGivenName" = 'Corrida' AND "agencyId" = $1::uuid`,
        [freshAgencyId],
      ),
    ).toBe(1);
  });

  it("disqualifies an OPEN Lead and writes Audit, Activity and outbox exactly once", async () => {
    const lead = await createLead({
      contactEmail: `dq@${syntheticDomain}`,
      internalNote: "private",
    });
    const closed = await ops().disqualifyLead(ownerStaff().cookie, lead.id, {
      expectedLockVersion: lead.lockVersion,
      reason: "NOT_INTERESTED",
      idempotencyKey: null,
    });
    expect(closed).toMatchObject({
      state: "DISQUALIFIED",
      disqualificationReason: "NOT_INTERESTED",
      qualifiedCustomerId: null,
      lockVersion: 2n,
    });
    expect(closed.closedAt).not.toBeNull();
    const audit = await ownerQuery<Record<string, unknown>>(
      `SELECT "action", "actorStaffPrincipalId", "previousLockVersion"::text AS prev,
              "currentLockVersion"::text AS curr, "customerId", "disqualificationReason"
         FROM audit.lead_event WHERE "leadId" = $1::uuid`,
      [lead.id],
    );
    expect(audit).toEqual([
      {
        action: "LEAD_DISQUALIFIED",
        actorStaffPrincipalId: ownerStaff().principalId,
        prev: "1",
        curr: "2",
        customerId: null,
        disqualificationReason: "NOT_INTERESTED",
      },
    ]);
    expect(
      await count(`SELECT count(*) FROM activity.lead_entry WHERE "leadId" = $1::uuid`, [lead.id]),
    ).toBe(1);
    const outbox = await ownerQuery<Record<string, unknown>>(
      `SELECT "messageType", "schemaVersion", "leadLockVersion"::text AS version
         FROM integration.lead_outbox WHERE "leadId" = $1::uuid`,
      [lead.id],
    );
    expect(outbox).toEqual([{ messageType: "LeadDisqualified", schemaVersion: 1, version: "2" }]);
  });

  it("keeps outbox, activity and audit free of contact data and internal notes", async () => {
    const columns = async (table: string): Promise<readonly string[]> =>
      (
        await ownerQuery<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema || '.' || table_name = $1 ORDER BY ordinal_position`,
          [table],
        )
      ).map((row) => row.column_name);
    for (const table of ["integration.lead_outbox", "activity.lead_entry", "audit.lead_event"]) {
      const names = await columns(table);
      expect(
        names.some((name) => /email|phone|note|given|family|display/iu.test(name)),
        table,
      ).toBe(false);
    }
  });

  it("rejects every command on a terminal Lead with LEAD_NOT_OPEN", async () => {
    const lead = await createLead();
    const closed = await ops().disqualifyLead(ownerStaff().cookie, lead.id, {
      expectedLockVersion: lead.lockVersion,
      reason: "DUPLICATE",
      idempotencyKey: null,
    });
    const next = closed.lockVersion;
    await expectRejection(
      ops().updateLead(ownerStaff().cookie, lead.id, { expectedLockVersion: next, lead: draft() }),
      LeadNotOpenError,
    );
    await expectRejection(
      ops().disqualifyLead(ownerStaff().cookie, lead.id, {
        expectedLockVersion: next,
        reason: "OTHER",
        idempotencyKey: null,
      }),
      LeadNotOpenError,
    );
    await expectRejection(
      ops().qualifyLead(ownerStaff().cookie, lead.id, {
        expectedLockVersion: next,
        mode: { kind: "CREATE_CUSTOMER", customerDisplayName: null },
        idempotencyKey: null,
      }),
      LeadNotOpenError,
    );
    expect(
      await count(`SELECT count(*) FROM audit.lead_event WHERE "leadId" = $1::uuid`, [lead.id]),
    ).toBe(1);
  });
});

describe("M2 slice 1 qualification", () => {
  it("creates Person, Customer and primary link from the contact snapshot atomically", async () => {
    const lead = await createLead({
      contactGivenName: "Joana",
      contactFamilyName: "Mendes",
      contactEmail: `joana.mendes@${syntheticDomain}`,
      internalNote: "Prefers morning calls",
    });
    const qualified = await ops().qualifyLead(ownerStaff().cookie, lead.id, {
      expectedLockVersion: lead.lockVersion,
      mode: { kind: "CREATE_CUSTOMER", customerDisplayName: null },
      idempotencyKey: null,
    });
    expect(qualified.state).toBe("QUALIFIED");
    expect(qualified.lockVersion).toBe(2n);
    expect(qualified.qualifiedCustomerId).not.toBeNull();
    const customer = (
      await ownerQuery<{ displayName: string }>(
        `SELECT "displayName" FROM crm.customer WHERE id = $1::uuid AND "agencyId" = $2::uuid`,
        [qualified.qualifiedCustomerId, freshAgencyId],
      )
    )[0];
    expect(customer?.displayName).toBe("Joana Mendes");
    const links = await ownerQuery<{
      role: string;
      isPrimary: boolean;
      givenName: string;
      familyName: string;
      email: string | null;
    }>(
      `SELECT link.role, link."isPrimary", person."givenName", person."familyName", person.email
         FROM crm.customer_person AS link
         JOIN crm.person AS person ON person.id = link."personId" AND person."agencyId" = link."agencyId"
        WHERE link."customerId" = $1::uuid`,
      [qualified.qualifiedCustomerId],
    );
    expect(links).toEqual([
      {
        role: "PRIMARY_CONTACT",
        isPrimary: true,
        givenName: "Joana",
        familyName: "Mendes",
        email: `joana.mendes@${syntheticDomain}`,
      },
    ]);
    const audit = await ownerQuery<Record<string, unknown>>(
      `SELECT "action", "customerId"::text AS "customerId", "disqualificationReason",
              "previousLockVersion"::text AS prev, "currentLockVersion"::text AS curr
         FROM audit.lead_event WHERE "leadId" = $1::uuid`,
      [lead.id],
    );
    expect(audit).toEqual([
      {
        action: "LEAD_QUALIFIED",
        customerId: qualified.qualifiedCustomerId,
        disqualificationReason: null,
        prev: "1",
        curr: "2",
      },
    ]);
    expect(
      await count(
        `SELECT count(*) FROM activity.lead_entry WHERE "leadId" = $1::uuid AND "entryType" = 'LEAD_QUALIFIED'`,
        [lead.id],
      ),
    ).toBe(1);
    expect(
      await ownerQuery<{ messageType: string; version: string }>(
        `SELECT "messageType", "leadLockVersion"::text AS version FROM integration.lead_outbox WHERE "leadId" = $1::uuid`,
        [lead.id],
      ),
    ).toEqual([{ messageType: "LeadQualified", version: "2" }]);
  });

  it("uses a provided Customer display name", async () => {
    const lead = await createLead({ contactGivenName: "Rui", contactFamilyName: "Pires" });
    const qualified = await ops().qualifyLead(ownerStaff().cookie, lead.id, {
      expectedLockVersion: lead.lockVersion,
      mode: { kind: "CREATE_CUSTOMER", customerDisplayName: "Pires Viagens Lda" },
      idempotencyKey: null,
    });
    const rows = await ownerQuery<{ displayName: string }>(
      `SELECT "displayName" FROM crm.customer WHERE id = $1::uuid`,
      [qualified.qualifiedCustomerId],
    );
    expect(rows[0]?.displayName).toBe("Pires Viagens Lda");
  });

  it("never auto-links an existing Person or Customer by email equality", async () => {
    const sharedEmail = `same.person@${syntheticDomain}`;
    const existingPersonId = createUuidV7();
    const existingCustomerId = createUuidV7();
    await owner!.query(
      `INSERT INTO crm.person (id, "agencyId", "givenName", "familyName", email) VALUES ($1::uuid, $2::uuid, 'Existing', 'Person', $3)`,
      [existingPersonId, freshAgencyId, sharedEmail],
    );
    await owner!.query(
      `INSERT INTO crm.customer (id, "agencyId", "displayName") VALUES ($1::uuid, $2::uuid, 'Existing Customer')`,
      [existingCustomerId, freshAgencyId],
    );
    await owner!.query(
      `INSERT INTO crm.customer_person ("agencyId", "customerId", "personId", "role", "isPrimary")
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'PRIMARY_CONTACT', true)`,
      [freshAgencyId, existingCustomerId, existingPersonId],
    );
    const lead = await createLead({
      contactGivenName: "Same",
      contactFamilyName: "Mail",
      contactEmail: sharedEmail,
    });
    const qualified = await ops().qualifyLead(ownerStaff().cookie, lead.id, {
      expectedLockVersion: lead.lockVersion,
      mode: { kind: "CREATE_CUSTOMER", customerDisplayName: null },
      idempotencyKey: null,
    });
    expect(qualified.qualifiedCustomerId).not.toBe(existingCustomerId);
    expect(await count(`SELECT count(*) FROM crm.person WHERE email = $1`, [sharedEmail])).toBe(2);
    expect(
      await count(`SELECT count(*) FROM crm.customer_person WHERE "personId" = $1::uuid`, [
        existingPersonId,
      ]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) FROM crm.customer_person WHERE "customerId" = $1::uuid`, [
        existingCustomerId,
      ]),
    ).toBe(1);
  });

  it("links an explicitly chosen existing Customer without creating or changing a Person", async () => {
    const customerId = createUuidV7();
    await owner!.query(
      `INSERT INTO crm.customer (id, "agencyId", "displayName") VALUES ($1::uuid, $2::uuid, 'Linked Customer')`,
      [customerId, freshAgencyId],
    );
    const personsBefore = await count(`SELECT count(*) FROM crm.person`);
    const customersBefore = await count(`SELECT count(*) FROM crm.customer`);
    const linksBefore = await count(`SELECT count(*) FROM crm.customer_person`);
    const lead = await createLead({ contactEmail: `link@${syntheticDomain}` });
    const qualified = await ops().qualifyLead(ownerStaff().cookie, lead.id, {
      expectedLockVersion: lead.lockVersion,
      mode: { kind: "LINK_CUSTOMER", customerId: asOpaqueId(customerId) },
      idempotencyKey: null,
    });
    expect(qualified.state).toBe("QUALIFIED");
    expect(qualified.qualifiedCustomerId).toBe(customerId);
    expect(await count(`SELECT count(*) FROM crm.person`)).toBe(personsBefore);
    expect(await count(`SELECT count(*) FROM crm.customer`)).toBe(customersBefore);
    expect(await count(`SELECT count(*) FROM crm.customer_person`)).toBe(linksBefore);
  });

  it("returns NOT_FOUND for a Customer of another Agency and leaves the Lead untouched", async () => {
    const lead = await createLead();
    await expectRejection(
      ops().qualifyLead(ownerStaff().cookie, lead.id, {
        expectedLockVersion: lead.lockVersion,
        mode: { kind: "LINK_CUSTOMER", customerId: asOpaqueId(otherAgencyCustomerId) },
        idempotencyKey: null,
      }),
      LeadNotFoundError,
    );
    await expectRejection(
      ops().qualifyLead(ownerStaff().cookie, lead.id, {
        expectedLockVersion: lead.lockVersion,
        mode: { kind: "LINK_CUSTOMER", customerId: asOpaqueId(createUuidV7()) },
        idempotencyKey: null,
      }),
      LeadNotFoundError,
    );
    const stored = await ops().getLead(ownerStaff().cookie, lead.id);
    expect(stored.state).toBe("OPEN");
    expect(stored.lockVersion).toBe(1n);
  });

  it("rejects stale lock versions with the typed conflict and writes nothing", async () => {
    const lead = await createLead();
    const customersBefore = await count(`SELECT count(*) FROM crm.customer`);
    await expectRejection(
      ops().qualifyLead(ownerStaff().cookie, lead.id, {
        expectedLockVersion: 7n,
        mode: { kind: "CREATE_CUSTOMER", customerDisplayName: null },
        idempotencyKey: null,
      }),
      OptimisticConflictError,
    );
    expect(await count(`SELECT count(*) FROM crm.customer`)).toBe(customersBefore);
    expect(
      await count(`SELECT count(*) FROM audit.lead_event WHERE "leadId" = $1::uuid`, [lead.id]),
    ).toBe(0);
  });

  it("replays an idempotent qualification once and rejects the key for another request", async () => {
    const lead = await createLead({ contactGivenName: "Replay", contactFamilyName: "Test" });
    const key = `qualify-${randomUUID()}`;
    const input = {
      expectedLockVersion: lead.lockVersion,
      mode: { kind: "CREATE_CUSTOMER", customerDisplayName: null } as const,
      idempotencyKey: key,
    };
    const first = await ops().qualifyLead(ownerStaff().cookie, lead.id, input);
    const replay = await ops().qualifyLead(ownerStaff().cookie, lead.id, input);
    expect(replay).toEqual(first);
    expect(
      await count(`SELECT count(*) FROM audit.lead_event WHERE "leadId" = $1::uuid`, [lead.id]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) FROM activity.lead_entry WHERE "leadId" = $1::uuid`, [lead.id]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) FROM integration.lead_outbox WHERE "leadId" = $1::uuid`, [
        lead.id,
      ]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) FROM crm.customer WHERE id = $1::uuid`, [
        first.qualifiedCustomerId,
      ]),
    ).toBe(1);
    await expectRejection(
      ops().qualifyLead(ownerStaff().cookie, lead.id, {
        ...input,
        mode: { kind: "CREATE_CUSTOMER", customerDisplayName: "Other Name" },
      }),
      LeadIdempotencyConflictError,
    );
  });

  it("lets exactly one of two concurrent qualifications win and creates one Customer", async () => {
    const lead = await createLead({ contactGivenName: "Duelo", contactFamilyName: "Concorrente" });
    const customersBefore = await count(`SELECT count(*) FROM crm.customer`);
    const attempt = (service: StaffLeadOperations, key: string) =>
      service.qualifyLead(ownerStaff().cookie, lead.id, {
        expectedLockVersion: lead.lockVersion,
        mode: { kind: "CREATE_CUSTOMER", customerDisplayName: null },
        idempotencyKey: key,
      });
    const results = await Promise.allSettled([
      attempt(ops(), `duel-a-${randomUUID()}`),
      attempt(secondOperations!, `duel-b-${randomUUID()}`),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as
      PromiseRejectedResult | undefined;
    expect(
      rejected?.reason instanceof OptimisticConflictError ||
        rejected?.reason instanceof LeadNotOpenError,
    ).toBe(true);
    expect(await count(`SELECT count(*) FROM crm.customer`)).toBe(customersBefore + 1);
    expect(
      await count(`SELECT count(*) FROM audit.lead_event WHERE "leadId" = $1::uuid`, [lead.id]),
    ).toBe(1);
  });

  it("rolls back Person, Customer, link, state and history when a later write fails", async () => {
    const lead = await createLead({ contactGivenName: "Atomica", contactFamilyName: "Falha" });
    const before = {
      persons: await count(`SELECT count(*) FROM crm.person`),
      customers: await count(`SELECT count(*) FROM crm.customer`),
      links: await count(`SELECT count(*) FROM crm.customer_person`),
    };
    await owner!.query(`
      CREATE FUNCTION sales.synthetic_outbox_failure() RETURNS trigger LANGUAGE plpgsql AS $failure$
      BEGIN
        RAISE EXCEPTION 'synthetic outbox failure' USING ERRCODE = 'P0001';
      END
      $failure$;
      CREATE TRIGGER synthetic_outbox_failure_trigger BEFORE INSERT ON integration.lead_outbox
        FOR EACH ROW EXECUTE FUNCTION sales.synthetic_outbox_failure();
    `);
    try {
      expect(
        await sqlStateOf(
          ops().qualifyLead(ownerStaff().cookie, lead.id, {
            expectedLockVersion: lead.lockVersion,
            mode: { kind: "CREATE_CUSTOMER", customerDisplayName: null },
            idempotencyKey: null,
          }),
        ),
      ).toBe("P0001");
    } finally {
      await owner!.query(`
        DROP TRIGGER synthetic_outbox_failure_trigger ON integration.lead_outbox;
        DROP FUNCTION sales.synthetic_outbox_failure();
      `);
    }
    expect(await count(`SELECT count(*) FROM crm.person`)).toBe(before.persons);
    expect(await count(`SELECT count(*) FROM crm.customer`)).toBe(before.customers);
    expect(await count(`SELECT count(*) FROM crm.customer_person`)).toBe(before.links);
    expect(
      await count(`SELECT count(*) FROM audit.lead_event WHERE "leadId" = $1::uuid`, [lead.id]),
    ).toBe(0);
    expect(
      await count(`SELECT count(*) FROM activity.lead_entry WHERE "leadId" = $1::uuid`, [lead.id]),
    ).toBe(0);
    const stored = await ops().getLead(ownerStaff().cookie, lead.id);
    expect(stored.state).toBe("OPEN");
    expect(stored.lockVersion).toBe(1n);
    // The same Lead can still be qualified once the fault is removed.
    const retried = await ops().qualifyLead(ownerStaff().cookie, lead.id, {
      expectedLockVersion: lead.lockVersion,
      mode: { kind: "CREATE_CUSTOMER", customerDisplayName: null },
      idempotencyKey: null,
    });
    expect(retried.state).toBe("QUALIFIED");
  });

  it("keeps Lead history append-only for every database role", async () => {
    const auditId = (
      await ownerQuery<{ id: string }>(`SELECT "auditId"::text AS id FROM audit.lead_event LIMIT 1`)
    )[0]?.id;
    expect(auditId).toBeDefined();
    expect(
      await sqlStateOf(
        owner!.query(`DELETE FROM audit.lead_event WHERE "auditId" = $1::uuid`, [auditId]),
      ),
    ).toBe("55000");
    expect(
      await sqlStateOf(
        owner!.query(
          `UPDATE audit.lead_event SET "actorStaffPrincipalId" = 'x' WHERE "auditId" = $1::uuid`,
          [auditId],
        ),
      ),
    ).toBe("55000");
    expect(await sqlStateOf(owner!.query(`TRUNCATE activity.lead_entry`))).toBe("55000");
    expect(await sqlStateOf(owner!.query(`TRUNCATE integration.lead_outbox`))).toBe("55000");
    expect(await sqlStateOf(owner!.query(`DELETE FROM activity.lead_entry`))).toBe("55000");
    expect(await sqlStateOf(owner!.query(`DELETE FROM integration.lead_outbox`))).toBe("55000");
    expect(await sqlStateOf(owner!.query(`DELETE FROM sales.lead_idempotency`))).toBe("55000");
    // At most one closure event exists per Lead.
    const leadId = (
      await ownerQuery<{ id: string }>(`SELECT "leadId"::text AS id FROM audit.lead_event LIMIT 1`)
    )[0]?.id;
    expect(
      await sqlStateOf(
        owner!.query(
          `INSERT INTO audit.lead_event ("auditId", "agencyId", "leadId", "actorStaffPrincipalId", "action", "previousLockVersion", "currentLockVersion", "disqualificationReason")
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'LEAD_DISQUALIFIED', 2, 3, 'OTHER')`,
          [createUuidV7(), freshAgencyId, leadId, ownerStaff().principalId],
        ),
      ),
    ).toBe("23505");
  });
});

describe("M2 slice 1 authorization", () => {
  it("lets sales.view read but never write", async () => {
    const viewer = await createStaff("viewer", ["sales.view"]);
    const lead = await createLead();
    expect((await ops().getLead(viewer.cookie, lead.id)).id).toBe(lead.id);
    expect(
      (await ops().listLeads(viewer.cookie, { limit: 5, cursor: null, state: null })).items.length,
    ).toBeGreaterThan(0);
    await expectRejection(
      ops().createLead(viewer.cookie, { lead: draft(), idempotencyKey: null }),
      StaffAuthorizationError,
    );
    await expectRejection(
      ops().updateLead(viewer.cookie, lead.id, { expectedLockVersion: 1n, lead: draft() }),
      StaffAuthorizationError,
    );
    await expectRejection(
      ops().disqualifyLead(viewer.cookie, lead.id, {
        expectedLockVersion: 1n,
        reason: "OTHER",
        idempotencyKey: null,
      }),
      StaffAuthorizationError,
    );
  });

  it("lets sales.edit write but not read, and requires customer.edit as well to qualify", async () => {
    const editor = await createStaff("editor", ["sales.edit"]);
    const created = await ops().createLead(editor.cookie, { lead: draft(), idempotencyKey: null });
    await expectRejection(ops().getLead(editor.cookie, created.id), StaffAuthorizationError);
    await expectRejection(
      ops().listLeads(editor.cookie, { limit: 5, cursor: null, state: null }),
      StaffAuthorizationError,
    );
    await expectRejection(
      ops().qualifyLead(editor.cookie, created.id, {
        expectedLockVersion: 1n,
        mode: { kind: "CREATE_CUSTOMER", customerDisplayName: null },
        idempotencyKey: null,
      }),
      StaffAuthorizationError,
    );
    const customerOnly = await createStaff("customer-only", ["customer.edit", "sales.view"]);
    await expectRejection(
      ops().qualifyLead(customerOnly.cookie, created.id, {
        expectedLockVersion: 1n,
        mode: { kind: "CREATE_CUSTOMER", customerDisplayName: null },
        idempotencyKey: null,
      }),
      StaffAuthorizationError,
    );
    const both = await createStaff("both", ["sales.edit", "customer.edit"]);
    const qualified = await ops().qualifyLead(both.cookie, created.id, {
      expectedLockVersion: 1n,
      mode: { kind: "CREATE_CUSTOMER", customerDisplayName: null },
      idempotencyKey: null,
    });
    expect(qualified.state).toBe("QUALIFIED");
  });

  it("denies the trip-operations-v1 permission set every Sales use case", async () => {
    const tripOperations = await createStaff("trip-ops", TRIP_OPERATIONS_ROLE_PERMISSION_IDS);
    await expectRejection(
      ops().listLeads(tripOperations.cookie, { limit: 5, cursor: null, state: null }),
      StaffAuthorizationError,
    );
    await expectRejection(
      ops().createLead(tripOperations.cookie, { lead: draft(), idempotencyKey: null }),
      StaffAuthorizationError,
    );
  });

  it("never reads role names: a role called Owner without permissions is denied", async () => {
    const impostor = await createStaff("Owner", []);
    await expectRejection(
      ops().listLeads(impostor.cookie, { limit: 5, cursor: null, state: null }),
      StaffAuthorizationError,
    );
  });

  it("rejects unauthenticated and unknown sessions", async () => {
    await expectRejection(
      ops().listLeads("session=unknown", { limit: 5, cursor: null, state: null }),
      StaffAuthorizationError,
    );
    await expectRejection(
      ops().listLeads(undefined, { limit: 5, cursor: null, state: null }),
      StaffAuthorizationError,
    );
  });

  it("re-checks authorization inside the command transaction against a forged proof", async () => {
    const viewer = await createStaff("forged-proof", ["sales.view"]);
    const session = sessions.get(viewer.cookie) as { agencyId: string };
    const { createPostgresLeadRepository } = await import("../../packages/database/src/index.js");
    const repository = createPostgresLeadRepository(adminPersistence!);
    const forged = {
      session: sessions.get(viewer.cookie) as never,
      requiredPermissionIds: ["sales.edit"] as const,
      nowEpochMs: Date.now(),
    };
    await expectRejection(
      repository.createLead(asOpaqueId(session.agencyId), draft(), null, forged),
      StaffAuthorizationError,
    );
    // The repository also rejects a proof whose permission set differs from the use case policy.
    await expectRejection(
      repository.createLead(asOpaqueId(session.agencyId), draft(), null, {
        ...forged,
        requiredPermissionIds: ["sales.view"],
      }),
      StaffAuthorizationError,
    );
  });
});

describe("M2 slice 1 input validation", () => {
  it("rejects invalid contact data before any database access", async () => {
    await expectRejection(createLead({ contactEmail: "not-an-email" }), InputValidationError);
    await expectRejection(createLead({ contactPhone: "abc" }), InputValidationError);
    await expectRejection(createLead({ contactGivenName: "   " }), InputValidationError);
    await expectRejection(createLead({ internalNote: "x".repeat(4_001) }), InputValidationError);
    await expectRejection(
      ops().createLead(ownerStaff().cookie, { lead: draft(), idempotencyKey: "bad\u0000key" }),
      InputValidationError,
    );
    await expectRejection(
      ops().disqualifyLead(ownerStaff().cookie, asOpaqueId(createUuidV7()), {
        expectedLockVersion: 1n,
        reason: "BORED" as never,
        idempotencyKey: null,
      }),
      InputValidationError,
    );
  });

  it("returns exactly the documented Lead shape", async () => {
    const lead: Lead = await createLead();
    expect(Object.keys(lead).toSorted()).toEqual(
      [
        "agencyId",
        "closedAt",
        "contactEmail",
        "contactFamilyName",
        "contactGivenName",
        "contactPhone",
        "createdAt",
        "disqualificationReason",
        "id",
        "internalNote",
        "lockVersion",
        "qualifiedCustomerId",
        "source",
        "state",
        "updatedAt",
      ].toSorted(),
    );
  });
});
