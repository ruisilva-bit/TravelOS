import {
  OWNER_ROLE_TEMPLATE_KEY,
  PERMISSION_REGISTRY_VERSION,
  ROOT_AGENCY_OWNER_TEMPLATE,
  permissionDefinitionFor,
  type RootAgencyBootstrapInput,
  type RootAgencyBootstrapPort,
  type RootAgencyBootstrapResult,
  type StaffAuthorizationSnapshot,
} from "@travelos/backend-core";
import { sql, type Kysely } from "kysely";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { createUuidV7 } from "../uuidv7.js";

type DatabaseShape = Record<string, never>;

export interface FirstOwnerInvitationInput {
  readonly agencyId: string;
  readonly targetEmail: string;
  readonly tokenDigest: string;
  readonly expiresAt: Date;
  readonly operatorIdentity: string;
}

export type FirstOwnerInvitationResult =
  | { readonly result: "ISSUED"; readonly invitationId: string; readonly agencyId: string }
  | { readonly result: "ALREADY_ISSUED" | "ALREADY_CONSUMED" | "ALREADY_EXPIRED" };

export type FirstOwnerInvitationInspection =
  | {
      readonly result: "VALID";
      readonly invitationId: string;
      readonly agencyId: string;
      readonly targetEmail: string;
    }
  | { readonly result: "INVALID" | "EXPIRED" | "CONSUMED" };

export type FirstOwnerInvitationConsumption =
  | { readonly result: "CONSUMED"; readonly membershipId: string; readonly agencyId: string }
  | { readonly result: "INVALID" | "EXPIRED" | "CONSUMED" };

export interface FirstOwnerInvitationConsumptionInput {
  readonly tokenDigest: string;
  readonly staffPrincipalId: string;
  readonly operatorIdentity: string;
}

export interface StaffAccessRepository extends RootAgencyBootstrapPort {
  getStaffAuthorizationSnapshot(
    staffPrincipalId: string,
    agencyId: string,
  ): Promise<StaffAuthorizationSnapshot | null>;
  findStaffPrincipalIdByEmail(email: string): Promise<string | null>;
  issueFirstOwnerInvitation(input: FirstOwnerInvitationInput): Promise<FirstOwnerInvitationResult>;
  inspectFirstOwnerInvitation(tokenDigest: string): Promise<FirstOwnerInvitationInspection>;
  consumeFirstOwnerInvitation(
    input: FirstOwnerInvitationConsumptionInput,
  ): Promise<FirstOwnerInvitationConsumption>;
}

interface AgencyRow {
  readonly id: string;
  readonly bootstrapReference: string;
  readonly slug: string;
}

const asSingle = <Row>(rows: readonly Row[]): Row | null => rows[0] ?? null;

export const readStaffAuthorizationSnapshot = async (
  database: Kysely<DatabaseShape>,
  staffPrincipalId: string,
  agencyId: string,
): Promise<StaffAuthorizationSnapshot | null> => {
  const rows = (
    await sql<{
      staffPrincipalId: string;
      agencyId: string;
      state: "ACTIVE" | "DISABLED" | "REVOKED";
      authorizationEpoch: string;
      permissionId: string | null;
      scopeKind: "AGENCY" | "ORGANIZATION_UNIT" | null;
      organizationUnitId: string | null;
      accessLevel: "OWN" | "TEAM" | "ALL" | null;
      active: boolean | null;
    }>`
      SELECT membership."staffPrincipalId",
             membership."agencyId",
             membership."state",
             membership."authorizationEpoch"::text AS "authorizationEpoch",
             permission."permissionId",
             assignment."scopeKind",
             assignment."organizationUnitId"::text AS "organizationUnitId",
             permission."accessLevel",
             assignment."active"
        FROM "staff_access"."staff_membership" AS membership
        LEFT JOIN "staff_access"."role_assignment" AS assignment
          ON assignment."membershipId" = membership."id"
        LEFT JOIN "staff_access"."role_permission" AS permission
          ON permission."roleId" = assignment."roleId"
         AND permission."scopeKind" = assignment."scopeKind"
       WHERE membership."staffPrincipalId" = ${staffPrincipalId}
         AND membership."agencyId" = ${agencyId}::uuid
       ORDER BY permission."permissionId", permission."scopeKind", permission."accessLevel"
    `.execute(database)
  ).rows;
  const first = rows[0];
  if (first === undefined) return null;
  return {
    staffPrincipalId: first.staffPrincipalId,
    agencyId: first.agencyId,
    membershipState: first.state,
    authorizationEpoch: BigInt(first.authorizationEpoch),
    assignments: rows.flatMap((row) =>
      row.permissionId === null ||
      row.scopeKind === null ||
      row.accessLevel === null ||
      row.active === null
        ? []
        : [
            {
              agencyId: row.agencyId,
              permissionId:
                row.permissionId as StaffAuthorizationSnapshot["assignments"][number]["permissionId"],
              scopeKind: row.scopeKind,
              organizationUnitId: row.organizationUnitId,
              accessLevel: row.accessLevel,
              active: row.active,
            },
          ],
    ),
  };
};

