import { describe, expect, it, vi } from "vitest";

import type { AuthRealm } from "@travelos/auth-adapters";

import { createAdminStaffSessionResolver } from "../src/staff-session-resolver.js";

const policy = {
  canonicalOrigin: "https://admin.example.test",
  expectedHost: "admin.example.test",
};

const session = {
  realm: "STAFF",
  sessionId: "synthetic-session",
  principalId: "synthetic-staff-principal",
  expiresAtEpochMs: 1_800_000_000_000,
  agencyId: "00000000-0000-7000-8000-000000000001",
  authorizationEpoch: 7n,
  recentMfaVerifiedAtEpochMs: null,
};

describe("Admin Staff application session resolver", () => {
  it("derives identity only from the Staff realm's server-verified session", async () => {
    const getServerSession = vi.fn().mockResolvedValue(session);
    const realm = { kind: "STAFF", getServerSession } as unknown as AuthRealm;
    const resolver = createAdminStaffSessionResolver(realm, policy);

    await expect(resolver.resolveStaffSession("travelos_staff=opaque-session")).resolves.toEqual({
      sessionId: session.sessionId,
      staffPrincipalId: session.principalId,
      agencyId: session.agencyId,
      authorizationEpoch: session.authorizationEpoch,
      expiresAtEpochMs: session.expiresAtEpochMs,
      recentMfaVerifiedAtEpochMs: session.recentMfaVerifiedAtEpochMs,
    });
    const request = getServerSession.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    expect(request?.url).toBe("https://admin.example.test/");
    expect(request?.headers.get("cookie")).toBe("travelos_staff=opaque-session");
  });

  it("fails closed when the Staff realm has no complete active session context", async () => {
    const realm = {
      kind: "STAFF",
      getServerSession: vi.fn().mockResolvedValue({ ...session, agencyId: null }),
    } as unknown as AuthRealm;
    const resolver = createAdminStaffSessionResolver(realm, policy);

    await expect(resolver.resolveStaffSession("travelos_staff=opaque-session")).resolves.toBeNull();
  });

  it("fails closed when a Staff adapter returns a Portal realm session", async () => {
    const realm = {
      kind: "STAFF",
      getServerSession: vi.fn().mockResolvedValue({ ...session, realm: "PORTAL" }),
    } as unknown as AuthRealm;
    const resolver = createAdminStaffSessionResolver(realm, policy);

    await expect(resolver.resolveStaffSession("travelos_staff=opaque-session")).resolves.toBeNull();
  });

  it("rejects a Portal realm at the adapter boundary", () => {
    const realm = { kind: "PORTAL" } as unknown as AuthRealm;
    expect(() => createAdminStaffSessionResolver(realm, policy)).toThrow("Staff auth realm");
  });
});
