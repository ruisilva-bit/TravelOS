import {
  OWNER_ROLE_PERMISSION_IDS,
  OWNER_ROLE_TEMPLATE_KEY,
  PERMISSION_REGISTRY_VERSION,
  TRIP_OPERATIONS_ROLE_PERMISSION_IDS,
  TRIP_OPERATIONS_ROLE_TEMPLATE_KEY,
  type StaffPermissionId,
} from "../staff-access/permission-registry.js";
import { isUuidV7 } from "../shared-kernel/opaque-id.js";

export interface RootAgencyBootstrapInput {
  readonly agencyId: string;
  readonly bootstrapReference: string;
  readonly slug: string;
}

export interface RootAgencyBootstrapResult {
  readonly agencyId: string;
  readonly bootstrapReference: string;
  readonly slug: string;
  readonly created: boolean;
  readonly ownerRoleId: string;
  readonly permissionRegistryVersion: number;
}

/** A purpose-specific application port; its implementation owns one database transaction. */
export interface RootAgencyBootstrapPort {
  ensureRootAgency(input: RootAgencyBootstrapInput): Promise<RootAgencyBootstrapResult>;
}

export interface OwnerRoleTemplate {
  readonly templateKey: typeof OWNER_ROLE_TEMPLATE_KEY;
  readonly permissionIds: readonly StaffPermissionId[];
}

export const ROOT_AGENCY_OWNER_TEMPLATE: OwnerRoleTemplate = {
  templateKey: OWNER_ROLE_TEMPLATE_KEY,
  permissionIds: OWNER_ROLE_PERMISSION_IDS,
};

export interface TripOperationsRoleTemplate {
  readonly templateKey: typeof TRIP_OPERATIONS_ROLE_TEMPLATE_KEY;
  readonly permissionIds: typeof TRIP_OPERATIONS_ROLE_PERMISSION_IDS;
}

export const TRIP_OPERATIONS_ROLE_TEMPLATE: TripOperationsRoleTemplate = Object.freeze({
  templateKey: TRIP_OPERATIONS_ROLE_TEMPLATE_KEY,
  permissionIds: TRIP_OPERATIONS_ROLE_PERMISSION_IDS,
});

const nonEmpty = (value: string, label: string): void => {
  if (value.trim().length === 0) throw new Error(`${label} must not be blank`);
};

/**
 * The idempotency key is the manifest bootstrap reference, never an operator-supplied ID.
 * The persistence adapter must reject a second unrelated root Agency transactionally.
 */
export const bootstrapRootAgency = async (
  port: RootAgencyBootstrapPort,
  input: RootAgencyBootstrapInput,
): Promise<RootAgencyBootstrapResult> => {
  if (!isUuidV7(input.agencyId)) {
    throw new Error("Agency ID must be a canonical lowercase UUIDv7");
  }
  nonEmpty(input.bootstrapReference, "Agency bootstrap reference");
  nonEmpty(input.slug, "Agency slug");
  const result = await port.ensureRootAgency(input);
  if (
    !isUuidV7(result.agencyId) ||
    result.bootstrapReference !== input.bootstrapReference ||
    result.slug !== input.slug ||
    result.permissionRegistryVersion !== PERMISSION_REGISTRY_VERSION
  ) {
    throw new Error("Root Agency bootstrap persistence returned an incompatible record");
  }
  return result;
};
