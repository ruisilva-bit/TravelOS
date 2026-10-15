import { describe, expect, it } from "vitest";

import type { PortalAuthRealm } from "@travelos/auth-adapters/portal";

import { registerPortalAuthBridge } from "../src/auth-bridge.js";

type Handler = (
  request: RequestLike,
  response: ResponseLike,
  next: (error?: unknown) => void,
) => void;
type RequestLike = {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
};
type ResponseLike = {
  status(statusCode: number): ResponseLike;
  setHeader(name: string, value: string | readonly string[]): void;
  end(body?: Uint8Array): void;
  json(body: unknown): void;
};

class FakeExpress {
  readonly middleware: Handler[] = [];
  readonly routes = new Map<string, Handler>();
  use(handler: Handler): void {
    this.middleware.push(handler);
  }
  get(path: string, handler: Handler): void {
    this.routes.set(path, handler);
  }
}

const policy = {
  canonicalOrigin: "http://portal.travelos.test",
  expectedHost: "portal.travelos.test",
};

const portalRealm = (kind: "PORTAL" | "STAFF" = "PORTAL"): PortalAuthRealm =>
  ({
    kind,
    basePath: kind === "PORTAL" ? "/api/auth/portal" : "/api/auth/staff",
    cookieName: "travelos-dev-portal-session",
    secureTransportRequired: false,
    async handle() {
      return new Response("portal-auth", { status: 200 });
    },
    async getServerSession() {
      return {
        realm: kind,
        sessionId: "portal-session-1",
        principalId: "portal-principal-1",
        expiresAtEpochMs: Date.now() + 60_000,
        agencyId: "00000000-0000-7000-8000-000000000071",
        authorizationEpoch: 1n,
        recentMfaVerifiedAtEpochMs: null,
      };
    },
  }) as unknown as PortalAuthRealm;

const invoke = async (handler: Handler, request: RequestLike) =>
  new Promise<{
    readonly status: number | null;
    readonly body: unknown;
    readonly headers: Readonly<Record<string, string | readonly string[]>>;
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
        resolve({ status, body, headers });
      },
      json(body) {
        resolve({ status: status ?? 200, body, headers });
      },
    };
    handler(request, response, (error) => {
      if (error !== undefined) reject(error);
      else resolve({ status, body: undefined, headers });
    });
  });

describe("Portal auth-only bridge", () => {
  it("refuses a Staff realm at composition time", () => {
    const express = new FakeExpress();
    expect(() =>
      registerPortalAuthBridge(
        { getHttpAdapter: () => ({ getInstance: () => express }) },
        { realm: portalRealm("STAFF"), policy },
      ),
    ).toThrow("Portal realm");
  });

  it("returns only Portal principal identity and no Agency/RBAC/workspace fields", async () => {
    const express = new FakeExpress();
    registerPortalAuthBridge(
      { getHttpAdapter: () => ({ getInstance: () => express }) },
      { realm: portalRealm(), policy },
    );
    const handler = express.routes.get("/api/portal/session-context");
    const result = await invoke(handler!, {
      method: "GET",
      url: "/api/portal/session-context",
      headers: { host: policy.expectedHost },
    });
    expect(result).toEqual({
      status: 200,
      headers: { "cache-control": "no-store, private" },
      body: { authenticated: true, portalPrincipalId: "portal-principal-1" },
    });
    expect(Object.keys(result.body as Record<string, unknown>).toSorted()).toEqual([
      "authenticated",
      "portalPrincipalId",
    ]);
  });

  it("rejects a wrong host before reading Portal identity", async () => {
    const express = new FakeExpress();
    registerPortalAuthBridge(
      { getHttpAdapter: () => ({ getInstance: () => express }) },
      { realm: portalRealm(), policy },
    );
    const handler = express.routes.get("/api/portal/session-context");
    await expect(
      invoke(handler!, {
        method: "GET",
        url: "/api/portal/session-context",
        headers: { host: "admin.travelos.test" },
      }),
    ).resolves.toMatchObject({ status: 404 });
  });
});
