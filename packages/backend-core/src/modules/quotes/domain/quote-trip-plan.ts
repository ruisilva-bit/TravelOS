// Plans the trip that an accepted quote becomes: flight and accommodation itinerary items, their
// supplier reservations and the internal NET cost lines. Pure: no database, no clock.
//
// Times are local to the airport or hotel. Instants are derived from the local date, time and IANA
// zone, then checked by the shared scheduled-time validator, so the stored pair always agrees.
import {
  createScheduledLocalDateTime,
  type ScheduledLocalDateTime,
} from "../../../shared-kernel/time.js";
import type { AccommodationDraft, FlightDraft } from "../../trip-operations/domain/trip-slice.js";
import { QuoteRuleError, type QuoteLineRecord, type QuoteRecord } from "./quote-model.js";

/** IATA codes of the most common airports for a Portuguese agency; unknown codes use the default. */
export const AIRPORT_TIMEZONES: Readonly<Record<string, string>> = Object.freeze({
  LIS: "Europe/Lisbon",
  OPO: "Europe/Lisbon",
  FAO: "Europe/Lisbon",
  FNC: "Atlantic/Madeira",
  PXO: "Atlantic/Madeira",
  PDL: "Atlantic/Azores",
  TER: "Atlantic/Azores",
  HOR: "Atlantic/Azores",
  MAD: "Europe/Madrid",
  BCN: "Europe/Madrid",
  AGP: "Europe/Madrid",
  PMI: "Europe/Madrid",
  SVQ: "Europe/Madrid",
  LHR: "Europe/London",
  LGW: "Europe/London",
  EDI: "Europe/London",
  CDG: "Europe/Paris",
  ORY: "Europe/Paris",
  AMS: "Europe/Amsterdam",
  FRA: "Europe/Berlin",
  MUC: "Europe/Berlin",
  FCO: "Europe/Rome",
  MXP: "Europe/Rome",
  VCE: "Europe/Rome",
  ZRH: "Europe/Zurich",
  GVA: "Europe/Zurich",
  VIE: "Europe/Vienna",
  BRU: "Europe/Brussels",
  CPH: "Europe/Copenhagen",
  ARN: "Europe/Stockholm",
  OSL: "Europe/Oslo",
  HEL: "Europe/Helsinki",
  DUB: "Europe/Dublin",
  ATH: "Europe/Athens",
  IST: "Europe/Istanbul",
  PRG: "Europe/Prague",
  BUD: "Europe/Budapest",
  WAW: "Europe/Warsaw",
  KRK: "Europe/Warsaw",
  JFK: "America/New_York",
  EWR: "America/New_York",
  BOS: "America/New_York",
  MIA: "America/New_York",
  YYZ: "America/Toronto",
  GRU: "America/Sao_Paulo",
  GIG: "America/Sao_Paulo",
  SSA: "America/Bahia",
  REC: "America/Recife",
  FOR: "America/Fortaleza",
  NAT: "America/Fortaleza",
  CUN: "America/Cancun",
  PUJ: "America/Santo_Domingo",
  DXB: "Asia/Dubai",
  DOH: "Asia/Qatar",
  BKK: "Asia/Bangkok",
  SIN: "Asia/Singapore",
  MLE: "Indian/Maldives",
  CPT: "Africa/Johannesburg",
  JNB: "Africa/Johannesburg",
  RAK: "Africa/Casablanca",
  CMN: "Africa/Casablanca",
  SID: "Atlantic/Cape_Verde",
  RAI: "Atlantic/Cape_Verde",
});

export const DEFAULT_TRIP_TIMEZONE = "Europe/Lisbon";
export const ACCOMMODATION_CHECK_IN_TIME = "15:00";
export const ACCOMMODATION_CHECK_OUT_TIME = "11:00";
export const UNKNOWN_SUPPLIER_NAME = "Fornecedor por indicar";

export interface PlannedTripItem {
  readonly family: "FLIGHT" | "ACCOMMODATION";
  readonly sourceLineId: string;
  readonly flight: FlightDraft | null;
  readonly accommodation: AccommodationDraft | null;
}

export interface PlannedReservation {
  readonly supplierName: string;
  readonly supplierReference: string;
  readonly family: "FLIGHT" | "ACCOMMODATION";
  /** Indexes into the planned items; every item belongs to exactly one reservation. */
  readonly itemIndexes: readonly number[];
  readonly netMinor: bigint;
  readonly internalNote: string;
}

