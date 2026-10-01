export {
  authRequestPathMatchesBase,
  dispatchAuthRealmRequest,
  hostHeaderMatchesExpectedHost,
  originAllowedForMethod,
  type AuthHttpRequest,
  type AuthHttpResponse,
  type AuthSurfacePolicy,
} from "./http-bridge.js";
export {
  createOneTimeOperatorToken,
  digestOneTimeOperatorToken,
  verifyOneTimeOperatorToken,
  type OneTimeOperatorToken,
} from "./operator-token.js";
export {
  createLocalOperatorStaffEnrollmentRealm,
  createPortalAuthRealm,
  createStaffAuthRealm,
  PORTAL_AUTH_BASE_PATH,
  STAFF_AUTH_BASE_PATH,
  type AuthenticationRealm,
  type AuthRealm,
  type AuthRealmConfiguration,
  type RealmEnvironment,
  type RealmSession,
} from "./realm.js";
export {
  createAuthRealmPostgresDatabase,
  type AuthRealmPostgresConnectionSettings,
  type AuthRealmPostgresDatabase,
  type AuthRealmPostgresTlsPolicy,
} from "./realm-postgres.js";

export const authAdaptersPackageBoundary = "@travelos/auth-adapters" as const;
