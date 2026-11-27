import { describe, expect, it, vi } from "vitest";
import {
  asOpaqueId,
  LeadIdempotencyConflictError,
  LeadNotFoundError,
  LeadNotOpenError,
  OptimisticConflictError,
  StaffAuthorizationError,
  type Lead,
  type StaffLeadOperations,
  type StaffTripOperations,
} from "@travelos/backend-core";
import type { AuthSurfacePolicy } from "@travelos/auth-adapters";
import { registerAdminRoutes, type AdminExpressApplication } from "../src/admin-routes.js";

const policy: AuthSurfacePolicy = {
  canonicalOrigin: "https://admin.example.test",
  expectedHost: "admin.example.test",
};
const agencyId = asOpaqueId("00000000-0000-7000-8000-000000000001");
const leadId = asOpaqueId("00000000-0000-7000-8000-000000000010");
const customerId = asOpaqueId("00000000-0000-7000-8000-000000000020");
const cursorId = asOpaqueId("00000000-0000-7000-8000-000000000030");

const lead = (overrides: Partial<Lead> = {}): Lead => ({
  id: leadId,
  agencyId,
  source: "WEBSITE",
  contactGivenName: "Marta",
  contactFamilyName: "Quintela",
  contactEmail: null,
  contactPhone: "+351 910 000 000",
  internalNote: null,
  state: "OPEN",
  qualifiedCustomerId: null,
  disqualificationReason: null,
  lockVersion: 1n,
  createdAt: "2026-11-25T10:00:00.000Z",
  updatedAt: "2026-11-25T10:00:00.000Z",
  closedAt: null,
  ...overrides,
});

const validCreateBody = {
  source: "PHONE",
  contactGivenName: "Marta",
  contactFamilyName: "Quintela",
  contactEmail: null,
  contactPhone: null,
  internalNote: null,
};

const makeOperations = (): { [Key in keyof StaffLeadOperations]: ReturnType<typeof vi.fn> } => ({
  listLeads: vi.fn(),
  getLead: vi.fn(),
  createLead: vi.fn(),
  updateLead: vi.fn(),
  qualifyLead: vi.fn(),
  disqualifyLead: vi.fn(),
});

type Handler = Parameters<AdminExpressApplication["get"]>[1];

