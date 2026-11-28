import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every date and time shown to staff goes through src/format.ts, so the agency zone rule lives in
// one place. A new ad-hoc Intl formatter anywhere else fails this test.
const sourceDirectory = new URL("../src/", import.meta.url);
const sourceFiles = readdirSync(sourceDirectory).filter((name) => /\.(ts|tsx)$/u.test(name));

const readSource = (name: string): string => readFileSync(new URL(name, sourceDirectory), "utf8");

describe("date formatting boundary", () => {
  it("creates Intl.DateTimeFormat objects only in format.ts", () => {
    const offenders = sourceFiles
      .filter((name) => name !== "format.ts")
      .filter((name) => /Intl\.DateTimeFormat|\bnew\s+DateTimeFormat\b/u.test(readSource(name)));
    expect(offenders).toEqual([]);
  });

  it("keeps UTC out of staff-facing date displays outside format.ts", () => {
    const offenders = sourceFiles
      .filter((name) => name !== "format.ts")
      .filter((name) => /timeZone:\s*["']UTC["']/u.test(readSource(name)));
    expect(offenders).toEqual([]);
  });

  it("still formats the agency zone in format.ts", () => {
    expect(readSource("format.ts")).toContain('const AGENCY_TIME_ZONE = "Europe/Lisbon";');
  });
});
