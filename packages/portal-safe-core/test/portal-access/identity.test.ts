import { describe, expect, it } from "vitest";

import { portalPrincipalIdentityFromSession } from "../../src/portal-access/identity.js";

const mapPortalSession = portalPrincipalIdentityFromSession as unknown as (
  session: unknown,
) => unknown;

const validPortalSession = {
  realm: "PORTAL",
  sessionId: "portal-session-1",
  principalId: "portal-principal-1",
  expiresAtEpochMs: 2_000,
  agencyId: "00000000-0000-7000-8000-000000000071",
  authorizationEpoch: 3n,
  recentMfaVerifiedAtEpochMs: null,
};

describe("Portal principal identity", () => {
  it("maps a verified Portal realm session with its exact persisted context", () => {
    expect(mapPortalSession(validPortalSession)).toEqual({
      portalSessionId: "portal-session-1",
      portalPrincipalId: "portal-principal-1",
      agencyId: "00000000-0000-7000-8000-000000000071",
      authorizationEpoch: 3n,
      expiresAtEpochMs: 2_000,
    });
  });

  it("rejects a Staff realm session even when its principal fields are populated", () => {
    expect(mapPortalSession({ ...validPortalSession, realm: "STAFF" })).toBeNull();
  });

  it.each([
    null,
    {},
    { ...validPortalSession, sessionId: "" },
    { ...validPortalSession, principalId: " " },
    { ...validPortalSession, agencyId: null },
    { ...validPortalSession, authorizationEpoch: "3" },
    { ...validPortalSession, authorizationEpoch: 0n },
    { ...validPortalSession, expiresAtEpochMs: Number.NaN },
  ])("rejects malformed Portal session context %#", (session) => {
    expect(mapPortalSession(session)).toBeNull();
  });
});
