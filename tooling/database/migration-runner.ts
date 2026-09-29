import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { PG_MIGRATE_LOCK_ID, runner } from "node-pg-migrate";
import { Client } from "pg";

export const MIGRATION_POLICY = Object.freeze({
  authority: "TravelOS node-pg-migrate 9.0.0 chain",
  direction: "up" as const,
  downPolicy: "disabled; rollback is compatible artifact rollback, restore, or forward fix",
  migrationsSchema: "travelos_meta",
  migrationsTable: "schema_migrations",
  checkOrder: true,
  createMigrationsSchema: true,
  createSchema: false,
  singleTransaction: true,
  advisoryLock: true,
  advisoryLockMode: "fail" as const,
  advisoryLockValue: PG_MIGRATE_LOCK_ID,
  dryRun: false,
  fake: false,
  decamelize: false,
  timestamp: false,
  useGlob: false,
});

export interface MigrationTarget {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly migratorRole: string;
  readonly ownerRole: string;
  readonly password?: string;
  readonly tls:
    | { readonly mode: "DISABLED_LOOPBACK_ONLY" }
    | { readonly mode: "VERIFY_FULL"; readonly certificateAuthority: string };
  readonly allowTrustAuthenticationForTests?: boolean;
}

export interface MigrationChain {
  readonly directory: string;
  readonly checksumManifestPath: string;
}

export interface MigrationLedgerEntry {
  readonly name: string;
  readonly runOn: string;
}

export interface MigrationRunResult {
  readonly schemaVersion: 1;
  readonly result: "PASS";
  readonly runId: string;
  readonly target: {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly sessionRole: string;
    readonly effectiveRole: string;
  };
  readonly policy: typeof MIGRATION_POLICY;
  readonly postgresqlVersionNumber: number;
  readonly verifiedMigrationCount: number;
  readonly appliedMigrations: readonly string[];
  readonly ledger: readonly MigrationLedgerEntry[];
  readonly currentVersion: string | null;
  readonly durationMs: number;
  readonly diagnostics: readonly string[];
}

interface ChecksumManifest {
  readonly schemaVersion: 1;
  readonly algorithm: "sha256";
  readonly migrations: readonly {
    readonly file: string;
    readonly sha256: string;
  }[];
}

const rolePattern = /^[a-z][a-z0-9_]{2,62}$/;
const quoteIdentifier = (identifier: string): string => {
  if (!rolePattern.test(identifier)) throw new Error(`Unsafe PostgreSQL identifier: ${identifier}`);
  return `"${identifier.replaceAll('"', '""')}"`;
};

const sanitizeDiagnostic = (value: unknown, password?: string): string => {
  let message = value instanceof Error ? value.message : String(value);
  if (password) message = message.replaceAll(password, "[REDACTED]");
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/password\s*[=:]\s*[^\s,;]+/gi, "password=[REDACTED]")
    .slice(0, 2_000);
};

export const verifyMigrationChain = async (chain: MigrationChain) => {
  const manifest = JSON.parse(
    await readFile(path.resolve(chain.checksumManifestPath), "utf8"),
  ) as ChecksumManifest;
  if (manifest.schemaVersion !== 1 || manifest.algorithm !== "sha256") {
    throw new Error("Unsupported migration checksum manifest");
  }

  const actualFiles = (await readdir(path.resolve(chain.directory)))
    .filter((file) => /^\d+_[a-z0-9_]+\.cjs$/.test(file))
    .sort();
  const declaredFiles = manifest.migrations.map(({ file }) => file).toSorted();
  if (JSON.stringify(actualFiles) !== JSON.stringify(declaredFiles)) {
    throw new Error("Migration checksum manifest and directory contents differ");
  }

  const verified = [];
  for (const record of manifest.migrations) {
    if (!/^[0-9a-f]{64}$/.test(record.sha256)) {
      throw new Error(`Invalid SHA-256 declaration for migration ${record.file}`);
    }
    const bytes = await readFile(path.join(path.resolve(chain.directory), record.file));
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== record.sha256) {
      throw new Error(`Migration checksum mismatch for ${record.file}`);
    }
    verified.push({ file: record.file, sha256: actualSha256 });
  }
  return { schemaVersion: 1 as const, result: "PASS" as const, migrations: verified };
};

