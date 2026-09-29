/** Type-only marker for the future Portal Access capability boundary. */
export interface PortalAccessCapabilityBoundary {
  readonly capability: "portal-access";
}

export { portalPrincipalIdentityFromSession, type PortalPrincipalIdentity } from "./identity.js";
