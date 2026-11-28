import type { AgencyProfile, StaffAgencyProfileOperations } from "@travelos/backend-core";
import {
  AdminAgencyProfileV1ResponseSchema,
  AdminAgencyProfileV1UpdateRequestSchema,
} from "@travelos/contracts/admin";

import {
  badRequest,
  runHandler,
  send,
  surfaceRejectionStatus,
  type AdminExpressApplication,
  type AdminRouteOptions,
} from "./admin-route-http.js";
import { headersFor } from "./request-boundary.js";

const mapProfile = (profile: AgencyProfile) =>
  AdminAgencyProfileV1ResponseSchema.parse({
    agencyId: profile.agencyId,
    displayName: profile.displayName,
    email: profile.email,
    phone: profile.phone,
    website: profile.website,
    lockVersion: profile.lockVersion.toString(),
  });

export const registerAdminAgencyRoutes = (
  application: AdminExpressApplication,
  options: AdminRouteOptions,
): void => {
  if (options.agencyProfileOperations === undefined) return;
  const agencyProfileOperations: StaffAgencyProfileOperations = options.agencyProfileOperations;

  application.get("/api/admin/agency/profile", (request, response, next) => {
    runHandler(
      async () => {
        const rejection = surfaceRejectionStatus(request, options.policy, false);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const profile = await agencyProfileOperations.getProfile(headersFor(request).get("cookie"));
        send(response, 200, mapProfile(profile));
      },
      response,
      next,
    );
  });

  application.patch("/api/admin/agency/profile", (request, response, next) => {
    runHandler(
      async () => {
        const parsed = AdminAgencyProfileV1UpdateRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, true);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const { expectedLockVersion, ...profile } = parsed.data;
        const updated = await agencyProfileOperations.updateProfile(
          headersFor(request).get("cookie"),
          { expectedLockVersion: BigInt(expectedLockVersion), profile },
        );
        send(response, 200, mapProfile(updated));
      },
      response,
      next,
    );
  });
};
