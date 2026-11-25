import { createHash } from "node:crypto";

import {
  asOpaqueId,
  assertLeadOpen,
  customerDraftFromLead,
  disqualifyOpenLead,
  InputValidationError,
  LEAD_PERMISSION_REQUIREMENTS,
  LeadIdempotencyConflictError,
  LeadNotFoundError,
  openLead,
  OptimisticConflictError,
  personDraftFromLead,
  qualifyOpenLead,
  updateOpenLead,
  type Lead,
  type LeadDisqualificationReason,
  type LeadDraft,
  type LeadListQuery,
  type LeadPage,
  type LeadQualificationMode,
  type LeadRepository,
  type LeadSource,
  type LeadState,
  type OpaqueId,
  type StaffAuthorizationOperationProof,
  type StaffPermissionId,
} from "@travelos/backend-core";
import { sql, type Kysely } from "kysely";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import {
  assertStaffAuthorizationInTransaction,
  mapPostgresMutationError,
} from "../trip-operations/operational-slice-repository.js";
import { createUuidV7 } from "../uuidv7.js";

type DatabaseShape = Record<string, never>;

type LeadCommand = "lead.create" | "lead.qualify" | "lead.disqualify";

type LeadRow = {
  readonly id: string;
  readonly agencyId: string;
  readonly source: LeadSource;
  readonly contactGivenName: string;
  readonly contactFamilyName: string;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly internalNote: string | null;
  readonly state: LeadState;
  readonly qualifiedCustomerId: string | null;
  readonly disqualificationReason: LeadDisqualificationReason | null;
  readonly lockVersion: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly closedAt: Date | null;
};

const LEAD_COLUMNS = sql`
  "id"::text AS "id",
  "agencyId"::text AS "agencyId",
  "source",
  "contactGivenName",
  "contactFamilyName",
  "contactEmail",
  "contactPhone",
  "internalNote",
  "state",
  "qualifiedCustomerId"::text AS "qualifiedCustomerId",
  "disqualificationReason",
  "lockVersion"::text AS "lockVersion",
  "createdAt",
  "updatedAt",
  "closedAt"
`;

const mapLeadRow = (row: LeadRow): Lead => ({
  id: asOpaqueId(row.id),
  agencyId: asOpaqueId(row.agencyId),
  source: row.source,
  contactGivenName: row.contactGivenName,
  contactFamilyName: row.contactFamilyName,
  contactEmail: row.contactEmail,
  contactPhone: row.contactPhone,
  internalNote: row.internalNote,
  state: row.state,
  qualifiedCustomerId:
    row.qualifiedCustomerId === null ? null : asOpaqueId(row.qualifiedCustomerId),
  disqualificationReason: row.disqualificationReason,
  lockVersion: BigInt(row.lockVersion),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  closedAt: row.closedAt === null ? null : row.closedAt.toISOString(),
});

const first = <Row>(rows: readonly Row[]): Row | null => rows[0] ?? null;

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const databaseNow = async (database: Kysely<DatabaseShape>): Promise<string> => {
  const row = first(
    (
      await sql<{
        readonly now: Date;
      }>`SELECT date_trunc('milliseconds', statement_timestamp()) AS "now"`.execute(database)
    ).rows,
  );
  if (row === null) throw new Error("PostgreSQL did not return the current time");
  return row.now.toISOString();
};

const readLead = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  leadId: OpaqueId,
): Promise<Lead | null> => {
  const row = first(
    (
      await sql<LeadRow>`
        SELECT ${LEAD_COLUMNS}
          FROM "sales"."lead"
         WHERE "agencyId" = ${agencyId}::uuid AND "id" = ${leadId}::uuid
      `.execute(database)
    ).rows,
  );
  return row === null ? null : mapLeadRow(row);
};

const lockLead = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  leadId: OpaqueId,
): Promise<Lead | null> => {
  const row = first(
    (
      await sql<LeadRow>`
        SELECT ${LEAD_COLUMNS}
          FROM "sales"."lead"
         WHERE "agencyId" = ${agencyId}::uuid AND "id" = ${leadId}::uuid
         FOR UPDATE
      `.execute(database)
    ).rows,
  );
  return row === null ? null : mapLeadRow(row);
};

