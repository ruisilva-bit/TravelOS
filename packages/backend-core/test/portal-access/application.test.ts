import { describe, expect, it, vi } from "vitest";

import * as backendCore from "../../src/index.js";
import { InputValidationError } from "../../src/index.js";
import type {
  StaffAuthorizationDependencies,
  StaffAuthorizationError,
  OpaqueId,
  StaffAuthorizationOperationProof,
} from "../../src/index.js";

const agencyId = "abcdef12-3456-7abc-8def-000000000001" as OpaqueId;
const otherAgencyId = "abcdef12-3456-7abc-8def-000000000002" as OpaqueId;
const tripId = "abcdef12-3456-7abc-8def-000000000003" as OpaqueId;
const otherTripId = "abcdef12-3456-7abc-8def-000000000004" as OpaqueId;
const grantId = "abcdef12-3456-7abc-8def-000000000005" as OpaqueId;
const nowEpochMs = Date.parse("2026-10-15T10:00:00.000Z");

interface TripAccessGrant {
  readonly grantId: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly portalPrincipalId: string;
  readonly tripId: OpaqueId;
  readonly capabilities: readonly ["trip.view_current"];
  readonly issuedByStaffPrincipalId: string;
  readonly issuedAt: string;
  readonly expiresAt: string | null;
  readonly relationshipLabel: string | null;
  readonly revokedByStaffPrincipalId: string | null;
  readonly revokedAt: string | null;
}

interface IssueTripAccessGrantCommand {
  readonly agencyId: OpaqueId;
  readonly portalPrincipalId: string;
  readonly tripId: OpaqueId;
  readonly capabilities: readonly ["trip.view_current"];
  readonly idempotencyKey: string;
  readonly expiresAt: string | null;
  readonly relationshipLabel: string | null;
}

interface RevokeTripAccessGrantCommand {
  readonly agencyId: OpaqueId;
  readonly grantId: OpaqueId;
  readonly idempotencyKey: string;
}

