import {
  asOpaqueId,
  InputValidationError,
  OptimisticConflictError,
  type AgencyProfile,
  type AgencyProfileDraft,
  type AgencyProfileRepository,
  type OpaqueId,
  type StaffAuthorizationOperationProof,
  type StaffPermissionId,
} from "@travelos/backend-core";
import { sql, type Kysely } from "kysely";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { assertStaffAuthorizationInTransaction } from "../trip-operations/operational-slice-repository.js";

type DatabaseShape = Record<string, never>;

const PERMISSIONS = Object.freeze({
  VIEW: Object.freeze(["agency.view"] as const satisfies readonly StaffPermissionId[]),
  MANAGE: Object.freeze(["agency.manage_settings"] as const satisfies readonly StaffPermissionId[]),
});

interface AgencyProfileRow {
  readonly agencyId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly website: string | null;
  readonly lockVersion: string;
}

const readRow = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
): Promise<AgencyProfile | null> => {
  const row = (
    await sql<AgencyProfileRow>`
      SELECT agency."id"::text AS "agencyId", agency."displayName", agency."email",
             agency."phone", agency."website", agency."lockVersion"::text AS "lockVersion"
        FROM "organization"."agency" AS agency
       WHERE agency."id" = ${agencyId}::uuid
    `.execute(database)
  ).rows[0];
  if (row === undefined) return null;
  return {
    agencyId: asOpaqueId(row.agencyId),
    displayName: row.displayName,
    email: row.email,
    phone: row.phone,
    website: row.website,
    lockVersion: BigInt(row.lockVersion),
  };
};

/** Agency profile reads and compare-and-swap writes; authorization is re-checked in each transaction. */
export const createPostgresAgencyProfileRepository = (
  persistence: PostgresPersistence<DatabaseShape>,
): AgencyProfileRepository => {
  const inTransaction = <Result>(
    agencyId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
    permissions: readonly StaffPermissionId[],
    work: (database: Kysely<DatabaseShape>) => Promise<Result>,
  ): Promise<Result> =>
    persistence.transaction.runInTransaction(async (context) =>
      persistence.withTransactionContext(context, async (database) => {
        await assertStaffAuthorizationInTransaction(database, authorization, agencyId, permissions);
        return work(database);
      }),
    );

  return {
    async readProfile(agencyId, authorization) {
      return inTransaction(agencyId, authorization, PERMISSIONS.VIEW, (database) =>
        readRow(database, agencyId),
      );
    },

    async updateProfile(agencyId, expectedLockVersion, draft: AgencyProfileDraft, authorization) {
      return inTransaction(agencyId, authorization, PERMISSIONS.MANAGE, async (database) => {
        const outcome = await sql<{ readonly outcome: string }>`
          SELECT "organization"."update_agency_profile"(
            ${agencyId}::uuid, ${expectedLockVersion.toString()}::integer,
            ${draft.displayName}::text, ${draft.email}::text, ${draft.phone}::text,
            ${draft.website}::text
          ) AS "outcome"
        `
          .execute(database)
          .catch((error: unknown) => {
            if (error instanceof Error && (error as { readonly code?: unknown }).code === "22023") {
              throw new InputValidationError(error.message);
            }
            throw error;
          });
        const result = outcome.rows[0]?.outcome;
        if (result === "NOT_FOUND") return null;
        if (result === "STALE") throw new OptimisticConflictError();
        if (result !== "UPDATED") throw new Error("Agency profile update returned no outcome");
        return readRow(database, agencyId);
      });
    },
  };
};
