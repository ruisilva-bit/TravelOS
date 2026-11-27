import { randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, type QueryResultRow } from "pg";
import { bootstrapRootAgency } from "@travelos/backend-core";
import {
  createPostgresPersistence,
  createStaffAccessRepository,
  type PostgresPersistence,
} from "../../../packages/database/src/index.js";
import { createUuidV7 } from "../../../packages/database/src/uuidv7.js";
import {
  inspectMigrationStatus,
  runMigrationChain,
  type MigrationChain,
  type MigrationRunResult,
  type MigrationTarget,
} from "../../../tooling/database/migration-runner.js";

// Shared helpers for the area-based PostgreSQL integration suites. The runner
// (tooling/database/run-postgres-integration.mjs) starts one disposable loopback-only cluster per
// test file and exports the connection settings read below.
export const repositoryRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
export const host = process.env["PGHOST"] ?? "";
export const port = Number.parseInt(process.env["PGPORT"] ?? "", 10);
export const postgresBin = process.env["TRAVELOS_PG_BIN"] ?? "";
export const workRoot = process.env["TRAVELOS_PG_WORK_ROOT"] ?? "";
export const syntheticDomain = "synthetic.test";

export const productionChain: MigrationChain = {
  directory: path.join(repositoryRoot, "migrations"),
  checksumManifestPath: path.join(repositoryRoot, "migrations/checksums.json"),
};

export type { MigrationChain, MigrationRunResult, MigrationTarget };
export { inspectMigrationStatus, runMigrationChain };

export const requireHarness = (): void => {
  if (host !== "127.0.0.1" || !Number.isInteger(port) || port < 1 || !postgresBin || !workRoot) {
    throw new Error("PostgreSQL integration requires the pinned disposable loopback harness");
  }
};

export const targetFor = (database: string): MigrationTarget => ({
  host,
  port,
  database,
  migratorRole: "travelos_migrator",
  ownerRole: "travelos_owner",
  tls: { mode: "DISABLED_LOOPBACK_ONLY" },
  allowTrustAuthenticationForTests: true,
});

export const runTool = (
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
  return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
};

/** Runs the production role/database bootstrap SQL and returns the raw result. */
export const bootstrapDatabaseRoles = (database: string) =>
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

/** Creates a disposable database through the production bootstrap SQL; throws on failure. */
export const createDatabase = (database: string): void => {
  const result = bootstrapDatabaseRoles(database);
  if (result.exitCode !== 0) {
    throw new Error(`Disposable database bootstrap failed: ${result.stderr.slice(0, 2_000)}`);
  }
};

export const clientFor = async (user: string, database: string): Promise<Client> => {
  const client = new Client({
    host,
    port,
    database,
    user,
    application_name: `travelos-test-${user}`,
    connectionTimeoutMillis: 5_000,
    ssl: false,
  });
  await client.connect();
  return client;
};

export const queryAs = async <Row extends QueryResultRow>(
  user: string,
  statement: string,
  database: string,
): Promise<readonly Row[]> => {
  const client = await clientFor(user, database);
  try {
    return (await client.query<Row>(statement)).rows;
  } finally {
    await client.end();
  }
};

/** Runs one statement as the migrator login with the owner role assumed (as production DDL does). */
export const queryAsOwner = async <Row extends QueryResultRow>(
  statement: string,
  database: string,
): Promise<readonly Row[]> => {
  const client = await clientFor("travelos_migrator", database);
  try {
    await client.query('SET ROLE "travelos_owner"');
    await client.query("SET search_path TO pg_catalog");
    return (await client.query<Row>(statement)).rows;
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    await client.end();
  }
};

export const createOwnerClient = async (database: string): Promise<Client> => {
  const client = new Client({ host, port, database, user: "travelos_migrator", ssl: false });
  await client.connect();
  await client.query('SET ROLE "travelos_owner"');
  return client;
};

export const withOwnerTransaction = async <Result>(
  database: string,
  work: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const client = await createOwnerClient(database);
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
};

export const createAdminPersistence = <Database = Record<string, never>>(
  database: string,
  applicationName: string,
  maxConnections = 4,
): PostgresPersistence<Database> =>
  createPostgresPersistence<Database>({
    host,
    port,
    database,
    user: "travelos_admin_api",
    tls: { mode: "DISABLED_LOOPBACK_ONLY" },
    applicationName,
    maxConnections,
  });

