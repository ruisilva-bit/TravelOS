import {
  authorizeM1Operation,
  type M1StaffAuthorizationDependencies,
} from "./m1-staff-operations.js";
import type { StaffAuthorizationOperationProof } from "../../../staff-access/authorization.js";
import type { StaffPermissionId } from "../../../staff-access/permission-registry.js";
import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import type { AccommodationItem, FlightItem, Trip } from "../domain/m1-slice.js";
import { M1InputValidationError } from "./m1-trip-slice.js";

const M1_WORKSPACE_READ_PERMISSIONS = Object.freeze([
  "trip.view",
] as const satisfies readonly StaffPermissionId[]);

export interface M1TripWorkspacePage {
  readonly items: readonly Trip[];
  readonly nextCursor: OpaqueId | null;
}

export interface M1TripWorkspace {
  readonly trip: Trip;
  readonly flights: readonly FlightItem[];
  readonly accommodations: readonly AccommodationItem[];
}

export interface M1StaffTripWorkspaceReadRepository {
  listTrips(
    agencyId: OpaqueId,
    limit: number,
    cursor: OpaqueId | null,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<M1TripWorkspacePage>;
  readTripWorkspace(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<M1TripWorkspace | null>;
}

export interface M1StaffTripWorkspaceOperations {
  listTrips(
    cookieHeader: unknown,
    query: { readonly limit: number; readonly cursor: OpaqueId | null },
  ): Promise<M1TripWorkspacePage>;
  readTripWorkspace(cookieHeader: unknown, tripId: OpaqueId): Promise<M1TripWorkspace | null>;
}

export interface M1StaffTripWorkspaceOperationsDependencies extends M1StaffAuthorizationDependencies {
  readonly repository: M1StaffTripWorkspaceReadRepository;
}

export const createM1StaffTripWorkspaceOperations = (
  dependencies: M1StaffTripWorkspaceOperationsDependencies,
): M1StaffTripWorkspaceOperations => {
  const operations: M1StaffTripWorkspaceOperations = {
    async listTrips(cookieHeader, query) {
      if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 50) {
        throw new M1InputValidationError("Trip workspace list limit is invalid");
      }
      const cursor = query.cursor === null ? null : asOpaqueId(query.cursor);
      const authorization = await authorizeM1Operation(
        dependencies,
        cookieHeader,
        null,
        M1_WORKSPACE_READ_PERMISSIONS,
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
      const authorization = await authorizeM1Operation(
        dependencies,
        cookieHeader,
        null,
        M1_WORKSPACE_READ_PERMISSIONS,
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