/** Locks the Lead, rejects terminal Leads with LEAD_NOT_OPEN, then stale versions as a conflict. */
const lockOpenLeadAtVersion = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  leadId: OpaqueId,
  expectedLockVersion: bigint,
): Promise<Lead | null> => {
  const lead = await lockLead(database, agencyId, leadId);
  if (lead === null) return null;
  assertLeadOpen(lead);
  if (lead.lockVersion !== expectedLockVersion) throw new OptimisticConflictError();
  return lead;
};

const insertLeadValues = (lead: Lead) => sql`
  (
    "id", "agencyId", "source", "contactGivenName", "contactFamilyName", "contactEmail",
    "contactPhone", "internalNote", "state", "lockVersion", "createdAt", "updatedAt"
  ) VALUES (
    ${lead.id}::uuid, ${lead.agencyId}::uuid, ${lead.source}, ${lead.contactGivenName},
    ${lead.contactFamilyName}, ${lead.contactEmail}, ${lead.contactPhone}, ${lead.internalNote},
    'OPEN', ${lead.lockVersion.toString()}::bigint, ${lead.createdAt}::timestamptz,
    ${lead.updatedAt}::timestamptz
  )
`;

const draftFingerprint = (draft: LeadDraft): string =>
  JSON.stringify([
    draft.source,
    draft.contactGivenName,
    draft.contactFamilyName,
    draft.contactEmail,
    draft.contactPhone,
    draft.internalNote,
  ]);

const modeFingerprint = (mode: LeadQualificationMode): string =>
  mode.kind === "LINK_CUSTOMER"
    ? JSON.stringify([mode.kind, mode.customerId])
    : JSON.stringify([mode.kind, mode.customerDisplayName]);

const findIdempotency = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  actorId: string,
  command: LeadCommand,
  key: string,
): Promise<{ readonly leadId: OpaqueId; readonly requestHash: string } | null> => {
  const row = first(
    (
      await sql<{ readonly leadId: string; readonly requestHash: string }>`
        SELECT "leadId"::text AS "leadId", "requestHash"
          FROM "sales"."lead_idempotency"
         WHERE "agencyId" = ${agencyId}::uuid
           AND "staffPrincipalId" = ${actorId}
           AND "command" = ${command}
           AND "idempotencyKey" = ${key}
      `.execute(database)
    ).rows,
  );
  return row === null
    ? null
    : { leadId: asOpaqueId(row.leadId), requestHash: row.requestHash.trim() };
};

const recordIdempotency = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  actorId: string,
  command: LeadCommand,
  key: string,
  leadId: OpaqueId,
  requestHash: string,
): Promise<void> => {
  await sql`
    INSERT INTO "sales"."lead_idempotency"
      ("agencyId", "staffPrincipalId", "command", "idempotencyKey", "leadId", "requestHash")
    VALUES
      (${agencyId}::uuid, ${actorId}, ${command}, ${key}, ${leadId}::uuid, ${requestHash})
  `.execute(database);
};

/** Resolves a prior identical request to the current Lead, or rejects a key reused differently. */
const replayIdempotentRequest = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  actorId: string,
  command: LeadCommand,
  key: string | null,
  requestHash: string,
): Promise<Lead | null> => {
  if (key === null) return null;
  const prior = await findIdempotency(database, agencyId, actorId, command, key);
  if (prior === null) return null;
  if (prior.requestHash !== requestHash) throw new LeadIdempotencyConflictError();
  const lead = await readLead(database, agencyId, prior.leadId);
  if (lead === null) throw new LeadNotFoundError();
  return lead;
};

