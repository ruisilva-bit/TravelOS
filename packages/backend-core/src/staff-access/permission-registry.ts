export const PERMISSION_REGISTRY_VERSION = 7 as const;

export type AuthorizationScopeKind = "AGENCY" | "ORGANIZATION_UNIT";
export type ResourceAccessLevel = "OWN" | "TEAM" | "ALL";

export interface PermissionDefinition {
  readonly id: string;
  readonly allowedScopeKinds: readonly AuthorizationScopeKind[];
  readonly allowedAccessLevels: readonly ResourceAccessLevel[];
}

/**
 * Stage 5 owns the first product capabilities used by the Admin API.
 * Product permissions are added by their owning stage, never inferred from role labels.
 */
export const STAGE_5_PERMISSION_REGISTRY = [
  {
    id: "agency.view",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "agency.manage_settings",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "staff.view",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "staff.invite",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "staff.manage_roles",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "staff.suspend",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "finance.view_prices",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "finance.view_costs",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "finance.manage_costs",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "customer.view",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "customer.edit",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "traveller.view_sensitive",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "traveller.edit",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "trip.view",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "trip.edit",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "reservation.view",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "reservation.edit",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
] as const satisfies readonly PermissionDefinition[];

/** Stage 6 adds explicit, independently assignable publication capabilities. */
export const STAGE_6_PERMISSION_REGISTRY = [
  ...STAGE_5_PERMISSION_REGISTRY,
  {
    id: "trip.preview",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "trip.publish",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
] as const satisfies readonly PermissionDefinition[];

/** Stage 7 adds explicit Agency-scoped Portal grants and runtime acceptance lifecycle permissions. */
export const STAGE_7_PERMISSION_REGISTRY = [
  ...STAGE_6_PERMISSION_REGISTRY,
  {
    id: "trip.access.manage",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "trip.withdraw_publication",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "runtime_acceptance.fixture.manage",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
] as const satisfies readonly PermissionDefinition[];

/** M2 slice 1 adds the Sales Lead capabilities; qualification additionally needs `customer.edit`. */
export const M2_PERMISSION_REGISTRY = [
  ...STAGE_7_PERMISSION_REGISTRY,
  {
    id: "sales.view",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "sales.edit",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
] as const satisfies readonly PermissionDefinition[];

/** Compatibility export retained for Stage 4 consumers; the M2 registry is current. */
export const STAGE_4_PERMISSION_REGISTRY = STAGE_5_PERMISSION_REGISTRY;

export type StaffPermissionId = (typeof M2_PERMISSION_REGISTRY)[number]["id"];

const permissionDefinitions = new Map<string, PermissionDefinition>(
  M2_PERMISSION_REGISTRY.map((definition) => [definition.id, definition]),
);

export const isStaffPermissionId = (value: string): value is StaffPermissionId =>
  permissionDefinitions.has(value);

export const permissionDefinitionFor = (permissionId: StaffPermissionId): PermissionDefinition => {
  const definition = permissionDefinitions.get(permissionId);
  if (definition === undefined) {
    throw new Error(`Unknown code-owned Staff permission: ${permissionId}`);
  }
  return definition;
};

export const OWNER_ROLE_TEMPLATE_KEY = "agency-owner-v1" as const;
export const OWNER_ROLE_PERMISSION_IDS: readonly StaffPermissionId[] = M2_PERMISSION_REGISTRY.map(
  ({ id }) => id,
);

export const TRIP_OPERATIONS_ROLE_TEMPLATE_KEY = "trip-operations-v1" as const;
export const TRIP_OPERATIONS_ROLE_PERMISSION_IDS = Object.freeze([
  "agency.view",
  "customer.edit",
  "traveller.edit",
  "trip.view",
  "trip.edit",
  "trip.preview",
  "trip.publish",
  "trip.access.manage",
] as const satisfies readonly StaffPermissionId[]);
