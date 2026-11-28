import { sql } from "kysely";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";

type DatabaseShape = Record<string, never>;

/**
 * Worker-scoped quote expiry. The worker role holds EXECUTE on job_runtime.expire_quotes only; the
 * SECURITY DEFINER function performs the SENT to EXPIRED change and returns the number of quotes.
 */
export const createPostgresQuoteExpiryPort = (
  persistence: PostgresPersistence<DatabaseShape>,
): { readonly expireQuotes: () => Promise<number> } => ({
  async expireQuotes() {
    return persistence.withConnection(async (database) => {
      const row = (
        await sql<{ readonly expired: number }>`
          SELECT job_runtime.expire_quotes(now()) AS "expired"
        `.execute(database)
      ).rows[0];
      if (row === undefined || !Number.isSafeInteger(row.expired) || row.expired < 0) {
        throw new Error("Quote expiry returned no count");
      }
      return row.expired;
    });
  },
});