export const queryErrorCode = async (work: () => Promise<unknown>): Promise<string | null> => {
  try {
    await work();
    return null;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error
      ? String((error as { readonly code?: unknown }).code ?? "")
      : null;
  }
};

interface ChainManifest {
  readonly schemaVersion: number;
  readonly algorithm: string;
  readonly migrations: readonly { readonly file: string; readonly sha256: string }[];
}

export const readChainManifest = async (): Promise<ChainManifest> =>
  JSON.parse(await readFile(productionChain.checksumManifestPath, "utf8")) as ChainManifest;

/** Names (without extension) of every migration in the real chain, in order. */
export const productionMigrationNames = async (): Promise<readonly string[]> =>
  (await readChainManifest()).migrations.map(({ file }) => file.replace(/\.cjs$/u, ""));

const writeChainPrefix = async (
  manifest: ChainManifest,
  length: number,
  label: string,
): Promise<MigrationChain> => {
  const directory = await mkdtemp(path.join(workRoot, `${label}-`));
  const migrations = manifest.migrations.slice(0, length);
  for (const { file } of migrations) {
    await copyFile(path.join(productionChain.directory, file), path.join(directory, file));
  }
  const checksumManifestPath = path.join(directory, "checksums.json");
  await writeFile(
    checksumManifestPath,
    `${JSON.stringify({ ...manifest, migrations }, null, 2)}\n`,
  );
  return { directory, checksumManifestPath };
};

export interface RootAgencySeed {
  readonly agencyId: string;
  readonly bootstrapReference: string;
  readonly slug: string;
}

export interface MigratedDatabase {
  readonly appliedMigrations: readonly string[];
  readonly currentVersion: string | null;
  readonly rootAgency: Awaited<ReturnType<typeof bootstrapRootAgency>>;
  readonly ownerRoleId: string;
}

/**
 * Migrates an empty bootstrapped database from zero to the head of the real chain.
 *
 * The supported install order is: schema chain up to the first migration that needs an established
 * root Agency, then root-Agency bootstrap, then the remainder of the chain. The split point is
 * found by the migration's own guard text, so no migration is referenced by name.
 */
export const migrateToHead = async (
  database: string,
  agency: RootAgencySeed,
): Promise<MigratedDatabase> => {
  const manifest = await readChainManifest();
  let splitIndex = -1;
  for (const [index, { file }] of manifest.migrations.entries()) {
    const source = await readFile(path.join(productionChain.directory, file), "utf8");
    if (/established root Agency/u.test(source)) {
      splitIndex = index;
      break;
    }
  }
  const applied: string[] = [];
  const temporaryChains: string[] = [];
  try {
    if (splitIndex > 0) {
      const prefix = await writeChainPrefix(manifest, splitIndex, "chain-prefix");
      temporaryChains.push(prefix.directory);
      applied.push(...(await runMigrationChain(targetFor(database), prefix)).appliedMigrations);
    }
    const bootstrapPersistence = createAdminPersistence(database, "migrate-to-head-bootstrap", 2);
    let rootAgency: Awaited<ReturnType<typeof bootstrapRootAgency>>;
    try {
      if (splitIndex <= 0) {
        applied.push(
          ...(await runMigrationChain(targetFor(database), productionChain)).appliedMigrations,
        );
      }
      rootAgency = await bootstrapRootAgency(
        createStaffAccessRepository(bootstrapPersistence),
        agency,
      );
    } finally {
      await bootstrapPersistence.destroy();
    }
    const head = await runMigrationChain(targetFor(database), productionChain);
    applied.push(...head.appliedMigrations);
    // Bootstrap again so the Owner role also carries capabilities seeded by later migrations.
    const secondPersistence = createAdminPersistence(database, "migrate-to-head-rebootstrap", 2);
    try {
      await bootstrapRootAgency(createStaffAccessRepository(secondPersistence), agency);
    } finally {
      await secondPersistence.destroy();
    }
    return {
      appliedMigrations: applied,
      currentVersion: head.currentVersion,
      rootAgency,
      ownerRoleId: rootAgency.ownerRoleId,
    };
  } finally {
    for (const directory of temporaryChains) await rm(directory, { recursive: true, force: true });
  }
};