/** Audit, Activity and outbox are written in the caller's transaction, once per closure. */
const recordLeadClosure = async (
  database: Kysely<DatabaseShape>,
  closed: Lead,
  previousLockVersion: bigint,
  actorId: string,
): Promise<void> => {
  const auditId = createUuidV7();
  const qualified = closed.state === "QUALIFIED";
  await sql`
    INSERT INTO "audit"."lead_event"
      ("auditId", "agencyId", "leadId", "actorStaffPrincipalId", "action",
       "previousLockVersion", "currentLockVersion", "customerId", "disqualificationReason",
       "occurredAt")
    VALUES
      (${auditId}::uuid, ${closed.agencyId}::uuid, ${closed.id}::uuid, ${actorId},
       ${qualified ? "LEAD_QUALIFIED" : "LEAD_DISQUALIFIED"},
       ${previousLockVersion.toString()}::bigint, ${closed.lockVersion.toString()}::bigint,
       ${closed.qualifiedCustomerId}::uuid, ${closed.disqualificationReason},
       ${closed.updatedAt}::timestamptz)
  `.execute(database);
  await sql`
    INSERT INTO "activity"."lead_entry"
      ("entryId", "agencyId", "leadId", "auditId", "actorStaffPrincipalId", "entryType", "occurredAt")
    VALUES
      (${createUuidV7()}::uuid, ${closed.agencyId}::uuid, ${closed.id}::uuid, ${auditId}::uuid,
       ${actorId}, ${qualified ? "LEAD_QUALIFIED" : "LEAD_DISQUALIFIED"},
       ${closed.updatedAt}::timestamptz)
  `.execute(database);
  await sql`
    INSERT INTO "integration"."lead_outbox"
      ("messageId", "agencyId", "leadId", "auditId", "messageType", "leadLockVersion")
    VALUES
      (${createUuidV7()}::uuid, ${closed.agencyId}::uuid, ${closed.id}::uuid, ${auditId}::uuid,
       ${qualified ? "LeadQualified" : "LeadDisqualified"}, ${closed.lockVersion.toString()}::bigint)
  `.execute(database);
};

const applyCasUpdate = async (
  database: Kysely<DatabaseShape>,
  before: Lead,
  after: Lead,
): Promise<void> => {
  const updated = await sql<{ readonly id: string }>`
    UPDATE "sales"."lead"
       SET "source" = ${after.source},
           "contactGivenName" = ${after.contactGivenName},
           "contactFamilyName" = ${after.contactFamilyName},
           "contactEmail" = ${after.contactEmail},
           "contactPhone" = ${after.contactPhone},
           "internalNote" = ${after.internalNote},
           "state" = ${after.state},
           "qualifiedCustomerId" = ${after.qualifiedCustomerId}::uuid,
           "disqualificationReason" = ${after.disqualificationReason},
           "lockVersion" = ${after.lockVersion.toString()}::bigint,
           "updatedAt" = ${after.updatedAt}::timestamptz,
           "closedAt" = ${after.closedAt}::timestamptz
     WHERE "agencyId" = ${before.agencyId}::uuid
       AND "id" = ${before.id}::uuid
       AND "state" = 'OPEN'
       AND "lockVersion" = ${before.lockVersion.toString()}::bigint
    RETURNING "id"::text AS "id"
  `.execute(database);
  if (updated.rows.length !== 1) throw new OptimisticConflictError();
};

const isIdempotencyRace = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { readonly code?: unknown }).code === "23505" &&
  (error as { readonly constraint?: unknown }).constraint === "lead_idempotency_pkey";

const toInputValidationError = (error: unknown): never => {
  if (error instanceof InputValidationError) throw error;
  throw new InputValidationError(error instanceof Error ? error.message : "Invalid Lead input");
};

