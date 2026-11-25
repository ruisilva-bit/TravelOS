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
const cursorId = "abcdef12-3456-7abc-8def-000000000003" as OpaqueId;
const nowEpochMs = Date.parse("2026-10-26T12:00:00.000Z");
const session = {
  sessionId: "staff-session-1",
  staffPrincipalId: "staff-principal-1",
  agencyId,
  authorizationEpoch: 2n,
  expiresAtEpochMs: nowEpochMs + 60_000,
  recentMfaVerifiedAtEpochMs: null,
};

interface TripWorkspacePage {
  readonly items: readonly unknown[];
  readonly nextCursor: OpaqueId | null;
}

interface TripWorkspace {
  readonly trip: unknown;
  readonly flights: readonly unknown[];
  readonly accommodations: readonly unknown[];
}

interface WorkspaceReadRepository {
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

interface WorkspaceOperations {
  listTrips(
    cookieHeader: unknown,
    query: { readonly limit: number; readonly cursor: OpaqueId | null },
  ): Promise<TripWorkspacePage>;
  readTripWorkspace(cookieHeader: unknown, tripId: OpaqueId): Promise<TripWorkspace | null>;
}

type CreateWorkspaceOperations = (
  dependencies: StaffAuthorizationDependencies & { readonly repository: WorkspaceReadRepository },
) => WorkspaceOperations;

const exportedFactory = (
  backendCore as unknown as { readonly createStaffTripWorkspaceOperations?: unknown }
).createStaffTripWorkspaceOperations;
const createOperations: CreateWorkspaceOperations | null =
  typeof exportedFactory === "function" ? (exportedFactory as CreateWorkspaceOperations) : null;

const makeDependencies = ({
  permissions = ["trip.view" as const],
  sessionValue = session,
}: {
  readonly permissions?: readonly StaffPermissionId[];
  readonly sessionValue?: unknown;
} = {}) => {
  const expectedPage: TripWorkspacePage = { items: [], nextCursor: cursorId };
  const repository: WorkspaceReadRepository = {
    listTrips: vi.fn(
      async (
        _agencyId: OpaqueId,
        _limit: number,
        _cursor: OpaqueId | null,
        _authorization: StaffAuthorizationOperationProof,
      ) => expectedPage,
    ),
    readTripWorkspace: vi.fn(
      async (
        _agencyId: OpaqueId,
        _tripId: OpaqueId,
        _authorization: StaffAuthorizationOperationProof,
      ) => null,
    ),
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
    expectedPage,
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

describe("Staff Trip workspace read operations", () => {
  it("listTrips_requires_trip_view_and_uses_the_session_agency", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies();
    const operations = createOperations(context.dependencies);
    const query = { limit: 17, cursor: cursorId };

    await expect(operations.listTrips("staff-session-cookie", query)).resolves.toEqual(
      context.expectedPage,
    );
    const calls = vi.mocked(context.repository.listTrips).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 3)).toEqual([agencyId, 17, cursorId]);
    expect(calls[0]?.[3].requiredPermissionIds).toEqual(["trip.view"]);
    expect(calls[0]?.[3].session.agencyId).toBe(agencyId);
  });

  it("readTripWorkspace_rejects_unauthenticated_session_before_repository_access", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies({ sessionValue: null });
    const operations = createOperations(context.dependencies);

    await expect(
      operations.readTripWorkspace("staff-session-cookie", tripId),
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(context.repository.readTripWorkspace).not.toHaveBeenCalled();
    expect(context.authorizationRepository.getStaffAuthorizationSnapshot).not.toHaveBeenCalled();
  });

  it("readTripWorkspace_rejects_missing_trip_view_before_repository_access", async () => {
    expect(createOperations).not.toBeNull();
    if (createOperations === null) return;

    const context = makeDependencies({ permissions: [] });
    const operations = createOperations(context.dependencies);

    await expect(
      operations.readTripWorkspace("staff-session-cookie", tripId),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(context.repository.readTripWorkspace).not.toHaveBeenCalled();
    expect(context.authorizationRepository.getStaffAuthorizationSnapshot).toHaveBeenCalledTimes(1);
  });
});
