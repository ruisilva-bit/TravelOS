import { describe, expect, it } from "vitest";
import { getZonedInstantCandidates } from "../src/local-date-time.js";

describe("zoned local travel times", () => {
  it("derives the matching UTC instant for an unambiguous local time", () => {
    expect(getZonedInstantCandidates("2027-01-20", "10:15", "Europe/Lisbon")).toEqual([
      "2027-01-20T10:15:00.000Z",
    ]);
  });

  it("rejects a local time skipped by the timezone's daylight-saving transition", () => {
    expect(getZonedInstantCandidates("2027-03-28", "01:30", "Europe/Lisbon")).toEqual([]);
  });

  it("returns both valid instants for a repeated local time so the user can choose", () => {
    expect(getZonedInstantCandidates("2027-10-31", "01:30", "Europe/Lisbon")).toEqual([
      "2027-10-31T00:30:00.000Z",
      "2027-10-31T01:30:00.000Z",
    ]);
  });
});
