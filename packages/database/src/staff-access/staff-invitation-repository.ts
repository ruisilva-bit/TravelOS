import {
  M1StaffAuthorizationError,
  STAFF_INVITATION_PERMISSION_REQUIREMENTS,
  STAFF_INVITATION_RECENT_MFA_MAXIMUM_AGE_MS,
  STAFF_INVITATION_STATUSES,
  STAFF_INVITATION_TTL_MS,
  StaffInvitationAcceptanceRejectedError,
  StaffInvitationInputError,
  StaffInvitationInvariantError,
  TRIP_OPERATIONS_ROLE_TEMPLATE,
  TRIP_OPERATIONS_ROLE_TEMPLATE_KEY,
  asOpaqueId,
  isValidStaffInvitationTokenDigest,
  permissionDefinitionFor,
  validateStaffInvitationIssueInput,
  type OpaqueId,
  type StaffAuthorizationOperationProof,
  type StaffInvitationPage,
  type StaffInvitationRecord,
  type StaffInvitationRepository,
  type StaffInvitationStatus,
  type StaffIdentityEnrollmentPort,
  type TransactionContext,
} from "@travelos/backend-core";
import { sql, type Kysely } from "kysely";

import {
  assertStaffAuthorizationInTransaction,
  mapPostgresMutationError,
} from "../trip-operations/m1-operational-slice-repository.js";
import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { createUuidV7 } from "../uuidv7.js";

type DatabaseShape = Record<string, never>;

type InvitationRow = {
  readonly id: string;
  readonly agencyId: string;
  readonly targetEmail: string;
  readonly roleId: string;
  readonly roleTemplateKey: string | null;
  readonly tokenDigest: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly revokedAt: Date | null;
};

type ManagementAuthorization = {
  readonly agencyId: OpaqueId;
  readonly actorStaffPrincipalId: string;
  readonly authorization: StaffAuthorizationOperationProof;
};

type InvitationAuditEventType = "ISSUED" | "REISSUED" | "REVOKED" | "EXPIRED" | "CONSUMED";

const isInvitationStatus = (value: string): value is StaffInvitationStatus =>
  STAFF_INVITATION_STATUSES.some((status) => status === value);

const dateFromEpochMs = (value: number): Date => {
  if (!Number.isSafeInteger(value) || value < 0) throw new StaffInvitationInvariantError();
  const date = new Date(value);
  if (!Number.isSafeInteger(date.getTime())) throw new StaffInvitationInvariantError();
  return date;
};

const expiryDateFrom = (nowEpochMs: number, expiresAtEpochMs: number): Date => {
  dateFromEpochMs(nowEpochMs);
  const expiresAt = dateFromEpochMs(expiresAtEpochMs);
  if (expiresAtEpochMs - nowEpochMs !== STAFF_INVITATION_TTL_MS) {
    throw new StaffInvitationInvariantError();
  }
  return expiresAt;
};

const asInvitationId = (value: string): OpaqueId => {
  try {
    return asOpaqueId(value);
  } catch {
    throw new StaffInvitationInvariantError();
  }
};

const epochMsFromDate = (value: Date | null): number | null => {
  if (value === null) return null;
  const epochMs = value.getTime();
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) throw new StaffInvitationInvariantError();
  return epochMs;
};

const invitationRecordFrom = (row: InvitationRow): StaffInvitationRecord => {
  if (
    row.roleTemplateKey !== TRIP_OPERATIONS_ROLE_TEMPLATE_KEY ||
    !isValidStaffInvitationTokenDigest(row.tokenDigest) ||
    !isInvitationStatus(row.status)
  ) {
    throw new StaffInvitationInvariantError();
  }
  let targetEmail: string;
  try {
    targetEmail = validateStaffInvitationIssueInput({ targetEmail: row.targetEmail }).targetEmail;
  } catch {
    throw new StaffInvitationInvariantError();
  }
  if (targetEmail !== row.targetEmail) throw new StaffInvitationInvariantError();
  const createdAtEpochMs = epochMsFromDate(row.createdAt);
  const expiresAtEpochMs = epochMsFromDate(row.expiresAt);
  if (createdAtEpochMs === null || expiresAtEpochMs === null) {
    throw new StaffInvitationInvariantError();
  }
  return {
    invitationId: asInvitationId(row.id),
    agencyId: asInvitationId(row.agencyId),
    targetEmail,
    roleTemplateKey: TRIP_OPERATIONS_ROLE_TEMPLATE_KEY,
    status: row.status,
    tokenDigest: row.tokenDigest,
    createdAtEpochMs,
    expiresAtEpochMs,
    consumedAtEpochMs: epochMsFromDate(row.consumedAt),
    revokedAtEpochMs: epochMsFromDate(row.revokedAt),
  };
};

const postgresErrorCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
};

const withMappedMutationError = async <Result>(work: () => Promise<Result>): Promise<Result> => {
  try {
    return await work();
  } catch (error) {
    if (postgresErrorCode(error) === "23505") throw new StaffInvitationInvariantError();
    throw mapPostgresMutationError(error);
  }
};

const runInTransaction = <Result>(
  persistence: PostgresPersistence<DatabaseShape>,
  work: (context: TransactionContext, database: Kysely<DatabaseShape>) => Promise<Result>,
): Promise<Result> =>
  persistence.transaction.runInTransaction((context) =>
    persistence.withTransactionContext(context, (database) => work(context, database)),
  );

const authorizeManagement = async (
  database: Kysely<DatabaseShape>,
  input: ManagementAuthorization,
): Promise<void> => {
  if (input.authorization.session.staffPrincipalId !== input.actorStaffPrincipalId) {
    throw new M1StaffAuthorizationError("FORBIDDEN");
  }
  await assertStaffAuthorizationInTransaction(
    database,
    input.authorization,
    input.agencyId,
    STAFF_INVITATION_PERMISSION_REQUIREMENTS,
    STAFF_INVITATION_RECENT_MFA_MAXIMUM_AGE_MS,
  );
};

const assertTripOperationsRole = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  expectedRoleId?: string,
): Promise<string> => {
  const role = (
    await sql<{ id: string; displayName: string; isSystemTemplate: boolean }>`
      SELECT "id"::text AS "id", "displayName", "isSystemTemplate"
        FROM "staff_access"."role"
       WHERE "agencyId" = ${agencyId}::uuid
         AND "templateKey" = ${TRIP_OPERATIONS_ROLE_TEMPLATE_KEY}
       FOR SHARE
    `.execute(database)
  ).rows[0];
  if (
    role === undefined ||
    role.displayName !== "Trip Operations" ||
    !role.isSystemTemplate ||
    (expectedRoleId !== undefined && role.id !== expectedRoleId)
  ) {
    throw new StaffInvitationInvariantError();
  }

  const actualPermissions = (
    await sql<{
      permissionId: string;
      scopeKind: "AGENCY" | "ORGANIZATION_UNIT";
      accessLevel: "OWN" | "TEAM" | "ALL";
    }>`
      SELECT "permissionId", "scopeKind", "accessLevel"
        FROM "staff_access"."role_permission"
       WHERE "roleId" = ${role.id}::uuid
       ORDER BY "permissionId", "scopeKind", "accessLevel"
       FOR SHARE
    `.execute(database)
  ).rows;
  const expectedPermissions = TRIP_OPERATIONS_ROLE_TEMPLATE.permissionIds
    .flatMap((permissionId) => {
      const definition = permissionDefinitionFor(permissionId);
      return definition.allowedScopeKinds.flatMap((scopeKind) =>
        definition.allowedAccessLevels.map((accessLevel) =>
          [permissionId, scopeKind, accessLevel].join("\u0000"),
        ),
      );
    })
    .sort();
  const actualPermissionKeys = actualPermissions
    .map(({ permissionId, scopeKind, accessLevel }) =>
      [permissionId, scopeKind, accessLevel].join("\u0000"),
    )
    .sort();
  if (JSON.stringify(actualPermissionKeys) !== JSON.stringify(expectedPermissions)) {
    throw new StaffInvitationInvariantError();
  }
  return role.id;
};

