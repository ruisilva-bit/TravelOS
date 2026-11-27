import {
  AdminCreateShareLinkV1RequestSchema,
  AdminIdempotencyKeySchema,
  AdminShareLinkCreatedV1ResponseSchema,
  AdminShareLinkListV1ResponseSchema,
  AdminShareLinkRevokedV1ResponseSchema,
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
import { headersFor, headerValues } from "./request-boundary.js";

export const registerAdminShareLinkRoutes = (
  application: AdminExpressApplication,
  options: AdminRouteOptions,
): void => {
  const operations = options.shareLinkOperations;
  if (operations === undefined) return;

  application.post("/api/admin/trips/:tripId/share-links", (request, response, next) => {
    runHandler(
      async () => {
        const tripId = idFrom(request.params?.tripId);
        const body = AdminCreateShareLinkV1RequestSchema.safeParse(request.body ?? {});
        const keys = headerValues(
          {
            headers: request.headers,
            ...(request.rawHeaders ? { rawHeaders: request.rawHeaders } : {}),
          },
          "idempotency-key",
        );
        const key = keys.length === 1 ? AdminIdempotencyKeySchema.safeParse(keys[0]) : null;
        if (tripId === null || !body.success || key === null || !key.success) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, true);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const created = await operations.createShareLink(
          headersFor(request).get("cookie"),
          tripId,
          {
            idempotencyKey: key.data,
            ...(body.data.expiresInDays === undefined
              ? {}
              : { expiresInDays: body.data.expiresInDays }),
          },
        );
        send(response, 200, AdminShareLinkCreatedV1ResponseSchema.parse(created));
      },
      response,
      next,
    );
  });

  application.get("/api/admin/trips/:tripId/share-links", (request, response, next) => {
    runHandler(
      async () => {
        const tripId = idFrom(request.params?.tripId);
        if (tripId === null || Object.keys(request.query ?? {}).length > 0) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, false);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const links = await operations.listShareLinks(headersFor(request).get("cookie"), tripId);
        send(response, 200, AdminShareLinkListV1ResponseSchema.parse({ links }));
      },
      response,
      next,
    );
  });

  application.post("/api/admin/share-links/:shareLinkId/revoke", (request, response, next) => {
    runHandler(
      async () => {
        const shareLinkId = idFrom(request.params?.shareLinkId);
        if (shareLinkId === null) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, true);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        await operations.revokeShareLink(headersFor(request).get("cookie"), shareLinkId);
        send(response, 200, AdminShareLinkRevokedV1ResponseSchema.parse({ revoked: true }));
      },
      response,
      next,
    );
  });
};
