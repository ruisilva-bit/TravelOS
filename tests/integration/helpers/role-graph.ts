export interface RoleMembership {
  readonly member: string;
  readonly granted_role: string;
  readonly admin_option: boolean;
  readonly inherit_option: boolean;
  readonly set_option: boolean;
}

export const ROLE_GRAPH_SCOPE = "BIDIRECTIONAL_EITHER_ENDPOINT_IS_TRAVELOS" as const;

export const EXPECTED_ROLE_MEMBERSHIPS = [
  {
    member: "travelos_admin_api",
    granted_role: "travelos_admin_runtime",
    admin_option: false,
    inherit_option: true,
    set_option: false,
  },
  {
    member: "travelos_migrator",
    granted_role: "travelos_owner",
    admin_option: false,
    inherit_option: false,
    set_option: true,
  },
  {
    member: "travelos_worker",
    granted_role: "travelos_worker_runtime",
    admin_option: false,
    inherit_option: true,
    set_option: false,
  },
] as const satisfies readonly RoleMembership[];

export const ROLE_NAMES = [
  ...new Set(
    EXPECTED_ROLE_MEMBERSHIPS.flatMap(({ member, granted_role }) => [member, granted_role]),
  ),
].toSorted();

const roleRoleNameSet = new Set<string>(ROLE_NAMES);

export const isRoleMembershipInScope = (membership: RoleMembership): boolean =>
  roleRoleNameSet.has(membership.member) || roleRoleNameSet.has(membership.granted_role);

export const filterRoleMemberships = (
  memberships: readonly RoleMembership[],
): readonly RoleMembership[] => memberships.filter(isRoleMembershipInScope);

const quotedRoleNames = ROLE_NAMES.map((roleName) => `'${roleName}'`).join(", ");

export const ROLE_BIDIRECTIONAL_ROLE_MEMBERSHIP_SQL = `
SELECT member_role.rolname AS member,
       granted_role.rolname AS granted_role,
       membership.admin_option,
       membership.inherit_option,
       membership.set_option
  FROM pg_catalog.pg_auth_members AS membership
  JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
  JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
 WHERE member_role.rolname = ANY (ARRAY[${quotedRoleNames}]::text[])
    OR granted_role.rolname = ANY (ARRAY[${quotedRoleNames}]::text[])
 ORDER BY member_role.rolname, granted_role.rolname`;

const membershipKey = (membership: RoleMembership): string =>
  [
    membership.member,
    membership.granted_role,
    membership.admin_option,
    membership.inherit_option,
    membership.set_option,
  ].join("\0");

const membershipOrder = (left: RoleMembership, right: RoleMembership): number =>
  membershipKey(left).localeCompare(membershipKey(right));

export interface RoleGraphVerification {
  readonly result: "PASS" | "FAIL";
  readonly scope: typeof ROLE_GRAPH_SCOPE;
  readonly expectedMode: "EXACT_GRAPH_AND_OPTIONS";
  readonly expectedCount: number;
  readonly actualCount: number;
  readonly missing: readonly RoleMembership[];
  readonly unexpected: readonly RoleMembership[];
  readonly duplicateActual: readonly RoleMembership[];
}

export const verifyRoleMembershipGraph = (
  actualMemberships: readonly RoleMembership[],
): RoleGraphVerification => {
  const expectedKeys = new Set(EXPECTED_ROLE_MEMBERSHIPS.map(membershipKey));
  const seenActualKeys = new Set<string>();
  const duplicateActual: RoleMembership[] = [];
  for (const membership of actualMemberships) {
    const key = membershipKey(membership);
    if (seenActualKeys.has(key)) duplicateActual.push(membership);
    seenActualKeys.add(key);
  }

  const missing = EXPECTED_ROLE_MEMBERSHIPS.filter(
    (membership) => !seenActualKeys.has(membershipKey(membership)),
  );
  const unexpected = actualMemberships.filter(
    (membership) => !expectedKeys.has(membershipKey(membership)),
  );
  const result =
    actualMemberships.length === EXPECTED_ROLE_MEMBERSHIPS.length &&
    missing.length === 0 &&
    unexpected.length === 0 &&
    duplicateActual.length === 0
      ? "PASS"
      : "FAIL";

  return {
    result,
    scope: ROLE_GRAPH_SCOPE,
    expectedMode: "EXACT_GRAPH_AND_OPTIONS",
    expectedCount: EXPECTED_ROLE_MEMBERSHIPS.length,
    actualCount: actualMemberships.length,
    missing: [...missing].sort(membershipOrder),
    unexpected: [...unexpected].sort(membershipOrder),
    duplicateActual: [...duplicateActual].sort(membershipOrder),
  };
};

export const assertExactRoleMembershipGraph = (
  actualMemberships: readonly RoleMembership[],
): RoleGraphVerification => {
  const verification = verifyRoleMembershipGraph(actualMemberships);
  if (verification.result !== "PASS") {
    const describe = (membership: RoleMembership) =>
      `${membership.member}->${membership.granted_role}[admin=${membership.admin_option},inherit=${membership.inherit_option},set=${membership.set_option}]`;
    throw new Error(
      [
        "Role membership graph is not an exact bidirectional match",
        `missing=${verification.missing.map(describe).join(",") || "none"}`,
        `unexpected=${verification.unexpected.map(describe).join(",") || "none"}`,
        `duplicates=${verification.duplicateActual.map(describe).join(",") || "none"}`,
      ].join("; "),
    );
  }
  return verification;
};

const BOOTSTRAP_GRAPH_START = "-- travelos-role-graph-parity:start";
const BOOTSTRAP_GRAPH_END = "-- travelos-role-graph-parity:end";

export const extractBootstrapRoleMemberships = (
  bootstrapSql: string,
): readonly RoleMembership[] => {
  const start = bootstrapSql.indexOf(BOOTSTRAP_GRAPH_START);
  const end = bootstrapSql.indexOf(BOOTSTRAP_GRAPH_END);
  if (start < 0 || end <= start) {
    throw new Error("Bootstrap SQL role-graph parity block is absent or malformed");
  }
  const block = bootstrapSql.slice(start + BOOTSTRAP_GRAPH_START.length, end);
  const rows = [
    ...block.matchAll(
      /\('([^']+)',\s*'([^']+)',\s*(true|false),\s*(true|false),\s*(true|false)\)/g,
    ),
  ].map((match) => ({
    member: match[1]!,
    granted_role: match[2]!,
    admin_option: match[3] === "true",
    inherit_option: match[4] === "true",
    set_option: match[5] === "true",
  }));
  if (rows.length === 0) throw new Error("Bootstrap SQL role-graph parity block has no rows");
  return rows.sort(membershipOrder);
};
