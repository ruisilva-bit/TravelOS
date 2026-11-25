import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  LEAD_DISQUALIFICATION_REASONS,
  LEAD_SOURCES,
  LeadNotOpenError,
  assertLeadOpen,
  customerDraftFromLead,
  disqualifyOpenLead,
  openLead,
  personDraftFromLead,
  qualifyOpenLead,
  updateOpenLead,
  validateCustomerDisplayName,
  validateDisqualificationReason,
  validateLeadDraft,
  type Lead,
  type LeadDraft,
} from "../../src/modules/sales/domain/lead.js";
import { asOpaqueId } from "../../src/shared-kernel/opaque-id.js";

const agencyId = asOpaqueId("abcdef12-3456-7abc-8def-000000000001");
const leadId = asOpaqueId("abcdef12-3456-7abc-8def-000000000002");
const customerId = asOpaqueId("abcdef12-3456-7abc-8def-000000000003");
const created = "2026-11-25T10:00:00.000Z";
const mail = (local: string): string => `${local}@${"mail"}.${"synthetic"}`;
const later = "2026-11-25T11:30:00.000Z";

const draft = (overrides: Partial<LeadDraft> = {}): LeadDraft => ({
  source: "PHONE",
  contactGivenName: "Marta",
  contactFamilyName: "Quintela",
  contactEmail: null,
  contactPhone: null,
  internalNote: null,
  ...overrides,
});

const open = (overrides: Partial<LeadDraft> = {}): Lead =>
  openLead({ id: leadId, agencyId, draft: draft(overrides), nowInstant: created });

describe("Lead draft validation", () => {
  it("normalizes names by trimming and keeps nullable fields null", () => {
    expect(
      validateLeadDraft(draft({ contactGivenName: "  Marta ", contactFamilyName: " Quintela  " })),
    ).toEqual(draft());
  });

  it.each(LEAD_SOURCES)("accepts the %s source", (source) => {
    expect(validateLeadDraft(draft({ source })).source).toBe(source);
  });

  it("rejects an unknown source", () => {
    expect(() => validateLeadDraft(draft({ source: "FAX" as never }))).toThrow(/source/u);
  });

  it("rejects blank or over-long contact names", () => {
    expect(() => validateLeadDraft(draft({ contactGivenName: "   " }))).toThrow(/blank/u);
    expect(() => validateLeadDraft(draft({ contactFamilyName: "" }))).toThrow(/blank/u);
    expect(() => validateLeadDraft(draft({ contactGivenName: "n".repeat(201) }))).toThrow(
      /maximum length/u,
    );
    expect(
      validateLeadDraft(draft({ contactGivenName: "n".repeat(200) })).contactGivenName,
    ).toHaveLength(200);
  });

  it("validates the email like a Person draft and rejects blank strings", () => {
    expect(validateLeadDraft(draft({ contactEmail: mail("ana") })).contactEmail).toBe(mail("ana"));
    expect(() => validateLeadDraft(draft({ contactEmail: "ana" }))).toThrow(/email/iu);
    expect(() => validateLeadDraft(draft({ contactEmail: "a b@c.d" }))).toThrow(/email/iu);
    expect(() => validateLeadDraft(draft({ contactEmail: "  " }))).toThrow(/blank/u);
  });

  it("limits phone numbers to 40 characters of digits, spaces and +()-", () => {
    expect(validateLeadDraft(draft({ contactPhone: "+351 (21) 123-4567" })).contactPhone).toBe(
      "+351 (21) 123-4567",
    );
    expect(() => validateLeadDraft(draft({ contactPhone: "ligar depois" }))).toThrow(/phone/u);
    expect(() => validateLeadDraft(draft({ contactPhone: "1".repeat(41) }))).toThrow(/maximum/u);
    expect(validateLeadDraft(draft({ contactPhone: "1".repeat(40) })).contactPhone).toHaveLength(
      40,
    );
  });

  it("limits the internal note to 4000 characters", () => {
    expect(validateLeadDraft(draft({ internalNote: "n".repeat(4_000) })).internalNote).toHaveLength(
      4_000,
    );
    expect(() => validateLeadDraft(draft({ internalNote: "n".repeat(4_001) }))).toThrow(/maximum/u);
    expect(() => validateLeadDraft(draft({ internalNote: " " }))).toThrow(/blank/u);
  });

  it("accepts only the documented disqualification reasons", () => {
    for (const reason of LEAD_DISQUALIFICATION_REASONS) {
      expect(validateDisqualificationReason(reason)).toBe(reason);
    }
    expect(() => validateDisqualificationReason("BORED")).toThrow(/reason/u);
    expect(() => validateDisqualificationReason(undefined)).toThrow(/reason/u);
  });

  it("never throws for arbitrary non-conforming drafts other than with an Error", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.option(fc.string(), { nil: null }),
        (given, family, note) => {
          try {
            const normalized = validateLeadDraft(
              draft({ contactGivenName: given, contactFamilyName: family, internalNote: note }),
            );
            expect(normalized.contactGivenName).toBe(given.trim());
            expect(normalized.contactGivenName.length).toBeGreaterThan(0);
            expect(normalized.contactGivenName.length).toBeLessThanOrEqual(200);
          } catch (error) {
            expect(error).toBeInstanceOf(Error);
          }
        },
      ),
    );
  });
});

