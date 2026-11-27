import { describe, expect, it, vi } from "vitest";
import {
  asOpaqueId,
  CrmIdempotencyConflictError,
  CrmNotFoundError,
  OptimisticConflictError,
  StaffAuthorizationError,
  type CrmCustomerDetail,
  type CrmCustomerSummary,
  type CrmPersonRecord,
  type StaffCrmOperations,
  type StaffTripOperations,
} from "@travelos/backend-core";
import type { AuthSurfacePolicy } from "@travelos/auth-adapters";
import { registerAdminRoutes, type AdminExpressApplication } from "../src/admin-routes.js";

const policy: AuthSurfacePolicy = {
  canonicalOrigin: "https://admin.example.test",
  expectedHost: "admin.example.test",
};
const agencyId = asOpaqueId("00000000-0000-7000-8000-000000000001");
const customerId = asOpaqueId("00000000-0000-7000-8000-000000000020");
const personId = asOpaqueId("00000000-0000-7000-8000-000000000021");
const leadId = asOpaqueId("00000000-0000-7000-8000-000000000022");
const tripId = asOpaqueId("00000000-0000-7000-8000-000000000023");
const cursorId = asOpaqueId("00000000-0000-7000-8000-000000000030");

const person = (overrides: Partial<CrmPersonRecord> = {}): CrmPersonRecord => ({
  id: personId,
  agencyId,
  givenName: "Marta",
  familyName: "Quintela",
  email: "marta@example.test",
  phone: "+351 910 000 000",
  nationality: "PT",
  notes: null,
  birthDate: null,
  passportNumber: null,
  passportExpiry: null,
  lockVersion: 0n,
  createdAt: "2026-11-25T10:00:00.000Z",
  updatedAt: "2026-11-25T10:00:00.000Z",
  ...overrides,
});

const detail = (overrides: Partial<CrmCustomerDetail> = {}): CrmCustomerDetail => ({
  id: customerId,
  agencyId,
  displayName: "Família Quintela",
  email: null,
  phone: null,
  notes: null,
  lockVersion: 1n,
  createdAt: "2026-11-25T10:00:00.000Z",
  updatedAt: "2026-11-25T10:00:00.000Z",
  people: [{ ...person(), roles: ["PRIMARY_CONTACT"], isPrimary: true }],
  leads: [{ id: leadId, name: "Marta Quintela", state: "QUALIFIED" }],
  trips: [
    {
      id: tripId,
      title: "Açores",
      startDate: "2027-06-04",
      endDate: "2027-06-11",
      state: "DRAFT",
    },
  ],
  ...overrides,
});

const summary = (overrides: Partial<CrmCustomerSummary> = {}): CrmCustomerSummary => ({
  id: customerId,
  agencyId,
  displayName: "Família Quintela",
  email: null,
  phone: null,
  primaryContactName: "Marta Quintela",
  lockVersion: 1n,
  updatedAt: "2026-11-25T10:00:00.000Z",
  ...overrides,
});

const validCustomerBody = {
  displayName: "Família Quintela",
  email: null,
  phone: null,
  notes: null,
  primaryPerson: {
    givenName: "Marta",
    familyName: "Quintela",
    email: "marta@example.test",
    phone: null,
    nationality: "pt",
    notes: null,
  },
};

const validPersonBody = {
  givenName: "Duarte",
  familyName: "Quintela",
  email: null,
  phone: null,
  nationality: null,
  notes: null,
  roles: ["TRAVELLER"],
};

const makeOperations = (): { [Key in keyof StaffCrmOperations]: ReturnType<typeof vi.fn> } => ({
  listCustomers: vi.fn(),
  getCustomer: vi.fn(),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  addPerson: vi.fn(),
  updatePerson: vi.fn(),
  setPersonRoles: vi.fn(),
  search: vi.fn(),
});

type Handler = Parameters<AdminExpressApplication["get"]>[1];

