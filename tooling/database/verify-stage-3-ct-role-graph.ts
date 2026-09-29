import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE_3_ROLE_GRAPH_SCOPE,
  type Stage3RoleMembership,
  assertExactStage3RoleMembershipGraph,
} from "./stage-3-role-graph.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error("Usage: tsx tooling/database/verify-stage-3-ct-role-graph.ts <JSON input>");
}

const parsed = JSON.parse(
  await readFile(path.resolve(repositoryRoot, inputPath), "utf8"),
) as unknown;
assert.ok(Array.isArray(parsed), "CT role graph input must be a JSON array");

const memberships: Stage3RoleMembership[] = parsed.map((value, index) => {
  assert.ok(typeof value === "object" && value !== null, `CT role graph row ${index} is invalid`);
  const row = value as Record<string, unknown>;
  assert.equal(typeof row["member"], "string", `CT role graph row ${index} member is invalid`);
  assert.equal(
    typeof row["granted_role"],
    "string",
    `CT role graph row ${index} granted_role is invalid`,
  );
  for (const option of ["admin_option", "inherit_option", "set_option"] as const) {
    assert.equal(typeof row[option], "boolean", `CT role graph row ${index} ${option} is invalid`);
  }
  return {
    member: row["member"],
    granted_role: row["granted_role"],
    admin_option: row["admin_option"],
    inherit_option: row["inherit_option"],
    set_option: row["set_option"],
  } as Stage3RoleMembership;
});

const verification = assertExactStage3RoleMembershipGraph(memberships);
process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      result: "PASS",
      target: {
        proxmoxNode: "pxmx2",
        ct: 200,
        hostname: "travelos-dev",
        database: "travelos_development",
      },
      scope: "focused read-only effective PostgreSQL role-membership graph verification",
      query: {
        readOnly: true,
        catalogues: ["pg_catalog.pg_auth_members", "pg_catalog.pg_roles"],
        direction: STAGE_3_ROLE_GRAPH_SCOPE,
      },
      exactGraph: verification,
      memberships,
      access: {
        method: "Proxmox LXC console followed by ephemeral SSH key",
        databaseMutations: 0,
        roleOrMembershipMutations: 0,
        schemaMutations: 0,
        serviceChanges: 0,
        temporaryAccessCleanup: "PENDING",
      },
      repeatedQualificationWork: {
        bootstrapRuns: 0,
        migrationRuns: 0,
        backupOrRestoreRuns: 0,
        privilegeMatrixRuns: 0,
      },
      stage4Actions: 0,
    },
    null,
    2,
  )}\n`,
);