const createClient = (target: MigrationTarget): Client => {
  if (target.tls.mode === "DISABLED_LOOPBACK_ONLY") {
    if (!["127.0.0.1", "::1", "localhost"].includes(target.host)) {
      throw new Error("TLS may be disabled only for a loopback migration target");
    }
  }
  if (!target.password && target.allowTrustAuthenticationForTests !== true) {
    throw new Error("Migration authentication requires injected credential material");
  }
  const { password } = target;
  return new Client({
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.migratorRole,
    ...(password === undefined ? {} : { password }),
    application_name: "travelos-migrator",
    options: "-c search_path=pg_catalog",
    ssl:
      target.tls.mode === "VERIFY_FULL"
        ? { rejectUnauthorized: true, ca: target.tls.certificateAuthority }
        : false,
  });
};

const inspectSession = async (client: Client, target: MigrationTarget) => {
  const sessionResult = await client.query<{
    current_user: string;
    session_user: string;
    current_database: string;
    server_version_num: string;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
  }>(`
    SELECT current_user,
           session_user,
           current_database(),
           current_setting('server_version_num') AS server_version_num,
           role.rolsuper,
           role.rolcreatedb,
           role.rolcreaterole,
           role.rolreplication,
           role.rolbypassrls
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  `);
  const session = sessionResult.rows[0];
  if (!session) throw new Error("Migration session role inspection returned no row");
  if (
    session.current_user !== target.migratorRole ||
    session.session_user !== target.migratorRole
  ) {
    throw new Error("Migration session is not using the configured migrator role");
  }
  if (session.current_database !== target.database) {
    throw new Error("Migration session connected to an unexpected database");
  }
  if (
    session.rolsuper ||
    session.rolcreatedb ||
    session.rolcreaterole ||
    session.rolreplication ||
    session.rolbypassrls
  ) {
    throw new Error("Migrator role has forbidden cluster-level privileges");
  }
  const versionNumber = Number.parseInt(session.server_version_num, 10);
  if (Math.floor(versionNumber / 10_000) !== 18) {
    throw new Error(`PostgreSQL major 18 required; observed ${session.server_version_num}`);
  }
  return versionNumber;
};

const assumeOwnerRole = async (client: Client, target: MigrationTarget): Promise<void> => {
  await client.query(`SET ROLE ${quoteIdentifier(target.ownerRole)}`);
  await client.query("SET search_path TO pg_catalog");
  const result = await client.query<{
    current_user: string;
    session_user: string;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    database_owner: string;
    rolreplication: boolean;
    rolbypassrls: boolean;
  }>(`
    SELECT current_user,
           session_user,
           role.rolsuper,
           role.rolcreatedb,
           role.rolcreaterole,
           role.rolreplication,
           role.rolbypassrls,
           pg_catalog.pg_get_userbyid(database.datdba) AS database_owner
      FROM pg_catalog.pg_roles AS role
      JOIN pg_catalog.pg_database AS database ON database.datname = current_database()
     WHERE role.rolname = current_user
  `);
  const ownership = result.rows[0];
  if (!ownership) throw new Error("Migration owner-role inspection returned no row");
  if (
    ownership.current_user !== target.ownerRole ||
    ownership.session_user !== target.migratorRole ||
    ownership.database_owner !== target.ownerRole
  ) {
    throw new Error("Migration role delegation or database ownership is inconsistent");
  }
  if (
    ownership.rolsuper ||
    ownership.rolcreatedb ||
    ownership.rolcreaterole ||
    ownership.rolreplication ||
    ownership.rolbypassrls
  ) {
    throw new Error("TravelOS owner role has unnecessary cluster-level privileges");
  }
};

const readLedger = async (client: Client): Promise<MigrationLedgerEntry[]> => {
  const ledger = await client.query<{ name: string; run_on: Date }>(`
    SELECT name, run_on
      FROM "travelos_meta"."schema_migrations"
     ORDER BY run_on, id
  `);
  return ledger.rows.map((entry) => ({ name: entry.name, runOn: entry.run_on.toISOString() }));
};