export interface QuoteTripPlan {
  readonly items: readonly PlannedTripItem[];
  readonly reservations: readonly PlannedReservation[];
}

const TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

const addDays = (localDate: string, days: number): string => {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** The zone's UTC offset in milliseconds at one instant. */
const offsetMs = (timezoneName: string, utcMs: number): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezoneName,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const wallClockAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return wallClockAsUtc - Math.floor(utcMs / 1000) * 1000;
};

/** Converts a local wall-clock time in an IANA zone to an RFC3339 UTC instant with milliseconds. */
export const localToInstant = (
  localDate: string,
  localTime: string,
  timezoneName: string,
): string => {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = localTime.split(":").map(Number);
  const wallClock = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
  const firstGuess = wallClock - offsetMs(timezoneName, wallClock);
  const corrected = wallClock - offsetMs(timezoneName, firstGuess);
  return new Date(corrected).toISOString();
};

const scheduled = (
  localDate: string,
  localTime: string,
  timezoneName: string,
): ScheduledLocalDateTime =>
  createScheduledLocalDateTime({
    localDate,
    localTime,
    timezoneName,
    instant: localToInstant(localDate, localTime, timezoneName),
  });

const zoneOf = (iata: string): { readonly timezoneName: string; readonly known: boolean } => {
  const known = AIRPORT_TIMEZONES[iata];
  return known === undefined
    ? { timezoneName: DEFAULT_TRIP_TIMEZONE, known: false }
    : { timezoneName: known, known: true };
};

const requireDetail = (value: string | null, message: string): string => {
  if (value === null || value.trim().length === 0) {
    throw new QuoteRuleError("TRIP_DETAILS_REQUIRED", message);
  }
  return value.trim();
};

const requireTime = (value: string | null, label: string): string => {
  const time = requireDetail(value, `Defina ${label} antes de converter`);
  if (!TIME_OF_DAY.test(time))
    throw new QuoteRuleError("TRIP_DETAILS_REQUIRED", `${label} é inválida`);
  return time;
};

const requireIata = (value: string | null, label: string): string => {
  const code = requireDetail(value, `Defina ${label} antes de converter`).toUpperCase();
  if (!/^[A-Z]{3}$/u.test(code))
    throw new QuoteRuleError("TRIP_DETAILS_REQUIRED", `${label} é inválido`);
  return code;
};

const flightItem = (
  line: QuoteLineRecord,
  departureDate: string,
  quoteNumber: string,
): { readonly draft: FlightDraft; readonly reviewNote: string | null } => {
  const fromIata = requireIata(line.fromIata, "o aeroporto de origem");
  const toIata = requireIata(line.toIata, "o aeroporto de destino");
  const departTime = requireTime(line.departTime, "a hora de partida");
  const arriveTime = requireTime(line.arriveTime, "a hora de chegada");
  if (fromIata === toIata) {
    throw new QuoteRuleError("TRIP_DETAILS_REQUIRED", "A origem e o destino do voo são iguais");
  }
  const departureZone = zoneOf(fromIata);
  const arrivalZone = zoneOf(toIata);
  const departure = scheduled(departureDate, departTime, departureZone.timezoneName);
  let arrivalDate = line.endDate ?? departureDate;
  let arrival = scheduled(arrivalDate, arriveTime, arrivalZone.timezoneName);
  // A flight that lands before it takes off on the same local calendar is an overnight arrival.
  if (Date.parse(arrival.instant) <= Date.parse(departure.instant)) {
    arrivalDate = addDays(arrivalDate, 1);
    arrival = scheduled(arrivalDate, arriveTime, arrivalZone.timezoneName);
  }
  const unknownZones = [
    departureZone.known ? null : fromIata,
    arrivalZone.known ? null : toIata,
  ].filter((code): code is string => code !== null);
  return {
    draft: {
      title: line.service.trim(),
      description: (line.description ?? line.service).trim(),
      carrier: (line.carrier ?? line.supplier ?? UNKNOWN_SUPPLIER_NAME).trim(),
      flightNumber: (line.flightNumber ?? "Por indicar").trim(),
      departureAirport: fromIata,
      arrivalAirport: toIata,
      departure,
      arrival,
      terminal: null,
      cabin: null,
      baggage: line.baggage?.trim() || null,
      seat: null,
      customerBookingReference: null,
    },
    reviewNote:
      unknownZones.length === 0
        ? null
        : `${quoteNumber}: fuso horário por confirmar (${unknownZones.join(", ")})`,
  };
};

