import { describe, expect, it, vi } from "vitest";

import { STAFF_AUTH_BASE_PATH, type AuthRealm } from "@travelos/auth-adapters";
import { STAFF_INVITATION_RECENT_MFA_MAXIMUM_AGE_MS } from "@travelos/backend-core";

import { registerAdminAuthBridge } from "../src/auth-bridge.js";

type Handler = (
  request: RequestLike,
  response: ResponseLike,
  next: (error?: unknown) => void,
) => void;

type RequestLike = {
  readonly method: string;
  readonly url: string;
  readonly originalUrl?: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body?: unknown;
};

type ResponseLike = {
  status(statusCode: number): ResponseLike;
  setHeader(name: string, value: string | readonly string[]): void;
  end(body?: Uint8Array): void;
  json(body: unknown): void;
};

class FakeExpress {
  middleware: Handler[] = [];
  readonly routes = new Map<string, Handler>();

  use(handler: Handler): void {
    this.middleware.push(handler);
  }

  get(path: string, handler: Handler): void {
    this.routes.set(path, handler);
  }
}

const policy = {
  canonicalOrigin: "http://admin.travelos.test",
  expectedHost: "admin.travelos.test",
};

const staffRealm = (
  overrides: Partial<AuthRealm> = {},
  recentMfaVerifiedAtEpochMs = Date.now() - 1_000,
): AuthRealm => ({
  kind: "STAFF",
  basePath: "/api/auth/staff",
  cookieName: "travelos-dev-staff-session",
  secureTransportRequired: false,
  async handle() {
    return new Response("staff-auth", { status: 200 });
  },
  async getServerSession() {
    return {
      realm: "STAFF",
      sessionId: "staff-session-1",
      principalId: "staff-principal-1",
      expiresAtEpochMs: Date.now() + 60_000,
      agencyId: "00000000-0000-7000-8000-000000000001",
      authorizationEpoch: 7n,
      recentMfaVerifiedAtEpochMs,
    };
  },
  ...overrides,
});

const invoke = async (handler: Handler, request: RequestLike) =>
  new Promise<{
    readonly status: number | null;
    readonly body: unknown;
    readonly headers: Readonly<Record<string, string | readonly string[]>>;
    readonly next: boolean;
  }>((resolve, reject) => {
    let status: number | null = null;
    const headers: Record<string, string | readonly string[]> = {};
    const response: ResponseLike = {
      status(code) {
        status = code;
        return this;
      },
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      end(body) {
        resolve({ status, body, headers, next: false });
      },
      json(body) {
        resolve({ status: status ?? 200, body, headers, next: false });
      },
    };
    handler(request, response, (error) => {
      if (error !== undefined) reject(error);
      else resolve({ status, body: undefined, headers, next: true });
    });
  });

const sessionContextRequest = (
  headers: Record<string, string | string[] | undefined> = { host: policy.expectedHost },
): RequestLike => ({
  method: "GET",
  url: "/api/staff/session-context",
  headers,
});

