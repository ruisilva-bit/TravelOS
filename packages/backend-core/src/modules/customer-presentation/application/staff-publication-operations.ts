import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import type { StaffPermissionId } from "../../../staff-access/permission-registry.js";
import type { StaffAuthorizationOperationProof } from "../../../staff-access/authorization.js";
import {
  authorizeOperation,
  type StaffAuthorizationDependencies,
} from "../../trip-operations/application/staff-trip-operations.js";
import type { TripPublicationCandidate } from "./projection.js";

export class StaffPublicationInputError extends Error {
  readonly code = "INVALID_PUBLICATION_REQUEST" as const;

  constructor() {
    super("The publication request is invalid");
    this.name = "StaffPublicationInputError";
  }
}

/** Read-only customer preview; creating a customer link lives in the share-links module. */
export interface StaffTripPreviewRepository {
  previewTrip(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripPublicationCandidate>;
}

export interface StaffTripPreviewOperationsDependencies extends StaffAuthorizationDependencies {
  readonly repository: StaffTripPreviewRepository;
}

export interface StaffTripPreviewOperations {
  previewTrip(cookieHeader: unknown, tripId: unknown): Promise<TripPublicationCandidate>;
}

const PREVIEW_PERMISSIONS = Object.freeze([
  "trip.view",
  "trip.preview",
] as const satisfies readonly StaffPermissionId[]);

const parseTripId = (value: unknown): OpaqueId => {
  if (typeof value !== "string") throw new StaffPublicationInputError();
  try {
    return asOpaqueId(value);
  } catch {
    throw new StaffPublicationInputError();
  }
};

export const createStaffTripPreviewOperations = (
  dependencies: StaffTripPreviewOperationsDependencies,
): StaffTripPreviewOperations => {
  const operations: StaffTripPreviewOperations = {
    async previewTrip(cookieHeader, tripIdValue) {
      const tripId = parseTripId(tripIdValue);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        PREVIEW_PERMISSIONS,
      );
      return dependencies.repository.previewTrip(
        asOpaqueId(authorization.session.agencyId),
        tripId,
        authorization,
      );
    },
  };
  return Object.freeze(operations);
};
