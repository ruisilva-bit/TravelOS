import { AdminTripPublicationPreviewV1Schema } from "@travelos/contracts/admin";

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

export const registerAdminPublicationRoutes = (
  application: AdminExpressApplication,
  options: AdminRouteOptions,
): void => {
  if (options.previewOperations !== undefined) {
    const previewOperations = options.previewOperations;
    application.get("/api/admin/trips/:tripId/publication-preview", (request, response, next) => {
      runHandler(
        async () => {
          const tripId = idFrom(request.params?.tripId);
          if (tripId === null) {
            badRequest(response);
            return;
          }
          const rejection = surfaceRejectionStatus(request, options.policy, false);
          if (rejection !== null) {
            response.status(rejection).end();
            return;
          }
          const candidate = await previewOperations.previewTrip(
            headersFor(request).get("cookie"),
            tripId,
          );
          send(
            response,
            200,
            AdminTripPublicationPreviewV1Schema.parse({
              workspaceRevision: candidate.workspaceRevision.toString(),
              projectionHash: candidate.projectionHash,
              schemaVersion: candidate.schemaVersion,
              projection: candidate.projection,
            }),
          );
        },
        response,
        next,
      );
    });
  }
};