export const runMigrationChain = async (
  target: MigrationTarget,
  chain: MigrationChain,
): Promise<MigrationRunResult> => {
  const started = performance.now();
  const runId = randomUUID();
  const verification = await verifyMigrationChain(chain);
  const client = createClient(target);
  const diagnostics: string[] = [];
  let connected = false;

  try {
    await client.connect();
    connected = true;
    const versionNumber = await inspectSession(client, target);
    await assumeOwnerRole(client, target);

    const applied = await runner({
      dbClient: client,
      dir: path.resolve(chain.directory),
      direction: MIGRATION_POLICY.direction,
      count: Number.POSITIVE_INFINITY,
      migrationsSchema: MIGRATION_POLICY.migrationsSchema,
      migrationsTable: MIGRATION_POLICY.migrationsTable,
      createMigrationsSchema: MIGRATION_POLICY.createMigrationsSchema,
      createSchema: MIGRATION_POLICY.createSchema,
      checkOrder: MIGRATION_POLICY.checkOrder,
      singleTransaction: MIGRATION_POLICY.singleTransaction,
      noLock: !MIGRATION_POLICY.advisoryLock,
      advisoryLockMode: MIGRATION_POLICY.advisoryLockMode,
      lockValue: MIGRATION_POLICY.advisoryLockValue,
      dryRun: MIGRATION_POLICY.dryRun,
      fake: MIGRATION_POLICY.fake,
      decamelize: MIGRATION_POLICY.decamelize,
      timestamp: MIGRATION_POLICY.timestamp,
      useGlob: MIGRATION_POLICY.useGlob,
      ignorePattern: "^checksums\\.json$",
      verbose: false,
      logger: {
        debug: (message) => diagnostics.push(sanitizeDiagnostic(message, target.password)),
        info: (message) => diagnostics.push(sanitizeDiagnostic(message, target.password)),
        warn: (message) => diagnostics.push(sanitizeDiagnostic(message, target.password)),
        error: (message) => diagnostics.push(sanitizeDiagnostic(message, target.password)),
      },
    });
    const ledger = await readLedger(client);
    return {
      schemaVersion: 1,
      result: "PASS",
      runId,
      target: {
        host: target.host,
        port: target.port,
        database: target.database,
        sessionRole: target.migratorRole,
        effectiveRole: target.ownerRole,
      },
      policy: MIGRATION_POLICY,
      postgresqlVersionNumber: versionNumber,
      verifiedMigrationCount: verification.migrations.length,
      appliedMigrations: applied.map((migration) => migration.name),
      ledger,
      currentVersion: ledger.at(-1)?.name ?? null,
      durationMs: Math.round(performance.now() - started),
      diagnostics,
    };
  } catch (error) {
    const sanitized = sanitizeDiagnostic(error, target.password);
    throw new Error(`TravelOS migration run ${runId} failed: ${sanitized}`, { cause: error });
  } finally {
    if (connected) {
      await client.query("RESET ROLE").catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }
};

export const inspectMigrationStatus = async (
  target: MigrationTarget,
  chain: MigrationChain,
): Promise<Omit<MigrationRunResult, "appliedMigrations" | "durationMs" | "diagnostics">> => {
  const runId = randomUUID();
  const verification = await verifyMigrationChain(chain);
  const client = createClient(target);
  await client.connect();
  try {
    const versionNumber = await inspectSession(client, target);
    await assumeOwnerRole(client, target);
    const exists = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('travelos_meta.schema_migrations') IS NOT NULL AS exists`,
    );
    const ledger = exists.rows[0]?.exists ? await readLedger(client) : [];
    return {
      schemaVersion: 1,
      result: "PASS",
      runId,
      target: {
        host: target.host,
        port: target.port,
        database: target.database,
        sessionRole: target.migratorRole,
        effectiveRole: target.ownerRole,
      },
      policy: MIGRATION_POLICY,
      postgresqlVersionNumber: versionNumber,
      verifiedMigrationCount: verification.migrations.length,
      ledger,
      currentVersion: ledger.at(-1)?.name ?? null,
    };
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    await client.end().catch(() => undefined);
  }
};
