import { describe, expect, it } from "vitest";

import {
  AdminQuoteAddLineV1RequestSchema,
  AdminQuoteCreateV1RequestSchema,
  AdminQuoteListQuerySchema,
  AdminQuoteMinorUnitsSchema,
  AdminQuoteSendV1RequestSchema,
} from "../src/admin/index.js";

const quoteId = "00000000-0000-7000-8000-000000000101";

describe("admin quote contracts", () => {
  it("accepts money only as non-negative integer minor-unit strings within bigint range", () => {
    expect(AdminQuoteMinorUnitsSchema.safeParse("0").success).toBe(true);
    expect(AdminQuoteMinorUnitsSchema.safeParse("123456").success).toBe(true);
    for (const value of ["12.50", "-1", "007", "9223372036854775808", "", 12]) {
      expect(AdminQuoteMinorUnitsSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects unknown keys on quote create and line requests, so internal fields cannot be smuggled in", () => {
    expect(
      AdminQuoteCreateV1RequestSchema.safeParse({
        leadId: quoteId,
        customerId: quoteId,
      }).success,
    ).toBe(false);
    expect(
      AdminQuoteAddLineV1RequestSchema.safeParse({
        section: "BASE",
        category: "OTHER",
        service: "Extra",
        ownerNote: "x",
      }).success,
    ).toBe(false);
  });

  it("requires a known section and category on line requests", () => {
    expect(
      AdminQuoteAddLineV1RequestSchema.safeParse({
        section: "HIDDEN",
        category: "OTHER",
        service: "x",
      }).success,
    ).toBe(false);
    expect(
      AdminQuoteAddLineV1RequestSchema.safeParse({
        section: "OPTION",
        category: "FLIGHT",
        service: "Voo",
        fromIata: "LIS",
        toIata: "PDL",
      }).success,
    ).toBe(true);
  });

  it("parses list queries with a default limit and rejects an unknown state filter", () => {
    expect(AdminQuoteListQuerySchema.parse({}).limit).toBe(25);
    expect(AdminQuoteListQuerySchema.safeParse({ state: "PAID" }).success).toBe(false);
    expect(AdminQuoteListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("keeps send expiry as a calendar date or null", () => {
    expect(AdminQuoteSendV1RequestSchema.parse({ expectedLockVersion: "1" }).expiresAt).toBeNull();
    expect(
      AdminQuoteSendV1RequestSchema.safeParse({
        expectedLockVersion: "1",
        expiresAt: "2026-13-40",
      }).success,
    ).toBe(false);
  });
});
