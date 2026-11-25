import {
  authorizeOperation,
  type StaffAuthorizationDependencies,
} from "./staff-trip-operations.js";
import type { StaffAuthorizationOperationProof } from "../../../staff-access/authorization.js";
import type { StaffPermissionId } from "../../../staff-access/permission-registry.js";
import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import type { AccommodationDraft, FlightDraft } from "../domain/trip-slice.js";
import type { TripWorkspace } from "./staff-workspace-operations.js";
import {
  validateCreateTripWorkspaceAccommodationInput,
  validateCreateTripWorkspaceFlightInput,
  validateUpdateTripWorkspaceAccommodationInput,
  validateUpdateTripWorkspaceFlightInput,
  validateUpdateTripWorkspaceTripInput,
  TripNotFoundError,
  type CreateTripWorkspaceAccommodationInput,
  type CreateTripWorkspaceFlightInput,
  type UpdateTripWorkspaceAccommodationInput,
  type UpdateTripWorkspaceFlightInput,
  type UpdateTripWorkspaceTripInput,
} from "./trip-slice.js";

const WORKSPACE_WRITE_PERMISSIONS = Object.freeze([
  "trip.edit",
  "trip.view",
] as const satisfies readonly StaffPermissionId[]);

export interface StaffTripWorkspaceWriteRepository {
  createFlight(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    expectedWorkspaceRevision: bigint,
    flight: FlightDraft,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripWorkspace | null>;
  updateFlight(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    itemId: OpaqueId,
    expectedWorkspaceRevision: bigint,
    expectedLockVersion: bigint,
    flight: FlightDraft,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripWorkspace | null>;
  createAccommodation(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    expectedWorkspaceRevision: bigint,
    accommodation: AccommodationDraft,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripWorkspace | null>;
  updateAccommodation(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    itemId: OpaqueId,
    expectedWorkspaceRevision: bigint,
    expectedLockVersion: bigint,
    accommodation: AccommodationDraft,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripWorkspace | null>;
  updateTrip(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    expectedWorkspaceRevision: bigint,
    expectedLockVersion: bigint,
    trip: UpdateTripWorkspaceTripInput["trip"],
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripWorkspace | null>;
}

export interface StaffTripWorkspaceWriteOperations {
  createFlight(
    cookieHeader: unknown,
    tripId: OpaqueId,
    input: CreateTripWorkspaceFlightInput,
  ): Promise<TripWorkspace>;
  updateFlight(
    cookieHeader: unknown,
    tripId: OpaqueId,
    itemId: OpaqueId,
    input: UpdateTripWorkspaceFlightInput,
  ): Promise<TripWorkspace>;
  createAccommodation(
    cookieHeader: unknown,
    tripId: OpaqueId,
    input: CreateTripWorkspaceAccommodationInput,
  ): Promise<TripWorkspace>;
  updateAccommodation(
    cookieHeader: unknown,
    tripId: OpaqueId,
    itemId: OpaqueId,
    input: UpdateTripWorkspaceAccommodationInput,
  ): Promise<TripWorkspace>;
  updateTrip(
    cookieHeader: unknown,
    tripId: OpaqueId,
    input: UpdateTripWorkspaceTripInput,
  ): Promise<TripWorkspace>;
}

export interface StaffTripWorkspaceWriteOperationsDependencies extends StaffAuthorizationDependencies {
  readonly repository: StaffTripWorkspaceWriteRepository;
}

const requireWorkspace = (workspace: TripWorkspace | null): TripWorkspace => {
  if (workspace === null) throw new TripNotFoundError();
  return workspace;
};

export const createStaffTripWorkspaceWriteOperations = (
  dependencies: StaffTripWorkspaceWriteOperationsDependencies,
): StaffTripWorkspaceWriteOperations => {
  const operations: StaffTripWorkspaceWriteOperations = {
    async createFlight(cookieHeader, tripId, input) {
      const normalized = validateCreateTripWorkspaceFlightInput(input);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        WORKSPACE_WRITE_PERMISSIONS,
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
      const normalized = validateUpdateTripWorkspaceFlightInput(input);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        WORKSPACE_WRITE_PERMISSIONS,
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
      const normalized = validateCreateTripWorkspaceAccommodationInput(input);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        WORKSPACE_WRITE_PERMISSIONS,
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
      const normalized = validateUpdateTripWorkspaceAccommodationInput(input);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        WORKSPACE_WRITE_PERMISSIONS,
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
      const normalized = validateUpdateTripWorkspaceTripInput(input);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        WORKSPACE_WRITE_PERMISSIONS,
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
