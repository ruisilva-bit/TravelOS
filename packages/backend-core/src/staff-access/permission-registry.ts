export const PERMISSION_REGISTRY_VERSION = 8 as const;

export type AuthorizationScopeKind = "AGENCY" | "ORGANIZATION_UNIT";
export type ResourceAccessLevel = "OWN" | "TEAM" | "ALL";

export interface PermissionDefinition {
  readonly id: string;
  readonly allowedScopeKinds: readonly AuthorizationScopeKind[];
  readonly allowedAccessLevels: readonly ResourceAccessLevel[];
}

/** Complete, code-owned Staff permission registry; permissions are never inferred from role labels. */
export const PERMISSION_REGISTRY = [
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
  {
    id: "quote.view",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "quote.edit",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
  {
    id: "quote.send",
    allowedScopeKinds: ["AGENCY"],
    allowedAccessLevels: ["ALL"],
  },
] as const satisfies readonly PermissionDefinition[];

export type StaffPermissionId = (typeof PERMISSION_REGISTRY)[number]["id"];

const permissionDefinitions = new Map<string, PermissionDefinition>(
  PERMISSION_REGISTRY.map((definition) => [definition.id, definition]),
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
export const OWNER_ROLE_PERMISSION_IDS: readonly StaffPermissionId[] = PERMISSION_REGISTRY.map(
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
] as const satisfies readonly StaffPermissionId[]);
