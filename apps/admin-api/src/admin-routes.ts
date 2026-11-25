import { registerAdminItineraryRoutes } from "./itinerary-routes.js";
import type { AdminExpressApplication, AdminRouteOptions } from "./admin-route-http.js";
import { registerAdminPortalAccessRoutes } from "./portal-access-routes.js";
import { registerAdminPublicationRoutes } from "./publication-routes.js";
import { registerAdminRuntimeAcceptanceRoutes } from "./runtime-acceptance-routes.js";
import { registerAdminTripRoutes } from "./trip-routes.js";

export type {
  AdminExpressApplication,
  AdminRouteOptions,
  AdminRuntimeAcceptanceFixtureRouteOperations,
} from "./admin-route-http.js";

/** Route registration order is part of the HTTP contract: keep it identical to the pre-split order. */
export const registerAdminRoutes = (
  application: AdminExpressApplication,
  options: AdminRouteOptions,
): void => {
  registerAdminTripRoutes(application, options);
  registerAdminRuntimeAcceptanceRoutes(application, options);
  registerAdminItineraryRoutes(application, options);
  registerAdminPortalAccessRoutes(application, options);
  registerAdminPublicationRoutes(application, options);
};
