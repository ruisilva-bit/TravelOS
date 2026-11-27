import {
  authorizeStaffRequest,
  StaffAuthorizationError,
  isStaffPermissionId,
  buildTripPublicationCandidateFromSources,
  type StaffTripPreviewRepository,
  type TripSnapshotHashPort,
  type TripSnapshotValidatorPort,
  type StaffAuthorizationOperationProof,
  type StaffPermissionId,
} from "@travelos/backend-core";
import { sql, type Kysely } from "kysely";
import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { readStaffAuthorizationSnapshot } from "../staff-access/staff-access-repository.js";
import { publicationReaders } from "./publication-source-repository.js";

type DatabaseShape = Record<string, never>;
type Database = Kysely<DatabaseShape>;

export const PREVIEW_PERMISSIONS = [
  "trip.view",
  "trip.preview",
] as const satisfies readonly StaffPermissionId[];

export const assertStaffAuthorizationReadOnly = async (
  database: Database,
  authorization: StaffAuthorizationOperationProof,
  targetAgencyId: string,
  requiredPermissionIds: readonly StaffPermissionId[],
): Promise<void> => {
  const session = authorization?.session;
  if (
    typeof session !== "object" ||
    session === null ||
    typeof session.sessionId !== "string" ||
    typeof session.staffPrincipalId !== "string" ||
    typeof session.agencyId !== "string" ||
    typeof session.authorizationEpoch !== "bigint" ||
    !Number.isSafeInteger(authorization.nowEpochMs) ||
    authorization.nowEpochMs < 0 ||
    !Array.isArray(authorization.requiredPermissionIds) ||
    !authorization.requiredPermissionIds.every(isStaffPermissionId)
  ) {
    throw new StaffAuthorizationError("UNAUTHENTICATED");
  }
  const suppliedPermissions = new Set(authorization.requiredPermissionIds);
  if (
    suppliedPermissions.size !== requiredPermissionIds.length ||
    requiredPermissionIds.some((permissionId) => !suppliedPermissions.has(permissionId))
  ) {
    throw new StaffAuthorizationError("FORBIDDEN");
  }
  if (session.agencyId !== targetAgencyId) throw new StaffAuthorizationError("FORBIDDEN");
  const liveSession = (
    await sql<{
      readonly agencyId: string;
      readonly staffPrincipalId: string;
      readonly authorizationEpoch: string;
      readonly expiresAtEpochMs: number;
      readonly recentMfaVerifiedAtEpochMs: number | null;
      readonly databaseNowEpochMs: number;
    }>`
      WITH request_time AS (SELECT statement_timestamp() AS "now")
      SELECT context."agencyId"::text AS "agencyId",
             active_session."userId" AS "staffPrincipalId",
             context."authorizationEpoch"::text AS "authorizationEpoch",
             (EXTRACT(EPOCH FROM active_session."expiresAt") * 1000)::double precision AS "expiresAtEpochMs",
             (EXTRACT(EPOCH FROM context."recentMfaVerifiedAt") * 1000)::double precision AS "recentMfaVerifiedAtEpochMs",
             (EXTRACT(EPOCH FROM request_time."now") * 1000)::double precision AS "databaseNowEpochMs"
        FROM "staff_access"."staff_session" AS active_session
        CROSS JOIN request_time
        JOIN "staff_access"."staff_session_context" AS context
          ON context."sessionId" = active_session."id"
         AND context."staffPrincipalId" = active_session."userId"
       WHERE active_session."id" = ${session.sessionId}
         AND active_session."userId" = ${session.staffPrincipalId}
         AND active_session."expiresAt" > request_time."now"
         AND context."agencyId" = ${targetAgencyId}::uuid
         AND context."authorizationEpoch" = ${session.authorizationEpoch}
    `.execute(database)
  ).rows[0];
  if (liveSession === undefined) throw new StaffAuthorizationError("UNAUTHENTICATED");
  const currentSession = {
    sessionId: session.sessionId,
    staffPrincipalId: liveSession.staffPrincipalId,
    agencyId: liveSession.agencyId,
    authorizationEpoch: BigInt(liveSession.authorizationEpoch),
    expiresAtEpochMs: liveSession.expiresAtEpochMs,
    recentMfaVerifiedAtEpochMs: liveSession.recentMfaVerifiedAtEpochMs,
  };
  const snapshot = await readStaffAuthorizationSnapshot(
    database,
    currentSession.staffPrincipalId,
    currentSession.agencyId,
  );
  if (snapshot === null) throw new StaffAuthorizationError("FORBIDDEN");
  for (const permissionId of requiredPermissionIds) {
    const decision = authorizeStaffRequest({
      session: currentSession,
      snapshot,
      permissionId,
      target: {
        agencyId: targetAgencyId,
        organizationUnitAncestorIds: [],
        requiredAccessLevel: "ALL",
      },
      nowEpochMs: liveSession.databaseNowEpochMs,
      recentMfaMaximumAgeMs: null,
    });
    if (decision.result === "DENY") throw new StaffAuthorizationError("FORBIDDEN");
  }
};

export const createPostgresStaffTripPreviewRepository = (
  persistence: PostgresPersistence<DatabaseShape>,
  hasher: TripSnapshotHashPort,
  validator: TripSnapshotValidatorPort,
): StaffTripPreviewRepository => {
  const repository: StaffTripPreviewRepository = {
    previewTrip(agencyId, tripId, authorization) {
      return persistence.withConnection((database) =>
        database
          .transaction()
          .setIsolationLevel("repeatable read")
          .setAccessMode("read only")
          .execute(async (transaction) => {
            await assertStaffAuthorizationReadOnly(
              transaction,
              authorization,
              agencyId,
              PREVIEW_PERMISSIONS,
            );
            return buildTripPublicationCandidateFromSources(
              publicationReaders(transaction),
              hasher,
              validator,
              agencyId,
              tripId,
            );
          }),
      );
    },
  };
  return Object.freeze(repository);
};
