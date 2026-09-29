import path from "node:path";

import { PG_MIGRATE_LOCK_ID } from "node-pg-migrate";
import { Client, type QueryResultRow } from "pg";

import { runMigrationChain } from "./migration-runner.js";
import {
  assertExactStage3RoleMembershipGraph,
  STAGE_3_BIDIRECTIONAL_ROLE_MEMBERSHIP_SQL,
  STAGE_3_EXPECTED_ROLE_MEMBERSHIPS,
  type Stage3RoleMembership,
} from "./stage-3-role-graph.js";

const requiredEnvironment = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable is absent: ${name}`);
  return value;
};

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const host = requiredEnvironment("TRAVELOS_DB_HOST");
const port = Number.parseInt(requiredEnvironment("TRAVELOS_DB_PORT"), 10);
const database = process.env["TRAVELOS_DB_NAME"] ?? "travelos_development";
const passwords = {
  travelos_migrator: requiredEnvironment("TRAVELOS_CT_MIGRATOR_PASSWORD"),
  travelos_admin_api: requiredEnvironment("TRAVELOS_CT_ADMIN_PASSWORD"),
  travelos_portal_api: requiredEnvironment("TRAVELOS_CT_PORTAL_PASSWORD"),
  travelos_worker: requiredEnvironment("TRAVELOS_CT_WORKER_PASSWORD"),
} as const;

type RuntimeRole = keyof typeof passwords;

const clientFor = (role: RuntimeRole): Client =>
  new Client({
    host,
    port,
    database,
    user: role,
    password: passwords[role],
    application_name: "travelos-stage3-ct-validation",
    ssl: false,
  });

const queryAs = async <Row extends QueryResultRow>(
  role: RuntimeRole,
  sql: string,
): Promise<readonly Row[]> => {
  const client = clientFor(role);
  await client.connect();
  try {
    return (await client.query<Row>(sql)).rows;
  } finally {
    await client.end();
  }
};

const queryAsOwner = async <Row extends QueryResultRow>(sql: string): Promise<readonly Row[]> => {
  const client = clientFor("travelos_migrator");
  await client.connect();
  try {
    await client.query('SET ROLE "travelos_owner"');
    await client.query("SET search_path TO pg_catalog");
    return (await client.query<Row>(sql)).rows;
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    await client.end();
  }
};

const cleanupSql = `
  DROP FUNCTION IF EXISTS presentation.stage3_ct_ungranted_function();
  DROP TABLE IF EXISTS presentation.stage3_ct_customer_safe_probe;
  DROP TABLE IF EXISTS trip_ops.stage3_ct_workspace_probe;
  DROP TABLE IF EXISTS trip_ops.stage3_ct_transaction_probe;
  DROP TABLE IF EXISTS job_runtime.stage3_ct_worker_probe;
`;

if (process.argv[2] === "cleanup") {
  await queryAsOwner(cleanupSql);
  const leftovers = await queryAsOwner<{ count: string }>(`
    SELECT count(*)::text AS count
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
     WHERE class.relname LIKE 'stage3_ct_%'
  `);
  assert(leftovers[0]?.count === "0", "Stage 3 CT probe cleanup left database objects behind");
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: 1, result: "PASS", removedProbeObjects: true })}\n`,
  );
  process.exit(0);
}

assert(host === "127.0.0.1", "CT validation requires a loopback SSH tunnel");
assert(Number.isInteger(port) && port > 1_024, "CT validation requires a bounded tunnel port");

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
  "portal_access",
  "presentation",
  "sales",
  "staff_access",
  "travelos_meta",
  "trip_ops",
  "work_service",
] as const;

