import { PortalTripSnapshotV1Schema } from "@travelos/contracts/portal";
import type { CurrentPublishedPortalTripSnapshotReader } from "@travelos/portal-safe-core/customer-presentation";
import { sql, type Kysely } from "kysely";

interface PortalTripSnapshotDatabase {
  readonly __no_table_types: never;
}

const parseAllowlistedSnapshot = (canonicalPayload: string) => {
  let candidate: unknown;
  try {
    candidate = JSON.parse(canonicalPayload);
  } catch {
    throw new Error("Portal published snapshot is invalid");
  }

  const parsed = PortalTripSnapshotV1Schema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error("Portal published snapshot is invalid");
  }
  return parsed.data;
};

/**
 * Reads only the active immutable V1 projection after rechecking Portal session epoch and grant.
 * The single statement makes revocation, expiry, and publication selection one authorization read.
 */
export const createPostgresPortalTripSnapshotReader = (
  database: Kysely<PortalTripSnapshotDatabase>,
): CurrentPublishedPortalTripSnapshotReader => ({
  async readCurrentPublishedTripSnapshot(query) {
    const result = await sql<{ readonly canonicalPayload: string }>`
      SELECT snapshot."canonicalPayload" AS "canonicalPayload"
        FROM "portal_access"."portal_session_context" AS session
        JOIN "portal_access"."portal_principal_context" AS principal
          ON principal."agencyId" = session."agencyId"
         AND principal."portalPrincipalId" = session."portalPrincipalId"
         AND principal."authorizationEpoch" = session."authorizationEpoch"
        JOIN "portal_access"."trip_access_grant" AS access_grant
          ON access_grant."agencyId" = session."agencyId"
         AND access_grant."portalPrincipalId" = session."portalPrincipalId"
         AND access_grant."tripId" = ${query.tripId}::uuid
         AND access_grant."grantState" = 'ACTIVE'
         AND access_grant."revokedAt" IS NULL
         AND (access_grant."expiresAt" IS NULL OR access_grant."expiresAt" > statement_timestamp())
         AND 'trip.view_current' = ANY(access_grant."capabilities")
        JOIN "trip_ops"."publication_pointer" AS pointer
          ON pointer."agencyId" = session."agencyId"
         AND pointer."tripId" = access_grant."tripId"
        JOIN "trip_ops"."publication_version" AS version
          ON version."publicationId" = pointer."activePublicationId"
         AND version."agencyId" = pointer."agencyId"
         AND version."tripId" = pointer."tripId"
         AND version."schemaVersion" = 1
        JOIN "trip_ops"."publication_snapshot" AS snapshot
          ON snapshot."publicationId" = version."publicationId"
         AND snapshot."agencyId" = version."agencyId"
         AND snapshot."tripId" = version."tripId"
       WHERE session."sessionId" = ${query.portalSessionId}
         AND session."portalPrincipalId" = ${query.portalPrincipalId}
         AND session."agencyId" = ${query.agencyId}::uuid
         AND session."authorizationEpoch" = ${query.authorizationEpoch}::bigint
       LIMIT 1
    `.execute(database);

    const row = result.rows[0];
    return row === undefined ? null : parseAllowlistedSnapshot(row.canonicalPayload);
  },
});
