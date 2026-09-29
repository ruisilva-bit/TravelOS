import { AsyncLocalStorage } from "node:async_hooks";

import type { TransactionContext, TransactionPort, TransactionWork } from "@travelos/backend-core";
import { NestedTransactionNotSupportedError } from "@travelos/backend-core";
import { Kysely, PostgresDialect, type Transaction } from "kysely";
import { Pool, type PoolConfig } from "pg";

export type PostgresTlsPolicy =
  | { readonly mode: "DISABLED_LOOPBACK_ONLY" }
  | {
      readonly mode: "VERIFY_FULL";
      readonly certificateAuthority: string;
    };

export interface PostgresConnectionSettings {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password?: string;
  readonly tls: PostgresTlsPolicy;
  readonly applicationName: string;
  readonly maxConnections?: number;
  readonly connectionTimeoutMs?: number;
  readonly statementTimeoutMs?: number;
  readonly idleInTransactionTimeoutMs?: number;
}

export interface PostgresPoolMetrics {
  readonly totalConnections: number;
  readonly idleConnections: number;
  readonly waitingRequests: number;
}

export interface PostgresPersistence<Database> {
  readonly transaction: TransactionPort;
  withConnection<Result>(work: (database: Kysely<Database>) => Promise<Result>): Promise<Result>;
  withTransactionContext<Result>(
    context: TransactionContext,
    work: (database: Kysely<Database>) => Promise<Result>,
  ): Promise<Result>;
  poolMetrics(): PostgresPoolMetrics;
  destroy(): Promise<void>;
}

const isLoopbackHost = (host: string): boolean =>
  host === "127.0.0.1" || host === "::1" || host === "localhost";

const assertConnectionSettings = (settings: PostgresConnectionSettings): void => {
  if (settings.tls.mode === "DISABLED_LOOPBACK_ONLY" && !isLoopbackHost(settings.host)) {
    throw new Error("TLS may be disabled only for a loopback PostgreSQL target");
  }
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65_535) {
    throw new Error("PostgreSQL port must be an integer from 1 to 65535");
  }
  if ((settings.maxConnections ?? 10) < 1) {
    throw new Error("PostgreSQL maxConnections must be at least one");
  }
};

class KyselyTransactionContext<Database> implements TransactionContext {
  readonly transactionContextKind = "travelos.transaction-context" as const;

  constructor(
    readonly owner: symbol,
    readonly database: Transaction<Database>,
  ) {}
}

class KyselyTransactionPort<Database> implements TransactionPort {
  private readonly activeTransaction = new AsyncLocalStorage<boolean>();
  private readonly owner = Symbol("travelos.postgres-transaction-owner");

  constructor(private readonly database: Kysely<Database>) {}

  async runInTransaction<Result>(work: TransactionWork<Result>): Promise<Result> {
    if (this.activeTransaction.getStore() === true) {
      throw new NestedTransactionNotSupportedError();
    }

    // Establish the scope before invoking the vendor transaction machinery.
    // Re-entry fails above, without acquiring another connection or savepoint.
    return this.activeTransaction.run(true, () =>
      this.database
        .transaction()
        .execute((transaction) => work(new KyselyTransactionContext(this.owner, transaction))),
    );
  }

  resolve(context: TransactionContext): Transaction<Database> {
    if (!(context instanceof KyselyTransactionContext) || context.owner !== this.owner) {
      throw new Error(
        "Transaction context does not belong to this PostgreSQL persistence instance",
      );
    }
    return context.database;
  }
}

class KyselyPostgresPersistence<Database> implements PostgresPersistence<Database> {
  readonly transaction: TransactionPort;
  private readonly transactionImplementation: KyselyTransactionPort<Database>;
  private destroyed = false;

  constructor(
    private readonly database: Kysely<Database>,
    private readonly pool: Pool,
  ) {
    this.transactionImplementation = new KyselyTransactionPort(database);
    this.transaction = this.transactionImplementation;
  }

  async withConnection<Result>(
    work: (database: Kysely<Database>) => Promise<Result>,
  ): Promise<Result> {
    if (this.destroyed) throw new Error("PostgreSQL persistence has been destroyed");
    return work(this.database);
  }

  async withTransactionContext<Result>(
    context: TransactionContext,
    work: (database: Kysely<Database>) => Promise<Result>,
  ): Promise<Result> {
    if (this.destroyed) throw new Error("PostgreSQL persistence has been destroyed");
    return work(this.transactionImplementation.resolve(context));
  }

  poolMetrics(): PostgresPoolMetrics {
    return {
      totalConnections: this.pool.totalCount,
      idleConnections: this.pool.idleCount,
      waitingRequests: this.pool.waitingCount,
    };
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    await this.database.destroy();
  }
}

export const createPostgresPersistence = <Database>(
  settings: PostgresConnectionSettings,
): PostgresPersistence<Database> => {
  assertConnectionSettings(settings);
  const { password } = settings;

  const poolConfiguration: PoolConfig = {
    host: settings.host,
    port: settings.port,
    database: settings.database,
    user: settings.user,
    ...(password === undefined ? {} : { password }),
    application_name: settings.applicationName,
    max: settings.maxConnections ?? 10,
    connectionTimeoutMillis: settings.connectionTimeoutMs ?? 5_000,
    statement_timeout: settings.statementTimeoutMs ?? 30_000,
    idle_in_transaction_session_timeout: settings.idleInTransactionTimeoutMs ?? 30_000,
    options: "-c search_path=pg_catalog",
    ssl:
      settings.tls.mode === "VERIFY_FULL"
        ? { rejectUnauthorized: true, ca: settings.tls.certificateAuthority }
        : false,
  };
  const pool = new Pool(poolConfiguration);
  const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  return new KyselyPostgresPersistence(database, pool);
};
