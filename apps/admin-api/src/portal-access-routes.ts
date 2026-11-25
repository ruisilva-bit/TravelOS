import {
  AdminTripAccessGrantIssueV1RequestSchema,
  AdminTripAccessGrantRevokeV1RequestSchema,
  AdminTripAccessGrantV1ResponseSchema,
} from "@travelos/contracts/admin";

import {
  badRequest,
  idFrom,
  runHandler,
  send,
  surfaceRejectionStatus,
  type AdminExpressApplication,
  type AdminRouteOptions,
} from "./admin-route-http.js";
import { headersFor } from "./request-boundary.js";

export const registerAdminPortalAccessRoutes = (
  application: AdminExpressApplication,
  options: AdminRouteOptions,
): void => {
  if (options.tripAccessOperations !== undefined) {
    const tripAccessOperations = options.tripAccessOperations;
    application.post("/api/admin/trips/:tripId/portal-access-grants", (request, response, next) => {
      runHandler(
        async () => {
          const tripId = idFrom(request.params?.tripId);
          const parsed = AdminTripAccessGrantIssueV1RequestSchema.safeParse(request.body);
          if (tripId === null || !parsed.success || parsed.data.tripId !== tripId) {
            badRequest(response);
            return;
          }
          const rejection = surfaceRejectionStatus(request, options.policy, true);
          if (rejection !== null) {
            response.status(rejection).end();
            return;
          }
          const grant = await tripAccessOperations.issueTripAccessGrant(
            headersFor(request).get("cookie"),
            parsed.data,
          );
          send(response, 201, AdminTripAccessGrantV1ResponseSchema.parse(grant));
        },
        response,
        next,
      );
    });

    application.post(
      "/api/admin/portal-access-grants/:grantId/revocations",
      (request, response, next) => {
        runHandler(
          async () => {
            const grantId = idFrom(request.params?.grantId);
            const parsed = AdminTripAccessGrantRevokeV1RequestSchema.safeParse(request.body);
            if (grantId === null || !parsed.success || parsed.data.grantId !== grantId) {
              badRequest(response);
              return;
            }
            const rejection = surfaceRejectionStatus(request, options.policy, true);
            if (rejection !== null) {
              response.status(rejection).end();
              return;
            }
            const grant = await tripAccessOperations.revokeTripAccessGrant(
              headersFor(request).get("cookie"),
              parsed.data,
            );
            send(response, 200, AdminTripAccessGrantV1ResponseSchema.parse(grant));
          },
          response,
          next,
        );
      },
    );
  }
};
