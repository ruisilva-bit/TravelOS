import { describe, expect, it, vi } from "vitest";

import {
  asOpaqueId,
  StaffTripAccessNotFoundError,
  type TripAccessGrant,
} from "@travelos/backend-core";
import {
  STAFF_AUTH_BASE_PATH,
  type AuthRealm,
  type AuthSurfacePolicy,
} from "@travelos/auth-adapters";
import { registerAdminAuthBridge } from "../../src/auth-bridge.js";
import { registerAdminRoutes, type AdminExpressApplication } from "../../src/admin-routes.js";

const agencyId = "00000000-0000-7000-8000-000000000001";
const tripId = "00000000-0000-7000-8000-000000000010";
const grantId = "00000000-0000-7000-8000-000000000020";
const policy: AuthSurfacePolicy = {
  canonicalOrigin: "https://admin.example.test",
  expectedHost: "admin.example.test",
};
const issueRequest = {
  agencyId,
  portalPrincipalId: "portal-principal-synthetic",
  tripId,
  idempotencyKey: "issue-synthetic-1",
  relationshipLabel: "Primary traveller",
};
const revokeRequest = { agencyId, grantId, idempotencyKey: "revoke-synthetic-1" };
const activeGrant = {
  grantId: asOpaqueId(grantId),
  agencyId: asOpaqueId(agencyId),
  portalPrincipalId: "portal-principal-synthetic",
  tripId: asOpaqueId(tripId),
  capabilities: ["trip.view_current"] as const,
  issuedByStaffPrincipalId: "staff-synthetic",
  issuedAt: "2026-10-15T10:00:00.000Z",
  expiresAt: null,
  relationshipLabel: "Primary traveller",
  revokedByStaffPrincipalId: null,
  revokedAt: null,
};
const revokedGrant = {
  ...activeGrant,
  revokedByStaffPrincipalId: "staff-synthetic",
  revokedAt: "2026-10-15T10:01:00.000Z",
};

