import {
  AdminRuntimeAcceptanceCleanupV1ResponseSchema,
  AdminRuntimeAcceptanceFixtureCleanupV1RequestSchema,
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

export const registerAdminRuntimeAcceptanceRoutes = (
  application: AdminM1ExpressApplication,
  options: AdminM1RouteOptions,
): void => {
  if (options.runtimeAcceptanceFixtureOperations !== undefined) {
    const fixtureOperations = options.runtimeAcceptanceFixtureOperations;
    application.post(
      "/api/admin/runtime-acceptance-fixtures/:fixtureRunId/cleanup",
      (request, response, next) => {
        runHandler(
          async () => {
            const fixtureRunId = idFrom(request.params?.fixtureRunId);
            const parsed = AdminRuntimeAcceptanceFixtureCleanupV1RequestSchema.safeParse(
              request.body,
            );
            if (fixtureRunId === null || !parsed.success) {
              badRequest(response);
              return;
            }
            const rejection = surfaceRejectionStatus(request, options.policy, true);
            if (rejection !== null) {
              response.status(rejection).end();
              return;
            }
            const receipt = await fixtureOperations.cleanupFixture(
              headersFor(request).get("cookie"),
              fixtureRunId,
              parsed.data,
            );
            send(
              response,
              200,
              AdminRuntimeAcceptanceCleanupV1ResponseSchema.parse({
                fixtureRunId: receipt.fixtureRunId,
                state: receipt.state,
                counts: {
                  grantsRevoked: receipt.counts.grantsRevoked,
                  publicationsWithdrawn: receipt.counts.publicationsWithdrawn,
                  tripsCancelled: receipt.counts.tripsCancelled,
                  principalsRetired: receipt.counts.principalsRetired,
                },
                retainedHistoryCounts: {
                  publicationSnapshots: receipt.retainedHistoryCounts.publicationSnapshots,
                  auditRecords: receipt.retainedHistoryCounts.auditRecords,
                },
                errorCode: receipt.errorCode,
              }),
            );
          },
          response,
          next,
        );
      },
    );
  }
};
