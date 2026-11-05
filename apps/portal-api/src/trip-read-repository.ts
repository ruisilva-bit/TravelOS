import { PortalTripSnapshotV1Schema } from "@travelos/contracts/portal";
import type {
  CurrentAuthorizedPortalTripListReader,
  CurrentPublishedPortalTripSnapshotReader,
} from "@travelos/portal-safe-core/customer-presentation";
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

interface AuthorizedPortalTripListRow {
  readonly tripId: string;
  readonly activePublicationId: string | null;
  readonly schemaVersion: number | null;
  readonly canonicalPayload: string | null;
}

/**
 * Lists only current grant-authorized snapshot projections and no-publication markers.
 * This single statement rechecks the Portal session epoch, active grant, and snapshot pointer;
 * it deliberately has no dependency on mutable workspace tables.
 */
export const createPostgresPortalAuthorizedTripListReader = (
  database: Kysely<PortalTripSnapshotDatabase>,
): CurrentAuthorizedPortalTripListReader => ({
  async listCurrentAuthorizedTrips(query) {
    const result = await sql<AuthorizedPortalTripListRow>`
      SELECT access_grant."tripId"::text AS "tripId",
             pointer."activePublicationId"::text AS "activePublicationId",
             version."schemaVersion" AS "schemaVersion",
             snapshot."canonicalPayload" AS "canonicalPayload"
        FROM "portal_access"."portal_session_context" AS session
        JOIN "portal_access"."portal_principal_context" AS principal
          ON principal."agencyId" = session."agencyId"
         AND principal."portalPrincipalId" = session."portalPrincipalId"
         AND principal."authorizationEpoch" = session."authorizationEpoch"
        JOIN "portal_access"."trip_access_grant" AS access_grant
          ON access_grant."agencyId" = session."agencyId"
         AND access_grant."portalPrincipalId" = session."portalPrincipalId"
         AND access_grant."grantState" = 'ACTIVE'
         AND access_grant."revokedAt" IS NULL
         AND (access_grant."expiresAt" IS NULL OR access_grant."expiresAt" > statement_timestamp())
         AND 'trip.view_current' = ANY(access_grant."capabilities")
        LEFT JOIN "trip_ops"."publication_pointer" AS pointer
          ON pointer."agencyId" = access_grant."agencyId"
         AND pointer."tripId" = access_grant."tripId"
        LEFT JOIN "trip_ops"."publication_version" AS version
          ON version."publicationId" = pointer."activePublicationId"
         AND version."agencyId" = pointer."agencyId"
         AND version."tripId" = pointer."tripId"
        LEFT JOIN "trip_ops"."publication_snapshot" AS snapshot
          ON snapshot."publicationId" = version."publicationId"
         AND snapshot."agencyId" = version."agencyId"
         AND snapshot."tripId" = version."tripId"
       WHERE session."sessionId" = ${query.portalSessionId}
         AND session."portalPrincipalId" = ${query.portalPrincipalId}
         AND session."agencyId" = ${query.agencyId}::uuid
         AND session."authorizationEpoch" = ${query.authorizationEpoch}::bigint
         AND (${query.cursor}::uuid IS NULL OR access_grant."tripId" > ${query.cursor}::uuid)
       ORDER BY access_grant."tripId" ASC
       LIMIT ${query.limit + 1}
    `.execute(database);

    const hasMore = result.rows.length > query.limit;
    const pageRows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
    const items = pageRows.map((row) => {
      if (row.activePublicationId === null) {
        return { tripId: row.tripId, publicationState: "NO_PUBLICATION" as const };
      }
      if (row.schemaVersion !== 1 || row.canonicalPayload === null) {
        throw new Error("Portal published snapshot is invalid");
      }
      return {
        tripId: row.tripId,
        publicationState: "PUBLISHED" as const,
        snapshot: parseAllowlistedSnapshot(row.canonicalPayload),
      };
    });

    return {
      items,
      nextCursor: hasMore ? (pageRows.at(-1)?.tripId ?? null) : null,
    };
  },
});
