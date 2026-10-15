import type { OpaqueId } from "../../../shared-kernel/opaque-id.js";

export const TRIP_ACCESS_CAPABILITY_IDS = Object.freeze(["trip.view_current"] as const);
export type TripAccessCapabilityId = (typeof TRIP_ACCESS_CAPABILITY_IDS)[number];
export type TripAccessGrantCapabilitySet = typeof TRIP_ACCESS_CAPABILITY_IDS;

/** Staff-managed authorization entity; it carries no Portal response or persistence row type. */
export interface TripAccessGrant {
  readonly grantId: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly portalPrincipalId: string;
  readonly tripId: OpaqueId;
  readonly capabilities: TripAccessGrantCapabilitySet;
  readonly issuedByStaffPrincipalId: string;
  readonly issuedAt: string;
  readonly expiresAt: string | null;
  readonly relationshipLabel: string | null;
  readonly revokedByStaffPrincipalId: string | null;
  readonly revokedAt: string | null;
}