const schemas = await queryAs<{
  schema_name: string;
  owner_name: string;
}>(
  "travelos_migrator",
  `SELECT namespace.nspname AS schema_name,
          pg_catalog.pg_get_userbyid(namespace.nspowner) AS owner_name
     FROM pg_catalog.pg_namespace AS namespace
    WHERE namespace.nspname = ANY (ARRAY[${expectedSchemas.map((name) => `'${name}'`).join(", ")}])
    ORDER BY namespace.nspname`,
);
assert(
  JSON.stringify(schemas.map(({ schema_name }) => schema_name)) === JSON.stringify(expectedSchemas),
  "Actual CT schemas differ from the Stage 3 foundation set",
);
assert(
  schemas.every(({ owner_name }) => owner_name === "travelos_owner"),
  "A Stage 3 schema is not owned by travelos_owner",
);

const preProbeRelations = await queryAs<{ object_name: string; object_kind: string }>(
  "travelos_migrator",
  `SELECT namespace.nspname || '.' || class.relname AS object_name,
          class.relkind::text AS object_kind
     FROM pg_catalog.pg_class AS class
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = ANY (ARRAY[${expectedSchemas.map((name) => `'${name}'`).join(", ")}])
      AND class.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    ORDER BY object_name`,
);
assert(
  JSON.stringify(preProbeRelations) ===
    JSON.stringify([
      { object_name: "travelos_meta.schema_migrations", object_kind: "r" },
      { object_name: "travelos_meta.schema_migrations_id_seq", object_kind: "S" },
    ]),
  "Unexpected pre-existing Stage 3/4 relations are present",
);

const stage4Objects = await queryAs<{ object_name: string }>(
  "travelos_migrator",
  `SELECT namespace.nspname || '.' || class.relname AS object_name
     FROM pg_catalog.pg_class AS class
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = ANY (ARRAY[${expectedSchemas.map((name) => `'${name}'`).join(", ")}])
      AND lower(class.relname) ~ '(customer|traveller|reservation|itinerary|publishing|session|account|verification|trip_access_grant|document_grant)'
    ORDER BY object_name`,
);
assert(stage4Objects.length === 0, "Stage 4+ business/auth objects are present");

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
  "travelos_migrator",
  `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
          rolinherit, rolreplication, rolbypassrls
     FROM pg_catalog.pg_roles
    WHERE rolname LIKE 'travelos_%'
    ORDER BY rolname`,
);
assert(roles.length === 8, "Expected exactly eight TravelOS roles");
for (const role of roles) {
  assert(
    !role.rolsuper &&
      !role.rolcreatedb &&
      !role.rolcreaterole &&
      !role.rolreplication &&
      !role.rolbypassrls,
    `Forbidden cluster attribute on ${role.rolname}`,
  );
  assert(
    role.rolinherit ===
      ["travelos_admin_api", "travelos_portal_api", "travelos_worker"].includes(role.rolname),
    `Unexpected INHERIT on ${role.rolname}`,
  );
}

const memberships = await queryAs<Stage3RoleMembership>(
  "travelos_migrator",
  STAGE_3_BIDIRECTIONAL_ROLE_MEMBERSHIP_SQL,
);
const membershipVerification = assertExactStage3RoleMembershipGraph(memberships);
assert(
  JSON.stringify(memberships) === JSON.stringify(STAGE_3_EXPECTED_ROLE_MEMBERSHIPS),
  "Actual CT role memberships differ from the exact qualified topology",
);

await queryAsOwner(cleanupSql);
await queryAsOwner(`
  CREATE TABLE trip_ops.stage3_ct_workspace_probe (
    probe_id text PRIMARY KEY,
    marker text NOT NULL
  );
  CREATE TABLE presentation.stage3_ct_customer_safe_probe (
    probe_id text PRIMARY KEY,
    marker text NOT NULL
  );
  CREATE TABLE job_runtime.stage3_ct_worker_probe (
    probe_id text PRIMARY KEY,
    marker text NOT NULL
  );
  CREATE TABLE trip_ops.stage3_ct_transaction_probe (
    probe_id text PRIMARY KEY,
    marker text NOT NULL
  );
  CREATE FUNCTION presentation.stage3_ct_ungranted_function()
    RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 7';
  GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE trip_ops.stage3_ct_workspace_probe TO travelos_admin_runtime;
  GRANT SELECT ON TABLE presentation.stage3_ct_customer_safe_probe
    TO travelos_portal_runtime;
  GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE job_runtime.stage3_ct_worker_probe TO travelos_worker_runtime;
  GRANT SELECT, INSERT ON TABLE trip_ops.stage3_ct_transaction_probe
    TO travelos_admin_runtime;
  INSERT INTO presentation.stage3_ct_customer_safe_probe
    VALUES ('safe-1', 'customer-safe-synthetic');
  INSERT INTO trip_ops.stage3_ct_workspace_probe
    VALUES ('workspace-1', 'synthetic-workspace');
  INSERT INTO job_runtime.stage3_ct_worker_probe
    VALUES ('worker-1', 'synthetic-worker');
`);

