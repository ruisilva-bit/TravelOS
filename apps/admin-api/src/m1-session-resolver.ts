import type { AuthRealm, AuthSurfacePolicy } from "@travelos/auth-adapters";
import type { M1StaffSessionResolver } from "@travelos/backend-core";

/** Adapts an untrusted Staff cookie to the server-verified session context. */
export const createAdminStaffSessionResolver = (
  realm: AuthRealm,
  policy: AuthSurfacePolicy,
): M1StaffSessionResolver => {
  if (realm.kind !== "STAFF") {
    throw new Error("M1 application authorization requires the Staff auth realm");
  }

  return {
    async resolveStaffSession(cookieHeader) {
      let request: Request;
      try {
        const headers = new Headers({ cookie: cookieHeader });
        request = new Request(new URL("/", policy.canonicalOrigin), { headers });
      } catch {
        return null;
      }

      const session = await realm.getServerSession(request);
      if (session === null || session.agencyId === null || session.authorizationEpoch === null) {
        return null;
      }
      return {
        staffPrincipalId: session.principalId,
        agencyId: session.agencyId,
        authorizationEpoch: session.authorizationEpoch,
        expiresAtEpochMs: session.expiresAtEpochMs,
        recentMfaVerifiedAtEpochMs: session.recentMfaVerifiedAtEpochMs,
      };
    },
  };
};
