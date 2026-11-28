import type { StaffAuthorizationOperationProof } from "../../../staff-access/authorization.js";
import type { StaffPermissionId } from "../../../staff-access/permission-registry.js";
import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import {
  authorizeOperation,
  type StaffAuthorizationDependencies,
} from "../../trip-operations/application/staff-trip-operations.js";
import { InputValidationError } from "../../trip-operations/application/trip-slice.js";
import {
  validateAgencyProfileDraft,
  type AgencyProfile,
  type AgencyProfileDraft,
} from "../domain/agency-profile.js";

/** Fixed policy per use case; the persistence adapter re-checks it inside its transaction. */
export const AGENCY_PROFILE_PERMISSION_REQUIREMENTS = Object.freeze({
  VIEW: Object.freeze(["agency.view"] as const satisfies readonly StaffPermissionId[]),
  MANAGE: Object.freeze(["agency.manage_settings"] as const satisfies readonly StaffPermissionId[]),
});

export const AGENCY_PROFILE_LOCK_VERSION_MAXIMUM = 2_147_483_647n;

export interface AgencyProfileRepository {
  /** Returns the profile of the Agency, or null when it does not exist. */
  readProfile(
    agencyId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<AgencyProfile | null>;
  /**
   * Compare-and-swap update. Returns null when the Agency does not exist and throws
   * OptimisticConflictError (trip-slice) when the expected lock version is stale.
   */
  updateProfile(
    agencyId: OpaqueId,
    expectedLockVersion: bigint,
    draft: AgencyProfileDraft,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<AgencyProfile | null>;
}

export interface StaffAgencyProfileOperationsDependencies extends StaffAuthorizationDependencies {
  readonly repository: AgencyProfileRepository;
}

export class AgencyProfileNotFoundError extends Error {
  readonly code = "AGENCY_NOT_FOUND" as const;

  constructor() {
    super("Agency not found");
    this.name = "AgencyProfileNotFoundError";
  }
}

export interface StaffAgencyProfileOperations {
  getProfile(cookieHeader: unknown): Promise<AgencyProfile>;
  updateProfile(
    cookieHeader: unknown,
    input: { readonly expectedLockVersion: bigint; readonly profile: unknown },
  ): Promise<AgencyProfile>;
}

const validateLockVersion = (value: unknown): bigint => {
  if (typeof value !== "bigint" || value < 1n || value > AGENCY_PROFILE_LOCK_VERSION_MAXIMUM) {
    throw new InputValidationError("Agency expected lock version is invalid");
  }
  return value;
};

export const createStaffAgencyProfileOperations = (
  dependencies: StaffAgencyProfileOperationsDependencies,
): StaffAgencyProfileOperations => {
  const { repository } = dependencies;

  return {
    async getProfile(cookieHeader) {
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        AGENCY_PROFILE_PERMISSION_REQUIREMENTS.VIEW,
      );
      const profile = await repository.readProfile(
        asOpaqueId(authorization.session.agencyId),
        authorization,
      );
      if (profile === null) throw new AgencyProfileNotFoundError();
      return profile;
    },

    async updateProfile(cookieHeader, input) {
      const expectedLockVersion = validateLockVersion(input.expectedLockVersion);
      const draft = validateAgencyProfileDraft(input.profile);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        AGENCY_PROFILE_PERMISSION_REQUIREMENTS.MANAGE,
      );
      const profile = await repository.updateProfile(
        asOpaqueId(authorization.session.agencyId),
        expectedLockVersion,
        draft,
        authorization,
      );
      if (profile === null) throw new AgencyProfileNotFoundError();
      return profile;
    },
  };
};
