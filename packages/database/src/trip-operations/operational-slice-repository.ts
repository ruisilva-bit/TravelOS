import {
  asOpaqueId,
  authorizeStaffRequest,
  createMoney,
  createScheduledLocalDateTime,
  OptimisticConflictError,
  OPERATION_PERMISSION_REQUIREMENTS,
  StaffAuthorizationError,
  TransactionConflictError,
  isStaffPermissionId,
  type OperationalSliceRepository,
  type TripSlice,
  type OpaqueId,
  type ScheduledLocalDateTime,
  type CreateTripWorkspaceInput,
  type CreateTripSliceInput,
  type StaffAuthorizationOperationProof,
  type StaffPermissionId,
  type Trip,
  type UpdateAccommodationInput,
  type UpdateInternalNoteInput,
} from "@travelos/backend-core";
import { sql, type Kysely } from "kysely";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { lockStaffAuthorizationSnapshotInTransaction } from "../staff-access/staff-access-repository.js";
import { createUuidV7 } from "../uuidv7.js";

type DatabaseShape = Record<string, never>;

export const assertStaffAuthorizationInTransaction = async (
  database: Kysely<DatabaseShape>,
  authorization: StaffAuthorizationOperationProof,
  targetAgencyId: OpaqueId,
  requiredPermissionIds: readonly StaffPermissionId[],
  recentMfaMaximumAgeMs: number | null = null,
): Promise<number | null> => {
  const session = authorization?.session;
  if (
    typeof session !== "object" ||
    session === null ||
    typeof session.sessionId !== "string" ||
    session.sessionId.length === 0 ||
    typeof session.staffPrincipalId !== "string" ||
    session.staffPrincipalId.length === 0 ||
    typeof session.agencyId !== "string" ||
    typeof session.authorizationEpoch !== "bigint" ||
    session.authorizationEpoch < 0n ||
    !Number.isSafeInteger(authorization.nowEpochMs) ||
    authorization.nowEpochMs < 0 ||
    !Array.isArray(authorization.requiredPermissionIds) ||
    authorization.requiredPermissionIds.length === 0 ||
    !authorization.requiredPermissionIds.every(isStaffPermissionId)
  ) {
    throw new StaffAuthorizationError("UNAUTHENTICATED");
  }
  const suppliedPermissions = new Set(authorization.requiredPermissionIds);
  if (
    suppliedPermissions.size !== authorization.requiredPermissionIds.length ||
    suppliedPermissions.size !== requiredPermissionIds.length ||
    requiredPermissionIds.some((permissionId) => !suppliedPermissions.has(permissionId))
  ) {
    throw new StaffAuthorizationError("FORBIDDEN");
  }

  let sessionAgencyId: OpaqueId;
  try {
    sessionAgencyId = asOpaqueId(session.agencyId);
  } catch {
    throw new StaffAuthorizationError("UNAUTHENTICATED");
  }
  if (sessionAgencyId !== targetAgencyId) {
    throw new StaffAuthorizationError("FORBIDDEN");
  }
  if (
    recentMfaMaximumAgeMs !== null &&
    (!Number.isSafeInteger(recentMfaMaximumAgeMs) || recentMfaMaximumAgeMs <= 0)
  ) {
    throw new Error("Recent MFA maximum age must be a positive safe integer");
  }

  const liveSession = (
    await sql<{
      readonly staffPrincipalId: string;
      readonly agencyId: string;
      readonly authorizationEpoch: string;
      readonly expiresAtEpochMs: number;
      readonly recentMfaVerifiedAtEpochMs: number | null;
      readonly databaseNowEpochMs: number;
    }>`
      WITH request_time AS (SELECT statement_timestamp() AS "now")
      SELECT active_session."userId" AS "staffPrincipalId",
             context."agencyId"::text AS "agencyId",
             context."authorizationEpoch"::text AS "authorizationEpoch",
             (EXTRACT(EPOCH FROM active_session."expiresAt") * 1000)::double precision AS "expiresAtEpochMs",
             (EXTRACT(EPOCH FROM context."recentMfaVerifiedAt") * 1000)::double precision AS "recentMfaVerifiedAtEpochMs",
             (EXTRACT(EPOCH FROM request_time."now") * 1000)::double precision AS "databaseNowEpochMs"
        FROM "staff_access"."staff_session" AS active_session
        CROSS JOIN request_time
        JOIN "staff_access"."staff_session_context" AS context
          ON context."sessionId" = active_session."id"
         AND context."staffPrincipalId" = active_session."userId"
       WHERE active_session."id" = ${session.sessionId}
         AND active_session."userId" = ${session.staffPrincipalId}
         AND active_session."expiresAt" > request_time."now"
         AND context."agencyId" = ${sessionAgencyId}::uuid
         AND context."authorizationEpoch" = ${session.authorizationEpoch}
       FOR SHARE OF active_session, context
    `.execute(database)
  ).rows[0];
  if (liveSession === undefined) {
    throw new StaffAuthorizationError("UNAUTHENTICATED");
  }
  const verifiedSession = {
    sessionId: session.sessionId,
    staffPrincipalId: liveSession.staffPrincipalId,
    agencyId: liveSession.agencyId,
    authorizationEpoch: BigInt(liveSession.authorizationEpoch),
    expiresAtEpochMs: liveSession.expiresAtEpochMs,
    recentMfaVerifiedAtEpochMs: liveSession.recentMfaVerifiedAtEpochMs,
  };

  const snapshot = await lockStaffAuthorizationSnapshotInTransaction(
    database,
    verifiedSession.staffPrincipalId,
    verifiedSession.agencyId,
  );
  for (const permissionId of requiredPermissionIds) {
    const decision = authorizeStaffRequest({
      session: verifiedSession,
      snapshot,
      permissionId,
      target: {
        agencyId: targetAgencyId,
        organizationUnitAncestorIds: [],
        requiredAccessLevel: "ALL",
      },
      nowEpochMs: liveSession.databaseNowEpochMs,
      recentMfaMaximumAgeMs,
    });
    if (decision.result === "DENY") {
      throw new StaffAuthorizationError(
        decision.reason === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
      );
    }
  }
  return liveSession.recentMfaVerifiedAtEpochMs;
};