const invitationByIdForUpdate = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  invitationId: OpaqueId,
): Promise<InvitationRow | undefined> =>
  (
    await sql<InvitationRow>`
      SELECT invitation."id"::text AS "id",
             invitation."agencyId"::text AS "agencyId",
             invitation."targetEmail",
             invitation."roleId"::text AS "roleId",
             role."templateKey" AS "roleTemplateKey",
             invitation."tokenDigest",
             invitation."status",
             invitation."createdAt",
             invitation."expiresAt",
             invitation."consumedAt",
             invitation."revokedAt"
        FROM "staff_access"."staff_invitation" AS invitation
        JOIN "staff_access"."role" AS role
          ON role."id" = invitation."roleId"
         AND role."agencyId" = invitation."agencyId"
       WHERE invitation."agencyId" = ${agencyId}::uuid
         AND invitation."id" = ${invitationId}::uuid
       FOR UPDATE OF invitation
    `.execute(database)
  ).rows[0];

const invitationByDigestForUpdate = async (
  database: Kysely<DatabaseShape>,
  tokenDigest: string,
): Promise<InvitationRow | undefined> =>
  (
    await sql<InvitationRow>`
      SELECT invitation."id"::text AS "id",
             invitation."agencyId"::text AS "agencyId",
             invitation."targetEmail",
             invitation."roleId"::text AS "roleId",
             role."templateKey" AS "roleTemplateKey",
             invitation."tokenDigest",
             invitation."status",
             invitation."createdAt",
             invitation."expiresAt",
             invitation."consumedAt",
             invitation."revokedAt"
        FROM "staff_access"."staff_invitation" AS invitation
        JOIN "staff_access"."role" AS role
          ON role."id" = invitation."roleId"
         AND role."agencyId" = invitation."agencyId"
       WHERE invitation."tokenDigest" = ${tokenDigest}
       FOR UPDATE OF invitation
    `.execute(database)
  ).rows[0];

const insertInvitation = async (
  database: Kysely<DatabaseShape>,
  input: {
    readonly agencyId: OpaqueId;
    readonly targetEmail: string;
    readonly roleId: string;
    readonly tokenDigest: string;
    readonly actorStaffPrincipalId: string;
    readonly nowEpochMs: number;
    readonly expiresAtEpochMs: number;
  },
): Promise<StaffInvitationRecord> => {
  const id = createUuidV7();
  const createdAt = dateFromEpochMs(input.nowEpochMs);
  const expiresAt = expiryDateFrom(input.nowEpochMs, input.expiresAtEpochMs);
  await sql`
    INSERT INTO "staff_access"."staff_invitation"
      ("id", "agencyId", "targetEmail", "roleId", "tokenDigest", "status",
       "createdByStaffPrincipalId", "createdAt", "expiresAt")
    VALUES (
      ${id}::uuid,
      ${input.agencyId}::uuid,
      ${input.targetEmail},
      ${input.roleId}::uuid,
      ${input.tokenDigest},
      'PENDING',
      ${input.actorStaffPrincipalId},
      ${createdAt},
      ${expiresAt}
    )
  `.execute(database);
  return {
    invitationId: asInvitationId(id),
    agencyId: input.agencyId,
    targetEmail: input.targetEmail,
    roleTemplateKey: TRIP_OPERATIONS_ROLE_TEMPLATE_KEY,
    status: "PENDING",
    tokenDigest: input.tokenDigest,
    createdAtEpochMs: input.nowEpochMs,
    expiresAtEpochMs: input.expiresAtEpochMs,
    consumedAtEpochMs: null,
    revokedAtEpochMs: null,
  };
};

const appendAuditEvent = async (
  database: Kysely<DatabaseShape>,
  input: {
    readonly agencyId: OpaqueId;
    readonly invitationId: OpaqueId;
    readonly relatedInvitationId: OpaqueId | null;
    readonly actorStaffPrincipalId: string;
    readonly eventType: InvitationAuditEventType;
  },
): Promise<void> => {
  await sql`
    INSERT INTO "audit"."staff_invitation_event"
      ("id", "agencyId", "invitationId", "relatedInvitationId",
       "actorStaffPrincipalId", "eventType")
    VALUES (
      ${createUuidV7()}::uuid,
      ${input.agencyId}::uuid,
      ${input.invitationId}::uuid,
      ${input.relatedInvitationId}::uuid,
      ${input.actorStaffPrincipalId},
      ${input.eventType}
    )
  `.execute(database);
};

