import { describe, expect, it } from "vitest";

import {
  addMoney,
  createMoney,
  createScheduledLocalDateTime,
  isUuidV7,
  moneyFromJson,
  moneyToJson,
  multiplyMoney,
  uuidV7FromEntropy,
} from "../../src/index.js";

describe("Stage 5 exact shared kernel", () => {
  it("keeps Money in bigint minor units and serializes only strings", () => {
    const price = createMoney("9007199254740993", "EUR", 2);
    expect(price.minorUnits).toBe(9007199254740993n);
    expect(moneyToJson(price)).toEqual({
      minorUnits: "9007199254740993",
      currency: "EUR",
      scale: 2,
    });
    expect(moneyFromJson(moneyToJson(price))).toEqual(price);
    expect(() => moneyFromJson({ ...moneyToJson(price), hidden: true })).toThrow(
      "unknown or missing field",
    );
    expect(() => createMoney(1n, "EUR", 0)).toThrow("pinned scale");
    expect(() => createMoney(1n, "toString")).toThrow("Unsupported ISO currency");
    expect(() => createMoney(1n, "constructor")).toThrow("Unsupported ISO currency");
    expect(createMoney("9223372036854775807", "EUR").minorUnits).toBe(9223372036854775807n);
    expect(() => createMoney("9223372036854775808", "EUR")).toThrow("signed bigint");
    expect(() => createMoney("-9223372036854775809", "EUR")).toThrow("signed bigint");
  });

  it("uses an explicit commercial policy and fails closed for unknown policy ids", () => {
    expect(
      multiplyMoney(createMoney(100n, "EUR"), "1.005", "COMMERCIAL_HALF_UP_V1").minorUnits,
    ).toBe(101n);
    expect(
      multiplyMoney(createMoney(-100n, "EUR"), "1.005", "COMMERCIAL_HALF_UP_V1").minorUnits,
    ).toBe(-101n);
    expect(() => multiplyMoney(createMoney(100n, "EUR"), "1.1", "UNKNOWN")).toThrow(
      "Unknown required rounding policy",
    );
    expect(addMoney(createMoney(2n, "EUR"), createMoney(3n, "EUR")).minorUnits).toBe(5n);
    expect(() => addMoney(createMoney(2n, "EUR"), createMoney(3n, "USD"))).toThrow("same currency");
  });

  it("constructs valid UUIDv7 opaque identifiers and rejects malformed values", () => {
    const id = uuidV7FromEntropy(1_700_000_000_000, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(isUuidV7(id)).toBe(true);
  });

  it("retains local civil time, zone and derived instant as separate validated values", () => {
    expect(
      createScheduledLocalDateTime({
        localDate: "2026-10-25",
        localTime: "02:30",
        timezoneName: "Europe/Lisbon",
        instant: "2026-10-25T02:30:00Z",
      }).timezoneName,
    ).toBe("Europe/Lisbon");
    expect(() =>
      createScheduledLocalDateTime({
        localDate: "2026-10-25",
        localTime: "02:30",
        timezoneName: "Not/AZone",
        instant: "2026-10-25T02:30:00Z",
      }),
    ).toThrow("Invalid IANA timezone");
    expect(() =>
      createScheduledLocalDateTime({
        localDate: "2026-09-25",
        localTime: "04:00",
        timezoneName: "US/Eastern",
        instant: "2026-09-25T08:00:00Z",
      }),
    ).toThrow("Invalid IANA timezone");
    expect(() =>
      createScheduledLocalDateTime({
        localDate: "2026-09-25",
        localTime: "13:00",
        timezoneName: "Asia/Kolkata",
        instant: "2026-09-25T07:30:00Z",
      }),
    ).toThrow("Invalid IANA timezone");
    expect(() =>
      createScheduledLocalDateTime({
        localDate: "2026-02-30",
        localTime: "02:30",
        timezoneName: "Europe/Lisbon",
        instant: "2026-03-02T02:30:00Z",
      }),
    ).toThrow("calendar-valid");
    expect(() =>
      createScheduledLocalDateTime({
        localDate: "0999-12-31",
        localTime: "02:30",
        timezoneName: "Europe/Lisbon",
        instant: "0999-12-31T02:30:00Z",
      }),
    ).toThrow("calendar-valid");
    expect(
      createScheduledLocalDateTime({
        localDate: "1000-01-01",
        localTime: "02:30",
        timezoneName: "UTC",
        instant: "1000-01-01T02:30:00Z",
      }).localDate,
    ).toBe("1000-01-01");
    expect(() =>
      createScheduledLocalDateTime({
        localDate: "2026-10-25",
        localTime: "02:30",
        timezoneName: "Europe/Lisbon",
        instant: "2026-10-25T03:30:00Z",
      }),
    ).toThrow("does not match");
    expect(() =>
      createScheduledLocalDateTime({
        localDate: "2026-03-02",
        localTime: "09:00",
        timezoneName: "Europe/Lisbon",
        instant: "2026-02-30T09:00:00Z",
      }),
    ).toThrow("calendar-valid");
    expect(() =>
      createScheduledLocalDateTime({
        localDate: "2026-09-26",
        localTime: "00:00",
        timezoneName: "UTC",
        instant: "2026-09-25T24:00:00Z",
      }),
    ).toThrow("valid RFC3339");
    expect(() =>
      createScheduledLocalDateTime({
        localDate: "2026-09-24",
        localTime: "08:01",
        timezoneName: "UTC",
        instant: "2026-09-25T00:00:00+16:00",
      }),
    ).toThrow("valid RFC3339");
    expect(() =>
      createScheduledLocalDateTime({
        localDate: "2026-09-24",
        localTime: "08:01",
        timezoneName: "UTC",
        instant: "2026-09-25T00:00:00.1234Z",
      }),
    ).toThrow("valid RFC3339");
    expect(() =>
      createScheduledLocalDateTime({
        localDate: "2026-09-24",
        localTime: "08:01",
        timezoneName: "UTC",
        instant: "2026-09-25T00:00:00+15:59",
      }),
    ).not.toThrow();
    expect(() =>
      createScheduledLocalDateTime({
        localDate: "2026-10-25",
        localTime: "01:30",
        timezoneName: "Europe/Lisbon",
        instant: "2026-10-25T00:30:00Z",
      }),
    ).not.toThrow();
    expect(() =>
      createScheduledLocalDateTime({
        localDate: "2026-10-25",
        localTime: "01:30",
        timezoneName: "Europe/Lisbon",
        instant: "2026-10-25T01:30:00Z",
      }),
    ).not.toThrow();
    expect(() =>
      createScheduledLocalDateTime({
        localDate: "2026-03-29",
        localTime: "01:30",
        timezoneName: "Europe/Lisbon",
        instant: "2026-03-29T01:30:00Z",
      }),
    ).toThrow("does not match");
  });

  it("bounds normalized UTC instants to inclusive four-digit calendar years", () => {
    expect(
      createScheduledLocalDateTime({
        localDate: "1000-01-01",
        localTime: "00:00:00",
        timezoneName: "UTC",
        instant: "1000-01-01T00:00:00.000Z",
      }).instant,
    ).toBe("1000-01-01T00:00:00.000Z");
    expect(
      createScheduledLocalDateTime({
        localDate: "9999-12-31",
        localTime: "23:59:59",
        timezoneName: "UTC",
        instant: "9999-12-31T23:59:59.999Z",
      }).instant,
    ).toBe("9999-12-31T23:59:59.999Z");

    expect(() =>
      createScheduledLocalDateTime({
        localDate: "1000-01-01",
        localTime: "00:52:00",
        timezoneName: "Africa/Johannesburg",
        instant: "1000-01-01T00:52:00+01:52",
      }),
    ).toThrow("four-digit UTC calendar year");
    expect(() =>
      createScheduledLocalDateTime({
        localDate: "9999-12-31",
        localTime: "16:00:00",
        timezoneName: "America/Los_Angeles",
        instant: "9999-12-31T16:00:00-08:00",
      }),
    ).toThrow("four-digit UTC calendar year");
  });
});