const accommodationItem = (
  line: QuoteLineRecord,
  quote: QuoteRecord,
  inboundTimezone: string,
): AccommodationDraft => {
  const checkInDate = line.startDate ?? quote.startDate;
  if (checkInDate === null) {
    throw new QuoteRuleError("DATES_REQUIRED", "Defina as datas da viagem antes de converter");
  }
  const checkOutDate = line.endDate ?? quote.endDate ?? addDays(checkInDate, 1);
  const checkOutLocal = checkOutDate > checkInDate ? checkOutDate : addDays(checkInDate, 1);
  const checkIn = scheduled(checkInDate, ACCOMMODATION_CHECK_IN_TIME, inboundTimezone);
  const checkOut = scheduled(checkOutLocal, ACCOMMODATION_CHECK_OUT_TIME, inboundTimezone);
  return {
    title: line.service.trim(),
    description: (line.description ?? line.service).trim(),
    propertyName: line.service.trim(),
    checkIn,
    checkOut,
    roomDescription: line.roomType?.trim() || null,
    boardType: line.boardBasis?.trim() || null,
    customerBookingReference: null,
  };
};

/**
 * Plans the items, reservations and NET cost lines for an accepted quote. Only BASE-section flight
 * and accommodation lines become itinerary items; other categories stay on the quote.
 */
export const planQuoteTrip = (
  quote: QuoteRecord,
  lines: readonly QuoteLineRecord[],
): QuoteTripPlan => {
  const base = lines
    .filter((line) => line.section === "BASE")
    .toSorted((left, right) => left.position - right.position);
  const flights = base.filter((line) => line.category === "FLIGHT");
  const accommodations = base.filter((line) => line.category === "ACCOMMODATION");
  if (flights.length === 0 && accommodations.length === 0) {
    return { items: [], reservations: [] };
  }
  const quoteStart = quote.startDate;
  if (quoteStart === null || quote.endDate === null) {
    throw new QuoteRuleError("DATES_REQUIRED", "Defina as datas da viagem antes de converter");
  }

  const items: PlannedTripItem[] = [];
  // Review notes are kept per item, so each reservation carries exactly its own warnings.
  const reviewByItem: (string | null)[] = [];
  const itemMeta: {
    readonly family: "FLIGHT" | "ACCOMMODATION";
    readonly line: QuoteLineRecord;
  }[] = [];

  // Flights first, in quote order. The first flight's arrival zone is the destination zone, which
  // sets the check-in and check-out zone for the accommodation.
  let destinationTimezone: string = DEFAULT_TRIP_TIMEZONE;
  flights.forEach((line, index) => {
    const planned = flightItem(line, line.startDate ?? quoteStart, quote.number);
    reviewByItem.push(planned.reviewNote);
    if (index === 0) destinationTimezone = zoneOf(planned.draft.arrivalAirport).timezoneName;
    items.push({
      family: "FLIGHT",
      sourceLineId: line.id,
      flight: planned.draft,
      accommodation: null,
    });
    itemMeta.push({ family: "FLIGHT", line });
  });
  for (const line of accommodations) {
    reviewByItem.push(null);
    items.push({
      family: "ACCOMMODATION",
      sourceLineId: line.id,
      flight: null,
      accommodation: accommodationItem(line, quote, destinationTimezone),
    });
    itemMeta.push({ family: "ACCOMMODATION", line });
  }

  // One reservation per supplier and category; the NET cost is the sum of its lines.
  const groups = new Map<
    string,
    {
      supplierName: string;
      family: "FLIGHT" | "ACCOMMODATION";
      itemIndexes: number[];
      netMinor: bigint;
    }
  >();
  itemMeta.forEach(({ family, line }, index) => {
    const supplierName = line.supplier?.trim() || UNKNOWN_SUPPLIER_NAME;
    const key = `${family}\u0000${supplierName}`;
    const group = groups.get(key) ?? { supplierName, family, itemIndexes: [], netMinor: 0n };
    group.itemIndexes.push(index);
    group.netMinor += line.netSupplierMinor;
    groups.set(key, group);
  });

  const reservations: PlannedReservation[] = [...groups.values()].map((group) => ({
    supplierName: group.supplierName,
    supplierReference: quote.number,
    family: group.family,
    itemIndexes: group.itemIndexes,
    netMinor: group.netMinor,
    internalNote: [
      `NET do orçamento ${quote.number}`,
      ...group.itemIndexes.flatMap((index) => reviewByItem[index] ?? []),
    ].join("; "),
  }));

  return { items, reservations };
};