class PostgresStaffInvitationRepository implements StaffInvitationRepository {
  constructor(private readonly persistence: PostgresPersistence<DatabaseShape>) {}

  async issue(
    input: Parameters<StaffInvitationRepository["issue"]>[0],
  ): Promise<StaffInvitationRecord> {
    const normalizedEmail = validateStaffInvitationIssueInput({
      targetEmail: input.targetEmail,
    }).targetEmail.toLowerCase();
    if (
      input.roleTemplateKey !== TRIP_OPERATIONS_ROLE_TEMPLATE_KEY ||
      !isValidStaffInvitationTokenDigest(input.tokenDigest)
    ) {
      throw new StaffInvitationInputError();
    }
    dateFromEpochMs(input.nowEpochMs);
    expiryDateFrom(input.nowEpochMs, input.expiresAtEpochMs);

    return withMappedMutationError(() =>
      runInTransaction(this.persistence, async (_context, database) => {
        await authorizeManagement(database, input);
        const roleId = await assertTripOperationsRole(database, input.agencyId);
        const record = await insertInvitation(database, {
          agencyId: input.agencyId,
          targetEmail: normalizedEmail,
          roleId,
          tokenDigest: input.tokenDigest,
          actorStaffPrincipalId: input.actorStaffPrincipalId,
          nowEpochMs: input.nowEpochMs,
          expiresAtEpochMs: input.expiresAtEpochMs,
        });
        await appendAuditEvent(database, {
          agencyId: input.agencyId,
          invitationId: record.invitationId,
          relatedInvitationId: null,
          actorStaffPrincipalId: input.actorStaffPrincipalId,
          eventType: "ISSUED",
        });
        return record;
      }),
    );
  }