interface PrivilegeAttempt {
  readonly role: Exclude<RuntimeRole, "travelos_migrator">;
  readonly operation: string;
  readonly expected: "ALLOW" | "DENY";
  readonly observed: "ALLOW" | "DENY";
  readonly sqlstate: string | null;
  readonly result: "PASS";
}
const privilegeAttempts: PrivilegeAttempt[] = [];

const attemptPrivilege = async (
  role: PrivilegeAttempt["role"],
  operation: string,
  sql: string,
  expected: PrivilegeAttempt["expected"],
): Promise<void> => {
  const client = clientFor(role);
  await client.connect();
  let observed: PrivilegeAttempt["observed"] = "ALLOW";
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
  assert(observed === expected, `${role} ${operation}: expected ${expected}, observed ${observed}`);
  if (expected === "DENY") {
    assert(sqlstate === "42501", `${role} ${operation}: expected SQLSTATE 42501, got ${sqlstate}`);
  }
  privilegeAttempts.push({ role, operation, expected, observed, sqlstate, result: "PASS" });
};

const portalAllows = [
  [
    "CONNECT and customer-safe SELECT",
    "SELECT marker FROM presentation.stage3_ct_customer_safe_probe",
  ],
] as const;
const portalDenials = [
  ["mutable SELECT", "SELECT * FROM trip_ops.stage3_ct_workspace_probe"],
  [
    "mutable INSERT",
    "INSERT INTO trip_ops.stage3_ct_workspace_probe VALUES ('portal-i', 'denied')",
  ],
  ["mutable UPDATE", "UPDATE trip_ops.stage3_ct_workspace_probe SET marker = 'denied'"],
  ["mutable DELETE", "DELETE FROM trip_ops.stage3_ct_workspace_probe"],
  [
    "customer-safe INSERT",
    "INSERT INTO presentation.stage3_ct_customer_safe_probe VALUES ('portal-w', 'denied')",
  ],
  ["CREATE TABLE", "CREATE TABLE presentation.stage3_ct_portal_denied (id integer)"],
  [
    "ALTER TABLE",
    "ALTER TABLE presentation.stage3_ct_customer_safe_probe ADD COLUMN denied integer",
  ],
  ["DROP TABLE", "DROP TABLE presentation.stage3_ct_customer_safe_probe"],
  ["CREATE SCHEMA", "CREATE SCHEMA stage3_ct_portal_denied"],
  [
    "CREATE FUNCTION",
    "CREATE FUNCTION presentation.stage3_ct_portal_denied() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
  ],
  ["ungranted function EXECUTE", "SELECT presentation.stage3_ct_ungranted_function()"],
  ["CREATE ROLE", "CREATE ROLE stage3_ct_portal_denied"],
  ["ALTER ROLE", "ALTER ROLE travelos_portal_api CREATEDB"],
  ["SET ROLE owner", "SET ROLE travelos_owner"],
  ["SET ROLE migrator", "SET ROLE travelos_migrator"],
  ["SET ROLE admin capability", "SET ROLE travelos_admin_runtime"],
  [
    "public object shadowing",
    "SET LOCAL search_path TO public, pg_catalog; CREATE TABLE stage3_ct_shadow (id integer)",
  ],
] as const;
for (const [operation, sql] of portalAllows) {
  await attemptPrivilege("travelos_portal_api", operation, sql, "ALLOW");
}
for (const [operation, sql] of portalDenials) {
  await attemptPrivilege("travelos_portal_api", operation, sql, "DENY");
}

