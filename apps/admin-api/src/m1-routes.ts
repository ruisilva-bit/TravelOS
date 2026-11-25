import { registerAdminItineraryRoutes } from "./itinerary-routes.js";
import type { AdminM1ExpressApplication, AdminM1RouteOptions } from "./m1-route-http.js";
import { registerAdminPortalAccessRoutes } from "./portal-access-routes.js";
import { registerAdminPublicationRoutes } from "./publication-routes.js";
import { registerAdminRuntimeAcceptanceRoutes } from "./runtime-acceptance-routes.js";
import { registerAdminTripRoutes } from "./trip-routes.js";

export type {
  AdminM1ExpressApplication,
  AdminM1RouteOptions,
  AdminRuntimeAcceptanceFixtureRouteOperations,
} from "./m1-route-http.js";

/** Route registration order is part of the HTTP contract: keep it identical to the pre-split order. */
export const registerAdminM1Routes = (
  application: AdminM1ExpressApplication,
  options: AdminM1RouteOptions,
): void => {
  registerAdminTripRoutes(application, options);
  registerAdminRuntimeAcceptanceRoutes(application, options);
  registerAdminItineraryRoutes(application, options);
  registerAdminPortalAccessRoutes(application, options);
  registerAdminPublicationRoutes(application, options);
};