interface TripAccessGrantRepository {
  issueTripAccessGrant(
    command: IssueTripAccessGrantCommand,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripAccessGrant | null>;
  revokeTripAccessGrant(
    command: RevokeTripAccessGrantCommand,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripAccessGrant | null>;
}

interface StaffTripAccessOperations {
  issueTripAccessGrant(cookieHeader: unknown, input: unknown): Promise<TripAccessGrant>;
  revokeTripAccessGrant(cookieHeader: unknown, input: unknown): Promise<TripAccessGrant>;
}

type CreateOperations = (
  dependencies: StaffAuthorizationDependencies & {
    readonly repository: TripAccessGrantRepository;
  },
) => StaffTripAccessOperations;

const exportedFactory = (
  backendCore as unknown as { readonly createStaffTripAccessOperations?: unknown }
).createStaffTripAccessOperations;
const createOperations =
  typeof exportedFactory === "function" ? (exportedFactory as CreateOperations) : null;
const itWhenImplemented = createOperations === null ? it.skip : it;

const activeGrant: TripAccessGrant = {
  grantId,
  agencyId,
  portalPrincipalId: "portal-principal-1",
  tripId,
  capabilities: ["trip.view_current"],
  issuedByStaffPrincipalId: "staff-principal-1",
  issuedAt: "2026-10-15T10:00:00.000Z",
  expiresAt: "2030-12-31T23:59:59.000Z",
  relationshipLabel: "Primary traveller",
  revokedByStaffPrincipalId: null,
  revokedAt: null,
};

const revokedGrant: TripAccessGrant = {
  ...activeGrant,
  revokedByStaffPrincipalId: "staff-principal-1",
  revokedAt: "2026-10-15T10:01:00.000Z",
};

const issueRequest = {
  agencyId,
  portalPrincipalId: "portal-principal-1",
  tripId,
  idempotencyKey: "issue-trip-access-001",
  expiresAt: "2030-12-31T23:59:59.000Z",
  relationshipLabel: "  Primary traveller  ",
};

const revokeRequest = {
  agencyId,
  grantId,
  idempotencyKey: "revoke-trip-access-001",
};

const makeDependencies = ({
  permission = true,
  session = true,
  issueResult = activeGrant,
  revokeResult = revokedGrant,
  sessionAgencyId = agencyId,
}: {
  readonly permission?: boolean;
  readonly session?: boolean;
  readonly issueResult?: TripAccessGrant | null;
  readonly revokeResult?: TripAccessGrant | null;
  readonly sessionAgencyId?: OpaqueId;
} = {}) => {
  const sessionResolver = {
    resolveStaffSession: vi.fn(async () =>
      session
        ? {
            sessionId: "staff-session-1",
            staffPrincipalId: "staff-principal-1",
            agencyId: sessionAgencyId,
            authorizationEpoch: 0n,
            expiresAtEpochMs: nowEpochMs + 60_000,
            recentMfaVerifiedAtEpochMs: null,
          }
        : null,
    ),
  };
  const authorizationRepository = {
    getStaffAuthorizationSnapshot: vi.fn(
      async (staffPrincipalId: string, targetAgencyId: OpaqueId) => ({
        staffPrincipalId,
        agencyId: targetAgencyId,
        membershipState: "ACTIVE" as const,
        authorizationEpoch: 0n,
        assignments: permission
          ? [
              {
                agencyId: targetAgencyId,
                permissionId: "trip.access.manage" as const,
                scopeKind: "AGENCY" as const,
                organizationUnitId: null,
                accessLevel: "ALL" as const,
                active: true,
              },
            ]
          : [],
      }),
    ),
  };
  const repository: TripAccessGrantRepository = {
    issueTripAccessGrant: vi.fn(async () => issueResult),
    revokeTripAccessGrant: vi.fn(async () => revokeResult),
  };

  return {
    dependencies: {
      authorizationRepository,
      sessionResolver,
      nowEpochMs: () => nowEpochMs,
      repository,
    },
    authorizationRepository,
    sessionResolver,
    repository,
  };
};

const operationsFor = (
  dependencies: ReturnType<typeof makeDependencies>["dependencies"],
): StaffTripAccessOperations => {
  if (createOperations === null)
    throw new Error("test precondition: Stage 7 operation is not exported");
  return createOperations(dependencies);
};

describe("Staff TripAccessGrant application boundary", () => {
  it("exports separate issue and one-way revoke operations", () => {
    expect(createOperations).toBeTypeOf("function");
  });

  itWhenImplemented(
    "derives the issuing Staff actor from the Staff session and fixes capability to trip.view_current",
    async () => {
      const context = makeDependencies();
      const operations = operationsFor(context.dependencies);

      await expect(operations.issueTripAccessGrant("staff-cookie", issueRequest)).resolves.toEqual(
        activeGrant,
      );

      const [command, authorization] = vi.mocked(context.repository.issueTripAccessGrant).mock
        .calls[0]!;
      expect(command).toEqual({
        agencyId,
        portalPrincipalId: "portal-principal-1",
        tripId,
        capabilities: ["trip.view_current"],
        idempotencyKey: "issue-trip-access-001",
        expiresAt: "2030-12-31T23:59:59.000Z",
        relationshipLabel: "Primary traveller",
      });
      expect(authorization.session.staffPrincipalId).toBe("staff-principal-1");
      expect(authorization.session.agencyId).toBe(agencyId);
      expect(authorization.requiredPermissionIds).toEqual(["trip.access.manage"]);
    },
  );

  itWhenImplemented("rejects unauthenticated Staff requests before repository access", async () => {
    const context = makeDependencies({ session: false });
    const operations = operationsFor(context.dependencies);

    await expect(
      operations.issueTripAccessGrant("invalid-cookie", issueRequest),
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    } satisfies Partial<StaffAuthorizationError>);
    expect(context.repository.issueTripAccessGrant).not.toHaveBeenCalled();
  });

  itWhenImplemented("rejects a target Agency different from the Staff session Agency", async () => {
    const context = makeDependencies();
    const operations = operationsFor(context.dependencies);

    await expect(
      operations.issueTripAccessGrant("staff-cookie", { ...issueRequest, agencyId: otherAgencyId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<StaffAuthorizationError>);
    expect(context.authorizationRepository.getStaffAuthorizationSnapshot).not.toHaveBeenCalled();
    expect(context.repository.issueTripAccessGrant).not.toHaveBeenCalled();
  });

  itWhenImplemented("requires trip.access.manage at Agency scope", async () => {
    const context = makeDependencies({ permission: false });
    const operations = operationsFor(context.dependencies);

    await expect(
      operations.revokeTripAccessGrant("staff-cookie", revokeRequest),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    } satisfies Partial<StaffAuthorizationError>);
    expect(context.repository.revokeTripAccessGrant).not.toHaveBeenCalled();
  });

  itWhenImplemented(
    "rejects unknown fields and caller-supplied capability or actor values",
    async () => {
      const context = makeDependencies();
      const operations = operationsFor(context.dependencies);

      await expect(
        operations.issueTripAccessGrant("staff-cookie", {
          ...issueRequest,
          capabilities: ["trip.view_current", "message.create"],
          issuedByStaffPrincipalId: "attacker-chosen-actor",
        }),
      ).rejects.toBeInstanceOf(InputValidationError);
      expect(context.repository.issueTripAccessGrant).not.toHaveBeenCalled();
    },
  );

  itWhenImplemented("rejects an expiry that is not in the future", async () => {
    const context = makeDependencies();
    const operations = operationsFor(context.dependencies);

    await expect(
      operations.issueTripAccessGrant("staff-cookie", {
        ...issueRequest,
        expiresAt: "2026-10-15T09:59:59.000Z",
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
    expect(context.repository.issueTripAccessGrant).not.toHaveBeenCalled();
  });

  itWhenImplemented(
    "maps cross-scope issue and revoke targets to the same non-leaking not-found error",
    async () => {
      const issueContext = makeDependencies({ issueResult: null });
      const issueOperations = operationsFor(issueContext.dependencies);
      const issueError = await issueOperations
        .issueTripAccessGrant("staff-cookie", {
          ...issueRequest,
          portalPrincipalId: "portal-principal-from-another-agency",
          tripId: otherTripId,
        })
        .catch((error: unknown) => error);

      const revokeContext = makeDependencies({ revokeResult: null });
      const revokeOperations = operationsFor(revokeContext.dependencies);
      const revokeError = await revokeOperations
        .revokeTripAccessGrant("staff-cookie", revokeRequest)
        .catch((error: unknown) => error);

      expect(issueError).toMatchObject({ code: "NOT_FOUND", message: "Not found" });
      expect(revokeError).toMatchObject({ code: "NOT_FOUND", message: "Not found" });
      expect(String(issueError)).not.toContain("portal-principal-from-another-agency");
      expect(String(issueError)).not.toContain(otherTripId);
      expect(String(revokeError)).not.toContain(grantId);
    },
  );

  itWhenImplemented(
    "makes revoke a separately idempotent operation and returns its persisted revocation fact",
    async () => {
      const context = makeDependencies();
      const operations = operationsFor(context.dependencies);

      await expect(
        operations.revokeTripAccessGrant("staff-cookie", revokeRequest),
      ).resolves.toEqual(revokedGrant);
      const [command, authorization] = vi.mocked(context.repository.revokeTripAccessGrant).mock
        .calls[0]!;
      expect(command).toEqual({ agencyId, grantId, idempotencyKey: "revoke-trip-access-001" });
      expect(authorization.requiredPermissionIds).toEqual(["trip.access.manage"]);
    },
  );
});
