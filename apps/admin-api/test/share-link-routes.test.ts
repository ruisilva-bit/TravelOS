import { describe, expect, it, vi } from "vitest";
import {
  asOpaqueId,
  IdempotencyConflictError,
  ShareLinkNotFoundError,
  StaffAuthorizationError,
  type StaffShareLinkOperations,
  type StaffTripOperations,
} from "@travelos/backend-core";
import type { AuthSurfacePolicy } from "@travelos/auth-adapters";
import { registerAdminRoutes, type AdminExpressApplication } from "../src/admin-routes.js";

const policy: AuthSurfacePolicy = {
  canonicalOrigin: "https://admin.example.test",
  expectedHost: "admin.example.test",
};
const tripId = asOpaqueId("00000000-0000-7000-8000-000000000010");
const shareLinkId = asOpaqueId("00000000-0000-7000-8000-000000000011");
const token = "Q".repeat(43);
const goodHeaders = {
  host: "admin.example.test",
  origin: "https://admin.example.test",
  cookie: "session=opaque",
  "idempotency-key": "share-key-1",
};

const makeHarness = (shareLinkOperations: StaffShareLinkOperations) => {
  type Handler = Parameters<AdminExpressApplication["get"]>[1];
  const handlers = new Map<string, Handler>();
  registerAdminRoutes(
    {
      get: (path, handler) => handlers.set(`GET ${path}`, handler),
      post: (path, handler) => handlers.set(`POST ${path}`, handler),
      patch: () => undefined,
    },
    { policy, tripOperations: {} as StaffTripOperations, shareLinkOperations },
  );
  const invoke = async (
    key: string,
    body?: unknown,
    headers: Record<string, string | undefined> = goodHeaders,
    params: Record<string, string> = { tripId, shareLinkId },
  ) => {
    const handler = handlers.get(key);
    if (handler === undefined) throw new Error(`Missing handler ${key}`);
    const response = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      setHeader() {},
      end() {},
      json(value: unknown) {
        this.body = value;
      },
    };
    let nextError: unknown;
    handler(
      {
        method: key.split(" ")[0] ?? "GET",
        url: "/api/admin/x",
        originalUrl: "/api/admin/x",
        headers,
        body,
        params,
        query: {},
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
  return { invoke };
};

const created = {
  shareLinkId,
  token,
  url: `https://admin.example.test/v/${token}`,
  createdAt: "2026-11-27T10:00:00.000Z",
  expiresAt: "2027-02-25T10:00:00.000Z",
};
const summary = {
  shareLinkId,
  createdAt: created.createdAt,
  expiresAt: created.expiresAt,
  revokedAt: null,
  state: "ACTIVE" as const,
  createdBy: "staff-1",
};

const operationsWith = (
  overrides: Partial<StaffShareLinkOperations>,
): StaffShareLinkOperations => ({
  createShareLink: vi.fn(),
  listShareLinks: vi.fn(),
  revokeShareLink: vi.fn(),
  ...overrides,
});

const POST = "POST /api/admin/trips/:tripId/share-links";
const GET = "GET /api/admin/trips/:tripId/share-links";
const REVOKE = "POST /api/admin/share-links/:shareLinkId/revoke";

describe("Admin share-link routes", () => {
  it("creates a link, passing the cookie, validity and Idempotency-Key, and returns the token", async () => {
    const createShareLink = vi.fn().mockResolvedValue(created);
    const harness = makeHarness(operationsWith({ createShareLink }));
    const response = await harness.invoke(POST, { expiresInDays: 30 });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(created);
    expect(createShareLink).toHaveBeenCalledWith("session=opaque", tripId, {
      expiresInDays: 30,
      idempotencyKey: "share-key-1",
    });
  });

  it("rejects bad bodies, a missing Idempotency-Key and a foreign Origin without calling the use-case", async () => {
    const createShareLink = vi.fn();
    const harness = makeHarness(operationsWith({ createShareLink }));
    expect((await harness.invoke(POST, { expiresInDays: 400 })).statusCode).toBe(400);
    expect((await harness.invoke(POST, { extra: 1 })).statusCode).toBe(400);
    expect(
      (await harness.invoke(POST, {}, { ...goodHeaders, "idempotency-key": undefined })).statusCode,
    ).toBe(400);
    expect(
      (await harness.invoke(POST, {}, { ...goodHeaders, origin: "https://evil.example" }))
        .statusCode,
    ).toBe(403);
    expect(createShareLink).not.toHaveBeenCalled();
  });

  it("maps 401, 403, other-agency 404 and idempotency reuse 409", async () => {
    const failing = (error: Error) =>
      makeHarness(
        operationsWith({
          createShareLink: vi.fn().mockRejectedValue(error),
          listShareLinks: vi.fn().mockRejectedValue(error),
          revokeShareLink: vi.fn().mockRejectedValue(error),
        }),
      );
    expect(
      (await failing(new StaffAuthorizationError("UNAUTHENTICATED")).invoke(POST, {})).statusCode,
    ).toBe(401);
    expect((await failing(new StaffAuthorizationError("FORBIDDEN")).invoke(GET)).statusCode).toBe(
      403,
    );
    expect((await failing(new ShareLinkNotFoundError()).invoke(REVOKE, {})).statusCode).toBe(404);
    const conflict = await failing(new IdempotencyConflictError()).invoke(POST, {});
    expect(conflict.statusCode).toBe(409);
    expect(conflict.body).toEqual({ error: "IDEMPOTENCY_KEY_CONFLICT" });
  });

  it("lists strictly: a token or hash smuggled into a row fails the response contract", async () => {
    const listShareLinks = vi.fn().mockResolvedValue([summary]);
    const harness = makeHarness(operationsWith({ listShareLinks }));
    const ok = await harness.invoke(GET);
    expect(ok.body).toEqual({ links: [summary] });
    expect(JSON.stringify(ok.body)).not.toContain(token);
    listShareLinks.mockResolvedValue([{ ...summary, token }]);
    await expect(harness.invoke(GET)).rejects.toThrow();
  });

  it("revokes through the dedicated endpoint", async () => {
    const revokeShareLink = vi.fn().mockResolvedValue(undefined);
    const harness = makeHarness(operationsWith({ revokeShareLink }));
    const response = await harness.invoke(REVOKE, {});
    expect(response.body).toEqual({ revoked: true });
    expect(revokeShareLink).toHaveBeenCalledWith("session=opaque", shareLinkId);
  });
});
