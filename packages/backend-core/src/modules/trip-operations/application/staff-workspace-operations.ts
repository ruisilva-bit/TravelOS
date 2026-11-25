import {
  authorizeOperation,
  type StaffAuthorizationDependencies,
} from "./staff-trip-operations.js";
import type { StaffAuthorizationOperationProof } from "../../../staff-access/authorization.js";
import type { StaffPermissionId } from "../../../staff-access/permission-registry.js";
import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import type { AccommodationItem, FlightItem, Trip } from "../domain/trip-slice.js";
import { InputValidationError } from "./trip-slice.js";

const WORKSPACE_READ_PERMISSIONS = Object.freeze([
  "trip.view",
] as const satisfies readonly StaffPermissionId[]);

export interface TripWorkspacePage {
  readonly items: readonly Trip[];
  readonly nextCursor: OpaqueId | null;
}

export interface TripWorkspace {
  readonly trip: Trip;
  readonly flights: readonly FlightItem[];
  readonly accommodations: readonly AccommodationItem[];
}

export interface StaffTripWorkspaceReadRepository {
  listTrips(
    agencyId: OpaqueId,
    limit: number,
    cursor: OpaqueId | null,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripWorkspacePage>;
  readTripWorkspace(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripWorkspace | null>;
}

export interface StaffTripWorkspaceOperations {
  listTrips(
    cookieHeader: unknown,
    query: { readonly limit: number; readonly cursor: OpaqueId | null },
  ): Promise<TripWorkspacePage>;
  readTripWorkspace(cookieHeader: unknown, tripId: OpaqueId): Promise<TripWorkspace | null>;
}

export interface StaffTripWorkspaceOperationsDependencies extends StaffAuthorizationDependencies {
  readonly repository: StaffTripWorkspaceReadRepository;
}

export const createStaffTripWorkspaceOperations = (
  dependencies: StaffTripWorkspaceOperationsDependencies,
): StaffTripWorkspaceOperations => {
  const operations: StaffTripWorkspaceOperations = {
    async listTrips(cookieHeader, query) {
      if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 50) {
        throw new InputValidationError("Trip workspace list limit is invalid");
      }
      const cursor = query.cursor === null ? null : asOpaqueId(query.cursor);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        WORKSPACE_READ_PERMISSIONS,
      );
      return dependencies.repository.listTrips(
        asOpaqueId(authorization.session.agencyId),
        query.limit,
        cursor,
        authorization,
      );
    },

    async readTripWorkspace(cookieHeader, tripId) {
      const normalizedTripId = asOpaqueId(tripId);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        WORKSPACE_READ_PERMISSIONS,
      );
      return dependencies.repository.readTripWorkspace(
        asOpaqueId(authorization.session.agencyId),
        normalizedTripId,
        authorization,
      );
    },
  };
  return Object.freeze(operations);
};