type PersonRow = {
  readonly id: string;
  readonly agencyId: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly email: string | null;
  readonly lockVersion: string;
};

type CustomerRow = {
  readonly id: string;
  readonly agencyId: string;
  readonly displayName: string;
  readonly lockVersion: string;
};

type CustomerPersonRow = {
  readonly agencyId: string;
  readonly customerId: string;
  readonly personId: string;
  readonly role: "PRIMARY_CONTACT" | "TRAVELLER" | "PAYER" | "GUARDIAN";
  readonly isPrimary: boolean;
};

type TripRow = {
  readonly id: string;
  readonly agencyId: string;
  readonly title: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly state: "DRAFT" | "CONFIRMED" | "IN_OPERATION" | "COMPLETED" | "CANCELLED";
  readonly workspaceRevision: string;
  readonly lockVersion: string;
};

type TravellerRow = {
  readonly id: string;
  readonly agencyId: string;
  readonly tripId: string;
  readonly personId: string;
  readonly role: "PRIMARY_TRAVELLER";
};

type FlightRow = {
  readonly id: string;
  readonly agencyId: string;
  readonly tripId: string;
  readonly state: "DRAFT" | "CONFIRMED" | "CANCELLED";
  readonly sortOrder: number;
  readonly title: string;
  readonly description: string;
  readonly customerBookingReference: string | null;
  readonly lockVersion: string;
  readonly carrier: string;
  readonly flightNumber: string;
  readonly departureAirport: string;
  readonly arrivalAirport: string;
  readonly departureDate: string;
  readonly departureTime: string;
  readonly departureTimezone: string;
  readonly departureInstant: Date;
  readonly arrivalDate: string;
  readonly arrivalTime: string;
  readonly arrivalTimezone: string;
  readonly arrivalInstant: Date;
  readonly terminal: string | null;
  readonly cabin: string | null;
  readonly baggage: string | null;
  readonly seat: string | null;
};

type AccommodationRow = {
  readonly id: string;
  readonly agencyId: string;
  readonly tripId: string;
  readonly state: "DRAFT" | "CONFIRMED" | "CANCELLED";
  readonly sortOrder: number;
  readonly title: string;
  readonly description: string;
  readonly customerBookingReference: string | null;
  readonly lockVersion: string;
  readonly propertyName: string;
  readonly checkInDate: string;
  readonly checkInTime: string;
  readonly checkInTimezone: string;
  readonly checkInInstant: Date;
  readonly checkOutDate: string;
  readonly checkOutTime: string;
  readonly checkOutTimezone: string;
  readonly checkOutInstant: Date;
  readonly roomDescription: string | null;
  readonly boardType: string | null;
};

type ReservationRow = {
  readonly id: string;
  readonly agencyId: string;
  readonly tripId: string;
  readonly supplierName: string;
  readonly supplierReference: string;
  readonly customerBookingReference: string | null;
  readonly state: "PROVISIONAL" | "HELD" | "CONFIRMED" | "USED" | "CANCELLED" | "FAILED";
  readonly lockVersion: string;
};

