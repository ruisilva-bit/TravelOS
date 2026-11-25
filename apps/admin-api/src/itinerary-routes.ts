import { asOpaqueId } from "@travelos/backend-core";
import {
  AdminAccommodationUpdateRequestSchema,
  AdminSupplierCostNoteUpdateRequestSchema,
} from "@travelos/contracts/admin";

import { mapSlice } from "./m1-trip-slice-mapper.js";
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

export const registerAdminItineraryRoutes = (
  application: AdminM1ExpressApplication,
  options: AdminM1RouteOptions,
): void => {
  application.patch("/api/admin/itinerary/accommodations/:itemId", (request, response, next) => {
    runHandler(
      async () => {
        const parsed = AdminAccommodationUpdateRequestSchema.safeParse(request.body);
        const itemId = idFrom(request.params?.itemId);
        if (!parsed.success || itemId === null || parsed.data.itemId !== itemId) {
          badRequest(response);
          return;
        }
        const rejection = surfaceRejectionStatus(request, options.policy, true);
        if (rejection !== null) {
          response.status(rejection).end();
          return;
        }
        const slice = await options.m1Operations.updateAccommodation(
          headersFor(request).get("cookie"),
          {
            agencyId: asOpaqueId(parsed.data.agencyId),
            tripId: asOpaqueId(parsed.data.tripId),
            itemId,
            expectedLockVersion: BigInt(parsed.data.expectedLockVersion),
            title: parsed.data.title,
            description: parsed.data.description,
          },
        );
        send(response, 200, mapSlice(slice));
      },
      response,
      next,
    );
  });

  application.patch(
    "/api/admin/reservations/:reservationId/internal-note",
    (request, response, next) => {
      runHandler(
        async () => {
          const parsed = AdminSupplierCostNoteUpdateRequestSchema.safeParse(request.body);
          const reservationId = idFrom(request.params?.reservationId);
          if (
            !parsed.success ||
            reservationId === null ||
            parsed.data.reservationId !== reservationId
          ) {
            badRequest(response);
            return;
          }
          const rejection = surfaceRejectionStatus(request, options.policy, true);
          if (rejection !== null) {
            response.status(rejection).end();
            return;
          }
          const slice = await options.m1Operations.updateInternalSupplierNote(
            headersFor(request).get("cookie"),
            {
              agencyId: asOpaqueId(parsed.data.agencyId),
              tripId: asOpaqueId(parsed.data.tripId),
              reservationId,
              expectedLockVersion: BigInt(parsed.data.expectedLockVersion),
              internalNote: parsed.data.internalNote,
            },
          );
          send(response, 200, mapSlice(slice));
        },
        response,
        next,
      );
    },
  );
};
