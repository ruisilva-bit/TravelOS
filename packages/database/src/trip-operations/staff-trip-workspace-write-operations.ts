import {
  asOpaqueId,
  createStaffTripWorkspaceWriteOperations,
  type AccommodationDraft,
  type FlightDraft,
  InputValidationError,
  OptimisticConflictError,
  type StaffSessionResolver,
  type StaffTripWorkspaceWriteOperations,
  type StaffTripWorkspaceWriteRepository,
  type TripWorkspace,
  type OpaqueId,
  type StaffAuthorizationOperationProof,
} from "@travelos/backend-core";
import { sql, type Kysely } from "kysely";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { createStaffAccessRepository } from "../staff-access/staff-access-repository.js";
import { createUuidV7 } from "../uuidv7.js";
import {
  assertStaffAuthorizationInTransaction,
  mapPostgresMutationError,
} from "./operational-slice-repository.js";
import { readTripWorkspace } from "./staff-trip-workspace-repository.js";

type DatabaseShape = Record<string, never>;

type WorkspaceLockOutcome = "LOCKED" | "NOT_FOUND" | "STALE";
type WorkspaceMutationOutcome = "UPDATED" | "NOT_FOUND" | "STALE";

const WORKSPACE_WRITE_PERMISSIONS = Object.freeze(["trip.edit", "trip.view"] as const);
const MAX_POSTGRES_INTEGER = 2_147_483_647;

const outcomeFromRows = <Outcome extends string>(
  rows: readonly { readonly outcome: Outcome }[],
): Outcome => {
  const outcome = rows[0]?.outcome;
  if (outcome === undefined) throw new Error("PostgreSQL workspace write returned no outcome");
  return outcome;
};

const workspaceLockOutcome = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  tripId: OpaqueId,
  expectedWorkspaceRevision: bigint,
): Promise<WorkspaceLockOutcome> => {
  const result = await sql<{ readonly outcome: WorkspaceLockOutcome }>`
    SELECT "trip_ops"."lock_trip_for_workspace_write"(
      ${agencyId}::uuid,
      ${tripId}::uuid,
      ${expectedWorkspaceRevision}::bigint
    ) AS "outcome"
  `.execute(database);
  return outcomeFromRows(result.rows);
};

const isTripLocked = (outcome: WorkspaceLockOutcome): boolean => {
  if (outcome === "NOT_FOUND") return false;
  if (outcome === "STALE") throw new OptimisticConflictError();
  if (outcome !== "LOCKED")
    throw new Error("PostgreSQL workspace lock returned an unknown outcome");
  return true;
};

const workspaceFromMutation = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  tripId: OpaqueId,
  outcome: WorkspaceMutationOutcome,
): Promise<TripWorkspace | null> => {
  if (outcome === "NOT_FOUND") return null;
  if (outcome === "STALE") throw new OptimisticConflictError();
  if (outcome !== "UPDATED") {
    throw new Error("PostgreSQL workspace mutation returned an unknown outcome");
  }
  const workspace = await readTripWorkspace(database, agencyId, tripId);
  if (workspace === null) throw new Error("Trip workspace disappeared during a locked write");
  return workspace;
};

const readWrittenWorkspace = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  tripId: OpaqueId,
): Promise<TripWorkspace> => {
  const workspace = await readTripWorkspace(database, agencyId, tripId);
  if (workspace === null) throw new Error("Trip workspace disappeared during a locked write");
  return workspace;
};

export const nextSortOrder = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  tripId: OpaqueId,
): Promise<number> => {
  const result = await sql<{ readonly maxSortOrder: string }>`
    SELECT COALESCE(MAX("sortOrder"), 0)::text AS "maxSortOrder"
      FROM "trip_ops"."itinerary_item"
     WHERE "agencyId" = ${agencyId}::uuid
       AND "tripId" = ${tripId}::uuid
  `.execute(database);
  const currentMaximum = Number(result.rows[0]?.maxSortOrder ?? "0");
  if (
    !Number.isSafeInteger(currentMaximum) ||
    currentMaximum < 0 ||
    currentMaximum >= MAX_POSTGRES_INTEGER
  ) {
    throw new InputValidationError("Trip itinerary has reached its supported size");
  }
  return currentMaximum + 1;
};

