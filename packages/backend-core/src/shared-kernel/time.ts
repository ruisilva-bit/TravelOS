export interface ScheduledLocalDateTime {
  readonly localDate: string;
  readonly localTime: string;
  readonly timezoneName: string;
  readonly instant: string;
}

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
const postgresTimezoneExclusionSet: ReadonlySet<string> = new Set(
  TRAVELOS_POSTGRESQL_TIMEZONE_EXCLUSIONS,
);

const canonicalTimezoneNames = (): readonly string[] => {
  const candidates = ["UTC", ...Intl.supportedValuesOf("timeZone")];
  const uniqueCandidates = [...new Set(candidates)];
  return uniqueCandidates.filter((timezoneName) => {
    try {
      return (
        new Intl.DateTimeFormat("en-US", { timeZone: timezoneName }).resolvedOptions().timeZone ===
          timezoneName && !postgresTimezoneExclusionSet.has(timezoneName as never)
      );
    } catch {
      return false;
    }
  });
};

export const TRAVELOS_CANONICAL_TIMEZONE_NAMES = Object.freeze(canonicalTimezoneNames());
const canonicalTimezoneSet = new Set(TRAVELOS_CANONICAL_TIMEZONE_NAMES);

export const isCanonicalTravelTimezone = (timezoneName: string): boolean =>
  canonicalTimezoneSet.has(timezoneName);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?![\s\S])/u;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?![\s\S])/u;
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)(?![\s\S])/u;

export const assertIanaTimezone = (timezoneName: string): void => {
  if (timezoneName.trim().length === 0) throw new Error("IANA timezone is required");
  if (!isCanonicalTravelTimezone(timezoneName)) {
    throw new Error(`Invalid IANA timezone: ${timezoneName}`);
  }
};

export const assertLocalDate = (localDate: string): void => {
  if (!DATE_PATTERN.test(localDate)) throw new Error("Local date must use YYYY-MM-DD");
  const [yearText, monthText, dayText] = localDate.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1000 ||
    year > 9999 ||
    !Number.isFinite(normalized.getTime()) ||
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day
  ) {
    throw new Error("Local date is not calendar-valid");
  }
};

const localPartsForInstant = (instant: string, timezoneName: string): string => {
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

export const createScheduledLocalDateTime = (
  input: ScheduledLocalDateTime,
): ScheduledLocalDateTime => {
  assertLocalDate(input.localDate);
  if (!TIME_PATTERN.test(input.localTime)) throw new Error("Local time is not valid");
  assertIanaTimezone(input.timezoneName);
  if (!RFC3339_PATTERN.test(input.instant) || !Number.isFinite(Date.parse(input.instant))) {
    throw new Error("Derived travel instant must be a valid RFC3339 timestamp");
  }
  assertLocalDate(input.instant.slice(0, 10));
  const normalizedUtcYear = new Date(input.instant).getUTCFullYear();
  if (normalizedUtcYear < 1000 || normalizedUtcYear > 9999) {
    throw new Error(
      "Derived travel instant must resolve to a supported four-digit UTC calendar year",
    );
  }
  const expectedLocalTime =
    input.localTime.length === 5 ? `${input.localTime}:00` : input.localTime;
  if (
    localPartsForInstant(input.instant, input.timezoneName) !==
    `${input.localDate}T${expectedLocalTime}`
  ) {
    throw new Error("Travel instant does not match the supplied local date/time and timezone");
  }
  return { ...input };
};

export const createLocalDate = (value: string): string => {
  assertLocalDate(value);
  return value;
};