/** Locks the membership row so revocation/epoch changes serialize with a workspace operation. */
export const lockStaffAuthorizationSnapshotInTransaction = async (
  database: Kysely<DatabaseShape>,
  staffPrincipalId: string,
  agencyId: string,
): Promise<StaffAuthorizationSnapshot | null> => {
  await sql`
    SELECT "id"
      FROM "staff_access"."staff_membership"
     WHERE "staffPrincipalId" = ${staffPrincipalId}
       AND "agencyId" = ${agencyId}::uuid
     FOR SHARE
  `.execute(database);
  return readStaffAuthorizationSnapshot(database, staffPrincipalId, agencyId);
};

const normalizeBootstrapEmail = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    throw new Error("First Owner bootstrap email is invalid");
  }
  return normalized;
};

const assertTokenDigest = (value: string): void => {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("First Owner bootstrap token digest is invalid");
  }
};

const activeOwnerRole = async (
  database: Kysely<DatabaseShape>,
  agencyId: string,
): Promise<string> => {
  const row = asSingle(
    (
      await sql<{ id: string }>`
        SELECT "id"
          FROM "staff_access"."role"
         WHERE "agencyId" = ${agencyId}::uuid
           AND "templateKey" = ${OWNER_ROLE_TEMPLATE_KEY}
      `.execute(database)
    ).rows,
  );
  if (row === null) throw new Error("Root Agency Owner role is absent after bootstrap");
  return row.id;
};

class PostgresStaffAccessRepository implements StaffAccessRepository {
  constructor(private readonly persistence: PostgresPersistence<DatabaseShape>) {}

