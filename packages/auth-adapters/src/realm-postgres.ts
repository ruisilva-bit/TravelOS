import { Kysely, PostgresDialect } from "kysely";
import { Pool, type PoolConfig } from "pg";

export type AuthRealmPostgresTlsPolicy =
  | { readonly mode: "DISABLED_LOOPBACK_ONLY" }
  | { readonly mode: "VERIFY_FULL"; readonly certificateAuthority: string };

export interface AuthRealmPostgresConnectionSettings {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly tls: AuthRealmPostgresTlsPolicy;
  readonly applicationName: string;
  readonly maxConnections?: number;
}

export interface AuthRealmPostgresDatabase {
  readonly database: Kysely<Record<string, never>>;
  destroy(): Promise<void>;
}

const isLoopbackHost = (host: string): boolean =>
  host === "127.0.0.1" || host === "::1" || host === "localhost";

/**
 * Opens a realm-scoped PostgreSQL adapter without exposing a general persistence/repository API.
 * Portal composition uses this to keep its dependency graph identity/auth-only.
 */
export const createAuthRealmPostgresDatabase = (
  settings: AuthRealmPostgresConnectionSettings,
): AuthRealmPostgresDatabase => {
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65_535) {
    throw new Error("Auth realm PostgreSQL port must be an integer from 1 to 65535");
  }
  if (settings.tls.mode === "DISABLED_LOOPBACK_ONLY" && !isLoopbackHost(settings.host)) {
    throw new Error("Auth realm PostgreSQL TLS may be disabled only for a loopback target");
  }
  const poolConfiguration: PoolConfig = {
    host: settings.host,
    port: settings.port,
    database: settings.database,
    user: settings.user,
    password: settings.password,
    application_name: settings.applicationName,
    max: settings.maxConnections ?? 10,
    options: "-c search_path=pg_catalog",
    ssl:
      settings.tls.mode === "VERIFY_FULL"
        ? { rejectUnauthorized: true, ca: settings.tls.certificateAuthority }
        : false,
  };
  const pool = new Pool(poolConfiguration);
  const database = new Kysely<Record<string, never>>({
    dialect: new PostgresDialect({ pool }),
  });
  return { database, destroy: () => database.destroy() };
};