/** Inserts one flight item and its detail row; the caller owns the transaction and the sort order. */
export const insertFlightItemRows = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  tripId: OpaqueId,
  sortOrder: number,
  flight: FlightDraft,
): Promise<string> => {
  const itemId = createUuidV7();
  await sql`
      INSERT INTO "trip_ops"."itinerary_item" (
        "id", "agencyId", "tripId", "family", "state", "sortOrder",
        "customerTitle", "customerDescription", "customerBookingReference"
      ) VALUES (
        ${itemId}::uuid, ${agencyId}::uuid, ${tripId}::uuid,
        'FLIGHT', 'DRAFT', ${sortOrder}::integer,
        ${flight.title}, ${flight.description}, ${flight.customerBookingReference}
      )
    `.execute(database);
  await sql`
      INSERT INTO "trip_ops"."flight_item_detail" (
        "agencyId", "tripId", "itemId", "carrier", "flightNumber",
        "departureAirport", "arrivalAirport", "departureDate", "departureTime",
        "departureTimezone", "departureInstant", "arrivalDate", "arrivalTime",
        "arrivalTimezone", "arrivalInstant", "terminal", "cabin", "baggage", "seat"
      ) VALUES (
        ${agencyId}::uuid, ${tripId}::uuid, ${itemId}::uuid,
        ${flight.carrier}, ${flight.flightNumber}, ${flight.departureAirport},
        ${flight.arrivalAirport}, ${flight.departure.localDate}::date,
        ${flight.departure.localTime}::time, ${flight.departure.timezoneName},
        ${flight.departure.instant}::timestamptz, ${flight.arrival.localDate}::date,
        ${flight.arrival.localTime}::time, ${flight.arrival.timezoneName},
        ${flight.arrival.instant}::timestamptz, ${flight.terminal}, ${flight.cabin},
        ${flight.baggage}, ${flight.seat}
      )
    `.execute(database);
  return itemId;
};

/** Inserts one accommodation item and its detail row; the caller owns the transaction and sort order. */
export const insertAccommodationItemRows = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  tripId: OpaqueId,
  sortOrder: number,
  accommodation: AccommodationDraft,
): Promise<string> => {
  const itemId = createUuidV7();
  await sql`
      INSERT INTO "trip_ops"."itinerary_item" (
        "id", "agencyId", "tripId", "family", "state", "sortOrder",
        "customerTitle", "customerDescription", "customerBookingReference"
      ) VALUES (
        ${itemId}::uuid, ${agencyId}::uuid, ${tripId}::uuid,
        'ACCOMMODATION', 'DRAFT', ${sortOrder}::integer,
        ${accommodation.title}, ${accommodation.description},
        ${accommodation.customerBookingReference}
      )
    `.execute(database);
  await sql`
      INSERT INTO "trip_ops"."accommodation_item_detail" (
        "agencyId", "tripId", "itemId", "propertyName", "checkInDate", "checkInTime",
        "checkInTimezone", "checkInInstant", "checkOutDate", "checkOutTime",
        "checkOutTimezone", "checkOutInstant", "roomDescription", "boardType"
      ) VALUES (
        ${agencyId}::uuid, ${tripId}::uuid, ${itemId}::uuid,
        ${accommodation.propertyName}, ${accommodation.checkIn.localDate}::date,
        ${accommodation.checkIn.localTime}::time, ${accommodation.checkIn.timezoneName},
        ${accommodation.checkIn.instant}::timestamptz,
        ${accommodation.checkOut.localDate}::date,
        ${accommodation.checkOut.localTime}::time,
        ${accommodation.checkOut.timezoneName},
        ${accommodation.checkOut.instant}::timestamptz,
        ${accommodation.roomDescription}, ${accommodation.boardType}
      )
    `.execute(database);
  return itemId;
};

