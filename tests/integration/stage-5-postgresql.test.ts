import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, type QueryResultRow } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { STAFF_AUTH_BASE_PATH, type AuthRealm } from "../../packages/auth-adapters/src/index.js";
import {
  asOpaqueId,
  bootstrapRootAgency,
  createM1StaffTripOperations,
  createMoney,
  M1StaffAuthorizationError,
  M1OptimisticConflictError,
  M1TransactionConflictError,
  PERMISSION_REGISTRY_VERSION,
  TRAVELOS_CANONICAL_TIMEZONE_NAMES,
  type StaffAuthorizationOperationProof,
  type StaffPermissionId,
  type StaffSessionAuthorizationProof,
  type M1TripSlice,
} from "../../packages/backend-core/src/index.js";
import {
  createM1TripSlice as createM1TripSliceWithAuthorization,
  readM1TripSlice as readM1TripSliceWithAuthorization,
  updateM1Accommodation as updateM1AccommodationWithAuthorization,
  updateM1InternalSupplierNote as updateM1InternalSupplierNoteWithAuthorization,
  type CreateM1TripSliceInput,
} from "../../packages/backend-core/src/modules/trip-operations/application/m1-trip-slice.js";
import {
  createPostgresPersistence,
  createStaffAccessRepository,
  createUuidV7 as randomUUID,
  mapPostgresMutationError,
  type PostgresPersistence,
} from "../../packages/database/src/index.js";
import { createM1OperationalSliceRepository } from "../../packages/database/src/trip-operations/m1-operational-slice-repository.js";
import {
  inspectMigrationStatus,
  runMigrationChain,
  type MigrationChain,
  type MigrationTarget,
} from "../../tooling/database/migration-runner.js";
import { createAdminApi } from "../../apps/admin-api/src/app.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const host = process.env["PGHOST"] ?? "";
const port = Number.parseInt(process.env["PGPORT"] ?? "", 10);
const postgresBin = process.env["TRAVELOS_STAGE5_PG_BIN"] ?? "";
const databaseName = "travelos_stage5_qualification";
const agencyId = asOpaqueId("00000000-0000-7000-8000-000000000001");

const syntheticEmail = ["rui", "example.test"].join(String.fromCharCode(64));

const productionChain: MigrationChain = {
  directory: path.join(repositoryRoot, "migrations"),
  checksumManifestPath: path.join(repositoryRoot, "migrations/checksums.json"),
};

const createPredecessorMigrationChain = async (): Promise<MigrationChain> => {
  const manifest = JSON.parse(await readFile(productionChain.checksumManifestPath, "utf8")) as {
    readonly schemaVersion: number;
    readonly algorithm: string;
    readonly migrations: readonly { readonly file: string; readonly sha256: string }[];
  };
  const currentStage5ChainIndex = manifest.migrations.findIndex(
    ({ file }) => file === "0009_stage5_revision_and_lock_version_hardening.cjs",
  );
  const predecessorMigrations =
    currentStage5ChainIndex < 0 ? [] : manifest.migrations.slice(0, currentStage5ChainIndex);
  if (
    predecessorMigrations.length !== 8 ||
    predecessorMigrations.at(-1)?.file !== "0008_stage5_cardinality_only.cjs"
  ) {
    throw new Error("The Stage 5 predecessor migration chain must end at migration 0008");
  }
  const workRoot = process.env["TRAVELOS_STAGE5_WORK_ROOT"];
  if (workRoot === undefined || !path.resolve(workRoot).startsWith(`${os.tmpdir()}${path.sep}`)) {
    throw new Error("Stage 5 predecessor migrations must stay inside the disposable work root");
  }
  const directory = await mkdtemp(path.join(workRoot, "predecessor-migrations-"));
  predecessorMigrationDirectory = directory;
  for (const migration of predecessorMigrations) {
    await copyFile(
      path.join(productionChain.directory, migration.file),
      path.join(directory, migration.file),
    );
  }
  const checksumManifestPath = path.join(directory, "checksums.json");
  await writeFile(
    checksumManifestPath,
    `${JSON.stringify({ ...manifest, migrations: predecessorMigrations }, null, 2)}\n`,
  );
  return { directory, checksumManifestPath };
};

const migrationTarget: MigrationTarget = {
  host,
  port,
  database: databaseName,
  migratorRole: "travelos_migrator",
  ownerRole: "travelos_owner",
  tls: { mode: "DISABLED_LOOPBACK_ONLY" },
  allowTrustAuthenticationForTests: true,
};

let persistence: PostgresPersistence<Record<string, never>> | null = null;
let repository: ReturnType<typeof createM1OperationalSliceRepository>;
let staffAccessRepository: ReturnType<typeof createStaffAccessRepository>;
let slice: M1TripSlice;
let upgradedSlice: M1TripSlice | null = null;
let predecessorMigrationDirectory: string | null = null;
const staffSessions = new Map<string, StaffSessionAuthorizationProof>();

const M1_READ_PERMISSION_IDS = [
  "customer.view",
  "traveller.view_sensitive",
  "trip.view",
  "reservation.view",
  "finance.view_costs",
] as const satisfies readonly StaffPermissionId[];
const M1_CREATE_PERMISSION_IDS = [
  ...M1_READ_PERMISSION_IDS,
  "customer.edit",
  "traveller.edit",
  "trip.edit",
  "reservation.edit",
  "finance.manage_costs",
] as const satisfies readonly StaffPermissionId[];
const M1_ACCOMMODATION_PERMISSION_IDS = [
  ...M1_READ_PERMISSION_IDS,
  "trip.edit",
] as const satisfies readonly StaffPermissionId[];
const M1_INTERNAL_NOTE_PERMISSION_IDS = [
  ...M1_READ_PERMISSION_IDS,
  "finance.manage_costs",
] as const satisfies readonly StaffPermissionId[];

const authorizationFor = (
  requestedAgencyId: string,
  requiredPermissionIds: readonly StaffPermissionId[],
): StaffAuthorizationOperationProof => {
  const session = staffSessions.get(requestedAgencyId);
  if (session === undefined) {
    throw new Error(
      `No disposable staff authorization fixture exists for Agency ${requestedAgencyId}`,
    );
  }
  return { session, requiredPermissionIds, nowEpochMs: Date.now() };
};

const createM1TripSlice = (
  targetRepository: ReturnType<typeof createM1OperationalSliceRepository>,
  input: CreateM1TripSliceInput,
) =>
  createM1TripSliceWithAuthorization(
    targetRepository,
    input,
    authorizationFor(input.agencyId, M1_CREATE_PERMISSION_IDS),
  );

const readM1TripSlice = (
  targetRepository: ReturnType<typeof createM1OperationalSliceRepository>,
  targetAgencyId: CreateM1TripSliceInput["agencyId"],
  tripId: CreateM1TripSliceInput["agencyId"],
) =>
  readM1TripSliceWithAuthorization(
    targetRepository,
    targetAgencyId,
    tripId,
    authorizationFor(targetAgencyId, M1_READ_PERMISSION_IDS),
  );

const updateM1Accommodation = (
  targetRepository: ReturnType<typeof createM1OperationalSliceRepository>,
  input: Parameters<typeof updateM1AccommodationWithAuthorization>[1],
) =>
  updateM1AccommodationWithAuthorization(
    targetRepository,
    input,
    authorizationFor(input.agencyId, M1_ACCOMMODATION_PERMISSION_IDS),
  );

const updateM1InternalSupplierNote = (
  targetRepository: ReturnType<typeof createM1OperationalSliceRepository>,
  input: Parameters<typeof updateM1InternalSupplierNoteWithAuthorization>[1],
) =>
  updateM1InternalSupplierNoteWithAuthorization(
    targetRepository,
    input,
    authorizationFor(input.agencyId, M1_INTERNAL_NOTE_PERMISSION_IDS),
  );

const primaryFlight = (value: M1TripSlice): M1TripSlice["flights"][number] => {
  const item = value.flights[0];
  if (item === undefined) throw new Error("Qualification Trip has no Flight");
  return item;
};

const primaryAccommodation = (value: M1TripSlice): M1TripSlice["accommodations"][number] => {
  const item = value.accommodations[0];
  if (item === undefined) throw new Error("Qualification Trip has no Accommodation");
  return item;
};

const primaryReservation = (value: M1TripSlice): M1TripSlice["reservations"][number] => {
  const item = value.reservations[0];
  if (item === undefined) throw new Error("Qualification Trip has no Reservation");
  return item;
};

const primarySupplierCost = (value: M1TripSlice): M1TripSlice["supplierCosts"][number] => {
  const item = value.supplierCosts[0];
  if (item === undefined) throw new Error("Qualification Trip has no supplier cost");
  return item;
};

const clientFor = async (user: string, database = databaseName): Promise<Client> => {
  const client = new Client({
    host,
    port,
    database,
    user,
    application_name: `travelos-stage5-${user}`,
    connectionTimeoutMillis: 5_000,
    ssl: false,
  });
  await client.connect();
  return client;
};

const queryAs = async <Row extends QueryResultRow>(
  user: string,
  statement: string,
): Promise<readonly Row[]> => {
  const client = await clientFor(user);
  try {
    return (await client.query<Row>(statement)).rows;
  } finally {
    await client.end();
  }
};

const queryAsOwner = async <Row extends QueryResultRow>(
  statement: string,
): Promise<readonly Row[]> => {
  const client = await clientFor("travelos_migrator");
  try {
    await client.query('SET ROLE "travelos_owner"');
    await client.query("SET search_path TO pg_catalog");
    return (await client.query<Row>(statement)).rows;
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    await client.end();
  }
};

const queryErrorCode = async (work: () => Promise<unknown>): Promise<string | null> => {
  try {
    await work();
    return null;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error
      ? String((error as { readonly code?: unknown }).code ?? "")
      : null;
  }
};

const queryErrorConstraint = async (work: () => Promise<unknown>): Promise<string | null> => {
  try {
    await work();
    return null;
  } catch (error) {
    return typeof error === "object" && error !== null && "constraint" in error
      ? String((error as { readonly constraint?: unknown }).constraint ?? "")
      : null;
  }
};