const makeHarness = (
  overrides: {
    readonly issue?: () => Promise<TripAccessGrant>;
    readonly revoke?: () => Promise<TripAccessGrant>;
  } = {},
) => {
  type Handler = Parameters<AdminExpressApplication["post"]>[1];
  const handlers = new Map<string, Handler>();
  const application: AdminExpressApplication = {
    get: (path, handler) => handlers.set(`GET ${path}`, handler),
    post: (path, handler) => handlers.set(`POST ${path}`, handler),
    patch: (path, handler) => handlers.set(`PATCH ${path}`, handler),
  };
  const operations = {
    issueTripAccessGrant: vi.fn(overrides.issue ?? (async () => activeGrant)),
    revokeTripAccessGrant: vi.fn(overrides.revoke ?? (async () => revokedGrant)),
    retireFixturePortalPrincipal: vi.fn(async () => undefined as never),
  };
  registerAdminRoutes(application, {
    policy,
    tripOperations: {} as never,
    tripAccessOperations: operations,
  });

  const invoke = async (
    key: string,
    body: unknown,
    params: Readonly<Record<string, string>>,
    headers: Record<string, string | string[] | undefined> = {
      host: "admin.example.test",
      origin: "https://admin.example.test",
      cookie: "staff_session=synthetic",
    },
  ) => {
    const handler = handlers.get(key);
    const response = {
      statusCode: 200,
      body: undefined as unknown,
      headers: new Map<string, string | readonly string[]>(),
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      setHeader(name: string, value: string | readonly string[]) {
        this.headers.set(name.toLowerCase(), value);
      },
      end() {},
      json(value: unknown) {
        this.body = value;
      },
    };
    if (handler === undefined) {
      response.statusCode = 404;
      return response;
    }
    let nextError: unknown;
    handler(
      {
        method: key.split(" ")[0] ?? "POST",
        url: "/api/admin/trips",
        originalUrl: "/api/admin/trips",
        headers,
        body,
        params,
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

  return { invoke, operations };
};

describe("Admin TripAccessGrant routes", () => {
  it("issues an exact Trip-scoped grant through the Staff session", async () => {
    const harness = makeHarness();
    const response = await harness.invoke(
      "POST /api/admin/trips/:tripId/portal-access-grants",
      issueRequest,
      { tripId },
    );

    expect(response.statusCode).toBe(201);
    expect(response.body).toEqual(activeGrant);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(harness.operations.issueTripAccessGrant).toHaveBeenCalledWith(
      "staff_session=synthetic",
      issueRequest,
    );
  });

  it("rejects unknown fields and a body Trip that differs from the route before authorization", async () => {
    const withUnknownField = makeHarness();
    const unknownFieldResponse = await withUnknownField.invoke(
      "POST /api/admin/trips/:tripId/portal-access-grants",
      { ...issueRequest, supplierCost: "INTERNAL_ONLY-sentinel" },
      { tripId },
    );
    expect(unknownFieldResponse.statusCode).toBe(400);
    expect(withUnknownField.operations.issueTripAccessGrant).not.toHaveBeenCalled();

    const mismatchedTrip = makeHarness();
    const mismatchResponse = await mismatchedTrip.invoke(
      "POST /api/admin/trips/:tripId/portal-access-grants",
      { ...issueRequest, tripId: "00000000-0000-7000-8000-000000000099" },
      { tripId },
    );
    expect(mismatchResponse.statusCode).toBe(400);
    expect(mismatchedTrip.operations.issueTripAccessGrant).not.toHaveBeenCalled();
  });

  it("requires the canonical Staff origin before creating a grant", async () => {
    const harness = makeHarness();
    const response = await harness.invoke(
      "POST /api/admin/trips/:tripId/portal-access-grants",
      issueRequest,
      { tripId },
      {
        host: "admin.example.test",
        origin: "https://attacker.example.test",
        cookie: "staff_session=synthetic",
      },
    );

    expect(response.statusCode).toBe(403);
    expect(harness.operations.issueTripAccessGrant).not.toHaveBeenCalled();
  });

  it("revokes the path-matched grant and returns only the strict grant contract", async () => {
    const harness = makeHarness();
    const response = await harness.invoke(
      "POST /api/admin/portal-access-grants/:grantId/revocations",
      revokeRequest,
      { grantId },
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(revokedGrant);
    expect(harness.operations.revokeTripAccessGrant).toHaveBeenCalledWith(
      "staff_session=synthetic",
      revokeRequest,
    );
  });

  it("maps a missing or cross-Agency grant to a non-leaking 404", async () => {
    const harness = makeHarness({
      revoke: async () => {
        throw new StaffTripAccessNotFoundError();
      },
    });
    const response = await harness.invoke(
      "POST /api/admin/portal-access-grants/:grantId/revocations",
      revokeRequest,
      { grantId },
    );

    expect(response.statusCode).toBe(404);
    expect(response.body).toBeUndefined();
  });

  it("wires the grant routes only through the Admin Staff auth bridge", () => {
    const routes = new Map<string, unknown>();
    const express = {
      use: vi.fn(),
      get: (path: string, handler: unknown) => routes.set(`GET ${path}`, handler),
      post: (path: string, handler: unknown) => routes.set(`POST ${path}`, handler),
      patch: (path: string, handler: unknown) => routes.set(`PATCH ${path}`, handler),
    };
    const realm: AuthRealm = {
      kind: "STAFF",
      basePath: STAFF_AUTH_BASE_PATH,
      cookieName: "staff-session-synthetic",
      secureTransportRequired: false,
      async handle() {
        return new Response(null, { status: 200 });
      },
      async getServerSession() {
        return null;
      },
    };

    registerAdminAuthBridge(
      { getHttpAdapter: () => ({ getInstance: () => express }) } as never,
      {
        realm,
        policy,
        staffAccessRepository: { getStaffAuthorizationSnapshot: vi.fn().mockResolvedValue(null) },
        tripOperations: {} as never,
        tripAccessOperations: {
          issueTripAccessGrant: vi.fn(),
          revokeTripAccessGrant: vi.fn(),
          retireFixturePortalPrincipal: vi.fn(),
        },
      } as never,
    );

    expect(routes.has("POST /api/admin/trips/:tripId/portal-access-grants")).toBe(true);
    expect(routes.has("POST /api/admin/portal-access-grants/:grantId/revocations")).toBe(true);
  });
});
