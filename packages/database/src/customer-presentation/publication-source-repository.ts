import {
  asOpaqueId,
  type ConfigurablePublicationField,
  type PublicationFieldVisibility,
  type PublicationSafeAccommodationSource,
  type PublicationSafeFlightSource,
  type PublicationVisibilityPolicy,
  type TripPublicationRevisionSource,
  type TripPublicationSourceReadPort,
} from "@travelos/backend-core";
import { sql, type Kysely } from "kysely";
import type { PostgresPersistence } from "../postgres/postgres-persistence.js";

type DatabaseShape = Record<string, never>;
type Database = Kysely<DatabaseShape>;

const fieldKeys = [
  "flight.description",
  "flight.terminal",
  "flight.cabin",
  "flight.baggage",
  "flight.seat",
  "flight.customerBookingReference",
  "accommodation.description",
  "accommodation.roomDescription",
  "accommodation.boardType",
  "accommodation.customerBookingReference",
] as const satisfies readonly ConfigurablePublicationField[];
const platformDefaults = Object.freeze(
  Object.fromEntries(fieldKeys.map((key) => [key, false])) as Record<
    ConfigurablePublicationField,
    boolean
  >,
);

export const publicationReaders = (
  database: Database,
): Omit<TripPublicationSourceReadPort, "withConsistentRead"> => ({
  async readTrip(agencyId, tripId) {
    const row = (
      await sql<{
        id: string;
        title: string;
        startDate: string;
        endDate: string;
        revision: string;
      }>`
      SELECT "id"::text AS id, "title" AS title, "startDate"::text AS "startDate",
             "endDate"::text AS "endDate", "workspaceRevision"::text AS revision
        FROM "trip_ops"."trip"
       WHERE "agencyId" = ${agencyId}::uuid AND "id" = ${tripId}::uuid
    `.execute(database)
    ).rows[0];
    return row === undefined
      ? null
      : ({
          tripId: asOpaqueId(row.id),
          title: row.title,
          startDate: row.startDate,
          endDate: row.endDate,
          workspaceRevision: BigInt(row.revision),
        } satisfies TripPublicationRevisionSource);
  },
  async listFlights(agencyId, tripId) {
    const rows = (
      await sql<{
        id: string;
        sortOrder: number;
        title: string;
        description: string;
        booking: string | null;
        carrier: string;
        flightNumber: string;
        departureAirport: string;
        arrivalAirport: string;
        departureDate: string;
        departureTime: string;
        departureZone: string;
        departureInstant: Date;
        arrivalDate: string;
        arrivalTime: string;
        arrivalZone: string;
        arrivalInstant: Date;
        terminal: string | null;
        cabin: string | null;
        baggage: string | null;
        seat: string | null;
      }>`
      SELECT item."id"::text AS id, item."sortOrder" AS "sortOrder",
             item."customerTitle" AS title, item."customerDescription" AS description,
             item."customerBookingReference" AS booking, flight."carrier" AS carrier,
             flight."flightNumber" AS "flightNumber", flight."departureAirport" AS "departureAirport",
             flight."arrivalAirport" AS "arrivalAirport", flight."departureDate"::text AS "departureDate",
             to_char(flight."departureTime", 'HH24:MI:SS') AS "departureTime",
             flight."departureTimezone" AS "departureZone", flight."departureInstant" AS "departureInstant",
             flight."arrivalDate"::text AS "arrivalDate", to_char(flight."arrivalTime", 'HH24:MI:SS') AS "arrivalTime",
             flight."arrivalTimezone" AS "arrivalZone", flight."arrivalInstant" AS "arrivalInstant",
             flight."terminal" AS terminal, flight."cabin" AS cabin, flight."baggage" AS baggage, flight."seat" AS seat
        FROM "trip_ops"."itinerary_item" AS item
        JOIN "trip_ops"."flight_item_detail" AS flight
          ON flight."agencyId"=item."agencyId" AND flight."tripId"=item."tripId" AND flight."itemId"=item."id"
       WHERE item."agencyId"=${agencyId}::uuid AND item."tripId"=${tripId}::uuid
         AND item."family"='FLIGHT' AND item."state"<>'CANCELLED'
       ORDER BY item."sortOrder", item."id"
    `.execute(database)
    ).rows;
    return rows.map((r): PublicationSafeFlightSource => ({
      sourceId: r.id,
      sortOrder: r.sortOrder,
      title: r.title,
      description: r.description,
      carrier: r.carrier,
      flightNumber: r.flightNumber,
      departureAirport: r.departureAirport,
      arrivalAirport: r.arrivalAirport,
      departure: {
        localDate: r.departureDate,
        localTime: r.departureTime,
        timeZone: r.departureZone,
        instant: r.departureInstant.toISOString(),
      },
      arrival: {
        localDate: r.arrivalDate,
        localTime: r.arrivalTime,
        timeZone: r.arrivalZone,
        instant: r.arrivalInstant.toISOString(),
      },
      terminal: r.terminal,
      cabin: r.cabin,
      baggage: r.baggage,
      seat: r.seat,
      customerBookingReference: r.booking,
    }));
  },
  async listAccommodations(agencyId, tripId) {
    const rows = (
      await sql<{
        id: string;
        sortOrder: number;
        title: string;
        description: string;
        booking: string | null;
        propertyName: string;
        checkInDate: string;
        checkInTime: string;
        checkInZone: string;
        checkInInstant: Date;
        checkOutDate: string;
        checkOutTime: string;
        checkOutZone: string;
        checkOutInstant: Date;
        roomDescription: string | null;
        boardType: string | null;
      }>`
      SELECT item."id"::text AS id, item."sortOrder" AS "sortOrder",
             item."customerTitle" AS title, item."customerDescription" AS description,
             item."customerBookingReference" AS booking, stay."propertyName" AS "propertyName",
             stay."checkInDate"::text AS "checkInDate", to_char(stay."checkInTime", 'HH24:MI:SS') AS "checkInTime",
             stay."checkInTimezone" AS "checkInZone", stay."checkInInstant" AS "checkInInstant",
             stay."checkOutDate"::text AS "checkOutDate", to_char(stay."checkOutTime", 'HH24:MI:SS') AS "checkOutTime",
             stay."checkOutTimezone" AS "checkOutZone", stay."checkOutInstant" AS "checkOutInstant",
             stay."roomDescription" AS "roomDescription", stay."boardType" AS "boardType"
        FROM "trip_ops"."itinerary_item" AS item
        JOIN "trip_ops"."accommodation_item_detail" AS stay
          ON stay."agencyId"=item."agencyId" AND stay."tripId"=item."tripId" AND stay."itemId"=item."id"
       WHERE item."agencyId"=${agencyId}::uuid AND item."tripId"=${tripId}::uuid
         AND item."family"='ACCOMMODATION' AND item."state"<>'CANCELLED'
       ORDER BY item."sortOrder", item."id"
    `.execute(database)
    ).rows;
    return rows.map((r): PublicationSafeAccommodationSource => ({
      sourceId: r.id,
      sortOrder: r.sortOrder,
      title: r.title,
      description: r.description,
      propertyName: r.propertyName,
      checkIn: {
        localDate: r.checkInDate,
        localTime: r.checkInTime,
        timeZone: r.checkInZone,
        instant: r.checkInInstant.toISOString(),
      },
      checkOut: {
        localDate: r.checkOutDate,
        localTime: r.checkOutTime,
        timeZone: r.checkOutZone,
        instant: r.checkOutInstant.toISOString(),
      },
      roomDescription: r.roomDescription,
      boardType: r.boardType,
      customerBookingReference: r.booking,
    }));
  },
  async readVisibilityPolicy(agencyId, tripId) {
    const rows = (
      await sql<{
        itemId: string;
        fieldKey: string;
        agencyChoice: "INHERIT" | "SHOW" | "HIDE" | null;
        itemChoice: "INHERIT" | "SHOW" | "HIDE" | null;
      }>`
      SELECT item."id"::text AS "itemId", fields."fieldKey" AS "fieldKey",
             agency."visibilityChoice" AS "agencyChoice", override."visibilityChoice" AS "itemChoice"
        FROM "trip_ops"."itinerary_item" AS item
        CROSS JOIN LATERAL (SELECT f."fieldKey" FROM (VALUES
          ('flight.description'),('flight.terminal'),('flight.cabin'),('flight.baggage'),('flight.seat'),
          ('flight.customerBookingReference'),('accommodation.description'),('accommodation.roomDescription'),
          ('accommodation.boardType'),('accommodation.customerBookingReference')
        ) AS f("fieldKey") WHERE (item."family"='FLIGHT' AND f."fieldKey" LIKE 'flight.%')
          OR (item."family"='ACCOMMODATION' AND f."fieldKey" LIKE 'accommodation.%')) AS fields
        LEFT JOIN "presentation"."agency_publication_visibility" AS agency
          ON agency."agencyId"=item."agencyId" AND agency."fieldKey"=fields."fieldKey"
        LEFT JOIN "presentation"."item_publication_visibility" AS override
          ON override."agencyId"=item."agencyId" AND override."tripId"=item."tripId"
         AND override."itemId"=item."id" AND override."fieldKey"=fields."fieldKey"
       WHERE item."agencyId"=${agencyId}::uuid AND item."tripId"=${tripId}::uuid
         AND item."state"<>'CANCELLED' ORDER BY item."id", fields."fieldKey"
    `.execute(database)
    ).rows;
    const fieldsByItemSourceId: Record<
      string,
      Partial<Record<ConfigurablePublicationField, PublicationFieldVisibility>>
    > = {};
    for (const row of rows) {
      const key = fieldKeys.find((field) => field === row.fieldKey);
      if (key === undefined) throw new Error("Unknown publication visibility field key");
      const itemFields = (fieldsByItemSourceId[row.itemId] ??= {});
      itemFields[key] = {
        classification: "CONFIGURABLE",
        platformDefault: platformDefaults[key],
        agencyDefault: row.agencyChoice ?? "INHERIT",
        itemOverride: row.itemChoice ?? "INHERIT",
      };
    }
    return { fieldsByItemSourceId } satisfies PublicationVisibilityPolicy;
  },
});

const outsideRead = (): never => {
  throw new Error("Publication reads require a consistent read transaction");
};

export const createTripPublicationSourceRepository = (
  persistence: PostgresPersistence<DatabaseShape>,
): TripPublicationSourceReadPort => ({
  async withConsistentRead(agencyId, tripId, read) {
    return persistence.withConnection((database) =>
      database
        .transaction()
        .setIsolationLevel("repeatable read")
        .setAccessMode("read only")
        .execute((transaction) => read(publicationReaders(transaction))),
    );
  },
  readTrip: async () => outsideRead(),
  listFlights: async () => outsideRead(),
  listAccommodations: async () => outsideRead(),
  readVisibilityPolicy: async () => outsideRead(),
});
