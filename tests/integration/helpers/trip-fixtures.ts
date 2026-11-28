import type { Client, QueryResultRow } from "pg";

import {
  createMoney,
  type StaffAuthorizationOperationProof,
  type StaffPermissionId,
  type StaffSessionAuthorizationProof,
  type TripSlice,
  asOpaqueId,
} from "../../../packages/backend-core/src/index.js";
import {
  createTripSlice as createTripSliceWithAuthorization,
  readTripSlice as readTripSliceWithAuthorization,
  updateAccommodation as updateAccommodationWithAuthorization,
  updateInternalSupplierNote as updateInternalSupplierNoteWithAuthorization,
  type CreateTripSliceInput,
} from "../../../packages/backend-core/src/modules/trip-operations/application/trip-slice.js";
import {
  createStaffAccessRepository,
  createUuidV7 as randomUUID,
  type PostgresPersistence,
} from "../../../packages/database/src/index.js";
import { createOperationalSliceRepository } from "../../../packages/database/src/trip-operations/operational-slice-repository.js";
import {
  bootstrapDatabaseRoles,
  clientFor as clientForDatabase,
  createAdminPersistence,
  migrateToHead,
  requireHarness,
  withOwnerTransaction as withOwnerTransactionIn,
} from "./postgres.js";

// Shared Trip/CRM fixtures for the crm and trips suites. `repository`, `staffAccessRepository` and
// `persistence` are live bindings assigned by `setupTripFixtures`.
export const agencyId = asOpaqueId("00000000-0000-7000-8000-000000000001");
export const syntheticEmail = ["rui", "example.test"].join(String.fromCharCode(64));

export let databaseName = "";
export let ownerRoleId = "";
export let persistence: PostgresPersistence<Record<string, never>> | null = null;
export let repository: ReturnType<typeof createOperationalSliceRepository>;
export let staffAccessRepository: ReturnType<typeof createStaffAccessRepository>;
export const staffSessions = new Map<string, StaffSessionAuthorizationProof>();

export const READ_PERMISSION_IDS = [
  "customer.view",
  "traveller.view_sensitive",
  "trip.view",
  "reservation.view",
  "finance.view_costs",
] as const satisfies readonly StaffPermissionId[];
export const CREATE_PERMISSION_IDS = [
  ...READ_PERMISSION_IDS,
  "customer.edit",
  "traveller.edit",
  "trip.edit",
  "reservation.edit",
  "finance.manage_costs",
] as const satisfies readonly StaffPermissionId[];
export const ACCOMMODATION_PERMISSION_IDS = [
  ...READ_PERMISSION_IDS,
  "trip.edit",
] as const satisfies readonly StaffPermissionId[];
export const INTERNAL_NOTE_PERMISSION_IDS = [
  ...READ_PERMISSION_IDS,
  "finance.manage_costs",
] as const satisfies readonly StaffPermissionId[];

