import { createHash } from "node:crypto";
import { copyFile, readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { QueryResultRow } from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import type { TransactionContext } from "../../packages/backend-core/src/index.js";
import { NestedTransactionNotSupportedError } from "../../packages/backend-core/src/index.js";
import { createPostgresPersistence } from "../../packages/database/src/index.js";
import { verifyMigrationChain } from "../../tooling/database/migration-runner.js";
import {
  assertExactRoleMembershipGraph,
  extractBootstrapRoleMemberships,
  ROLE_BIDIRECTIONAL_ROLE_MEMBERSHIP_SQL,
  EXPECTED_ROLE_MEMBERSHIPS,
  verifyRoleMembershipGraph,
  type RoleMembership,
} from "./helpers/role-graph.js";
import {
  bootstrapDatabaseRoles,
  clientFor,
  createDatabase,
  host,
  inspectMigrationStatus,
  migrateToHead,
  port,
  postgresBin,
  productionChain,
  productionMigrationNames,
  readChainManifest,
  queryAs as queryAsIn,
  queryAsOwner as queryAsOwnerIn,
  repositoryRoot,
  requireHarness,
  runMigrationChain,
  targetFor,
  workRoot,
  type MigrationChain,
} from "./helpers/postgres.js";

const primaryDatabase = "travelos_roles_primary";
const concurrencyDatabase = "travelos_roles_concurrency";
const failureDatabase = "travelos_roles_failure";
const baselineDatabase = "travelos_roles_baseline";
const tamperedDatabase = "travelos_roles_tampered";
const agency = {
  agencyId: "019b0000-0000-7000-8000-0000000000a1",
  bootstrapReference: "database-roles",
  slug: "database-roles",
} as const;

const queryAs = <Row extends QueryResultRow>(
  user: string,
  sql: string,
  database = primaryDatabase,
): Promise<readonly Row[]> => queryAsIn<Row>(user, sql, database);
const queryAsOwner = <Row extends QueryResultRow>(
  sql: string,
  database = primaryDatabase,
): Promise<readonly Row[]> => queryAsOwnerIn<Row>(sql, database);
const queryRoleMemberships = async (): Promise<readonly RoleMembership[]> =>
  queryAs<RoleMembership>("postgres", ROLE_BIDIRECTIONAL_ROLE_MEMBERSHIP_SQL);

const createSyntheticChain = async (
  directoryName: string,
  files: Readonly<Record<string, string>>,
): Promise<MigrationChain> => {
  const directory = path.join(workRoot, directoryName);
  await mkdir(directory, { recursive: true });
  const migrations = [];
  for (const [file, content] of Object.entries(files).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    await writeFile(path.join(directory, file), content);
    migrations.push({
      file,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  const checksumManifestPath = path.join(directory, "checksums.json");
  await writeFile(
    checksumManifestPath,
    `${JSON.stringify({ schemaVersion: 1, algorithm: "sha256", migrations }, null, 2)}\n`,
  );
  return { directory, checksumManifestPath };
};

const runtimeSurfaces = [
  { role: "travelos_admin_api", schema: "trip_ops", group: "travelos_admin_runtime" },
  { role: "travelos_worker", schema: "job_runtime", group: "travelos_worker_runtime" },
] as const;

const attemptPrivilege = async ({
  role,
  operation,
  sql,
  expected,
  database = primaryDatabase,
}: {
  readonly role: string;
  readonly operation: string;
  readonly sql: string;
  readonly expected: "ALLOW" | "DENY";
  readonly database?: string;
}): Promise<void> => {
  const client = await clientFor(role, database);
  let observed: "ALLOW" | "DENY" = "ALLOW";
  let sqlstate: string | null = null;
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("ROLLBACK");
  } catch (error) {
    observed = "DENY";
    sqlstate =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : null;
    await client.query("ROLLBACK").catch(() => undefined);
  } finally {
    await client.end();
  }
  expect(observed, `${role}: ${operation}`).toBe(expected);
  if (expected === "DENY") expect(sqlstate, `${role}: ${operation} SQLSTATE`).toBe("42501");
};

/** Disposable probe objects owned by the owner role, with grants only where a runtime should have them. */
const setupPrivilegeScaffolding = async (): Promise<void> => {
  await queryAsOwner(`
    CREATE TABLE "trip_ops"."roles_workspace_privilege_probe" (
      probe_id text PRIMARY KEY,
      marker text NOT NULL
    );
    CREATE TABLE "job_runtime"."roles_worker_privilege_probe" (
      probe_id text PRIMARY KEY,
      marker text NOT NULL
    );
    CREATE TABLE "trip_ops"."roles_transaction_probe" (
      probe_id text PRIMARY KEY,
      marker text NOT NULL
    );
    CREATE TABLE "trip_ops"."roles_ungranted_default_privilege_probe" (
      probe_id text PRIMARY KEY
    );
    CREATE FUNCTION "trip_ops"."roles_ungranted_function"()
      RETURNS integer
      LANGUAGE sql
      IMMUTABLE
      AS 'SELECT 7';
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE "trip_ops"."roles_workspace_privilege_probe"
      TO "travelos_admin_runtime";
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE "job_runtime"."roles_worker_privilege_probe"
      TO "travelos_worker_runtime";
    GRANT SELECT, INSERT
      ON TABLE "trip_ops"."roles_transaction_probe"
      TO "travelos_admin_runtime";
  `);
};

beforeAll(async () => {
  requireHarness();
  expect(postgresBin.startsWith(workRoot) || workRoot.length > 0).toBe(true);
  expect(repositoryRoot.length).toBeGreaterThan(0);
});

const runDefaultPrivilegeProbes = async (): Promise<void> => {
  const creators = await queryAsOwner(`SELECT session_user, current_user`);
  expect(creators).toEqual([{ session_user: "travelos_migrator", current_user: "travelos_owner" }]);
  for (const { role, schema, group } of runtimeSurfaces) {
    // No GRANT on these objects: the runtime has schema USAGE, so denial proves
    // the object's default ACL, not a missing schema permission.
    await queryAsOwner(`
      CREATE FUNCTION ${schema}.roles_default_function_probe() RETURNS integer LANGUAGE sql AS 'SELECT 7';
      CREATE TABLE ${schema}.roles_default_table_probe (id integer);
      CREATE SEQUENCE ${schema}.roles_default_sequence_probe;
      CREATE TYPE ${schema}.roles_default_type_probe AS ENUM ('synthetic');
    `);
    const deny = async (operation: string, sql: string) =>
      attemptPrivilege({ role, operation, sql, expected: "DENY" });
    await attemptPrivilege({
      role,
      operation: "CONNECT runtime identity",
      sql: "SELECT current_user",
      expected: "ALLOW",
    });
    await deny(
      "EXECUTE new function in USAGE-authorized schema",
      `SELECT ${schema}.roles_default_function_probe()`,
    );
    await deny(
      "SELECT new table without object grant",
      `SELECT * FROM ${schema}.roles_default_table_probe`,
    );
    await deny(
      "INSERT new table without object grant",
      `INSERT INTO ${schema}.roles_default_table_probe VALUES (1)`,
    );
    await deny(
      "UPDATE new table without object grant",
      `UPDATE ${schema}.roles_default_table_probe SET id = 1`,
    );
    await deny(
      "DELETE new table without object grant",
      `DELETE FROM ${schema}.roles_default_table_probe`,
    );
    await deny(
      "sequence nextval without object grant",
      `SELECT nextval('${schema}.roles_default_sequence_probe')`,
    );
    await deny(
      "sequence setval without object grant",
      `SELECT setval('${schema}.roles_default_sequence_probe', 2)`,
    );
    await deny(
      "CREATE FUNCTION",
      `CREATE FUNCTION ${schema}.roles_create_denied() RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
    );
    await deny(
      "ALTER FUNCTION",
      `ALTER FUNCTION ${schema}.roles_default_function_probe() RENAME TO roles_renamed`,
    );
    await deny("DROP FUNCTION", `DROP FUNCTION ${schema}.roles_default_function_probe()`);
    await deny("CREATE public TABLE", "CREATE TABLE public.roles_public_denied (id integer)");
    await deny(
      "CREATE public FUNCTION",
      "CREATE FUNCTION public.roles_public_denied() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
    );
    await deny("ALTER SCHEMA", `ALTER SCHEMA ${schema} RENAME TO roles_schema_denied`);
    await deny("DROP SCHEMA", `DROP SCHEMA ${schema} CASCADE`);
    await deny("TRUNCATE object", `TRUNCATE ${schema}.roles_default_table_probe`);
    await deny(
      "GRANT object escalation",
      `GRANT SELECT ON ${schema}.roles_default_table_probe TO ${role}`,
    );
    await deny("GRANT owner membership escalation", `GRANT travelos_owner TO ${role}`);
    await deny("SET SESSION AUTHORIZATION escalation", "SET SESSION AUTHORIZATION travelos_owner");
    for (const attribute of ["SUPERUSER", "CREATEDB", "CREATEROLE", "REPLICATION", "BYPASSRLS"]) {
      await deny(`ALTER ROLE self ${attribute}`, `ALTER ROLE ${role} ${attribute}`);
    }
    await deny("ALTER another role", "ALTER ROLE travelos_migrator CREATEDB");
    for (const target of [
      "travelos_owner",
      "travelos_migrator",
      "travelos_admin_api",
      "travelos_worker",
      "travelos_admin_runtime",
      "travelos_worker_runtime",
      "pg_read_all_data",
      "pg_write_all_data",
    ].filter((target) => target !== role)) {
      await deny(`SET ROLE ${target}`, `SET ROLE ${target}`);
    }
    await deny(
      "unsafe search_path public shadow table",
      "SET LOCAL search_path TO public, pg_catalog; CREATE TABLE roles_shadow (id integer)",
    );
    await deny(
      "unsafe search_path application shadow function",
      `SET LOCAL search_path TO ${schema}, public, pg_catalog; CREATE FUNCTION roles_shadow() RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
    );
    await deny(
      "unsafe search_path workspace access",
      "SET LOCAL search_path TO trip_ops, presentation, public, pg_catalog; SELECT * FROM trip_ops.roles_default_table_probe",
    );
    await attemptPrivilege({
      role,
      operation: "catalog resolution with hostile search_path",
      sql: "SET LOCAL search_path TO public, pg_catalog; SELECT length('synthetic')",
      expected: "ALLOW",
    });

    // A temporary explicit grant must work, then be revocable. Never retained in
    // the production chain or restore source as a speculative runtime privilege.
    await queryAsOwner(
      `GRANT EXECUTE ON FUNCTION ${schema}.roles_default_function_probe() TO ${group}`,
    );
    try {
      expect(
        await queryAs(role, `SELECT ${schema}.roles_default_function_probe() AS marker`),
      ).toEqual([{ marker: 7 }]);
      await attemptPrivilege({
        role,
        operation: "EXECUTE only after explicit test grant",
        sql: `SELECT ${schema}.roles_default_function_probe()`,
        expected: "ALLOW",
      });
    } finally {
      await queryAsOwner(
        `REVOKE EXECUTE ON FUNCTION ${schema}.roles_default_function_probe() FROM ${group}`,
      );
    }
    await deny(
      "EXECUTE after explicit test grant revoked",
      `SELECT ${schema}.roles_default_function_probe()`,
    );
  }

  const publicDatabaseAcl = await queryAs(
    "postgres",
    `
    SELECT a.privilege_type FROM pg_catalog.pg_database d,
      LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
    WHERE d.datname = current_database() AND a.grantee = 0
  `,
  );
  expect(publicDatabaseAcl).toEqual([]);
  await queryAs(
    "postgres",
    "CREATE ROLE roles_public_probe LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT",
  );
  try {
    await expect(queryAs("roles_public_probe", "SELECT 1")).rejects.toMatchObject({
      code: "42501",
    });
    // CONNECT is granted only to isolate the remaining PUBLIC privileges.
    await queryAs("postgres", `GRANT CONNECT ON DATABASE ${primaryDatabase} TO roles_public_probe`);
    for (const [operation, sql] of [
      ["PUBLIC CREATE SCHEMA", "CREATE SCHEMA roles_public_schema_denied"],
      ["PUBLIC TEMP", "CREATE TEMP TABLE roles_public_temp_denied (id integer)"],
      ["PUBLIC public CREATE", "CREATE TABLE public.roles_public_denied (id integer)"],
      ["PUBLIC application USAGE", "SELECT * FROM trip_ops.roles_workspace_privilege_probe"],
    ]) {
      await attemptPrivilege({
        role: "roles_public_probe",
        operation: operation!,
        sql: sql!,
        expected: "DENY",
      });
    }
  } finally {
    await queryAs(
      "postgres",
      `REVOKE CONNECT ON DATABASE ${primaryDatabase} FROM roles_public_probe; DROP ROLE roles_public_probe`,
    );
  }

  const schemaPrivileges = await queryAs<{
    role_name: string;
    schema_name: string;
    can_use: boolean;
    can_create: boolean;
  }>(
    "postgres",
    `
    SELECT r.rolname AS role_name, n.nspname AS schema_name,
      has_schema_privilege(r.oid, n.oid, 'USAGE') AS can_use,
      has_schema_privilege(r.oid, n.oid, 'CREATE') AS can_create
    FROM pg_catalog.pg_roles r CROSS JOIN pg_catalog.pg_namespace n
    WHERE r.rolname IN ('travelos_admin_api', 'travelos_worker', 'travelos_migrator')
      AND (n.nspowner = 'travelos_owner'::regrole OR n.nspname = 'public')
    ORDER BY r.rolname, n.nspname
  `,
  );
  const usageByRole: Readonly<Record<string, readonly string[]>> = {
    travelos_admin_api: [
      "activity",
      "audit",
      "crm",
      "finance",
      "integration",
      "organization",
      "presentation",
      "sales",
      "staff_access",
      "trip_ops",
    ],
    travelos_worker: ["integration", "job_runtime"],
    travelos_migrator: [],
  };
  for (const privilege of schemaPrivileges) {
    expect(privilege.can_create).toBe(false);
    expect(privilege.can_use).toBe(
      usageByRole[privilege.role_name]?.includes(privilege.schema_name),
    );
    await attemptPrivilege({
      role: privilege.role_name,
      operation: `CREATE in schema ${privilege.schema_name}`,
      sql: `CREATE TABLE ${privilege.schema_name}.roles_create_probe (id integer)`,
      expected: "DENY",
    });
  }
  const defaultPublicGrants = await queryAs(
    "postgres",
    `
    SELECT d.defaclobjtype FROM pg_catalog.pg_default_acl d,
      LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole = 'travelos_owner'::regrole AND a.grantee = 0
  `,
  );
  expect(defaultPublicGrants).toEqual([]);
  const typePrivileges = await queryAs<{ role_name: string; can_use: boolean }>(
    "postgres",
    `
    SELECT r.rolname AS role_name, has_type_privilege(r.oid, t.oid, 'USAGE') AS can_use
    FROM pg_catalog.pg_roles r CROSS JOIN pg_catalog.pg_type t
    WHERE r.rolname IN ('travelos_admin_api', 'travelos_worker')
      AND t.typname = 'roles_default_type_probe'
  `,
  );
  expect(typePrivileges).toHaveLength(4);
  expect(typePrivileges.every((row) => !row.can_use)).toBe(true);
  const functions = await queryAs(
    "postgres",
    `
    SELECT n.nspname AS schema_name, p.proname, pg_get_userbyid(p.proowner) AS owner, p.proacl::text AS acl
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname LIKE 'roles_%' ORDER BY n.nspname, p.proname
  `,
  );
  expect(functions.every((row) => row["owner"] === "travelos_owner")).toBe(true);

  for (const sql of [
    "CREATE SCHEMA roles_migrator_denied",
    "CREATE TEMP TABLE roles_migrator_temp (id integer)",
    "CREATE ROLE roles_migrator_role",
    "ALTER ROLE travelos_migrator SUPERUSER",
    "ALTER ROLE travelos_migrator CREATEDB",
    "ALTER ROLE travelos_migrator CREATEROLE",
    "ALTER ROLE travelos_migrator REPLICATION",
    "ALTER ROLE travelos_migrator BYPASSRLS",
  ]) {
    await attemptPrivilege({
      role: "travelos_migrator",
      operation: `unassumed migrator: ${sql}`,
      sql,
      expected: "DENY",
    });
  }
  await attemptPrivilege({
    role: "travelos_migrator",
    operation: "explicit owner delegation enables required DDL",
    sql: "SET LOCAL ROLE travelos_owner; CREATE SCHEMA roles_owner_ddl; CREATE TABLE roles_owner_ddl.marker (id integer)",
    expected: "ALLOW",
  });
  await expect(queryAs("travelos_owner", "SELECT 1")).rejects.toMatchObject({ code: "28000" });
};

describe.sequential("PostgreSQL roles, privileges and migration authority", () => {
  it("bootstraps an empty cluster and migrates the real chain from zero, verified and rerun as a no-op", async () => {
    const firstBootstrap = bootstrapDatabaseRoles(primaryDatabase);
    expect(firstBootstrap.exitCode, firstBootstrap.stderr).toBe(0);
    const secondBootstrap = bootstrapDatabaseRoles(primaryDatabase);
    expect(secondBootstrap.exitCode, secondBootstrap.stderr).toBe(0);

    const server = await queryAs<{
      server_version_num: string;
      data_checksums: string;
      listen_addresses: string;
    }>(
      "postgres",
      `SELECT current_setting('server_version_num') AS server_version_num,
              current_setting('data_checksums') AS data_checksums,
              current_setting('listen_addresses') AS listen_addresses`,
    );
    expect(server[0]?.server_version_num).toBe("180006");
    expect(server[0]?.data_checksums).toBe("on");
    expect(server[0]?.listen_addresses).toBe("127.0.0.1");

    const names = await productionMigrationNames();
    expect(names).toEqual(["0001_baseline", "0002_drop_publication_outbox", "0003_crm_details"]);
    const initialStatus = await inspectMigrationStatus(targetFor(primaryDatabase), productionChain);
    expect(initialStatus.ledger).toEqual([]);
    const migrated = await migrateToHead(primaryDatabase, agency);
    expect(migrated.appliedMigrations).toEqual(names);
    expect(migrated.currentVersion).toBe(names.at(-1));
    const rerun = await runMigrationChain(targetFor(primaryDatabase), productionChain);
    expect(rerun.result).toBe("PASS");
    expect(rerun.appliedMigrations).toEqual([]);
    expect(rerun.ledger.map(({ name }) => name)).toEqual(names);
    expect(rerun.currentVersion).toBe(names.at(-1));
    const status = await inspectMigrationStatus(targetFor(primaryDatabase), productionChain);
    expect(status.currentVersion).toBe(names.at(-1));
  });

  it("applies the squashed baseline, its 0002 follow-up and 0003 CRM details without any Agency; a rerun is a no-op; exactly these migration files exist", async () => {
    const files = (await readdir(productionChain.directory)).toSorted();
    expect(files).toEqual([
      "0001_baseline.cjs",
      "0002_drop_publication_outbox.cjs",
      "0003_crm_details.cjs",
      "checksums.json",
    ]);
    expect((await readChainManifest()).migrations.map(({ file }) => file)).toEqual([
      "0001_baseline.cjs",
      "0002_drop_publication_outbox.cjs",
      "0003_crm_details.cjs",
    ]);

    await createDatabase(baselineDatabase);
    const first = await runMigrationChain(targetFor(baselineDatabase), productionChain);
    expect(first.appliedMigrations).toEqual([
      "0001_baseline",
      "0002_drop_publication_outbox",
      "0003_crm_details",
    ]);
    expect(first.ledger.map(({ name }) => name)).toEqual([
      "0001_baseline",
      "0002_drop_publication_outbox",
      "0003_crm_details",
    ]);
    // One pass, no root Agency needed: nothing seeds an Agency, role or Staff row.
    const counts = await queryAs<{ agencies: string; roles: string; currencies: string }>(
      "postgres",
      `SELECT (SELECT count(*) FROM organization.agency)::text AS agencies,
              (SELECT count(*) FROM staff_access.role)::text AS roles,
              (SELECT count(*) FROM finance.currency_registry)::text AS currencies`,
      baselineDatabase,
    );
    expect(counts).toEqual([{ agencies: "0", roles: "0", currencies: "4" }]);
    const rerun = await runMigrationChain(targetFor(baselineDatabase), productionChain);
    expect(rerun.appliedMigrations).toEqual([]);
    expect(rerun.currentVersion).toBe("0003_crm_details");
  });

  it("fails verification and applies nothing when the baseline is tampered with", async () => {
    const manifest = await readChainManifest();
    const directory = path.join(workRoot, "tampered-baseline-chain");
    await mkdir(directory, { recursive: true });
    const original = await readFile(
      path.join(productionChain.directory, "0001_baseline.cjs"),
      "utf8",
    );
    await writeFile(path.join(directory, "0001_baseline.cjs"), `${original}\n// tampered\n`);
    await copyFile(
      path.join(productionChain.directory, "0002_drop_publication_outbox.cjs"),
      path.join(directory, "0002_drop_publication_outbox.cjs"),
    );
    await copyFile(
      path.join(productionChain.directory, "0003_crm_details.cjs"),
      path.join(directory, "0003_crm_details.cjs"),
    );
    const checksumManifestPath = path.join(directory, "checksums.json");
    await writeFile(checksumManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const tampered: MigrationChain = { directory, checksumManifestPath };

    await expect(verifyMigrationChain(tampered)).rejects.toThrow(
      /Migration checksum mismatch for 0001_baseline\.cjs/,
    );
    await createDatabase(tamperedDatabase);
    await expect(runMigrationChain(targetFor(tamperedDatabase), tampered)).rejects.toThrow(
      /checksum mismatch/,
    );
    const schemas = await queryAs<{ nspname: string }>(
      "postgres",
      `SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname = 'trip_ops'`,
      tamperedDatabase,
    );
    expect(schemas).toEqual([]);
    // The untouched baseline still verifies.
    await expect(verifyMigrationChain(productionChain)).resolves.toEqual(
      expect.objectContaining({ result: "PASS" }),
    );
  });

  it("establishes deliberate schema ownership and role membership topology", async () => {
    const bootstrapSql = await readFile(
      path.join(repositoryRoot, "deploy/database/bootstrap-database-and-roles.sql"),
      "utf8",
    );
    expect(extractBootstrapRoleMemberships(bootstrapSql)).toEqual(EXPECTED_ROLE_MEMBERSHIPS);

    const expectedSchemas = [
      "activity",
      "audit",
      "communications",
      "crm",
      "documents",
      "finance",
      "integration",
      "job_runtime",
      "organization",
      "presentation",
      "sales",
      "staff_access",
      "travelos_meta",
      "trip_ops",
      "work_service",
    ];
    const schemas = await queryAs<{
      schema_name: string;
      owner_name: string;
    }>(
      "postgres",
      `SELECT namespace.nspname AS schema_name,
              pg_get_userbyid(namespace.nspowner) AS owner_name
         FROM pg_catalog.pg_namespace AS namespace
        WHERE namespace.nspname = ANY (ARRAY[${expectedSchemas
          .map((schema) => `'${schema}'`)
          .join(", ")}])
        ORDER BY namespace.nspname`,
    );
    expect(schemas.map(({ schema_name }) => schema_name)).toEqual(expectedSchemas);
    expect(new Set(schemas.map(({ owner_name }) => owner_name))).toEqual(
      new Set(["travelos_owner"]),
    );

    const roles = await queryAs<{
      rolname: string;
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
    }>(
      "postgres",
      `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
              rolinherit, rolreplication, rolbypassrls
         FROM pg_catalog.pg_roles
        WHERE rolname LIKE 'travelos_%'
        ORDER BY rolname`,
    );
    expect(roles).toHaveLength(6);
    for (const role of roles) {
      expect(role.rolsuper).toBe(false);
      expect(role.rolcreatedb).toBe(false);
      expect(role.rolcreaterole).toBe(false);
      expect(role.rolreplication).toBe(false);
      expect(role.rolbypassrls).toBe(false);
      expect(role.rolinherit).toBe(
        ["travelos_admin_api", "travelos_worker"].includes(role.rolname),
      );
    }
    expect(roles.find(({ rolname }) => rolname === "travelos_owner")?.rolcanlogin).toBe(false);
    expect(roles.find(({ rolname }) => rolname === "travelos_admin_runtime")?.rolcanlogin).toBe(
      false,
    );
    expect(roles.find(({ rolname }) => rolname === "travelos_worker_runtime")?.rolcanlogin).toBe(
      false,
    );
    expect(roles.find(({ rolname }) => rolname === "travelos_worker_runtime")?.rolcanlogin).toBe(
      false,
    );

    const memberships = await queryRoleMemberships();
    assertExactRoleMembershipGraph(memberships);
    expect(memberships).toEqual(EXPECTED_ROLE_MEMBERSHIPS);

    const fixtureRoles = [
      "roles_external_owner_member",
      "roles_external_runtime_member",
      "roles_unrelated_member",
      "roles_unrelated_group",
    ] as const;
    await queryAs(
      "postgres",
      fixtureRoles.map((roleName) => `CREATE ROLE "${roleName}" NOLOGIN`).join("; "),
      "postgres",
    );
    try {
      await queryAs(
        "postgres",
        'GRANT "travelos_owner" TO "roles_external_owner_member" WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
        "postgres",
      );
      const externalOwnerGraph = await queryRoleMemberships();
      expect(verifyRoleMembershipGraph(externalOwnerGraph)).toEqual(
        expect.objectContaining({ result: "FAIL", actualCount: 4 }),
      );
      expect(() => assertExactRoleMembershipGraph(externalOwnerGraph)).toThrow(
        /roles_external_owner_member->travelos_owner/,
      );
      const externalOwnerBootstrap = bootstrapDatabaseRoles(primaryDatabase);
      expect(externalOwnerBootstrap.exitCode).not.toBe(0);
      expect(externalOwnerBootstrap.stderr).toMatch(/role membership graph mismatch/i);
      await queryAs(
        "postgres",
        'REVOKE "travelos_owner" FROM "roles_external_owner_member"',
        "postgres",
      );

      await queryAs(
        "postgres",
        'GRANT "travelos_worker_runtime" TO "roles_external_runtime_member" WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
        "postgres",
      );
      const externalRuntimeGraph = await queryRoleMemberships();
      expect(verifyRoleMembershipGraph(externalRuntimeGraph)).toEqual(
        expect.objectContaining({ result: "FAIL", actualCount: 4 }),
      );
      expect(() => assertExactRoleMembershipGraph(externalRuntimeGraph)).toThrow(
        /roles_external_runtime_member->travelos_worker_runtime/,
      );
      const externalRuntimeBootstrap = bootstrapDatabaseRoles(primaryDatabase);
      expect(externalRuntimeBootstrap.exitCode).not.toBe(0);
      expect(externalRuntimeBootstrap.stderr).toMatch(/role membership graph mismatch/i);
      await queryAs(
        "postgres",
        'REVOKE "travelos_worker_runtime" FROM "roles_external_runtime_member"',
        "postgres",
      );

      await queryAs(
        "postgres",
        'GRANT "roles_unrelated_group" TO "roles_unrelated_member" WITH ADMIN FALSE, INHERIT TRUE, SET FALSE',
        "postgres",
      );
      const graphWithUnrelatedEdge = await queryRoleMemberships();
      expect(assertExactRoleMembershipGraph(graphWithUnrelatedEdge).result).toBe("PASS");
      const unrelatedBootstrap = bootstrapDatabaseRoles(primaryDatabase);
      expect(unrelatedBootstrap.exitCode, unrelatedBootstrap.stderr).toBe(0);
    } finally {
      await queryAs(
        "postgres",
        `REVOKE "travelos_owner" FROM "roles_external_owner_member";
         REVOKE "travelos_worker_runtime" FROM "roles_external_runtime_member";
         REVOKE "roles_unrelated_group" FROM "roles_unrelated_member";
         DROP ROLE ${fixtureRoles.map((roleName) => `"${roleName}"`).join(", ")}`,
        "postgres",
      );
    }
    expect(await queryRoleMemberships()).toEqual(EXPECTED_ROLE_MEMBERSHIPS);

    const databasePrivileges = await queryAs<{
      role_name: string;
      can_connect: boolean;
      can_create_temp: boolean;
      can_create_public: boolean;
    }>(
      "postgres",
      `SELECT role_name,
              has_database_privilege(role_name, current_database(), 'CONNECT') AS can_connect,
              has_database_privilege(role_name, current_database(), 'TEMP') AS can_create_temp,
              has_schema_privilege(role_name, 'public', 'CREATE') AS can_create_public
         FROM unnest(ARRAY['travelos_admin_api', 'travelos_worker']) AS role_name
        ORDER BY role_name`,
    );
    expect(databasePrivileges.every(({ can_connect }) => can_connect)).toBe(true);
    expect(databasePrivileges.some(({ can_create_temp }) => can_create_temp)).toBe(false);
    expect(databasePrivileges.some(({ can_create_public }) => can_create_public)).toBe(false);
  });

  it("proves the executable runtime privilege matrix for the Admin and Worker runtimes", async () => {
    await setupPrivilegeScaffolding();

    const adminAllows = [
      {
        operation: "SELECT intended workspace surface",
        sql: `SELECT * FROM "trip_ops"."roles_workspace_privilege_probe"`,
      },
      {
        operation: "INSERT intended workspace surface",
        sql: `INSERT INTO "trip_ops"."roles_workspace_privilege_probe" VALUES ('admin-i', 'allowed')`,
      },
      {
        operation: "UPDATE intended workspace surface",
        sql: `UPDATE "trip_ops"."roles_workspace_privilege_probe" SET marker = 'allowed'`,
      },
      {
        operation: "DELETE intended workspace surface",
        sql: `DELETE FROM "trip_ops"."roles_workspace_privilege_probe"`,
      },
    ];
    const adminDenials = [
      {
        operation: "CREATE TABLE",
        sql: `CREATE TABLE "trip_ops"."roles_admin_create_denied" (id integer)`,
      },
      {
        operation: "ALTER object",
        sql: `ALTER TABLE "trip_ops"."roles_workspace_privilege_probe" ADD COLUMN denied integer`,
      },
      {
        operation: "DROP object",
        sql: `DROP TABLE "trip_ops"."roles_workspace_privilege_probe"`,
      },
      { operation: "CREATE schema", sql: `CREATE SCHEMA "roles_admin_schema_denied"` },
      { operation: "SET ROLE owner", sql: `SET ROLE "travelos_owner"` },
      { operation: "SET ROLE migrator", sql: `SET ROLE "travelos_migrator"` },
      { operation: "CREATE role", sql: `CREATE ROLE "roles_admin_role_denied"` },
      {
        operation: "CREATE temporary table",
        sql: `CREATE TEMP TABLE roles_admin_temp_denied (id integer)`,
      },
      {
        operation: "SELECT worker-only surface",
        sql: `SELECT * FROM "job_runtime"."roles_worker_privilege_probe"`,
      },
      {
        operation: "EXECUTE default-ungranted function",
        sql: `SELECT "trip_ops"."roles_ungranted_function"()`,
      },
      {
        operation: "SELECT default-ungranted owner object",
        sql: `SELECT * FROM "trip_ops"."roles_ungranted_default_privilege_probe"`,
      },
    ];
    for (const attempt of adminAllows) {
      await attemptPrivilege({ role: "travelos_admin_api", expected: "ALLOW", ...attempt });
    }
    for (const attempt of adminDenials) {
      await attemptPrivilege({ role: "travelos_admin_api", expected: "DENY", ...attempt });
    }

    const workerAllows = [
      {
        operation: "SELECT explicit worker foundation surface",
        sql: `SELECT * FROM "job_runtime"."roles_worker_privilege_probe"`,
      },
      {
        operation: "INSERT explicit worker foundation surface",
        sql: `INSERT INTO "job_runtime"."roles_worker_privilege_probe" VALUES ('worker-i', 'allowed')`,
      },
      {
        operation: "UPDATE explicit worker foundation surface",
        sql: `UPDATE "job_runtime"."roles_worker_privilege_probe" SET marker = 'allowed'`,
      },
      {
        operation: "DELETE explicit worker foundation surface",
        sql: `DELETE FROM "job_runtime"."roles_worker_privilege_probe"`,
      },
    ];
    const workerDenials = [
      {
        operation: "SELECT mutable workspace object",
        sql: `SELECT * FROM "trip_ops"."roles_workspace_privilege_probe"`,
      },
      {
        operation: "CREATE TABLE",
        sql: `CREATE TABLE "job_runtime"."roles_worker_create_denied" (id integer)`,
      },
      {
        operation: "ALTER object",
        sql: `ALTER TABLE "job_runtime"."roles_worker_privilege_probe" ADD COLUMN denied integer`,
      },
      {
        operation: "DROP object",
        sql: `DROP TABLE "job_runtime"."roles_worker_privilege_probe"`,
      },
      { operation: "CREATE schema", sql: `CREATE SCHEMA "roles_worker_schema_denied"` },
      { operation: "SET ROLE owner", sql: `SET ROLE "travelos_owner"` },
      { operation: "SET ROLE migrator", sql: `SET ROLE "travelos_migrator"` },
      { operation: "CREATE role", sql: `CREATE ROLE "roles_worker_role_denied"` },
      {
        operation: "CREATE temporary table",
        sql: `CREATE TEMP TABLE roles_worker_temp_denied (id integer)`,
      },
      {
        operation: "SELECT INTERNAL_ONLY supplier cost lines",
        sql: `SELECT * FROM "finance"."supplier_cost_line"`,
      },
    ];
    for (const attempt of workerAllows) {
      await attemptPrivilege({ role: "travelos_worker", expected: "ALLOW", ...attempt });
    }
    for (const attempt of workerDenials) {
      await attemptPrivilege({ role: "travelos_worker", expected: "DENY", ...attempt });
    }

    await runDefaultPrivilegeProbes();

    const searchPaths = await Promise.all(
      ["travelos_admin_api", "travelos_worker"].map(async (role) => ({
        role,
        searchPath: (await queryAs<{ search_path: string }>(role, "SHOW search_path"))[0]
          ?.search_path,
      })),
    );
    expect(searchPaths.every(({ searchPath }) => searchPath === "pg_catalog")).toBe(true);

    const objectOwners = await queryAs<{ object_name: string; owner_name: string }>(
      "postgres",
      `SELECT schemaname || '.' || tablename AS object_name, tableowner AS owner_name
         FROM pg_catalog.pg_tables
        WHERE tablename LIKE 'roles_%_probe'
        ORDER BY schemaname, tablename`,
    );
    expect(objectOwners.length).toBeGreaterThanOrEqual(4);
    expect(new Set(objectOwners.map(({ owner_name }) => owner_name))).toEqual(
      new Set(["travelos_owner"]),
    );
  });

  it("denies the runtimes DELETE and TRUNCATE on history tables and keeps Audit append-only", async () => {
    const history = await queryAs<{ schema_name: string; table_name: string }>(
      "postgres",
      `SELECT namespace.nspname AS schema_name, relation.relname AS table_name
         FROM pg_catalog.pg_class AS relation
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE relation.relkind IN ('r', 'p')
          AND namespace.nspname IN ('audit', 'activity')
        ORDER BY namespace.nspname, relation.relname`,
    );
    expect(history.some(({ schema_name }) => schema_name === "audit")).toBe(true);
    for (const { schema_name, table_name } of history) {
      const qualified = `${schema_name}.${table_name}`;
      for (const role of ["travelos_admin_api", "travelos_worker"]) {
        const row = (
          await queryAs<Record<string, boolean>>(
            "postgres",
            `SELECT has_table_privilege('${role}', '${qualified}', 'UPDATE') AS can_update,
                    has_table_privilege('${role}', '${qualified}', 'DELETE') AS can_delete,
                    has_table_privilege('${role}', '${qualified}', 'TRUNCATE') AS can_truncate`,
          )
        )[0];
        expect(row, `${role} ${qualified}`).toEqual({
          can_update: false,
          can_delete: false,
          can_truncate: false,
        });
      }
    }
    // Audit stays append-only even for the Admin runtime that writes it: INSERT yes, rewrite no.
    const auditTables = history.filter(({ schema_name }) => schema_name === "audit");
    for (const { table_name } of auditTables) {
      const row = (
        await queryAs<{ can_insert: boolean }>(
          "postgres",
          `SELECT has_table_privilege('travelos_worker', 'audit.${table_name}', 'INSERT') AS can_insert`,
        )
      )[0];
      expect(row?.can_insert, `worker audit.${table_name}`).toBe(false);
    }
  });

  it("has no retired customer-access schema, tables, permissions or roles after the baseline", async () => {
    // Exact sets, so any retired schema or role (including customer-facing identity realms) fails.
    const schemas = await queryAs<{ nspname: string }>(
      "postgres",
      `SELECT nspname FROM pg_catalog.pg_namespace
        WHERE nspowner = 'travelos_owner'::regrole ORDER BY nspname`,
    );
    expect(schemas.map(({ nspname }) => nspname)).toEqual([
      "activity",
      "audit",
      "communications",
      "crm",
      "documents",
      "finance",
      "integration",
      "job_runtime",
      "organization",
      "presentation",
      "sales",
      "staff_access",
      "travelos_meta",
      "trip_ops",
      "work_service",
    ]);
    const roles = await queryAs<{ rolname: string }>(
      "postgres",
      `SELECT rolname FROM pg_catalog.pg_roles WHERE rolname LIKE 'travelos\\_%' ORDER BY rolname`,
    );
    expect(roles.map(({ rolname }) => rolname)).toEqual([
      "travelos_admin_api",
      "travelos_admin_runtime",
      "travelos_migrator",
      "travelos_owner",
      "travelos_worker",
      "travelos_worker_runtime",
    ]);
    const retiredRelations = await queryAs<{ relation: string }>(
      "postgres",
      `SELECT n.nspname || '.' || c.relname AS relation
         FROM pg_catalog.pg_class AS c
         JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p', 'v', 'm')
          AND n.nspowner = 'travelos_owner'::regrole
          AND (c.relname LIKE '%trip_access%'
               OR c.relname LIKE '%runtime_acceptance%' OR c.relname LIKE '%trip_cancellation%'
               OR c.relname LIKE '%publication_withdrawal%' OR c.relname LIKE '%publication_pointer%'
               OR c.relname LIKE '%publication_idempotency%' OR c.relname = 'trip_publication_event')
        ORDER BY 1`,
    );
    expect(retiredRelations).toEqual([]);
    const droppedPublicationRelations = await queryAs<{ relation: string | null }>(
      "postgres",
      `SELECT to_regclass('trip_ops.publication_event')::text AS relation
       UNION ALL SELECT to_regclass('integration.trip_publication_outbox')::text
       UNION ALL SELECT to_regclass('integration.activity_source')::text`,
    );
    expect(droppedPublicationRelations).toEqual([
      { relation: null },
      { relation: null },
      { relation: null },
    ]);
    const retiredPermissions = await queryAs<{ count: string }>(
      "postgres",
      `SELECT count(*)::text AS count FROM staff_access.role_permission
        WHERE "permissionId" IN ('trip.access.manage', 'runtime_acceptance.fixture.manage', 'trip.withdraw_publication')`,
    );
    expect(retiredPermissions).toEqual([{ count: "0" }]);
  });

  it("keeps PUBLIC free of ACLs on every application schema, relation and function", async () => {
    const applicationSchemas = await queryAs<{ nspname: string }>(
      "postgres",
      `SELECT nspname FROM pg_catalog.pg_namespace WHERE nspowner = 'travelos_owner'::regrole ORDER BY nspname`,
    );
    expect(applicationSchemas.length).toBeGreaterThan(0);
    const publicAcl = await queryAs<{ object: string }>(
      "postgres",
      `SELECT 'schema ' || n.nspname AS object
         FROM pg_catalog.pg_namespace AS n, LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) AS a
        WHERE n.nspowner = 'travelos_owner'::regrole AND a.grantee = 0
       UNION ALL
       SELECT 'relation ' || n.nspname || '.' || c.relname
         FROM pg_catalog.pg_class AS c
         JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace,
         LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS a
        WHERE n.nspowner = 'travelos_owner'::regrole AND c.relkind IN ('r', 'p', 'v', 'm', 'S') AND a.grantee = 0
       UNION ALL
       SELECT 'function ' || n.nspname || '.' || p.proname
         FROM pg_catalog.pg_proc AS p
         JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace,
         LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
        WHERE n.nspowner = 'travelos_owner'::regrole AND a.grantee = 0`,
    );
    expect(publicAcl).toEqual([]);
  });

  it("has no floating-point columns in any application schema", async () => {
    const floatColumns = await queryAsOwner<{
      readonly column: string;
      readonly dataType: string;
    }>(`
      SELECT namespace.nspname || '.' || relation.relname || '.' || attribute.attname AS "column",
             format_type(attribute.atttypid, attribute.atttypmod) AS "dataType"
        FROM pg_catalog.pg_attribute AS attribute
        JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspowner = 'travelos_owner'::regrole
         AND relation.relkind IN ('r', 'p')
         AND attribute.attnum > 0 AND NOT attribute.attisdropped
         AND format_type(attribute.atttypid, attribute.atttypmod) IN ('real', 'double precision')
    `);
    expect(floatColumns).toEqual([]);
  });

  it("commits, rolls back, releases the pool connection, and rejects nesting explicitly", async () => {
    interface TransactionProbeDatabase {
      "trip_ops.roles_transaction_probe": {
        probe_id: string;
        marker: string;
      };
    }
    const persistence = createPostgresPersistence<TransactionProbeDatabase>({
      host,
      port,
      database: primaryDatabase,
      user: "travelos_admin_api",
      tls: { mode: "DISABLED_LOOPBACK_ONLY" },
      applicationName: "travelos-roles-transaction-test",
      maxConnections: 1,
    });

    await persistence.transaction.runInTransaction(async (context: TransactionContext) =>
      persistence.withTransactionContext(context, async (database) => {
        await database
          .insertInto("trip_ops.roles_transaction_probe")
          .values({ probe_id: "commit-1", marker: "committed" })
          .execute();
      }),
    );
    const committed = await persistence.withConnection((database) =>
      database
        .selectFrom("trip_ops.roles_transaction_probe")
        .selectAll()
        .where("probe_id", "=", "commit-1")
        .executeTakeFirst(),
    );
    expect(committed?.marker).toBe("committed");

    const deliberate = new Error("deliberate transaction rollback probe");
    await expect(
      persistence.transaction.runInTransaction(async (context: TransactionContext) =>
        persistence.withTransactionContext(context, async (database) => {
          await database
            .insertInto("trip_ops.roles_transaction_probe")
            .values({ probe_id: "rollback-1", marker: "must-not-persist" })
            .execute();
          throw deliberate;
        }),
      ),
    ).rejects.toBe(deliberate);
    const rolledBack = await persistence.withConnection((database) =>
      database
        .selectFrom("trip_ops.roles_transaction_probe")
        .selectAll()
        .where("probe_id", "=", "rollback-1")
        .executeTakeFirst(),
    );
    expect(rolledBack).toBeUndefined();

    await expect(
      persistence.transaction.runInTransaction(async () =>
        persistence.transaction.runInTransaction(async () => undefined),
      ),
    ).rejects.toBeInstanceOf(NestedTransactionNotSupportedError);

    const postRollbackProbe = await persistence.withConnection((database) =>
      database
        .selectFrom("trip_ops.roles_transaction_probe")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
    );
    expect(Number(postRollbackProbe.count)).toBe(1);
    expect(persistence.poolMetrics()).toEqual({
      totalConnections: 1,
      idleConnections: 1,
      waitingRequests: 0,
    });
    await persistence.destroy();
    await persistence.destroy();
  });

  it("serializes migration authority with fail-fast advisory locking", async () => {
    await createDatabase(concurrencyDatabase);
    const chain = await createSyntheticChain("concurrency-chain", {
      "0001_slow_lock_probe.cjs": `exports.up = (pgm) => {\n  pgm.sql("SELECT pg_sleep(2)");\n  pgm.sql("CREATE SCHEMA concurrency_probe AUTHORIZATION travelos_owner");\n  pgm.sql("CREATE TABLE concurrency_probe.marker (id integer PRIMARY KEY)");\n};\nexports.down = false;\n`,
    });
    const target = targetFor(concurrencyDatabase);
    const firstPromise = runMigrationChain(target, chain);

    const observer = await clientFor("postgres", concurrencyDatabase);
    let lockObserved = false;
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const locks = await observer.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM pg_catalog.pg_locks WHERE locktype = 'advisory' AND granted",
        );
        if (Number(locks.rows[0]?.count ?? 0) > 0) {
          lockObserved = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      await observer.end();
    }
    expect(lockObserved).toBe(true);

    const secondResult = await runMigrationChain(target, chain).then(
      (result) => ({ status: "fulfilled" as const, result }),
      (error: unknown) => ({
        status: "rejected" as const,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    const firstResult = await firstPromise;
    expect(secondResult.status).toBe("rejected");
    if (secondResult.status === "rejected") {
      expect(secondResult.message).toMatch(/Another migration is already running/);
    }
    expect(firstResult.appliedMigrations).toEqual(["0001_slow_lock_probe"]);
    const rerun = await runMigrationChain(target, chain);
    expect(rerun.appliedMigrations).toEqual([]);
    const marker = await queryAs<{ exists: boolean }>(
      "postgres",
      "SELECT to_regclass('concurrency_probe.marker') IS NOT NULL AS exists",
      concurrencyDatabase,
    );
    expect(marker[0]?.exists).toBe(true);
  });

  it("rolls back a deliberately failing migration and releases its lock", async () => {
    await createDatabase(failureDatabase);
    const failingChain = await createSyntheticChain("failure-chain", {
      "0001_deliberate_failure.cjs": `exports.up = (pgm) => {\n  pgm.sql("CREATE SCHEMA failure_probe AUTHORIZATION travelos_owner");\n  pgm.sql("CREATE TABLE failure_probe.must_rollback (id integer PRIMARY KEY)");\n  pgm.sql("DO $failure$ BEGIN RAISE EXCEPTION 'roles deliberate migration failure'; END $failure$");\n};\nexports.down = false;\n`,
    });
    const target = targetFor(failureDatabase);
    const failure = await runMigrationChain(target, failingChain).then(
      () => ({ rejected: false, message: null }),
      (error: unknown) => ({
        rejected: true,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    expect(failure.rejected).toBe(true);
    expect(failure.message).toMatch(/roles deliberate migration failure/);

    const stateAfterFailure = await queryAs<{
      failed_table_exists: boolean;
      ledger_count: string;
    }>(
      "postgres",
      `SELECT to_regclass('failure_probe.must_rollback') IS NOT NULL AS failed_table_exists,
              (SELECT count(*)::text FROM travelos_meta.schema_migrations) AS ledger_count`,
      failureDatabase,
    );
    expect(stateAfterFailure[0]).toEqual({ failed_table_exists: false, ledger_count: "0" });

    const recoveryChain = await createSyntheticChain("failure-recovery-chain", {
      "0001_recovery_probe.cjs": `exports.up = (pgm) => {\n  pgm.sql("CREATE SCHEMA recovery_probe AUTHORIZATION travelos_owner");\n  pgm.sql("CREATE TABLE recovery_probe.marker (id integer PRIMARY KEY)");\n};\nexports.down = false;\n`,
    });
    const recovery = await runMigrationChain(target, recoveryChain);
    expect(recovery.appliedMigrations).toEqual(["0001_recovery_probe"]);
    const recoveryRerun = await runMigrationChain(target, recoveryChain);
    expect(recoveryRerun.appliedMigrations).toEqual([]);
  });
});