const adminAllows = [
  ["workspace SELECT", "SELECT * FROM trip_ops.stage3_ct_workspace_probe"],
  [
    "workspace INSERT",
    "INSERT INTO trip_ops.stage3_ct_workspace_probe VALUES ('admin-i', 'allowed')",
  ],
  ["workspace UPDATE", "UPDATE trip_ops.stage3_ct_workspace_probe SET marker = 'allowed'"],
  ["workspace DELETE", "DELETE FROM trip_ops.stage3_ct_workspace_probe"],
] as const;
const adminDenials = [
  ["Portal surface SELECT", "SELECT * FROM presentation.stage3_ct_customer_safe_probe"],
  ["CREATE TABLE", "CREATE TABLE trip_ops.stage3_ct_admin_denied (id integer)"],
  ["ALTER TABLE", "ALTER TABLE trip_ops.stage3_ct_workspace_probe ADD COLUMN denied integer"],
  ["DROP TABLE", "DROP TABLE trip_ops.stage3_ct_workspace_probe"],
  ["CREATE SCHEMA", "CREATE SCHEMA stage3_ct_admin_denied"],
  [
    "CREATE FUNCTION",
    "CREATE FUNCTION trip_ops.stage3_ct_admin_denied() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
  ],
  ["ungranted function EXECUTE", "SELECT presentation.stage3_ct_ungranted_function()"],
  ["CREATE ROLE", "CREATE ROLE stage3_ct_admin_denied"],
  ["ALTER ROLE", "ALTER ROLE travelos_admin_api CREATEDB"],
  ["SET ROLE owner", "SET ROLE travelos_owner"],
  ["SET ROLE migrator", "SET ROLE travelos_migrator"],
  ["SET ROLE Portal capability", "SET ROLE travelos_portal_runtime"],
  [
    "public object shadowing",
    "SET LOCAL search_path TO public, pg_catalog; CREATE TABLE stage3_ct_shadow (id integer)",
  ],
] as const;
for (const [operation, sql] of adminAllows) {
  await attemptPrivilege("travelos_admin_api", operation, sql, "ALLOW");
}
for (const [operation, sql] of adminDenials) {
  await attemptPrivilege("travelos_admin_api", operation, sql, "DENY");
}

const workerAllows = [
  ["worker SELECT", "SELECT * FROM job_runtime.stage3_ct_worker_probe"],
  [
    "worker INSERT",
    "INSERT INTO job_runtime.stage3_ct_worker_probe VALUES ('worker-i', 'allowed')",
  ],
  ["worker UPDATE", "UPDATE job_runtime.stage3_ct_worker_probe SET marker = 'allowed'"],
  ["worker DELETE", "DELETE FROM job_runtime.stage3_ct_worker_probe"],
] as const;
const workerDenials = [
  ["workspace SELECT", "SELECT * FROM trip_ops.stage3_ct_workspace_probe"],
  ["Portal surface SELECT", "SELECT * FROM presentation.stage3_ct_customer_safe_probe"],
  ["CREATE TABLE", "CREATE TABLE job_runtime.stage3_ct_worker_denied (id integer)"],
  ["ALTER TABLE", "ALTER TABLE job_runtime.stage3_ct_worker_probe ADD COLUMN denied integer"],
  ["DROP TABLE", "DROP TABLE job_runtime.stage3_ct_worker_probe"],
  ["CREATE SCHEMA", "CREATE SCHEMA stage3_ct_worker_denied"],
  [
    "CREATE FUNCTION",
    "CREATE FUNCTION job_runtime.stage3_ct_worker_denied() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
  ],
  ["ungranted function EXECUTE", "SELECT presentation.stage3_ct_ungranted_function()"],
  ["CREATE ROLE", "CREATE ROLE stage3_ct_worker_denied"],
  ["ALTER ROLE", "ALTER ROLE travelos_worker CREATEDB"],
  ["SET ROLE owner", "SET ROLE travelos_owner"],
  ["SET ROLE migrator", "SET ROLE travelos_migrator"],
  ["SET ROLE Admin capability", "SET ROLE travelos_admin_runtime"],
  [
    "public object shadowing",
    "SET LOCAL search_path TO public, pg_catalog; CREATE TABLE stage3_ct_shadow (id integer)",
  ],
] as const;
for (const [operation, sql] of workerAllows) {
  await attemptPrivilege("travelos_worker", operation, sql, "ALLOW");
}
for (const [operation, sql] of workerDenials) {
  await attemptPrivilege("travelos_worker", operation, sql, "DENY");
}