type LinkRow = {
  readonly agencyId: string;
  readonly tripId: string;
  readonly reservationId: string;
  readonly itineraryItemId: string;
  readonly linkRole: "PRIMARY" | "SECONDARY";
};

type SupplierCostRow = {
  readonly id: string;
  readonly agencyId: string;
  readonly tripId: string;
  readonly reservationId: string;
  readonly amountMinor: string;
  readonly currencyCode: string;
  readonly currencyScale: number;
  readonly internalNote: string;
  readonly classification: "INTERNAL_ONLY";
  readonly lockVersion: string;
};

const first = <Row>(rows: readonly Row[]): Row | null => rows[0] ?? null;

const postgresErrorCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : null;
};

export const mapPostgresMutationError = (error: unknown): unknown => {
  const code = postgresErrorCode(error);
  if (code === "40001") return new OptimisticConflictError();
  if (code === "40P01") return new TransactionConflictError();
  return error;
};

const rethrowPersistenceError = (error: unknown): never => {
  throw mapPostgresMutationError(error);
};

const withMappedPostgresError = async <Result>(work: () => Promise<Result>): Promise<Result> => {
  try {
    return await work();
  } catch (error) {
    return rethrowPersistenceError(error);
  }
};

const instantText = (value: Date): string => value.toISOString();

const scheduled = (
  localDate: string,
  localTime: string,
  timezoneName: string,
  instant: Date,
): ScheduledLocalDateTime => ({
  ...createScheduledLocalDateTime({
    localDate,
    localTime,
    timezoneName,
    instant: instantText(instant),
  }),
});

const mapFlightRow = (flight: FlightRow): TripSlice["flights"][number] => ({
  id: asOpaqueId(flight.id),
  agencyId: asOpaqueId(flight.agencyId),
  tripId: asOpaqueId(flight.tripId),
  family: "FLIGHT",
  state: flight.state,
  sortOrder: flight.sortOrder,
  title: flight.title,
  description: flight.description,
  customerBookingReference: flight.customerBookingReference,
  lockVersion: BigInt(flight.lockVersion),
  carrier: flight.carrier,
  flightNumber: flight.flightNumber,
  departureAirport: flight.departureAirport,
  arrivalAirport: flight.arrivalAirport,
  departure: scheduled(
    flight.departureDate,
    flight.departureTime,
    flight.departureTimezone,
    flight.departureInstant,
  ),
  arrival: scheduled(
    flight.arrivalDate,
    flight.arrivalTime,
    flight.arrivalTimezone,
    flight.arrivalInstant,
  ),
  terminal: flight.terminal,
  cabin: flight.cabin,
  baggage: flight.baggage,
  seat: flight.seat,
});

const mapAccommodationRow = (
  accommodation: AccommodationRow,
): TripSlice["accommodations"][number] => ({
  id: asOpaqueId(accommodation.id),
  agencyId: asOpaqueId(accommodation.agencyId),
  tripId: asOpaqueId(accommodation.tripId),
  family: "ACCOMMODATION",
  state: accommodation.state,
  sortOrder: accommodation.sortOrder,
  title: accommodation.title,
  description: accommodation.description,
  customerBookingReference: accommodation.customerBookingReference,
  lockVersion: BigInt(accommodation.lockVersion),
  propertyName: accommodation.propertyName,
  checkIn: scheduled(
    accommodation.checkInDate,
    accommodation.checkInTime,
    accommodation.checkInTimezone,
    accommodation.checkInInstant,
  ),
  checkOut: scheduled(
    accommodation.checkOutDate,
    accommodation.checkOutTime,
    accommodation.checkOutTimezone,
    accommodation.checkOutInstant,
  ),
  roomDescription: accommodation.roomDescription,
  boardType: accommodation.boardType,
});

const mapReservationRow = (reservation: ReservationRow): TripSlice["reservations"][number] => ({
  id: asOpaqueId(reservation.id),
  agencyId: asOpaqueId(reservation.agencyId),
  tripId: asOpaqueId(reservation.tripId),
  supplierName: reservation.supplierName,
  supplierReference: reservation.supplierReference,
  customerBookingReference: reservation.customerBookingReference,
  state: reservation.state,
  lockVersion: BigInt(reservation.lockVersion),
});

const mapSupplierCostRow = (supplierCost: SupplierCostRow): TripSlice["supplierCosts"][number] => ({
  id: asOpaqueId(supplierCost.id),
  agencyId: asOpaqueId(supplierCost.agencyId),
  tripId: asOpaqueId(supplierCost.tripId),
  reservationId: asOpaqueId(supplierCost.reservationId),
  amount: createMoney(
    supplierCost.amountMinor,
    supplierCost.currencyCode,
    supplierCost.currencyScale,
  ),
  internalNote: supplierCost.internalNote,
  classification: supplierCost.classification,
  lockVersion: BigInt(supplierCost.lockVersion),
});

