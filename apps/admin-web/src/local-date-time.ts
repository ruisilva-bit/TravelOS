import {
  AdminScheduledLocalDateTimeSchema,
  TRAVELOS_CANONICAL_TIMEZONE_NAMES,
} from "@travelos/contracts/admin";

import { wallClockInZone } from "./format.js";

const localDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;
const localTimePattern = /^(\d{2}):(\d{2})(?::(\d{2}))?$/u;
const canonicalTimezones = new Set<string>(TRAVELOS_CANONICAL_TIMEZONE_NAMES);

export const getZonedInstantCandidates = (
  localDate: string,
  localTime: string,
  timezoneName: string,
): readonly string[] => {
  const dateMatch = localDatePattern.exec(localDate);
  const timeMatch = localTimePattern.exec(localTime);
  if (!dateMatch || !timeMatch || !canonicalTimezones.has(timezoneName)) return [];

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? "0");
  if (year < 1000 || hour > 23 || minute > 59 || second > 59) return [];

  const localEpoch = Date.UTC(year, month - 1, day, hour, minute, second);
  const normalized = new Date(localEpoch);
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day
  ) {
    return [];
  }

  if (wallClockInZone(localEpoch, timezoneName) === null) return [];

  const requestedTuple = `${localDate}T${hour.toString().padStart(2, "0")}:${minute
    .toString()
    .padStart(2, "0")}:${second.toString().padStart(2, "0")}`;
  const offsets = new Set<number>();

  for (let deltaHours = -48; deltaHours <= 48; deltaHours += 3) {
    const sampledInstant = localEpoch + deltaHours * 60 * 60 * 1000;
    const wholeSecondInstant = Math.floor(sampledInstant / 1000) * 1000;
    const sampledLocal = wallClockInZone(wholeSecondInstant, timezoneName) ?? "";
    const [sampledDate, sampledTime] = sampledLocal.split("T");
    if (!sampledDate || !sampledTime) continue;
    const [sampledYear, sampledMonth, sampledDay] = sampledDate.split("-").map(Number);
    const [sampledHour, sampledMinute, sampledSecond] = sampledTime.split(":").map(Number);
    const sampledAsUtc = Date.UTC(
      sampledYear ?? 0,
      (sampledMonth ?? 1) - 1,
      sampledDay ?? 1,
      sampledHour ?? 0,
      sampledMinute ?? 0,
      sampledSecond ?? 0,
    );
    offsets.add(sampledAsUtc - wholeSecondInstant);
  }

  const candidates = new Set<string>();
  for (const offset of offsets) {
    const instant = localEpoch - offset;
    if ((wallClockInZone(instant, timezoneName) ?? "") !== requestedTuple) continue;
    const isoInstant = new Date(instant).toISOString();
    if (
      AdminScheduledLocalDateTimeSchema.safeParse({
        localDate,
        localTime,
        timezoneName,
        instant: isoInstant,
      }).success
    ) {
      candidates.add(isoInstant);
    }
  }

  return [...candidates].sort((left, right) => Date.parse(left) - Date.parse(right));
};
