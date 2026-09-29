import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  instanceManifestInvariantRegistry,
  parseDevelopmentInstanceManifest,
} from "../../packages/config/src/index.js";
import {
  assertExactStage3RoleMembershipGraph,
  extractStage3BootstrapRoleMemberships,
  filterStage3RoleMemberships,
  STAGE_3_BIDIRECTIONAL_ROLE_MEMBERSHIP_SQL,
  STAGE_3_EXPECTED_ROLE_MEMBERSHIPS,
  verifyStage3RoleMembershipGraph,
  type Stage3RoleMembership,
} from "./stage-3-role-graph.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
type JsonObject = Record<string, unknown>;
type RuntimeProcess = "adminApi" | "portalApi" | "worker";

const asObject = (value: unknown, label: string): JsonObject => {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} is absent`,
  );
  return value as JsonObject;
};

const example = JSON.parse(
  await readFile(path.join(repositoryRoot, "deploy/manifests/development.example.json"), "utf8"),
) as JsonObject;
const copyExample = (): JsonObject => structuredClone(example);
const runtimeRolesOf = (candidate: JsonObject): Record<RuntimeProcess, JsonObject> =>
  asObject(asObject(candidate["database"], "database")["runtimeRoles"], "runtimeRoles") as Record<
    RuntimeProcess,
    JsonObject
  >;

const valid = parseDevelopmentInstanceManifest(copyExample());
assert.deepEqual(
  {
    adminApi: valid.database.runtimeRoles.adminApi.roleName,
    portalApi: valid.database.runtimeRoles.portalApi.roleName,
    worker: valid.database.runtimeRoles.worker.roleName,
  },
  {
    adminApi: "travelos_admin_api",
    portalApi: "travelos_portal_api",
    worker: "travelos_worker",
  },
);
assert.equal(
  new Set(
    Object.values(valid.database.runtimeRoles).map(
      ({ credentialReference }) => credentialReference,
    ),
  ).size,
  3,
);

const invalidRoleCases = [
  ["adminApi", "travelos_portal_api"],
  ["adminApi", "travelos_worker"],
  ["portalApi", "travelos_admin_api"],
  ["portalApi", "travelos_worker"],
  ["worker", "travelos_admin_api"],
  ["worker", "travelos_portal_api"],
  ["portalApi", "travelos_owner"],
  ["portalApi", "travelos_migrator"],
  ["portalApi", "travelos_portal_runtime"],
  ["adminApi", "travelos_admin_runtime"],
  ["worker", "travelos_worker_runtime"],
] as const satisfies readonly (readonly [RuntimeProcess, string])[];
for (const [processName, roleName] of invalidRoleCases) {
  const candidate = copyExample();
  runtimeRolesOf(candidate)[processName]["roleName"] = roleName;
  assert.throws(() => parseDevelopmentInstanceManifest(candidate));
}

const duplicateCredentialCases = [
  ["adminApi", "portalApi"],
  ["adminApi", "worker"],
  ["portalApi", "worker"],
] as const satisfies readonly (readonly [RuntimeProcess, RuntimeProcess])[];
for (const [sourceProcess, duplicateProcess] of duplicateCredentialCases) {
  const candidate = copyExample();
  const roles = runtimeRolesOf(candidate);
  roles[duplicateProcess]["credentialReference"] = roles[sourceProcess]["credentialReference"];
  assert.throws(
    () => parseDevelopmentInstanceManifest(candidate),
    /credential references must be pairwise distinct/i,
  );
}
const allCredentialReferencesEqual = copyExample();
const allEqualRoles = runtimeRolesOf(allCredentialReferencesEqual);
allEqualRoles["portalApi"]["credentialReference"] =
  allEqualRoles["adminApi"]["credentialReference"];
allEqualRoles["worker"]["credentialReference"] = allEqualRoles["adminApi"]["credentialReference"];
assert.throws(
  () => parseDevelopmentInstanceManifest(allCredentialReferencesEqual),
  /credential references must be pairwise distinct/i,
);

const generatedSchema = JSON.parse(
  await readFile(
    path.join(repositoryRoot, "deploy/manifests/schema/instance-manifest.schema.json"),
    "utf8",
  ),
) as JsonObject;
const schemaProperties = asObject(generatedSchema["properties"], "schema properties");
const databaseSchema = asObject(schemaProperties["database"], "database schema");
const databaseProperties = asObject(databaseSchema["properties"], "database schema properties");
const runtimeRolesSchema = asObject(databaseProperties["runtimeRoles"], "runtime role schema");
const runtimeRoleProperties = asObject(
  runtimeRolesSchema["properties"],
  "runtime role schema properties",
);
const schemaRoleIdentities = Object.fromEntries(
  (["adminApi", "portalApi", "worker"] as const).map((processName) => {
    const processSchema = asObject(runtimeRoleProperties[processName], `${processName} schema`);
    const processProperties = asObject(processSchema["properties"], `${processName} properties`);
    return [
      processName,
      asObject(processProperties["roleName"], `${processName} roleName`)["const"],
    ];
  }),
);
assert.deepEqual(schemaRoleIdentities, {
  adminApi: "travelos_admin_api",
  portalApi: "travelos_portal_api",
  worker: "travelos_worker",
});
assert(
  instanceManifestInvariantRegistry.runtimeOnly.some(({ id }) => id === "TOS-CONFIG-RUNTIME-005"),
);

const bootstrapSql = await readFile(
  path.join(repositoryRoot, "deploy/database/bootstrap-database-and-roles.sql"),
  "utf8",
);
assert.deepEqual(
  extractStage3BootstrapRoleMemberships(bootstrapSql),
  STAGE_3_EXPECTED_ROLE_MEMBERSHIPS,
);
assert.match(
  STAGE_3_BIDIRECTIONAL_ROLE_MEMBERSHIP_SQL,
  /member_role\.rolname[\s\S]+\bOR\b[\s\S]+granted_role\.rolname/,
);
const exactGraph = assertExactStage3RoleMembershipGraph(STAGE_3_EXPECTED_ROLE_MEMBERSHIPS);

const externalOwnerEdge: Stage3RoleMembership = {
  member: "stage3_external_owner_member",
  granted_role: "travelos_owner",
  admin_option: false,
  inherit_option: false,
  set_option: true,
};
const externalRuntimeEdge: Stage3RoleMembership = {
  member: "stage3_external_runtime_member",
  granted_role: "travelos_portal_runtime",
  admin_option: false,
  inherit_option: false,
  set_option: true,
};
const travelosToExternalEdge: Stage3RoleMembership = {
  member: "travelos_portal_api",
  granted_role: "stage3_external_group",
  admin_option: false,
  inherit_option: false,
  set_option: true,
};
const unexpectedInternalEdge: Stage3RoleMembership = {
  member: "travelos_portal_api",
  granted_role: "travelos_admin_runtime",
  admin_option: false,
  inherit_option: true,
  set_option: false,
};
const maliciousEdges = [
  externalOwnerEdge,
  externalRuntimeEdge,
  travelosToExternalEdge,
  unexpectedInternalEdge,
] as const;
for (const maliciousEdge of maliciousEdges) {
  const maliciousGraph = [...STAGE_3_EXPECTED_ROLE_MEMBERSHIPS, maliciousEdge];
  assert.equal(verifyStage3RoleMembershipGraph(maliciousGraph).result, "FAIL");
  assert.throws(() => assertExactStage3RoleMembershipGraph(maliciousGraph));
}

const missingGraph = STAGE_3_EXPECTED_ROLE_MEMBERSHIPS.slice(1);
assert.equal(verifyStage3RoleMembershipGraph(missingGraph).result, "FAIL");
const duplicatedGraph = [
  ...STAGE_3_EXPECTED_ROLE_MEMBERSHIPS,
  STAGE_3_EXPECTED_ROLE_MEMBERSHIPS[0],
];
assert.equal(verifyStage3RoleMembershipGraph(duplicatedGraph).result, "FAIL");
assert.equal(verifyStage3RoleMembershipGraph(duplicatedGraph).duplicateActual.length, 1);

const optionMutations = [
  { admin_option: true },
  { inherit_option: false },
  { set_option: true },
] as const;
for (const mutation of optionMutations) {
  const graphWithIncorrectOption: Stage3RoleMembership[] = STAGE_3_EXPECTED_ROLE_MEMBERSHIPS.map(
    (membership, index) => (index === 0 ? { ...membership, ...mutation } : membership),
  );
  assert.equal(verifyStage3RoleMembershipGraph(graphWithIncorrectOption).result, "FAIL");
}

const unrelatedEdge: Stage3RoleMembership = {
  member: "stage3_unrelated_member",
  granted_role: "stage3_unrelated_group",
  admin_option: false,
  inherit_option: true,
  set_option: false,
};
const filteredGraph = filterStage3RoleMemberships([
  ...STAGE_3_EXPECTED_ROLE_MEMBERSHIPS,
  unrelatedEdge,
]);
assert.equal(assertExactStage3RoleMembershipGraph(filteredGraph).result, "PASS");

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      result: "PASS",
      findings: {
        "TOS-S3-001": {
          status: "CORRECTED — PENDING INDEPENDENT CLOSURE",
          validManifestAccepted: true,
          exactRuntimeDatabaseIdentities: schemaRoleIdentities,
          credentialReferencesPairwiseDistinct: true,
          invalidRoleCasesRejected: invalidRoleCases.length,
          duplicateCredentialCasesRejected: duplicateCredentialCases.length + 1,
          generatedSchemaRoleIdentityParity: "PASS",
          runtimeInvariantRegistryParity: "PASS",
        },
        "TOS-S3-002": {
          status: "CORRECTED — PENDING INDEPENDENT CLOSURE",
          sharedExpectedEdgeCount: STAGE_3_EXPECTED_ROLE_MEMBERSHIPS.length,
          exactGraphVerification: exactGraph.result,
          bidirectionalQueryScope: exactGraph.scope,
          bootstrapSharedDefinitionParity: "PASS",
          maliciousEdgesRejected: maliciousEdges.length,
          missingEdgeRejected: true,
          duplicateEdgeRejected: true,
          incorrectMembershipOptionsRejected: optionMutations.length,
          unrelatedNonTravelosEdgeIgnored: true,
        },
      },
      stage4Actions: 0,
    },
    null,
    2,
  )}\n`,
);