  async ensureRootAgency(input: RootAgencyBootstrapInput): Promise<RootAgencyBootstrapResult> {
    return this.persistence.transaction.runInTransaction(async (context) =>
      this.persistence.withTransactionContext(context, async (database) => {
        await sql`SELECT pg_advisory_xact_lock(8110046702424020481::bigint)`.execute(database);
        const existing = asSingle(
          (
            await sql<AgencyRow>`
              SELECT "id", "bootstrapReference", "slug"
                FROM "organization"."agency"
               FOR UPDATE
            `.execute(database)
          ).rows,
        );
        let created = false;
        let agency: AgencyRow;
        if (existing === null) {
          const inserted = asSingle(
            (
              await sql<AgencyRow>`
                INSERT INTO "organization"."agency" ("id", "bootstrapReference", "slug")
                VALUES (${input.agencyId}::uuid, ${input.bootstrapReference}, ${input.slug})
                RETURNING "id", "bootstrapReference", "slug"
              `.execute(database)
            ).rows,
          );
          if (inserted === null) throw new Error("Root Agency insert returned no row");
          agency = inserted;
          created = true;
          await sql`
            INSERT INTO "organization"."agency_bootstrap_audit"
              ("id", "agencyId", "eventType", "operatorIdentity")
            VALUES (${createUuidV7()}::uuid, ${agency.id}::uuid, 'ROOT_AGENCY_CREATED', 'LOCAL_OPERATOR')
          `.execute(database);
        } else {
          if (
            existing.bootstrapReference !== input.bootstrapReference ||
            existing.slug !== input.slug
          ) {
            throw new Error("Root Agency already exists for a different strict instance manifest");
          }
          agency = existing;
          await sql`
            INSERT INTO "organization"."agency_bootstrap_audit"
              ("id", "agencyId", "eventType", "operatorIdentity")
            VALUES (${createUuidV7()}::uuid, ${agency.id}::uuid, 'ROOT_AGENCY_RERUN', 'LOCAL_OPERATOR')
          `.execute(database);
        }

        await sql`
          INSERT INTO "staff_access"."role"
            ("id", "agencyId", "templateKey", "displayName", "isSystemTemplate")
          VALUES (
            ${createUuidV7()}::uuid,
            ${agency.id}::uuid,
            ${OWNER_ROLE_TEMPLATE_KEY},
            'Owner',
            true
          )
          ON CONFLICT ("agencyId", "templateKey") WHERE "templateKey" IS NOT NULL DO NOTHING
        `.execute(database);
        const ownerRoleId = await activeOwnerRole(database, agency.id);

        for (const permissionId of ROOT_AGENCY_OWNER_TEMPLATE.permissionIds) {
          const definition = permissionDefinitionFor(permissionId);
          for (const scopeKind of definition.allowedScopeKinds) {
            for (const accessLevel of definition.allowedAccessLevels) {
              await sql`
                INSERT INTO "staff_access"."role_permission"
                  ("roleId", "permissionId", "scopeKind", "accessLevel")
                VALUES (${ownerRoleId}::uuid, ${permissionId}, ${scopeKind}, ${accessLevel})
                ON CONFLICT DO NOTHING
              `.execute(database);
            }
          }
        }

        return {
          agencyId: agency.id,
          bootstrapReference: agency.bootstrapReference,
          slug: agency.slug,
          created,
          ownerRoleId,
          permissionRegistryVersion: PERMISSION_REGISTRY_VERSION,
        };
      }),
    );
  }

  async getStaffAuthorizationSnapshot(
    staffPrincipalId: string,
    agencyId: string,
  ): Promise<StaffAuthorizationSnapshot | null> {
    return this.persistence.withConnection((database) =>
      readStaffAuthorizationSnapshot(database, staffPrincipalId, agencyId),
    );
  }

  async findStaffPrincipalIdByEmail(email: string): Promise<string | null> {
    const targetEmail = normalizeBootstrapEmail(email);
    return this.persistence.withConnection(async (database) => {
      const row = asSingle(
        (
          await sql<{ id: string }>`
            SELECT "id"
              FROM "staff_access"."staff_user"
             WHERE "email" = ${targetEmail}
          `.execute(database)
        ).rows,
      );
      return row?.id ?? null;
    });
  }