const withOwnerTransaction = async <Result>(
  work: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const client = await clientFor("travelos_migrator");
  try {
    await client.query('SET ROLE "travelos_owner"');
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
};

const primaryStaffFixture = {
  staffPrincipalId: `stage5-authorization-${randomUUID()}`,
  roleId: randomUUID(),
  membershipId: randomUUID(),
  assignmentId: randomUUID(),
  email: `stage5-authorization-${randomUUID()}@example.test`,
};

const seedPrimaryStaffAuthorization = async (): Promise<StaffSessionAuthorizationProof> => {
  await withOwnerTransaction(async (client) => {
    await client.query(
      `INSERT INTO "staff_access"."staff_user" ("id", "name", "email", "emailVerified")
       VALUES ($1, 'Stage 5 Authorization Fixture', $2, true)`,
      [primaryStaffFixture.staffPrincipalId, primaryStaffFixture.email],
    );
    await client.query(
      `INSERT INTO "staff_access"."staff_membership" ("id", "agencyId", "staffPrincipalId", "state")
       VALUES ($1::uuid, $2::uuid, $3, 'ACTIVE')`,
      [primaryStaffFixture.membershipId, agencyId, primaryStaffFixture.staffPrincipalId],
    );
    await client.query(
      `INSERT INTO "staff_access"."role" ("id", "agencyId", "displayName")
       VALUES ($1::uuid, $2::uuid, 'Stage 5 Authorization Fixture')`,
      [primaryStaffFixture.roleId, agencyId],
    );
    await client.query(
      `INSERT INTO "staff_access"."role_permission" ("roleId", "permissionId", "scopeKind", "accessLevel")
       SELECT $1::uuid, permission_id, 'AGENCY', 'ALL'
         FROM unnest($2::text[]) AS permission_id`,
      [primaryStaffFixture.roleId, [...M1_CREATE_PERMISSION_IDS]],
    );
    await client.query(
      `INSERT INTO "staff_access"."role_assignment"
         ("id", "agencyId", "membershipId", "roleId", "scopeKind", "organizationUnitId", "active")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'AGENCY', NULL, true)`,
      [
        primaryStaffFixture.assignmentId,
        agencyId,
        primaryStaffFixture.membershipId,
        primaryStaffFixture.roleId,
      ],
    );
  });

  const snapshot = await staffAccessRepository.getStaffAuthorizationSnapshot(
    primaryStaffFixture.staffPrincipalId,
    agencyId,
  );
  if (snapshot === null) throw new Error("The Stage 5 authorization fixture was not readable");
  const session: StaffSessionAuthorizationProof = {
    staffPrincipalId: primaryStaffFixture.staffPrincipalId,
    agencyId,
    authorizationEpoch: snapshot.authorizationEpoch,
    expiresAtEpochMs: Date.now() + 60 * 60 * 1_000,
    recentMfaVerifiedAtEpochMs: null,
  };
  staffSessions.set(agencyId, session);
  return session;
};

const baseInput = (): CreateM1TripSliceInput => ({
  agencyId,
  person: { givenName: "Rui", familyName: "Silva", email: syntheticEmail },
  customer: { displayName: "Silva Travel" },
  customerPersonRole: "PRIMARY_CONTACT",
  trip: {
    title: "Stage 5 qualification",
    startDate: "2026-09-25",
    endDate: "2026-09-28",
    state: "DRAFT",
  },
  travellerRole: "PRIMARY_TRAVELLER",
  flight: {
    title: "Outbound flight",
    description: "Synthetic outbound flight",
    carrier: "Example Air",
    flightNumber: "EA100",
    departureAirport: "LIS",
    arrivalAirport: "OPO",
    departure: {
      localDate: "2026-09-25",
      localTime: "09:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-09-25T08:00:00Z",
    },
    arrival: {
      localDate: "2026-09-25",
      localTime: "10:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-09-25T09:00:00Z",
    },
    terminal: null,
    cabin: "ECONOMY",
    baggage: "1 checked bag",
    seat: null,
    customerBookingReference: "BOOK-1",
  },
  accommodation: {
    title: "Porto hotel",
    description: "Synthetic accommodation",
    propertyName: "Example Hotel",
    checkIn: {
      localDate: "2026-09-25",
      localTime: "15:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-09-25T14:00:00Z",
    },
    checkOut: {
      localDate: "2026-09-28",
      localTime: "11:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-09-28T10:00:00Z",
    },
    roomDescription: "Double room",
    boardType: "BREAKFAST",
    customerBookingReference: "HOTEL-1",
  },
  reservation: {
    supplierName: "Example Supplier",
    supplierReference: `SUP-${randomUUID()}`,
    customerBookingReference: "CUST-1",
    state: "CONFIRMED",
  },
  supplierCost: {
    amount: createMoney("12345", "EUR", 2),
    internalNote: "Synthetic supplier net cost",
  },
});

const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const localPartsForInstant = (instant: string, timezoneName: string): string => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezoneName,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}T${values.get("hour")}:${values.get("minute")}:${values.get("second")}`;
};

const insertTripWithPrimary = async ({
  tripId,
  personId,
  travellerId,
  title,
}: {
  readonly tripId: string;
  readonly personId: string;
  readonly travellerId: string;
  readonly title: string;
}): Promise<void> => {
  const customerId = randomUUID();
  await withOwnerTransaction(async (client) => {
    await client.query(
      `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
       VALUES ('${personId}'::uuid, '${agencyId}'::uuid, '${title} Primary', 'Traveller')`,
    );
    await client.query(
      `INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
       VALUES ('${tripId}'::uuid, '${agencyId}'::uuid, '${title}', '2026-09-25', '2026-09-28', 'DRAFT')`,
    );
    await client.query(
      `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
       VALUES ('${travellerId}'::uuid, '${agencyId}'::uuid, '${tripId}'::uuid, '${personId}'::uuid, 'PRIMARY_TRAVELLER')`,
    );
    await client.query(
      `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
       VALUES ('${customerId}'::uuid, '${agencyId}'::uuid, '${title} Customer')`,
    );
    await client.query(
      `INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
       VALUES ('${agencyId}'::uuid, '${customerId}'::uuid, '${personId}'::uuid, 'PRIMARY_CONTACT', true)`,
    );
  });
};

const bootstrapDatabase = (): void => {
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
  if (result.status !== 0) throw new Error(`Stage 5 bootstrap failed: ${result.stderr}`);
};

beforeAll(async () => {
  if (!/^127\.0\.0\.1$/.test(host) || !Number.isInteger(port) || postgresBin.length === 0) {
    throw new Error("Stage 5 disposable PostgreSQL environment is incomplete");
  }
  bootstrapDatabase();
  const predecessorChain = await createPredecessorMigrationChain();
  const predecessorMigration = await runMigrationChain(migrationTarget, predecessorChain);
  expect(predecessorMigration.result).toBe("PASS");
  persistence = createPostgresPersistence<Record<string, never>>({
    host,
    port,
    database: databaseName,
    user: "travelos_admin_api",
    tls: { mode: "DISABLED_LOOPBACK_ONLY" },
    applicationName: "travelos-stage5-qualification",
    maxConnections: 5,
  });
  staffAccessRepository = createStaffAccessRepository(persistence);
  repository = createM1OperationalSliceRepository(persistence);

  const upgradeBootstrap = await bootstrapRootAgency(staffAccessRepository, {
    agencyId,
    bootstrapReference: "stage5-upgrade-qualification",
    slug: "stage5-upgrade-qualification",
  });
  expect(upgradeBootstrap.created).toBe(true);
  await seedPrimaryStaffAuthorization();
  const upgradeInput = baseInput();
  const predecessorSlice = await createM1TripSlice(repository, {
    ...upgradeInput,
    agencyId,
    trip: { ...upgradeInput.trip, title: "Stage 5 migration predecessor fixture" },
  });
  expect([
    predecessorSlice.person.lockVersion,
    predecessorSlice.customer.lockVersion,
    predecessorSlice.trip.lockVersion,
    primaryFlight(predecessorSlice).lockVersion,
    primaryAccommodation(predecessorSlice).lockVersion,
    primaryReservation(predecessorSlice).lockVersion,
    primarySupplierCost(predecessorSlice).lockVersion,
  ]).toEqual([1n, 1n, 1n, 1n, 1n, 1n, 1n]);

  const migration = await runMigrationChain(migrationTarget, productionChain);
  expect(migration.result).toBe("PASS");
  const converted = await readM1TripSlice(repository, agencyId, predecessorSlice.trip.id);
  if (converted === null) throw new Error("The Stage 5 predecessor fixture disappeared on upgrade");
  upgradedSlice = converted;
});

afterAll(async () => {
  try {
    await persistence?.destroy();
  } finally {
    if (predecessorMigrationDirectory !== null) {
      await rm(predecessorMigrationDirectory, { recursive: true, force: true });
    }
  }
});

describe.sequential("TravelOS Stage 5 disposable PostgreSQL qualification", () => {
  it("applies the new migration head and preserves the predecessor isolation boundary", async () => {
    const status = await inspectMigrationStatus(migrationTarget, productionChain);
    expect(status.currentVersion).toBe("0010_stage5_temporal_persistence_parity");
    const bootstrapInput = {
      agencyId,
      bootstrapReference: "stage5-upgrade-qualification",
      slug: "stage5-upgrade-qualification",
    };
    const firstBootstrap = await bootstrapRootAgency(staffAccessRepository, bootstrapInput);
    expect(firstBootstrap.created).toBe(false);
    expect(firstBootstrap.permissionRegistryVersion).toBe(PERMISSION_REGISTRY_VERSION);
    const rerunBootstrap = await bootstrapRootAgency(staffAccessRepository, bootstrapInput);
    expect(rerunBootstrap.created).toBe(false);
    expect(rerunBootstrap.ownerRoleId).toBe(firstBootstrap.ownerRoleId);
    expect(rerunBootstrap.permissionRegistryVersion).toBe(PERMISSION_REGISTRY_VERSION);
    expect(
      await queryErrorCode(() => queryAs("travelos_portal_api", 'SELECT * FROM "trip_ops"."trip"')),
    ).toBe("42501");
    expect(
      await queryErrorCode(() =>
        queryAs("travelos_admin_api", 'SELECT * FROM "portal_access"."portal_user"'),
      ),
    ).toBe("42501");
  });

  it("converts populated Stage 5 roots to zero-based PostgreSQL bigint lock versions", async () => {
    const migratedSlice = upgradedSlice;
    if (migratedSlice === null) throw new Error("The predecessor fixture was not migrated");
    expect([
      migratedSlice.person.lockVersion,
      migratedSlice.customer.lockVersion,
      migratedSlice.trip.lockVersion,
      primaryFlight(migratedSlice).lockVersion,
      primaryAccommodation(migratedSlice).lockVersion,
      primaryReservation(migratedSlice).lockVersion,
      primarySupplierCost(migratedSlice).lockVersion,
    ]).toEqual([0n, 0n, 0n, 0n, 0n, 0n, 0n]);
    expect(migratedSlice.trip.workspaceRevision).toBe(1n);

    const columns = await queryAsOwner<{
      readonly schemaName: string;
      readonly tableName: string;
      readonly dataType: string;
    }>(
      `SELECT roots.schema_name AS "schemaName", roots.table_name AS "tableName",
              pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS "dataType"
         FROM (VALUES
           ('crm', 'person'),
           ('crm', 'customer'),
           ('trip_ops', 'trip'),
           ('trip_ops', 'itinerary_item'),
           ('trip_ops', 'reservation'),
           ('finance', 'supplier_cost_line')
         ) AS roots(schema_name, table_name)
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.nspname = roots.schema_name
         JOIN pg_catalog.pg_class AS relation
           ON relation.relnamespace = namespace.oid
          AND relation.relname = roots.table_name
         JOIN pg_catalog.pg_attribute AS attribute
           ON attribute.attrelid = relation.oid
          AND attribute.attname = 'lockVersion'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
        ORDER BY roots.schema_name, roots.table_name`,
    );
    expect(columns).toEqual([
      { schemaName: "crm", tableName: "customer", dataType: "bigint" },
      { schemaName: "crm", tableName: "person", dataType: "bigint" },
      { schemaName: "finance", tableName: "supplier_cost_line", dataType: "bigint" },
      { schemaName: "trip_ops", tableName: "itinerary_item", dataType: "bigint" },
      { schemaName: "trip_ops", tableName: "reservation", dataType: "bigint" },
      { schemaName: "trip_ops", tableName: "trip", dataType: "bigint" },
    ]);
  });

  it("creates the complete scoped continuity, itinerary, reservation/link and internal Money slice", async () => {
    slice = await createM1TripSlice(repository, baseInput());
    expect(slice.person.agencyId).toBe(agencyId);
    expect(slice.customerPerson.personId).toBe(slice.person.id);
    expect(slice.traveller.tripId).toBe(slice.trip.id);
    expect(primaryFlight(slice).family).toBe("FLIGHT");
    expect(primaryAccommodation(slice).family).toBe("ACCOMMODATION");
    expect(slice.reservationItemLinks).toHaveLength(2);
    expect(slice.reservationItemLinks.every((link) => link.tripId === slice.trip.id)).toBe(true);
    expect(primarySupplierCost(slice).classification).toBe("INTERNAL_ONLY");
    expect(primarySupplierCost(slice).amount.minorUnits).toBe(12345n);
    expect(slice.trip.workspaceRevision).toBe(1n);
    expect([
      slice.person.lockVersion,
      slice.customer.lockVersion,
      slice.trip.lockVersion,
      primaryFlight(slice).lockVersion,
      primaryAccommodation(slice).lockVersion,
      primaryReservation(slice).lockVersion,
      primarySupplierCost(slice).lockVersion,
    ]).toEqual([0n, 0n, 0n, 0n, 0n, 0n, 0n]);
  });

  it("keeps authorization snapshots and Trip reads Agency-isolated with two disposable Agency fixtures", async () => {
    const secondAgencyId = randomUUID();
    const staffPrincipalId = randomUUID();
    const rootMembershipId = randomUUID();
    const secondMembershipId = randomUUID();
    const rootRoleId = randomUUID();
    const secondRoleId = randomUUID();
    const rootAssignmentId = randomUUID();
    const secondAssignmentId = randomUUID();
    const syntheticEmailAddress = `stage5-multi-agency-${staffPrincipalId}@example.test`;
    let syntheticTopologyCreated = false;

    try {
      await withOwnerTransaction(async (client) => {
        // Only the disposable qualification DB relaxes the production single-root index.
        await client.query('DROP INDEX "organization"."agency_single_root_idx"');
        await client.query(
          `INSERT INTO "organization"."agency" ("id", "bootstrapReference", "slug")
           VALUES ($1::uuid, $2, $3)`,
          [secondAgencyId, `stage5-multi-agency-${secondAgencyId}`, `stage5-${secondAgencyId}`],
        );
        await client.query(
          `INSERT INTO "staff_access"."staff_user" ("id", "name", "email", "emailVerified")
           VALUES ($1, $2, $3, true)`,
          [staffPrincipalId, "Stage 5 Multi-Agency Fixture", syntheticEmailAddress],
        );
        await client.query(
          `INSERT INTO "staff_access"."staff_membership" ("id", "agencyId", "staffPrincipalId", "state")
           VALUES ($1::uuid, $2::uuid, $3, 'ACTIVE'), ($4::uuid, $5::uuid, $3, 'ACTIVE')`,
          [rootMembershipId, agencyId, staffPrincipalId, secondMembershipId, secondAgencyId],
        );
        await client.query(
          `INSERT INTO "staff_access"."role" ("id", "agencyId", "displayName")
           VALUES ($1::uuid, $2::uuid, 'Stage 5 Root Qualification'),
                  ($3::uuid, $4::uuid, 'Stage 5 Second Agency Qualification')`,
          [rootRoleId, agencyId, secondRoleId, secondAgencyId],
        );
        await client.query(
          `INSERT INTO "staff_access"."role_permission" ("roleId", "permissionId", "scopeKind", "accessLevel")
           SELECT $1::uuid, permission_id, 'AGENCY', 'ALL'
             FROM unnest($2::text[]) AS permission_id`,
          [rootRoleId, [...M1_READ_PERMISSION_IDS, "trip.edit"]],
        );
        await client.query(
          `INSERT INTO "staff_access"."role_permission" ("roleId", "permissionId", "scopeKind", "accessLevel")
           SELECT $1::uuid, permission_id, 'AGENCY', 'ALL'
             FROM unnest($2::text[]) AS permission_id`,
          [secondRoleId, [...M1_READ_PERMISSION_IDS, "finance.manage_costs"]],
        );
        await client.query(
          `INSERT INTO "staff_access"."role_assignment"
             ("id", "agencyId", "membershipId", "roleId", "scopeKind", "organizationUnitId", "active")
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'AGENCY', NULL, true),
                  ($5::uuid, $6::uuid, $7::uuid, $8::uuid, 'AGENCY', NULL, true)`,
          [
            rootAssignmentId,
            agencyId,
            rootMembershipId,
            rootRoleId,
            secondAssignmentId,
            secondAgencyId,
            secondMembershipId,
            secondRoleId,
          ],
        );
      });
      syntheticTopologyCreated = true;

      const rootSnapshot = await staffAccessRepository.getStaffAuthorizationSnapshot(
        staffPrincipalId,
        agencyId,
      );
      const secondSnapshot = await staffAccessRepository.getStaffAuthorizationSnapshot(
        staffPrincipalId,
        secondAgencyId,
      );
      expect(rootSnapshot?.agencyId).toBe(agencyId);
      expect(
        rootSnapshot?.assignments.every((assignment) => assignment.agencyId === agencyId),
      ).toBe(true);
      expect(rootSnapshot?.assignments.map(({ permissionId }) => permissionId).toSorted()).toEqual(
        [...M1_READ_PERMISSION_IDS, "trip.edit"].toSorted(),
      );
      expect(secondSnapshot?.agencyId).toBe(secondAgencyId);
      expect(
        secondSnapshot?.assignments.every((assignment) => assignment.agencyId === secondAgencyId),
      ).toBe(true);
      expect(
        secondSnapshot?.assignments.map(({ permissionId }) => permissionId).toSorted(),
      ).toEqual([...M1_READ_PERMISSION_IDS, "finance.manage_costs"].toSorted());
      const nowEpochMs = Date.now();
      const rootAuthorization: StaffAuthorizationOperationProof = {
        session: {
          staffPrincipalId,
          agencyId,
          authorizationEpoch: rootSnapshot!.authorizationEpoch,
          expiresAtEpochMs: nowEpochMs + 60 * 60 * 1_000,
          recentMfaVerifiedAtEpochMs: null,
        },
        requiredPermissionIds: M1_READ_PERMISSION_IDS,
        nowEpochMs,
      };
      const secondAuthorization: StaffAuthorizationOperationProof = {
        session: {
          staffPrincipalId,
          agencyId: secondAgencyId,
          authorizationEpoch: secondSnapshot!.authorizationEpoch,
          expiresAtEpochMs: nowEpochMs + 60 * 60 * 1_000,
          recentMfaVerifiedAtEpochMs: null,
        },
        requiredPermissionIds: M1_READ_PERMISSION_IDS,
        nowEpochMs,
      };
      expect(
        await readM1TripSliceWithAuthorization(
          repository,
          asOpaqueId(secondAgencyId),
          slice.trip.id,
          secondAuthorization,
        ),
      ).toBeNull();
      expect(
        await readM1TripSliceWithAuthorization(
          repository,
          agencyId,
          slice.trip.id,
          rootAuthorization,
        ),
      ).not.toBeNull();
    } finally {
      if (syntheticTopologyCreated) {
        await withOwnerTransaction(async (client) => {
          await client.query(
            `DELETE FROM "staff_access"."role_assignment" WHERE "id" IN ($1::uuid, $2::uuid)`,
            [rootAssignmentId, secondAssignmentId],
          );
          await client.query(
            `DELETE FROM "staff_access"."staff_membership" WHERE "id" IN ($1::uuid, $2::uuid)`,
            [rootMembershipId, secondMembershipId],
          );
          await client.query(
            `DELETE FROM "staff_access"."role" WHERE "id" IN ($1::uuid, $2::uuid)`,
            [rootRoleId, secondRoleId],
          );
          await client.query(`DELETE FROM "staff_access"."staff_user" WHERE "id" = $1`, [
            staffPrincipalId,
          ]);
          await client.query(`DELETE FROM "organization"."agency" WHERE "id" = $1::uuid`, [
            secondAgencyId,
          ]);
          await client.query(
            'CREATE UNIQUE INDEX "agency_single_root_idx" ON "organization"."agency" ((true))',
          );
        });
      }
    }

    const rootRows = await queryAsOwner<{ readonly count: string }>(
      `SELECT count(*)::text AS "count" FROM "organization"."agency" WHERE "isRoot"`,
    );
    expect(rootRows).toEqual([{ count: "1" }]);
    const singletonIndex = await queryAsOwner<{ readonly indexName: string | null }>(
      `SELECT pg_catalog.to_regclass('organization.agency_single_root_idx')::text AS "indexName"`,
    );
    expect(singletonIndex[0]?.indexName).toBe("organization.agency_single_root_idx");
  });

  it("rechecks current Staff authorization inside the mutation transaction", async () => {
    const session = staffSessions.get(agencyId);
    if (session === undefined) throw new Error("The primary Staff session fixture is unavailable");
    const before = await readM1TripSlice(repository, agencyId, slice.trip.id);
    if (before === null) throw new Error("The authorized Trip is unavailable before revocation");
    const currentAccommodation = primaryAccommodation(before);
    const revokingRepository: Parameters<typeof createM1StaffTripOperations>[0]["repository"] = {
      createM1TripSlice: repository.createM1TripSlice,
      getM1TripSlice: repository.getM1TripSlice,
      updateAccommodation: async (input, authorization) => {
        await withOwnerTransaction(async (client) => {
          const result = await client.query(
            `UPDATE "staff_access"."role_assignment"
              SET "active" = false, "revokedAt" = CURRENT_TIMESTAMP
            WHERE "id" = $1::uuid AND "active"`,
            [primaryStaffFixture.assignmentId],
          );
          if (result.rowCount !== 1) {
            throw new Error("The qualification Staff role assignment was not revoked");
          }
        });
        return repository.updateAccommodation(input, authorization);
      },
      updateInternalSupplierNote: repository.updateInternalSupplierNote,
    };
    const operations = createM1StaffTripOperations({
      repository: revokingRepository,
      authorizationRepository: staffAccessRepository,
      sessionResolver: {
        resolveStaffSession: async (cookieHeader) =>
          cookieHeader === "stage5-authorization-session" ? session : null,
      },
    });

    let fixtureRestorationFailure: Error | undefined;
    try {
      await expect(
        operations.updateAccommodation("stage5-authorization-session", {
          agencyId,
          tripId: before.trip.id,
          itemId: currentAccommodation.id,
          expectedLockVersion: currentAccommodation.lockVersion,
          title: "Must not persist after role revocation",
          description: "The transaction must recheck current permissions",
        }),
      ).rejects.toBeInstanceOf(M1StaffAuthorizationError);
    } finally {
      try {
        await withOwnerTransaction(async (client) => {
          await client.query(
            `UPDATE "staff_access"."role_assignment"
              SET "active" = true, "revokedAt" = NULL
            WHERE "id" = $1::uuid AND NOT "active"`,
            [primaryStaffFixture.assignmentId],
          );
        });
        const refreshedSnapshot = await staffAccessRepository.getStaffAuthorizationSnapshot(
          primaryStaffFixture.staffPrincipalId,
          agencyId,
        );
        if (refreshedSnapshot === null) {
          fixtureRestorationFailure = new Error(
            "The restored Staff authorization fixture was not readable",
          );
        } else {
          staffSessions.set(agencyId, {
            ...session,
            authorizationEpoch: refreshedSnapshot.authorizationEpoch,
            expiresAtEpochMs: Date.now() + 60 * 60 * 1_000,
          });
        }
      } catch (error) {
        fixtureRestorationFailure = new Error("Failed to restore the Staff authorization fixture", {
          cause: error,
        });
      }
    }
    if (fixtureRestorationFailure !== undefined) throw fixtureRestorationFailure;

    const after = await readM1TripSlice(repository, agencyId, slice.trip.id);
    if (after === null) throw new Error("The Trip disappeared after authorization revalidation");
    expect(after.trip.workspaceRevision).toBe(before.trip.workspaceRevision);
    expect(primaryAccommodation(after)).toEqual(currentAccommodation);
  });

  it("increments once per committed relevant transaction and returns typed conflicts for stale and racing writes", async () => {
    const edited = await updateM1Accommodation(repository, {
      agencyId,
      tripId: slice.trip.id,
      itemId: primaryAccommodation(slice).id,
      expectedLockVersion: primaryAccommodation(slice).lockVersion,
      title: "Porto hotel updated",
      description: "Updated synthetic accommodation",
    });
    expect(edited.trip.workspaceRevision).toBe(slice.trip.workspaceRevision + 1n);
    expect(primaryAccommodation(edited).lockVersion).toBe(
      primaryAccommodation(slice).lockVersion + 1n,
    );
    await expect(
      updateM1Accommodation(repository, {
        agencyId,
        tripId: slice.trip.id,
        itemId: primaryAccommodation(slice).id,
        expectedLockVersion: primaryAccommodation(slice).lockVersion,
        title: "Stale write",
        description: "Must fail",
      }),
    ).rejects.toBeInstanceOf(M1OptimisticConflictError);
    const afterStale = await readM1TripSlice(repository, agencyId, slice.trip.id);
    if (afterStale === null) throw new Error("The Trip disappeared after a stale CAS rejection");
    expect(afterStale.trip.workspaceRevision).toBe(edited.trip.workspaceRevision);
    expect(primaryAccommodation(afterStale).lockVersion).toBe(
      primaryAccommodation(edited).lockVersion,
    );
    expect(primaryAccommodation(afterStale).title).toBe(primaryAccommodation(edited).title);

    const secondEdit = await updateM1Accommodation(repository, {
      agencyId,
      tripId: slice.trip.id,
      itemId: primaryAccommodation(edited).id,
      expectedLockVersion: primaryAccommodation(edited).lockVersion,
      title: "Porto hotel updated twice",
      description: "Second committed edit",
    });
    expect(secondEdit.trip.workspaceRevision).toBe(edited.trip.workspaceRevision + 1n);
    expect(primaryAccommodation(secondEdit).lockVersion).toBe(
      primaryAccommodation(edited).lockVersion + 1n,
    );

    const internal = await updateM1InternalSupplierNote(repository, {
      agencyId,
      tripId: slice.trip.id,
      reservationId: primaryReservation(slice).id,
      expectedLockVersion: primarySupplierCost(slice).lockVersion,
      internalNote: "Updated internal-only note",
    });
    expect(internal.trip.workspaceRevision).toBe(secondEdit.trip.workspaceRevision);
    expect(primarySupplierCost(internal).lockVersion).toBe(
      primarySupplierCost(slice).lockVersion + 1n,
    );
    expect(primarySupplierCost(internal).internalNote).toBe("Updated internal-only note");
    await expect(
      updateM1InternalSupplierNote(repository, {
        agencyId,
        tripId: slice.trip.id,
        reservationId: primaryReservation(slice).id,
        expectedLockVersion: primarySupplierCost(slice).lockVersion,
        internalNote: "Stale supplier-cost note",
      }),
    ).rejects.toBeInstanceOf(M1OptimisticConflictError);
    const afterStaleSupplierCost = await readM1TripSlice(repository, agencyId, slice.trip.id);
    if (afterStaleSupplierCost === null) {
      throw new Error("The Trip disappeared after a stale supplier-cost CAS rejection");
    }
    expect(afterStaleSupplierCost.trip.workspaceRevision).toBe(internal.trip.workspaceRevision);
    expect(primarySupplierCost(afterStaleSupplierCost).lockVersion).toBe(
      primarySupplierCost(internal).lockVersion,
    );
    expect(primarySupplierCost(afterStaleSupplierCost).internalNote).toBe(
      primarySupplierCost(internal).internalNote,
    );

    const concurrent = await Promise.allSettled([
      updateM1Accommodation(repository, {
        agencyId,
        tripId: slice.trip.id,
        itemId: primaryAccommodation(slice).id,
        expectedLockVersion: primaryAccommodation(secondEdit).lockVersion,
        title: "Concurrent accommodation A",
        description: "Concurrent description A",
      }),
      updateM1Accommodation(repository, {
        agencyId,
        tripId: slice.trip.id,
        itemId: primaryAccommodation(slice).id,
        expectedLockVersion: primaryAccommodation(secondEdit).lockVersion,
        title: "Concurrent accommodation B",
        description: "Concurrent description B",
      }),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = concurrent.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toBeInstanceOf(
      M1OptimisticConflictError,
    );
    const committed = concurrent.find((result) => result.status === "fulfilled");
    if (committed?.status !== "fulfilled") throw new Error("No concurrent CAS mutation committed");
    expect(committed.value.trip.workspaceRevision).toBe(secondEdit.trip.workspaceRevision + 1n);
  });

  it("round-trips and compare-and-swaps bigint lock versions beyond JavaScript safe integer", async () => {
    const input = baseInput();
    const seeded = await createM1TripSlice(repository, {
      ...input,
      trip: { ...input.trip, title: "Bigint lock version qualification" },
    });
    const highLockVersion = 9_007_199_254_740_993n;
    await withOwnerTransaction(async (client) => {
      await client.query(
        `UPDATE "trip_ops"."itinerary_item"
            SET "lockVersion" = $1::bigint
          WHERE "agencyId" = $2::uuid
            AND "tripId" = $3::uuid
            AND "id" = $4::uuid`,
        [highLockVersion.toString(), agencyId, seeded.trip.id, primaryAccommodation(seeded).id],
      );
      await client.query(
        `UPDATE "finance"."supplier_cost_line"
            SET "lockVersion" = $1::bigint
          WHERE "agencyId" = $2::uuid
            AND "tripId" = $3::uuid
            AND "reservationId" = $4::uuid`,
        [highLockVersion.toString(), agencyId, seeded.trip.id, primaryReservation(seeded).id],
      );
    });

    const loaded = await readM1TripSlice(repository, agencyId, seeded.trip.id);
    if (loaded === null) throw new Error("The high-version Trip fixture was not readable");
    expect(primaryAccommodation(loaded).lockVersion).toBe(highLockVersion);
    expect(primarySupplierCost(loaded).lockVersion).toBe(highLockVersion);

    const updatedAccommodation = await updateM1Accommodation(repository, {
      agencyId,
      tripId: seeded.trip.id,
      itemId: primaryAccommodation(loaded).id,
      expectedLockVersion: highLockVersion,
      title: "Bigint version updated",
      description: "Exact compare-and-swap beyond Number.MAX_SAFE_INTEGER",
    });
    expect(primaryAccommodation(updatedAccommodation).lockVersion).toBe(highLockVersion + 1n);

    const updatedInternal = await updateM1InternalSupplierNote(repository, {
      agencyId,
      tripId: seeded.trip.id,
      reservationId: primaryReservation(loaded).id,
      expectedLockVersion: highLockVersion,
      internalNote: "Bigint version note update",
    });
    expect(primarySupplierCost(updatedInternal).lockVersion).toBe(highLockVersion + 1n);
    expect(updatedInternal.trip.workspaceRevision).toBe(
      updatedAccommodation.trip.workspaceRevision,
    );
  });

  it("rolls back both workspace revision and deduplication state with a failed transaction", async () => {
    const input = baseInput();
    const seeded = await createM1TripSlice(repository, {
      ...input,
      trip: { ...input.trip, title: "Workspace revision rollback qualification" },
    });
    await expect(
      withOwnerTransaction(async (client) => {
        await client.query(
          `UPDATE "trip_ops"."itinerary_item"
              SET "customerTitle" = 'Rolled-back title'
            WHERE "agencyId" = $1::uuid
              AND "tripId" = $2::uuid
              AND "id" = $3::uuid`,
          [agencyId, seeded.trip.id, primaryAccommodation(seeded).id],
        );
        throw new Error("Intentional transaction rollback");
      }),
    ).rejects.toThrow("Intentional transaction rollback");
    const rolledBack = await readM1TripSlice(repository, agencyId, seeded.trip.id);
    if (rolledBack === null) throw new Error("The rollback Trip fixture was not readable");
    expect(rolledBack.trip.workspaceRevision).toBe(seeded.trip.workspaceRevision);
    expect(primaryAccommodation(rolledBack).title).toBe(primaryAccommodation(seeded).title);

    const committed = await updateM1Accommodation(repository, {
      agencyId,
      tripId: seeded.trip.id,
      itemId: primaryAccommodation(seeded).id,
      expectedLockVersion: primaryAccommodation(seeded).lockVersion,
      title: "Committed after rollback",
      description: "The transaction marker was rolled back too",
    });
    expect(committed.trip.workspaceRevision).toBe(seeded.trip.workspaceRevision + 1n);
  });

  it("enforces exactly one primary traveller at commit and during replacement", async () => {
    const emptyTripId = randomUUID();
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
           VALUES ('${emptyTripId}'::uuid, '${agencyId}'::uuid, 'Invalid empty trip', '2026-09-25', '2026-09-28', 'DRAFT')`,
        ),
      ),
    ).toBe("trip_primary_traveller_exactly_one");

    const replacementTripId = randomUUID();
    const originalPersonId = randomUUID();
    const originalTravellerId = randomUUID();
    await insertTripWithPrimary({
      tripId: replacementTripId,
      personId: originalPersonId,
      travellerId: originalTravellerId,
      title: "Primary replacement",
    });
    const competingPersonId = randomUUID();
    const competingTravellerId = randomUUID();
    await queryAsOwner(
      `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
       VALUES ('${competingPersonId}'::uuid, '${agencyId}'::uuid, 'Competing', 'Traveller')`,
    );
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
           VALUES ('${competingTravellerId}'::uuid, '${agencyId}'::uuid, '${replacementTripId}'::uuid, '${competingPersonId}'::uuid, 'PRIMARY_TRAVELLER')`,
        ),
      ),
    ).toBe("trip_primary_traveller_idx");

    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `DELETE FROM "trip_ops"."trip_traveller"
            WHERE "id" = '${originalTravellerId}'::uuid`,
        ),
      ),
    ).toBe("trip_primary_traveller_exactly_one");

    const reparentTargetTripId = randomUUID();
    await insertTripWithPrimary({
      tripId: reparentTargetTripId,
      personId: randomUUID(),
      travellerId: randomUUID(),
      title: "Reparent target",
    });
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."trip_traveller"
              SET "tripId" = '${reparentTargetTripId}'::uuid
            WHERE "id" = '${originalTravellerId}'::uuid`,
        ),
      ),
    ).toBe("trip_primary_traveller_idx");

    const replacementPersonId = randomUUID();
    const replacementTravellerId = randomUUID();
    const replacementCustomerId = randomUUID();
    await withOwnerTransaction(async (client) => {
      await client.query(
        `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
         VALUES ('${replacementPersonId}'::uuid, '${agencyId}'::uuid, 'Replacement', 'Traveller')`,
      );
      await client.query(
        `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
         VALUES ('${replacementCustomerId}'::uuid, '${agencyId}'::uuid, 'Replacement Customer')`,
      );
      await client.query(
        `INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
         VALUES ('${agencyId}'::uuid, '${replacementCustomerId}'::uuid, '${replacementPersonId}'::uuid, 'PRIMARY_CONTACT', true)`,
      );
      await client.query(
        `DELETE FROM "trip_ops"."trip_traveller"
          WHERE "id" = '${originalTravellerId}'::uuid`,
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
         VALUES ('${replacementTravellerId}'::uuid, '${agencyId}'::uuid, '${replacementTripId}'::uuid, '${replacementPersonId}'::uuid, 'PRIMARY_TRAVELLER')`,
      );
    });
    const replacementRows = await queryAsOwner<{ readonly id: string; readonly role: string }>(
      `SELECT "id"::text AS "id", "role"
         FROM "trip_ops"."trip_traveller"
        WHERE "agencyId" = '${agencyId}'::uuid AND "tripId" = '${replacementTripId}'::uuid
          AND "role" = 'PRIMARY_TRAVELLER'`,
    );
    expect(replacementRows).toEqual([{ id: replacementTravellerId, role: "PRIMARY_TRAVELLER" }]);
  });

  it("enforces primary traveller CustomerPerson continuity and permits child-before-parent repair", async () => {
    const invalidTripId = randomUUID();
    const invalidPersonId = randomUUID();
    const invalidTravellerId = randomUUID();
    expect(
      await queryErrorConstraint(() =>
        withOwnerTransaction(async (client) => {
          await client.query(
            `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
             VALUES ('${invalidPersonId}'::uuid, '${agencyId}'::uuid, 'Continuity', 'Invalid')`,
          );
          await client.query(
            `INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
             VALUES ('${invalidTripId}'::uuid, '${agencyId}'::uuid, 'Invalid continuity', '2026-09-25', '2026-09-28', 'DRAFT')`,
          );
          await client.query(
            `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
             VALUES ('${invalidTravellerId}'::uuid, '${agencyId}'::uuid, '${invalidTripId}'::uuid, '${invalidPersonId}'::uuid, 'PRIMARY_TRAVELLER')`,
          );
        }),
      ),
    ).toBe("trip_primary_traveller_customer_continuity");

    const childFirstTripId = randomUUID();
    const childFirstPersonId = randomUUID();
    const childFirstTravellerId = randomUUID();
    const childFirstCustomerId = randomUUID();
    await withOwnerTransaction(async (client) => {
      await client.query(
        `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
         VALUES ('${childFirstPersonId}'::uuid, '${agencyId}'::uuid, 'Child', 'First')`,
      );
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      await client.query(
        `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
         VALUES ('${childFirstTravellerId}'::uuid, '${agencyId}'::uuid, '${childFirstTripId}'::uuid, '${childFirstPersonId}'::uuid, 'PRIMARY_TRAVELLER')`,
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
         VALUES ('${childFirstTripId}'::uuid, '${agencyId}'::uuid, 'Child-first trip', '2026-09-25', '2026-09-28', 'DRAFT')`,
      );
      await client.query(
        `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
         VALUES ('${childFirstCustomerId}'::uuid, '${agencyId}'::uuid, 'Child-first customer')`,
      );
      await client.query(
        `INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
         VALUES ('${agencyId}'::uuid, '${childFirstCustomerId}'::uuid, '${childFirstPersonId}'::uuid, 'PRIMARY_CONTACT', true)`,
      );
    });
    const childFirstRevision = await queryAsOwner<{ readonly revision: string }>(
      `SELECT "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" = '${childFirstTripId}'::uuid`,
    );
    expect(childFirstRevision).toEqual([{ revision: "1" }]);

    const repairedTripId = randomUUID();
    const repairedPersonId = randomUUID();
    const repairedTravellerId = randomUUID();
    const repairedCustomerId = randomUUID();
    await withOwnerTransaction(async (client) => {
      await client.query(
        `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
         VALUES ('${repairedPersonId}'::uuid, '${agencyId}'::uuid, 'Continuity', 'Repaired')`,
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
         VALUES ('${repairedTripId}'::uuid, '${agencyId}'::uuid, 'Repaired continuity', '2026-09-25', '2026-09-28', 'DRAFT')`,
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
         VALUES ('${repairedTravellerId}'::uuid, '${agencyId}'::uuid, '${repairedTripId}'::uuid, '${repairedPersonId}'::uuid, 'PRIMARY_TRAVELLER')`,
      );
      await client.query(
        `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
         VALUES ('${repairedCustomerId}'::uuid, '${agencyId}'::uuid, 'Repaired continuity customer')`,
      );
      await client.query(
        `INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
         VALUES ('${agencyId}'::uuid, '${repairedCustomerId}'::uuid, '${repairedPersonId}'::uuid, 'PRIMARY_CONTACT', true)`,
      );
    });
    const continuityTrip = await queryAsOwner<{ readonly id: string }>(
      `SELECT "id"::text AS "id"
         FROM "trip_ops"."trip_traveller"
        WHERE "id" = '${repairedTravellerId}'::uuid
          AND "role" = 'PRIMARY_TRAVELLER'`,
    );
    expect(continuityTrip).toEqual([{ id: repairedTravellerId }]);

    const deletionTripId = randomUUID();
    const deletionPersonId = randomUUID();
    await insertTripWithPrimary({
      tripId: deletionTripId,
      personId: deletionPersonId,
      travellerId: randomUUID(),
      title: "Continuity deletion",
    });
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `DELETE FROM "crm"."customer_person"
            WHERE "agencyId" = '${agencyId}'::uuid
              AND "personId" = '${deletionPersonId}'::uuid
              AND "isPrimary" = true`,
        ),
      ),
    ).toBe("trip_primary_traveller_customer_continuity");
  });

  it("qualifies deferred primary reparenting for rejection and repaired commit", async () => {
    const rejectedSourceTripId = randomUUID();
    const rejectedSourcePersonId = randomUUID();
    const rejectedSourceTravellerId = randomUUID();
    const rejectedTargetTripId = randomUUID();
    const rejectedTargetTravellerId = randomUUID();
    await insertTripWithPrimary({
      tripId: rejectedSourceTripId,
      personId: rejectedSourcePersonId,
      travellerId: rejectedSourceTravellerId,
      title: "Reparent rejected source",
    });
    await insertTripWithPrimary({
      tripId: rejectedTargetTripId,
      personId: randomUUID(),
      travellerId: rejectedTargetTravellerId,
      title: "Reparent rejected target",
    });
    expect(
      await queryErrorConstraint(() =>
        withOwnerTransaction(async (client) => {
          await client.query(
            `DELETE FROM "trip_ops"."trip_traveller"
              WHERE "id" = '${rejectedTargetTravellerId}'::uuid`,
          );
          await client.query(
            `UPDATE "trip_ops"."trip_traveller"
                SET "tripId" = '${rejectedTargetTripId}'::uuid
              WHERE "id" = '${rejectedSourceTravellerId}'::uuid`,
          );
        }),
      ),
    ).toBe("trip_primary_traveller_exactly_one");

    const sourceTripId = randomUUID();
    const sourcePersonId = randomUUID();
    const sourceTravellerId = randomUUID();
    const targetTripId = randomUUID();
    const targetTravellerId = randomUUID();
    const replacementPersonId = randomUUID();
    const replacementCustomerId = randomUUID();
    await insertTripWithPrimary({
      tripId: sourceTripId,
      personId: sourcePersonId,
      travellerId: sourceTravellerId,
      title: "Reparent repaired source",
    });
    await insertTripWithPrimary({
      tripId: targetTripId,
      personId: randomUUID(),
      travellerId: targetTravellerId,
      title: "Reparent repaired target",
    });
    await queryAsOwner(
      `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
       VALUES ('${replacementPersonId}'::uuid, '${agencyId}'::uuid, 'Replacement', 'Primary')`,
    );
    await queryAsOwner(
      `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
       VALUES ('${replacementCustomerId}'::uuid, '${agencyId}'::uuid, 'Replacement Customer')`,
    );
    await queryAsOwner(
      `INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
       VALUES ('${agencyId}'::uuid, '${replacementCustomerId}'::uuid, '${replacementPersonId}'::uuid, 'PRIMARY_CONTACT', true)`,
    );
    await withOwnerTransaction(async (client) => {
      await client.query(
        `DELETE FROM "trip_ops"."trip_traveller"
          WHERE "id" = '${targetTravellerId}'::uuid`,
      );
      await client.query(
        `UPDATE "trip_ops"."trip_traveller"
            SET "tripId" = '${targetTripId}'::uuid, "role" = 'TRAVELLER'
          WHERE "id" = '${sourceTravellerId}'::uuid`,
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
         VALUES ('${randomUUID()}'::uuid, '${agencyId}'::uuid, '${sourceTripId}'::uuid, '${replacementPersonId}'::uuid, 'PRIMARY_TRAVELLER')`,
      );
      await client.query(
        `UPDATE "trip_ops"."trip_traveller"
            SET "role" = 'PRIMARY_TRAVELLER'
          WHERE "id" = '${sourceTravellerId}'::uuid`,
      );
    });
    const repairedRows = await queryAsOwner<{
      readonly tripId: string;
      readonly role: string;
      readonly personId: string;
    }>(
      `SELECT "tripId"::text AS "tripId", "role", "personId"::text AS "personId"
         FROM "trip_ops"."trip_traveller"
        WHERE "agencyId" = '${agencyId}'::uuid
          AND "tripId" IN ('${sourceTripId}'::uuid, '${targetTripId}'::uuid)
          AND "role" = 'PRIMARY_TRAVELLER'
        ORDER BY "tripId"`,
    );
    expect(repairedRows).toEqual(
      [
        { tripId: sourceTripId, role: "PRIMARY_TRAVELLER", personId: replacementPersonId },
        { tripId: targetTripId, role: "PRIMARY_TRAVELLER", personId: sourcePersonId },
      ].sort((left, right) => left.tripId.localeCompare(right.tripId)),
    );
  });

  it("keeps the designated primary continuity rows when valid secondary rows exist", async () => {
    const secondaryPersonId = randomUUID();
    const secondaryCustomerId = randomUUID();
    const secondaryTravellerId = randomUUID();
    await queryAsOwner(
      `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
       VALUES ('${secondaryPersonId}'::uuid, '${agencyId}'::uuid, 'Secondary', 'Traveller')`,
    );
    await queryAsOwner(
      `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
       VALUES ('${secondaryCustomerId}'::uuid, '${agencyId}'::uuid, 'Secondary Customer')`,
    );
    await queryAsOwner(
      `INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
       VALUES ('${agencyId}'::uuid, '${secondaryCustomerId}'::uuid, '${secondaryPersonId}'::uuid, 'PAYER', false)`,
    );
    await queryAsOwner(
      `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
       VALUES ('${secondaryTravellerId}'::uuid, '${agencyId}'::uuid, '${slice.trip.id}'::uuid, '${secondaryPersonId}'::uuid, 'TRAVELLER')`,
    );
    const projected = await readM1TripSlice(repository, agencyId, slice.trip.id);
    expect(projected).not.toBeNull();
    expect(projected?.person.id).toBe(slice.person.id);
    expect(projected?.customer.id).toBe(slice.customer.id);
    expect(projected?.customerPerson.isPrimary).toBe(true);
    expect(projected?.traveller.id).toBe(slice.traveller.id);
    expect(projected?.traveller.role).toBe("PRIMARY_TRAVELLER");
  });

  it("increments workspace revision for projected Person, Customer and CustomerPerson changes", async () => {
    const projectionInput = baseInput();
    const projectedSlice = await createM1TripSlice(repository, {
      ...projectionInput,
      trip: { ...projectionInput.trip, title: "CRM projection revision trip" },
    });
    const readRevision = async (): Promise<bigint> => {
      const rows = await queryAsOwner<{ readonly revision: string }>(
        `SELECT "workspaceRevision"::text AS "revision"
           FROM "trip_ops"."trip"
          WHERE "id" = '${projectedSlice.trip.id}'::uuid
            AND "agencyId" = '${agencyId}'::uuid`,
      );
      return BigInt(rows[0]!.revision);
    };
    let revision = await readRevision();
    await queryAsOwner(
      `UPDATE "crm"."person"
          SET "givenName" = 'Projected Updated'
        WHERE "id" = '${projectedSlice.person.id}'::uuid
          AND "agencyId" = '${agencyId}'::uuid`,
    );
    expect(await readRevision()).toBe(revision + 1n);
    revision += 1n;
    await queryAsOwner(
      `UPDATE "crm"."customer"
          SET "displayName" = 'Projected Customer Updated'
        WHERE "id" = '${projectedSlice.customer.id}'::uuid
          AND "agencyId" = '${agencyId}'::uuid`,
    );
    expect(await readRevision()).toBe(revision + 1n);
    revision += 1n;
    await queryAsOwner(
      `UPDATE "crm"."customer_person"
          SET "role" = 'PAYER'
        WHERE "agencyId" = '${agencyId}'::uuid
          AND "customerId" = '${projectedSlice.customer.id}'::uuid
          AND "personId" = '${projectedSlice.person.id}'::uuid
          AND "role" = 'PRIMARY_CONTACT'`,
    );
    expect(await readRevision()).toBe(revision + 1n);
  });

  it("rejects direct workspace revision and lockVersion writes through the actual Admin login role", async () => {
    const before = await queryAsOwner<{ readonly revision: string }>(
      `SELECT "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" = '${slice.trip.id}'::uuid
          AND "agencyId" = '${agencyId}'::uuid`,
    );
    const deniedStatements = [
      `UPDATE "trip_ops"."trip"
          SET "workspaceRevision" = 0
        WHERE "id" = '${slice.trip.id}'::uuid
          AND "agencyId" = '${agencyId}'::uuid`,
      `UPDATE "trip_ops"."itinerary_item"
          SET "lockVersion" = 99
        WHERE "id" = '${primaryAccommodation(slice).id}'::uuid
          AND "agencyId" = '${agencyId}'::uuid`,
      `UPDATE "finance"."supplier_cost_line"
          SET "lockVersion" = 99
        WHERE "reservationId" = '${primaryReservation(slice).id}'::uuid
          AND "agencyId" = '${agencyId}'::uuid`,
      `INSERT INTO "trip_ops"."trip"
        ("id", "agencyId", "title", "startDate", "endDate", "state", "workspaceRevision")
       VALUES ('${randomUUID()}'::uuid, '${agencyId}'::uuid, 'Forbidden revision insert', '2026-09-25', '2026-09-28', 'DRAFT', 99)`,
      `INSERT INTO "trip_ops"."trip"
        ("id", "agencyId", "title", "startDate", "endDate", "state", "lockVersion")
       VALUES ('${randomUUID()}'::uuid, '${agencyId}'::uuid, 'Forbidden version insert', '2026-09-25', '2026-09-28', 'DRAFT', 99)`,
      `SELECT "trip_ops"."touch_workspace_revision"('${agencyId}'::uuid, '${slice.trip.id}'::uuid)`,
      `UPDATE "trip_ops"."workspace_revision_touch"
          SET "lastTransactionId" = pg_catalog.pg_current_xact_id()
        WHERE "agencyId" = '${agencyId}'::uuid
          AND "tripId" = '${slice.trip.id}'::uuid`,
    ];
    for (const statement of deniedStatements) {
      expect(await queryErrorCode(() => queryAs("travelos_admin_api", statement))).toBe("42501");
    }

    const accommodationCall =
      `SELECT "trip_ops"."cas_update_accommodation_presentation"(` +
      `'${agencyId}'::uuid, '${slice.trip.id}'::uuid, '${primaryAccommodation(slice).id}'::uuid, ` +
      `0::bigint, 'forbidden portal edit', 'forbidden')`;
    const supplierCostCall =
      `SELECT "trip_ops"."cas_update_supplier_cost_internal_note"(` +
      `'${agencyId}'::uuid, '${slice.trip.id}'::uuid, '${primaryReservation(slice).id}'::uuid, ` +
      `0::bigint, 'forbidden portal edit')`;
    for (const role of ["travelos_portal_api", "travelos_worker"] as const) {
      for (const statement of [accommodationCall, supplierCostCall]) {
        expect(await queryErrorCode(() => queryAs(role, statement))).toBe("42501");
      }
    }

    const after = await queryAsOwner<{ readonly revision: string }>(
      `SELECT "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" = '${slice.trip.id}'::uuid
          AND "agencyId" = '${agencyId}'::uuid`,
    );
    expect(after[0]?.revision).toBe(before[0]?.revision);
  });

  it("ignores a forged transaction-local marker while deduplicating multiple relevant edits", async () => {
    const input = baseInput();
    const seeded = await createM1TripSlice(repository, {
      ...input,
      trip: { ...input.trip, title: "Revision marker spoof qualification" },
    });
    const accommodation = primaryAccommodation(seeded);
    const markerName = `travelos.revision_touch_${createHash("md5")
      .update(`${agencyId}:${seeded.trip.id}`)
      .digest("hex")}`;
    const client = await clientFor("travelos_admin_api");
    let expectedLockVersion = accommodation.lockVersion;
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_catalog.set_config($1::text, pg_catalog.txid_current()::text, true)",
        [markerName],
      );
      for (const [title, description] of [
        ["Marker spoof first edit", "First same-transaction change"],
        ["Marker spoof second edit", "Second same-transaction change"],
      ] as const) {
        const result = await client.query<{ readonly updated: boolean }>(
          `SELECT "trip_ops"."cas_update_accommodation_presentation"(
             $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::text, $6::text
           ) AS "updated"`,
          [
            agencyId,
            seeded.trip.id,
            accommodation.id,
            expectedLockVersion.toString(),
            title,
            description,
          ],
        );
        expect(result.rows[0]?.updated).toBe(true);
        expectedLockVersion += 1n;
      }

      const customerPersonResult = await client.query(
        `UPDATE "crm"."customer_person"
            SET "role" = "role"
          WHERE "agencyId" = $1::uuid
            AND "customerId" = $2::uuid
            AND "personId" = $3::uuid
            AND "role" = 'PRIMARY_CONTACT'`,
        [agencyId, seeded.customerPerson.customerId, seeded.customerPerson.personId],
      );
      expect(customerPersonResult.rowCount).toBe(1);

      const travellerResult = await client.query(
        `UPDATE "trip_ops"."trip_traveller"
            SET "role" = "role"
          WHERE "agencyId" = $1::uuid AND "tripId" = $2::uuid AND "id" = $3::uuid`,
        [agencyId, seeded.trip.id, seeded.traveller.id],
      );
      expect(travellerResult.rowCount).toBe(1);

      const reservationItemLink = seeded.reservationItemLinks[0];
      if (reservationItemLink === undefined) {
        throw new Error("The marker-spoof Trip fixture has no Reservation–Item link");
      }
      const reservationLinkResult = await client.query(
        `UPDATE "trip_ops"."reservation_item_link"
            SET "linkRole" = "linkRole"
          WHERE "agencyId" = $1::uuid
            AND "tripId" = $2::uuid
            AND "reservationId" = $3::uuid
            AND "itineraryItemId" = $4::uuid`,
        [
          agencyId,
          seeded.trip.id,
          reservationItemLink.reservationId,
          reservationItemLink.itineraryItemId,
        ],
      );
      expect(reservationLinkResult.rowCount).toBe(1);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }

    const projected = await readM1TripSlice(repository, agencyId, seeded.trip.id);
    if (projected === null) throw new Error("The marker-spoof Trip fixture was not readable");
    expect(projected.trip.workspaceRevision).toBe(seeded.trip.workspaceRevision + 1n);
    expect(primaryAccommodation(projected).lockVersion).toBe(accommodation.lockVersion + 2n);
    expect(primaryAccommodation(projected).title).toBe("Marker spoof second edit");
  });

  it("increments an Admin-created Trip despite a forged transaction-local revision marker", async () => {
    const input = baseInput();
    const seeded = await createM1TripSlice(repository, {
      ...input,
      trip: { ...input.trip, title: "Trip insert marker spoof qualification" },
    });
    const tripId = randomUUID();
    const travellerId = randomUUID();
    const markerName = `travelos.revision_touch_${createHash("md5")
      .update(`${agencyId}:${tripId}`)
      .digest("hex")}`;
    const client = await clientFor("travelos_admin_api");
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_catalog.set_config($1::text, pg_catalog.txid_current()::text, true)",
        [markerName],
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip"
          ("id", "agencyId", "title", "startDate", "endDate", "state")
         VALUES ($1::uuid, $2::uuid, $3::text, $4::date, $5::date, $6::text)`,
        [tripId, agencyId, "Forged marker Trip", "2026-09-25", "2026-09-28", "DRAFT"],
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip_traveller"
          ("id", "agencyId", "tripId", "personId", "role")
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'PRIMARY_TRAVELLER')`,
        [travellerId, agencyId, tripId, seeded.person.id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }

    const rows = await queryAsOwner<{ readonly revision: string }>(
      `SELECT "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" = ${sqlLiteral(tripId)}::uuid
          AND "agencyId" = ${sqlLiteral(agencyId)}::uuid`,
    );
    expect(rows[0]?.revision).toBe("1");
  });

  it("serializes continuity writes under READ COMMITTED and REPEATABLE READ", async () => {
    for (const isolation of ["READ COMMITTED", "REPEATABLE READ"] as const) {
      const personId = randomUUID();
      const customerId = randomUUID();
      const tripId = randomUUID();
      const travellerId = randomUUID();
      await withOwnerTransaction(async (client) => {
        await client.query(
          `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
           VALUES ('${personId}'::uuid, '${agencyId}'::uuid, 'Concurrent', '${isolation.replaceAll(" ", "")}')`,
        );
        await client.query(
          `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
           VALUES ('${customerId}'::uuid, '${agencyId}'::uuid, 'Concurrent customer ${isolation}')`,
        );
        await client.query(
          `INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
           VALUES ('${agencyId}'::uuid, '${customerId}'::uuid, '${personId}'::uuid, 'PRIMARY_CONTACT', true)`,
        );
      });

      const firstClient = await clientFor("travelos_migrator");
      const secondClient = await clientFor("travelos_migrator");
      let secondInsertError: unknown = null;
      let secondCommitError: unknown = null;
      try {
        await Promise.all([
          firstClient.query('SET ROLE "travelos_owner"'),
          secondClient.query('SET ROLE "travelos_owner"'),
        ]);
        await Promise.all([firstClient.query("BEGIN"), secondClient.query("BEGIN")]);
        await Promise.all([
          firstClient.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`),
          secondClient.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`),
        ]);
        await Promise.all([
          firstClient.query(
            `SELECT count(*) FROM "trip_ops"."trip_traveller" WHERE "personId" = '${personId}'::uuid`,
          ),
          secondClient.query(
            `SELECT count(*) FROM "trip_ops"."trip_traveller" WHERE "personId" = '${personId}'::uuid`,
          ),
        ]);
        await firstClient.query(
          `DELETE FROM "crm"."customer_person"
            WHERE "agencyId" = '${agencyId}'::uuid
              AND "customerId" = '${customerId}'::uuid
              AND "personId" = '${personId}'::uuid`,
        );
        await secondClient.query(
          `INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
           VALUES ('${tripId}'::uuid, '${agencyId}'::uuid, 'Concurrent trip ${isolation}', '2026-09-25', '2026-09-28', 'DRAFT')`,
        );
        const secondPid = Number(
          (await secondClient.query<{ readonly pid: number }>("SELECT pg_backend_pid() AS pid"))
            .rows[0]?.pid,
        );
        const secondInsert = secondClient
          .query(
            `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
             VALUES ('${travellerId}'::uuid, '${agencyId}'::uuid, '${tripId}'::uuid, '${personId}'::uuid, 'PRIMARY_TRAVELLER')`,
          )
          .catch((error: unknown) => {
            secondInsertError = error;
          });
        let observedBlocking = false;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const blocking = await firstClient.query<{ readonly blocked: boolean }>(
            `SELECT cardinality(pg_blocking_pids(${secondPid})) > 0 AS "blocked"`,
          );
          if (blocking.rows[0]?.blocked === true) {
            observedBlocking = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(observedBlocking).toBe(true);
        await firstClient.query("COMMIT");
        await secondInsert;
        if (secondInsertError === null) {
          await secondClient.query("COMMIT").catch((error: unknown) => {
            secondCommitError = error;
          });
        }
        expect(
          (secondInsertError as { readonly code?: string } | null)?.code ??
            (secondCommitError as { readonly code?: string } | null)?.code,
        ).toMatch(/^(?:23514|40001)$/u);
        await secondClient.query("ROLLBACK").catch(() => undefined);
      } finally {
        await firstClient.query("ROLLBACK").catch(() => undefined);
        await secondClient.query("ROLLBACK").catch(() => undefined);
        await firstClient.end();
        await secondClient.end();
      }
      const invalidRows = await queryAsOwner<{ readonly count: string }>(
        `SELECT count(*)::text AS "count"
           FROM "trip_ops"."trip_traveller" AS traveller
          WHERE traveller."tripId" = '${tripId}'::uuid
            AND traveller."role" = 'PRIMARY_TRAVELLER'
            AND NOT EXISTS (
              SELECT 1 FROM "crm"."customer_person" AS relationship
               WHERE relationship."agencyId" = traveller."agencyId"
                 AND relationship."personId" = traveller."personId"
                 AND relationship."isPrimary" = true
            )`,
      );
      expect(invalidRows).toEqual([{ count: "0" }]);
    }
  });

  it("increments both workspace revisions when a child moves between trips", async () => {
    const secondTripId = randomUUID();
    const secondTripPersonId = randomUUID();
    const secondTripTravellerId = randomUUID();
    const movablePersonId = randomUUID();
    const movableTravellerId = randomUUID();
    await insertTripWithPrimary({
      tripId: secondTripId,
      personId: secondTripPersonId,
      travellerId: secondTripTravellerId,
      title: "Revision reassignment trip",
    });
    await queryAsOwner(
      `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
       VALUES ('${movablePersonId}'::uuid, '${agencyId}'::uuid, 'Movable', 'Traveller')`,
    );
    await queryAsOwner(
      `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
       VALUES ('${movableTravellerId}'::uuid, '${agencyId}'::uuid, '${slice.trip.id}'::uuid, '${movablePersonId}'::uuid, 'TRAVELLER')`,
    );
    const before = await queryAsOwner<{ readonly id: string; readonly revision: string }>(
      `SELECT "id"::text AS "id", "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" IN ('${slice.trip.id}'::uuid, '${secondTripId}'::uuid)
        ORDER BY "id"`,
    );
    await queryAsOwner(
      `UPDATE "trip_ops"."trip_traveller"
          SET "tripId" = '${secondTripId}'::uuid
        WHERE "id" = '${movableTravellerId}'::uuid`,
    );
    const after = await queryAsOwner<{ readonly id: string; readonly revision: string }>(
      `SELECT "id"::text AS "id", "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" IN ('${slice.trip.id}'::uuid, '${secondTripId}'::uuid)
        ORDER BY "id"`,
    );
    const beforeById = new Map(before.map((row) => [row.id, BigInt(row.revision)]));
    expect(after).toHaveLength(2);
    for (const row of after) expect(BigInt(row.revision)).toBe(beforeById.get(row.id)! + 1n);
  });

  it("maps a real repeatable-read SQLSTATE 40001 to an M1 optimistic conflict", async () => {
    const firstClient = await clientFor("travelos_migrator");
    const secondClient = await clientFor("travelos_migrator");
    let secondError: unknown = null;
    try {
      await Promise.all([
        firstClient.query('SET ROLE "travelos_owner"'),
        secondClient.query('SET ROLE "travelos_owner"'),
      ]);
      await Promise.all([firstClient.query("BEGIN"), secondClient.query("BEGIN")]);
      await Promise.all([
        firstClient.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"),
        secondClient.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"),
      ]);
      await Promise.all([
        firstClient.query(
          `SELECT "lockVersion" FROM "finance"."supplier_cost_line" WHERE "id" = '${primarySupplierCost(slice).id}'::uuid`,
        ),
        secondClient.query(
          `SELECT "lockVersion" FROM "finance"."supplier_cost_line" WHERE "id" = '${primarySupplierCost(slice).id}'::uuid`,
        ),
      ]);
      await firstClient.query(
        `UPDATE "finance"."supplier_cost_line"
            SET "internalNote" = 'Serialization winner', "lockVersion" = "lockVersion" + 1
          WHERE "id" = '${primarySupplierCost(slice).id}'::uuid`,
      );
      const blockedUpdate = secondClient.query(
        `UPDATE "finance"."supplier_cost_line"
            SET "internalNote" = 'Serialization loser', "lockVersion" = "lockVersion" + 1
          WHERE "id" = '${primarySupplierCost(slice).id}'::uuid`,
      );
      await firstClient.query("COMMIT");
      await blockedUpdate.catch((error: unknown) => {
        secondError = error;
      });
      expect((secondError as { readonly code?: string } | null)?.code).toBe("40001");
      expect(mapPostgresMutationError(secondError)).toBeInstanceOf(M1OptimisticConflictError);
      await secondClient.query("ROLLBACK");
    } finally {
      await firstClient.query("ROLLBACK").catch(() => undefined);
      await secondClient.query("ROLLBACK").catch(() => undefined);
      await firstClient.end();
      await secondClient.end();
    }
  });

  it("maps a real PostgreSQL deadlock SQLSTATE 40P01 through repository and HTTP as an M1 transaction conflict", async () => {
    const predecessor = upgradedSlice;
    if (predecessor === null || predecessor.trip.id === slice.trip.id) {
      throw new Error("Two distinct Trip rows are required for the deadlock fixture");
    }
    const firstClient = await clientFor("travelos_migrator");
    const secondClient = await clientFor("travelos_migrator");
    let firstWaitError: unknown = null;
    let deadlockError: unknown = null;
    let firstWait: Promise<void> | null = null;
    try {
      await Promise.all([
        firstClient.query('SET ROLE "travelos_owner"'),
        secondClient.query('SET ROLE "travelos_owner"'),
      ]);
      await Promise.all([firstClient.query("BEGIN"), secondClient.query("BEGIN")]);
      await firstClient.query(
        `SELECT "id" FROM "trip_ops"."trip" WHERE "id" = $1::uuid FOR UPDATE`,
        [slice.trip.id],
      );
      await secondClient.query(
        `SELECT "id" FROM "trip_ops"."trip" WHERE "id" = $1::uuid FOR UPDATE`,
        [predecessor.trip.id],
      );
      const firstPid = Number(
        (await firstClient.query<{ readonly pid: number }>("SELECT pg_backend_pid() AS pid"))
          .rows[0]?.pid,
      );
      firstWait = firstClient
        .query(`SELECT "id" FROM "trip_ops"."trip" WHERE "id" = $1::uuid FOR UPDATE`, [
          predecessor.trip.id,
        ])
        .then(() => undefined)
        .catch((error: unknown) => {
          firstWaitError = error;
        });
      let observedBlocking = false;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const blocking = await secondClient.query<{ readonly blocked: boolean }>(
          `SELECT cardinality(pg_blocking_pids($1::integer)) > 0 AS "blocked"`,
          [firstPid],
        );
        if (blocking.rows[0]?.blocked === true) {
          observedBlocking = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(observedBlocking).toBe(true);
      await secondClient
        .query(`SELECT "id" FROM "trip_ops"."trip" WHERE "id" = $1::uuid FOR UPDATE`, [
          slice.trip.id,
        ])
        .catch((error: unknown) => {
          deadlockError = error;
        });
      await firstWait;
      const deadlockVictim = deadlockError ?? firstWaitError;
      expect((deadlockVictim as { readonly code?: string } | null)?.code).toBe("40P01");
      expect([deadlockError, firstWaitError].filter((error) => error !== null)).toHaveLength(1);
      expect(mapPostgresMutationError(deadlockVictim)).toBeInstanceOf(M1TransactionConflictError);
      const deadlockRepository = createM1OperationalSliceRepository({
        transaction: {
          runInTransaction: async () => {
            throw deadlockVictim;
          },
        },
      } as unknown as Parameters<typeof createM1OperationalSliceRepository>[0]);
      const deadlockInput = {
        agencyId,
        tripId: slice.trip.id,
        reservationId: primaryReservation(slice).id,
        expectedLockVersion: 0n,
        internalNote: "Deadlock mapping",
      };
      await expect(
        deadlockRepository.updateInternalSupplierNote(
          deadlockInput as unknown as Parameters<
            typeof deadlockRepository.updateInternalSupplierNote
          >[0],
          authorizationFor(agencyId, M1_INTERNAL_NOTE_PERMISSION_IDS),
        ),
      ).rejects.toBeInstanceOf(M1TransactionConflictError);

      const session = staffSessions.get(agencyId);
      if (session === undefined) {
        throw new Error("The deadlock-to-HTTP qualification requires a Staff session fixture");
      }
      const expectedHost = "admin-stage5-deadlock.example.test";
      const deadlockRealm: AuthRealm = {
        kind: "STAFF",
        basePath: STAFF_AUTH_BASE_PATH,
        cookieName: "travelos-stage5-deadlock-session",
        secureTransportRequired: false,
        async handle() {
          return new Response(null, { status: 404 });
        },
        async getServerSession() {
          return null;
        },
      };
      const deadlockM1Operations = createM1StaffTripOperations({
        repository: deadlockRepository as unknown as Parameters<
          typeof createM1StaffTripOperations
        >[0]["repository"],
        authorizationRepository: staffAccessRepository,
        sessionResolver: {
          async resolveStaffSession() {
            return session;
          },
        },
      });
      const application = await createAdminApi({
        expectedHost,
        auth: {
          realm: deadlockRealm,
          policy: { canonicalOrigin: `http://${expectedHost}`, expectedHost },
          staffAccessRepository,
          m1Operations: deadlockM1Operations as unknown as NonNullable<
            NonNullable<Parameters<typeof createAdminApi>[0]["auth"]>["m1Operations"]
          >,
        },
      });
      try {
        const response = await request(application.getHttpServer())
          .patch(`/api/admin/reservations/${primaryReservation(slice).id}/internal-note`)
          .set("Host", expectedHost)
          .set("Origin", `http://${expectedHost}`)
          .set("Cookie", "travelos-stage5-deadlock-session=opaque")
          .send({
            agencyId,
            tripId: slice.trip.id,
            reservationId: primaryReservation(slice).id,
            expectedLockVersion: "0",
            internalNote: "Deadlock mapping",
          })
          .expect(409);
        expect(response.body).toEqual({ error: "transaction_conflict" });
        expect(response.headers["cache-control"]).toBe("private, no-store");
      } finally {
        await application.close();
      }
      if (firstWaitError !== null) {
        await secondClient.query("COMMIT");
      } else {
        await firstClient.query("COMMIT");
      }
    } finally {
      await firstClient.query("ROLLBACK").catch(() => undefined);
      await secondClient.query("ROLLBACK").catch(() => undefined);
      await firstWait;
      await firstClient.end();
      await secondClient.end();
    }
  });

  it("increments both workspace revisions when a dependency-free reservation moves between trips", async () => {
    const sourceTripId = randomUUID();
    const targetTripId = randomUUID();
    const reservationId = randomUUID();
    await insertTripWithPrimary({
      tripId: sourceTripId,
      personId: randomUUID(),
      travellerId: randomUUID(),
      title: "Reservation source",
    });
    await insertTripWithPrimary({
      tripId: targetTripId,
      personId: randomUUID(),
      travellerId: randomUUID(),
      title: "Reservation target",
    });
    await queryAsOwner(
      `INSERT INTO "trip_ops"."reservation"
        ("id", "agencyId", "tripId", "supplierName", "supplierReference", "customerBookingReference", "state")
       VALUES ('${reservationId}'::uuid, '${agencyId}'::uuid, '${sourceTripId}'::uuid, 'Move Supplier', 'MOVE-1', NULL, 'CONFIRMED')`,
    );
    const before = await queryAsOwner<{ readonly id: string; readonly revision: string }>(
      `SELECT "id"::text AS "id", "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" IN ('${sourceTripId}'::uuid, '${targetTripId}'::uuid)
        ORDER BY "id"`,
    );
    await queryAsOwner(
      `UPDATE "trip_ops"."reservation"
          SET "tripId" = '${targetTripId}'::uuid
        WHERE "id" = '${reservationId}'::uuid`,
    );
    const after = await queryAsOwner<{ readonly id: string; readonly revision: string }>(
      `SELECT "id"::text AS "id", "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" IN ('${sourceTripId}'::uuid, '${targetTripId}'::uuid)
        ORDER BY "id"`,
    );
    const beforeById = new Map(before.map((row) => [row.id, BigInt(row.revision)]));
    expect(after).toHaveLength(2);
    for (const row of after) expect(BigInt(row.revision)).toBe(beforeById.get(row.id)! + 1n);
  });

  it("serializes concurrent opposite-direction child moves without a revision deadlock", async () => {
    const leftTripId = "00000000-0000-7000-8000-000000000010";
    const rightTripId = "00000000-0000-7000-8000-000000000011";
    const leftPrimaryPersonId = randomUUID();
    const rightPrimaryPersonId = randomUUID();
    const leftPrimaryTravellerId = randomUUID();
    const rightPrimaryTravellerId = randomUUID();
    const leftPersonId = randomUUID();
    const rightPersonId = randomUUID();
    const leftTravellerId = randomUUID();
    const rightTravellerId = randomUUID();
    await insertTripWithPrimary({
      tripId: leftTripId,
      personId: leftPrimaryPersonId,
      travellerId: leftPrimaryTravellerId,
      title: "Concurrent left",
    });
    await insertTripWithPrimary({
      tripId: rightTripId,
      personId: rightPrimaryPersonId,
      travellerId: rightPrimaryTravellerId,
      title: "Concurrent right",
    });
    await queryAsOwner(
      `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
       VALUES
         ('${leftPersonId}'::uuid, '${agencyId}'::uuid, 'Left', 'Traveller'),
         ('${rightPersonId}'::uuid, '${agencyId}'::uuid, 'Right', 'Traveller')`,
    );
    await queryAsOwner(
      `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
       VALUES
         ('${leftTravellerId}'::uuid, '${agencyId}'::uuid, '${leftTripId}'::uuid, '${leftPersonId}'::uuid, 'TRAVELLER'),
         ('${rightTravellerId}'::uuid, '${agencyId}'::uuid, '${rightTripId}'::uuid, '${rightPersonId}'::uuid, 'TRAVELLER')`,
    );
    const beforeRevisions = await queryAsOwner<{
      readonly id: string;
      readonly workspaceRevision: string;
      readonly lockVersion: string;
    }>(
      `SELECT "id"::text AS "id", "workspaceRevision"::text AS "workspaceRevision", "lockVersion"
         FROM "trip_ops"."trip"
        WHERE "id" IN ('${leftTripId}'::uuid, '${rightTripId}'::uuid)`,
    );

    const leftClient = await clientFor("travelos_migrator");
    const rightClient = await clientFor("travelos_migrator");
    try {
      await Promise.all([
        leftClient.query('SET ROLE "travelos_owner"'),
        rightClient.query('SET ROLE "travelos_owner"'),
      ]);
      await leftClient.query("BEGIN");
      await leftClient.query("SET LOCAL lock_timeout = '2s'");
      await leftClient.query(
        `UPDATE "trip_ops"."trip_traveller"
            SET "tripId" = '${rightTripId}'::uuid
          WHERE "id" = '${leftTravellerId}'::uuid`,
      );
      await rightClient.query("BEGIN");
      await rightClient.query("SET LOCAL lock_timeout = '2s'");
      const rightPid = Number(
        (await rightClient.query<{ readonly pid: number }>("SELECT pg_backend_pid() AS pid"))
          .rows[0]?.pid,
      );
      const rightMove = rightClient.query(
        `UPDATE "trip_ops"."trip_traveller"
            SET "tripId" = '${leftTripId}'::uuid
          WHERE "id" = '${rightTravellerId}'::uuid`,
      );
      let observedBlocking = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const blocking = await leftClient.query<{ readonly blocked: boolean }>(
          `SELECT cardinality(pg_blocking_pids(${rightPid})) > 0 AS "blocked"`,
        );
        if (blocking.rows[0]?.blocked === true) {
          observedBlocking = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(observedBlocking).toBe(true);
      await leftClient.query("COMMIT");
      await rightMove;
      await rightClient.query("COMMIT");
    } finally {
      await leftClient.query("ROLLBACK").catch(() => undefined);
      await rightClient.query("ROLLBACK").catch(() => undefined);
      await leftClient.end();
      await rightClient.end();
    }
    const moved = await queryAsOwner<{ readonly id: string; readonly tripId: string }>(
      `SELECT "id"::text AS "id", "tripId"::text AS "tripId"
         FROM "trip_ops"."trip_traveller"
        WHERE "id" IN ('${leftTravellerId}'::uuid, '${rightTravellerId}'::uuid)
        ORDER BY "id"`,
    );
    expect(new Map(moved.map((row) => [row.id, row.tripId]))).toEqual(
      new Map([
        [leftTravellerId, rightTripId],
        [rightTravellerId, leftTripId],
      ]),
    );

    const afterRevisions = await queryAsOwner<{
      readonly id: string;
      readonly workspaceRevision: string;
      readonly lockVersion: string;
    }>(
      `SELECT "id"::text AS "id", "workspaceRevision"::text AS "workspaceRevision", "lockVersion"
         FROM "trip_ops"."trip"
        WHERE "id" IN ('${leftTripId}'::uuid, '${rightTripId}'::uuid)`,
    );
    const beforeById = new Map(beforeRevisions.map((row) => [row.id, row]));
    expect(afterRevisions).toHaveLength(2);
    for (const row of afterRevisions) {
      const before = beforeById.get(row.id);
      expect(before).toBeDefined();
      expect(BigInt(row.workspaceRevision)).toBe(BigInt(before!.workspaceRevision) + 2n);
      expect(row.lockVersion).toBe(before!.lockVersion);
    }
  });

  it("persists and reads plural typed itinerary items, reservations and many-to-many links", async () => {
    const input = baseInput();
    const seeded = await createM1TripSlice(repository, {
      ...input,
      trip: { ...input.trip, title: "Plural cardinality qualification" },
    });
    const secondFlightId = randomUUID();
    const secondAccommodationId = randomUUID();
    const secondReservationId = randomUUID();
    const thirdReservationId = randomUUID();
    const secondReservationReference = `SUP-${randomUUID()}`;
    const thirdReservationReference = `SUP-${randomUUID()}`;

    await withOwnerTransaction(async (client) => {
      await client.query(
        `INSERT INTO "trip_ops"."itinerary_item"
           ("id", "agencyId", "tripId", "family", "state", "sortOrder", "customerTitle", "customerDescription")
         VALUES
           ($1::uuid, $2::uuid, $3::uuid, 'FLIGHT', 'CONFIRMED', 3, 'Return flight', 'Synthetic return flight'),
           ($4::uuid, $2::uuid, $3::uuid, 'ACCOMMODATION', 'CONFIRMED', 4, 'Second hotel', 'Synthetic second stay')`,
        [secondFlightId, agencyId, seeded.trip.id, secondAccommodationId],
      );
      await client.query(
        `INSERT INTO "trip_ops"."flight_item_detail"
           ("agencyId", "tripId", "itemId", "carrier", "flightNumber", "departureAirport", "arrivalAirport",
            "departureDate", "departureTime", "departureTimezone", "departureInstant", "arrivalDate", "arrivalTime",
            "arrivalTimezone", "arrivalInstant")
         VALUES
           ($1::uuid, $2::uuid, $3::uuid, 'Example Air', 'EA200', 'LIS', 'MAD',
            '2026-09-25', '11:00', 'Europe/Lisbon', '2026-09-25T10:00:00Z', '2026-09-25', '12:30',
            'Europe/Lisbon', '2026-09-25T11:30:00Z')`,
        [agencyId, seeded.trip.id, secondFlightId],
      );
      await client.query(
        `INSERT INTO "trip_ops"."accommodation_item_detail"
           ("agencyId", "tripId", "itemId", "propertyName", "checkInDate", "checkInTime", "checkInTimezone", "checkInInstant",
            "checkOutDate", "checkOutTime", "checkOutTimezone", "checkOutInstant")
         VALUES
           ($1::uuid, $2::uuid, $3::uuid, 'Example Inn', '2026-09-25', '16:00', 'Europe/Lisbon', '2026-09-25T15:00:00Z',
            '2026-09-27', '10:00', 'Europe/Lisbon', '2026-09-27T09:00:00Z')`,
        [agencyId, seeded.trip.id, secondAccommodationId],
      );
      await client.query(
        `INSERT INTO "trip_ops"."reservation"
           ("id", "agencyId", "tripId", "supplierName", "supplierReference", "state")
         VALUES
           ($1::uuid, $2::uuid, $3::uuid, 'Example Supplier', $4, 'CONFIRMED'),
           ($5::uuid, $2::uuid, $3::uuid, 'Example Supplier', $6, 'CONFIRMED')`,
        [
          secondReservationId,
          agencyId,
          seeded.trip.id,
          secondReservationReference,
          thirdReservationId,
          thirdReservationReference,
        ],
      );
      await client.query(
        `INSERT INTO "trip_ops"."reservation_item_link"
           ("agencyId", "tripId", "reservationId", "itineraryItemId", "linkRole")
         VALUES
           ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'PRIMARY'),
           ($1::uuid, $2::uuid, $5::uuid, $6::uuid, 'PRIMARY'),
           ($1::uuid, $2::uuid, $5::uuid, $4::uuid, 'SECONDARY')`,
        [
          agencyId,
          seeded.trip.id,
          secondReservationId,
          secondFlightId,
          thirdReservationId,
          primaryFlight(seeded).id,
        ],
      );
    });

    const projected = await readM1TripSlice(repository, agencyId, seeded.trip.id);
    if (projected === null) throw new Error("Plural qualification Trip was not readable");
    const plural = projected;
    expect(plural.flights.map((item) => [item.id, item.sortOrder])).toEqual([
      [primaryFlight(seeded).id, 1],
      [secondFlightId, 3],
    ]);
    expect(plural.accommodations.map((item) => [item.id, item.sortOrder])).toEqual([
      [primaryAccommodation(seeded).id, 2],
      [secondAccommodationId, 4],
    ]);
    const expectedReservationRows = await queryAsOwner<{ readonly id: string }>(
      `SELECT "id"::text AS "id"
         FROM "trip_ops"."reservation"
        WHERE "agencyId" = '${agencyId}'::uuid AND "tripId" = '${seeded.trip.id}'::uuid
        ORDER BY "createdAt", "id"`,
    );
    expect(plural.reservations.map((reservation) => reservation.id)).toEqual(
      expectedReservationRows.map((reservation) => reservation.id),
    );
    expect(plural.reservations).toHaveLength(3);
    const expectedLinkRows = await queryAsOwner<{
      readonly reservationId: string;
      readonly itineraryItemId: string;
    }>(
      `SELECT "reservationId"::text AS "reservationId", "itineraryItemId"::text AS "itineraryItemId"
         FROM "trip_ops"."reservation_item_link"
        WHERE "agencyId" = '${agencyId}'::uuid AND "tripId" = '${seeded.trip.id}'::uuid
        ORDER BY "reservationId", "itineraryItemId"`,
    );
    expect(
      plural.reservationItemLinks.map(({ reservationId, itineraryItemId }) => ({
        reservationId,
        itineraryItemId,
      })),
    ).toEqual(expectedLinkRows);
    expect(plural.reservationItemLinks).toHaveLength(5);
    const linkedItemIdsForFirstReservation = new Set(
      plural.reservationItemLinks
        .filter((link) => link.reservationId === primaryReservation(seeded).id)
        .map((link) => link.itineraryItemId),
    );
    expect(linkedItemIdsForFirstReservation).toEqual(
      new Set([primaryFlight(seeded).id, primaryAccommodation(seeded).id]),
    );
    expect(
      plural.reservationItemLinks.filter(
        (link) => link.itineraryItemId === primaryFlight(seeded).id,
      ),
    ).toHaveLength(2);
    expect(plural.supplierCosts.map((cost) => cost.reservationId)).toEqual([
      primaryReservation(seeded).id,
    ]);
    expect(plural.traveller.role).toBe("PRIMARY_TRAVELLER");

    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `INSERT INTO "trip_ops"."reservation_item_link"
             ("agencyId", "tripId", "reservationId", "itineraryItemId", "linkRole")
           VALUES ('${agencyId}'::uuid, '${seeded.trip.id}'::uuid, '${primaryReservation(seeded).id}'::uuid,
                   '${randomUUID()}'::uuid, 'PRIMARY')`,
        ),
      ),
    ).toBe("reservation_link_item_trip_fk");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `INSERT INTO "trip_ops"."reservation_item_link"
             ("agencyId", "tripId", "reservationId", "itineraryItemId", "linkRole")
           VALUES ('${agencyId}'::uuid, '${seeded.trip.id}'::uuid, '${randomUUID()}'::uuid,
                   '${primaryFlight(seeded).id}'::uuid, 'PRIMARY')`,
        ),
      ),
    ).toBe("reservation_link_reservation_trip_fk");
    expect(
      await queryErrorCode(() =>
        withOwnerTransaction(async (client) => {
          await client.query(
            `INSERT INTO "trip_ops"."itinerary_item"
               ("id", "agencyId", "tripId", "family", "state", "sortOrder", "customerTitle", "customerDescription")
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'FLIGHT', 'DRAFT', 5, 'Incomplete flight', 'No detail row')`,
            [randomUUID(), agencyId, seeded.trip.id],
          );
        }),
      ),
    ).toBe("P0001");
    expect(
      await queryErrorCode(() =>
        withOwnerTransaction(async (client) => {
          await client.query(
            `INSERT INTO "trip_ops"."itinerary_item"
               ("id", "agencyId", "tripId", "family", "state", "sortOrder", "customerTitle", "customerDescription")
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'ACCOMMODATION', 'DRAFT', 6, 'Incomplete hotel', 'No detail row')`,
            [randomUUID(), agencyId, seeded.trip.id],
          );
        }),
      ),
    ).toBe("P0001");
  });

  it("enforces the four-digit temporal contract at the PostgreSQL boundary", async () => {
    const input = baseInput();
    const temporalSlice = await createM1TripSlice(repository, {
      ...input,
      trip: { ...input.trip, title: "Temporal calendar-boundary qualification" },
    });
    const flightId = primaryFlight(temporalSlice).id;
    const accommodationId = primaryAccommodation(temporalSlice).id;
    const tripId = temporalSlice.trip.id;

    const datesFor = async () =>
      queryAsOwner<{ readonly startDate: string; readonly endDate: string }>(
        `SELECT "startDate"::text AS "startDate", "endDate"::text AS "endDate"
           FROM "trip_ops"."trip" WHERE "id" = '${tripId}'::uuid`,
      );
    const setTripDate = async (dateLiteral: string) =>
      queryAsOwner(
        `UPDATE "trip_ops"."trip"
            SET "startDate" = DATE '${dateLiteral}', "endDate" = DATE '${dateLiteral}'
          WHERE "id" = '${tripId}'::uuid`,
      );

    await setTripDate("1000-01-01");
    expect(await datesFor()).toEqual([{ startDate: "1000-01-01", endDate: "1000-01-01" }]);
    await setTripDate("9999-12-31");
    expect(await datesFor()).toEqual([{ startDate: "9999-12-31", endDate: "9999-12-31" }]);
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."trip" SET "startDate" = DATE '0999-12-31'
            WHERE "id" = '${tripId}'::uuid`,
        ),
      ),
    ).toBe("trip_date_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."trip" SET "endDate" = DATE '10000-01-01'
            WHERE "id" = '${tripId}'::uuid`,
        ),
      ),
    ).toBe("trip_date_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."trip" SET "endDate" = DATE 'infinity'
            WHERE "id" = '${tripId}'::uuid`,
        ),
      ),
    ).toBe("trip_date_policy");
    expect(await queryErrorCode(() => queryAsOwner("SELECT DATE '2026-02-30'"))).toBe("22008");

    await queryAsOwner(
      `UPDATE "trip_ops"."flight_item_detail"
          SET "departureDate" = DATE '1000-01-01',
              "departureTime" = TIME '00:00:00',
              "departureTimezone" = 'UTC',
              "departureInstant" = TIMESTAMPTZ '1000-01-01 00:00:00+00',
              "arrivalDate" = DATE '1000-01-01',
              "arrivalTime" = TIME '00:00:01',
              "arrivalTimezone" = 'UTC',
              "arrivalInstant" = TIMESTAMPTZ '1000-01-01 00:00:01+00'
        WHERE "itemId" = '${flightId}'::uuid`,
    );
    await queryAsOwner(
      `UPDATE "trip_ops"."flight_item_detail"
          SET "departureDate" = DATE '9999-12-31',
              "departureTime" = TIME '23:59:58',
              "departureTimezone" = 'UTC',
              "departureInstant" = TIMESTAMPTZ '9999-12-31 23:59:58.999+00',
              "arrivalDate" = DATE '9999-12-31',
              "arrivalTime" = TIME '23:59:59',
              "arrivalTimezone" = 'UTC',
              "arrivalInstant" = TIMESTAMPTZ '9999-12-31 23:59:59.999+00'
        WHERE "itemId" = '${flightId}'::uuid`,
    );
    const flightUpperBoundary = await queryAsOwner<{ readonly arrival: string }>(
      `SELECT to_char("arrivalInstant" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "arrival"
         FROM "trip_ops"."flight_item_detail" WHERE "itemId" = '${flightId}'::uuid`,
    );
    expect(flightUpperBoundary[0]?.arrival).toBe("9999-12-31T23:59:59.999");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureInstant" = TIMESTAMPTZ '0999-12-31 23:00:00+00'
            WHERE "itemId" = '${flightId}'::uuid`,
        ),
      ),
    ).toBe("scheduled_instant_calendar_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureInstant" = TIMESTAMPTZ '10000-01-01 00:00:00+00'
            WHERE "itemId" = '${flightId}'::uuid`,
        ),
      ),
    ).toBe("scheduled_instant_calendar_policy");

    await queryAsOwner(
      `UPDATE "trip_ops"."accommodation_item_detail"
          SET "checkInDate" = DATE '1000-01-01',
              "checkInTime" = TIME '00:00:00',
              "checkInTimezone" = 'UTC',
              "checkInInstant" = TIMESTAMPTZ '1000-01-01 00:00:00+00',
              "checkOutDate" = DATE '1000-01-01',
              "checkOutTime" = TIME '00:01:00',
              "checkOutTimezone" = 'UTC',
              "checkOutInstant" = TIMESTAMPTZ '1000-01-01 00:01:00+00'
        WHERE "itemId" = '${accommodationId}'::uuid`,
    );
    await queryAsOwner(
      `UPDATE "trip_ops"."accommodation_item_detail"
          SET "checkInDate" = DATE '9999-12-31',
              "checkInTime" = TIME '23:59:58',
              "checkInTimezone" = 'UTC',
              "checkInInstant" = TIMESTAMPTZ '9999-12-31 23:59:58.999+00',
              "checkOutDate" = DATE '9999-12-31',
              "checkOutTime" = TIME '23:59:59',
              "checkOutTimezone" = 'UTC',
              "checkOutInstant" = TIMESTAMPTZ '9999-12-31 23:59:59.999+00'
        WHERE "itemId" = '${accommodationId}'::uuid`,
    );
    const accommodationUpperBoundary = await queryAsOwner<{ readonly checkOut: string }>(
      `SELECT to_char("checkOutInstant" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "checkOut"
         FROM "trip_ops"."accommodation_item_detail" WHERE "itemId" = '${accommodationId}'::uuid`,
    );
    expect(accommodationUpperBoundary[0]?.checkOut).toBe("9999-12-31T23:59:59.999");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."accommodation_item_detail"
              SET "checkInInstant" = TIMESTAMPTZ '0999-12-31 23:00:00+00'
            WHERE "itemId" = '${accommodationId}'::uuid`,
        ),
      ),
    ).toBe("scheduled_instant_calendar_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."accommodation_item_detail"
              SET "checkOutInstant" = TIMESTAMPTZ '10000-01-01 00:00:00+00'
            WHERE "itemId" = '${accommodationId}'::uuid`,
        ),
      ),
    ).toBe("scheduled_instant_calendar_policy");

    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureDate" = DATE '2026-09-25',
                  "departureTime" = TIME '09:00:00',
                  "departureTimezone" = 'Europe/Lisbon',
                  "departureInstant" = TIMESTAMPTZ '2026-09-25 08:00:00+00',
                  "arrivalDate" = DATE '2026-09-25',
                  "arrivalTime" = TIME '08:00:00',
                  "arrivalTimezone" = 'Europe/Lisbon',
                  "arrivalInstant" = TIMESTAMPTZ '2026-09-25 07:00:00+00'
            WHERE "itemId" = '${flightId}'::uuid`,
        ),
      ),
    ).toBe("flight_time_order");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."accommodation_item_detail"
              SET "checkInDate" = DATE '2026-09-25',
                  "checkInTime" = TIME '15:00:00',
                  "checkInTimezone" = 'Europe/Lisbon',
                  "checkInInstant" = TIMESTAMPTZ '2026-09-25 14:00:00+00',
                  "checkOutDate" = DATE '2026-09-25',
                  "checkOutTime" = TIME '11:00:00',
                  "checkOutTimezone" = 'Europe/Lisbon',
                  "checkOutInstant" = TIMESTAMPTZ '2026-09-25 10:00:00+00'
            WHERE "itemId" = '${accommodationId}'::uuid`,
        ),
      ),
    ).toBe("accommodation_time_order");

    const temporalPolicies = await queryAsOwner<{
      readonly constraintName: string;
      readonly validated: boolean;
    }>(`
      SELECT constraint_row.conname AS "constraintName",
             constraint_row.convalidated AS "validated"
        FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conname IN (
         'trip_date_policy',
         'flight_departure_instant_calendar_policy',
         'flight_arrival_instant_calendar_policy',
         'accommodation_check_instant_calendar_policy',
         'accommodation_check_out_instant_calendar_policy'
       )
       ORDER BY constraint_row.conname
    `);
    expect(temporalPolicies).toHaveLength(5);
    expect(temporalPolicies.every((policy) => policy.validated)).toBe(true);
  });

  it("proves Agency and same-Trip constraints, wrong-family rejection and no float columns", async () => {
    const secondInput = baseInput();
    const secondSlice = await createM1TripSlice(repository, {
      ...secondInput,
      trip: { ...secondInput.trip, title: "Second Stage 5 qualification trip" },
    });
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureTime" = TIME '24:00:00'
            WHERE "itemId" = '${primaryFlight(slice).id}'::uuid`,
        ),
      ),
    ).toBe("flight_local_time_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."accommodation_item_detail"
              SET "checkInTime" = TIME '24:00:00'
            WHERE "itemId" = '${primaryAccommodation(slice).id}'::uuid`,
        ),
      ),
    ).toBe("accommodation_local_time_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureTime" = TIME '09:00:00.001'
            WHERE "itemId" = '${primaryFlight(slice).id}'::uuid`,
        ),
      ),
    ).toBe("flight_local_time_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureInstant" = '2026-09-25T08:00:00.000001Z'::timestamptz
            WHERE "itemId" = '${primaryFlight(slice).id}'::uuid`,
        ),
      ),
    ).toBe("flight_instant_precision_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureTimezone" = 'Mars/Phobos'
            WHERE "itemId" = '${primaryFlight(slice).id}'::uuid`,
        ),
      ),
    ).toBe("scheduled_timezone_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureTimezone" = 'Asia/Kolkata'
            WHERE "itemId" = '${primaryFlight(slice).id}'::uuid`,
        ),
      ),
    ).toBe("scheduled_timezone_policy");
    const canonicalTimezoneLiterals = TRAVELOS_CANONICAL_TIMEZONE_NAMES.map(sqlLiteral).join(", ");
    const persistedTimezoneNames = await queryAsOwner<{ readonly name: string }>(
      `SELECT name
         FROM pg_catalog.pg_timezone_names
        WHERE name IN (${canonicalTimezoneLiterals})`,
    );
    expect(new Set(persistedTimezoneNames.map((row) => row.name))).toEqual(
      new Set(TRAVELOS_CANONICAL_TIMEZONE_NAMES),
    );
    const semanticProbeInstants = ["2026-01-15T12:34:56Z", "2026-07-15T12:34:56Z"] as const;
    const semanticProbeValues = semanticProbeInstants
      .map((instant) => `(${sqlLiteral(instant)}, ${sqlLiteral(instant)}::timestamptz)`)
      .join(", ");
    const semanticRows = await queryAsOwner<{
      readonly name: string;
      readonly instantLabel: string;
      readonly localTuple: string;
    }>(
      `SELECT zones.name,
              instants."instantLabel",
              to_char(instants."instant" AT TIME ZONE zones.name, 'YYYY-MM-DD"T"HH24:MI:SS') AS "localTuple"
         FROM unnest(ARRAY[${canonicalTimezoneLiterals}]::text[]) AS zones(name)
         CROSS JOIN (VALUES ${semanticProbeValues}) AS instants("instantLabel", "instant")`,
    );
    expect(semanticRows).toHaveLength(TRAVELOS_CANONICAL_TIMEZONE_NAMES.length * 2);
    for (const row of semanticRows) {
      expect(row.localTuple).toBe(localPartsForInstant(row.instantLabel, row.name));
    }

    await expect(
      queryAsOwner(
        `SELECT "trip_ops"."assert_scheduled_temporal_tuple"(
          DATE '2026-10-25', TIME '01:30:00', 'Europe/Lisbon',
          TIMESTAMPTZ '2026-10-25T00:30:00Z', 'DST overlap earlier'
        )`,
      ),
    ).resolves.toHaveLength(1);
    await expect(
      queryAsOwner(
        `SELECT "trip_ops"."assert_scheduled_temporal_tuple"(
          DATE '2026-10-25', TIME '01:30:00', 'Europe/Lisbon',
          TIMESTAMPTZ '2026-10-25T01:30:00Z', 'DST overlap later'
        )`,
      ),
    ).resolves.toHaveLength(1);
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `SELECT "trip_ops"."assert_scheduled_temporal_tuple"(
            DATE '2026-03-29', TIME '01:30:00', 'Europe/Lisbon',
            TIMESTAMPTZ '2026-03-29T01:30:00Z', 'DST gap'
          )`,
        ),
      ),
    ).toBe("scheduled_local_tuple_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureTime" = TIME '09:01:00'
            WHERE "itemId" = '${primaryFlight(slice).id}'::uuid`,
        ),
      ),
    ).toBe("scheduled_local_tuple_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."accommodation_item_detail"
              SET "checkOutInstant" = '2026-09-28T10:00:00.000001Z'::timestamptz
            WHERE "itemId" = '${primaryAccommodation(slice).id}'::uuid`,
        ),
      ),
    ).toBe("accommodation_instant_precision_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."accommodation_item_detail"
              SET "checkOutTimezone" = 'Mars/Phobos'
            WHERE "itemId" = '${primaryAccommodation(slice).id}'::uuid`,
        ),
      ),
    ).toBe("scheduled_timezone_policy");
    const supportedOffset = await queryAsOwner<{ readonly instant: string }>(
      `SELECT ('2026-09-25T00:00:00+15:59'::timestamptz AT TIME ZONE 'UTC')::text AS "instant"`,
    );
    expect(supportedOffset[0]?.instant).toBe("2026-09-24 08:01:00");
    expect(
      await queryErrorCode(() => queryAsOwner(`SELECT '2026-09-25T00:00:00+16:00'::timestamptz`)),
    ).toBe("22009");
    expect(
      await queryErrorCode(() =>
        queryAsOwner(
          `INSERT INTO "trip_ops"."reservation_item_link" ("agencyId", "tripId", "reservationId", "itineraryItemId", "linkRole")
           VALUES ('00000000-0000-7000-8000-000000000099'::uuid, '${slice.trip.id}'::uuid, '${primaryReservation(slice).id}'::uuid, '${primaryFlight(slice).id}'::uuid, 'PRIMARY')`,
        ),
      ),
    ).toBe("23503");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `INSERT INTO "trip_ops"."reservation_item_link" ("agencyId", "tripId", "reservationId", "itineraryItemId", "linkRole")
           VALUES ('${agencyId}'::uuid, '${slice.trip.id}'::uuid, '${primaryReservation(secondSlice).id}'::uuid, '${primaryFlight(secondSlice).id}'::uuid, 'PRIMARY')`,
        ),
      ),
    ).toBe("reservation_link_reservation_trip_fk");
    expect(
      await queryErrorCode(() =>
        queryAsOwner(
          `INSERT INTO "trip_ops"."flight_item_detail"
             ("agencyId", "tripId", "itemId", "carrier", "flightNumber", "departureAirport", "arrivalAirport", "departureDate", "departureTime", "departureTimezone", "departureInstant", "arrivalDate", "arrivalTime", "arrivalTimezone", "arrivalInstant")
           VALUES ('${agencyId}'::uuid, '${slice.trip.id}'::uuid, '${primaryAccommodation(slice).id}'::uuid, 'Bad', 'BAD', 'LIS', 'OPO', '2026-09-25', '09:00', 'Europe/Lisbon', '2026-09-25T08:00:00Z', '2026-09-25', '10:00', 'Europe/Lisbon', '2026-09-25T09:00:00Z')`,
        ),
      ),
    ).toBe("P0001");
    expect(
      await queryErrorCode(() =>
        queryAsOwner(
          `INSERT INTO "trip_ops"."accommodation_item_detail"
             ("agencyId", "tripId", "itemId", "propertyName", "checkInDate", "checkInTime", "checkInTimezone", "checkInInstant", "checkOutDate", "checkOutTime", "checkOutTimezone", "checkOutInstant")
           VALUES ('${agencyId}'::uuid, '${slice.trip.id}'::uuid, '${primaryFlight(slice).id}'::uuid,
                   'Wrong-family detail', '2026-09-25', '15:00', 'Europe/Lisbon', '2026-09-25T14:00:00Z',
                   '2026-09-28', '11:00', 'Europe/Lisbon', '2026-09-28T10:00:00Z')`,
        ),
      ),
    ).toBe("P0001");
    const floatColumns = await queryAsOwner<{ readonly dataType: string }>(`
      SELECT format_type(attribute.atttypid, attribute.atttypmod) AS "dataType"
        FROM pg_catalog.pg_attribute AS attribute
        JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname IN ('crm', 'trip_ops', 'finance')
         AND relation.relname IN ('person', 'customer', 'customer_person', 'trip', 'trip_traveller', 'itinerary_item', 'flight_item_detail', 'accommodation_item_detail', 'reservation', 'reservation_item_link', 'supplier_cost_line')
         AND attribute.attnum > 0 AND NOT attribute.attisdropped
         AND format_type(attribute.atttypid, attribute.atttypmod) IN ('real', 'double precision')
    `);
    expect(floatColumns).toHaveLength(0);
  });

  it("denies reads without a current Agency membership", async () => {
    const otherAgency = asOpaqueId("00000000-0000-7000-8000-000000000099");
    const nowEpochMs = Date.now();
    const unassignedAgencyAuthorization: StaffAuthorizationOperationProof = {
      session: {
        staffPrincipalId: primaryStaffFixture.staffPrincipalId,
        agencyId: otherAgency,
        authorizationEpoch: 1n,
        expiresAtEpochMs: nowEpochMs + 60 * 60 * 1_000,
        recentMfaVerifiedAtEpochMs: null,
      },
      requiredPermissionIds: M1_READ_PERMISSION_IDS,
      nowEpochMs,
    };
    await expect(
      readM1TripSliceWithAuthorization(
        repository,
        otherAgency,
        slice.trip.id,
        unassignedAgencyAuthorization,
      ),
    ).rejects.toBeInstanceOf(M1StaffAuthorizationError);
  });
});

export const stage5QualificationFingerprint = createHash("sha256").update("stage5").digest("hex");