export const createPostgresStaffTripWorkspaceWriteRepository = (
  persistence: PostgresPersistence<DatabaseShape>,
): StaffTripWorkspaceWriteRepository => {
  const withWriteTransaction = async <Result>(
    agencyId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
    work: (database: Kysely<DatabaseShape>) => Promise<Result>,
  ): Promise<Result> => {
    try {
      return await persistence.transaction.runInTransaction(async (context) =>
        persistence.withTransactionContext(context, async (database) => {
          await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`.execute(database);
          await assertStaffAuthorizationInTransaction(
            database,
            authorization,
            agencyId,
            WORKSPACE_WRITE_PERMISSIONS,
          );
          return work(database);
        }),
      );
    } catch (error) {
      throw mapPostgresMutationError(error);
    }
  };

  const repository: StaffTripWorkspaceWriteRepository = {
    async createFlight(agencyId, tripId, expectedWorkspaceRevision, flight, authorization) {
      const normalizedAgencyId = asOpaqueId(agencyId);
      const normalizedTripId = asOpaqueId(tripId);
      return withWriteTransaction(normalizedAgencyId, authorization, async (database) => {
        if (
          !isTripLocked(
            await workspaceLockOutcome(
              database,
              normalizedAgencyId,
              normalizedTripId,
              expectedWorkspaceRevision,
            ),
          )
        ) {
          return null;
        }

        const sortOrder = await nextSortOrder(database, normalizedAgencyId, normalizedTripId);
        await insertFlightItemRows(
          database,
          normalizedAgencyId,
          normalizedTripId,
          sortOrder,
          flight,
        );
        return readWrittenWorkspace(database, normalizedAgencyId, normalizedTripId);
      });
    },

    async updateFlight(
      agencyId,
      tripId,
      itemId,
      expectedWorkspaceRevision,
      expectedLockVersion,
      flight,
      authorization,
    ) {
      const normalizedAgencyId = asOpaqueId(agencyId);
      const normalizedTripId = asOpaqueId(tripId);
      const normalizedItemId = asOpaqueId(itemId);
      return withWriteTransaction(normalizedAgencyId, authorization, async (database) => {
        const result = await sql<{ readonly outcome: WorkspaceMutationOutcome }>`
          SELECT "trip_ops"."cas_update_workspace_flight"(
            ${normalizedAgencyId}::uuid,
            ${normalizedTripId}::uuid,
            ${normalizedItemId}::uuid,
            ${expectedWorkspaceRevision}::bigint,
            ${expectedLockVersion}::bigint,
            ${flight.title}::text,
            ${flight.description}::text,
            ${flight.customerBookingReference}::text,
            ${flight.carrier}::text,
            ${flight.flightNumber}::text,
            ${flight.departureAirport}::text,
            ${flight.arrivalAirport}::text,
            ${flight.departure.localDate}::date,
            ${flight.departure.localTime}::time,
            ${flight.departure.timezoneName}::text,
            ${flight.departure.instant}::timestamptz,
            ${flight.arrival.localDate}::date,
            ${flight.arrival.localTime}::time,
            ${flight.arrival.timezoneName}::text,
            ${flight.arrival.instant}::timestamptz,
            ${flight.terminal}::text,
            ${flight.cabin}::text,
            ${flight.baggage}::text,
            ${flight.seat}::text
          ) AS "outcome"
        `.execute(database);
        return workspaceFromMutation(
          database,
          normalizedAgencyId,
          normalizedTripId,
          outcomeFromRows(result.rows),
        );
      });
    },

    async createAccommodation(
      agencyId,
      tripId,
      expectedWorkspaceRevision,
      accommodation,
      authorization,
    ) {
      const normalizedAgencyId = asOpaqueId(agencyId);
      const normalizedTripId = asOpaqueId(tripId);
      return withWriteTransaction(normalizedAgencyId, authorization, async (database) => {
        if (
          !isTripLocked(
            await workspaceLockOutcome(
              database,
              normalizedAgencyId,
              normalizedTripId,
              expectedWorkspaceRevision,
            ),
          )
        ) {
          return null;
        }

        const sortOrder = await nextSortOrder(database, normalizedAgencyId, normalizedTripId);
        await insertAccommodationItemRows(
          database,
          normalizedAgencyId,
          normalizedTripId,
          sortOrder,
          accommodation,
        );
        return readWrittenWorkspace(database, normalizedAgencyId, normalizedTripId);
      });
    },

    async updateAccommodation(
      agencyId,
      tripId,
      itemId,
      expectedWorkspaceRevision,
      expectedLockVersion,
      accommodation,
      authorization,
    ) {
      const normalizedAgencyId = asOpaqueId(agencyId);
      const normalizedTripId = asOpaqueId(tripId);
      const normalizedItemId = asOpaqueId(itemId);
      return withWriteTransaction(normalizedAgencyId, authorization, async (database) => {
        const result = await sql<{ readonly outcome: WorkspaceMutationOutcome }>`
          SELECT "trip_ops"."cas_update_workspace_accommodation"(
            ${normalizedAgencyId}::uuid,
            ${normalizedTripId}::uuid,
            ${normalizedItemId}::uuid,
            ${expectedWorkspaceRevision}::bigint,
            ${expectedLockVersion}::bigint,
            ${accommodation.title}::text,
            ${accommodation.description}::text,
            ${accommodation.customerBookingReference}::text,
            ${accommodation.propertyName}::text,
            ${accommodation.checkIn.localDate}::date,
            ${accommodation.checkIn.localTime}::time,
            ${accommodation.checkIn.timezoneName}::text,
            ${accommodation.checkIn.instant}::timestamptz,
            ${accommodation.checkOut.localDate}::date,
            ${accommodation.checkOut.localTime}::time,
            ${accommodation.checkOut.timezoneName}::text,
            ${accommodation.checkOut.instant}::timestamptz,
            ${accommodation.roomDescription}::text,
            ${accommodation.boardType}::text
          ) AS "outcome"
        `.execute(database);
        return workspaceFromMutation(
          database,
          normalizedAgencyId,
          normalizedTripId,
          outcomeFromRows(result.rows),
        );
      });
    },

    async updateTrip(
      agencyId,
      tripId,
      expectedWorkspaceRevision,
      expectedLockVersion,
      trip,
      authorization,
    ) {
      const normalizedAgencyId = asOpaqueId(agencyId);
      const normalizedTripId = asOpaqueId(tripId);
      return withWriteTransaction(normalizedAgencyId, authorization, async (database) => {
        const result = await sql<{ readonly outcome: WorkspaceMutationOutcome }>`
          SELECT "trip_ops"."cas_update_workspace_trip"(
            ${normalizedAgencyId}::uuid,
            ${normalizedTripId}::uuid,
            ${expectedWorkspaceRevision}::bigint,
            ${expectedLockVersion}::bigint,
            ${trip.title}::text,
            ${trip.startDate}::date,
            ${trip.endDate}::date
          ) AS "outcome"
        `.execute(database);
        return workspaceFromMutation(
          database,
          normalizedAgencyId,
          normalizedTripId,
          outcomeFromRows(result.rows),
        );
      });
    },
  };
  return Object.freeze(repository);
};

export const createPostgresStaffTripWorkspaceWriteOperations = (
  persistence: PostgresPersistence<DatabaseShape>,
  sessionResolver: StaffSessionResolver,
): StaffTripWorkspaceWriteOperations =>
  createStaffTripWorkspaceWriteOperations({
    repository: createPostgresStaffTripWorkspaceWriteRepository(persistence),
    authorizationRepository: createStaffAccessRepository(persistence),
    sessionResolver,
  });
