import { describe, expect, it } from "vitest";

import {
  CRM_CUSTOMER_ROLES,
  hasSensitivePersonFields,
  redactSensitivePerson,
  utcToday,
  validateCustomerDetails,
  validateCustomerRoles,
  validatePersonDetails,
  validatePersonUpdate,
  validateSearchQuery,
} from "../../src/modules/crm/domain/crm.js";

const TODAY = "2026-11-27";

const validPerson = {
  givenName: "Ana",
  familyName: "Silva",
  email: "ana@example.test",
  phone: "+351 (21) 555-0100",
  nationality: "pt",
  notes: null,
};

describe("CRM customer validation", () => {
  it("trims names, normalizes blank optionals to null and keeps valid contact fields", () => {
    expect(
      validateCustomerDetails({
        displayName: "  Família Silva  ",
        email: "  family@example.test ",
        phone: "   ",
        notes: "Prefers aisle seats",
      }),
    ).toEqual({
      displayName: "Família Silva",
      email: "family@example.test",
      phone: null,
      notes: "Prefers aisle seats",
    });
  });

  it("rejects blank or over-long display names", () => {
    expect(() => validateCustomerDetails({ displayName: "   " })).toThrow(/must not be blank/u);
    expect(() => validateCustomerDetails({ displayName: "x".repeat(301) })).toThrow(/at most 300/u);
  });

  it("rejects malformed email addresses and phone characters", () => {
    expect(() => validateCustomerDetails({ displayName: "A", email: "not-an-email" })).toThrow(
      /Email is invalid/u,
    );
    expect(() => validateCustomerDetails({ displayName: "A", phone: "123abc" })).toThrow(
      /Phone may contain only/u,
    );
    expect(() => validateCustomerDetails({ displayName: "A", phone: "+()--" })).toThrow(
      /Phone may contain only/u,
    );
  });

  it("rejects notes longer than 4000 characters and non-text values", () => {
    expect(() => validateCustomerDetails({ displayName: "A", notes: "n".repeat(4001) })).toThrow(
      /at most 4000/u,
    );
    expect(() => validateCustomerDetails({ displayName: 42 })).toThrow(/must be text/u);
  });
});

describe("CRM person validation", () => {
  it("accepts a valid person and uppercases the ISO country code", () => {
    expect(validatePersonDetails(validPerson)).toEqual({
      ...validPerson,
      nationality: "PT",
    });
  });

  it("rejects nationality values that are not two ASCII letters", () => {
    expect(() => validatePersonDetails({ ...validPerson, nationality: "PRT" })).toThrow(
      /ISO 3166-1 alpha-2/u,
    );
    expect(() => validatePersonDetails({ ...validPerson, nationality: "P1" })).toThrow(
      /ISO 3166-1 alpha-2/u,
    );
  });

  it("requires given and family names", () => {
    expect(() => validatePersonDetails({ ...validPerson, givenName: " " })).toThrow(
      /given name must not be blank/u,
    );
    expect(() => validatePersonDetails({ ...validPerson, familyName: "" })).toThrow(
      /family name must not be blank/u,
    );
  });

  it("rejects future birth dates and impossible calendar dates", () => {
    expect(() => validatePersonUpdate({ ...validPerson, birthDate: "2026-11-28" }, TODAY)).toThrow(
      /must not be in the future/u,
    );
    expect(() => validatePersonUpdate({ ...validPerson, birthDate: "2026-02-30" }, TODAY)).toThrow(
      /not a real calendar date/u,
    );
    expect(() => validatePersonUpdate({ ...validPerson, birthDate: "27/11/2026" }, TODAY)).toThrow(
      /YYYY-MM-DD/u,
    );
  });

  it("accepts today as a birth date and leaves omitted sensitive fields undefined", () => {
    const draft = validatePersonUpdate({ ...validPerson, birthDate: TODAY }, TODAY);
    expect(draft.birthDate).toBe(TODAY);
    expect(draft.passportNumber).toBeUndefined();
    expect(draft.passportExpiry).toBeUndefined();
    expect(hasSensitivePersonFields(draft)).toBe(true);
  });

  it("treats a person update without sensitive keys as non-sensitive", () => {
    const draft = validatePersonUpdate(validPerson, TODAY);
    expect(hasSensitivePersonFields(draft)).toBe(false);
  });

  it("keeps explicit nulls as clears and bounds the passport number", () => {
    const cleared = validatePersonUpdate(
      { ...validPerson, passportNumber: null, passportExpiry: null },
      TODAY,
    );
    expect(cleared.passportNumber).toBeNull();
    expect(cleared.passportExpiry).toBeNull();
    expect(() =>
      validatePersonUpdate({ ...validPerson, passportNumber: "P".repeat(41) }, TODAY),
    ).toThrow(/at most 40/u);
  });
});

describe("CRM roles and search validation", () => {
  it("accepts each documented role once and rejects empty, unknown or repeated roles", () => {
    expect(validateCustomerRoles([...CRM_CUSTOMER_ROLES])).toEqual(CRM_CUSTOMER_ROLES);
    expect(() => validateCustomerRoles([])).toThrow(/At least one/u);
    expect(() => validateCustomerRoles(["OWNER"])).toThrow(/role is invalid/u);
    expect(() => validateCustomerRoles(["PAYER", "PAYER"])).toThrow(/must not repeat/u);
    expect(() => validateCustomerRoles("PAYER")).toThrow(/At least one/u);
  });

  it("bounds search text to 2..100 characters after trimming", () => {
    expect(validateSearchQuery("  ana ")).toBe("ana");
    expect(() => validateSearchQuery("a")).toThrow(/2 to 100/u);
    expect(() => validateSearchQuery(" ")).toThrow(/2 to 100/u);
    expect(() => validateSearchQuery("x".repeat(101))).toThrow(/2 to 100/u);
  });

  it("derives the UTC calendar day used for the birth date ceiling", () => {
    expect(utcToday(new Date("2026-11-27T23:30:00Z"))).toBe("2026-11-27");
  });
});

describe("sensitive redaction", () => {
  const stored = {
    id: "abcdef12-3456-7abc-8def-000000000010",
    givenName: "Ana",
    birthDate: "1980-01-02",
    passportNumber: "P1234567",
    passportExpiry: "2031-05-06",
  };

  it("blanks birthDate and passport fields for callers without traveller.view_sensitive", () => {
    expect(redactSensitivePerson(stored, false)).toEqual({
      ...stored,
      birthDate: null,
      passportNumber: null,
      passportExpiry: null,
    });
  });

  it("returns the stored values unchanged for callers with traveller.view_sensitive", () => {
    expect(redactSensitivePerson(stored, true)).toBe(stored);
  });
});