export const createPostgresLeadRepository = (
  persistence: PostgresPersistence<DatabaseShape>,
): LeadRepository => {
  const withLeadTransaction = async <Result>(
    agencyId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
    permissions: readonly StaffPermissionId[],
    work: (database: Kysely<DatabaseShape>, actorId: string) => Promise<Result>,
  ): Promise<Result> => {
    // A concurrent request with the same idempotency key loses the key insert; a single retry then
    // observes the committed record and replays it instead of failing.
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await persistence.transaction.runInTransaction(async (context) =>
          persistence.withTransactionContext(context, async (database) => {
            await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`.execute(database);
            await assertStaffAuthorizationInTransaction(
              database,
              authorization,
              agencyId,
              permissions,
            );
            return work(database, authorization.session.staffPrincipalId);
          }),
        );
      } catch (error) {
        if (attempt < 2 && isIdempotencyRace(error)) continue;
        throw mapPostgresMutationError(error);
      }
    }
  };

  const repository: LeadRepository = {
    async listLeads(agencyId, query: LeadListQuery, authorization): Promise<LeadPage> {
      return withLeadTransaction(
        agencyId,
        authorization,
        LEAD_PERMISSION_REQUIREMENTS.VIEW,
        async (database) => {
          const rows = (
            await sql<LeadRow>`
              SELECT ${LEAD_COLUMNS}
                FROM "sales"."lead" AS lead
               WHERE lead."agencyId" = ${agencyId}::uuid
                 AND (${query.state}::text IS NULL OR lead."state" = ${query.state}::text)
                 AND (
                   ${query.cursor}::uuid IS NULL OR
                   (lead."createdAt", lead."id") < (
                     SELECT cursor_lead."createdAt", cursor_lead."id"
                       FROM "sales"."lead" AS cursor_lead
                      WHERE cursor_lead."agencyId" = ${agencyId}::uuid
                        AND cursor_lead."id" = ${query.cursor}::uuid
                   )
                 )
               ORDER BY lead."createdAt" DESC, lead."id" DESC
               LIMIT ${query.limit + 1}
            `.execute(database)
          ).rows;
          const items = rows.slice(0, query.limit).map(mapLeadRow);
          const lastItem = items[items.length - 1];
          return {
            items,
            nextCursor: rows.length > query.limit && lastItem !== undefined ? lastItem.id : null,
          };
        },
      );
    },

    async getLead(agencyId, leadId, authorization) {
      return withLeadTransaction(
        agencyId,
        authorization,
        LEAD_PERMISSION_REQUIREMENTS.VIEW,
        (database) => readLead(database, agencyId, leadId),
      );
    },

    async createLead(agencyId, draft, idempotencyKey, authorization) {
      return withLeadTransaction(
        agencyId,
        authorization,
        LEAD_PERMISSION_REQUIREMENTS.EDIT,
        async (database, actorId) => {
          const requestHash = sha256Hex(`lead.create\u0000${draftFingerprint(draft)}`);
          const replay = await replayIdempotentRequest(
            database,
            agencyId,
            actorId,
            "lead.create",
            idempotencyKey,
            requestHash,
          );
          if (replay !== null) return replay;

          const lead = openLead({
            id: createUuidV7(),
            agencyId,
            draft,
            nowInstant: await databaseNow(database),
          });
          await sql`INSERT INTO "sales"."lead" ${insertLeadValues(lead)}`.execute(database);
          if (idempotencyKey !== null) {
            await recordIdempotency(
              database,
              agencyId,
              actorId,
              "lead.create",
              idempotencyKey,
              lead.id,
              requestHash,
            );
          }
          const stored = await readLead(database, agencyId, lead.id);
          if (stored === null) throw new Error("Lead disappeared during its creating transaction");
          return stored;
        },
      );
    },

    async updateLead(agencyId, leadId, expectedLockVersion, draft, authorization) {
      return withLeadTransaction(
        agencyId,
        authorization,
        LEAD_PERMISSION_REQUIREMENTS.EDIT,
        async (database) => {
          const current = await lockOpenLeadAtVersion(
            database,
            agencyId,
            leadId,
            expectedLockVersion,
          );
          if (current === null) return null;
          const next = updateOpenLead(current, draft, await databaseNow(database));
          await applyCasUpdate(database, current, next);
          return readLead(database, agencyId, leadId);
        },
      );
    },

    async qualifyLead(agencyId, leadId, expectedLockVersion, mode, idempotencyKey, authorization) {
      return withLeadTransaction(
        agencyId,
        authorization,
        LEAD_PERMISSION_REQUIREMENTS.QUALIFY,
        async (database, actorId) => {
          const requestHash = sha256Hex(
            `lead.qualify\u0000${leadId}\u0000${expectedLockVersion.toString()}\u0000${modeFingerprint(mode)}`,
          );
          const replay = await replayIdempotentRequest(
            database,
            agencyId,
            actorId,
            "lead.qualify",
            idempotencyKey,
            requestHash,
          );
          if (replay !== null) return replay;

          const current = await lockOpenLeadAtVersion(
            database,
            agencyId,
            leadId,
            expectedLockVersion,
          );
          if (current === null) return null;

          let customerId: OpaqueId;
          if (mode.kind === "LINK_CUSTOMER") {
            // Agency-scoped lookup: a Customer of another Agency is indistinguishable from a missing one.
            const customer = first(
              (
                await sql<{ readonly id: string }>`
                  SELECT "id"::text AS "id"
                    FROM "crm"."customer"
                   WHERE "agencyId" = ${agencyId}::uuid AND "id" = ${mode.customerId}::uuid
                `.execute(database)
              ).rows,
            );
            if (customer === null) throw new LeadNotFoundError();
            customerId = asOpaqueId(customer.id);
          } else {
            let personDraft;
            let customerDraft;
            try {
              personDraft = personDraftFromLead(current);
              customerDraft = customerDraftFromLead(current, mode.customerDisplayName);
            } catch (error) {
              return toInputValidationError(error);
            }
            const personId = createUuidV7();
            customerId = createUuidV7();
            await sql`
              INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName", "email")
              VALUES (${personId}::uuid, ${agencyId}::uuid, ${personDraft.givenName},
                      ${personDraft.familyName}, ${personDraft.email})
            `.execute(database);
            await sql`
              INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
              VALUES (${customerId}::uuid, ${agencyId}::uuid, ${customerDraft.displayName})
            `.execute(database);
            await sql`
              INSERT INTO "crm"."customer_person"
                ("agencyId", "customerId", "personId", "role", "isPrimary")
              VALUES (${agencyId}::uuid, ${customerId}::uuid, ${personId}::uuid,
                      'PRIMARY_CONTACT', true)
            `.execute(database);
          }

          const closed = qualifyOpenLead(current, customerId, await databaseNow(database));
          await applyCasUpdate(database, current, closed);
          await recordLeadClosure(database, closed, current.lockVersion, actorId);
          if (idempotencyKey !== null) {
            await recordIdempotency(
              database,
              agencyId,
              actorId,
              "lead.qualify",
              idempotencyKey,
              leadId,
              requestHash,
            );
          }
          return readLead(database, agencyId, leadId);
        },
      );
    },

    async disqualifyLead(
      agencyId,
      leadId,
      expectedLockVersion,
      reason,
      idempotencyKey,
      authorization,
    ) {
      return withLeadTransaction(
        agencyId,
        authorization,
        LEAD_PERMISSION_REQUIREMENTS.EDIT,
        async (database, actorId) => {
          const requestHash = sha256Hex(
            `lead.disqualify\u0000${leadId}\u0000${expectedLockVersion.toString()}\u0000${reason}`,
          );
          const replay = await replayIdempotentRequest(
            database,
            agencyId,
            actorId,
            "lead.disqualify",
            idempotencyKey,
            requestHash,
          );
          if (replay !== null) return replay;

          const current = await lockOpenLeadAtVersion(
            database,
            agencyId,
            leadId,
            expectedLockVersion,
          );
          if (current === null) return null;
          const closed = disqualifyOpenLead(current, reason, await databaseNow(database));
          await applyCasUpdate(database, current, closed);
          await recordLeadClosure(database, closed, current.lockVersion, actorId);
          if (idempotencyKey !== null) {
            await recordIdempotency(
              database,
              agencyId,
              actorId,
              "lead.disqualify",
              idempotencyKey,
              leadId,
              requestHash,
            );
          }
          return readLead(database, agencyId, leadId);
        },
      );
    },
  };
  return Object.freeze(repository);
};