const publicDatabasePrivileges = await queryAs<{ count: string }>(
  "travelos_migrator",
  `SELECT count(*)::text AS count
     FROM pg_catalog.pg_database AS database,
          LATERAL pg_catalog.aclexplode(
            COALESCE(database.datacl, pg_catalog.acldefault('d', database.datdba))
          ) AS acl
    WHERE database.datname = current_database() AND acl.grantee = 0`,
);
assert(publicDatabasePrivileges[0]?.count === "0", "Unexpected PUBLIC database privilege");

const publicApplicationFunctionPrivileges = await queryAs<{ count: string }>(
  "travelos_migrator",
  `SELECT count(*)::text AS count
     FROM pg_catalog.pg_proc AS procedure
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace,
          LATERAL pg_catalog.aclexplode(
            COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
          ) AS acl
    WHERE namespace.nspowner = 'travelos_owner'::pg_catalog.regrole
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'`,
);
assert(
  publicApplicationFunctionPrivileges[0]?.count === "0",
  "Unexpected PUBLIC EXECUTE on an application function",
);

const defaultPrivileges = await queryAs<{
  creator: string;
  object_class: string;
  schema_name: string;
  public_grant_count: string;
}>(
  "travelos_migrator",
  `SELECT pg_catalog.pg_get_userbyid(default_acl.defaclrole) AS creator,
          default_acl.defaclobjtype::text AS object_class,
          COALESCE(namespace.nspname, '<global>') AS schema_name,
          count(*) FILTER (WHERE exploded.grantee = 0)::text AS public_grant_count
     FROM pg_catalog.pg_default_acl AS default_acl
     LEFT JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = default_acl.defaclnamespace
     LEFT JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) AS exploded ON true
    GROUP BY default_acl.oid, creator, object_class, schema_name
    ORDER BY creator, object_class, schema_name`,
);
assert(defaultPrivileges.length > 0, "No default privilege policy was installed");
assert(
  defaultPrivileges.every(
    ({ creator, public_grant_count }) => creator === "travelos_owner" && public_grant_count === "0",
  ),
  "Default privileges use an unexpected creator or grant PUBLIC access",
);

const publicSchemaCreate = await queryAs<{ role_name: string; can_create: boolean }>(
  "travelos_migrator",
  `SELECT role_name,
          pg_catalog.has_schema_privilege(role_name, 'public', 'CREATE') AS can_create
     FROM unnest(ARRAY['travelos_admin_api', 'travelos_portal_api', 'travelos_worker']) AS role_name
    ORDER BY role_name`,
);
assert(
  publicSchemaCreate.every(({ can_create }) => !can_create),
  "Runtime can CREATE in public",
);

const searchPaths = await Promise.all(
  (["travelos_admin_api", "travelos_portal_api", "travelos_worker"] as const).map(async (role) => ({
    role,
    searchPath: (await queryAs<{ search_path: string }>(role, "SHOW search_path"))[0]?.search_path,
  })),
);
assert(
  searchPaths.every(({ searchPath }) => searchPath === "pg_catalog"),
  "Unsafe runtime search_path",
);

