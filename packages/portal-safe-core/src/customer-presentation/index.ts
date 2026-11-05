export {
  PortalSnapshotContractViolation,
  readCurrentPortalTripSnapshot,
  type CurrentPublishedPortalTripSnapshotQuery,
  type CurrentPublishedPortalTripSnapshotReader,
  type ReadCurrentPortalTripSnapshotInput,
} from "./read-current-portal-trip-snapshot.js";
export {
  listAuthorizedPortalTrips,
  PortalTripListContractViolation,
  type CurrentAuthorizedPortalTripListQuery,
  type CurrentAuthorizedPortalTripListReader,
  type ListAuthorizedPortalTripsInput,
} from "./list-authorized-portal-trips.js";

/** Type-only marker for the immutable Customer Presentation read boundary. */
export interface CustomerPresentationCapabilityBoundary {
  readonly capability: "customer-presentation";
}
