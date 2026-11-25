import { describe, expect, it, vi } from "vitest";

import * as backendCore from "../../src/index.js";
import type {
  StaffAuthorizationDependencies,
  OpaqueId,
  StaffAuthorizationOperationProof,
  StaffPermissionId,
} from "../../src/index.js";

const agencyId = "abcdef12-3456-7abc-8def-000000000001" as OpaqueId;
const tripId = "abcdef12-3456-7abc-8def-000000000002" as OpaqueId;
const itemId = "abcdef12-3456-7abc-8def-000000000003" as OpaqueId;
const nowEpochMs = Date.parse("2026-10-26T12:00:00.000Z");
const session = {
  sessionId: "staff-session-1",
  staffPrincipalId: "staff-principal-1",
  agencyId,
  authorizationEpoch: 2n,
  expiresAtEpochMs: nowEpochMs + 60_000,
  recentMfaVerifiedAtEpochMs: null,
};
const flight = {
  title: "Voo Lisboa-Porto",
  description: "Partida de Lisboa",
  carrier: "Transportes Aéreos",
  flightNumber: "TA123",
  departureAirport: "LIS",
  arrivalAirport: "OPO",
  departure: {
    localDate: "2026-10-26",
    localTime: "10:30",
    timezoneName: "UTC",
    instant: "2026-10-26T10:30:00.000Z",
  },
  arrival: {
    localDate: "2026-10-26",
    localTime: "12:45",
    timezoneName: "UTC",
    instant: "2026-10-26T12:45:00.000Z",
  },
  terminal: null,
  cabin: null,
  baggage: null,
  seat: null,
  customerBookingReference: null,
};
const accommodation = {
  title: "Estadia no Porto",
  description: "Alojamento para a viagem",
  propertyName: "Casa do Norte",
  checkIn: {
    localDate: "2026-10-26",
    localTime: "15:00",
    timezoneName: "UTC",
    instant: "2026-10-26T15:00:00.000Z",
  },
  checkOut: {
    localDate: "2026-10-28",
    localTime: "11:00",
    timezoneName: "UTC",
    instant: "2026-10-28T11:00:00.000Z",
  },
  roomDescription: null,
  boardType: null,
  customerBookingReference: null,
};
const trip = {
  title: "Lisboa a Porto",
  startDate: "2026-10-26",
  endDate: "2026-10-30",
};

interface Workspace {
  readonly trip: unknown;
  readonly flights: readonly unknown[];
  readonly accommodations: readonly unknown[];
}

