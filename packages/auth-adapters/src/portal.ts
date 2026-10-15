export { dispatchAuthRealmRequest, hostHeaderMatchesExpectedHost } from "./http-bridge.js";
export type { AuthSurfacePolicy } from "./http-bridge.js";
export { createAuthRealmPostgresDatabase } from "./realm-postgres.js";
export type {
  AuthRealmPostgresConnectionSettings,
  AuthRealmPostgresDatabase,
} from "./realm-postgres.js";
export { createPortalAuthRealm, PORTAL_AUTH_BASE_PATH } from "./realm.js";
export type { PortalAuthRealm, PortalAuthRealmConfiguration } from "./realm.js";
