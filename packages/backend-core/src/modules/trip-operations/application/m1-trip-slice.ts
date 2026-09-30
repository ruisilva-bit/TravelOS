import {
  type Customer,
  type CustomerDraft,
  type CustomerPerson,
  type Person,
  type PersonDraft,
} from "../../crm/domain/continuity.js";
import { createScheduledLocalDateTime, createLocalDate } from "../../../shared-kernel/time.js";
import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import {
  validateDifferentAirports,
  validateTripDates,
  type AccommodationDraft,
  type FlightDraft,
  type M1TripSlice,
  type Reservation,
  type ReservationDraft,
  type Trip,
} from "../domain/m1-slice.js";
import {
  validateSupplierCostDraft,
  type SupplierCostDraft,
  type SupplierCostLine,
} from "../../finance-operations/domain/supplier-cost.js";

export interface CreateM1TripSliceInput {
  readonly agencyId: OpaqueId;
  readonly person: PersonDraft;
  readonly customer: CustomerDraft;
  readonly customerPersonRole: CustomerPerson["role"];
  readonly trip: Pick<Trip, "title" | "startDate" | "endDate" | "state">;
  readonly travellerRole: "PRIMARY_TRAVELLER";
  readonly flight: FlightDraft;
  readonly accommodation: AccommodationDraft;
  readonly reservation: ReservationDraft;
  readonly supplierCost: SupplierCostDraft;
}

export interface UpdateAccommodationInput {
  readonly agencyId: OpaqueId;
  readonly tripId: OpaqueId;
  readonly itemId: OpaqueId;
  readonly expectedLockVersion: bigint;
  readonly title: string;
  readonly description: string;
}

export interface UpdateInternalNoteInput {
  readonly agencyId: OpaqueId;
  readonly tripId: OpaqueId;
  readonly reservationId: OpaqueId;
  readonly expectedLockVersion: bigint;
  readonly internalNote: string;
}

export class M1OptimisticConflictError extends Error {
  readonly code = "OPTIMISTIC_CONFLICT" as const;

  constructor(message = "The M1 workspace record is stale") {
    super(message);
    this.name = "M1OptimisticConflictError";
  }
}

export class M1InputValidationError extends Error {
  readonly code = "M1_INPUT_VALIDATION" as const;

  constructor(message: string) {
    super(message);
    this.name = "M1InputValidationError";
  }
}

const runInputValidation = <Result>(work: () => Result): Result => {
  try {
    return work();
  } catch (error) {
    if (error instanceof M1InputValidationError) throw error;
    throw new M1InputValidationError(error instanceof Error ? error.message : "Invalid M1 input");
  }
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown, label: string): UnknownRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as UnknownRecord;
};

const exactRecord = (value: unknown, keys: readonly string[], label: string): UnknownRecord => {
  const record = asRecord(value, label);
  const actual = Object.keys(record).toSorted().join("\u0000");
  const expected = [...keys].toSorted().join("\u0000");
  if (actual !== expected) throw new Error(`${label} contains an unknown or missing field`);
  return record;
};

const requiredString = (
  record: UnknownRecord,
  key: string,
  label: string,
  {
    min = 0,
    max = Number.POSITIVE_INFINITY,
    trim = true,
  }: { readonly min?: number; readonly max?: number; readonly trim?: boolean } = {},
): string => {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = trim ? value.trim() : value;
  if (normalized.length < min) throw new Error(`${label} must not be blank`);
  if (normalized.length > max) throw new Error(`${label} exceeds its maximum length`);
  return normalized;
};

const nullableString = (
  record: UnknownRecord,
  key: string,
  label: string,
  max: number,
): string | null => {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${label} must be a string or null`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} exceeds its maximum length`);
  return normalized;
};