export const authorizationFor = (
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

export const createTripSlice = (
  targetRepository: ReturnType<typeof createOperationalSliceRepository>,
  input: CreateTripSliceInput,
) =>
  createTripSliceWithAuthorization(
    targetRepository,
    input,
    authorizationFor(input.agencyId, CREATE_PERMISSION_IDS),
  );

export const readTripSlice = (
  targetRepository: ReturnType<typeof createOperationalSliceRepository>,
  targetAgencyId: CreateTripSliceInput["agencyId"],
  tripId: CreateTripSliceInput["agencyId"],
) =>
  readTripSliceWithAuthorization(
    targetRepository,
    targetAgencyId,
    tripId,
    authorizationFor(targetAgencyId, READ_PERMISSION_IDS),
  );

export const updateAccommodation = (
  targetRepository: ReturnType<typeof createOperationalSliceRepository>,
  input: Parameters<typeof updateAccommodationWithAuthorization>[1],
) =>
  updateAccommodationWithAuthorization(
    targetRepository,
    input,
    authorizationFor(input.agencyId, ACCOMMODATION_PERMISSION_IDS),
  );

export const updateInternalSupplierNote = (
  targetRepository: ReturnType<typeof createOperationalSliceRepository>,
  input: Parameters<typeof updateInternalSupplierNoteWithAuthorization>[1],
) =>
  updateInternalSupplierNoteWithAuthorization(
    targetRepository,
    input,
    authorizationFor(input.agencyId, INTERNAL_NOTE_PERMISSION_IDS),
  );

export const primaryFlight = (value: TripSlice): TripSlice["flights"][number] => {
  const item = value.flights[0];
  if (item === undefined) throw new Error("Qualification Trip has no Flight");
  return item;
};

export const primaryAccommodation = (value: TripSlice): TripSlice["accommodations"][number] => {
  const item = value.accommodations[0];
  if (item === undefined) throw new Error("Qualification Trip has no Accommodation");
  return item;
};

export const primaryReservation = (value: TripSlice): TripSlice["reservations"][number] => {
  const item = value.reservations[0];
  if (item === undefined) throw new Error("Qualification Trip has no Reservation");
  return item;
};

export const primarySupplierCost = (value: TripSlice): TripSlice["supplierCosts"][number] => {
  const item = value.supplierCosts[0];
  if (item === undefined) throw new Error("Qualification Trip has no supplier cost");
  return item;
};

export const clientFor = async (user: string, database = databaseName): Promise<Client> =>
  clientForDatabase(user, database);

export const queryAs = async <Row extends QueryResultRow>(
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

export const queryAsOwner = async <Row extends QueryResultRow>(
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

export const withOwnerTransaction = async <Result>(
  work: (client: Client) => Promise<Result>,
): Promise<Result> => withOwnerTransactionIn(databaseName, work);

export const queryErrorCode = async (work: () => Promise<unknown>): Promise<string | null> => {
  try {
    await work();
    return null;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error
      ? String((error as { readonly code?: unknown }).code ?? "")
      : null;
  }
};

export const queryErrorConstraint = async (
  work: () => Promise<unknown>,
): Promise<string | null> => {
  try {
    await work();
    return null;
  } catch (error) {
    return typeof error === "object" && error !== null && "constraint" in error
      ? String((error as { readonly constraint?: unknown }).constraint ?? "")
      : null;
  }
};

export const primaryStaffFixture = {
  staffPrincipalId: `trips-authorization-${randomUUID()}`,
  roleId: randomUUID(),
  membershipId: randomUUID(),
  assignmentId: randomUUID(),
  sessionId: `trips-session-${randomUUID()}`,
  email: `trips-authorization-${randomUUID()}@example.test`,
};

export const seedPrimaryStaffAuthorization = async (): Promise<StaffSessionAuthorizationProof> => {
  await withOwnerTransaction(async (client) => {
    await client.query(
      `INSERT INTO "staff_access"."staff_user" ("id", "name", "email", "emailVerified", "twoFactorEnabled")
       VALUES ($1, 'Trips Authorization Fixture', $2, true, true)`,
      [primaryStaffFixture.staffPrincipalId, primaryStaffFixture.email],
    );
    await client.query(
      `INSERT INTO "staff_access"."staff_membership" ("id", "agencyId", "staffPrincipalId", "state")
       VALUES ($1::uuid, $2::uuid, $3, 'ACTIVE')`,
      [primaryStaffFixture.membershipId, agencyId, primaryStaffFixture.staffPrincipalId],
    );
    await client.query(
      `INSERT INTO "staff_access"."staff_session" ("id", "expiresAt", "token", "updatedAt", "userId")
       VALUES ($1, now() + interval '1 hour', $2, now(), $3)`,
      [
        primaryStaffFixture.sessionId,
        `token-${randomUUID()}`,
        primaryStaffFixture.staffPrincipalId,
      ],
    );
    await client.query(
      `INSERT INTO "staff_access"."role" ("id", "agencyId", "displayName")
       VALUES ($1::uuid, $2::uuid, 'Trips Authorization Fixture')`,
      [primaryStaffFixture.roleId, agencyId],
    );
    await client.query(
      `INSERT INTO "staff_access"."role_permission" ("roleId", "permissionId", "scopeKind", "accessLevel")
       SELECT $1::uuid, permission_id, 'AGENCY', 'ALL'
         FROM unnest($2::text[]) AS permission_id`,
      [primaryStaffFixture.roleId, [...CREATE_PERMISSION_IDS]],
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
    await client.query(
      `INSERT INTO "staff_access"."staff_session_context"
         ("sessionId", "staffPrincipalId", "agencyId", "authorizationEpoch", "recentMfaVerifiedAt")
       SELECT $1, membership."staffPrincipalId", membership."agencyId", membership."authorizationEpoch", NULL
         FROM "staff_access"."staff_membership" AS membership
        WHERE membership."id" = $2::uuid`,
      [primaryStaffFixture.sessionId, primaryStaffFixture.membershipId],
    );
  });

  const snapshot = await staffAccessRepository.getStaffAuthorizationSnapshot(
    primaryStaffFixture.staffPrincipalId,
    agencyId,
  );
  if (snapshot === null) throw new Error("The Trips authorization fixture was not readable");
  const session: StaffSessionAuthorizationProof = {
    sessionId: primaryStaffFixture.sessionId,
    staffPrincipalId: primaryStaffFixture.staffPrincipalId,
    agencyId,
    authorizationEpoch: snapshot.authorizationEpoch,
    expiresAtEpochMs: Date.now() + 60 * 60 * 1_000,
    recentMfaVerifiedAtEpochMs: null,
  };
  staffSessions.set(agencyId, session);
  return session;
};

export const baseInput = (): CreateTripSliceInput => ({
  agencyId,
  person: { givenName: "Rui", familyName: "Silva", email: syntheticEmail },
  customer: { displayName: "Silva Travel" },
  customerPersonRole: "PRIMARY_CONTACT",
  trip: {
    title: "Trips qualification",
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

export const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export const localPartsForInstant = (instant: string, timezoneName: string): string => {
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

export const insertTripWithPrimary = async ({
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

/** Creates the database, migrates it to the head of the real chain and seeds the Staff fixture. */
export const setupTripFixtures = async (database: string): Promise<void> => {
  requireHarness();
  databaseName = database;
  const bootstrap = bootstrapDatabaseRoles(database);
  if (bootstrap.exitCode !== 0) throw new Error(`Database bootstrap failed: ${bootstrap.stderr}`);
  const migrated = await migrateToHead(database, {
    agencyId,
    bootstrapReference: "trip-fixtures",
    slug: "trip-fixtures",
  });
  ownerRoleId = migrated.ownerRoleId;
  if (!migrated.rootAgency.created) throw new Error("Root Agency fixture was not created");
  persistence = createAdminPersistence(database, "travelos-trip-fixtures", 5);
  staffAccessRepository = createStaffAccessRepository(persistence);
  repository = createOperationalSliceRepository(persistence);
  await seedPrimaryStaffAuthorization();
};

export const teardownTripFixtures = async (): Promise<void> => {
  await persistence?.destroy();
  persistence = null;
};