interface TransactionDatabase {
  "trip_ops.stage3_ct_transaction_probe": {
    probe_id: string;
    marker: string;
  };
}
const { createPostgresPersistence } = await import("../../packages/database/dist/index.js");
const persistence = createPostgresPersistence<TransactionDatabase>({
  host,
  port,
  database,
  user: "travelos_admin_api",
  password: passwords.travelos_admin_api,
  tls: { mode: "DISABLED_LOOPBACK_ONLY" },
  applicationName: "travelos-stage3-ct-transaction-smoke",
  maxConnections: 1,
});
await persistence.transaction.runInTransaction(async (context) =>
  persistence.withTransactionContext(context, async (connection) => {
    await connection
      .insertInto("trip_ops.stage3_ct_transaction_probe")
      .values({ probe_id: "ct-commit-1", marker: "committed" })
      .execute();
  }),
);
const committed = await persistence.withConnection((connection) =>
  connection
    .selectFrom("trip_ops.stage3_ct_transaction_probe")
    .selectAll()
    .where("probe_id", "=", "ct-commit-1")
    .executeTakeFirst(),
);
assert(committed?.marker === "committed", "Committed CT transaction row is absent");
const deliberateRollback = new Error("deliberate CT transaction rollback probe");
let rollbackObserved = false;
try {
  await persistence.transaction.runInTransaction(async (context) =>
    persistence.withTransactionContext(context, async (connection) => {
      await connection
        .insertInto("trip_ops.stage3_ct_transaction_probe")
        .values({ probe_id: "ct-rollback-1", marker: "must-not-persist" })
        .execute();
      throw deliberateRollback;
    }),
  );
} catch (error) {
  rollbackObserved = error === deliberateRollback;
}
assert(rollbackObserved, "CT rollback probe did not preserve the deliberate error");
const rolledBack = await persistence.withConnection((connection) =>
  connection
    .selectFrom("trip_ops.stage3_ct_transaction_probe")
    .selectAll()
    .where("probe_id", "=", "ct-rollback-1")
    .executeTakeFirst(),
);
assert(rolledBack === undefined, "Rolled-back CT row persisted");
let nestedErrorName: string | null = null;
let nestedErrorCode: string | null = null;
try {
  await persistence.transaction.runInTransaction(async () =>
    persistence.transaction.runInTransaction(async () => undefined),
  );
} catch (error) {
  nestedErrorName = error instanceof Error ? error.name : null;
  nestedErrorCode =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : null;
}
assert(
  nestedErrorName === "NestedTransactionNotSupportedError",
  `Nested CT transaction returned the wrong error name: ${nestedErrorName}`,
);
assert(
  nestedErrorCode === "NESTED_TRANSACTION_NOT_SUPPORTED",
  "Nested CT transaction was not rejected",
);
const reusableCount = await persistence.withConnection((connection) =>
  connection
    .selectFrom("trip_ops.stage3_ct_transaction_probe")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .executeTakeFirstOrThrow(),
);
assert(Number(reusableCount.count) === 1, "CT connection was not reusable after rejection");
const poolMetricsBeforeDestroy = persistence.poolMetrics();
await persistence.destroy();
await persistence.destroy();

