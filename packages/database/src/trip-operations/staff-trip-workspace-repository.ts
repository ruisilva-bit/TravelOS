import {
  asOpaqueId,
  createScheduledLocalDateTime,
  InputValidationError,
  type AccommodationItem,
  type FlightItem,
  type StaffTripWorkspaceReadRepository,
  type TripWorkspace,
  type TripWorkspacePage,
  type OpaqueId,
  type StaffAuthorizationOperationProof,
  type Trip,
} from "@travelos/backend-core";
import { sql, type Kysely } from "kysely";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { assertStaffAuthorizationInTransaction } from "./operational-slice-repository.js";

type DatabaseShape = Record<string, never>;

type TripRow = {
  readonly id: string;
  readonly agencyId: string;
  readonly title: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly state: Trip["state"];
  readonly workspaceRevision: string;
  readonly lockVersion: string;
};

type FlightRow = {
  readonly id: string;
  readonly agencyId: string;
  readonly tripId: string;
  readonly state: FlightItem["state"];
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
  readonly state: AccommodationItem["state"];
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

const WORKSPACE_READ_PERMISSIONS = Object.freeze(["trip.view"] as const);

const mapTripRow = (row: TripRow): Trip => ({
  id: asOpaqueId(row.id),
  agencyId: asOpaqueId(row.agencyId),
  title: row.title,
  startDate: row.startDate,
  endDate: row.endDate,
  state: row.state,
  workspaceRevision: BigInt(row.workspaceRevision),
  lockVersion: BigInt(row.lockVersion),
});

const scheduled = (localDate: string, localTime: string, timezoneName: string, instant: Date) =>
  createScheduledLocalDateTime({
    localDate,
    localTime,
    timezoneName,
    instant: instant.toISOString(),
  });

const mapFlightRow = (row: FlightRow): FlightItem => ({
  id: asOpaqueId(row.id),
  agencyId: asOpaqueId(row.agencyId),
  tripId: asOpaqueId(row.tripId),
  family: "FLIGHT",
  state: row.state,
  sortOrder: row.sortOrder,
  title: row.title,
  description: row.description,
  customerBookingReference: row.customerBookingReference,
  lockVersion: BigInt(row.lockVersion),
  carrier: row.carrier,
  flightNumber: row.flightNumber,
  departureAirport: row.departureAirport,
  arrivalAirport: row.arrivalAirport,
  departure: scheduled(
    row.departureDate,
    row.departureTime,
    row.departureTimezone,
    row.departureInstant,
  ),
  arrival: scheduled(row.arrivalDate, row.arrivalTime, row.arrivalTimezone, row.arrivalInstant),
  terminal: row.terminal,
  cabin: row.cabin,
  baggage: row.baggage,
  seat: row.seat,
});

const mapAccommodationRow = (row: AccommodationRow): AccommodationItem => ({
  id: asOpaqueId(row.id),
  agencyId: asOpaqueId(row.agencyId),
  tripId: asOpaqueId(row.tripId),
  family: "ACCOMMODATION",
  state: row.state,
  sortOrder: row.sortOrder,
  title: row.title,
  description: row.description,
  customerBookingReference: row.customerBookingReference,
  lockVersion: BigInt(row.lockVersion),
  propertyName: row.propertyName,
  checkIn: scheduled(row.checkInDate, row.checkInTime, row.checkInTimezone, row.checkInInstant),
  checkOut: scheduled(
    row.checkOutDate,
    row.checkOutTime,
    row.checkOutTimezone,
    row.checkOutInstant,
  ),
  roomDescription: row.roomDescription,
  boardType: row.boardType,
});

const readTripRow = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  tripId: OpaqueId,
): Promise<TripRow | null> => {
  const result = await sql<TripRow>`
    SELECT "id"::text AS "id",
           "agencyId"::text AS "agencyId",
           "title",
           "startDate"::text AS "startDate",
           "endDate"::text AS "endDate",
           "state",
           "workspaceRevision"::text AS "workspaceRevision",
           "lockVersion"::text AS "lockVersion"
      FROM "trip_ops"."trip"
     WHERE "agencyId" = ${agencyId}::uuid
       AND "id" = ${tripId}::uuid
  `.execute(database);
  return result.rows[0] ?? null;
};

const readFlights = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  tripId: OpaqueId,
): Promise<readonly FlightItem[]> => {
  const result = await sql<FlightRow>`
    SELECT item."id"::text AS "id",
           item."agencyId"::text AS "agencyId",
           item."tripId"::text AS "tripId",
           item."state",
           item."sortOrder",
           item."customerTitle" AS "title",
           item."customerDescription" AS "description",
           item."customerBookingReference",
           item."lockVersion"::text AS "lockVersion",
           detail."carrier",
           detail."flightNumber",
           detail."departureAirport",
           detail."arrivalAirport",
           detail."departureDate"::text AS "departureDate",
           detail."departureTime"::text AS "departureTime",
           detail."departureTimezone",
           detail."departureInstant",
           detail."arrivalDate"::text AS "arrivalDate",
           detail."arrivalTime"::text AS "arrivalTime",
           detail."arrivalTimezone",
           detail."arrivalInstant",
           detail."terminal",
           detail."cabin",
           detail."baggage",
           detail."seat"
      FROM "trip_ops"."itinerary_item" AS item
      JOIN "trip_ops"."flight_item_detail" AS detail
        ON detail."agencyId" = item."agencyId"
       AND detail."tripId" = item."tripId"
       AND detail."itemId" = item."id"
     WHERE item."agencyId" = ${agencyId}::uuid
       AND item."tripId" = ${tripId}::uuid
       AND item."family" = 'FLIGHT'
     ORDER BY item."sortOrder", item."id"
     LIMIT 501
  `.execute(database);
  if (result.rows.length > 500) {
    throw new Error("Trip workspace exceeds the supported 500-flight read bound");
  }
  return result.rows.map(mapFlightRow);
};

