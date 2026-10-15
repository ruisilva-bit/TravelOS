export {
  PortalSnapshotContractViolation,
  readCurrentPortalTripSnapshot,
  type CurrentPublishedPortalTripSnapshotQuery,
  type CurrentPublishedPortalTripSnapshotReader,
  type ReadCurrentPortalTripSnapshotInput,
} from "./read-current-portal-trip-snapshot.js";

/** Type-only marker for the immutable Customer Presentation read boundary. */
export interface CustomerPresentationCapabilityBoundary {
  readonly capability: "customer-presentation";
}
