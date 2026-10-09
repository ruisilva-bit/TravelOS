import {
  isStaffPermissionId,
  permissionDefinitionFor,
  type AuthorizationScopeKind,
  type ResourceAccessLevel,
  type StaffPermissionId,
} from "./permission-registry.js";

export type StaffMembershipState = "ACTIVE" | "DISABLED" | "REVOKED";

export interface StaffAuthorizationAssignment {
  readonly agencyId: string;
  readonly permissionId: StaffPermissionId;
  readonly scopeKind: AuthorizationScopeKind;
  readonly organizationUnitId: string | null;
  readonly accessLevel: ResourceAccessLevel;
  readonly active: boolean;
}

export interface StaffAuthorizationSnapshot {
  readonly staffPrincipalId: string;
  readonly agencyId: string;
  readonly membershipState: StaffMembershipState;
  readonly authorizationEpoch: bigint;
  readonly assignments: readonly StaffAuthorizationAssignment[];
}

export interface StaffSessionAuthorizationProof {
  /** Better Auth Staff session identifier, revalidated against PostgreSQL in each command transaction. */
  readonly sessionId: string;
  readonly staffPrincipalId: string;
  readonly agencyId: string;
  readonly authorizationEpoch: bigint;
  readonly expiresAtEpochMs: number;
  readonly recentMfaVerifiedAtEpochMs: number | null;
}

export interface StaffAuthorizationOperationProof {
  readonly session: StaffSessionAuthorizationProof;
  readonly requiredPermissionIds: readonly StaffPermissionId[];
  readonly nowEpochMs: number;
}

export interface StaffAuthorizationTarget {
  readonly agencyId: string;
  /** Exact target unit followed by its ancestors, all retrieved server-side. */
  readonly organizationUnitAncestorIds: readonly string[];
  readonly requiredAccessLevel: ResourceAccessLevel;
}

export interface StaffAuthorizationRequest {
  readonly session: StaffSessionAuthorizationProof | null;
  readonly snapshot: StaffAuthorizationSnapshot | null;
  readonly permissionId: string;
  readonly target: StaffAuthorizationTarget;
  readonly nowEpochMs: number;
  readonly recentMfaMaximumAgeMs: number | null;
}

export type StaffAuthorizationDenial =
  | "UNAUTHENTICATED"
  | "SESSION_EXPIRED"
  | "NO_MEMBERSHIP"
  | "INACTIVE_MEMBERSHIP"
  | "SESSION_PRINCIPAL_MISMATCH"
  | "WRONG_AGENCY"
  | "AUTHORIZATION_EPOCH_MISMATCH"
  | "UNKNOWN_PERMISSION"
  | "MISSING_RECENT_MFA"
  | "MISSING_PERMISSION";

export type StaffAuthorizationDecision =
  | { readonly result: "ALLOW"; readonly permissionId: StaffPermissionId }
  | { readonly result: "DENY"; readonly reason: StaffAuthorizationDenial };

const accessLevelAllows = (
  assignment: ResourceAccessLevel,
  required: ResourceAccessLevel,
): boolean => {
  const rank: Record<ResourceAccessLevel, number> = { OWN: 1, TEAM: 2, ALL: 3 };
  return rank[assignment] >= rank[required];
};

const scopeAllows = (
  assignment: StaffAuthorizationAssignment,
  target: StaffAuthorizationTarget,
): boolean => {
  if (assignment.agencyId !== target.agencyId) return false;
  if (assignment.scopeKind === "AGENCY") return assignment.organizationUnitId === null;
  return (
    assignment.organizationUnitId !== null &&
    target.organizationUnitAncestorIds.includes(assignment.organizationUnitId)
  );
};

/**
 * Pure server-side decision policy. Callers supply only trusted session and persistence data;
 * browser role labels, query parameters and display names are deliberately absent.
 */
export const authorizeStaffRequest = (
  request: StaffAuthorizationRequest,
): StaffAuthorizationDecision => {
  const { session, snapshot, target } = request;
  if (session === null) return { result: "DENY", reason: "UNAUTHENTICATED" };
  if (session.expiresAtEpochMs <= request.nowEpochMs) {
    return { result: "DENY", reason: "SESSION_EXPIRED" };
  }
  if (snapshot === null) return { result: "DENY", reason: "NO_MEMBERSHIP" };
  if (snapshot.membershipState !== "ACTIVE") {
    return { result: "DENY", reason: "INACTIVE_MEMBERSHIP" };
  }
  if (snapshot.staffPrincipalId !== session.staffPrincipalId) {
    return { result: "DENY", reason: "SESSION_PRINCIPAL_MISMATCH" };
  }
  if (snapshot.agencyId !== session.agencyId || snapshot.agencyId !== target.agencyId) {
    return { result: "DENY", reason: "WRONG_AGENCY" };
  }
  if (snapshot.authorizationEpoch !== session.authorizationEpoch) {
    return { result: "DENY", reason: "AUTHORIZATION_EPOCH_MISMATCH" };
  }
  if (!isStaffPermissionId(request.permissionId)) {
    return { result: "DENY", reason: "UNKNOWN_PERMISSION" };
  }
  if (request.recentMfaMaximumAgeMs !== null) {
    const verifiedAt = session.recentMfaVerifiedAtEpochMs;
    if (verifiedAt === null || verifiedAt + request.recentMfaMaximumAgeMs <= request.nowEpochMs) {
      return { result: "DENY", reason: "MISSING_RECENT_MFA" };
    }
  }

  const definition = permissionDefinitionFor(request.permissionId);
  const allowed = snapshot.assignments.some(
    (assignment) =>
      assignment.active &&
      assignment.permissionId === request.permissionId &&
      definition.allowedScopeKinds.includes(assignment.scopeKind) &&
      definition.allowedAccessLevels.includes(assignment.accessLevel) &&
      scopeAllows(assignment, target) &&
      accessLevelAllows(assignment.accessLevel, target.requiredAccessLevel),
  );

  return allowed
    ? { result: "ALLOW", permissionId: request.permissionId }
    : { result: "DENY", reason: "MISSING_PERMISSION" };
};

export interface LastActiveOwnerPolicyInput {
  readonly activeOwnerMembershipCount: number;
  readonly operationRemovesOwnerMembership: boolean;
}

export const protectsLastActiveOwner = ({
  activeOwnerMembershipCount,
  operationRemovesOwnerMembership,
}: LastActiveOwnerPolicyInput): boolean =>
  operationRemovesOwnerMembership && activeOwnerMembershipCount <= 1;