const makeHarness = (leadOperations: StaffLeadOperations | undefined) => {
  const handlers = new Map<string, Handler>();
  const application: AdminExpressApplication = {
    get: (path, handler) => handlers.set(`GET ${path}`, handler),
    post: (path, handler) => handlers.set(`POST ${path}`, handler),
    patch: (path, handler) => handlers.set(`PATCH ${path}`, handler),
    put: (path, handler) => handlers.set(`PUT ${path}`, handler),
  };
  registerAdminRoutes(application, {
    policy,
    tripOperations: {} as StaffTripOperations,
    ...(leadOperations === undefined ? {} : { leadOperations }),
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
        url: "/api/admin/leads",
        originalUrl: "/api/admin/leads",
        headers: options.headers ?? {
          host: "admin.example.test",
          origin: "https://admin.example.test",
          cookie: "session=opaque",
        },
        body: options.body,
        params: options.params ?? { leadId },
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

const leadHandlerKeys = (harness: { readonly handlers: ReadonlyMap<string, unknown> }) =>
  [...harness.handlers.keys()].filter((key) => key.includes("/api/admin/leads")).toSorted();

const sessionHeaders = (extra: Record<string, string> = {}) => ({
  host: "admin.example.test",
  origin: "https://admin.example.test",
  cookie: "session=opaque",
  ...extra,
});

describe("Admin Lead routes", () => {
  it("registers nothing when Lead operations are not composed", () => {
    expect(leadHandlerKeys(makeHarness(undefined))).toEqual([]);
  });

  it("registers exactly the six documented routes", () => {
    const harness = makeHarness(makeOperations() as unknown as StaffLeadOperations);
    expect(leadHandlerKeys(harness)).toEqual(
      [
        "GET /api/admin/leads",
        "POST /api/admin/leads",
        "GET /api/admin/leads/:leadId",
        "PATCH /api/admin/leads/:leadId",
        "POST /api/admin/leads/:leadId/qualification",
        "POST /api/admin/leads/:leadId/disqualification",
      ].toSorted(),
    );
  });

  describe("GET /api/admin/leads", () => {
    it("validates the query, delegates with the Staff cookie and returns a bounded cursor page", async () => {
      const operations = makeOperations();
      operations.listLeads.mockResolvedValue({ items: [lead()], nextCursor: cursorId });
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      const response = await harness.invoke("GET /api/admin/leads", {
        query: { limit: "50", cursor: cursorId, state: "QUALIFIED" },
        headers: sessionHeaders(),
      });
      expect(response.statusCode).toBe(200);
      expect(operations.listLeads).toHaveBeenCalledWith("session=opaque", {
        limit: 50,
        cursor: cursorId,
        state: "QUALIFIED",
      });
      expect(response.body).toMatchObject({
        nextCursor: cursorId,
        items: [{ id: leadId, lockVersion: "1", state: "OPEN" }],
      });
      expect(response.headers.get("cache-control")).toContain("no-store");
    });

    it("defaults to 25 items and rejects unknown keys, excess limits and bad states", async () => {
      const operations = makeOperations();
      operations.listLeads.mockResolvedValue({ items: [], nextCursor: null });
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      await harness.invoke("GET /api/admin/leads", { headers: sessionHeaders() });
      expect(operations.listLeads).toHaveBeenCalledWith("session=opaque", {
        limit: 25,
        cursor: null,
        state: null,
      });
      for (const query of [
        { unknown: "x" },
        { limit: "101" },
        { limit: "0" },
        { state: "PENDING" },
        { cursor: "not-a-uuid" },
        { limit: ["1", "2"] as readonly string[] },
      ]) {
        const response = await harness.invoke("GET /api/admin/leads", {
          query,
          headers: sessionHeaders(),
        });
        expect(response.statusCode, JSON.stringify(query)).toBe(400);
      }
      expect(operations.listLeads).toHaveBeenCalledTimes(1);
    });

    it("rejects a wrong Host before any use case runs", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      const response = await harness.invoke("GET /api/admin/leads", {
        headers: sessionHeaders({ host: "other.example.test" }),
      });
      expect(response.statusCode).toBe(404);
      expect(operations.listLeads).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/admin/leads", () => {
    it("creates a Lead, passing the Idempotency-Key header and returning 201", async () => {
      const operations = makeOperations();
      operations.createLead.mockResolvedValue(lead({ source: "PHONE" }));
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      const response = await harness.invoke("POST /api/admin/leads", {
        body: validCreateBody,
        headers: sessionHeaders({ "idempotency-key": "create-1" }),
      });
      expect(response.statusCode).toBe(201);
      expect(operations.createLead).toHaveBeenCalledWith("session=opaque", {
        lead: validCreateBody,
        idempotencyKey: "create-1",
      });
      expect(response.body).toMatchObject({ lockVersion: "1" });
    });

    it("works without an Idempotency-Key and rejects a malformed one", async () => {
      const operations = makeOperations();
      operations.createLead.mockResolvedValue(lead());
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      expect(
        (
          await harness.invoke("POST /api/admin/leads", {
            body: validCreateBody,
            headers: sessionHeaders(),
          })
        ).statusCode,
      ).toBe(201);
      expect(operations.createLead).toHaveBeenCalledWith("session=opaque", {
        lead: validCreateBody,
        idempotencyKey: null,
      });
      const rejected = await harness.invoke("POST /api/admin/leads", {
        body: validCreateBody,
        headers: sessionHeaders({ "idempotency-key": "x".repeat(129) }),
      });
      expect(rejected.statusCode).toBe(400);
      expect(operations.createLead).toHaveBeenCalledTimes(1);
    });

    it("rejects unknown fields, missing fields, blank names and invalid phone or email", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      const bodies: unknown[] = [
        { ...validCreateBody, agencyId },
        { ...validCreateBody, state: "QUALIFIED" },
        { ...validCreateBody, id: leadId },
        { ...validCreateBody, lockVersion: "1" },
        { ...validCreateBody, contactGivenName: "   " },
        { ...validCreateBody, contactPhone: "call me" },
        { ...validCreateBody, contactEmail: "not-an-email" },
        { ...validCreateBody, source: "FAX" },
        { ...validCreateBody, internalNote: "x".repeat(4_001) },
        { source: "PHONE" },
        null,
        "text",
      ];
      for (const body of bodies) {
        const response = await harness.invoke("POST /api/admin/leads", {
          body,
          headers: sessionHeaders(),
        });
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
      expect(operations.createLead).not.toHaveBeenCalled();
    });

    it("requires the canonical Origin on mutations", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      for (const origin of [undefined, "https://evil.example.test"]) {
        const response = await harness.invoke("POST /api/admin/leads", {
          body: validCreateBody,
          headers: {
            host: "admin.example.test",
            cookie: "session=opaque",
            ...(origin === undefined ? {} : { origin }),
          },
        });
        expect(response.statusCode).toBe(403);
      }
      expect(operations.createLead).not.toHaveBeenCalled();
    });

    it("maps authorization failures to 401 and 403 without a body", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      operations.createLead.mockRejectedValueOnce(new StaffAuthorizationError("FORBIDDEN"));
      expect(
        (
          await harness.invoke("POST /api/admin/leads", {
            body: validCreateBody,
            headers: sessionHeaders(),
          })
        ).statusCode,
      ).toBe(403);
      operations.createLead.mockRejectedValueOnce(new StaffAuthorizationError("UNAUTHENTICATED"));
      expect(
        (
          await harness.invoke("POST /api/admin/leads", {
            body: validCreateBody,
            headers: sessionHeaders(),
          })
        ).statusCode,
      ).toBe(401);
    });
  });

  describe("GET /api/admin/leads/:leadId", () => {
    it("returns the Lead and rejects malformed identifiers and query strings", async () => {
      const operations = makeOperations();
      operations.getLead.mockResolvedValue(lead());
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      const ok = await harness.invoke("GET /api/admin/leads/:leadId", {
        headers: sessionHeaders(),
      });
      expect(ok.statusCode).toBe(200);
      expect(operations.getLead).toHaveBeenCalledWith("session=opaque", leadId);
      expect(
        (
          await harness.invoke("GET /api/admin/leads/:leadId", {
            params: { leadId: "not-a-uuid" },
            headers: sessionHeaders(),
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await harness.invoke("GET /api/admin/leads/:leadId", {
            query: { expand: "all" },
            headers: sessionHeaders(),
          })
        ).statusCode,
      ).toBe(400);
    });

    it("returns 404 for a Lead that does not exist in the session Agency (no cross-Agency oracle)", async () => {
      const operations = makeOperations();
      operations.getLead.mockRejectedValue(new LeadNotFoundError());
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      const response = await harness.invoke("GET /api/admin/leads/:leadId", {
        headers: sessionHeaders(),
      });
      expect(response.statusCode).toBe(404);
      expect(response.body).toBeUndefined();
    });
  });

  describe("PATCH /api/admin/leads/:leadId", () => {
    it("sends the expected lock version as a bigint and the editable fields", async () => {
      const operations = makeOperations();
      operations.updateLead.mockResolvedValue(lead({ lockVersion: 4n }));
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      const response = await harness.invoke("PATCH /api/admin/leads/:leadId", {
        body: { expectedLockVersion: "3", ...validCreateBody },
        headers: sessionHeaders(),
      });
      expect(response.statusCode).toBe(200);
      expect(operations.updateLead).toHaveBeenCalledWith("session=opaque", leadId, {
        expectedLockVersion: 3n,
        lead: validCreateBody,
      });
      expect(response.body).toMatchObject({ lockVersion: "4" });
    });

    it("rejects missing or unknown fields, and a state change through PATCH", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      for (const body of [
        validCreateBody,
        { expectedLockVersion: "1", ...validCreateBody, state: "QUALIFIED" },
        { expectedLockVersion: "1", ...validCreateBody, qualifiedCustomerId: customerId },
        { expectedLockVersion: 1, ...validCreateBody },
        { expectedLockVersion: "-1", ...validCreateBody },
        { expectedLockVersion: "9223372036854775808", ...validCreateBody },
      ]) {
        const response = await harness.invoke("PATCH /api/admin/leads/:leadId", {
          body,
          headers: sessionHeaders(),
        });
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
      expect(operations.updateLead).not.toHaveBeenCalled();
    });

    it("maps a stale lock version to 409 optimistic_conflict and a closed Lead to LEAD_NOT_OPEN", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      operations.updateLead.mockRejectedValueOnce(new OptimisticConflictError());
      const stale = await harness.invoke("PATCH /api/admin/leads/:leadId", {
        body: { expectedLockVersion: "1", ...validCreateBody },
        headers: sessionHeaders(),
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.body).toEqual({ error: "optimistic_conflict" });
      operations.updateLead.mockRejectedValueOnce(new LeadNotOpenError());
      const closed = await harness.invoke("PATCH /api/admin/leads/:leadId", {
        body: { expectedLockVersion: "1", ...validCreateBody },
        headers: sessionHeaders(),
      });
      expect(closed.statusCode).toBe(409);
      expect(closed.body).toEqual({ error: "LEAD_NOT_OPEN" });
    });
  });

  describe("POST /api/admin/leads/:leadId/qualification", () => {
    it("creates a Customer by default and passes an optional display name", async () => {
      const operations = makeOperations();
      operations.qualifyLead.mockResolvedValue(
        lead({
          state: "QUALIFIED",
          qualifiedCustomerId: customerId,
          lockVersion: 2n,
          closedAt: "2026-11-25T11:00:00.000Z",
        }),
      );
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      const response = await harness.invoke("POST /api/admin/leads/:leadId/qualification", {
        body: { expectedLockVersion: "1", mode: "CREATE_CUSTOMER" },
        headers: sessionHeaders({ "idempotency-key": "qualify-1" }),
      });
      expect(response.statusCode).toBe(200);
      expect(operations.qualifyLead).toHaveBeenCalledWith("session=opaque", leadId, {
        expectedLockVersion: 1n,
        mode: { kind: "CREATE_CUSTOMER", customerDisplayName: null },
        idempotencyKey: "qualify-1",
      });
      await harness.invoke("POST /api/admin/leads/:leadId/qualification", {
        body: {
          expectedLockVersion: "1",
          mode: "CREATE_CUSTOMER",
          customerDisplayName: "Quintela Lda",
        },
        headers: sessionHeaders(),
      });
      expect(operations.qualifyLead).toHaveBeenLastCalledWith("session=opaque", leadId, {
        expectedLockVersion: 1n,
        mode: { kind: "CREATE_CUSTOMER", customerDisplayName: "Quintela Lda" },
        idempotencyKey: null,
      });
    });

    it("links an explicitly chosen Customer", async () => {
      const operations = makeOperations();
      operations.qualifyLead.mockResolvedValue(
        lead({
          state: "QUALIFIED",
          qualifiedCustomerId: customerId,
          lockVersion: 2n,
          closedAt: "2026-11-25T11:00:00.000Z",
        }),
      );
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      const response = await harness.invoke("POST /api/admin/leads/:leadId/qualification", {
        body: { expectedLockVersion: "1", mode: "LINK_CUSTOMER", customerId },
        headers: sessionHeaders(),
      });
      expect(response.statusCode).toBe(200);
      expect(operations.qualifyLead).toHaveBeenCalledWith("session=opaque", leadId, {
        expectedLockVersion: 1n,
        mode: { kind: "LINK_CUSTOMER", customerId },
        idempotencyKey: null,
      });
      expect(response.body).toMatchObject({ state: "QUALIFIED", qualifiedCustomerId: customerId });
    });

    it("rejects mode/field mismatches, unknown modes and unknown fields", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      for (const body of [
        { expectedLockVersion: "1", mode: "LINK_CUSTOMER" },
        { expectedLockVersion: "1", mode: "LINK_CUSTOMER", customerId: "not-a-uuid" },
        { expectedLockVersion: "1", mode: "CREATE_CUSTOMER", customerId },
        { expectedLockVersion: "1", mode: "LINK_CUSTOMER", customerId, customerDisplayName: "x" },
        { expectedLockVersion: "1", mode: "MERGE", customerId },
        { expectedLockVersion: "1", mode: "CREATE_CUSTOMER", email: "someone" },
        { mode: "CREATE_CUSTOMER" },
        { expectedLockVersion: "1" },
      ]) {
        const response = await harness.invoke("POST /api/admin/leads/:leadId/qualification", {
          body,
          headers: sessionHeaders(),
        });
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
      expect(operations.qualifyLead).not.toHaveBeenCalled();
    });

    it("maps a cross-Agency Customer to 404 and idempotency reuse to 409", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      operations.qualifyLead.mockRejectedValueOnce(new LeadNotFoundError());
      expect(
        (
          await harness.invoke("POST /api/admin/leads/:leadId/qualification", {
            body: { expectedLockVersion: "1", mode: "LINK_CUSTOMER", customerId },
            headers: sessionHeaders(),
          })
        ).statusCode,
      ).toBe(404);
      operations.qualifyLead.mockRejectedValueOnce(new LeadIdempotencyConflictError());
      const conflict = await harness.invoke("POST /api/admin/leads/:leadId/qualification", {
        body: { expectedLockVersion: "1", mode: "CREATE_CUSTOMER" },
        headers: sessionHeaders({ "idempotency-key": "reused" }),
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.body).toEqual({ error: "IDEMPOTENCY_KEY_CONFLICT" });
    });

    it("requires the canonical Origin", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      const response = await harness.invoke("POST /api/admin/leads/:leadId/qualification", {
        body: { expectedLockVersion: "1", mode: "CREATE_CUSTOMER" },
        headers: { host: "admin.example.test", cookie: "session=opaque" },
      });
      expect(response.statusCode).toBe(403);
      expect(operations.qualifyLead).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/admin/leads/:leadId/disqualification", () => {
    it("disqualifies with a reason and an optional idempotency key", async () => {
      const operations = makeOperations();
      operations.disqualifyLead.mockResolvedValue(
        lead({
          state: "DISQUALIFIED",
          disqualificationReason: "NO_RESPONSE",
          lockVersion: 2n,
          closedAt: "2026-11-25T11:00:00.000Z",
        }),
      );
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      const response = await harness.invoke("POST /api/admin/leads/:leadId/disqualification", {
        body: { expectedLockVersion: "1", reason: "NO_RESPONSE" },
        headers: sessionHeaders({ "idempotency-key": "dq-1" }),
      });
      expect(response.statusCode).toBe(200);
      expect(operations.disqualifyLead).toHaveBeenCalledWith("session=opaque", leadId, {
        expectedLockVersion: 1n,
        reason: "NO_RESPONSE",
        idempotencyKey: "dq-1",
      });
      expect(response.body).toMatchObject({
        state: "DISQUALIFIED",
        disqualificationReason: "NO_RESPONSE",
      });
    });

    it("rejects missing, unknown and free-text reasons and extra fields", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      for (const body of [
        { expectedLockVersion: "1" },
        { expectedLockVersion: "1", reason: "BORED" },
        { expectedLockVersion: "1", reason: "OTHER", note: "free text" },
        { reason: "OTHER" },
      ]) {
        const response = await harness.invoke("POST /api/admin/leads/:leadId/disqualification", {
          body,
          headers: sessionHeaders(),
        });
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
      expect(operations.disqualifyLead).not.toHaveBeenCalled();
    });

    it("maps LEAD_NOT_OPEN, stale locks and missing Leads", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffLeadOperations);
      const run = (error: Error) => {
        operations.disqualifyLead.mockRejectedValueOnce(error);
        return harness.invoke("POST /api/admin/leads/:leadId/disqualification", {
          body: { expectedLockVersion: "1", reason: "OTHER" },
          headers: sessionHeaders(),
        });
      };
      expect(await run(new LeadNotOpenError())).toMatchObject({
        statusCode: 409,
        body: { error: "LEAD_NOT_OPEN" },
      });
      expect(await run(new OptimisticConflictError())).toMatchObject({
        statusCode: 409,
        body: { error: "optimistic_conflict" },
      });
      expect(await run(new LeadNotFoundError())).toMatchObject({ statusCode: 404 });
    });
  });
});
