import {
  AdminPublishTripV1RequestSchema,
  AdminTripPublicationHistoryV1ResponseSchema,
  AdminTripPublicationPreviewV1Schema,
  AdminTripPublicationV1ResponseSchema,
} from "@travelos/contracts/admin";

import {
  badRequest,
  idFrom,
  runHandler,
  send,
  surfaceRejectionStatus,
  type AdminM1ExpressApplication,
  type AdminM1RouteOptions,
} from "./m1-route-http.js";
import { headersFor } from "./request-boundary.js";

export const registerAdminPublicationRoutes = (
  application: AdminM1ExpressApplication,
  options: AdminM1RouteOptions,
): void => {
  if (options.m1PublicationOperations !== undefined) {
    const publicationOperations = options.m1PublicationOperations;
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
          const candidate = await publicationOperations.previewTrip(
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

    application.post("/api/admin/trips/:tripId/publications", (request, response, next) => {
      runHandler(
        async () => {
          const tripId = idFrom(request.params?.tripId);
          const parsed = AdminPublishTripV1RequestSchema.safeParse(request.body);
          if (tripId === null || !parsed.success) {
            badRequest(response);
            return;
          }
          const rejection = surfaceRejectionStatus(request, options.policy, true);
          if (rejection !== null) {
            response.status(rejection).end();
            return;
          }
          const result = await publicationOperations.publishTrip(
            headersFor(request).get("cookie"),
            tripId,
            parsed.data,
          );
          send(response, 200, AdminTripPublicationV1ResponseSchema.parse(result));
        },
        response,
        next,
      );
    });

    application.get("/api/admin/trips/:tripId/publications", (request, response, next) => {
      runHandler(
        async () => {
          const tripId = idFrom(request.params?.tripId);
          const query = request.query ?? {};
          const cursor = query.before;
          if (
            tripId === null ||
            Object.keys(query).some((key) => key !== "before") ||
            (Array.isArray(cursor) && cursor.length !== 1)
          ) {
            badRequest(response);
            return;
          }
          const rejection = surfaceRejectionStatus(request, options.policy, false);
          if (rejection !== null) {
            response.status(rejection).end();
            return;
          }
          const page = await publicationOperations.listPublicationHistory(
            headersFor(request).get("cookie"),
            tripId,
            Array.isArray(cursor) ? cursor[0] : cursor,
          );
          send(response, 200, AdminTripPublicationHistoryV1ResponseSchema.parse(page));
        },
        response,
        next,
      );
    });
  }
};