const readSlice = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  tripId: OpaqueId,
): Promise<TripSlice | null> => {
  const person = first(
    (
      await sql<PersonRow>`
        SELECT "id"::text AS "id", "agencyId"::text AS "agencyId", "givenName", "familyName", "email",
               "lockVersion"::text AS "lockVersion"
          FROM "crm"."person"
         WHERE "agencyId" = ${agencyId}::uuid
           AND EXISTS (
             SELECT 1 FROM "trip_ops"."trip_traveller" AS traveller
              WHERE traveller."agencyId" = "person"."agencyId"
                AND traveller."personId" = "person"."id"
                AND traveller."tripId" = ${tripId}::uuid
                AND traveller."role" = 'PRIMARY_TRAVELLER'
           )
         ORDER BY "createdAt", "id"
         LIMIT 1
      `.execute(database)
    ).rows,
  );
  const trip = first(
    (
      await sql<TripRow>`
        SELECT "id"::text AS "id", "agencyId"::text AS "agencyId", "title", "startDate"::text AS "startDate",
               "endDate"::text AS "endDate", "state", "workspaceRevision"::text AS "workspaceRevision",
               "lockVersion"::text AS "lockVersion"
          FROM "trip_ops"."trip"
         WHERE "agencyId" = ${agencyId}::uuid AND "id" = ${tripId}::uuid
      `.execute(database)
    ).rows,
  );
  if (trip === null || person === null) return null;
  const customer = first(
    (
      await sql<CustomerRow>`
        SELECT customer."id"::text AS "id", customer."agencyId"::text AS "agencyId",
               customer."displayName", customer."lockVersion"::text AS "lockVersion"
          FROM "crm"."customer" AS customer
          JOIN "crm"."customer_person" AS relationship
            ON relationship."customerId" = customer."id"
           AND relationship."agencyId" = customer."agencyId"
           AND relationship."personId" = ${person.id}::uuid
           AND relationship."isPrimary" = true
         WHERE customer."agencyId" = ${agencyId}::uuid
         ORDER BY relationship."createdAt", customer."id"
         LIMIT 1
      `.execute(database)
    ).rows,
  );
  const customerPerson = customer
    ? first(
        (
          await sql<CustomerPersonRow>`
            SELECT "agencyId"::text AS "agencyId", "customerId"::text AS "customerId",
                   "personId"::text AS "personId", "role", "isPrimary"
              FROM "crm"."customer_person"
             WHERE "agencyId" = ${agencyId}::uuid
               AND "customerId" = ${customer.id}::uuid
               AND "personId" = ${person.id}::uuid
               AND "isPrimary" = true
             ORDER BY "isPrimary" DESC, "createdAt"
             LIMIT 1
          `.execute(database)
        ).rows,
      )
    : null;
  const traveller = first(
    (
      await sql<TravellerRow>`
        SELECT "id"::text AS "id", "agencyId"::text AS "agencyId", "tripId"::text AS "tripId",
               "personId"::text AS "personId", "role"
          FROM "trip_ops"."trip_traveller"
         WHERE "agencyId" = ${agencyId}::uuid AND "tripId" = ${tripId}::uuid
           AND "personId" = ${person.id}::uuid
           AND "role" = 'PRIMARY_TRAVELLER'
         ORDER BY "createdAt", "id"
         LIMIT 1
      `.execute(database)
    ).rows,
  );
  const flights = (
    await sql<FlightRow>`
        SELECT item."id"::text AS "id", item."agencyId"::text AS "agencyId", item."tripId"::text AS "tripId",
               item."state", item."sortOrder", item."customerTitle" AS "title",
               item."customerDescription" AS "description", item."customerBookingReference",
               item."lockVersion"::text AS "lockVersion", detail."carrier", detail."flightNumber", detail."departureAirport",
               detail."arrivalAirport", detail."departureDate"::text AS "departureDate",
               detail."departureTime"::text AS "departureTime", detail."departureTimezone",
               detail."departureInstant", detail."arrivalDate"::text AS "arrivalDate",
               detail."arrivalTime"::text AS "arrivalTime", detail."arrivalTimezone",
               detail."arrivalInstant", detail."terminal", detail."cabin", detail."baggage", detail."seat"
          FROM "trip_ops"."itinerary_item" AS item
          JOIN "trip_ops"."flight_item_detail" AS detail
            ON detail."agencyId" = item."agencyId" AND detail."tripId" = item."tripId" AND detail."itemId" = item."id"
         WHERE item."agencyId" = ${agencyId}::uuid AND item."tripId" = ${tripId}::uuid
         ORDER BY item."sortOrder", item."id"
      `.execute(database)
  ).rows;
  const accommodations = (
    await sql<AccommodationRow>`
        SELECT item."id"::text AS "id", item."agencyId"::text AS "agencyId", item."tripId"::text AS "tripId",
               item."state", item."sortOrder", item."customerTitle" AS "title",
               item."customerDescription" AS "description", item."customerBookingReference",
               item."lockVersion"::text AS "lockVersion", detail."propertyName", detail."checkInDate"::text AS "checkInDate",
               detail."checkInTime"::text AS "checkInTime", detail."checkInTimezone", detail."checkInInstant",
               detail."checkOutDate"::text AS "checkOutDate", detail."checkOutTime"::text AS "checkOutTime",
               detail."checkOutTimezone", detail."checkOutInstant", detail."roomDescription", detail."boardType"
          FROM "trip_ops"."itinerary_item" AS item
          JOIN "trip_ops"."accommodation_item_detail" AS detail
            ON detail."agencyId" = item."agencyId" AND detail."tripId" = item."tripId" AND detail."itemId" = item."id"
         WHERE item."agencyId" = ${agencyId}::uuid AND item."tripId" = ${tripId}::uuid
         ORDER BY item."sortOrder", item."id"
      `.execute(database)
  ).rows;
  const reservations = (
    await sql<ReservationRow>`
        SELECT "id"::text AS "id", "agencyId"::text AS "agencyId", "tripId"::text AS "tripId",
               "supplierName", "supplierReference", "customerBookingReference", "state",
               "lockVersion"::text AS "lockVersion"
          FROM "trip_ops"."reservation"
         WHERE "agencyId" = ${agencyId}::uuid AND "tripId" = ${tripId}::uuid
         ORDER BY "createdAt", "id"
      `.execute(database)
  ).rows;
  const supplierCosts = (
    await sql<SupplierCostRow>`
            SELECT "id"::text AS "id", "agencyId"::text AS "agencyId", "tripId"::text AS "tripId",
                   "reservationId"::text AS "reservationId", "amountMinor"::text AS "amountMinor",
                   "currencyCode", "currencyScale", "internalNote", "classification",
                   "lockVersion"::text AS "lockVersion"
              FROM "finance"."supplier_cost_line"
             WHERE "agencyId" = ${agencyId}::uuid
               AND "tripId" = ${tripId}::uuid
             ORDER BY "createdAt", "id"
          `.execute(database)
  ).rows;
  if (
    customer === null ||
    customerPerson === null ||
    traveller === null ||
    flights.length === 0 ||
    accommodations.length === 0 ||
    reservations.length === 0 ||
    supplierCosts.length === 0
  ) {
    throw new Error("M1 Trip slice is incomplete or violates its relational invariants");
  }
  const links = (
    await sql<LinkRow>`
      SELECT "agencyId"::text AS "agencyId", "tripId"::text AS "tripId",
             "reservationId"::text AS "reservationId", "itineraryItemId"::text AS "itineraryItemId", "linkRole"
        FROM "trip_ops"."reservation_item_link"
       WHERE "agencyId" = ${agencyId}::uuid
         AND "tripId" = ${tripId}::uuid
       ORDER BY "reservationId", "itineraryItemId"
    `.execute(database)
  ).rows;
  return {
    person: {
      id: asOpaqueId(person.id),
      agencyId: asOpaqueId(person.agencyId),
      givenName: person.givenName,
      familyName: person.familyName,
      email: person.email,
      lockVersion: BigInt(person.lockVersion),
    },
    customer: {
      id: asOpaqueId(customer.id),
      agencyId: asOpaqueId(customer.agencyId),
      displayName: customer.displayName,
      lockVersion: BigInt(customer.lockVersion),
    },
    customerPerson: {
      agencyId: asOpaqueId(customerPerson.agencyId),
      customerId: asOpaqueId(customerPerson.customerId),
      personId: asOpaqueId(customerPerson.personId),
      role: customerPerson.role,
      isPrimary: customerPerson.isPrimary,
    },
    traveller: {
      id: asOpaqueId(traveller.id),
      agencyId: asOpaqueId(traveller.agencyId),
      tripId: asOpaqueId(traveller.tripId),
      personId: asOpaqueId(traveller.personId),
      role: traveller.role,
    },
    trip: {
      id: asOpaqueId(trip.id),
      agencyId: asOpaqueId(trip.agencyId),
      title: trip.title,
      startDate: trip.startDate,
      endDate: trip.endDate,
      state: trip.state,
      workspaceRevision: BigInt(trip.workspaceRevision),
      lockVersion: BigInt(trip.lockVersion),
    },
    flights: flights.map(mapFlightRow),
    accommodations: accommodations.map(mapAccommodationRow),
    reservations: reservations.map(mapReservationRow),
    reservationItemLinks: links.map((link) => ({
      agencyId: asOpaqueId(link.agencyId),
      tripId: asOpaqueId(link.tripId),
      reservationId: asOpaqueId(link.reservationId),
      itineraryItemId: asOpaqueId(link.itineraryItemId),
      linkRole: link.linkRole,
    })),
    supplierCosts: supplierCosts.map(mapSupplierCostRow),
  };
};