interface WorkspaceWriteRepository {
  createFlight(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    expectedWorkspaceRevision: bigint,
    flight: unknown,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<Workspace | null>;
  updateFlight(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    itemId: OpaqueId,
    expectedWorkspaceRevision: bigint,
    expectedLockVersion: bigint,
    flight: unknown,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<Workspace | null>;
  createAccommodation(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    expectedWorkspaceRevision: bigint,
    accommodation: unknown,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<Workspace | null>;
  updateAccommodation(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    itemId: OpaqueId,
    expectedWorkspaceRevision: bigint,
    expectedLockVersion: bigint,
    accommodation: unknown,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<Workspace | null>;
  updateTrip(
    agencyId: OpaqueId,
    tripId: OpaqueId,
    expectedWorkspaceRevision: bigint,
    expectedLockVersion: bigint,
    trip: unknown,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<Workspace | null>;
}

interface WorkspaceWriteOperations {
  createFlight(
    cookieHeader: unknown,
    tripId: OpaqueId,
    input: { readonly expectedWorkspaceRevision: bigint; readonly flight: unknown },
  ): Promise<Workspace>;
  updateFlight(
    cookieHeader: unknown,
    tripId: OpaqueId,
    itemId: OpaqueId,
    input: {
      readonly expectedWorkspaceRevision: bigint;
      readonly expectedLockVersion: bigint;
      readonly flight: unknown;
    },
  ): Promise<Workspace>;
  createAccommodation(
    cookieHeader: unknown,
    tripId: OpaqueId,
    input: { readonly expectedWorkspaceRevision: bigint; readonly accommodation: unknown },
  ): Promise<Workspace>;
  updateAccommodation(
    cookieHeader: unknown,
    tripId: OpaqueId,
    itemId: OpaqueId,
    input: {
      readonly expectedWorkspaceRevision: bigint;
      readonly expectedLockVersion: bigint;
      readonly accommodation: unknown;
    },
  ): Promise<Workspace>;
  updateTrip(
    cookieHeader: unknown,
    tripId: OpaqueId,
    input: {
      readonly expectedWorkspaceRevision: bigint;
      readonly expectedLockVersion: bigint;
      readonly trip: unknown;
    },
  ): Promise<Workspace>;
}

type CreateWorkspaceWriteOperations = (
  dependencies: StaffAuthorizationDependencies & {
    readonly repository: WorkspaceWriteRepository;
  },
) => WorkspaceWriteOperations;

const exportedFactory = (
  backendCore as unknown as {
    readonly createStaffTripWorkspaceWriteOperations?: unknown;
  }
).createStaffTripWorkspaceWriteOperations;
const createOperations: CreateWorkspaceWriteOperations | null =
  typeof exportedFactory === "function"
    ? (exportedFactory as CreateWorkspaceWriteOperations)
    : null;

const makeDependencies = ({
  permissions = ["trip.edit", "trip.view"] as const,
  sessionValue = session,
  repositoryOverrides = {},
}: {
  readonly permissions?: readonly StaffPermissionId[];
  readonly sessionValue?: unknown;
  readonly repositoryOverrides?: Partial<WorkspaceWriteRepository>;
} = {}) => {
  const workspace: Workspace = { trip: { id: tripId, agencyId }, flights: [], accommodations: [] };
  const repository: WorkspaceWriteRepository = {
    createFlight: vi.fn(async () => workspace),
    updateFlight: vi.fn(async () => workspace),
    createAccommodation: vi.fn(async () => workspace),
    updateAccommodation: vi.fn(async () => workspace),
    updateTrip: vi.fn(async () => workspace),
    ...repositoryOverrides,
  };
  const authorizationRepository = {
    getStaffAuthorizationSnapshot: vi.fn(async () => ({
      staffPrincipalId: session.staffPrincipalId,
      agencyId,
      membershipState: "ACTIVE" as const,
      authorizationEpoch: session.authorizationEpoch,
      assignments: permissions.map((permissionId) => ({
        agencyId,
        permissionId,
        scopeKind: "AGENCY" as const,
        organizationUnitId: null,
        accessLevel: "ALL" as const,
        active: true,
      })),
    })),
  };
  const sessionResolver = { resolveStaffSession: vi.fn(async () => sessionValue) };
  return {
    workspace,
    repository,
    authorizationRepository,
    sessionResolver,
    dependencies: {
      repository,
      authorizationRepository,
      sessionResolver,
      nowEpochMs: () => nowEpochMs,
    },
  };
};

describe("Staff Trip workspace write operations", () => {
  it("createFlight_requires_trip_edit_and_uses_the_session_agency_and_expected_revision", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies();
    const operations = createOperations(context.dependencies);
    const input = { expectedWorkspaceRevision: 7n, flight };

    await expect(operations.createFlight("staff-session-cookie", tripId, input)).resolves.toEqual(
      context.workspace,
    );
    expect(context.repository.createFlight).toHaveBeenCalledTimes(1);
    const [calledAgencyId, calledTripId, calledRevision, calledFlight, authorization] = vi.mocked(
      context.repository.createFlight,
    ).mock.calls[0]!;
    expect([calledAgencyId, calledTripId, calledRevision]).toEqual([agencyId, tripId, 7n]);
    expect(calledFlight).toMatchObject({ title: flight.title, departure: flight.departure });
    expect(authorization.requiredPermissionIds).toEqual(["trip.edit", "trip.view"]);
  });

  it("updateAccommodation_uses_item_lock_version_and_workspace_revision", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies();
    const operations = createOperations(context.dependencies);
    const input = { expectedWorkspaceRevision: 9n, expectedLockVersion: 3n, accommodation };

    await expect(
      operations.updateAccommodation("staff-session-cookie", tripId, itemId, input),
    ).resolves.toEqual(context.workspace);
    expect(context.repository.updateAccommodation).toHaveBeenCalledTimes(1);
    const [calledAgencyId, calledTripId, calledItemId, calledRevision, calledLockVersion] =
      vi.mocked(context.repository.updateAccommodation).mock.calls[0]!;
    expect([calledAgencyId, calledTripId, calledItemId, calledRevision, calledLockVersion]).toEqual(
      [agencyId, tripId, itemId, 9n, 3n],
    );
  });

  it("updateFlight_uses_item_lock_version_and_workspace_revision", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies();
    const operations = createOperations(context.dependencies);
    const input = { expectedWorkspaceRevision: 8n, expectedLockVersion: 4n, flight };

    await expect(
      operations.updateFlight("staff-session-cookie", tripId, itemId, input),
    ).resolves.toEqual(context.workspace);
    expect(context.repository.updateFlight).toHaveBeenCalledTimes(1);
    const [calledAgencyId, calledTripId, calledItemId, calledRevision, calledLockVersion] =
      vi.mocked(context.repository.updateFlight).mock.calls[0]!;
    expect([calledAgencyId, calledTripId, calledItemId, calledRevision, calledLockVersion]).toEqual(
      [agencyId, tripId, itemId, 8n, 4n],
    );
  });

  it("createAccommodation_uses_the_session_agency_and_expected_revision", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies();
    const operations = createOperations(context.dependencies);

    await expect(
      operations.createAccommodation("staff-session-cookie", tripId, {
        expectedWorkspaceRevision: 6n,
        accommodation,
      }),
    ).resolves.toEqual(context.workspace);
    expect(context.repository.createAccommodation).toHaveBeenCalledTimes(1);
    const [calledAgencyId, calledTripId, calledRevision] = vi.mocked(
      context.repository.createAccommodation,
    ).mock.calls[0]!;
    expect([calledAgencyId, calledTripId, calledRevision]).toEqual([agencyId, tripId, 6n]);
  });

  it("updateTrip_uses_both_optimistic_versions_and_only_trip_details", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies();
    const operations = createOperations(context.dependencies);

    await expect(
      operations.updateTrip("staff-session-cookie", tripId, {
        expectedWorkspaceRevision: 10n,
        expectedLockVersion: 5n,
        trip,
      }),
    ).resolves.toEqual(context.workspace);
    expect(context.repository.updateTrip).toHaveBeenCalledTimes(1);
    const [calledAgencyId, calledTripId, calledRevision, calledLockVersion, calledTrip] = vi.mocked(
      context.repository.updateTrip,
    ).mock.calls[0]!;
    expect([calledAgencyId, calledTripId, calledRevision, calledLockVersion]).toEqual([
      agencyId,
      tripId,
      10n,
      5n,
    ]);
    expect(calledTrip).toEqual(trip);
    expect(
      vi.mocked(context.repository.updateTrip).mock.calls[0]?.[5]?.requiredPermissionIds,
    ).toEqual(["trip.edit", "trip.view"]);
  });

  it("updateTrip_rejects_missing_trip_edit_before_repository_access", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies({ permissions: ["trip.view"] });
    const operations = createOperations(context.dependencies);

    await expect(
      operations.updateTrip("staff-session-cookie", tripId, {
        expectedWorkspaceRevision: 7n,
        expectedLockVersion: 2n,
        trip,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(context.repository.updateTrip).not.toHaveBeenCalled();
  });

  it("updateFlight_rejects_unknown_draft_fields_before_repository_access", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies();
    const operations = createOperations(context.dependencies);

    await expect(
      operations.updateFlight("staff-session-cookie", tripId, itemId, {
        expectedWorkspaceRevision: 7n,
        expectedLockVersion: 2n,
        flight: { ...flight, agencyId },
      }),
    ).rejects.toMatchObject({ code: "M1_INPUT_VALIDATION" });
    expect(context.repository.updateFlight).not.toHaveBeenCalled();
  });

  it("createFlight_rejects_a_negative_workspace_revision_before_repository_access", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies();
    const operations = createOperations(context.dependencies);

    await expect(
      operations.createFlight("staff-session-cookie", tripId, {
        expectedWorkspaceRevision: -1n,
        flight,
      }),
    ).rejects.toMatchObject({ code: "M1_INPUT_VALIDATION" });
    expect(context.repository.createFlight).not.toHaveBeenCalled();
  });

  it("updateTrip_rejects_a_state_override_before_repository_access", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies();
    const operations = createOperations(context.dependencies);

    await expect(
      operations.updateTrip("staff-session-cookie", tripId, {
        expectedWorkspaceRevision: 7n,
        expectedLockVersion: 2n,
        trip: { ...trip, state: "CONFIRMED" },
      }),
    ).rejects.toMatchObject({ code: "M1_INPUT_VALIDATION" });
    expect(context.repository.updateTrip).not.toHaveBeenCalled();
  });