const lockClient = clientFor("travelos_migrator");
await lockClient.connect();
await lockClient.query("SELECT pg_catalog.pg_advisory_lock($1)", [PG_MIGRATE_LOCK_ID]);
let competingRunnerRejected = false;
let competingRunnerMessageClass: string | null = null;
try {
  await runMigrationChain(
    {
      host,
      port,
      database,
      migratorRole: "travelos_migrator",
      ownerRole: "travelos_owner",
      password: passwords.travelos_migrator,
      tls: { mode: "DISABLED_LOOPBACK_ONLY" },
    },
    {
      directory: path.resolve("migrations"),
      checksumManifestPath: path.resolve("migrations/checksums.json"),
    },
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  competingRunnerRejected = /Another migration is already running/.test(message);
  competingRunnerMessageClass = competingRunnerRejected ? "ADVISORY_LOCK_HELD" : "UNEXPECTED";
} finally {
  await lockClient.query("SELECT pg_catalog.pg_advisory_unlock($1)", [PG_MIGRATE_LOCK_ID]);
  await lockClient.end();
}
assert(competingRunnerRejected, "Competing CT migration runner did not fail fast");
const cleanRerun = await runMigrationChain(
  {
    host,
    port,
    database,
    migratorRole: "travelos_migrator",
    ownerRole: "travelos_owner",
    password: passwords.travelos_migrator,
    tls: { mode: "DISABLED_LOOPBACK_ONLY" },
  },
  {
    directory: path.resolve("migrations"),
    checksumManifestPath: path.resolve("migrations/checksums.json"),
  },
);
assert(cleanRerun.appliedMigrations.length === 0, "Clean CT migration rerun applied changes");
assert(cleanRerun.ledger.length === 3, "CT migration ledger changed during lock smoke");
assert(
  cleanRerun.currentVersion === "0003_creator_default_privileges",
  "CT current migration changed during lock smoke",
);

const perRuntime = (["travelos_portal_api", "travelos_admin_api", "travelos_worker"] as const).map(
  (role) => ({
    role,
    result: "PASS" as const,
    attempts: privilegeAttempts.filter((attempt) => attempt.role === role).length,
    allowed: privilegeAttempts.filter(
      (attempt) => attempt.role === role && attempt.observed === "ALLOW",
    ).length,
    denied: privilegeAttempts.filter(
      (attempt) => attempt.role === role && attempt.observed === "DENY",
    ).length,
  }),
);

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      result: "PASS",
      target: {
        ct: 200,
        hostname: "travelos-dev",
        database,
        transport: "loopback SSH tunnel",
      },
      schemaTopology: {
        result: "PASS",
        expectedSchemaCount: expectedSchemas.length,
        schemas,
        preProbeRelationCount: preProbeRelations.length,
        preProbeRelations,
        stage4ObjectCount: stage4Objects.length,
      },
      roleTopology: {
        result: "PASS",
        roles,
        memberships,
        membershipVerification,
        unexpectedExternalEdges: 0,
      },
      privilegeMatrix: {
        result: "PASS",
        actualSqlAttempts: privilegeAttempts.length,
        perRuntime,
        attempts: privilegeAttempts,
        portalIsolation: "PASS",
        adminRuntimeDdlDenial: "PASS",
        workerRuntimeDdlDenial: "PASS",
        privilegeEscalationDenial: "PASS",
      },
      publicAndDefaults: {
        result: "PASS",
        publicDatabasePrivilegeCount: Number(publicDatabasePrivileges[0]?.count ?? -1),
        publicApplicationFunctionExecuteCount: Number(
          publicApplicationFunctionPrivileges[0]?.count ?? -1,
        ),
        publicSchemaCreate,
        defaultPrivileges,
        newFunctionExecutionDeniedForAllRuntimes: true,
      },
      searchPathAndSetRole: { result: "PASS", searchPaths, memberships },
      transaction: {
        result: "PASS",
        commit: "PASS",
        rollback: "PASS",
        rolledBackRowPresent: false,
        nestedErrorName,
        nestedErrorCode,
        connectionReusableAfterRollbackAndNestedRejection: true,
        poolMetricsBeforeDestroy,
        repeatedDestroySafe: true,
      },
      migrationLock: {
        result: "PASS",
        policy: "fail-fast",
        competingRunnerRejected,
        competingRunnerMessageClass,
        ledgerCount: cleanRerun.ledger.length,
        currentVersion: cleanRerun.currentVersion,
        cleanRerunApplied: cleanRerun.appliedMigrations,
      },
      probeObjectsRetainedForBackupRestoreSmoke: true,
      stage4Actions: 0,
    },
    null,
    2,
  )}\n`,
);