  async listAndExpireDue(
    input: Parameters<StaffInvitationRepository["listAndExpireDue"]>[0],
  ): Promise<StaffInvitationPage> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
      throw new StaffInvitationInputError();
    }
    const now = dateFromEpochMs(input.nowEpochMs);

    return withMappedMutationError(() =>
      runInTransaction(this.persistence, async (_context, database) => {
        await authorizeManagement(database, input);
        await assertTripOperationsRole(database, input.agencyId);
        const dueRows = (
          await sql<{ id: string }>`
            SELECT invitation."id"::text AS "id"
              FROM "staff_access"."staff_invitation" AS invitation
             WHERE invitation."agencyId" = ${input.agencyId}::uuid
               AND invitation."status" = 'PENDING'
               AND invitation."expiresAt" <= ${now}
             ORDER BY invitation."expiresAt", invitation."id"
             LIMIT ${input.limit}
             FOR UPDATE OF invitation SKIP LOCKED
          `.execute(database)
        ).rows;
        for (const due of dueRows) {
          const expired = (
            await sql<{ id: string }>`
              UPDATE "staff_access"."staff_invitation"
                 SET "status" = 'EXPIRED'
               WHERE "agencyId" = ${input.agencyId}::uuid
                 AND "id" = ${due.id}::uuid
                 AND "status" = 'PENDING'
                 AND "expiresAt" <= ${now}
              RETURNING "id"::text AS "id"
            `.execute(database)
          ).rows[0];
          if (expired === undefined) continue;
          await appendAuditEvent(database, {
            agencyId: input.agencyId,
            invitationId: asInvitationId(expired.id),
            relatedInvitationId: null,
            actorStaffPrincipalId: input.actorStaffPrincipalId,
            eventType: "EXPIRED",
          });
        }

        const cursor = input.cursor;
        const rows = (
          await sql<InvitationRow>`
            SELECT invitation."id"::text AS "id",
                   invitation."agencyId"::text AS "agencyId",
                   invitation."targetEmail",
                   invitation."roleId"::text AS "roleId",
                   role."templateKey" AS "roleTemplateKey",
                   invitation."tokenDigest",
                   invitation."status",
                   invitation."createdAt",
                   invitation."expiresAt",
                   invitation."consumedAt",
                   invitation."revokedAt"
              FROM "staff_access"."staff_invitation" AS invitation
              JOIN "staff_access"."role" AS role
                ON role."id" = invitation."roleId"
               AND role."agencyId" = invitation."agencyId"
             WHERE invitation."agencyId" = ${input.agencyId}::uuid
               AND (${cursor}::uuid IS NULL OR invitation."id" < ${cursor}::uuid)
             ORDER BY invitation."id" DESC
             LIMIT ${input.limit + 1}
          `.execute(database)
        ).rows;
        const hasMore = rows.length > input.limit;
        const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
        const items = pageRows.map(invitationRecordFrom);
        const lastItem = items.at(-1);
        return {
          items,
          nextCursor: hasMore && lastItem !== undefined ? lastItem.invitationId : null,
        };
      }),
    );
  }

  async reissue(
    input: Parameters<StaffInvitationRepository["reissue"]>[0],
  ): Promise<StaffInvitationRecord> {
    if (!isValidStaffInvitationTokenDigest(input.tokenDigest)) {
      throw new StaffInvitationInputError();
    }
    dateFromEpochMs(input.nowEpochMs);
    expiryDateFrom(input.nowEpochMs, input.expiresAtEpochMs);

    return withMappedMutationError(() =>
      runInTransaction(this.persistence, async (_context, database) => {
        await authorizeManagement(database, input);
        const existing = await invitationByIdForUpdate(
          database,
          input.agencyId,
          input.invitationId,
        );
        if (existing === undefined) throw new StaffInvitationInvariantError();
        const previous = invitationRecordFrom(existing);
        if (previous.status !== "PENDING" || previous.expiresAtEpochMs <= input.nowEpochMs) {
          throw new StaffInvitationInvariantError();
        }
        const roleId = await assertTripOperationsRole(database, input.agencyId, existing.roleId);
        const replacement = await insertInvitation(database, {
          agencyId: input.agencyId,
          targetEmail: previous.targetEmail,
          roleId,
          tokenDigest: input.tokenDigest,
          actorStaffPrincipalId: input.actorStaffPrincipalId,
          nowEpochMs: input.nowEpochMs,
          expiresAtEpochMs: input.expiresAtEpochMs,
        });
        const revoked = (
          await sql<{ id: string }>`
            UPDATE "staff_access"."staff_invitation"
               SET "status" = 'REVOKED', "revokedAt" = ${dateFromEpochMs(input.nowEpochMs)}
             WHERE "agencyId" = ${input.agencyId}::uuid
               AND "id" = ${input.invitationId}::uuid
               AND "status" = 'PENDING'
               AND "expiresAt" > ${dateFromEpochMs(input.nowEpochMs)}
            RETURNING "id"::text AS "id"
          `.execute(database)
        ).rows[0];
        if (revoked === undefined) throw new StaffInvitationInvariantError();
        await appendAuditEvent(database, {
          agencyId: input.agencyId,
          invitationId: input.invitationId,
          relatedInvitationId: replacement.invitationId,
          actorStaffPrincipalId: input.actorStaffPrincipalId,
          eventType: "REISSUED",
        });
        return replacement;
      }),
    );
  }

  async revoke(
    input: Parameters<StaffInvitationRepository["revoke"]>[0],
  ): Promise<StaffInvitationRecord> {
    dateFromEpochMs(input.nowEpochMs);

    return withMappedMutationError(() =>
      runInTransaction(this.persistence, async (_context, database) => {
        await authorizeManagement(database, input);
        const existing = await invitationByIdForUpdate(
          database,
          input.agencyId,
          input.invitationId,
        );
        if (existing === undefined) throw new StaffInvitationInvariantError();
        const current = invitationRecordFrom(existing);
        if (current.status !== "PENDING" || current.expiresAtEpochMs <= input.nowEpochMs) {
          throw new StaffInvitationInvariantError();
        }
        const revokedAt = dateFromEpochMs(input.nowEpochMs);
        const updated = (
          await sql<{ id: string }>`
            UPDATE "staff_access"."staff_invitation"
               SET "status" = 'REVOKED', "revokedAt" = ${revokedAt}
             WHERE "agencyId" = ${input.agencyId}::uuid
               AND "id" = ${input.invitationId}::uuid
               AND "status" = 'PENDING'
               AND "expiresAt" > ${revokedAt}
            RETURNING "id"::text AS "id"
          `.execute(database)
        ).rows[0];
        if (updated === undefined) throw new StaffInvitationInvariantError();
        await appendAuditEvent(database, {
          agencyId: input.agencyId,
          invitationId: input.invitationId,
          relatedInvitationId: null,
          actorStaffPrincipalId: input.actorStaffPrincipalId,
          eventType: "REVOKED",
        });
        return {
          ...current,
          status: "REVOKED",
          revokedAtEpochMs: input.nowEpochMs,
        };
      }),
    );
  }

  async accept(
    input: {
      readonly tokenDigest: string;
      readonly name: string;
      readonly password: string;
      readonly nowEpochMs: number;
    },
    enrollment: StaffIdentityEnrollmentPort,
  ): Promise<void> {
    if (!isValidStaffInvitationTokenDigest(input.tokenDigest)) {
      throw new StaffInvitationAcceptanceRejectedError();
    }
    const now = dateFromEpochMs(input.nowEpochMs);

    let accepted: boolean;
    try {
      accepted = await runInTransaction(this.persistence, async (context, database) => {
        const invitation = await invitationByDigestForUpdate(database, input.tokenDigest);
        if (invitation === undefined || invitation.status !== "PENDING") return false;
        const record = invitationRecordFrom(invitation);
        if (record.expiresAtEpochMs <= input.nowEpochMs) return false;
        const roleId = await assertTripOperationsRole(database, record.agencyId, invitation.roleId);
        const identity = await enrollment.enroll(context, {
          email: record.targetEmail,
          name: input.name,
          password: input.password,
        });
        const staffPrincipalId = identity.staffPrincipalId;
        if (
          typeof staffPrincipalId !== "string" ||
          staffPrincipalId.length === 0 ||
          staffPrincipalId.length > 255 ||
          [...staffPrincipalId].some((character) => {
            const codePoint = character.codePointAt(0);
            return codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f);
          })
        ) {
          throw new StaffInvitationAcceptanceRejectedError();
        }
        const membershipId = createUuidV7();
        await sql`
          INSERT INTO "staff_access"."staff_membership"
            ("id", "agencyId", "staffPrincipalId", "state", "createdAt", "updatedAt")
          VALUES (
            ${membershipId}::uuid,
            ${record.agencyId}::uuid,
            ${staffPrincipalId},
            'ACTIVE',
            ${now},
            ${now}
          )
        `.execute(database);
        await sql`
          INSERT INTO "staff_access"."role_assignment"
            ("id", "agencyId", "membershipId", "roleId", "scopeKind",
             "organizationUnitId", "active", "assignedAt")
          VALUES (
            ${createUuidV7()}::uuid,
            ${record.agencyId}::uuid,
            ${membershipId}::uuid,
            ${roleId}::uuid,
            'AGENCY',
            NULL,
            true,
            ${now}
          )
        `.execute(database);
        const consumed = (
          await sql<{ id: string }>`
            UPDATE "staff_access"."staff_invitation"
               SET "status" = 'CONSUMED',
                   "consumedStaffPrincipalId" = ${staffPrincipalId},
                   "consumedAt" = statement_timestamp()
             WHERE "agencyId" = ${record.agencyId}::uuid
               AND "id" = ${record.invitationId}::uuid
               AND "status" = 'PENDING'
               AND "expiresAt" > statement_timestamp()
            RETURNING "id"::text AS "id"
          `.execute(database)
        ).rows[0];
        if (consumed === undefined) throw new StaffInvitationAcceptanceRejectedError();
        await appendAuditEvent(database, {
          agencyId: record.agencyId,
          invitationId: record.invitationId,
          relatedInvitationId: null,
          actorStaffPrincipalId: staffPrincipalId,
          eventType: "CONSUMED",
        });
        return true;
      });
    } catch (error) {
      if (postgresErrorCode(error) === "23505") {
        throw new StaffInvitationAcceptanceRejectedError();
      }
      throw mapPostgresMutationError(error);
    }
    if (!accepted) throw new StaffInvitationAcceptanceRejectedError();
  }
}

export const createPostgresStaffInvitationRepository = (
  persistence: PostgresPersistence<DatabaseShape>,
): StaffInvitationRepository => new PostgresStaffInvitationRepository(persistence);
