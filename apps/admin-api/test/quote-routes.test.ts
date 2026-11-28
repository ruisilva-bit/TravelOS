import { describe, expect, it, vi } from "vitest";
import {
  asOpaqueId,
  QuoteNotFoundError,
  QuoteRuleError,
  QuoteStaleError,
  StaffAuthorizationError,
  type QuoteView,
  type StaffQuoteOperations,
  type StaffTripOperations,
} from "@travelos/backend-core";
import type { AuthSurfacePolicy } from "@travelos/auth-adapters";
import { registerAdminRoutes, type AdminExpressApplication } from "../src/admin-routes.js";

const policy: AuthSurfacePolicy = {
  canonicalOrigin: "https://admin.example.test",
  expectedHost: "admin.example.test",
};
const quoteId = "00000000-0000-7000-8000-000000000101";
const lineId = "00000000-0000-7000-8000-000000000102";
const leadId = "00000000-0000-7000-8000-000000000103";
const linkId = "00000000-0000-7000-8000-000000000104";
const customerId = "00000000-0000-7000-8000-000000000105";
const agencyId = "00000000-0000-7000-8000-000000000001";

const quoteRecord = () => ({
  id: asOpaqueId(quoteId),
  agencyId: asOpaqueId(agencyId),
  customerId: asOpaqueId(customerId),
  customerDisplayName: "Marta Quintela",
  leadId: asOpaqueId(leadId),
  number: "ORC-2026-0001",
  title: "Açores",
  destination: "Açores",
  startDate: "2027-05-01",
  endDate: "2027-05-08",
  adults: 2,
  children: 0,
  state: "DRAFT" as const,
  validUntil: "2026-12-12",
  currencyCode: "EUR",
  pvpOverrideMinor: 250_000n,
  targetMarginBp: 1500,
  agencyNetShareBp: 2000,
  depositBp: 3000,
  balanceDueDays: 45,
  heroImageUrl: null,
  intro: null,
  internalNotes: "SEGREDO interno",
  excludedItems: [],
  convertedTripId: null,
  lockVersion: 3n,
  createdAt: "2026-11-28T00:00:00.000Z",
  updatedAt: "2026-11-28T00:00:00.000Z",
});

const quoteView = (): QuoteView => ({
  quote: quoteRecord(),
  lines: [],
  days: [],
  totals: {
    baseNetSupplierMinor: 100_000n,
    baseRecommendedMinor: 120_000n,
    baseAgencyNetMinor: 104_000n,
    baseLinesPvpMinor: 130_000n,
    pvpFinalMinor: 250_000n,
    profitMinor: 146_000n,
    profitBp: 5840,
    recommendedMarginMinor: 26_000n,
    recommendedMarginBp: 1000,
    perPersonMinor: 125_000n,
    depositMinor: 75_000n,
    balanceMinor: 175_000n,
    balanceDueDate: "2027-03-17",
    balanceDueNow: false,
    optionsPvp: [],
  },
  warnings: [{ code: "NO_FLIGHT" }],
  included: [],
  excluded: [],
  versions: [],
  today: "2026-11-28",
});

const makeOperations = (): { [Key in keyof StaffQuoteOperations]: ReturnType<typeof vi.fn> } => ({
  listQuotes: vi.fn(),
  createQuote: vi.fn(),
  getQuote: vi.fn(),
  updateQuote: vi.fn(),
  addLine: vi.fn(),
  updateLine: vi.fn(),
  deleteLine: vi.fn(),
  duplicateLine: vi.fn(),
  reorderLines: vi.fn(),
  applyTargetMargin: vi.fn(),
  upsertDay: vi.fn(),
  resetDays: vi.fn(),
  sendQuote: vi.fn(),
  reviseQuote: vi.fn(),
  declineQuote: vi.fn(),
  archiveQuote: vi.fn(),
  revokeShareLink: vi.fn(),
  convertToTrip: vi.fn(),
});

type Handler = Parameters<AdminExpressApplication["get"]>[1];