describe("Admin Staff auth bridge", () => {
  it("refuses a Portal realm at composition time", () => {
    const express = new FakeExpress();
    expect(() =>
      registerAdminAuthBridge(
        { getHttpAdapter: () => ({ getInstance: () => express }) },
        { ...bridgeOptions(), realm: { ...staffRealm(), kind: "PORTAL" } },
      ),
    ).toThrow("Staff realm");
  });

  it("refuses a non-canonical Staff authentication prefix at composition time", () => {
    const express = new FakeExpress();
    expect(() =>
      registerAdminAuthBridge(
        { getHttpAdapter: () => ({ getInstance: () => express }) },
        { ...bridgeOptions(), realm: staffRealm({ basePath: "/api/auth" }) },
      ),
    ).toThrow("canonical Staff authentication prefix");
    expect(STAFF_AUTH_BASE_PATH).toBe("/api/auth/staff");
  });

  it("rechecks membership and authorization epoch before returning trusted session context", async () => {
    const express = new FakeExpress();
    const options = bridgeOptions();
    registerAdminAuthBridge({ getHttpAdapter: () => ({ getInstance: () => express }) }, options);
    const handler = express.routes.get("/api/staff/session-context");
    expect(handler).toBeDefined();
    await expect(invoke(handler!, sessionContextRequest())).resolves.toEqual({
      status: 200,
      next: false,
      headers: { "cache-control": "private, no-store" },
      body: {
        principalId: "staff-principal-1",
        agencyId: "00000000-0000-7000-8000-000000000001",
        authorizationEpoch: "7",
        recentMfaVerifiedAtEpochMs: expect.any(Number),
        canInviteStaff: false,
      },
    });
    expect(options.staffAccessRepository.getStaffAuthorizationSnapshot).toHaveBeenCalledWith(
      "staff-principal-1",
      "00000000-0000-7000-8000-000000000001",
    );

    const staleExpress = new FakeExpress();
    registerAdminAuthBridge(
      { getHttpAdapter: () => ({ getInstance: () => staleExpress }) },
      bridgeOptions(8n),
    );
    const staleHandler = staleExpress.routes.get("/api/staff/session-context");
    await expect(invoke(staleHandler!, sessionContextRequest())).resolves.toMatchObject({
      status: 403,
      headers: { "cache-control": "private, no-store" },
    });
  });

  it("derives the invitation UI hint from live Agency permission and recent MFA", async () => {
    const permittedExpress = new FakeExpress();
    registerAdminAuthBridge(
      { getHttpAdapter: () => ({ getInstance: () => permittedExpress }) },
      bridgeOptions(7n, true),
    );
    const permitted = await invoke(
      permittedExpress.routes.get("/api/staff/session-context")!,
      sessionContextRequest(),
    );
    expect(permitted.body).toMatchObject({ canInviteStaff: true });

    const staleMfaExpress = new FakeExpress();
    registerAdminAuthBridge(
      { getHttpAdapter: () => ({ getInstance: () => staleMfaExpress }) },
      bridgeOptions(7n, true, STAFF_INVITATION_RECENT_MFA_MAXIMUM_AGE_MS + 1),
    );
    const staleMfa = await invoke(
      staleMfaExpress.routes.get("/api/staff/session-context")!,
      sessionContextRequest(),
    );
    expect(staleMfa.body).toMatchObject({ canInviteStaff: false });
  });

  it("marks every auth-surface rejection and session denial as private and non-storable", async () => {
    const express = new FakeExpress();
    registerAdminAuthBridge(
      { getHttpAdapter: () => ({ getInstance: () => express }) },
      bridgeOptions(),
    );
    const context = express.routes.get("/api/staff/session-context");
    await expect(
      invoke(context!, sessionContextRequest({ host: "portal.travelos.test" })),
    ).resolves.toMatchObject({
      status: 404,
      headers: { "cache-control": "private, no-store" },
    });
    await expect(
      invoke(
        context!,
        sessionContextRequest({ host: policy.expectedHost, authorization: "Bearer redacted" }),
      ),
    ).resolves.toMatchObject({
      status: 403,
      headers: { "cache-control": "private, no-store" },
    });

    const noSessionExpress = new FakeExpress();
    registerAdminAuthBridge(
      { getHttpAdapter: () => ({ getInstance: () => noSessionExpress }) },
      {
        ...bridgeOptions(),
        realm: staffRealm({
          async getServerSession() {
            return null;
          },
        }),
      },
    );
    await expect(
      invoke(noSessionExpress.routes.get("/api/staff/session-context")!, sessionContextRequest()),
    ).resolves.toMatchObject({
      status: 401,
      headers: { "cache-control": "private, no-store" },
    });

    await expect(
      invoke(express.middleware[0]!, {
        method: "GET",
        url: "/api/auth/staff/get-session",
        headers: { host: "portal.travelos.test" },
      }),
    ).resolves.toMatchObject({
      status: 404,
      headers: { "cache-control": "private, no-store" },
    });
    await expect(
      invoke(express.middleware[0]!, {
        method: "GET",
        url: "/api/auth/staff/get-session",
        headers: { host: policy.expectedHost, authorization: "Bearer redacted" },
      }),
    ).resolves.toMatchObject({
      status: 403,
      headers: { "cache-control": "private, no-store" },
    });
  });

  it("does not accept a wrong host or allow auth routing outside the Staff prefix", async () => {
    const express = new FakeExpress();
    registerAdminAuthBridge(
      { getHttpAdapter: () => ({ getInstance: () => express }) },
      bridgeOptions(),
    );
    const context = express.routes.get("/api/staff/session-context");
    await expect(
      invoke(context!, sessionContextRequest({ host: "portal.travelos.test" })),
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      invoke(express.middleware[0]!, {
        method: "GET",
        url: "/api/auth/portal/get-session",
        headers: { host: policy.expectedHost },
      }),
    ).resolves.toMatchObject({ next: true });
  });
});

function bridgeOptions(epoch = 7n, invitationPermission = false, recentMfaAgeMs = 1_000) {
  const getStaffAuthorizationSnapshot = vi.fn(
    async (staffPrincipalId: string, requestedAgencyId: string) => ({
      staffPrincipalId,
      agencyId: requestedAgencyId,
      membershipState: "ACTIVE" as const,
      authorizationEpoch: epoch,
      assignments: [
        {
          agencyId: requestedAgencyId,
          permissionId: "agency.view" as const,
          scopeKind: "AGENCY" as const,
          organizationUnitId: null,
          accessLevel: "ALL" as const,
          active: true,
        },
        ...(invitationPermission
          ? [
              {
                agencyId: requestedAgencyId,
                permissionId: "staff.invite" as const,
                scopeKind: "AGENCY" as const,
                organizationUnitId: null,
                accessLevel: "ALL" as const,
                active: true,
              },
            ]
          : []),
      ],
    }),
  );
  return {
    realm: staffRealm({}, Date.now() - recentMfaAgeMs),
    policy,
    staffAccessRepository: { getStaffAuthorizationSnapshot },
  };
}
