import { describe, expect, it, vi } from "vitest";

import {
  InputValidationError,
  QuoteNotFoundError,
  QuoteRuleError,
  QuoteStaleError,
  StaffAuthorizationError,
  asOpaqueId,
  createPublicQuoteOperations,
  createStaffQuoteOperations,
  type OpaqueId,
  type QuoteAggregate,
  type QuoteLeadContext,
  type QuoteLineRecord,
  type QuoteRecord,
  type QuoteRepository,
  type QuoteSharedRecord,
  type StaffPermissionId,
} from "../../src/index.js";

const id = (n: number): OpaqueId =>
  asOpaqueId(`abcdef12-3456-7abc-8def-${n.toString().padStart(12, "0")}`);

const agencyId = id(1);
const leadId = id(2);
const customerId = id(3);
const quoteId = id(4);
const nowEpochMs = Date.parse("2026-11-27T10:00:00.000Z");
const session = {
  sessionId: "staff-session-1",
  staffPrincipalId: "staff-principal-1",
  agencyId,
  authorizationEpoch: 2n,
  expiresAtEpochMs: nowEpochMs + 60_000,
  recentMfaVerifiedAtEpochMs: null,
};
const cookie = "staff-session-cookie";

const quoteRecord = (overrides: Partial<QuoteRecord> = {}): QuoteRecord => ({
  id: quoteId,
  agencyId,
  customerId,
  customerDisplayName: "Marta Quintela",
  leadId,
  number: "ORC-2026-0001",
  title: "Lisboa · Marta Quintela",
  destination: "Lisboa",
  startDate: "2027-03-10",
  endDate: "2027-03-17",
  adults: 2,
  children: 0,
  state: "DRAFT",
  validUntil: "2026-12-11",
  currencyCode: "EUR",
  pvpOverrideMinor: null,
  targetMarginBp: 1500,
  agencyNetShareBp: 2000,
  depositBp: 3000,
  balanceDueDays: 45,
  heroImageUrl: null,
  intro: "Uma semana tranquila.",
  internalNotes: "SEGREDO interno",
  excludedItems: ["Gorjetas"],
  convertedTripId: null,
  lockVersion: 3n,
  createdAt: "2026-11-27T09:00:00.000Z",
  updatedAt: "2026-11-27T09:00:00.000Z",
  ...overrides,
});

const lineRecord = (
  overrides: Partial<QuoteLineRecord> & { readonly n: number },
): QuoteLineRecord => {
  const { n, ...rest } = overrides;
  return {
    id: id(100 + n),
    quoteId,
    section: "BASE",
    position: n - 1,
    category: "OTHER",
    service: `Serviço ${n}`,
    supplier: "SEGREDO fornecedor",
    description: null,
    startDate: "2027-03-10",
    endDate: "2027-03-17",
    quantity: 1,
    netSupplierMinor: 70_000n,
    recommendedMinor: 95_000n,
    pvpMinor: 0n,
    customerVisible: true,
    imageUrl: null,
    internalNote: "SEGREDO nota",
    fromIata: null,
    toIata: null,
    departTime: null,
    arriveTime: null,
    carrier: null,
    flightNumber: null,
    baggage: null,
    roomType: null,
    boardBasis: null,
    location: null,
    lockVersion: 1n,
    ...rest,
  };
};

const flight = lineRecord({
  n: 1,
  category: "FLIGHT",
  service: "Voo LIS–FNC",
  startDate: "2027-03-10",
  endDate: "2027-03-10",
  fromIata: "LIS",
  toIata: "FNC",
  departTime: "08:15",
  arriveTime: "09:30",
  carrier: "TAP",
  flightNumber: "TP1234",
  baggage: "23 kg",
});
const hotel = lineRecord({
  n: 2,
  category: "ACCOMMODATION",
  service: "Hotel Estrela",
  location: "Funchal",
  roomType: "Duplo",
  boardBasis: "Meia pensão",
  pvpMinor: 120_000n,
  netSupplierMinor: 72_000n,
  recommendedMinor: 92_000n,
});

const storedAggregate = (overrides: Partial<QuoteAggregate> = {}): QuoteAggregate => ({
  quote: quoteRecord(),
  lines: [flight, hotel],
  days: [],
  versions: [],
  ...overrides,
});

const permissionsAll: readonly StaffPermissionId[] = [
  "quote.view",
  "quote.edit",
  "quote.send",
  "customer.view",
  "trip.edit",
];