const readAccommodations = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  tripId: OpaqueId,
): Promise<readonly AccommodationItem[]> => {
  const result = await sql<AccommodationRow>`
    SELECT item."id"::text AS "id",
           item."agencyId"::text AS "agencyId",
           item."tripId"::text AS "tripId",
           item."state",
           item."sortOrder",
           item."customerTitle" AS "title",
           item."customerDescription" AS "description",
           item."customerBookingReference",
           item."lockVersion"::text AS "lockVersion",
           detail."propertyName",
           detail."checkInDate"::text AS "checkInDate",
           detail."checkInTime"::text AS "checkInTime",
           detail."checkInTimezone",
           detail."checkInInstant",
           detail."checkOutDate"::text AS "checkOutDate",
           detail."checkOutTime"::text AS "checkOutTime",
           detail."checkOutTimezone",
           detail."checkOutInstant",
           detail."roomDescription",
           detail."boardType"
      FROM "trip_ops"."itinerary_item" AS item
      JOIN "trip_ops"."accommodation_item_detail" AS detail
        ON detail."agencyId" = item."agencyId"
       AND detail."tripId" = item."tripId"
       AND detail."itemId" = item."id"
     WHERE item."agencyId" = ${agencyId}::uuid
       AND item."tripId" = ${tripId}::uuid
       AND item."family" = 'ACCOMMODATION'
     ORDER BY item."sortOrder", item."id"
     LIMIT 501
  `.execute(database);
  if (result.rows.length > 500) {
    throw new Error("Trip workspace exceeds the supported 500-accommodation read bound");
  }
  return result.rows.map(mapAccommodationRow);
};

export const readTripWorkspace = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  tripId: OpaqueId,
): Promise<TripWorkspace | null> => {
  const trip = await readTripRow(database, agencyId, tripId);
  if (trip === null) return null;
  const [flights, accommodations] = await Promise.all([
    readFlights(database, agencyId, tripId),
    readAccommodations(database, agencyId, tripId),
  ]);
  return { trip: mapTripRow(trip), flights, accommodations };
};

const validateListInput = (limit: number, cursor: OpaqueId | null): void => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new InputValidationError("Trip workspace list limit is invalid");
  }
  if (cursor !== null) asOpaqueId(cursor);
};

export const createPostgresStaffTripWorkspaceRepository = (
  persistence: PostgresPersistence<DatabaseShape>,
): StaffTripWorkspaceReadRepository => {
  const repository: StaffTripWorkspaceReadRepository = {
    async listTrips(agencyId, limit, cursor, authorization: StaffAuthorizationOperationProof) {
      validateListInput(limit, cursor);
      return persistence.transaction.runInTransaction(async (context) =>
        persistence.withTransactionContext(context, async (database) => {
          await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`.execute(database);
          await assertStaffAuthorizationInTransaction(
            database,
            authorization,
            agencyId,
            WORKSPACE_READ_PERMISSIONS,
          );
          const result = await sql<TripRow>`
            SELECT "id"::text AS "id",
                   "agencyId"::text AS "agencyId",
                   "title",
                   "startDate"::text AS "startDate",
                   "endDate"::text AS "endDate",
                   "state",
                   "workspaceRevision"::text AS "workspaceRevision",
                   "lockVersion"::text AS "lockVersion"
              FROM "trip_ops"."trip"
             WHERE "agencyId" = ${agencyId}::uuid
               AND (${cursor}::uuid IS NULL OR "id" > ${cursor}::uuid)
             ORDER BY "id"
             LIMIT ${limit + 1}
          `.execute(database);
          const hasNextPage = result.rows.length > limit;
          const items = result.rows.slice(0, limit).map(mapTripRow);
          const lastItem = items[items.length - 1];
          return {
            items,
            nextCursor: hasNextPage && lastItem !== undefined ? lastItem.id : null,
          } satisfies TripWorkspacePage;
        }),
      );
    },

    async readTripWorkspace(agencyId, tripId, authorization: StaffAuthorizationOperationProof) {
      const normalizedTripId = asOpaqueId(tripId);
      return persistence.transaction.runInTransaction(async (context) =>
        persistence.withTransactionContext(context, async (database) => {
          await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`.execute(database);
          await assertStaffAuthorizationInTransaction(
            database,
            authorization,
            agencyId,
            WORKSPACE_READ_PERMISSIONS,
          );
          return readTripWorkspace(database, agencyId, normalizedTripId);
        }),
      );
    },
  };
  return Object.freeze(repository);
};