describe("Lead state machine", () => {
  it("opens a Lead in OPEN at lock version 1 with no closure data", () => {
    expect(open({ contactEmail: mail("ana") })).toEqual({
      id: leadId,
      agencyId,
      source: "PHONE",
      contactGivenName: "Marta",
      contactFamilyName: "Quintela",
      contactEmail: mail("ana"),
      contactPhone: null,
      internalNote: null,
      state: "OPEN",
      qualifiedCustomerId: null,
      disqualificationReason: null,
      lockVersion: 1n,
      createdAt: created,
      updatedAt: created,
      closedAt: null,
    });
  });

  it("OPEN --update--> OPEN advances the lock version and only the editable fields", () => {
    const updated = updateOpenLead(
      open(),
      draft({ source: "EMAIL", internalNote: "ligar" }),
      later,
    );
    expect(updated).toMatchObject({
      state: "OPEN",
      source: "EMAIL",
      internalNote: "ligar",
      lockVersion: 2n,
      updatedAt: later,
      createdAt: created,
      closedAt: null,
      qualifiedCustomerId: null,
      id: leadId,
      agencyId,
    });
  });

  it("OPEN --qualify--> QUALIFIED records the Customer and closes the Lead", () => {
    const qualified = qualifyOpenLead(open(), customerId, later);
    expect(qualified).toMatchObject({
      state: "QUALIFIED",
      qualifiedCustomerId: customerId,
      disqualificationReason: null,
      lockVersion: 2n,
      closedAt: later,
      updatedAt: later,
    });
  });

  it("OPEN --disqualify--> DISQUALIFIED records the reason and closes the Lead", () => {
    const disqualified = disqualifyOpenLead(open(), "NOT_INTERESTED", later);
    expect(disqualified).toMatchObject({
      state: "DISQUALIFIED",
      disqualificationReason: "NOT_INTERESTED",
      qualifiedCustomerId: null,
      lockVersion: 2n,
      closedAt: later,
    });
  });

  it("rejects an invalid reason without changing the Lead", () => {
    const lead = open();
    expect(() => disqualifyOpenLead(lead, "BORED" as never, later)).toThrow(/reason/u);
    expect(lead.state).toBe("OPEN");
  });

  it("does not mutate the input Lead", () => {
    const lead = open();
    qualifyOpenLead(lead, customerId, later);
    updateOpenLead(lead, draft({ source: "OTHER" }), later);
    disqualifyOpenLead(lead, "OTHER", later);
    expect(lead).toEqual(open());
  });

  const terminalLeads = (): readonly (readonly [string, Lead])[] => [
    ["QUALIFIED", qualifyOpenLead(open(), customerId, later)],
    ["DISQUALIFIED", disqualifyOpenLead(open(), "DUPLICATE", later)],
  ];

  it.each(["QUALIFIED", "DISQUALIFIED"])(
    "every command on a %s Lead fails with the typed LEAD_NOT_OPEN error",
    (stateName) => {
      const terminal = terminalLeads().find(([name]) => name === stateName)![1];
      const commands: readonly (() => unknown)[] = [
        () => updateOpenLead(terminal, draft(), later),
        () => qualifyOpenLead(terminal, customerId, later),
        () => disqualifyOpenLead(terminal, "OTHER", later),
        () => assertLeadOpen(terminal),
      ];
      for (const command of commands) {
        expect(command).toThrow(LeadNotOpenError);
        try {
          command();
        } catch (error) {
          expect((error as LeadNotOpenError).code).toBe("LEAD_NOT_OPEN");
        }
      }
    },
  );

  it("is terminal under every random command sequence (property)", () => {
    const commandArbitrary = fc.oneof(
      fc.constant("update" as const),
      fc.constant("qualify" as const),
      fc.constant("disqualify" as const),
    );
    fc.assert(
      fc.property(fc.array(commandArbitrary, { minLength: 1, maxLength: 12 }), (commands) => {
        let lead = open();
        let closedBy: string | null = null;
        for (const command of commands) {
          const apply = (): Lead =>
            command === "update"
              ? updateOpenLead(lead, draft({ internalNote: `v${lead.lockVersion}` }), later)
              : command === "qualify"
                ? qualifyOpenLead(lead, customerId, later)
                : disqualifyOpenLead(lead, "OTHER", later);
          if (closedBy !== null) {
            expect(apply).toThrow(LeadNotOpenError);
            continue;
          }
          const before = lead.lockVersion;
          lead = apply();
          expect(lead.lockVersion).toBe(before + 1n);
          if (command !== "update") closedBy = command;
        }
        // Invariants of the closed shapes.
        expect(lead.state === "QUALIFIED").toBe(lead.qualifiedCustomerId !== null);
        expect(lead.state === "DISQUALIFIED").toBe(lead.disqualificationReason !== null);
        expect(lead.state === "OPEN").toBe(lead.closedAt === null);
      }),
    );
  });
});