const makeRepository = (overrides: Partial<QuoteRepository> = {}) => {
  const repository: QuoteRepository = {
    listQuotes: vi.fn(async () => ({ items: [quoteRecord()], nextCursor: null })),
    readAggregate: vi.fn(async () => storedAggregate()),
    readLeadContext: vi.fn(async (): Promise<QuoteLeadContext | null> => ({
      leadId,
      state: "QUALIFIED",
      customerId,
      customer: {
        customerId,
        displayName: "Marta Quintela",
        email: "marta.quintela@example.test",
        phone: "+351 912 345 678",
        primaryGivenName: "Marta",
      },
    })),
    insertQuote: vi.fn(async () => storedAggregate()),
    updateHeader: vi.fn(async () => "UPDATED"),
    insertLine: vi.fn(async () => ({ outcome: "CREATED", lineId: id(150) })),
    updateLine: vi.fn(async () => "UPDATED"),
    updateLines: vi.fn(async () => undefined),
    deleteLine: vi.fn(async () => "DELETED"),
    duplicateLine: vi.fn(async () => ({ outcome: "CREATED", lineId: id(151) })),
    reorderLines: vi.fn(async () => "UPDATED"),
    upsertDay: vi.fn(async () => "UPDATED"),
    deleteDay: vi.fn(async () => "DELETED"),
    resetDays: vi.fn(async () => "UPDATED"),
    setState: vi.fn(async () => "UPDATED"),
    publish: vi.fn(async (_agency, _quote, _lock, plan) => {
      const prepared = plan.prepare(storedAggregate());
      return {
        outcome: "UPDATED",
        version: {
          id: id(200),
          quoteId,
          versionNumber: 1,
          sentAt: "2026-11-27T10:00:00.000Z",
          pvpFinalMinor: prepared.pvpFinalMinor,
          currencyCode: prepared.currencyCode,
          payloadSha256: "00".repeat(32),
          acceptance: null,
          isLatest: true,
          shareLinks: [],
        },
        shareLink: null,
      };
    }),
    revokeShareLink: vi.fn(async () => "REVOKED"),
    convertToTrip: vi.fn(async () => ({ outcome: "UPDATED", tripId: id(300), created: true })),
    readQuoteShare: vi.fn(async (): Promise<QuoteSharedRecord | null> => null),
    acceptQuoteShare: vi.fn(async () => "ACCEPTED"),
    ...overrides,
  };
  const authorizationRepository = {
    getStaffAuthorizationSnapshot: vi.fn(async () => ({
      staffPrincipalId: session.staffPrincipalId,
      agencyId,
      membershipState: "ACTIVE" as const,
      authorizationEpoch: session.authorizationEpoch,
      assignments: permissionsAll.map((permissionId) => ({
        agencyId,
        permissionId,
        scopeKind: "AGENCY" as const,
        organizationUnitId: null,
        accessLevel: "ALL" as const,
        active: true,
      })),
    })),
  };
  return { repository, authorizationRepository };
};

const makeOperations = (
  repositoryOverrides: Partial<QuoteRepository> = {},
  options: { readonly permissions?: readonly StaffPermissionId[] } = {},
) => {
  const { repository, authorizationRepository } = makeRepository(repositoryOverrides);
  if (options.permissions !== undefined) {
    const granted = options.permissions;
    authorizationRepository.getStaffAuthorizationSnapshot = vi.fn(async () => ({
      staffPrincipalId: session.staffPrincipalId,
      agencyId,
      membershipState: "ACTIVE" as const,
      authorizationEpoch: session.authorizationEpoch,
      assignments: granted.map((permissionId) => ({
        agencyId,
        permissionId,
        scopeKind: "AGENCY" as const,
        organizationUnitId: null,
        accessLevel: "ALL" as const,
        active: true,
      })),
    }));
  }
  const operations = createStaffQuoteOperations({
    repository,
    authorizationRepository,
    sessionResolver: { resolveStaffSession: vi.fn(async () => session) },
    shareTokens: {
      randomBytes: (length) => new Uint8Array(length).fill(7),
      sha256: (bytes) => new Uint8Array(32).fill(bytes.length),
    },
    agencyDisplayName: "Agência Exemplo",
    publicBaseUrl: "https://propostas.example.test",
    nowEpochMs: () => nowEpochMs,
  });
  return { operations, repository };
};

