import { describe, expect, it } from "vitest";

import {
  formatCalendarDate,
  formatDate,
  formatDateTime,
  formatDateTimeMedium,
  formatInstantInZone,
  wallClockInZone,
} from "../src/format.js";

describe("format", () => {
  it("shows local calendar dates as written", () => {
    expect(formatDate("2026-11-27")).toBe("27/11/2026");
  });

  it("converts instants to Europe/Lisbon, never UTC", () => {
    // 23:30 UTC on 30 June is already 00:30 on 1 July in Lisbon summer time (UTC+1).
    expect(formatDate("2026-06-30T23:30:00.000Z")).toBe("01/07/2026");
    expect(formatDateTime("2026-06-30T23:30:00.000Z")).toBe("01/07/2026, 00:30");
    expect(formatDateTime("2026-11-27T10:30:00.000Z")).toBe("27/11/2026, 10:30");
  });

  it("returns a dash for empty or invalid values", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime("nope")).toBe("—");
  });

  it("shows calendar dates without shifting the day", () => {
    expect(formatCalendarDate("2026-11-27")).toMatch(/27.*2026/u);
    expect(formatCalendarDate("2026-03-01")).toMatch(/01.*2026/u);
    expect(formatCalendarDate("not a date")).toBe("—");
  });

  it("shows medium date-times in Europe/Lisbon", () => {
    expect(formatDateTimeMedium("2026-06-30T23:30:00.000Z")).toMatch(/01.*07.*2026.*00:30/u);
    expect(formatDateTimeMedium(null)).toBe("—");
  });

  it("shows an instant in the zone of its itinerary item, with the zone named", () => {
    expect(formatInstantInZone("2026-07-01T10:00:00.000Z", "Atlantic/Madeira")).toBe(
      "01/07/2026, 11:00 (Atlantic/Madeira)",
    );
    expect(formatInstantInZone("2026-07-01T10:00:00.000Z", "America/New_York")).toBe(
      "01/07/2026, 06:00 (America/New_York)",
    );
    expect(formatInstantInZone("2026-07-01T10:00:00.000Z", "Not/AZone")).toBe("—");
    expect(formatInstantInZone("nope", "Europe/Lisbon")).toBe("—");
  });

  it("reads the wall clock of an instant in a zone, or reports an unknown zone", () => {
    expect(wallClockInZone(Date.parse("2026-01-15T12:00:00.000Z"), "Europe/Lisbon")).toBe(
      "2026-01-15T12:00:00",
    );
    expect(wallClockInZone(Date.parse("2026-01-15T12:00:00.000Z"), "Not/AZone")).toBeNull();
  });
});