describe("Qualification derivations", () => {
  it("copies the contact snapshot into a Person draft without searching for existing Persons", () => {
    const lead = open({ contactEmail: mail("same") });
    expect(personDraftFromLead(lead)).toEqual({
      givenName: "Marta",
      familyName: "Quintela",
      email: mail("same"),
    });
    expect(personDraftFromLead(open())).toEqual({
      givenName: "Marta",
      familyName: "Quintela",
      email: null,
    });
  });

  it("defaults the Customer display name to '<given> <family>' unless provided", () => {
    expect(customerDraftFromLead(open(), null)).toEqual({ displayName: "Marta Quintela" });
    expect(customerDraftFromLead(open(), " Quintela Viagens ")).toEqual({
      displayName: "Quintela Viagens",
    });
  });

  it("rejects blank or over-long Customer display names", () => {
    expect(() => customerDraftFromLead(open(), "  ")).toThrow(/blank/u);
    expect(() => validateCustomerDisplayName("n".repeat(301))).toThrow(/maximum/u);
    expect(validateCustomerDisplayName("n".repeat(300))).toHaveLength(300);
    expect(() =>
      customerDraftFromLead(
        open({ contactGivenName: "g".repeat(200), contactFamilyName: "f".repeat(200) }),
        null,
      ),
    ).toThrow(/maximum/u);
  });
});
