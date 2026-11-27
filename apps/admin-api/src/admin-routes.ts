import { registerAdminItineraryRoutes } from "./itinerary-routes.js";
import { registerAdminLeadRoutes } from "./lead-routes.js";
import type { AdminExpressApplication, AdminRouteOptions } from "./admin-route-http.js";
import { registerAdminPublicationRoutes } from "./publication-routes.js";
import { registerAdminTripRoutes } from "./trip-routes.js";

export type { AdminExpressApplication, AdminRouteOptions } from "./admin-route-http.js";

/** Route registration order is part of the HTTP contract: keep it identical to the pre-split order. */
export const registerAdminRoutes = (
  application: AdminExpressApplication,
  options: AdminRouteOptions,
): void => {
  registerAdminTripRoutes(application, options);
  registerAdminItineraryRoutes(application, options);
  registerAdminPublicationRoutes(application, options);
  registerAdminLeadRoutes(application, options);
};