const makeHarness = (operations: StaffQuoteOperations | undefined) => {
  const handlers = new Map<string, Handler>();
  const application: AdminExpressApplication = {
    get: (path, handler) => handlers.set(`GET ${path}`, handler),
    post: (path, handler) => handlers.set(`POST ${path}`, handler),
    patch: (path, handler) => handlers.set(`PATCH ${path}`, handler),
    put: (path, handler) => handlers.set(`PUT ${path}`, handler),
    delete: (path, handler) => handlers.set(`DELETE ${path}`, handler),
  };
  registerAdminRoutes(application, {
    policy,
    tripOperations: {} as StaffTripOperations,
    ...(operations === undefined ? {} : { quoteOperations: operations }),
  });
  const invoke = async (
    key: string,
    options: {
      readonly body?: unknown;
      readonly query?: Readonly<Record<string, string | readonly string[] | undefined>>;
      readonly params?: Readonly<Record<string, string | undefined>>;
      readonly headers?: Record<string, string | string[] | undefined>;
    } = {},
  ) => {
    const handler = handlers.get(key);
    if (handler === undefined) throw new Error(`Missing handler ${key}`);
    const response = {
      statusCode: 200,
      body: undefined as unknown,
      headers: new Map<string, unknown>(),
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      setHeader(name: string, value: unknown) {
        this.headers.set(name.toLowerCase(), value);
      },
      end() {},
      json(value: unknown) {
        this.body = value;
      },
    };
    let nextError: unknown;
    handler(
      {
        method: key.split(" ")[0] ?? "GET",
        url: "/api/admin/quotes",
        originalUrl: "/api/admin/quotes",
        headers: options.headers ?? sessionHeaders(),
        body: options.body,
        params: options.params ?? { quoteId },
        query: options.query ?? {},
      },
      response,
      (error: unknown) => {
        nextError = error;
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (nextError !== undefined) throw nextError;
    return response;
  };
  return { handlers, invoke };
};

const sessionHeaders = (extra: Record<string, string> = {}) => ({
  host: "admin.example.test",
  origin: "https://admin.example.test",
  cookie: "session=opaque",
  ...extra,
});

const withOperations = () => {
  const operations = makeOperations();
  return { operations, harness: makeHarness(operations as unknown as StaffQuoteOperations) };
};

describe("Admin Quote routes", () => {
  it("registers nothing when Quote operations are not composed", () => {
    expect([...makeHarness(undefined).handlers.keys()].filter((k) => k.includes("quote"))).toEqual(
      [],
    );
  });

  it("registers the documented quote and lead-quote routes", () => {
    const { harness } = withOperations();
    expect([...harness.handlers.keys()].filter((key) => key.includes("quote")).toSorted()).toEqual(
      [
        "DELETE /api/admin/quotes/:quoteId/days",
        "DELETE /api/admin/quotes/:quoteId/lines/:lineId",
        "GET /api/admin/leads/:leadId/quotes",
        "GET /api/admin/quotes",
        "GET /api/admin/quotes/:quoteId",
        "PATCH /api/admin/quotes/:quoteId",
        "PATCH /api/admin/quotes/:quoteId/lines/:lineId",
        "POST /api/admin/quote-share-links/:linkId/revoke",
        "POST /api/admin/quotes",
        "POST /api/admin/quotes/:quoteId/apply-margin",
        "POST /api/admin/quotes/:quoteId/archive",
        "POST /api/admin/quotes/:quoteId/convert-to-trip",
        "POST /api/admin/quotes/:quoteId/decline",
        "POST /api/admin/quotes/:quoteId/lines",
        "POST /api/admin/quotes/:quoteId/lines/:lineId/duplicate",
        "POST /api/admin/quotes/:quoteId/revise",
        "POST /api/admin/quotes/:quoteId/send",
        "PUT /api/admin/quotes/:quoteId/days/:dayIndex",
        "PUT /api/admin/quotes/:quoteId/line-order",
      ].toSorted(),
    );
  });

  describe("reads", () => {
    it("returns the detail with money as minor-unit strings and no bigint leaks", async () => {
      const { operations, harness } = withOperations();
      operations.getQuote.mockResolvedValue(quoteView());
      const response = await harness.invoke("GET /api/admin/quotes/:quoteId");
      expect(response.statusCode).toBe(200);
      expect(operations.getQuote).toHaveBeenCalledWith("session=opaque", asOpaqueId(quoteId));
      expect(response.body).toMatchObject({
        quote: { lockVersion: "3", pvpOverrideMinor: "250000" },
        totals: { pvpFinalMinor: "250000", depositMinor: "75000" },
      });
    });

    it("maps an unknown quote to 404 without a body", async () => {
      const { operations, harness } = withOperations();
      operations.getQuote.mockRejectedValue(new QuoteNotFoundError());
      const response = await harness.invoke("GET /api/admin/quotes/:quoteId");
      expect(response.statusCode).toBe(404);
    });

    it("rejects a malformed quote id and unexpected query parameters with 400", async () => {
      const { operations, harness } = withOperations();
      const badId = await harness.invoke("GET /api/admin/quotes/:quoteId", {
        params: { quoteId: "not-an-id" },
      });
      const badQuery = await harness.invoke("GET /api/admin/quotes/:quoteId", {
        query: { extra: "1" },
      });
      expect(badId.statusCode).toBe(400);
      expect(badQuery.statusCode).toBe(400);
      expect(operations.getQuote).not.toHaveBeenCalled();
    });

    it("validates list filters and maps the search text", async () => {
      const { operations, harness } = withOperations();
      operations.listQuotes.mockResolvedValue({ items: [quoteRecord()], nextCursor: null });
      const response = await harness.invoke("GET /api/admin/quotes", {
        query: { state: "SENT", q: "Açores", limit: "10" },
      });
      expect(response.statusCode).toBe(200);
      expect(operations.listQuotes).toHaveBeenCalledWith("session=opaque", {
        limit: 10,
        cursor: null,
        state: "SENT",
        customerId: null,
        leadId: null,
        search: "Açores",
      });
      const invalid = await harness.invoke("GET /api/admin/quotes", { query: { limit: "0" } });
      expect(invalid.statusCode).toBe(400);
      const badState = await harness.invoke("GET /api/admin/quotes", {
        query: { state: "PAID" },
      });
      expect(badState.statusCode).toBe(400);
    });

    it("lists the quotes of one lead", async () => {
      const { operations, harness } = withOperations();
      operations.listQuotes.mockResolvedValue({ items: [quoteRecord()], nextCursor: null });
      const response = await harness.invoke("GET /api/admin/leads/:leadId/quotes", {
        params: { leadId },
      });
      expect(response.statusCode).toBe(200);
      expect(operations.listQuotes).toHaveBeenCalledWith(
        "session=opaque",
        expect.objectContaining({ leadId: asOpaqueId(leadId), limit: 100 }),
      );
    });
  });

  describe("writes", () => {
    it("creates a quote from a lead and rejects a missing lead id", async () => {
      const { operations, harness } = withOperations();
      operations.createQuote.mockResolvedValue(quoteRecord());
      const created = await harness.invoke("POST /api/admin/quotes", {
        body: { leadId, title: "Açores", adults: 2 },
      });
      expect(created.statusCode).toBe(201);
      expect(operations.createQuote).toHaveBeenCalledWith("session=opaque", asOpaqueId(leadId), {
        title: "Açores",
        adults: 2,
      });
      const invalid = await harness.invoke("POST /api/admin/quotes", { body: { title: "x" } });
      expect(invalid.statusCode).toBe(400);
    });

    it("rejects a foreign Origin on a state change before any use case runs", async () => {
      const { operations, harness } = withOperations();
      const response = await harness.invoke("POST /api/admin/quotes", {
        body: { leadId },
        headers: sessionHeaders({ origin: "https://evil.example.test" }),
      });
      expect(response.statusCode).toBe(403);
      expect(operations.createQuote).not.toHaveBeenCalled();
    });

    it("converts header money to bigint and sends the full header patch", async () => {
      const { operations, harness } = withOperations();
      operations.updateQuote.mockResolvedValue(quoteView());
      const body = {
        expectedLockVersion: "3",
        title: "Açores",
        destination: "Açores",
        startDate: "2027-05-01",
        endDate: "2027-05-08",
        adults: 2,
        children: 0,
        validUntil: "2026-12-12",
        pvpOverrideMinor: "250000",
        targetMarginBp: 1500,
        agencyNetShareBp: 2000,
        depositBp: 3000,
        balanceDueDays: 45,
        heroImageUrl: null,
        intro: null,
        internalNotes: null,
        excludedItems: [],
      };
      const response = await harness.invoke("PATCH /api/admin/quotes/:quoteId", { body });
      expect(response.statusCode).toBe(200);
      const call = operations.updateQuote.mock.calls[0];
      expect(call?.[2]).toMatchObject({
        expectedLockVersion: 3n,
        patch: expect.objectContaining({ pvpOverrideMinor: 250_000n, title: "Açores" }),
      });
    });

    it("maps a stale lock version to 409 optimistic_conflict", async () => {
      const { operations, harness } = withOperations();
      operations.updateQuote.mockRejectedValue(new QuoteStaleError());
      const response = await harness.invoke("PATCH /api/admin/quotes/:quoteId", {
        body: {
          expectedLockVersion: "1",
          title: "x",
          destination: null,
          startDate: null,
          endDate: null,
          adults: 1,
          children: 0,
          validUntil: "2026-12-12",
          pvpOverrideMinor: null,
          targetMarginBp: 0,
          agencyNetShareBp: 0,
          depositBp: 0,
          balanceDueDays: 0,
          heroImageUrl: null,
          intro: null,
          internalNotes: null,
          excludedItems: [],
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.body).toEqual({ error: "optimistic_conflict" });
    });

    it("adds a line with money converted and the section kept", async () => {
      const { operations, harness } = withOperations();
      operations.addLine.mockResolvedValue(quoteView());
      const response = await harness.invoke("POST /api/admin/quotes/:quoteId/lines", {
        body: {
          section: "BASE",
          category: "ACCOMMODATION",
          service: "Hotel",
          netSupplierMinor: "80000",
          pvpMinor: "95000",
        },
      });
      expect(response.statusCode).toBe(201);
      expect(operations.addLine).toHaveBeenCalledWith("session=opaque", asOpaqueId(quoteId), {
        section: "BASE",
        line: expect.objectContaining({
          category: "ACCOMMODATION",
          netSupplierMinor: 80_000n,
          pvpMinor: 95_000n,
          recommendedMinor: undefined,
        }),
      });
    });

    it("rejects a line money value that is not an integer string", async () => {
      const { operations, harness } = withOperations();
      const response = await harness.invoke("POST /api/admin/quotes/:quoteId/lines", {
        body: { section: "BASE", category: "OTHER", service: "x", pvpMinor: "12.50" },
      });
      expect(response.statusCode).toBe(400);
      expect(operations.addLine).not.toHaveBeenCalled();
    });

    it("maps a rule violation to 409 with the rule code", async () => {
      const { operations, harness } = withOperations();
      operations.addLine.mockRejectedValue(new QuoteRuleError("NOT_DRAFT", "Só em rascunho"));
      const response = await harness.invoke("POST /api/admin/quotes/:quoteId/lines", {
        body: { section: "OPTION", category: "OTHER", service: "Extra" },
      });
      expect(response.statusCode).toBe(409);
      expect(response.body).toEqual({ error: "NOT_DRAFT" });
    });

    it("requires expectedLockVersion on line deletion", async () => {
      const { operations, harness } = withOperations();
      const missing = await harness.invoke("DELETE /api/admin/quotes/:quoteId/lines/:lineId", {
        params: { quoteId, lineId },
      });
      expect(missing.statusCode).toBe(400);
      operations.deleteLine.mockResolvedValue(quoteView());
      const ok = await harness.invoke("DELETE /api/admin/quotes/:quoteId/lines/:lineId", {
        params: { quoteId, lineId },
        query: { expectedLockVersion: "4" },
      });
      expect(ok.statusCode).toBe(200);
      expect(operations.deleteLine).toHaveBeenCalledWith(
        "session=opaque",
        asOpaqueId(quoteId),
        asOpaqueId(lineId),
        4n,
      );
    });

    it("reorders lines with the section per entry", async () => {
      const { operations, harness } = withOperations();
      operations.reorderLines.mockResolvedValue(quoteView());
      const response = await harness.invoke("PUT /api/admin/quotes/:quoteId/line-order", {
        body: {
          expectedLockVersion: "2",
          order: [{ lineId, section: "OPTION" }],
        },
      });
      expect(response.statusCode).toBe(200);
      expect(operations.reorderLines).toHaveBeenCalledWith("session=opaque", asOpaqueId(quoteId), {
        expectedLockVersion: 2n,
        order: [{ lineId: asOpaqueId(lineId), section: "OPTION" }],
      });
    });

    it("applies the target margin with a rounding unit", async () => {
      const { operations, harness } = withOperations();
      operations.applyTargetMargin.mockResolvedValue(quoteView());
      const response = await harness.invoke("POST /api/admin/quotes/:quoteId/apply-margin", {
        body: { rounding: "EURO" },
      });
      expect(response.statusCode).toBe(200);
      expect(operations.applyTargetMargin).toHaveBeenCalledWith(
        "session=opaque",
        asOpaqueId(quoteId),
        { lineIds: null, rounding: "EURO" },
      );
      const invalid = await harness.invoke("POST /api/admin/quotes/:quoteId/apply-margin", {
        body: { rounding: "HUNDRED" },
      });
      expect(invalid.statusCode).toBe(400);
    });

    it("sends a version and returns the message and links", async () => {
      const { operations, harness } = withOperations();
      operations.sendQuote.mockResolvedValue({
        versionNumber: 1,
        url: "https://admin.example.test/v/abc",
        token: "abc",
        messageText: "Olá",
        mailtoUrl: "mailto:?body=Ol%C3%A1",
        whatsappUrl: "https://wa.me/?text=Ol%C3%A1",
        expiresAt: "2026-12-12T23:59:59.000Z",
      });
      const response = await harness.invoke("POST /api/admin/quotes/:quoteId/send", {
        body: { expectedLockVersion: "3" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toMatchObject({ versionNumber: 1, messageText: "Olá" });
      expect(operations.sendQuote).toHaveBeenCalledWith("session=opaque", asOpaqueId(quoteId), {
        expectedLockVersion: 3n,
        expiresAt: null,
      });
    });

    it("denies send without recent MFA as forbidden", async () => {
      const { operations, harness } = withOperations();
      operations.sendQuote.mockRejectedValue(new StaffAuthorizationError("FORBIDDEN"));
      const response = await harness.invoke("POST /api/admin/quotes/:quoteId/send", {
        body: { expectedLockVersion: "3" },
      });
      expect(response.statusCode).toBe(403);
    });

    it("answers an unauthenticated write with 401", async () => {
      const { operations, harness } = withOperations();
      operations.declineQuote.mockRejectedValue(new StaffAuthorizationError("UNAUTHENTICATED"));
      const response = await harness.invoke("POST /api/admin/quotes/:quoteId/decline", {
        body: { expectedLockVersion: "3" },
      });
      expect(response.statusCode).toBe(401);
    });

    it("converts an accepted quote and returns the trip id", async () => {
      const { operations, harness } = withOperations();
      operations.convertToTrip.mockResolvedValue({
        tripId: asOpaqueId(linkId),
        created: true,
      });
      const response = await harness.invoke("POST /api/admin/quotes/:quoteId/convert-to-trip");
      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ tripId: linkId });
    });

    it("revokes a quote share link", async () => {
      const { operations, harness } = withOperations();
      operations.revokeShareLink.mockResolvedValue(undefined);
      const response = await harness.invoke("POST /api/admin/quote-share-links/:linkId/revoke", {
        params: { linkId },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ revoked: true });
      expect(operations.revokeShareLink).toHaveBeenCalledWith("session=opaque", asOpaqueId(linkId));
    });
  });
});