export interface StaffFixture {
  readonly cookie: string;
  readonly principalId: string;
  readonly sessionId: string;
  readonly membershipId: string;
}

export type StaffSessionRegistry = Map<string, unknown>;

/** `StaffSessionResolver` backed by the fabricated-session registry. */
export const registrySessionResolver = (sessions: StaffSessionRegistry) => ({
  async resolveStaffSession(cookie: string) {
    return sessions.get(cookie) ?? null;
  },
});

/**
 * Creates a synthetic Staff principal, membership, role assignment, session and session context
 * through the owner connection. With `roleId` the principal reuses an existing role (for example
 * the bootstrapped Owner role); otherwise a dedicated role with exactly `permissionIds` is made.
 */
export const createStaff = async (
  owner: Client,
  sessions: StaffSessionRegistry,
  label: string,
  permissionIds: readonly string[],
  options: {
    readonly agencyId: string;
    readonly roleId?: string;
    readonly recentMfa?: boolean;
  },
): Promise<StaffFixture> => {
  const agencyId = options.agencyId;
  const principalId = `t-${label}-${randomUUID()}`;
  const sessionId = `t-session-${randomUUID()}`;
  const membershipId = createUuidV7();
  let roleId = options.roleId ?? "";
  await owner.query(
    'INSERT INTO staff_access.staff_user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1,$2,$3,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',
    [principalId, `Synthetic ${label}`, `${principalId}@${syntheticDomain}`],
  );
  if (roleId === "") {
    roleId = createUuidV7();
    await owner.query(
      'INSERT INTO staff_access.role (id, "agencyId", "displayName") VALUES ($1::uuid,$2::uuid,$3)',
      [roleId, agencyId, `Test ${label} ${roleId}`],
    );
    for (const permissionId of permissionIds) {
      await owner.query(
        `INSERT INTO staff_access.role_permission ("roleId", "permissionId", "scopeKind", "accessLevel")
         VALUES ($1::uuid, $2, 'AGENCY', 'ALL')`,
        [roleId, permissionId],
      );
    }
  }
  await owner.query(
    `INSERT INTO staff_access.staff_membership (id, "agencyId", "staffPrincipalId", state)
     VALUES ($1::uuid,$2::uuid,$3,'ACTIVE')`,
    [membershipId, agencyId, principalId],
  );
  await owner.query(
    `INSERT INTO staff_access.role_assignment (id, "agencyId", "membershipId", "roleId", "scopeKind", "active")
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'AGENCY',true)`,
    [createUuidV7(), agencyId, membershipId, roleId],
  );
  const expiresAt = new Date(Date.now() + 60 * 60 * 1_000);
  await owner.query(
    'INSERT INTO staff_access.staff_session (id, "expiresAt", token, "updatedAt", "userId") VALUES ($1,$2,$3,CURRENT_TIMESTAMP,$4)',
    [sessionId, expiresAt, randomBytes(32).toString("base64url"), principalId],
  );
  const epoch = (
    await owner.query<{ authorizationEpoch: string }>(
      'SELECT "authorizationEpoch"::text AS "authorizationEpoch" FROM staff_access.staff_membership WHERE id = $1::uuid',
      [membershipId],
    )
  ).rows[0];
  if (epoch === undefined) throw new Error("Synthetic membership disappeared");
  const recentMfa = options.recentMfa === true ? new Date() : null;
  await owner.query(
    `INSERT INTO staff_access.staff_session_context
       ("sessionId", "staffPrincipalId", "agencyId", "authorizationEpoch", "recentMfaVerifiedAt")
     VALUES ($1,$2,$3::uuid,$4,$5)`,
    [sessionId, principalId, agencyId, epoch.authorizationEpoch, recentMfa],
  );
  const cookie = `session=${sessionId}`;
  sessions.set(cookie, {
    sessionId,
    staffPrincipalId: principalId,
    agencyId,
    authorizationEpoch: BigInt(epoch.authorizationEpoch),
    expiresAtEpochMs: expiresAt.getTime(),
    recentMfaVerifiedAtEpochMs: recentMfa === null ? null : recentMfa.getTime(),
  });
  return { cookie, principalId, sessionId, membershipId };
};

export { createUuidV7, randomUUID };