  async issueFirstOwnerInvitation(
    input: FirstOwnerInvitationInput,
  ): Promise<FirstOwnerInvitationResult> {
    const targetEmail = normalizeBootstrapEmail(input.targetEmail);
    assertTokenDigest(input.tokenDigest);
    if (input.expiresAt.getTime() <= Date.now()) {
      throw new Error("First Owner bootstrap invitation expiry must be in the future");
    }
    return this.persistence.transaction.runInTransaction(async (context) =>
      this.persistence.withTransactionContext(context, async (database) => {
        const existing = asSingle(
          (
            await sql<{ id: string; state: "PENDING" | "CONSUMED" | "EXPIRED"; expiresAt: Date }>`
              SELECT "id", "state", "expiresAt"
                FROM "staff_access"."operator_bootstrap_invitation"
               WHERE "agencyId" = ${input.agencyId}::uuid
               FOR UPDATE
            `.execute(database)
          ).rows,
        );
        if (existing !== null) {
          if (existing.state === "CONSUMED") return { result: "ALREADY_CONSUMED" };
          if (existing.state === "EXPIRED" || existing.expiresAt.getTime() <= Date.now()) {
            await sql`
              UPDATE "staff_access"."operator_bootstrap_invitation"
                 SET "targetEmail" = ${targetEmail},
                     "tokenDigest" = ${input.tokenDigest},
                     "state" = 'PENDING',
                     "expiresAt" = ${input.expiresAt},
                     "consumedAt" = NULL,
                     "staffPrincipalId" = NULL
               WHERE "id" = ${existing.id}::uuid
            `.execute(database);
            await sql`
              INSERT INTO "staff_access"."operator_bootstrap_audit"
                ("id", "agencyId", "invitationId", "eventType", "operatorIdentity")
              VALUES (
                ${createUuidV7()}::uuid,
                ${input.agencyId}::uuid,
                ${existing.id}::uuid,
                'OWNER_INVITATION_REISSUED',
                ${input.operatorIdentity}
              )
            `.execute(database);
            return { result: "ISSUED", invitationId: existing.id, agencyId: input.agencyId };
          }
          return { result: "ALREADY_ISSUED" };
        }
        const invitationId = createUuidV7();
        await sql`
          INSERT INTO "staff_access"."operator_bootstrap_invitation"
            ("id", "agencyId", "targetEmail", "tokenDigest", "state", "expiresAt")
          VALUES (
            ${invitationId}::uuid,
            ${input.agencyId}::uuid,
            ${targetEmail},
            ${input.tokenDigest},
            'PENDING',
            ${input.expiresAt}
          )
        `.execute(database);
        await sql`
          INSERT INTO "staff_access"."operator_bootstrap_audit"
            ("id", "agencyId", "invitationId", "eventType", "operatorIdentity")
          VALUES (
            ${createUuidV7()}::uuid,
            ${input.agencyId}::uuid,
            ${invitationId}::uuid,
            'OWNER_INVITATION_ISSUED',
            ${input.operatorIdentity}
          )
        `.execute(database);
        return { result: "ISSUED", invitationId, agencyId: input.agencyId };
      }),
    );
  }

  async inspectFirstOwnerInvitation(tokenDigest: string): Promise<FirstOwnerInvitationInspection> {
    assertTokenDigest(tokenDigest);
    return this.persistence.withConnection(async (database) => {
      const row = asSingle(
        (
          await sql<{
            id: string;
            agencyId: string;
            targetEmail: string;
            state: "PENDING" | "CONSUMED" | "EXPIRED";
            expiresAt: Date;
          }>`
            SELECT "id", "agencyId", "targetEmail", "state", "expiresAt"
              FROM "staff_access"."operator_bootstrap_invitation"
             WHERE "tokenDigest" = ${tokenDigest}
          `.execute(database)
        ).rows,
      );
      if (row === null) return { result: "INVALID" };
      if (row.state === "CONSUMED") return { result: "CONSUMED" };
      if (row.state === "EXPIRED" || row.expiresAt.getTime() <= Date.now())
        return { result: "EXPIRED" };
      return {
        result: "VALID",
        invitationId: row.id,
        agencyId: row.agencyId,
        targetEmail: row.targetEmail,
      };
    });
  }