describe("createQuote", () => {
  it("creates a quote from a qualified lead with the lead's customer and automatic defaults", async () => {
    const { operations, repository } = makeOperations();
    await operations.createQuote(cookie, leadId, { destination: "Lisboa" });
    expect(repository.insertQuote).toHaveBeenCalledWith(
      agencyId,
      expect.objectContaining({
        customerId,
        leadId,
        title: "Lisboa · Marta Quintela",
        adults: 2,
        children: 0,
        year: 2026,
        validUntil: "2026-12-11",
      }),
      expect.anything(),
    );
  });

  it("uses the generic title when no destination is given", async () => {
    const { operations, repository } = makeOperations();
    await operations.createQuote(cookie, leadId, {});
    expect(repository.insertQuote).toHaveBeenCalledWith(
      agencyId,
      expect.objectContaining({ title: "Orçamento Marta Quintela" }),
      expect.anything(),
    );
  });

  it("rejects a lead that has no customer yet", async () => {
    const { operations } = makeOperations({
      readLeadContext: vi.fn(async (): Promise<QuoteLeadContext | null> => ({
        leadId,
        state: "OPEN",
        customerId: null,
        customer: null,
      })),
    });
    await expect(operations.createQuote(cookie, leadId, {})).rejects.toMatchObject({
      code: "LEAD_NOT_QUALIFIED",
      message: "Qualifique a lead primeiro",
    });
  });

  it("denies creation without quote.edit and customer.view", async () => {
    const { operations, repository } = makeOperations({}, { permissions: ["quote.view"] });
    await expect(operations.createQuote(cookie, leadId, {})).rejects.toBeInstanceOf(
      StaffAuthorizationError,
    );
    expect(repository.insertQuote).not.toHaveBeenCalled();
  });

  it("rejects an invalid lead identifier before any authorization or storage", async () => {
    const { operations, repository } = makeOperations();
    await expect(
      operations.createQuote(cookie, "not-a-uuid" as OpaqueId, {}),
    ).rejects.toBeInstanceOf(InputValidationError);
    expect(repository.readLeadContext).not.toHaveBeenCalled();
  });
});

