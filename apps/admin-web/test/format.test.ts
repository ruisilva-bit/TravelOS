import { describe, expect, it } from "vitest";

import { formatDate, formatDateTime } from "../src/format.js";

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
});