const makeHarness = (crmOperations: StaffCrmOperations | undefined) => {
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
    ...(crmOperations === undefined ? {} : { crmOperations }),
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
        url: "/api/admin/customers",
        originalUrl: "/api/admin/customers",
        headers: options.headers ?? sessionHeaders(),
        body: options.body,
        params: options.params ?? { customerId },
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

const crmHandlerKeys = (harness: { readonly handlers: ReadonlyMap<string, unknown> }) =>
  [...harness.handlers.keys()]
    .filter((key) => /\/api\/admin\/(customers|persons|search)/u.test(key))
    .toSorted();

const sessionHeaders = (extra: Record<string, string> = {}) => ({
  host: "admin.example.test",
  origin: "https://admin.example.test",
  cookie: "session=opaque",
  ...extra,
});

describe("Admin CRM routes", () => {
  it("registers nothing when CRM operations are not composed", () => {
    expect(crmHandlerKeys(makeHarness(undefined))).toEqual([]);
  });

  it("registers exactly the documented routes", () => {
    const harness = makeHarness(makeOperations() as unknown as StaffCrmOperations);
    expect(crmHandlerKeys(harness)).toEqual(
      [
        "GET /api/admin/customers",
        "POST /api/admin/customers",
        "GET /api/admin/customers/:customerId",
        "PATCH /api/admin/customers/:customerId",
        "POST /api/admin/customers/:customerId/persons",
        "PATCH /api/admin/persons/:personId",
        "PUT /api/admin/customers/:customerId/persons/:personId/roles",
        "GET /api/admin/search",
      ].toSorted(),
    );
  });

  describe("GET /api/admin/customers", () => {
    it("validates the query, delegates with the Staff cookie and returns a bounded page", async () => {
      const operations = makeOperations();
      operations.listCustomers.mockResolvedValue({ items: [summary()], nextCursor: cursorId });
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      const response = await harness.invoke("GET /api/admin/customers", {
        query: { q: "quintela", limit: "50", cursor: cursorId },
      });
      expect(response.statusCode).toBe(200);
      expect(operations.listCustomers).toHaveBeenCalledWith("session=opaque", {
        limit: 50,
        cursor: cursorId,
        query: "quintela",
      });
      expect(response.body).toMatchObject({
        nextCursor: cursorId,
        items: [{ id: customerId, lockVersion: "1", displayName: "Família Quintela" }],
      });
      expect(response.headers.get("cache-control")).toContain("no-store");
    });

    it("defaults to 25 items and rejects unknown keys, excess limits and too-short queries", async () => {
      const operations = makeOperations();
      operations.listCustomers.mockResolvedValue({ items: [], nextCursor: null });
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      await harness.invoke("GET /api/admin/customers");
      expect(operations.listCustomers).toHaveBeenCalledWith("session=opaque", {
        limit: 25,
        cursor: null,
        query: null,
      });
      for (const query of [
        { unknown: "x" },
        { limit: "51" },
        { limit: "0" },
        { q: "a" },
        { q: "x".repeat(101) },
        { cursor: "not-a-uuid" },
        { q: ["ab", "cd"] as readonly string[] },
      ]) {
        const response = await harness.invoke("GET /api/admin/customers", { query });
        expect(response.statusCode, JSON.stringify(query)).toBe(400);
      }
      expect(operations.listCustomers).toHaveBeenCalledTimes(1);
    });

    it("rejects a wrong Host before any use case runs", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      const response = await harness.invoke("GET /api/admin/customers", {
        headers: sessionHeaders({ host: "other.example.test" }),
      });
      expect(response.statusCode).toBe(404);
      expect(operations.listCustomers).not.toHaveBeenCalled();
    });

    it("maps missing permission to 403 and missing session to 401 without a body", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      operations.listCustomers.mockRejectedValueOnce(new StaffAuthorizationError("FORBIDDEN"));
      const denied = await harness.invoke("GET /api/admin/customers");
      expect(denied.statusCode).toBe(403);
      expect(denied.body).toBeUndefined();
      operations.listCustomers.mockRejectedValueOnce(
        new StaffAuthorizationError("UNAUTHENTICATED"),
      );
      expect((await harness.invoke("GET /api/admin/customers")).statusCode).toBe(401);
    });
  });

  describe("POST /api/admin/customers", () => {
    it("creates a customer with its primary person, passing the Idempotency-Key and returning 201", async () => {
      const operations = makeOperations();
      operations.createCustomer.mockResolvedValue(detail());
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      const response = await harness.invoke("POST /api/admin/customers", {
        body: validCustomerBody,
        headers: sessionHeaders({ "idempotency-key": "customer-create-1" }),
      });
      expect(response.statusCode).toBe(201);
      expect(operations.createCustomer).toHaveBeenCalledWith("session=opaque", {
        customer: {
          displayName: "Família Quintela",
          email: null,
          phone: null,
          notes: null,
        },
        primaryPerson: {
          givenName: "Marta",
          familyName: "Quintela",
          email: "marta@example.test",
          phone: null,
          nationality: "PT",
          notes: null,
        },
        idempotencyKey: "customer-create-1",
      });
      expect(response.body).toMatchObject({ id: customerId, lockVersion: "1" });
    });

    it("works without an Idempotency-Key and rejects a malformed one", async () => {
      const operations = makeOperations();
      operations.createCustomer.mockResolvedValue(detail());
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      expect(
        (await harness.invoke("POST /api/admin/customers", { body: validCustomerBody })).statusCode,
      ).toBe(201);
      expect(operations.createCustomer).toHaveBeenLastCalledWith(
        "session=opaque",
        expect.objectContaining({ idempotencyKey: null }),
      );
      const rejected = await harness.invoke("POST /api/admin/customers", {
        body: validCustomerBody,
        headers: sessionHeaders({ "idempotency-key": "x".repeat(129) }),
      });
      expect(rejected.statusCode).toBe(400);
      expect(operations.createCustomer).toHaveBeenCalledTimes(1);
    });

    it("maps a reused idempotency key for a different request to 409 IDEMPOTENCY_KEY_CONFLICT", async () => {
      const operations = makeOperations();
      operations.createCustomer.mockRejectedValueOnce(new CrmIdempotencyConflictError());
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      const response = await harness.invoke("POST /api/admin/customers", {
        body: validCustomerBody,
        headers: sessionHeaders({ "idempotency-key": "reused" }),
      });
      expect(response.statusCode).toBe(409);
      expect(response.body).toEqual({ error: "IDEMPOTENCY_KEY_CONFLICT" });
    });

    it("rejects unknown fields, missing primary person, blank names and invalid contact data", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      const bodies: unknown[] = [
        { ...validCustomerBody, agencyId },
        { ...validCustomerBody, lockVersion: "1" },
        { ...validCustomerBody, displayName: "   " },
        { ...validCustomerBody, displayName: "x".repeat(301) },
        { ...validCustomerBody, email: "not-an-email" },
        { ...validCustomerBody, phone: "call me" },
        { ...validCustomerBody, notes: "x".repeat(4_001) },
        { displayName: "Família Quintela", email: null, phone: null, notes: null },
        {
          ...validCustomerBody,
          primaryPerson: { ...validCustomerBody.primaryPerson, nationality: "PRT" },
        },
        {
          ...validCustomerBody,
          primaryPerson: { ...validCustomerBody.primaryPerson, passportNumber: "P1" },
        },
        {
          ...validCustomerBody,
          primaryPerson: { ...validCustomerBody.primaryPerson, familyName: "" },
        },
        null,
        "text",
      ];
      for (const body of bodies) {
        const response = await harness.invoke("POST /api/admin/customers", {
          body,
          headers: sessionHeaders(),
        });
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
      expect(operations.createCustomer).not.toHaveBeenCalled();
    });

    it("requires the canonical Origin on mutations", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      for (const origin of [undefined, "https://evil.example.test"]) {
        const response = await harness.invoke("POST /api/admin/customers", {
          body: validCustomerBody,
          headers: {
            host: "admin.example.test",
            cookie: "session=opaque",
            ...(origin === undefined ? {} : { origin }),
          },
        });
        expect(response.statusCode).toBe(403);
      }
      expect(operations.createCustomer).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/admin/customers/:customerId", () => {
    it("returns the detail with people, leads and trips, and rejects malformed input", async () => {
      const operations = makeOperations();
      operations.getCustomer.mockResolvedValue(detail());
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      const ok = await harness.invoke("GET /api/admin/customers/:customerId");
      expect(ok.statusCode).toBe(200);
      expect(operations.getCustomer).toHaveBeenCalledWith("session=opaque", customerId);
      expect(ok.body).toMatchObject({
        people: [
          {
            id: personId,
            roles: ["PRIMARY_CONTACT"],
            isPrimary: true,
            passportNumber: null,
            birthDate: null,
          },
        ],
        leads: [{ id: leadId, state: "QUALIFIED" }],
        trips: [{ id: tripId, startDate: "2027-06-04" }],
      });
      expect(
        (
          await harness.invoke("GET /api/admin/customers/:customerId", {
            params: { customerId: "not-a-uuid" },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await harness.invoke("GET /api/admin/customers/:customerId", {
            query: { expand: "all" },
          })
        ).statusCode,
      ).toBe(400);
    });

    it("returns 404 for a Customer outside the session Agency (no cross-Agency oracle)", async () => {
      const operations = makeOperations();
      operations.getCustomer.mockRejectedValue(new CrmNotFoundError());
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      const response = await harness.invoke("GET /api/admin/customers/:customerId");
      expect(response.statusCode).toBe(404);
      expect(response.body).toBeUndefined();
    });

    it("maps missing customer.view, sales.view or trip.view to 403", async () => {
      const operations = makeOperations();
      operations.getCustomer.mockRejectedValueOnce(new StaffAuthorizationError("FORBIDDEN"));
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      expect((await harness.invoke("GET /api/admin/customers/:customerId")).statusCode).toBe(403);
    });
  });

  describe("PATCH /api/admin/customers/:customerId", () => {
    const update = {
      expectedLockVersion: "1",
      displayName: "Quintela Lda",
      email: null,
      phone: "+351 210 000 000",
      notes: null,
    };

    it("sends the expected lock version as a bigint and the editable fields", async () => {
      const operations = makeOperations();
      operations.updateCustomer.mockResolvedValue(detail({ lockVersion: 2n }));
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      const response = await harness.invoke("PATCH /api/admin/customers/:customerId", {
        body: update,
      });
      expect(response.statusCode).toBe(200);
      expect(operations.updateCustomer).toHaveBeenCalledWith("session=opaque", customerId, {
        expectedLockVersion: 1n,
        customer: {
          displayName: "Quintela Lda",
          email: null,
          phone: "+351 210 000 000",
          notes: null,
        },
      });
      expect(response.body).toMatchObject({ lockVersion: "2" });
    });

    it("rejects unknown fields, missing fields and malformed lock versions", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      for (const body of [
        { displayName: "Quintela Lda", email: null, phone: null, notes: null },
        { ...update, agencyId },
        { ...update, expectedLockVersion: 1 },
        { ...update, expectedLockVersion: "-1" },
        { ...update, expectedLockVersion: "9223372036854775808" },
        { ...update, displayName: "" },
      ]) {
        const response = await harness.invoke("PATCH /api/admin/customers/:customerId", {
          body,
        });
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
      expect(operations.updateCustomer).not.toHaveBeenCalled();
    });

    it("maps a stale lock version to 409 optimistic_conflict and a missing Customer to 404", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      operations.updateCustomer.mockRejectedValueOnce(new OptimisticConflictError());
      const stale = await harness.invoke("PATCH /api/admin/customers/:customerId", {
        body: update,
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.body).toEqual({ error: "optimistic_conflict" });
      operations.updateCustomer.mockRejectedValueOnce(new CrmNotFoundError());
      expect(
        (await harness.invoke("PATCH /api/admin/customers/:customerId", { body: update }))
          .statusCode,
      ).toBe(404);
    });
  });

  describe("POST /api/admin/customers/:customerId/persons", () => {
    it("adds a person with roles and returns 201 with the refreshed Customer", async () => {
      const operations = makeOperations();
      operations.addPerson.mockResolvedValue(detail());
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      const response = await harness.invoke("POST /api/admin/customers/:customerId/persons", {
        body: validPersonBody,
      });
      expect(response.statusCode).toBe(201);
      expect(operations.addPerson).toHaveBeenCalledWith("session=opaque", customerId, {
        person: {
          givenName: "Duarte",
          familyName: "Quintela",
          email: null,
          phone: null,
          nationality: null,
          notes: null,
        },
        roles: ["TRAVELLER"],
      });
    });

    it("rejects sensitive fields on creation, empty or repeated roles and unknown roles", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      for (const body of [
        { ...validPersonBody, passportNumber: "P1" },
        { ...validPersonBody, birthDate: "1980-01-01" },
        { ...validPersonBody, roles: [] },
        { ...validPersonBody, roles: ["PAYER", "PAYER"] },
        { ...validPersonBody, roles: ["OWNER"] },
        { ...validPersonBody, roles: undefined },
      ]) {
        const response = await harness.invoke("POST /api/admin/customers/:customerId/persons", {
          body,
        });
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
      expect(operations.addPerson).not.toHaveBeenCalled();
    });

    it("maps a missing Customer to 404 and a missing edit grant to 403", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      operations.addPerson.mockRejectedValueOnce(new CrmNotFoundError());
      expect(
        (
          await harness.invoke("POST /api/admin/customers/:customerId/persons", {
            body: validPersonBody,
          })
        ).statusCode,
      ).toBe(404);
      operations.addPerson.mockRejectedValueOnce(new StaffAuthorizationError("FORBIDDEN"));
      expect(
        (
          await harness.invoke("POST /api/admin/customers/:customerId/persons", {
            body: validPersonBody,
          })
        ).statusCode,
      ).toBe(403);
    });
  });

  describe("PATCH /api/admin/persons/:personId", () => {
    const update = {
      expectedLockVersion: "0",
      givenName: "Marta",
      familyName: "Quintela",
      email: null,
      phone: null,
      nationality: "PT",
      notes: null,
    };

    it("updates non-sensitive fields and leaves omitted sensitive fields untouched", async () => {
      const operations = makeOperations();
      operations.updatePerson.mockResolvedValue(person({ lockVersion: 1n }));
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      const response = await harness.invoke("PATCH /api/admin/persons/:personId", {
        body: update,
        params: { personId },
      });
      expect(response.statusCode).toBe(200);
      const [, calledId, input] = operations.updatePerson.mock.calls[0] ?? [];
      expect(calledId).toBe(personId);
      expect(input).toEqual({
        expectedLockVersion: 0n,
        person: {
          givenName: "Marta",
          familyName: "Quintela",
          email: null,
          phone: null,
          nationality: "PT",
          notes: null,
        },
      });
      expect(response.body).toMatchObject({ id: personId, lockVersion: "1" });
    });

    it("passes sensitive fields through when present, including explicit nulls", async () => {
      const operations = makeOperations();
      operations.updatePerson.mockResolvedValue(
        person({ passportNumber: "P123456", passportExpiry: "2031-01-01", lockVersion: 1n }),
      );
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      await harness.invoke("PATCH /api/admin/persons/:personId", {
        body: {
          ...update,
          birthDate: "1980-02-29",
          passportNumber: "P123456",
          passportExpiry: "2031-01-01",
        },
        params: { personId },
      });
      expect(operations.updatePerson.mock.calls[0]?.[2]).toMatchObject({
        person: {
          birthDate: "1980-02-29",
          passportNumber: "P123456",
          passportExpiry: "2031-01-01",
        },
      });
      await harness.invoke("PATCH /api/admin/persons/:personId", {
        body: { ...update, passportNumber: null },
        params: { personId },
      });
      expect(operations.updatePerson.mock.calls[1]?.[2]).toMatchObject({
        person: { passportNumber: null },
      });
      expect(operations.updatePerson.mock.calls[1]?.[2].person).not.toHaveProperty("birthDate");
    });

    it("rejects malformed dates, unknown fields and a stale or invalid lock version", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      for (const body of [
        { ...update, birthDate: "1980-2-29" },
        { ...update, passportExpiry: "next year" },
        { ...update, agencyId },
        { ...update, expectedLockVersion: "-1" },
        { ...update, lockVersion: "1" },
      ]) {
        const response = await harness.invoke("PATCH /api/admin/persons/:personId", {
          body,
          params: { personId },
        });
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
      expect(operations.updatePerson).not.toHaveBeenCalled();
    });

    it("maps a stale person version to 409 and a cross-Agency person to 404", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      operations.updatePerson.mockRejectedValueOnce(new OptimisticConflictError());
      const stale = await harness.invoke("PATCH /api/admin/persons/:personId", {
        body: update,
        params: { personId },
      });
      expect(stale.statusCode).toBe(409);
      operations.updatePerson.mockRejectedValueOnce(new CrmNotFoundError());
      expect(
        (
          await harness.invoke("PATCH /api/admin/persons/:personId", {
            body: update,
            params: { personId },
          })
        ).statusCode,
      ).toBe(404);
    });
  });

  describe("PUT /api/admin/customers/:customerId/persons/:personId/roles", () => {
    const path = "PUT /api/admin/customers/:customerId/persons/:personId/roles";

    it("replaces the roles and primary flag and returns the refreshed Customer", async () => {
      const operations = makeOperations();
      operations.setPersonRoles.mockResolvedValue(detail());
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      const response = await harness.invoke(path, {
        body: { roles: ["PRIMARY_CONTACT", "PAYER"], isPrimary: true },
        params: { customerId, personId },
      });
      expect(response.statusCode).toBe(200);
      expect(operations.setPersonRoles).toHaveBeenCalledWith(
        "session=opaque",
        customerId,
        personId,
        {
          roles: ["PRIMARY_CONTACT", "PAYER"],
          isPrimary: true,
        },
      );
    });

    it("rejects empty, repeated or unknown roles, a missing primary flag and extra fields", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      for (const body of [
        { roles: [], isPrimary: false },
        { roles: ["PAYER", "PAYER"], isPrimary: false },
        { roles: ["OWNER"], isPrimary: false },
        { roles: ["PAYER"] },
        { roles: ["PAYER"], isPrimary: "yes" },
        { roles: ["PAYER"], isPrimary: false, agencyId },
      ]) {
        const response = await harness.invoke(path, {
          body,
          params: { customerId, personId },
        });
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
      expect(operations.setPersonRoles).not.toHaveBeenCalled();
    });

    it("maps a person that is not linked to the Customer to 404", async () => {
      const operations = makeOperations();
      operations.setPersonRoles.mockRejectedValueOnce(new CrmNotFoundError());
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      const response = await harness.invoke(path, {
        body: { roles: ["PAYER"], isPrimary: false },
        params: { customerId, personId },
      });
      expect(response.statusCode).toBe(404);
    });

    it("requires the canonical Origin", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      const response = await harness.invoke(path, {
        body: { roles: ["PAYER"], isPrimary: false },
        params: { customerId, personId },
        headers: { host: "admin.example.test", cookie: "session=opaque" },
      });
      expect(response.statusCode).toBe(403);
      expect(operations.setPersonRoles).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/admin/search", () => {
    it("searches customers, leads and trips with a query of 2 to 100 characters", async () => {
      const operations = makeOperations();
      operations.search.mockResolvedValue({
        customers: [summary()],
        leads: [{ id: leadId, name: "Marta Quintela", state: "OPEN" }],
        trips: [
          {
            id: tripId,
            title: "Açores",
            startDate: "2027-06-04",
            endDate: "2027-06-11",
            state: "DRAFT",
          },
        ],
      });
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      const response = await harness.invoke("GET /api/admin/search", {
        query: { q: "quintela" },
      });
      expect(response.statusCode).toBe(200);
      expect(operations.search).toHaveBeenCalledWith("session=opaque", "quintela");
      expect(response.body).toMatchObject({
        customers: [{ id: customerId }],
        leads: [{ id: leadId }],
        trips: [{ id: tripId }],
      });
    });

    it("rejects queries outside 2 to 100 characters, missing queries and extra keys before any use case runs", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      for (const query of [
        {},
        { q: "a" },
        { q: " a " },
        { q: "x".repeat(101) },
        { q: "ok", expand: "all" },
        { q: ["ab", "cd"] as readonly string[] },
      ]) {
        const response = await harness.invoke("GET /api/admin/search", { query });
        expect(response.statusCode, JSON.stringify(query)).toBe(400);
      }
      expect(operations.search).not.toHaveBeenCalled();
    });

    it("rejects a wrong Host before any use case runs", async () => {
      const operations = makeOperations();
      const harness = makeHarness(operations as unknown as StaffCrmOperations);
      const response = await harness.invoke("GET /api/admin/search", {
        query: { q: "quintela" },
        headers: sessionHeaders({ host: "other.example.test" }),
      });
      expect(response.statusCode).toBe(404);
      expect(operations.search).not.toHaveBeenCalled();
    });
  });
});
