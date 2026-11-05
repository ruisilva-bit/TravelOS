import {
  authorizeM1Operation,
  type M1StaffAuthorizationDependencies,
} from "./m1-staff-operations.js";
import type { StaffAuthorizationOperationProof } from "../../../staff-access/authorization.js";
import type { StaffPermissionId } from "../../../staff-access/permission-registry.js";
import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import type { AccommodationDraft, FlightDraft } from "../domain/m1-slice.js";
import type { M1TripWorkspace } from "./m1-staff-workspace-operations.js";
import {
  validateCreateM1TripWorkspaceAccommodationInput,
  validateCreateM1TripWorkspaceFlightInput,
  validateUpdateM1TripWorkspaceAccommodationInput,
  validateUpdateM1TripWorkspaceFlightInput,
  validateUpdateM1TripWorkspaceTripInput,
  M1TripNotFoundError,
  type CreateM1TripWorkspaceAccommodationInput,
  type CreateM1TripWorkspaceFlightInput,
  type UpdateM1TripWorkspaceAccommodationInput,
  type UpdateM1TripWorkspaceFlightInput,
  type UpdateM1TripWorkspaceTripInput,
} from "./m1-trip-slice.js";

const M1_WORKSPACE_WRITE_PERMISSIONS = Object.freeze([
  "trip.edit",
  "trip.view",
] as const satisfies readonly StaffPermissionId[]);

export interface M1StaffTripWorkspaceWriteRepository {
  createFlight(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    expectedWorkspaceRevision: bigint,
    flight: FlightDraft,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<M1TripWorkspace | null>;
  updateFlight(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    itemId: OpaqueId,
    expectedWorkspaceRevision: bigint,
    expectedLockVersion: bigint,
    flight: FlightDraft,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<M1TripWorkspace | null>;
  createAccommodation(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    expectedWorkspaceRevision: bigint,
    accommodation: AccommodationDraft,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<M1TripWorkspace | null>;
  updateAccommodation(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    itemId: OpaqueId,
    expectedWorkspaceRevision: bigint,
    expectedLockVersion: bigint,
    accommodation: AccommodationDraft,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<M1TripWorkspace | null>;
  updateTrip(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    expectedWorkspaceRevision: bigint,
    expectedLockVersion: bigint,
    trip: UpdateM1TripWorkspaceTripInput["trip"],
    authorization: StaffAuthorizationOperationProof,
  ): Promise<M1TripWorkspace | null>;
}

export interface M1StaffTripWorkspaceWriteOperations {
  createFlight(
    cookieHeader: unknown,
    tripId: OpaqueId,
    input: CreateM1TripWorkspaceFlightInput,
  ): Promise<M1TripWorkspace>;
  updateFlight(
    cookieHeader: unknown,
    tripId: OpaqueId,
    itemId: OpaqueId,
    input: UpdateM1TripWorkspaceFlightInput,
  ): Promise<M1TripWorkspace>;
  createAccommodation(
    cookieHeader: unknown,
    tripId: OpaqueId,
    input: CreateM1TripWorkspaceAccommodationInput,
  ): Promise<M1TripWorkspace>;
  updateAccommodation(
    cookieHeader: unknown,
    tripId: OpaqueId,
    itemId: OpaqueId,
    input: UpdateM1TripWorkspaceAccommodationInput,
  ): Promise<M1TripWorkspace>;
  updateTrip(
    cookieHeader: unknown,
    tripId: OpaqueId,
    input: UpdateM1TripWorkspaceTripInput,
  ): Promise<M1TripWorkspace>;
}

export interface M1StaffTripWorkspaceWriteOperationsDependencies extends M1StaffAuthorizationDependencies {
  readonly repository: M1StaffTripWorkspaceWriteRepository;
}

const requireWorkspace = (workspace: M1TripWorkspace | null): M1TripWorkspace => {
  if (workspace === null) throw new M1TripNotFoundError();
  return workspace;
};

export const createM1StaffTripWorkspaceWriteOperations = (
  dependencies: M1StaffTripWorkspaceWriteOperationsDependencies,
): M1StaffTripWorkspaceWriteOperations => {
  const operations: M1StaffTripWorkspaceWriteOperations = {
    async createFlight(cookieHeader, tripId, input) {
      const normalized = validateCreateM1TripWorkspaceFlightInput(input);
      const authorization = await authorizeM1Operation(
        dependencies,
        cookieHeader,
        null,
        M1_WORKSPACE_WRITE_PERMISSIONS,
      );
      return requireWorkspace(
        await dependencies.repository.createFlight(
          asOpaqueId(authorization.session.agencyId),
          asOpaqueId(tripId),
          normalized.expectedWorkspaceRevision,
          normalized.flight,
          authorization,
        ),
      );
    },

    async updateFlight(cookieHeader, tripId, itemId, input) {
      const normalized = validateUpdateM1TripWorkspaceFlightInput(input);
      const authorization = await authorizeM1Operation(
        dependencies,
        cookieHeader,
        null,
        M1_WORKSPACE_WRITE_PERMISSIONS,
      );
      return requireWorkspace(
        await dependencies.repository.updateFlight(
          asOpaqueId(authorization.session.agencyId),
          asOpaqueId(tripId),
          asOpaqueId(itemId),
          normalized.expectedWorkspaceRevision,
          normalized.expectedLockVersion,
          normalized.flight,
          authorization,
        ),
      );
    },

    async createAccommodation(cookieHeader, tripId, input) {
      const normalized = validateCreateM1TripWorkspaceAccommodationInput(input);
      const authorization = await authorizeM1Operation(
        dependencies,
        cookieHeader,
        null,
        M1_WORKSPACE_WRITE_PERMISSIONS,
      );
      return requireWorkspace(
        await dependencies.repository.createAccommodation(
          asOpaqueId(authorization.session.agencyId),
          asOpaqueId(tripId),
          normalized.expectedWorkspaceRevision,
          normalized.accommodation,
          authorization,
        ),
      );
    },

    async updateAccommodation(cookieHeader, tripId, itemId, input) {
      const normalized = validateUpdateM1TripWorkspaceAccommodationInput(input);
      const authorization = await authorizeM1Operation(
        dependencies,
        cookieHeader,
        null,
        M1_WORKSPACE_WRITE_PERMISSIONS,
      );
      return requireWorkspace(
        await dependencies.repository.updateAccommodation(
          asOpaqueId(authorization.session.agencyId),
          asOpaqueId(tripId),
          asOpaqueId(itemId),
          normalized.expectedWorkspaceRevision,
          normalized.expectedLockVersion,
          normalized.accommodation,
          authorization,
        ),
      );
    },

    async updateTrip(cookieHeader, tripId, input) {
      const normalized = validateUpdateM1TripWorkspaceTripInput(input);
      const authorization = await authorizeM1Operation(
        dependencies,
        cookieHeader,
        null,
        M1_WORKSPACE_WRITE_PERMISSIONS,
      );
      return requireWorkspace(
        await dependencies.repository.updateTrip(
          asOpaqueId(authorization.session.agencyId),
          asOpaqueId(tripId),
          normalized.expectedWorkspaceRevision,
          normalized.expectedLockVersion,
          normalized.trip,
          authorization,
        ),
      );
    },
  };
  return Object.freeze(operations);
};
