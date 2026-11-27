/** Date formatting for staff screens: always pt-PT in the agency time zone, never UTC. */

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
