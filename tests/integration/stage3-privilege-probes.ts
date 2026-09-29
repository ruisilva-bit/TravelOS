import type { QueryResultRow } from "pg";
import { expect } from "vitest";

interface ProbeTools {
  queryAs<Row extends QueryResultRow>(
    role: string,
    sql: string,
    database?: string,
  ): Promise<readonly Row[]>;
  queryAsOwner<Row extends QueryResultRow>(sql: string, database?: string): Promise<readonly Row[]>;
  attemptPrivilege(attempt: {
    role: string;
    operation: string;
    sql: string;
    expected: "ALLOW" | "DENY";
    database?: string;
  }): Promise<void>;
  writeEvidence(name: string, value: unknown): Promise<void>;
}

export const runtimeSurfaces = [
  { role: "travelos_portal_api", schema: "presentation", group: "travelos_portal_runtime" },
  { role: "travelos_admin_api", schema: "trip_ops", group: "travelos_admin_runtime" },
  { role: "travelos_worker", schema: "job_runtime", group: "travelos_worker_runtime" },
] as const;

export const runExtendedPrivilegeProbes = async (tools: ProbeTools): Promise<void> => {
  const { queryAs, queryAsOwner, attemptPrivilege, writeEvidence } = tools;
  const creators = await queryAsOwner(`SELECT session_user, current_user`);
  expect(creators).toEqual([{ session_user: "travelos_migrator", current_user: "travelos_owner" }]);
  for (const { role, schema, group } of runtimeSurfaces) {
    // No GRANT on these objects: the runtime has schema USAGE, so denial proves
    // the object's default ACL, not a missing schema permission.
    await queryAsOwner(`
      CREATE FUNCTION ${schema}.stage3_default_function_probe() RETURNS integer LANGUAGE sql AS 'SELECT 7';
      CREATE TABLE ${schema}.stage3_default_table_probe (id integer);
      CREATE SEQUENCE ${schema}.stage3_default_sequence_probe;
      CREATE TYPE ${schema}.stage3_default_type_probe AS ENUM ('synthetic');
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
      `SELECT ${schema}.stage3_default_function_probe()`,
    );
    await deny(
      "SELECT new table without object grant",
      `SELECT * FROM ${schema}.stage3_default_table_probe`,
    );
    await deny(
      "INSERT new table without object grant",
      `INSERT INTO ${schema}.stage3_default_table_probe VALUES (1)`,
    );
    await deny(
      "UPDATE new table without object grant",
      `UPDATE ${schema}.stage3_default_table_probe SET id = 1`,
    );
    await deny(
      "DELETE new table without object grant",
      `DELETE FROM ${schema}.stage3_default_table_probe`,
    );
    await deny(
      "sequence nextval without object grant",
      `SELECT nextval('${schema}.stage3_default_sequence_probe')`,
    );
    await deny(
      "sequence setval without object grant",
      `SELECT setval('${schema}.stage3_default_sequence_probe', 2)`,
    );
    await deny(
      "CREATE FUNCTION",
      `CREATE FUNCTION ${schema}.stage3_create_denied() RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
    );
    await deny(
      "ALTER FUNCTION",
      `ALTER FUNCTION ${schema}.stage3_default_function_probe() RENAME TO stage3_renamed`,
    );
    await deny("DROP FUNCTION", `DROP FUNCTION ${schema}.stage3_default_function_probe()`);
    await deny("CREATE public TABLE", "CREATE TABLE public.stage3_public_denied (id integer)");
    await deny(
      "CREATE public FUNCTION",
      "CREATE FUNCTION public.stage3_public_denied() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
    );
    await deny("ALTER SCHEMA", `ALTER SCHEMA ${schema} RENAME TO stage3_schema_denied`);
    await deny("DROP SCHEMA", `DROP SCHEMA ${schema} CASCADE`);
    await deny("TRUNCATE object", `TRUNCATE ${schema}.stage3_default_table_probe`);
    await deny(
      "GRANT object escalation",
      `GRANT SELECT ON ${schema}.stage3_default_table_probe TO ${role}`,
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
      "travelos_portal_api",
      "travelos_worker",
      "travelos_admin_runtime",
      "travelos_portal_runtime",
      "travelos_worker_runtime",
      "pg_read_all_data",
      "pg_write_all_data",
    ].filter((target) => target !== role)) {
      await deny(`SET ROLE ${target}`, `SET ROLE ${target}`);
    }
    await deny(
      "unsafe search_path public shadow table",
      "SET LOCAL search_path TO public, pg_catalog; CREATE TABLE stage3_shadow (id integer)",
    );
    await deny(
      "unsafe search_path application shadow function",
      `SET LOCAL search_path TO ${schema}, public, pg_catalog; CREATE FUNCTION stage3_shadow() RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
    );
    await deny(
      "unsafe search_path workspace access",
      "SET LOCAL search_path TO trip_ops, presentation, public, pg_catalog; SELECT * FROM trip_ops.stage3_default_table_probe",
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
      `GRANT EXECUTE ON FUNCTION ${schema}.stage3_default_function_probe() TO ${group}`,
    );
    try {
      expect(
        await queryAs(role, `SELECT ${schema}.stage3_default_function_probe() AS marker`),
      ).toEqual([{ marker: 7 }]);
      await attemptPrivilege({
        role,
        operation: "EXECUTE only after explicit test grant",
        sql: `SELECT ${schema}.stage3_default_function_probe()`,
        expected: "ALLOW",
      });
    } finally {
      await queryAsOwner(
        `REVOKE EXECUTE ON FUNCTION ${schema}.stage3_default_function_probe() FROM ${group}`,
      );
    }
    await deny(
      "EXECUTE after explicit test grant revoked",
      `SELECT ${schema}.stage3_default_function_probe()`,
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
    "CREATE ROLE stage3_public_probe LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT",
  );
  try {
    await expect(queryAs("stage3_public_probe", "SELECT 1")).rejects.toMatchObject({
      code: "42501",
    });
    // CONNECT is granted only to isolate the remaining PUBLIC privileges.
    await queryAs(
      "postgres",
      "GRANT CONNECT ON DATABASE travelos_stage3_qualification TO stage3_public_probe",
    );
    for (const [operation, sql] of [
      ["PUBLIC CREATE SCHEMA", "CREATE SCHEMA stage3_public_schema_denied"],
      ["PUBLIC TEMP", "CREATE TEMP TABLE stage3_public_temp_denied (id integer)"],
      ["PUBLIC public CREATE", "CREATE TABLE public.stage3_public_denied (id integer)"],
      [
        "PUBLIC application USAGE",
        "SELECT * FROM presentation.stage3_customer_safe_privilege_probe",
      ],
    ]) {
      await attemptPrivilege({
        role: "stage3_public_probe",
        operation: operation!,
        sql: sql!,
        expected: "DENY",
      });
    }
  } finally {
    await queryAs(
      "postgres",
      "REVOKE CONNECT ON DATABASE travelos_stage3_qualification FROM stage3_public_probe; DROP ROLE stage3_public_probe",
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
    WHERE r.rolname IN ('travelos_admin_api', 'travelos_portal_api', 'travelos_worker', 'travelos_migrator')
      AND (n.nspowner = 'travelos_owner'::regrole OR n.nspname = 'public')
    ORDER BY r.rolname, n.nspname
  `,
  );
  const usageByRole: Readonly<Record<string, readonly string[]>> = {
    travelos_admin_api: ["staff_access", "trip_ops"],
    travelos_portal_api: ["portal_access", "presentation"],
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
      sql: `CREATE TABLE ${privilege.schema_name}.stage3_create_probe (id integer)`,
      expected: "DENY",
    });
  }
  const defaults = await queryAs(
    "postgres",
    `
    SELECT pg_get_userbyid(d.defaclrole) AS creator, d.defaclobjtype AS object_class,
      COALESCE(n.nspname, '<global>') AS schema_name, d.defaclacl::text AS acl
    FROM pg_catalog.pg_default_acl d LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
    ORDER BY creator, object_class, schema_name
  `,
  );
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
    WHERE r.rolname IN ('travelos_admin_api', 'travelos_portal_api', 'travelos_worker')
      AND t.typname = 'stage3_default_type_probe'
  `,
  );
  expect(typePrivileges).toHaveLength(9);
  expect(typePrivileges.every((row) => !row.can_use)).toBe(true);
  const functions = await queryAs(
    "postgres",
    `
    SELECT n.nspname AS schema_name, p.proname, pg_get_userbyid(p.proowner) AS owner, p.proacl::text AS acl
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname LIKE 'stage3_%' ORDER BY n.nspname, p.proname
  `,
  );
  expect(functions.every((row) => row["owner"] === "travelos_owner")).toBe(true);
  await writeEvidence("default-public-privileges.json", {
    schemaVersion: 1,
    result: "PASS",
    creatorContext: creators,
    defaults,
    defaultPublicGrants,
    databasePublicGrants: publicDatabaseAcl,
    schemaPrivileges,
    typePrivileges,
    functions,
    dynamicFunctionChecks:
      "DENY before GRANT; ALLOW with temporary explicit GRANT; DENY after REVOKE for all three runtime identities",
    publicConnectWithoutGrant: "DENY SQLSTATE 42501",
    typeNote:
      "Type USAGE checked in catalogs; runtime DDL is separately denied. Casts are not a type-USAGE authorization test.",
  });

  for (const sql of [
    "CREATE SCHEMA stage3_migrator_denied",
    "CREATE TEMP TABLE stage3_migrator_temp (id integer)",
    "CREATE ROLE stage3_migrator_role",
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
    sql: "SET LOCAL ROLE travelos_owner; CREATE SCHEMA stage3_owner_ddl; CREATE TABLE stage3_owner_ddl.marker (id integer)",
    expected: "ALLOW",
  });
  await expect(queryAs("travelos_owner", "SELECT 1")).rejects.toMatchObject({ code: "28000" });
  await writeEvidence("owner-migrator-privileges.json", {
    schemaVersion: 1,
    result: "PASS",
    creatorContext: creators,
    directOwnerLogin: "DENY SQLSTATE 28000",
    migratorInherit: false,
    migratorDdlRequiresExplicitOwnerSwitch: true,
    elevatedClusterAttributes: false,
    runtimeOwnerDelegation: false,
    bootstrapSuperuser:
      "disposable provisioning only; creates no application functions; never an application runtime identity",
  });
};
