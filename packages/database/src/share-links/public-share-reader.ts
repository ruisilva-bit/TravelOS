import type { PublicShareReaderPort } from "@travelos/backend-core";
import { sql } from "kysely";
import type { PostgresPersistence } from "../postgres/postgres-persistence.js";

/**
 * Public, unauthenticated read path. It runs as the admin runtime role and ONLY calls the
 * SECURITY DEFINER function `trip_ops.read_share_snapshot`, which already filters on token hash,
 * revocation and expiry. No table privilege on `share_link` is exercised.
 */
export const createPostgresPublicShareReader = (
  persistence: PostgresPersistence<Record<string, never>>,
): PublicShareReaderPort => ({
  async readByTokenHash(tokenHash) {
    const rows = await persistence.withConnection(
      async (database) =>
        (
          await sql<{ readonly canonicalPayload: string }>`
            SELECT "canonicalPayload" FROM "trip_ops"."read_share_snapshot"(${Buffer.from(tokenHash)})
          `.execute(database)
        ).rows,
    );
    const row = rows[0];
    return row === undefined ? null : { canonicalPayload: row.canonicalPayload };
  },
});
