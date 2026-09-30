import { z } from "zod";

import { AdminLockVersionSchema } from "../lock-version.js";
import { AdminOpaqueIdSchema } from "../money.js";

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u;
const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/u;

// This exclusion set is the contract-layer mirror of the backend-core and
// migration registry. The contract tests assert byte-equivalent membership.
export const TRAVELOS_TIMEZONE_CONTRACT_VERSION = "TRAVELOS_TZ_V2_ICU_PG_COMMON";
export const TRAVELOS_POSTGRESQL_TIMEZONE_EXCLUSIONS = Object.freeze([
  "Africa/Asmera",
  "America/Buenos_Aires",
  "America/Catamarca",
  "America/Cordoba",
  "America/Godthab",
  "America/Indianapolis",
  "America/Jujuy",
  "America/Louisville",
  "America/Mendoza",
  "Asia/Calcutta",
  "Asia/Katmandu",
  "Asia/Rangoon",
  "Asia/Saigon",
  "Atlantic/Faeroe",
  "Europe/Kiev",
  "Pacific/Enderbury",
  "Pacific/Ponape",
  "Pacific/Truk",
] as const);
const postgresTimezoneExclusionSet = new Set(TRAVELOS_POSTGRESQL_TIMEZONE_EXCLUSIONS);

export const TRAVELOS_CANONICAL_TIMEZONE_NAMES = Object.freeze(
  ["UTC", ...Intl.supportedValuesOf("timeZone")]
    .filter((timezoneName, index, values) => values.indexOf(timezoneName) === index)
    .filter((timezoneName) => {
      try {
        return (
          new Intl.DateTimeFormat("en-US", { timeZone: timezoneName }).resolvedOptions()
            .timeZone === timezoneName && !postgresTimezoneExclusionSet.has(timezoneName as never)
        );
      } catch {
        return false;
      }
    }),
);
const canonicalTimezoneSet = new Set(TRAVELOS_CANONICAL_TIMEZONE_NAMES);

const isCanonicalTravelTimezone = (timezoneName: string): boolean =>
  canonicalTimezoneSet.has(timezoneName);

const isCalendarDate = (value: string): boolean => {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1000 &&
    year <= 9999 &&
    Number.isFinite(normalized.getTime()) &&
    normalized.getUTCFullYear() === year &&
    normalized.getUTCMonth() === month - 1 &&
    normalized.getUTCDate() === day
  );
};

const isInstantCalendarValid = (value: string): boolean => isCalendarDate(value.slice(0, 10));

const matchesLocalTuple = (value: {
  readonly localDate: string;
  readonly localTime: string;
  readonly timezoneName: string;
  readonly instant: string;
}): boolean => {
  try {
    const projected = new Intl.DateTimeFormat("en-GB", {
      timeZone: value.timezoneName,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(value.instant));
    const parts = new Map(projected.map((part) => [part.type, part.value]));
    const localTime = value.localTime.length === 5 ? `${value.localTime}:00` : value.localTime;
    return (
      `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}T${parts.get("hour")}:${parts.get("minute")}:${parts.get("second")}` ===
      `${value.localDate}T${localTime}`
    );
  } catch {
    return false;
  }
};

export const AdminScheduledLocalDateTimeSchema = z
  .object({
    localDate: z.string().regex(LOCAL_DATE),
    localTime: z.string().regex(LOCAL_TIME),
    timezoneName: z
      .string()
      .min(1)
      .max(100)
      .refine(isCanonicalTravelTimezone, "Timezone must be a canonical IANA identifier"),
    instant: z.string().regex(RFC3339),
  })
  .strict()
  .superRefine((value, context) => {
    if (!isCalendarDate(value.localDate)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["localDate"],
        message: "Invalid calendar date",
      });
    }
    if (!matchesLocalTuple(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["instant"],
        message: "Instant does not match the supplied local date/time and timezone",
      });
    }
    if (!isInstantCalendarValid(value.instant)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["instant"],
        message: "Invalid instant calendar date",
      });
    }
  });

export const AdminItineraryItemStateSchema = z.enum(["DRAFT", "CONFIRMED", "CANCELLED"]);

export const AdminFlightDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().min(1).max(10_000),
    carrier: z.string().trim().min(1).max(200),
    flightNumber: z.string().trim().min(1).max(50),
    departureAirport: z.string().trim().length(3),
    arrivalAirport: z.string().trim().length(3),
    departure: AdminScheduledLocalDateTimeSchema,
    arrival: AdminScheduledLocalDateTimeSchema,
    terminal: z.string().trim().max(100).nullable(),
    cabin: z.string().trim().max(100).nullable(),
    baggage: z.string().trim().max(500).nullable(),
    seat: z.string().trim().max(50).nullable(),
    customerBookingReference: z.string().trim().max(200).nullable(),
  })
  .strict();

export const AdminAccommodationDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().min(1).max(10_000),
    propertyName: z.string().trim().min(1).max(300),
    checkIn: AdminScheduledLocalDateTimeSchema,
    checkOut: AdminScheduledLocalDateTimeSchema,
    roomDescription: z.string().trim().max(500).nullable(),
    boardType: z.string().trim().max(200).nullable(),
    customerBookingReference: z.string().trim().max(200).nullable(),
  })
  .strict();

export const AdminFlightResponseSchema = z
  .object({
    id: AdminOpaqueIdSchema,
    agencyId: AdminOpaqueIdSchema,
    tripId: AdminOpaqueIdSchema,
    family: z.literal("FLIGHT"),
    state: AdminItineraryItemStateSchema,
    sortOrder: z.number().int().min(1),
    title: z.string(),
    description: z.string(),
    customerBookingReference: z.string().nullable(),
    lockVersion: AdminLockVersionSchema,
    carrier: z.string(),
    flightNumber: z.string(),
    departureAirport: z.string().length(3),
    arrivalAirport: z.string().length(3),
    departure: AdminScheduledLocalDateTimeSchema,
    arrival: AdminScheduledLocalDateTimeSchema,
    terminal: z.string().nullable(),
    cabin: z.string().nullable(),
    baggage: z.string().nullable(),
    seat: z.string().nullable(),
  })
  .strict();

export const AdminAccommodationResponseSchema = z
  .object({
    id: AdminOpaqueIdSchema,
    agencyId: AdminOpaqueIdSchema,
    tripId: AdminOpaqueIdSchema,
    family: z.literal("ACCOMMODATION"),
    state: AdminItineraryItemStateSchema,
    sortOrder: z.number().int().min(1),
    title: z.string(),
    description: z.string(),
    customerBookingReference: z.string().nullable(),
    lockVersion: AdminLockVersionSchema,
    propertyName: z.string(),
    checkIn: AdminScheduledLocalDateTimeSchema,
    checkOut: AdminScheduledLocalDateTimeSchema,
    roomDescription: z.string().nullable(),
    boardType: z.string().nullable(),
  })
  .strict();

export const AdminAccommodationUpdateRequestSchema = z
  .object({
    agencyId: AdminOpaqueIdSchema,
    tripId: AdminOpaqueIdSchema,
    itemId: AdminOpaqueIdSchema,
    expectedLockVersion: AdminLockVersionSchema,
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().min(1).max(10_000),
  })
  .strict();