const insertScheduled = (
  value: ScheduledLocalDateTime,
): readonly [string, string, string, string] => [
  value.localDate,
  value.localTime,
  value.timezoneName,
  new Date(value.instant).toISOString(),
];

class PostgresOperationalSliceRepository implements OperationalSliceRepository {
  constructor(private readonly persistence: PostgresPersistence<DatabaseShape>) {}

  async createTripWorkspace(
    input: CreateTripWorkspaceInput,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<Trip> {
    const session = authorization?.session;
    if (typeof session?.agencyId !== "string") {
      throw new StaffAuthorizationError("UNAUTHENTICATED");
    }
    let agencyId: OpaqueId;
    try {
      agencyId = asOpaqueId(session.agencyId);
    } catch {
      throw new StaffAuthorizationError("UNAUTHENTICATED");
    }

    return withMappedPostgresError(() =>
      this.persistence.transaction.runInTransaction(async (context) =>
        this.persistence.withTransactionContext(context, async (database) => {
          await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`.execute(database);
          await assertStaffAuthorizationInTransaction(
            database,
            authorization,
            agencyId,
            OPERATION_PERMISSION_REQUIREMENTS.WORKSPACE_CREATE,
          );

          const personId = createUuidV7();
          const customerId = createUuidV7();
          const tripId = createUuidV7();
          const travellerId = createUuidV7();
          await sql`
            INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName", "email")
            VALUES (
              ${personId}::uuid, ${agencyId}::uuid,
              ${input.primaryTraveller.givenName.trim()}, ${input.primaryTraveller.familyName.trim()}, NULL
            )
          `.execute(database);
          await sql`
            INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
            VALUES (${customerId}::uuid, ${agencyId}::uuid, ${input.customer.displayName.trim()})
          `.execute(database);
          await sql`
            INSERT INTO "crm"."customer_person"
              ("agencyId", "customerId", "personId", "role", "isPrimary")
            VALUES (${agencyId}::uuid, ${customerId}::uuid, ${personId}::uuid, 'PRIMARY_CONTACT', true)
          `.execute(database);
          await sql`
            INSERT INTO "trip_ops"."trip"
              ("id", "agencyId", "title", "startDate", "endDate", "state")
            VALUES (
              ${tripId}::uuid, ${agencyId}::uuid, ${input.trip.title.trim()},
              ${input.trip.startDate}, ${input.trip.endDate}, 'DRAFT'
            )
          `.execute(database);
          await sql`
            INSERT INTO "trip_ops"."trip_traveller"
              ("id", "agencyId", "tripId", "personId", "role")
            VALUES (${travellerId}::uuid, ${agencyId}::uuid, ${tripId}::uuid, ${personId}::uuid, 'PRIMARY_TRAVELLER')
          `.execute(database);

          const trip = first(
            (
              await sql<TripRow>`
                SELECT "id"::text AS "id", "agencyId"::text AS "agencyId", "title",
                       "startDate"::text AS "startDate", "endDate"::text AS "endDate", "state",
                       "workspaceRevision"::text AS "workspaceRevision",
                       "lockVersion"::text AS "lockVersion"
                  FROM "trip_ops"."trip"
                 WHERE "agencyId" = ${agencyId}::uuid AND "id" = ${tripId}::uuid
              `.execute(database)
            ).rows,
          );
          if (trip === null) throw new Error("Trip workspace was not readable after creation");
          return {
            id: asOpaqueId(trip.id),
            agencyId: asOpaqueId(trip.agencyId),
            title: trip.title,
            startDate: trip.startDate,
            endDate: trip.endDate,
            state: trip.state,
            workspaceRevision: BigInt(trip.workspaceRevision),
            lockVersion: BigInt(trip.lockVersion),
          };
        }),
      ),
    );
  }

  async createTripSlice(
    input: CreateTripSliceInput,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripSlice> {
    return this.persistTripSlice(input, authorization);
  }

  private async persistTripSlice(
    input: CreateTripSliceInput,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripSlice> {
    return withMappedPostgresError(() =>
      this.persistence.transaction.runInTransaction(async (context) =>
        this.persistence.withTransactionContext(context, async (database) => {
          await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`.execute(database);
          await assertStaffAuthorizationInTransaction(
            database,
            authorization,
            input.agencyId,
            OPERATION_PERMISSION_REQUIREMENTS.CREATE,
            null,
          );
          const personId = createUuidV7();
          const customerId = createUuidV7();
          const tripId = createUuidV7();
          const travellerId = createUuidV7();
          const flightId = createUuidV7();
          const accommodationId = createUuidV7();
          const reservationId = createUuidV7();
          const supplierCostId = createUuidV7();
          await sql`
          INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName", "email")
          VALUES (${personId}::uuid, ${input.agencyId}::uuid, ${input.person.givenName.trim()}, ${input.person.familyName.trim()}, ${input.person.email})
        `.execute(database);
          await sql`
          INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
          VALUES (${customerId}::uuid, ${input.agencyId}::uuid, ${input.customer.displayName.trim()})
        `.execute(database);
          await sql`
          INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
          VALUES (${input.agencyId}::uuid, ${customerId}::uuid, ${personId}::uuid, ${input.customerPersonRole}, true)
        `.execute(database);
          await sql`
          INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
          VALUES (${tripId}::uuid, ${input.agencyId}::uuid, ${input.trip.title.trim()}, ${input.trip.startDate}, ${input.trip.endDate}, ${input.trip.state})
        `.execute(database);
          await sql`
          INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
          VALUES (${travellerId}::uuid, ${input.agencyId}::uuid, ${tripId}::uuid, ${personId}::uuid, 'PRIMARY_TRAVELLER')
        `.execute(database);
          await sql`
          INSERT INTO "trip_ops"."itinerary_item"
            ("id", "agencyId", "tripId", "family", "state", "sortOrder", "customerTitle", "customerDescription", "customerBookingReference")
          VALUES
            (${flightId}::uuid, ${input.agencyId}::uuid, ${tripId}::uuid, 'FLIGHT', 'CONFIRMED', 1, ${input.flight.title.trim()}, ${input.flight.description.trim()}, ${input.flight.customerBookingReference}),
            (${accommodationId}::uuid, ${input.agencyId}::uuid, ${tripId}::uuid, 'ACCOMMODATION', 'CONFIRMED', 2, ${input.accommodation.title.trim()}, ${input.accommodation.description.trim()}, ${input.accommodation.customerBookingReference})
        `.execute(database);
          const departure = insertScheduled(input.flight.departure);
          const arrival = insertScheduled(input.flight.arrival);
          await sql`
          INSERT INTO "trip_ops"."flight_item_detail"
            ("agencyId", "tripId", "itemId", "carrier", "flightNumber", "departureAirport", "arrivalAirport",
             "departureDate", "departureTime", "departureTimezone", "departureInstant", "arrivalDate", "arrivalTime",
             "arrivalTimezone", "arrivalInstant", "terminal", "cabin", "baggage", "seat")
          VALUES
            (${input.agencyId}::uuid, ${tripId}::uuid, ${flightId}::uuid, ${input.flight.carrier.trim()}, ${input.flight.flightNumber.trim()},
             ${input.flight.departureAirport.trim().toUpperCase()}, ${input.flight.arrivalAirport.trim().toUpperCase()},
             ${departure[0]}, ${departure[1]}, ${departure[2]}, ${departure[3]}, ${arrival[0]}, ${arrival[1]}, ${arrival[2]}, ${arrival[3]},
             ${input.flight.terminal}, ${input.flight.cabin}, ${input.flight.baggage}, ${input.flight.seat})
        `.execute(database);
          const checkIn = insertScheduled(input.accommodation.checkIn);
          const checkOut = insertScheduled(input.accommodation.checkOut);
          await sql`
          INSERT INTO "trip_ops"."accommodation_item_detail"
            ("agencyId", "tripId", "itemId", "propertyName", "checkInDate", "checkInTime", "checkInTimezone", "checkInInstant",
             "checkOutDate", "checkOutTime", "checkOutTimezone", "checkOutInstant", "roomDescription", "boardType")
          VALUES
            (${input.agencyId}::uuid, ${tripId}::uuid, ${accommodationId}::uuid, ${input.accommodation.propertyName.trim()},
             ${checkIn[0]}, ${checkIn[1]}, ${checkIn[2]}, ${checkIn[3]}, ${checkOut[0]}, ${checkOut[1]}, ${checkOut[2]}, ${checkOut[3]},
             ${input.accommodation.roomDescription}, ${input.accommodation.boardType})
        `.execute(database);
          await sql`
          INSERT INTO "trip_ops"."reservation"
            ("id", "agencyId", "tripId", "supplierName", "supplierReference", "customerBookingReference", "state")
          VALUES (${reservationId}::uuid, ${input.agencyId}::uuid, ${tripId}::uuid, ${input.reservation.supplierName.trim()},
                  ${input.reservation.supplierReference.trim()}, ${input.reservation.customerBookingReference}, ${input.reservation.state})
        `.execute(database);
          await sql`
          INSERT INTO "trip_ops"."reservation_item_link"
            ("agencyId", "tripId", "reservationId", "itineraryItemId", "linkRole")
          VALUES
            (${input.agencyId}::uuid, ${tripId}::uuid, ${reservationId}::uuid, ${flightId}::uuid, 'PRIMARY'),
            (${input.agencyId}::uuid, ${tripId}::uuid, ${reservationId}::uuid, ${accommodationId}::uuid, 'PRIMARY')
        `.execute(database);
          await sql`
          INSERT INTO "finance"."supplier_cost_line"
            ("id", "agencyId", "tripId", "reservationId", "amountMinor", "currencyCode", "currencyScale", "internalNote", "classification")
          VALUES (${supplierCostId}::uuid, ${input.agencyId}::uuid, ${tripId}::uuid, ${reservationId}::uuid,
                  ${input.supplierCost.amount.minorUnits.toString()}, ${input.supplierCost.amount.currency}, ${input.supplierCost.amount.scale},
                  ${input.supplierCost.internalNote.trim()}, 'INTERNAL_ONLY')
        `.execute(database);
          const result = await readSlice(database, input.agencyId, tripId);
          if (result === null) throw new Error("M1 Trip slice was not readable after creation");
          return result;
        }),
      ),
    );
  }

  async getTripSlice(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripSlice | null> {
    return withMappedPostgresError(() =>
      this.persistence.transaction.runInTransaction(async (context) =>
        this.persistence.withTransactionContext(context, async (database) => {
          await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`.execute(database);
          await assertStaffAuthorizationInTransaction(
            database,
            authorization,
            agencyId,
            OPERATION_PERMISSION_REQUIREMENTS.READ,
          );
          return readSlice(database, agencyId, tripId);
        }),
      ),
    );
  }

  async updateAccommodation(
    input: UpdateAccommodationInput,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripSlice> {
    try {
      return await this.persistence.transaction.runInTransaction(async (context) =>
        this.persistence.withTransactionContext(context, async (database) => {
          await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`.execute(database);
          await assertStaffAuthorizationInTransaction(
            database,
            authorization,
            input.agencyId,
            OPERATION_PERMISSION_REQUIREMENTS.ACCOMMODATION_EDIT,
          );
          const result = await sql<{ readonly updated: boolean }>`
            SELECT "trip_ops"."cas_update_accommodation_presentation"(
              ${input.agencyId}::uuid,
              ${input.tripId}::uuid,
              ${input.itemId}::uuid,
              ${input.expectedLockVersion.toString()}::bigint,
              ${input.title.trim()},
              ${input.description.trim()}
            ) AS "updated"
          `.execute(database);
          if (result.rows[0]?.updated !== true) throw new OptimisticConflictError();
          const slice = await readSlice(database, input.agencyId, input.tripId);
          if (slice === null)
            throw new Error("M1 Trip slice disappeared during accommodation update");
          return slice;
        }),
      );
    } catch (error) {
      return rethrowPersistenceError(error);
    }
  }

  async updateInternalSupplierNote(
    input: UpdateInternalNoteInput,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripSlice> {
    try {
      return await this.persistence.transaction.runInTransaction(async (context) =>
        this.persistence.withTransactionContext(context, async (database) => {
          await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`.execute(database);
          await assertStaffAuthorizationInTransaction(
            database,
            authorization,
            input.agencyId,
            OPERATION_PERMISSION_REQUIREMENTS.INTERNAL_NOTE_EDIT,
          );
          const result = await sql<{ readonly updated: boolean }>`
            SELECT "trip_ops"."cas_update_supplier_cost_internal_note"(
              ${input.agencyId}::uuid,
              ${input.tripId}::uuid,
              ${input.reservationId}::uuid,
              ${input.expectedLockVersion.toString()}::bigint,
              ${input.internalNote.trim()}
            ) AS "updated"
          `.execute(database);
          if (result.rows[0]?.updated !== true) throw new OptimisticConflictError();
          const slice = await readSlice(database, input.agencyId, input.tripId);
          if (slice === null) throw new Error("M1 Trip slice disappeared during internal update");
          return slice;
        }),
      );
    } catch (error) {
      return rethrowPersistenceError(error);
    }
  }
}

export const createOperationalSliceRepository = (
  persistence: PostgresPersistence<DatabaseShape>,
): OperationalSliceRepository => new PostgresOperationalSliceRepository(persistence);
