import { z } from "zod";

const PortalScheduledTripTimeV1Schema = z
  .object({
    localDate: z.iso.date(),
    localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/u),
    timeZone: z.string().min(1).max(100),
    instant: z.iso
      .datetime({ offset: true })
      .refine((value) => !/\.\d{4,}(?:Z|[+-]\d{2}:\d{2})$/u.test(value)),
  })
  .strict();

const PortalTripFlightV1Schema = z
  .object({
    kind: z.literal("FLIGHT"),
    title: z.string().min(1).max(300),
    description: z.string().max(10_000).nullable(),
    carrier: z.string().min(1).max(200),
    flightNumber: z.string().min(1).max(50),
    departureAirport: z.string().length(3),
    arrivalAirport: z.string().length(3),
    departure: PortalScheduledTripTimeV1Schema,
    arrival: PortalScheduledTripTimeV1Schema,
    terminal: z.string().max(100).nullable(),
    cabin: z.string().max(100).nullable(),
    baggage: z.string().max(500).nullable(),
    seat: z.string().max(50).nullable(),
    customerBookingReference: z.string().max(200).nullable(),
  })
  .strict();

const PortalTripAccommodationV1Schema = z
  .object({
    kind: z.literal("ACCOMMODATION"),
    title: z.string().min(1).max(300),
    description: z.string().max(10_000).nullable(),
    propertyName: z.string().min(1).max(300),
    checkIn: PortalScheduledTripTimeV1Schema,
    checkOut: PortalScheduledTripTimeV1Schema,
    roomDescription: z.string().max(500).nullable(),
    boardType: z.string().max(200).nullable(),
    customerBookingReference: z.string().max(200).nullable(),
  })
  .strict();

/** Independently authored, strict customer allowlist; never derive from Admin/domain rows. */
export const PortalTripSnapshotV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    trip: z
      .object({
        title: z.string().min(1).max(300),
        startDate: z.iso.date(),
        endDate: z.iso.date(),
      })
      .strict(),
    items: z.array(
      z.discriminatedUnion("kind", [PortalTripFlightV1Schema, PortalTripAccommodationV1Schema]),
    ),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.trip.startDate > snapshot.trip.endDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trip", "endDate"],
        message: "Trip end date must not precede its start date",
      });
    }
    for (const [index, item] of snapshot.items.entries()) {
      const start = item.kind === "FLIGHT" ? item.departure.instant : item.checkIn.instant;
      const end = item.kind === "FLIGHT" ? item.arrival.instant : item.checkOut.instant;
      if (Date.parse(start) >= Date.parse(end)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index],
          message: "Itinerary interval must have positive duration",
        });
      }
      if (item.kind === "FLIGHT" && item.departureAirport === item.arrivalAirport) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "arrivalAirport"],
          message: "Flight airports must differ",
        });
      }
    }
  });

export type PortalTripSnapshotV1 = z.infer<typeof PortalTripSnapshotV1Schema>;