describe("line automations", () => {
  it("inherits the quote dates and builds the flight service name when none is given", async () => {
    const { operations, repository } = makeOperations({
      readAggregate: vi.fn(async () => storedAggregate({ lines: [] })),
    });
    await operations.addLine(cookie, quoteId, {
      section: "BASE",
      line: { category: "FLIGHT", fromIata: "LIS", toIata: "FNC", quantity: 1 },
    });
    expect(repository.insertLine).toHaveBeenCalledWith(
      agencyId,
      quoteId,
      "BASE",
      expect.objectContaining({
        service: "Voo LIS–FNC",
        startDate: "2027-03-10",
        endDate: "2027-03-17",
        quantity: 1,
      }),
      expect.anything(),
    );
  });

  it("copies the dates of the previous line in the same category", async () => {
    const earlier = lineRecord({
      n: 5,
      category: "ACTIVITY",
      startDate: "2027-03-12",
      endDate: "2027-03-12",
      position: 4,
    });
    const { operations, repository } = makeOperations({
      readAggregate: vi.fn(async () => storedAggregate({ lines: [earlier] })),
    });
    await operations.addLine(cookie, quoteId, {
      section: "BASE",
      line: { category: "ACTIVITY", service: "Levada" },
    });
    expect(repository.insertLine).toHaveBeenCalledWith(
      agencyId,
      quoteId,
      "BASE",
      expect.objectContaining({ startDate: "2027-03-12", endDate: "2027-03-12" }),
      expect.anything(),
    );
  });

  it("refuses to add lines once the quote left DRAFT", async () => {
    const { operations, repository } = makeOperations({
      readAggregate: vi.fn(async () => storedAggregate({ quote: quoteRecord({ state: "SENT" }) })),
    });
    await expect(
      operations.addLine(cookie, quoteId, {
        section: "BASE",
        line: { category: "OTHER", service: "X" },
      }),
    ).rejects.toMatchObject({ code: "NOT_DRAFT" });
    expect(repository.insertLine).not.toHaveBeenCalled();
  });

  it("rejects flight details on a non-flight line", async () => {
    const { operations } = makeOperations();
    await expect(
      operations.addLine(cookie, quoteId, {
        section: "BASE",
        line: { category: "OTHER", service: "X", fromIata: "LIS" },
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it("applies the target margin per unit, rounded up, to every base line", async () => {
    const { operations, repository } = makeOperations();
    await operations.applyTargetMargin(cookie, quoteId, { lineIds: null, rounding: "EURO" });
    const updates = vi.mocked(repository.updateLines).mock.calls[0]?.[2] ?? [];
    expect(updates.map((update) => update.line.pvpMinor)).toEqual([
      // agency net = 700 + 20% of (950 - 700) = 750; 750 / (1 - 0.15) = 882.35 -> 883 EUR
      88_300n,
      // agency net = 720 + 20% of (920 - 720) = 760; 760 / 0.85 = 894.12 -> 895 EUR
      89_500n,
    ]);
    expect(updates.map((update) => update.expectedLockVersion)).toEqual([1n, 1n]);
  });
});

describe("sendQuote", () => {
  it("freezes a customer snapshot with no internal fields and returns a ready message", async () => {
    const { operations, repository } = makeOperations();
    const sent = await operations.sendQuote(cookie, quoteId, {
      expectedLockVersion: 3n,
      expiresAt: null,
    });

    const publish = vi.mocked(repository.publish);
    expect(publish).toHaveBeenCalledTimes(1);
    const plan = publish.mock.calls[0]?.[3];
    const prepared = plan?.prepare(storedAggregate());
    const serialized = JSON.stringify(prepared?.payload);
    for (const forbidden of [
      "SEGREDO",
      "netSupplier",
      "recommended",
      "supplier",
      "internalNote",
      "agencyNet",
      "margin",
      "pvpMinor",
    ]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
    expect(prepared?.payload.agency.displayName).toBe("Agência Exemplo");
    expect(prepared?.payload.flights).toEqual([
      expect.objectContaining({
        direction: "OUTBOUND",
        fromIata: "LIS",
        toIata: "FNC",
        flightNumber: "TP1234",
      }),
    ]);

    expect(sent.versionNumber).toBe(1);
    expect(sent.url).toMatch(/^https:\/\/propostas\.example\.test\/v\/[A-Za-z0-9_-]{43}$/u);
    expect(sent.messageText).toContain(
      "Olá Marta, segue a vossa proposta para Lisboa (10/03/2027 – 17/03/2027)",
    );
    expect(sent.messageText).toContain("válida até 11/12/2026");
    expect(sent.mailtoUrl.startsWith("mailto:marta.quintela%40example.test?subject=")).toBe(true);
    expect(sent.whatsappUrl.startsWith("https://wa.me/351912345678?text=Ol%C3%A1%20Marta")).toBe(
      true,
    );
  });

  it("refuses to send a quote without a customer-visible base line", async () => {
    const { operations, repository } = makeOperations({
      readAggregate: vi.fn(async () =>
        storedAggregate({ lines: [lineRecord({ n: 9, customerVisible: false })] }),
      ),
    });
    await expect(
      operations.sendQuote(cookie, quoteId, { expectedLockVersion: 3n, expiresAt: null }),
    ).rejects.toMatchObject({ code: "NO_VISIBLE_LINES" });
    expect(repository.publish).not.toHaveBeenCalled();
  });

  it("refuses an expired validity date", async () => {
    const { operations } = makeOperations({
      readAggregate: vi.fn(async () =>
        storedAggregate({ quote: quoteRecord({ validUntil: "2026-11-01" }) }),
      ),
    });
    await expect(
      operations.sendQuote(cookie, quoteId, { expectedLockVersion: 3n, expiresAt: null }),
    ).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
  });

  it("maps a stale lock token from the repository to a conflict", async () => {
    const { operations } = makeOperations({
      publish: vi.fn(async () => {
        throw new QuoteStaleError();
      }),
    });
    await expect(
      operations.sendQuote(cookie, quoteId, { expectedLockVersion: 2n, expiresAt: null }),
    ).rejects.toMatchObject({ code: "OPTIMISTIC_CONFLICT" });
  });
});

describe("state and write outcomes", () => {
  it("maps NOT_FOUND from a header update to a quote not-found error", async () => {
    const { operations } = makeOperations({
      updateHeader: vi.fn(async () => "NOT_FOUND"),
    });
    await expect(
      operations.updateQuote(cookie, quoteId, {
        expectedLockVersion: 3n,
        patch: {
          title: "Nova",
          destination: null,
          startDate: null,
          endDate: null,
          adults: 2,
          children: 0,
          validUntil: "2026-12-11",
          pvpOverrideMinor: null,
          targetMarginBp: 1500,
          agencyNetShareBp: 2000,
          depositBp: 3000,
          balanceDueDays: 45,
          heroImageUrl: null,
          intro: null,
          internalNotes: null,
          excludedItems: [],
        },
      }),
    ).rejects.toBeInstanceOf(QuoteNotFoundError);
  });

  it("revising moves a SENT quote back to DRAFT and declining refuses a non-open state", async () => {
    const { operations, repository } = makeOperations({
      setState: vi.fn().mockResolvedValueOnce("INVALID_STATE").mockResolvedValueOnce("UPDATED"),
    });
    await expect(operations.declineQuote(cookie, quoteId, 3n)).rejects.toBeInstanceOf(
      QuoteRuleError,
    );
    await operations.reviseQuote(cookie, quoteId, 3n);
    expect(repository.setState).toHaveBeenLastCalledWith(
      agencyId,
      quoteId,
      3n,
      ["SENT"],
      "DRAFT",
      expect.anything(),
    );
  });

  it("converts only accepted quotes and reports the existing trip idempotently", async () => {
    const { operations } = makeOperations({
      convertToTrip: vi.fn(async () => ({ outcome: "UPDATED", tripId: id(300), created: false })),
    });
    await expect(operations.convertToTrip(cookie, quoteId)).resolves.toEqual({
      tripId: id(300),
      created: false,
    });

    const rejected = makeOperations({
      convertToTrip: vi.fn(async () => ({
        outcome: "INVALID_STATE",
        tripId: null,
        created: false,
      })),
    });
    await expect(rejected.operations.convertToTrip(cookie, quoteId)).rejects.toMatchObject({
      code: "NOT_ACCEPTED",
    });
  });

  it("requires trip.edit as well as quote.send to convert", async () => {
    const { operations, repository } = makeOperations({}, { permissions: ["quote.send"] });
    await expect(operations.convertToTrip(cookie, quoteId)).rejects.toBeInstanceOf(
      StaffAuthorizationError,
    );
    expect(repository.convertToTrip).not.toHaveBeenCalled();
  });
});

describe("public proposal access", () => {
  const shareRecord = (overrides: Partial<QuoteSharedRecord> = {}): QuoteSharedRecord => ({
    versionId: id(200),
    versionNumber: 1,
    payload: { schemaVersion: 1 },
    expiresAt: "2026-12-11T23:59:59.000Z",
    quoteState: "SENT",
    validUntil: "2026-12-11",
    isLatest: true,
    acceptance: null,
    ...overrides,
  });
  const token = "A".repeat(43);

  it("answers NOT_FOUND for malformed, unknown and revoked tokens alike", async () => {
    const repository = { readQuoteShare: vi.fn(async () => null), acceptQuoteShare: vi.fn() };
    const operations = createPublicQuoteOperations({
      repository,
      shareTokens: { randomBytes: () => new Uint8Array(32), sha256: () => new Uint8Array(32) },
    });
    await expect(operations.readPublicQuote("short", "2026-11-27")).rejects.toBeInstanceOf(
      QuoteNotFoundError,
    );
    await expect(operations.readPublicQuote(token, "2026-11-27")).rejects.toBeInstanceOf(
      QuoteNotFoundError,
    );
    expect(repository.readQuoteShare).toHaveBeenCalledTimes(1);
  });

  it("reports superseded versions and acceptance without exposing the link hash", async () => {
    const repository = {
      readQuoteShare: vi.fn(async () =>
        shareRecord({
          isLatest: false,
          acceptance: { acceptedAt: "2026-11-27T10:00:00.000Z", acceptedName: "Marta Quintela" },
        }),
      ),
      acceptQuoteShare: vi.fn(),
    };
    const operations = createPublicQuoteOperations({
      repository,
      shareTokens: {
        randomBytes: () => new Uint8Array(32),
        sha256: () => new Uint8Array(32).fill(1),
      },
    });
    const view = await operations.readPublicQuote(token, "2026-11-27");
    expect(view).toEqual({
      payload: { schemaVersion: 1 },
      isLatest: false,
      state: "SENT",
      validUntil: "2026-12-11",
      expired: false,
      accepted: { name: "Marta Quintela", at: "2026-11-27T10:00:00.000Z" },
    });
    expect(JSON.stringify(view)).not.toContain(token);
  });

  it("validates the accepted name and returns the repository outcome", async () => {
    const repository = {
      readQuoteShare: vi.fn(),
      acceptQuoteShare: vi.fn(async () => "SUPERSEDED"),
    };
    const operations = createPublicQuoteOperations({
      repository,
      shareTokens: { randomBytes: () => new Uint8Array(32), sha256: () => new Uint8Array(32) },
    });
    await expect(operations.acceptPublicQuote(token, "A")).rejects.toBeInstanceOf(
      InputValidationError,
    );
    await expect(operations.acceptPublicQuote(token, "  Marta Quintela  ")).resolves.toBe(
      "SUPERSEDED",
    );
    expect(repository.acceptQuoteShare).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "Marta Quintela",
    );
  });
});
