import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, type QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asOpaqueId,
  bootstrapRootAgency,
  createM1TripSlice,
  createMoney,
  M1OptimisticConflictError,
  PERMISSION_REGISTRY_VERSION,
  readM1TripSlice,
  TRAVELOS_CANONICAL_TIMEZONE_NAMES,
  updateM1Accommodation,
  updateM1InternalSupplierNote,
  type CreateM1TripSliceInput,
  type M1TripSlice,
} from "../../packages/backend-core/src/index.js";
import {
  createM1OperationalSliceRepository,
  createPostgresPersistence,
  createStaffAccessRepository,
  mapPostgresMutationError,
  type PostgresPersistence,
} from "../../packages/database/src/index.js";
import {
  inspectMigrationStatus,
  runMigrationChain,
  type MigrationChain,
  type MigrationTarget,
} from "../../tooling/database/migration-runner.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const host = process.env["PGHOST"] ?? "";
const port = Number.parseInt(process.env["PGPORT"] ?? "", 10);
const postgresBin = process.env["TRAVELOS_STAGE5_PG_BIN"] ?? "";
const databaseName = "travelos_stage5_qualification";
const agencyId = asOpaqueId("00000000-0000-4000-8000-000000000001");

const syntheticEmail = ["rui", "example.test"].join(String.fromCharCode(64));

const productionChain: MigrationChain = {
  directory: path.join(repositoryRoot, "migrations"),
  checksumManifestPath: path.join(repositoryRoot, "migrations/checksums.json"),
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
  const migration = await runMigrationChain(migrationTarget, productionChain);
  expect(migration.result).toBe("PASS");
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
});

afterAll(async () => {
  await persistence?.destroy();
});

describe.sequential("TravelOS Stage 5 disposable PostgreSQL qualification", () => {
  it("applies the new migration head and preserves the predecessor isolation boundary", async () => {
    const status = await inspectMigrationStatus(migrationTarget, productionChain);
    expect(status.currentVersion).toBe("0008_stage5_cardinality_only");
    const bootstrapInput = {
      agencyId,
      bootstrapReference: "stage5-qualification",
      slug: "stage5-qualification",
    };
    const firstBootstrap = await bootstrapRootAgency(staffAccessRepository, bootstrapInput);
    expect(firstBootstrap.created).toBe(true);
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
  });

  it("increments workspace revision exactly once for a publication-relevant edit and not for internal-only cost edits", async () => {
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
      primaryAccommodation(slice).lockVersion + 1,
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
    const internal = await updateM1InternalSupplierNote(repository, {
      agencyId,
      tripId: slice.trip.id,
      reservationId: primaryReservation(slice).id,
      expectedLockVersion: primarySupplierCost(slice).lockVersion,
      internalNote: "Updated internal-only note",
    });
    expect(internal.trip.workspaceRevision).toBe(edited.trip.workspaceRevision);
    expect(primarySupplierCost(internal).internalNote).toBe("Updated internal-only note");

    const concurrent = await Promise.allSettled([
      updateM1Accommodation(repository, {
        agencyId,
        tripId: slice.trip.id,
        itemId: primaryAccommodation(slice).id,
        expectedLockVersion: primaryAccommodation(edited).lockVersion,
        title: "Concurrent accommodation A",
        description: "Concurrent description A",
      }),
      updateM1Accommodation(repository, {
        agencyId,
        tripId: slice.trip.id,
        itemId: primaryAccommodation(slice).id,
        expectedLockVersion: primaryAccommodation(edited).lockVersion,
        title: "Concurrent accommodation B",
        description: "Concurrent description B",
      }),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = concurrent.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toBeInstanceOf(
      M1OptimisticConflictError,
    );
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

  it("rejects direct workspace revision assignment through the actual Admin API login role", async () => {
    expect(
      await queryErrorCode(() =>
        queryAs(
          "travelos_admin_api",
          `UPDATE "trip_ops"."trip"
              SET "workspaceRevision" = 0
            WHERE "id" = '${slice.trip.id}'::uuid
              AND "agencyId" = '${agencyId}'::uuid`,
        ),
      ),
    ).toBe("42501");
    expect(
      await queryErrorCode(() =>
        queryAs(
          "travelos_admin_api",
          `INSERT INTO "trip_ops"."trip"
            ("id", "agencyId", "title", "startDate", "endDate", "state", "workspaceRevision")
           VALUES ('${randomUUID()}'::uuid, '${agencyId}'::uuid, 'Forbidden revision insert', '2026-09-25', '2026-09-28', 'DRAFT', 99)`,
        ),
      ),
    ).toBe("42501");
    const currentTrip = await queryAsOwner<{ readonly revision: string }>(
      `SELECT "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" = '${slice.trip.id}'::uuid
          AND "agencyId" = '${agencyId}'::uuid`,
    );
    expect(BigInt(currentTrip[0]!.revision)).toBeGreaterThan(0n);
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
    const leftTripId = "00000000-0000-4000-8000-000000000010";
    const rightTripId = "00000000-0000-4000-8000-000000000011";
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
      readonly lockVersion: number;
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
      readonly lockVersion: number;
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
           VALUES ('00000000-0000-4000-8000-000000000099'::uuid, '${slice.trip.id}'::uuid, '${primaryReservation(slice).id}'::uuid, '${primaryFlight(slice).id}'::uuid, 'PRIMARY')`,
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

  it("keeps the repository Agency-scoped on reads", async () => {
    const otherAgency = asOpaqueId("00000000-0000-4000-8000-000000000099");
    await expect(readM1TripSlice(repository, otherAgency, slice.trip.id)).resolves.toBeNull();
  });
});

export const stage5QualificationFingerprint = createHash("sha256").update("stage5").digest("hex");