const oneOf = <Value extends string>(
  record: UnknownRecord,
  key: string,
  label: string,
  values: readonly Value[],
): Value => {
  const value = record[key];
  if (typeof value !== "string" || !values.includes(value as Value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Value;
};

const requiredOpaqueId = (record: UnknownRecord, key: string, label: string): OpaqueId => {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  if (value !== value.trim()) throw new Error(`${label} is invalid`);
  return asOpaqueId(value);
};

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

const requiredLockVersion = (record: UnknownRecord, key: string, label: string): bigint => {
  const value = record[key];
  if (typeof value !== "bigint" || value < 0n || value > POSTGRES_BIGINT_MAX) {
    throw new Error(`${label} is invalid`);
  }
  return value;
};

const parseScheduled = (value: unknown, label: string) => {
  const record = exactRecord(value, ["instant", "localDate", "localTime", "timezoneName"], label);
  return createScheduledLocalDateTime({
    localDate: requiredString(record, "localDate", `${label}.localDate`, { trim: false }),
    localTime: requiredString(record, "localTime", `${label}.localTime`, { trim: false }),
    timezoneName: requiredString(record, "timezoneName", `${label}.timezoneName`, {
      min: 1,
      max: 100,
      trim: false,
    }),
    instant: requiredString(record, "instant", `${label}.instant`, { trim: false }),
  });
};

const parsePerson = (value: unknown): PersonDraft => {
  const record = exactRecord(value, ["email", "familyName", "givenName"], "Person");
  const givenName = requiredString(record, "givenName", "Person given name", { min: 1, max: 200 });
  const familyName = requiredString(record, "familyName", "Person family name", {
    min: 1,
    max: 200,
  });
  const emailValue = record.email;
  const email =
    emailValue === null
      ? null
      : requiredString(record, "email", "Person email", { min: 1, max: 320 });
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error("Person email is invalid");
  }
  return { givenName, familyName, email };
};

const parseCustomer = (value: unknown): CustomerDraft => {
  const record = exactRecord(value, ["displayName"], "Customer");
  return {
    displayName: requiredString(record, "displayName", "Customer display name", {
      min: 1,
      max: 300,
    }),
  };
};

const parseTrip = (value: unknown): CreateM1TripSliceInput["trip"] => {
  const record = exactRecord(value, ["endDate", "startDate", "state", "title"], "Trip");
  const startDate = createLocalDate(
    requiredString(record, "startDate", "Trip start date", { trim: false }),
  );
  const endDate = createLocalDate(
    requiredString(record, "endDate", "Trip end date", { trim: false }),
  );
  validateTripDates(startDate, endDate);
  return {
    title: requiredString(record, "title", "Trip title", { min: 1, max: 300 }),
    startDate,
    endDate,
    state: oneOf(record, "state", "Trip state", [
      "DRAFT",
      "CONFIRMED",
      "IN_OPERATION",
      "COMPLETED",
      "CANCELLED",
    ] as const),
  };
};

const parseFlight = (value: unknown): FlightDraft => {
  const record = exactRecord(
    value,
    [
      "arrival",
      "arrivalAirport",
      "baggage",
      "cabin",
      "carrier",
      "customerBookingReference",
      "departure",
      "departureAirport",
      "description",
      "flightNumber",
      "seat",
      "terminal",
      "title",
    ],
    "Flight",
  );
  const departureAirport = requiredString(record, "departureAirport", "Flight departure airport", {
    min: 3,
    max: 3,
  });
  const arrivalAirport = requiredString(record, "arrivalAirport", "Flight arrival airport", {
    min: 3,
    max: 3,
  });
  validateDifferentAirports(departureAirport, arrivalAirport);
  return {
    title: requiredString(record, "title", "Flight title", { min: 1, max: 300 }),
    description: requiredString(record, "description", "Flight description", {
      min: 1,
      max: 10_000,
    }),
    carrier: requiredString(record, "carrier", "Flight carrier", { min: 1, max: 200 }),
    flightNumber: requiredString(record, "flightNumber", "Flight number", { min: 1, max: 50 }),
    departureAirport,
    arrivalAirport,
    departure: parseScheduled(record.departure, "Flight departure"),
    arrival: parseScheduled(record.arrival, "Flight arrival"),
    terminal: nullableString(record, "terminal", "Flight terminal", 100),
    cabin: nullableString(record, "cabin", "Flight cabin", 100),
    baggage: nullableString(record, "baggage", "Flight baggage", 500),
    seat: nullableString(record, "seat", "Flight seat", 50),
    customerBookingReference: nullableString(
      record,
      "customerBookingReference",
      "Flight customer booking reference",
      200,
    ),
  };
};

const parseAccommodation = (value: unknown): AccommodationDraft => {
  const record = exactRecord(
    value,
    [
      "boardType",
      "checkIn",
      "checkOut",
      "customerBookingReference",
      "description",
      "propertyName",
      "roomDescription",
      "title",
    ],
    "Accommodation",
  );
  return {
    title: requiredString(record, "title", "Accommodation title", { min: 1, max: 300 }),
    description: requiredString(record, "description", "Accommodation description", {
      min: 1,
      max: 10_000,
    }),
    propertyName: requiredString(record, "propertyName", "Accommodation property", {
      min: 1,
      max: 300,
    }),
    checkIn: parseScheduled(record.checkIn, "Accommodation check-in"),
    checkOut: parseScheduled(record.checkOut, "Accommodation check-out"),
    roomDescription: nullableString(
      record,
      "roomDescription",
      "Accommodation room description",
      500,
    ),
    boardType: nullableString(record, "boardType", "Accommodation board type", 200),
    customerBookingReference: nullableString(
      record,
      "customerBookingReference",
      "Accommodation customer booking reference",
      200,
    ),
  };
};

const parseReservation = (value: unknown): ReservationDraft => {
  const record = exactRecord(
    value,
    ["customerBookingReference", "state", "supplierName", "supplierReference"],
    "Reservation",
  );
  return {
    supplierName: requiredString(record, "supplierName", "Reservation supplier", {
      min: 1,
      max: 300,
    }),
    supplierReference: requiredString(
      record,
      "supplierReference",
      "Reservation supplier reference",
      {
        min: 1,
        max: 300,
      },
    ),
    customerBookingReference: nullableString(
      record,
      "customerBookingReference",
      "Reservation customer booking reference",
      200,
    ),
    state: oneOf(record, "state", "Reservation state", [
      "PROVISIONAL",
      "HELD",
      "CONFIRMED",
      "USED",
      "CANCELLED",
      "FAILED",
    ] as const),
  };
};

export interface M1OperationalSliceRepository {
  createM1TripSlice(input: CreateM1TripSliceInput): Promise<M1TripSlice>;
  getM1TripSlice(agencyId: OpaqueId, tripId: OpaqueId): Promise<M1TripSlice | null>;
  updateAccommodation(input: UpdateAccommodationInput): Promise<M1TripSlice>;
  updateInternalSupplierNote(input: UpdateInternalNoteInput): Promise<M1TripSlice>;
}

export const validateCreateM1TripSliceInput = (
  input: CreateM1TripSliceInput,
): CreateM1TripSliceInput =>
  runInputValidation(() => {
    const record = exactRecord(
      input,
      [
        "accommodation",
        "agencyId",
        "customer",
        "customerPersonRole",
        "flight",
        "person",
        "reservation",
        "supplierCost",
        "travellerRole",
        "trip",
      ],
      "M1 trip creation",
    );
    const agencyId = requiredOpaqueId(record, "agencyId", "Agency ID");
    const person = parsePerson(record.person);
    const customer = parseCustomer(record.customer);
    const customerPersonRole = oneOf(record, "customerPersonRole", "Customer-person role", [
      "PRIMARY_CONTACT",
      "TRAVELLER",
      "PAYER",
      "GUARDIAN",
    ] as const);
    if (record.travellerRole !== "PRIMARY_TRAVELLER") {
      throw new Error("M1 trip creation requires a PRIMARY_TRAVELLER");
    }
    const travellerRole = "PRIMARY_TRAVELLER" as const;
    const trip = parseTrip(record.trip);
    const flight = parseFlight(record.flight);
    const accommodation = parseAccommodation(record.accommodation);
    const reservation = parseReservation(record.reservation);
    const supplierCostRecord = exactRecord(
      record.supplierCost,
      ["amount", "internalNote"],
      "Supplier cost",
    );
    const supplierCost = validateSupplierCostDraft({
      amount: supplierCostRecord.amount as SupplierCostDraft["amount"],
      internalNote: requiredString(
        supplierCostRecord,
        "internalNote",
        "Internal supplier-cost note",
        {
          min: 1,
          max: 10_000,
        },
      ),
    });
    if (Date.parse(flight.departure.instant) >= Date.parse(flight.arrival.instant)) {
      throw new Error("Flight departure instant must be before arrival instant");
    }
    if (Date.parse(accommodation.checkIn.instant) >= Date.parse(accommodation.checkOut.instant)) {
      throw new Error("Accommodation check-in must be before check-out");
    }
    return {
      agencyId,
      person,
      customer,
      customerPersonRole,
      trip,
      travellerRole,
      flight,
      accommodation,
      reservation,
      supplierCost,
    };
  });

export const createM1TripSlice = async (
  repository: M1OperationalSliceRepository,
  input: CreateM1TripSliceInput,
): Promise<M1TripSlice> => {
  const validatedInput = validateCreateM1TripSliceInput(input);
  return repository.createM1TripSlice(validatedInput);
};

export const readM1TripSlice = async (
  repository: M1OperationalSliceRepository,
  agencyId: OpaqueId,
  tripId: OpaqueId,
): Promise<M1TripSlice | null> =>
  repository.getM1TripSlice(asOpaqueId(agencyId), asOpaqueId(tripId));

export const validateUpdateM1AccommodationInput = (input: unknown): UpdateAccommodationInput =>
  runInputValidation(() => {
    const record = exactRecord(
      input,
      ["agencyId", "description", "expectedLockVersion", "itemId", "title", "tripId"],
      "Accommodation update",
    );
    return {
      agencyId: requiredOpaqueId(record, "agencyId", "Agency ID"),
      tripId: requiredOpaqueId(record, "tripId", "Trip ID"),
      itemId: requiredOpaqueId(record, "itemId", "Itinerary item ID"),
      expectedLockVersion: requiredLockVersion(
        record,
        "expectedLockVersion",
        "Expected itinerary lock version",
      ),
      title: requiredString(record, "title", "Accommodation title", { min: 1, max: 300 }),
      description: requiredString(record, "description", "Accommodation description", {
        min: 1,
        max: 10_000,
      }),
    } satisfies UpdateAccommodationInput;
  });

export const updateM1Accommodation = async (
  repository: M1OperationalSliceRepository,
  input: UpdateAccommodationInput,
): Promise<M1TripSlice> =>
  repository.updateAccommodation(validateUpdateM1AccommodationInput(input));

export const validateUpdateM1InternalSupplierNoteInput = (
  input: unknown,
): UpdateInternalNoteInput =>
  runInputValidation(() => {
    const record = exactRecord(
      input,
      ["agencyId", "expectedLockVersion", "internalNote", "reservationId", "tripId"],
      "Internal supplier note update",
    );
    return {
      agencyId: requiredOpaqueId(record, "agencyId", "Agency ID"),
      tripId: requiredOpaqueId(record, "tripId", "Trip ID"),
      reservationId: requiredOpaqueId(record, "reservationId", "Reservation ID"),
      expectedLockVersion: requiredLockVersion(
        record,
        "expectedLockVersion",
        "Expected supplier-cost lock version",
      ),
      internalNote: requiredString(record, "internalNote", "Internal supplier-cost note", {
        min: 1,
        max: 10_000,
      }),
    } satisfies UpdateInternalNoteInput;
  });

export const updateM1InternalSupplierNote = async (
  repository: M1OperationalSliceRepository,
  input: UpdateInternalNoteInput,
): Promise<M1TripSlice> =>
  repository.updateInternalSupplierNote(validateUpdateM1InternalSupplierNoteInput(input));

export type M1RepositoryPerson = Person;
export type M1RepositoryCustomer = Customer;
export type M1RepositoryCustomerPerson = CustomerPerson;
export type M1RepositoryReservation = Reservation;
export type M1RepositorySupplierCost = SupplierCostLine;