  it("createAccommodation_rejects_reversed_dates_before_repository_access", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies();
    const operations = createOperations(context.dependencies);

    await expect(
      operations.createAccommodation("staff-session-cookie", tripId, {
        expectedWorkspaceRevision: 7n,
        accommodation: {
          ...accommodation,
          checkOut: {
            ...accommodation.checkOut,
            localDate: "2026-10-25",
            localTime: "11:00",
            instant: "2026-10-25T11:00:00.000Z",
          },
        },
      }),
    ).rejects.toMatchObject({ code: "M1_INPUT_VALIDATION" });
    expect(context.repository.createAccommodation).not.toHaveBeenCalled();
  });

  it("createFlight_rejects_reversed_schedule_before_repository_access", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies();
    const operations = createOperations(context.dependencies);

    await expect(
      operations.createFlight("staff-session-cookie", tripId, {
        expectedWorkspaceRevision: 7n,
        flight: {
          ...flight,
          arrival: {
            ...flight.arrival,
            localTime: "09:30",
            instant: "2026-10-26T09:30:00.000Z",
          },
        },
      }),
    ).rejects.toMatchObject({ code: "M1_INPUT_VALIDATION" });
    expect(context.repository.createFlight).not.toHaveBeenCalled();
  });

  it("updateAccommodation_rejects_reversed_dates_before_repository_access", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies();
    const operations = createOperations(context.dependencies);

    await expect(
      operations.updateAccommodation("staff-session-cookie", tripId, itemId, {
        expectedWorkspaceRevision: 7n,
        expectedLockVersion: 2n,
        accommodation: {
          ...accommodation,
          checkOut: {
            ...accommodation.checkOut,
            localDate: "2026-10-25",
            instant: "2026-10-25T11:00:00.000Z",
          },
        },
      }),
    ).rejects.toMatchObject({ code: "M1_INPUT_VALIDATION" });
    expect(context.repository.updateAccommodation).not.toHaveBeenCalled();
  });

  it("updateFlight_rejects_reversed_schedule_before_repository_access", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies();
    const operations = createOperations(context.dependencies);

    await expect(
      operations.updateFlight("staff-session-cookie", tripId, itemId, {
        expectedWorkspaceRevision: 7n,
        expectedLockVersion: 2n,
        flight: {
          ...flight,
          arrival: {
            ...flight.arrival,
            localTime: "09:30",
            instant: "2026-10-26T09:30:00.000Z",
          },
        },
      }),
    ).rejects.toMatchObject({ code: "M1_INPUT_VALIDATION" });
    expect(context.repository.updateFlight).not.toHaveBeenCalled();
  });
});
