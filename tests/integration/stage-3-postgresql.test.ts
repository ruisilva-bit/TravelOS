import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import type {
  NestedTransactionNotSupportedError as NestedTransactionNotSupportedErrorType,
  TransactionContext,
} from "../../packages/backend-core/src/index.js";
import type {
  PostgresConnectionSettings,
  PostgresPersistence,
} from "../../packages/database/src/index.js";
import { runExtendedPrivilegeProbes, runtimeSurfaces } from "./stage3-privilege-probes.js";
import {
  inspectMigrationStatus,
  runMigrationChain,
  type MigrationChain,
  type MigrationTarget,
} from "../../tooling/database/migration-runner.js";
import {
  assertExactStage3RoleMembershipGraph,
  extractStage3BootstrapRoleMemberships,
  STAGE_3_BIDIRECTIONAL_ROLE_MEMBERSHIP_SQL,
  STAGE_3_EXPECTED_ROLE_MEMBERSHIPS,
  verifyStage3RoleMembershipGraph,
  type Stage3RoleMembership,
} from "../../tooling/database/stage-3-role-graph.js";
import { Client, type QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const importBuiltModule = async <Exports>(relativePath: string): Promise<Exports> =>
  (await import(/* @vite-ignore */ new URL(relativePath, import.meta.url).href)) as Exports;

// Exercise emitted ESM. The database output resolves backend-core through its
// native package export instead of a TypeScript/Vite source alias.
const { NestedTransactionNotSupportedError } = await importBuiltModule<{
  readonly NestedTransactionNotSupportedError: new () => NestedTransactionNotSupportedErrorType;
}>("../../packages/backend-core/dist/index.js");
const { createPostgresPersistence } = await importBuiltModule<{
  readonly createPostgresPersistence: <Database>(
    settings: PostgresConnectionSettings,
  ) => PostgresPersistence<Database>;
}>("../../packages/database/dist/index.js");

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const host = process.env["PGHOST"] ?? "";
const port = Number.parseInt(process.env["PGPORT"] ?? "", 10);
const postgresBin = process.env["TRAVELOS_STAGE3_PG_BIN"] ?? "";
const evidenceDirectory = path.resolve(process.env["TRAVELOS_STAGE3_EVIDENCE_DIR"] ?? "");
const workRoot = path.resolve(process.env["TRAVELOS_STAGE3_WORK_ROOT"] ?? "");
const primaryDatabase = "travelos_stage3_qualification";
const concurrencyDatabase = "travelos_stage3_concurrency";
const failureDatabase = "travelos_stage3_failure";
const restoreDatabase = "travelos_stage3_restore";

const productionChain: MigrationChain = {
  directory: path.join(repositoryRoot, "migrations"),
  checksumManifestPath: path.join(repositoryRoot, "migrations/checksums.json"),
};

const targetFor = (database: string): MigrationTarget => ({
  host,
  port,
  database,
  migratorRole: "travelos_migrator",
  ownerRole: "travelos_owner",
  tls: { mode: "DISABLED_LOOPBACK_ONLY" },
  allowTrustAuthenticationForTests: true,
});

const sections = new Set<string>();
const writeEvidence = async (name: string, value: unknown): Promise<void> => {
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(path.join(evidenceDirectory, name), `${JSON.stringify(value, null, 2)}\n`);
  sections.add(name);
};

const clientFor = async (user: string, database = primaryDatabase): Promise<Client> => {
  const client = new Client({
    host,
    port,
    database,
    user,
    application_name: `travelos-stage3-test-${user}`,
    connectionTimeoutMillis: 5_000,
    ssl: false,
  });
  await client.connect();
  return client;
};

const queryAs = async <Row extends QueryResultRow>(
  user: string,
  sql: string,
  database = primaryDatabase,
): Promise<readonly Row[]> => {
  const client = await clientFor(user, database);
  try {
    return (await client.query<Row>(sql)).rows;
  } finally {
    await client.end();
  }
};

const queryAsOwner = async <Row extends QueryResultRow>(
  sql: string,
  database = primaryDatabase,
): Promise<readonly Row[]> => {
  const client = await clientFor("travelos_migrator", database);
  try {
    await client.query('SET ROLE "travelos_owner"');
    await client.query("SET search_path TO pg_catalog");
    return (await client.query<Row>(sql)).rows;
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    await client.end();
  }
};

const queryStage3RoleMemberships = async (): Promise<readonly Stage3RoleMembership[]> =>
  queryAs<Stage3RoleMembership>("postgres", STAGE_3_BIDIRECTIONAL_ROLE_MEMBERSHIP_SQL);

const runTool = (
  executable: string,
  args: readonly string[],
  options: { readonly database?: string; readonly pgOptions?: string } = {},
) => {
  const result = spawnSync(executable, [...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      PGHOST: host,
      PGPORT: String(port),
      PGDATABASE: options.database ?? "postgres",
      PGUSER: "postgres",
      PGSSLMODE: "disable",
      ...(options.pgOptions ? { PGOPTIONS: options.pgOptions } : {}),
    },
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

const bootstrapDatabase = (database: string) =>
  runTool(path.join(postgresBin, "psql"), [
    "--no-psqlrc",
    "--set",
    "ON_ERROR_STOP=1",
    "--set",
    `database_name=${database}`,
    "--dbname",
    "postgres",
    "--file",
    path.join(repositoryRoot, "deploy/database/bootstrap-database-and-roles.sql"),
  ]);

const createDatabase = async (database: string): Promise<void> => {
  if (!/^travelos_stage3_[a-z_]+$/.test(database)) throw new Error("Unsafe test database name");
  const admin = await clientFor("postgres", "postgres");
  try {
    await admin.query(`CREATE DATABASE "${database}" OWNER "travelos_owner" TEMPLATE template0`);
    await admin.query(`REVOKE ALL PRIVILEGES ON DATABASE "${database}" FROM PUBLIC`);
    await admin.query(
      `GRANT CONNECT ON DATABASE "${database}" TO "travelos_migrator", "travelos_admin_api", "travelos_portal_api", "travelos_worker"`,
    );
  } finally {
    await admin.end();
  }
};

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

interface PrivilegeAttempt {
  readonly role: string;
  readonly operation: string;
  readonly expected: "ALLOW" | "DENY";
  readonly result: "PASS";
  readonly observed: "ALLOW" | "DENY";
  readonly sqlstate: string | null;
}

const privilegeAttempts: PrivilegeAttempt[] = [];
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
  privilegeAttempts.push({ role, operation, expected, observed, sqlstate, result: "PASS" });
};

const setupPrivilegeScaffolding = async (): Promise<void> => {
  await queryAsOwner(`
    CREATE TABLE "trip_ops"."stage3_workspace_privilege_probe" (
      probe_id text PRIMARY KEY,
      marker text NOT NULL
    );
    CREATE TABLE "presentation"."stage3_customer_safe_privilege_probe" (
      probe_id text PRIMARY KEY,
      marker text NOT NULL
    );
    CREATE TABLE "job_runtime"."stage3_worker_privilege_probe" (
      probe_id text PRIMARY KEY,
      marker text NOT NULL
    );
    CREATE TABLE "trip_ops"."stage3_transaction_probe" (
      probe_id text PRIMARY KEY,
      marker text NOT NULL
    );
    CREATE TABLE "trip_ops"."stage3_ungranted_default_privilege_probe" (
      probe_id text PRIMARY KEY
    );
    CREATE FUNCTION "presentation"."stage3_ungranted_function"()
      RETURNS integer
      LANGUAGE sql
      IMMUTABLE
      AS 'SELECT 7';
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE "trip_ops"."stage3_workspace_privilege_probe"
      TO "travelos_admin_runtime";
    GRANT SELECT
      ON TABLE "presentation"."stage3_customer_safe_privilege_probe"
      TO "travelos_portal_runtime";
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE "job_runtime"."stage3_worker_privilege_probe"
      TO "travelos_worker_runtime";
    GRANT SELECT, INSERT
      ON TABLE "trip_ops"."stage3_transaction_probe"
      TO "travelos_admin_runtime";
    INSERT INTO "presentation"."stage3_customer_safe_privilege_probe" (probe_id, marker)
      VALUES ('safe-1', 'customer-safe-synthetic');
  `);
};

beforeAll(() => {
  expect(host).toBe("127.0.0.1");
  expect(Number.isInteger(port) && port > 1_024).toBe(true);
  expect(postgresBin.startsWith(workRoot)).toBe(true);
  expect(evidenceDirectory).not.toBe(repositoryRoot);
});

afterAll(async () => {
  const expectedSections = [
    "backup-restore.json",
    "disposable-bootstrap.json",
    "migration-chain.json",
    "migration-concurrency.json",
    "migration-failure-rollback.json",
    "privilege-matrix.json",
    "role-topology.json",
    "transaction-results.json",
    "default-public-privileges.json",
    "owner-migrator-privileges.json",
  ];
  await writeEvidence("qualification-summary.json", {
    schemaVersion: 1,
    result: expectedSections.every((name) => sections.has(name)) ? "PASS" : "FAIL",
    completedSections: [...sections].toSorted(),
    expectedSections,
    ct200Actions: 0,
    stage4Executed: false,
  });
});

describe.sequential("TravelOS Stage 3 disposable PostgreSQL qualification", () => {
  it("bootstraps an empty cluster and migrates the authoritative chain from zero", async () => {
    const firstBootstrap = bootstrapDatabase(primaryDatabase);
    expect(firstBootstrap.exitCode, firstBootstrap.stderr).toBe(0);
    const secondBootstrap = bootstrapDatabase(primaryDatabase);
    expect(secondBootstrap.exitCode, secondBootstrap.stderr).toBe(0);

    const server = await queryAs<{
      version: string;
      server_version_num: string;
      data_checksums: string;
      listen_addresses: string;
      port: string;
    }>(
      "postgres",
      `SELECT version(),
              current_setting('server_version_num') AS server_version_num,
              current_setting('data_checksums') AS data_checksums,
              current_setting('listen_addresses') AS listen_addresses,
              current_setting('port') AS port`,
    );
    expect(server[0]?.server_version_num).toBe("180006");
    expect(server[0]?.data_checksums).toBe("on");
    expect(server[0]?.listen_addresses).toBe("127.0.0.1");

    const initialStatus = await inspectMigrationStatus(targetFor(primaryDatabase), productionChain);
    expect(initialStatus.ledger).toEqual([]);
    const firstMigration = await runMigrationChain(targetFor(primaryDatabase), productionChain);
    expect(firstMigration.appliedMigrations).toEqual([
      "0001_foundation_schemas",
      "0002_runtime_schema_boundaries",
      "0003_creator_default_privileges",
    ]);
    const secondMigration = await runMigrationChain(targetFor(primaryDatabase), productionChain);
    expect(secondMigration.appliedMigrations).toEqual([]);
    expect(secondMigration.ledger.map(({ name }) => name)).toEqual([
      "0001_foundation_schemas",
      "0002_runtime_schema_boundaries",
      "0003_creator_default_privileges",
    ]);
    expect(secondMigration.currentVersion).toBe("0003_creator_default_privileges");

    await writeEvidence("disposable-bootstrap.json", {
      schemaVersion: 1,
      result: "PASS",
      emptyClusterBootstrap: "PASS",
      bootstrapRerun: "PASS",
      authentication: "loopback-only trust in synthetic disposable cluster",
      server: server[0],
      clientVersion: runTool(path.join(postgresBin, "psql"), ["--version"]).stdout.trim(),
      serverBinaryVersion: runTool(path.join(postgresBin, "postgres"), ["--version"]).stdout.trim(),
      ct200Actions: 0,
    });
    await writeEvidence("migration-chain.json", {
      schemaVersion: 1,
      result: "PASS",
      zeroToCurrent: firstMigration,
      deterministicRerun: secondMigration,
      initialLedger: initialStatus.ledger,
    });
  });

  it("establishes deliberate schema ownership and role membership topology", async () => {
    const bootstrapSql = await readFile(
      path.join(repositoryRoot, "deploy/database/bootstrap-database-and-roles.sql"),
      "utf8",
    );
    expect(extractStage3BootstrapRoleMemberships(bootstrapSql)).toEqual(
      STAGE_3_EXPECTED_ROLE_MEMBERSHIPS,
    );

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
    expect(roles).toHaveLength(8);
    for (const role of roles) {
      expect(role.rolsuper).toBe(false);
      expect(role.rolcreatedb).toBe(false);
      expect(role.rolcreaterole).toBe(false);
      expect(role.rolreplication).toBe(false);
      expect(role.rolbypassrls).toBe(false);
      expect(role.rolinherit).toBe(
        ["travelos_admin_api", "travelos_portal_api", "travelos_worker"].includes(role.rolname),
      );
    }
    expect(roles.find(({ rolname }) => rolname === "travelos_owner")?.rolcanlogin).toBe(false);
    expect(roles.find(({ rolname }) => rolname === "travelos_admin_runtime")?.rolcanlogin).toBe(
      false,
    );
    expect(roles.find(({ rolname }) => rolname === "travelos_portal_runtime")?.rolcanlogin).toBe(
      false,
    );
    expect(roles.find(({ rolname }) => rolname === "travelos_worker_runtime")?.rolcanlogin).toBe(
      false,
    );

    const memberships = await queryStage3RoleMemberships();
    const membershipVerification = assertExactStage3RoleMembershipGraph(memberships);
    expect(memberships).toEqual(STAGE_3_EXPECTED_ROLE_MEMBERSHIPS);

    const fixtureRoles = [
      "stage3_external_owner_member",
      "stage3_external_runtime_member",
      "stage3_unrelated_member",
      "stage3_unrelated_group",
    ] as const;
    await queryAs(
      "postgres",
      fixtureRoles.map((roleName) => `CREATE ROLE "${roleName}" NOLOGIN`).join("; "),
      "postgres",
    );
    let externalOwnerEdgeRejected: boolean;
    let externalRuntimeEdgeRejected: boolean;
    let unrelatedEdgeIgnored: boolean;
    try {
      await queryAs(
        "postgres",
        'GRANT "travelos_owner" TO "stage3_external_owner_member" WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
        "postgres",
      );
      const externalOwnerGraph = await queryStage3RoleMemberships();
      expect(verifyStage3RoleMembershipGraph(externalOwnerGraph)).toEqual(
        expect.objectContaining({ result: "FAIL", actualCount: 5 }),
      );
      expect(() => assertExactStage3RoleMembershipGraph(externalOwnerGraph)).toThrow(
        /stage3_external_owner_member->travelos_owner/,
      );
      const externalOwnerBootstrap = bootstrapDatabase(primaryDatabase);
      expect(externalOwnerBootstrap.exitCode).not.toBe(0);
      expect(externalOwnerBootstrap.stderr).toMatch(/role membership graph mismatch/i);
      externalOwnerEdgeRejected = true;
      await queryAs(
        "postgres",
        'REVOKE "travelos_owner" FROM "stage3_external_owner_member"',
        "postgres",
      );

      await queryAs(
        "postgres",
        'GRANT "travelos_portal_runtime" TO "stage3_external_runtime_member" WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
        "postgres",
      );
      const externalRuntimeGraph = await queryStage3RoleMemberships();
      expect(verifyStage3RoleMembershipGraph(externalRuntimeGraph)).toEqual(
        expect.objectContaining({ result: "FAIL", actualCount: 5 }),
      );
      expect(() => assertExactStage3RoleMembershipGraph(externalRuntimeGraph)).toThrow(
        /stage3_external_runtime_member->travelos_portal_runtime/,
      );
      const externalRuntimeBootstrap = bootstrapDatabase(primaryDatabase);
      expect(externalRuntimeBootstrap.exitCode).not.toBe(0);
      expect(externalRuntimeBootstrap.stderr).toMatch(/role membership graph mismatch/i);
      externalRuntimeEdgeRejected = true;
      await queryAs(
        "postgres",
        'REVOKE "travelos_portal_runtime" FROM "stage3_external_runtime_member"',
        "postgres",
      );

      await queryAs(
        "postgres",
        'GRANT "stage3_unrelated_group" TO "stage3_unrelated_member" WITH ADMIN FALSE, INHERIT TRUE, SET FALSE',
        "postgres",
      );
      const graphWithUnrelatedEdge = await queryStage3RoleMemberships();
      expect(assertExactStage3RoleMembershipGraph(graphWithUnrelatedEdge).result).toBe("PASS");
      const unrelatedBootstrap = bootstrapDatabase(primaryDatabase);
      expect(unrelatedBootstrap.exitCode, unrelatedBootstrap.stderr).toBe(0);
      unrelatedEdgeIgnored = true;
    } finally {
      await queryAs(
        "postgres",
        `REVOKE "travelos_owner" FROM "stage3_external_owner_member";
         REVOKE "travelos_portal_runtime" FROM "stage3_external_runtime_member";
         REVOKE "stage3_unrelated_group" FROM "stage3_unrelated_member";
         DROP ROLE ${fixtureRoles.map((roleName) => `"${roleName}"`).join(", ")}`,
        "postgres",
      );
    }
    expect(await queryStage3RoleMemberships()).toEqual(STAGE_3_EXPECTED_ROLE_MEMBERSHIPS);

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
         FROM unnest(ARRAY['travelos_admin_api', 'travelos_portal_api', 'travelos_worker']) AS role_name
        ORDER BY role_name`,
    );
    expect(databasePrivileges.every(({ can_connect }) => can_connect)).toBe(true);
    expect(databasePrivileges.some(({ can_create_temp }) => can_create_temp)).toBe(false);
    expect(databasePrivileges.some(({ can_create_public }) => can_create_public)).toBe(false);

    await writeEvidence("role-topology.json", {
      schemaVersion: 1,
      result: "PASS",
      databaseOwner: "travelos_owner",
      schemaOwners: schemas,
      roles,
      memberships,
      membershipVerification,
      bootstrapSharedDefinitionParity: "PASS",
      adversarialMembershipVerification: {
        externalOwnerEdgeRejected,
        externalRuntimeEdgeRejected,
        unrelatedEdgeIgnored,
        fixtureRolesRemoved: true,
      },
      databasePrivileges,
      runtimeRolesAreOwners: false,
    });
  });

  it("proves the executable runtime privilege matrix and Portal isolation", async () => {
    await setupPrivilegeScaffolding();

    const portalAllows = [
      {
        operation: "connect and read explicitly granted customer-safe surface",
        sql: `SELECT marker FROM "presentation"."stage3_customer_safe_privilege_probe"`,
      },
    ];
    const portalDenials = [
      {
        operation: "SELECT mutable workspace object",
        sql: `SELECT * FROM "trip_ops"."stage3_workspace_privilege_probe"`,
      },
      {
        operation: "INSERT mutable workspace object",
        sql: `INSERT INTO "trip_ops"."stage3_workspace_privilege_probe" VALUES ('portal-i', 'denied')`,
      },
      {
        operation: "UPDATE mutable workspace object",
        sql: `UPDATE "trip_ops"."stage3_workspace_privilege_probe" SET marker = 'denied'`,
      },
      {
        operation: "DELETE mutable workspace object",
        sql: `DELETE FROM "trip_ops"."stage3_workspace_privilege_probe"`,
      },
      {
        operation: "INSERT customer-safe surface",
        sql: `INSERT INTO "presentation"."stage3_customer_safe_privilege_probe" VALUES ('portal-safe-write', 'denied')`,
      },
      {
        operation: "CREATE TABLE",
        sql: `CREATE TABLE "presentation"."stage3_portal_create_denied" (id integer)`,
      },
      {
        operation: "ALTER object",
        sql: `ALTER TABLE "presentation"."stage3_customer_safe_privilege_probe" ADD COLUMN denied integer`,
      },
      {
        operation: "DROP object",
        sql: `DROP TABLE "presentation"."stage3_customer_safe_privilege_probe"`,
      },
      { operation: "CREATE schema", sql: `CREATE SCHEMA "stage3_portal_schema_denied"` },
      { operation: "SET ROLE owner", sql: `SET ROLE "travelos_owner"` },
      { operation: "SET ROLE migrator", sql: `SET ROLE "travelos_migrator"` },
      { operation: "CREATE role", sql: `CREATE ROLE "stage3_portal_role_denied"` },
      {
        operation: "CREATE temporary table",
        sql: `CREATE TEMP TABLE stage3_portal_temp_denied (id integer)`,
      },
      {
        operation: "EXECUTE default-ungranted function",
        sql: `SELECT "presentation"."stage3_ungranted_function"()`,
      },
      {
        operation: "SELECT default-ungranted owner object",
        sql: `SELECT * FROM "trip_ops"."stage3_ungranted_default_privilege_probe"`,
      },
    ];
    for (const attempt of portalAllows) {
      await attemptPrivilege({ role: "travelos_portal_api", expected: "ALLOW", ...attempt });
    }
    for (const attempt of portalDenials) {
      await attemptPrivilege({ role: "travelos_portal_api", expected: "DENY", ...attempt });
    }

    const adminAllows = [
      {
        operation: "SELECT intended workspace surface",
        sql: `SELECT * FROM "trip_ops"."stage3_workspace_privilege_probe"`,
      },
      {
        operation: "INSERT intended workspace surface",
        sql: `INSERT INTO "trip_ops"."stage3_workspace_privilege_probe" VALUES ('admin-i', 'allowed')`,
      },
      {
        operation: "UPDATE intended workspace surface",
        sql: `UPDATE "trip_ops"."stage3_workspace_privilege_probe" SET marker = 'allowed'`,
      },
      {
        operation: "DELETE intended workspace surface",
        sql: `DELETE FROM "trip_ops"."stage3_workspace_privilege_probe"`,
      },
    ];
    const adminDenials = [
      {
        operation: "CREATE TABLE",
        sql: `CREATE TABLE "trip_ops"."stage3_admin_create_denied" (id integer)`,
      },
      {
        operation: "ALTER object",
        sql: `ALTER TABLE "trip_ops"."stage3_workspace_privilege_probe" ADD COLUMN denied integer`,
      },
      {
        operation: "DROP object",
        sql: `DROP TABLE "trip_ops"."stage3_workspace_privilege_probe"`,
      },
      { operation: "CREATE schema", sql: `CREATE SCHEMA "stage3_admin_schema_denied"` },
      { operation: "SET ROLE owner", sql: `SET ROLE "travelos_owner"` },
      { operation: "SET ROLE migrator", sql: `SET ROLE "travelos_migrator"` },
      { operation: "CREATE role", sql: `CREATE ROLE "stage3_admin_role_denied"` },
      {
        operation: "CREATE temporary table",
        sql: `CREATE TEMP TABLE stage3_admin_temp_denied (id integer)`,
      },
      {
        operation: "SELECT worker-only surface",
        sql: `SELECT * FROM "job_runtime"."stage3_worker_privilege_probe"`,
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
        sql: `SELECT * FROM "job_runtime"."stage3_worker_privilege_probe"`,
      },
      {
        operation: "INSERT explicit worker foundation surface",
        sql: `INSERT INTO "job_runtime"."stage3_worker_privilege_probe" VALUES ('worker-i', 'allowed')`,
      },
      {
        operation: "UPDATE explicit worker foundation surface",
        sql: `UPDATE "job_runtime"."stage3_worker_privilege_probe" SET marker = 'allowed'`,
      },
      {
        operation: "DELETE explicit worker foundation surface",
        sql: `DELETE FROM "job_runtime"."stage3_worker_privilege_probe"`,
      },
    ];
    const workerDenials = [
      {
        operation: "SELECT mutable workspace object",
        sql: `SELECT * FROM "trip_ops"."stage3_workspace_privilege_probe"`,
      },
      {
        operation: "CREATE TABLE",
        sql: `CREATE TABLE "job_runtime"."stage3_worker_create_denied" (id integer)`,
      },
      {
        operation: "ALTER object",
        sql: `ALTER TABLE "job_runtime"."stage3_worker_privilege_probe" ADD COLUMN denied integer`,
      },
      {
        operation: "DROP object",
        sql: `DROP TABLE "job_runtime"."stage3_worker_privilege_probe"`,
      },
      { operation: "CREATE schema", sql: `CREATE SCHEMA "stage3_worker_schema_denied"` },
      { operation: "SET ROLE owner", sql: `SET ROLE "travelos_owner"` },
      { operation: "SET ROLE migrator", sql: `SET ROLE "travelos_migrator"` },
      { operation: "CREATE role", sql: `CREATE ROLE "stage3_worker_role_denied"` },
      {
        operation: "CREATE temporary table",
        sql: `CREATE TEMP TABLE stage3_worker_temp_denied (id integer)`,
      },
    ];
    for (const attempt of workerAllows) {
      await attemptPrivilege({ role: "travelos_worker", expected: "ALLOW", ...attempt });
    }
    for (const attempt of workerDenials) {
      await attemptPrivilege({ role: "travelos_worker", expected: "DENY", ...attempt });
    }

    await runExtendedPrivilegeProbes({ queryAs, queryAsOwner, attemptPrivilege, writeEvidence });

    const searchPaths = await Promise.all(
      ["travelos_admin_api", "travelos_portal_api", "travelos_worker"].map(async (role) => ({
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
        WHERE tablename LIKE 'stage3_%_probe'
        ORDER BY schemaname, tablename`,
    );
    expect(objectOwners.length).toBeGreaterThanOrEqual(5);
    expect(new Set(objectOwners.map(({ owner_name }) => owner_name))).toEqual(
      new Set(["travelos_owner"]),
    );

    await writeEvidence("privilege-matrix.json", {
      schemaVersion: 1,
      result: "PASS",
      actualSqlAttempts: privilegeAttempts.length,
      perRuntime: runtimeSurfaces.map(({ role }) => ({
        role,
        result: "PASS",
        attempts: privilegeAttempts.filter((attempt) => attempt.role === role).length,
      })),
      attempts: privilegeAttempts,
      portalIsolation: "PASS",
      runtimeDdlDenial: "PASS",
      roleEscalationDenial: "PASS",
      runtimeSearchPaths: searchPaths,
      testOnlyObjects: objectOwners,
      note: "All stage3_* objects are disposable privilege-test scaffolding and are absent from the production migration chain.",
    });
  });

  it("commits, rolls back, releases the pool connection, and rejects nesting explicitly", async () => {
    interface TransactionProbeDatabase {
      "trip_ops.stage3_transaction_probe": {
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
      applicationName: "travelos-stage3-transaction-test",
      maxConnections: 1,
    });

    await persistence.transaction.runInTransaction(async (context: TransactionContext) =>
      persistence.withTransactionContext(context, async (database) => {
        await database
          .insertInto("trip_ops.stage3_transaction_probe")
          .values({ probe_id: "commit-1", marker: "committed" })
          .execute();
      }),
    );
    const committed = await persistence.withConnection((database) =>
      database
        .selectFrom("trip_ops.stage3_transaction_probe")
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
            .insertInto("trip_ops.stage3_transaction_probe")
            .values({ probe_id: "rollback-1", marker: "must-not-persist" })
            .execute();
          throw deliberate;
        }),
      ),
    ).rejects.toBe(deliberate);
    const rolledBack = await persistence.withConnection((database) =>
      database
        .selectFrom("trip_ops.stage3_transaction_probe")
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
        .selectFrom("trip_ops.stage3_transaction_probe")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow(),
    );
    expect(Number(postRollbackProbe.count)).toBe(1);
    expect(persistence.poolMetrics()).toEqual({
      totalConnections: 1,
      idleConnections: 1,
      waitingRequests: 0,
    });
    const metricsBeforeDestroy = persistence.poolMetrics();
    await persistence.destroy();
    await persistence.destroy();

    await writeEvidence("transaction-results.json", {
      schemaVersion: 1,
      result: "PASS",
      commit: "PASS",
      rollback: "PASS",
      persistedCommitRows: Number(postRollbackProbe.count),
      rolledBackRowPresent: false,
      nestedPolicy: "REJECT",
      nestedErrorCode: "NESTED_TRANSACTION_NOT_SUPPORTED",
      connectionReusableAfterRollback: true,
      poolMetricsBeforeDestroy: metricsBeforeDestroy,
      destroyIdempotent: true,
    });
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

    await writeEvidence("migration-concurrency.json", {
      schemaVersion: 1,
      result: "PASS",
      policy: "fail-fast",
      advisoryLockObserved: lockObserved,
      firstRunner: firstResult,
      secondRunner: secondResult,
      ledgerAfterRace: rerun.ledger,
      corruptionObserved: false,
      laterCleanRerun: "PASS",
    });
  });

  it("rolls back a deliberately failing migration and releases its lock", async () => {
    await createDatabase(failureDatabase);
    const failingChain = await createSyntheticChain("failure-chain", {
      "0001_deliberate_failure.cjs": `exports.up = (pgm) => {\n  pgm.sql("CREATE SCHEMA failure_probe AUTHORIZATION travelos_owner");\n  pgm.sql("CREATE TABLE failure_probe.must_rollback (id integer PRIMARY KEY)");\n  pgm.sql("DO $failure$ BEGIN RAISE EXCEPTION 'stage3 deliberate migration failure'; END $failure$");\n};\nexports.down = false;\n`,
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
    expect(failure.message).toMatch(/stage3 deliberate migration failure/);

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

    await writeEvidence("migration-failure-rollback.json", {
      schemaVersion: 1,
      result: "PASS",
      deliberatelyFailingMigrationLocation:
        "disposable temporary directory outside production chain",
      failure,
      transactionalChangesRolledBack: !stateAfterFailure[0]?.failed_table_exists,
      failedMigrationLedgerCount: Number(stateAfterFailure[0]?.ledger_count ?? -1),
      lockReleased: recovery.result === "PASS",
      laterCleanMigrationRun: recovery,
      deterministicRecoveryRerun: recoveryRerun,
    });
  });

  it("dumps and restores database-local state after cluster-global role bootstrap", async () => {
    await queryAsOwner(`
      INSERT INTO "trip_ops"."stage3_workspace_privilege_probe" (probe_id, marker)
        VALUES ('backup-workspace-1', 'synthetic-workspace');
      INSERT INTO "job_runtime"."stage3_worker_privilege_probe" (probe_id, marker)
        VALUES ('backup-worker-1', 'synthetic-worker');
    `);

    const dumpPath = path.join(workRoot, "travelos-stage3.dump");
    const pgOptions = "-c role=travelos_owner -c search_path=pg_catalog";
    const dump = runTool(
      path.join(postgresBin, "pg_dump"),
      [
        "--host",
        host,
        "--port",
        String(port),
        "--username",
        "travelos_migrator",
        "--format=custom",
        "--file",
        dumpPath,
        primaryDatabase,
      ],
      { database: primaryDatabase, pgOptions },
    );
    expect(dump.exitCode, dump.stderr).toBe(0);

    const restoreBootstrap = bootstrapDatabase(restoreDatabase);
    expect(restoreBootstrap.exitCode, restoreBootstrap.stderr).toBe(0);
    const restore = runTool(
      path.join(postgresBin, "pg_restore"),
      [
        "--host",
        host,
        "--port",
        String(port),
        "--username",
        "travelos_migrator",
        "--dbname",
        restoreDatabase,
        "--no-owner",
        "--exit-on-error",
        "--single-transaction",
        dumpPath,
      ],
      { database: restoreDatabase, pgOptions },
    );
    expect(restore.exitCode, restore.stderr).toBe(0);

    const restoredStatus = await inspectMigrationStatus(
      targetFor(restoreDatabase),
      productionChain,
    );
    expect(restoredStatus.currentVersion).toBe("0003_creator_default_privileges");
    const restoredData = await queryAsOwner<{
      workspace_marker: string;
      worker_marker: string;
      transaction_marker: string;
    }>(
      `SELECT
         (SELECT marker FROM trip_ops.stage3_workspace_privilege_probe WHERE probe_id = 'backup-workspace-1') AS workspace_marker,
         (SELECT marker FROM job_runtime.stage3_worker_privilege_probe WHERE probe_id = 'backup-worker-1') AS worker_marker,
         (SELECT marker FROM trip_ops.stage3_transaction_probe WHERE probe_id = 'commit-1') AS transaction_marker`,
      restoreDatabase,
    );
    expect(restoredData[0]).toEqual({
      workspace_marker: "synthetic-workspace",
      worker_marker: "synthetic-worker",
      transaction_marker: "committed",
    });

    await attemptPrivilege({
      role: "travelos_portal_api",
      operation: "restored customer-safe SELECT",
      sql: `SELECT marker FROM presentation.stage3_customer_safe_privilege_probe`,
      expected: "ALLOW",
      database: restoreDatabase,
    });
    await attemptPrivilege({
      role: "travelos_portal_api",
      operation: "restored mutable workspace SELECT denial",
      sql: `SELECT marker FROM trip_ops.stage3_workspace_privilege_probe`,
      expected: "DENY",
      database: restoreDatabase,
    });
    await attemptPrivilege({
      role: "travelos_admin_api",
      operation: "restored Admin workspace SELECT",
      sql: `SELECT marker FROM trip_ops.stage3_workspace_privilege_probe`,
      expected: "ALLOW",
      database: restoreDatabase,
    });
    await attemptPrivilege({
      role: "travelos_worker",
      operation: "restored Worker foundation SELECT",
      sql: `SELECT marker FROM job_runtime.stage3_worker_privilege_probe`,
      expected: "ALLOW",
      database: restoreDatabase,
    });

    const dumpBytes = await readFile(dumpPath);
    const dumpMetadata = await stat(dumpPath);
    const restoredOwners = await queryAs<{ invalid_owner_count: string }>(
      "postgres",
      `SELECT count(*)::text AS invalid_owner_count
         FROM pg_catalog.pg_class AS class
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
        WHERE namespace.nspname IN ('travelos_meta', 'trip_ops', 'presentation', 'job_runtime')
          AND class.relkind IN ('r', 'p', 'v', 'm', 'S')
          AND pg_get_userbyid(class.relowner) <> 'travelos_owner'`,
      restoreDatabase,
    );
    expect(restoredOwners[0]?.invalid_owner_count).toBe("0");

    await writeEvidence("backup-restore.json", {
      schemaVersion: 1,
      result: "PASS",
      scope:
        "Stage 3 disposable logical backup/restore smoke; not final production disaster recovery",
      rolesScope:
        "PostgreSQL roles are cluster-global and were recreated/idempotently verified by bootstrap before database-local restore",
      dump: {
        tool: runTool(path.join(postgresBin, "pg_dump"), ["--version"]).stdout.trim(),
        exitCode: dump.exitCode,
        bytes: dumpMetadata.size,
        sha256: createHash("sha256").update(dumpBytes).digest("hex"),
      },
      restore: {
        tool: runTool(path.join(postgresBin, "pg_restore"), ["--version"]).stdout.trim(),
        exitCode: restore.exitCode,
        bootstrapBeforeRestore: "PASS",
        singleTransaction: true,
        noOwner: true,
      },
      restoredMigrationStatus: restoredStatus,
      representativeData: restoredData[0],
      invalidRestoredObjectOwnerCount: Number(restoredOwners[0]?.invalid_owner_count ?? -1),
      restoredPrivilegeAttempts: privilegeAttempts.filter((attempt) =>
        attempt.operation.startsWith("restored"),
      ),
    });
  });
});
