/**
 * Date and time formatting for staff screens. This is the only module that creates
 * `Intl.DateTimeFormat` objects: instants are shown in the agency time zone (Europe/Lisbon),
 * calendar dates are shown as written, and itinerary times are shown in their own IANA zone.
 */

const AGENCY_TIME_ZONE = "Europe/Lisbon";
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

const dateFormatter = new Intl.DateTimeFormat("pt-PT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: AGENCY_TIME_ZONE,
});

const dateTimeFormatter = new Intl.DateTimeFormat("pt-PT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: AGENCY_TIME_ZONE,
});

const calendarDateFormatter = new Intl.DateTimeFormat("pt-PT", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  // A calendar date has no zone. UTC midnight is used only so that the day never shifts.
  timeZone: "UTC",
});

const mediumDateTimeFormatter = new Intl.DateTimeFormat("pt-PT", {
  dateStyle: "medium",
  timeStyle: "short",
  hourCycle: "h23",
  timeZone: AGENCY_TIME_ZONE,
});

const zoneFormatters = new Map<string, Intl.DateTimeFormat | null>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat | null => {
  const cached = zoneFormatters.get(timeZone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat | null;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    formatter = null;
  }
  zoneFormatters.set(timeZone, formatter);
  return formatter;
};

/**
 * `YYYY-MM-DDTHH:MM:SS` wall-clock reading of an instant in an IANA zone, or null when the zone is
 * not known to the runtime. Used to check that a local date and time maps to a chosen instant.
 */
export const wallClockInZone = (instant: number, timeZone: string): string | null => {
  const formatter = formatterFor(timeZone);
  if (formatter === null) return null;
  const parts = new Map(
    formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}T${parts.get("hour")}:${parts.get("minute")}:${parts.get("second")}`;
};

/**
 * `YYYY-MM-DD` calendar dates are shown as written (no time zone shift); full instants are
 * converted to Europe/Lisbon. Returns "—" for empty or unparseable input.
 */
export const formatDate = (value: string | null | undefined): string => {
  if (value === null || value === undefined || value === "") return "—";
  const local = LOCAL_DATE.exec(value);
  if (local) return `${local[3]}/${local[2]}/${local[1]}`;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? "—" : dateFormatter.format(instant);
};

/** `27/11/2026, 14:30` in Europe/Lisbon. */
export const formatDateTime = (value: string | null | undefined): string => {
  if (value === null || value === undefined || value === "") return "—";
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? "—" : dateTimeFormatter.format(instant);
};

/** `27 nov. 2026, 14:30` in Europe/Lisbon, for lists and audit lines. */
export const formatDateTimeMedium = (value: string | null | undefined): string => {
  if (value === null || value === undefined || value === "") return "—";
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? "—" : mediumDateTimeFormatter.format(instant);
};

/** A calendar date in long form, e.g. `27 nov. 2026`; the day is never shifted. */
export const formatCalendarDate = (localDate: string): string => {
  const match = LOCAL_DATE.exec(localDate);
  if (!match) return "—";
  return calendarDateFormatter.format(new Date(`${localDate}T00:00:00.000Z`));
};

/**
 * An instant shown in a specific IANA zone, e.g. an itinerary time in the airport's zone.
 * Returns "—" for an invalid instant or an unknown zone.
 */
export const formatInstantInZone = (instant: string, timeZone: string): string => {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return "—";
  const wallClock = wallClockInZone(parsed.getTime(), timeZone);
  if (wallClock === null) return "—";
  const [date = "", time = ""] = wallClock.split("T");
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}, ${time.slice(0, 5)} (${timeZone})`;
};