  async consumeFirstOwnerInvitation(
    input: FirstOwnerInvitationConsumptionInput,
  ): Promise<FirstOwnerInvitationConsumption> {
    assertTokenDigest(input.tokenDigest);
    return this.persistence.transaction.runInTransaction(async (context) =>
      this.persistence.withTransactionContext(context, async (database) => {
        const invitation = asSingle(
          (
            await sql<{
              id: string;
              agencyId: string;
              targetEmail: string;
              state: "PENDING" | "CONSUMED" | "EXPIRED";
              expiresAt: Date;
              principalEmail: string | null;
            }>`
              SELECT invitation."id",
                     invitation."agencyId",
                     invitation."targetEmail",
                     invitation."state",
                     invitation."expiresAt",
                     principal."email" AS "principalEmail"
                FROM "staff_access"."operator_bootstrap_invitation" AS invitation
                LEFT JOIN "staff_access"."staff_user" AS principal
                  ON principal."id" = ${input.staffPrincipalId}
               WHERE invitation."tokenDigest" = ${input.tokenDigest}
               FOR UPDATE OF invitation
            `.execute(database)
          ).rows,
        );
        if (invitation === null) return { result: "INVALID" };
        if (invitation.state === "CONSUMED") return { result: "CONSUMED" };
        if (invitation.state === "EXPIRED" || invitation.expiresAt.getTime() <= Date.now()) {
          await sql`
            UPDATE "staff_access"."operator_bootstrap_invitation"
               SET "state" = 'EXPIRED'
             WHERE "id" = ${invitation.id}::uuid
          `.execute(database);
          return { result: "EXPIRED" };
        }
        if (
          invitation.principalEmail === null ||
          invitation.principalEmail.toLowerCase() !== invitation.targetEmail
        ) {
          await sql`
            INSERT INTO "staff_access"."operator_bootstrap_audit"
              ("id", "agencyId", "invitationId", "eventType", "operatorIdentity")
            VALUES (
              ${createUuidV7()}::uuid,
              ${invitation.agencyId}::uuid,
              ${invitation.id}::uuid,
              'OWNER_INVITATION_REJECTED',
              ${input.operatorIdentity}
            )
          `.execute(database);
          return { result: "INVALID" };
        }
        const existingMembership = asSingle(
          (
            await sql<{ id: string }>`
              SELECT "id" FROM "staff_access"."staff_membership"
               WHERE "staffPrincipalId" = ${input.staffPrincipalId}
            `.execute(database)
          ).rows,
        );
        if (existingMembership !== null) {
          throw new Error("A Staff Principal may not be silently promoted through bootstrap");
        }
        const ownerRoleId = await activeOwnerRole(database, invitation.agencyId);
        const membershipId = createUuidV7();
        await sql`
          UPDATE "staff_access"."staff_user"
             SET "emailVerified" = true,
                 "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = ${input.staffPrincipalId}
        `.execute(database);
        await sql`
          INSERT INTO "staff_access"."staff_membership"
            ("id", "agencyId", "staffPrincipalId", "state")
          VALUES (
            ${membershipId}::uuid,
            ${invitation.agencyId}::uuid,
            ${input.staffPrincipalId},
            'ACTIVE'
          )
        `.execute(database);
        await sql`
          INSERT INTO "staff_access"."role_assignment"
            ("id", "agencyId", "membershipId", "roleId", "scopeKind", "active")
          VALUES (
            ${createUuidV7()}::uuid,
            ${invitation.agencyId}::uuid,
            ${membershipId}::uuid,
            ${ownerRoleId}::uuid,
            'AGENCY',
            true
          )
        `.execute(database);
        await sql`
          UPDATE "staff_access"."operator_bootstrap_invitation"
             SET "state" = 'CONSUMED',
                 "consumedAt" = CURRENT_TIMESTAMP,
                 "staffPrincipalId" = ${input.staffPrincipalId}
           WHERE "id" = ${invitation.id}::uuid
        `.execute(database);
        await sql`
          INSERT INTO "staff_access"."operator_bootstrap_audit"
            ("id", "agencyId", "invitationId", "eventType", "operatorIdentity")
          VALUES (
            ${createUuidV7()}::uuid,
            ${invitation.agencyId}::uuid,
            ${invitation.id}::uuid,
            'OWNER_INVITATION_CONSUMED',
            ${input.operatorIdentity}
          )
        `.execute(database);
        return { result: "CONSUMED", membershipId, agencyId: invitation.agencyId };
      }),
    );
  }
}

export const createStaffAccessRepository = (
  persistence: PostgresPersistence<DatabaseShape>,
): StaffAccessRepository => new PostgresStaffAccessRepository(persistence);
