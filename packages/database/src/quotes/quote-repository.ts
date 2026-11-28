import { createHash } from "node:crypto";

import {
  asOpaqueId,
  assertQuoteWriteOutcome,
  canonicalTripSnapshotV1Json,
  OptimisticConflictError,
  QuoteRuleError,
  type NewQuoteRecord,
  type OpaqueId,
  type QuoteAggregate,
  type QuoteAcceptanceRecord,
  type QuoteDayRecord,
  type QuoteHeaderPatch,
  type QuoteLeadContext,
  type QuoteLineDraft,
  type QuoteLineInsertResult,
  type QuoteLineLockUpdate,
  type QuoteLineRecord,
  type QuoteListQuery,
  type QuotePage,
  type QuotePublishPlan,
  type QuotePublishResult,
  type QuoteRecord,
  type QuoteRepository,
  type QuoteSharedRecord,
  type QuoteShareLinkRecord,
  type QuoteState,
  type QuoteVersionRecord,
  type StaffAuthorizationOperationProof,
  type StaffPermissionId,
  type QuoteLineSection,
} from "@travelos/backend-core";
import { sql, type Kysely } from "kysely";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import {
  assertStaffAuthorizationInTransaction,
  mapPostgresMutationError,
} from "../trip-operations/operational-slice-repository.js";
import { createUuidV7 } from "../uuidv7.js";

type DatabaseShape = Record<string, never>;

/** Permission policy per repository command; re-checked inside each transaction. */
const PERMISSIONS = Object.freeze({
  VIEW: Object.freeze(["quote.view"] as const satisfies readonly StaffPermissionId[]),
  EDIT: Object.freeze(["quote.edit"] as const satisfies readonly StaffPermissionId[]),
  CREATE: Object.freeze([
    "quote.edit",
    "customer.view",
  ] as const satisfies readonly StaffPermissionId[]),
  SEND: Object.freeze(["quote.send"] as const satisfies readonly StaffPermissionId[]),
  CONVERT: Object.freeze([
    "quote.send",
    "trip.edit",
  ] as const satisfies readonly StaffPermissionId[]),
});

const first = <Row>(rows: readonly Row[]): Row | null => rows[0] ?? null;

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

const money = (value: string | null): bigint | null => (value === null ? null : BigInt(value));

const QUOTE_COLUMNS = sql`
  quote."id"::text AS "id",
  quote."agencyId"::text AS "agencyId",
  quote."customerId"::text AS "customerId",
  customer."displayName" AS "customerDisplayName",
  quote."leadId"::text AS "leadId",
  quote."number",
  quote."title",
  quote."destination",
  quote."startDate"::text AS "startDate",
  quote."endDate"::text AS "endDate",
  quote."adults",
  quote."children",
  quote."state",
  quote."validUntil"::text AS "validUntil",
  quote."currencyCode" AS "currencyCode",
  quote."pvpOverrideMinor"::text AS "pvpOverrideMinor",
  quote."targetMarginBp",
  quote."agencyNetShareBp",
  quote."depositBp",
  quote."balanceDueDays",
  quote."heroImageUrl",
  quote."intro",
  quote."internalNotes",
  quote."excludedItems",
  quote."convertedTripId"::text AS "convertedTripId",
  quote."lockVersion"::text AS "lockVersion",
  quote."createdAt",
  quote."updatedAt"
`;

type QuoteRow = {
  readonly id: string;
  readonly agencyId: string;
  readonly customerId: string;
  readonly customerDisplayName: string;
  readonly leadId: string;
  readonly number: string;
  readonly title: string;
  readonly destination: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly adults: number;
  readonly children: number;
  readonly state: QuoteState;
  readonly validUntil: string;
  readonly currencyCode: string;
  readonly pvpOverrideMinor: string | null;
  readonly targetMarginBp: number;
  readonly agencyNetShareBp: number;
  readonly depositBp: number;
  readonly balanceDueDays: number;
  readonly heroImageUrl: string | null;
  readonly intro: string | null;
  readonly internalNotes: string | null;
  readonly excludedItems: string[];
  readonly convertedTripId: string | null;
  readonly lockVersion: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

const mapQuote = (row: QuoteRow): QuoteRecord => ({
  id: asOpaqueId(row.id),
  agencyId: asOpaqueId(row.agencyId),
  customerId: asOpaqueId(row.customerId),
  customerDisplayName: row.customerDisplayName,
  leadId: asOpaqueId(row.leadId),
  number: row.number,
  title: row.title,
  destination: row.destination,
  startDate: row.startDate,
  endDate: row.endDate,
  adults: row.adults,
  children: row.children,
  state: row.state,
  validUntil: row.validUntil,
  currencyCode: row.currencyCode,
  pvpOverrideMinor: money(row.pvpOverrideMinor),
  targetMarginBp: row.targetMarginBp,
  agencyNetShareBp: row.agencyNetShareBp,
  depositBp: row.depositBp,
  balanceDueDays: row.balanceDueDays,
  heroImageUrl: row.heroImageUrl,
  intro: row.intro,
  internalNotes: row.internalNotes,
  excludedItems: [...row.excludedItems],
  convertedTripId: row.convertedTripId === null ? null : asOpaqueId(row.convertedTripId),
  lockVersion: BigInt(row.lockVersion),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const LINE_COLUMNS = sql`
  line."id"::text AS "id",
  line."quoteId"::text AS "quoteId",
  line."section",
  line."position",
  line."category",
  line."service",
  line."supplier",
  line."description",
  line."startDate"::text AS "startDate",
  line."endDate"::text AS "endDate",
  line."quantity",
  line."netSupplierMinor"::text AS "netSupplierMinor",
  line."recommendedMinor"::text AS "recommendedMinor",
  line."pvpMinor"::text AS "pvpMinor",
  line."customerVisible",
  line."imageUrl",
  line."internalNote",
  line."fromIata",
  line."toIata",
  to_char(line."departTime", 'HH24:MI') AS "departTime",
  to_char(line."arriveTime", 'HH24:MI') AS "arriveTime",
  line."carrier",
  line."flightNumber",
  line."baggage",
  line."roomType",
  line."boardBasis",
  line."location",
  line."lockVersion"::text AS "lockVersion"
`;

type LineRow = {
  readonly id: string;
  readonly quoteId: string;
  readonly section: QuoteLineSection;
  readonly position: number;
  readonly category: QuoteLineRecord["category"];
  readonly service: string;
  readonly supplier: string | null;
  readonly description: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly quantity: number;
  readonly netSupplierMinor: string;
  readonly recommendedMinor: string;
  readonly pvpMinor: string;
  readonly customerVisible: boolean;
  readonly imageUrl: string | null;
  readonly internalNote: string | null;
  readonly fromIata: string | null;
  readonly toIata: string | null;
  readonly departTime: string | null;
  readonly arriveTime: string | null;
  readonly carrier: string | null;
  readonly flightNumber: string | null;
  readonly baggage: string | null;
  readonly roomType: string | null;
  readonly boardBasis: string | null;
  readonly location: string | null;
  readonly lockVersion: string;
};

const mapLine = (row: LineRow): QuoteLineRecord => ({
  id: asOpaqueId(row.id),
  quoteId: asOpaqueId(row.quoteId),
  section: row.section,
  position: row.position,
  category: row.category,
  service: row.service,
  supplier: row.supplier,
  description: row.description,
  startDate: row.startDate,
  endDate: row.endDate,
  quantity: row.quantity,
  netSupplierMinor: BigInt(row.netSupplierMinor),
  recommendedMinor: BigInt(row.recommendedMinor),
  pvpMinor: BigInt(row.pvpMinor),
  customerVisible: row.customerVisible,
  imageUrl: row.imageUrl,
  internalNote: row.internalNote,
  fromIata: row.fromIata,
  toIata: row.toIata,
  departTime: row.departTime,
  arriveTime: row.arriveTime,
  carrier: row.carrier,
  flightNumber: row.flightNumber,
  baggage: row.baggage,
  roomType: row.roomType,
  boardBasis: row.boardBasis,
  location: row.location,
  lockVersion: BigInt(row.lockVersion),
});

/** Values for a line insert or copy, in column order. */
const lineValues = (draft: QuoteLineDraft) => ({
  category: draft.category,
  service: draft.service,
  supplier: draft.supplier,
  description: draft.description,
  startDate: draft.startDate,
  endDate: draft.endDate,
  quantity: draft.quantity,
  netSupplierMinor: draft.netSupplierMinor.toString(),
  recommendedMinor: draft.recommendedMinor.toString(),
  pvpMinor: draft.pvpMinor.toString(),
  customerVisible: draft.customerVisible,
  imageUrl: draft.imageUrl,
  internalNote: draft.internalNote,
  fromIata: draft.fromIata,
  toIata: draft.toIata,
  departTime: draft.departTime,
  arriveTime: draft.arriveTime,
  carrier: draft.carrier,
  flightNumber: draft.flightNumber,
  baggage: draft.baggage,
  roomType: draft.roomType,
  boardBasis: draft.boardBasis,
  location: draft.location,
});

const lineDraftOf = (line: QuoteLineRecord): QuoteLineDraft => ({
  category: line.category,
  service: line.service,
  supplier: line.supplier,
  description: line.description,
  startDate: line.startDate,
  endDate: line.endDate,
  quantity: line.quantity,
  netSupplierMinor: line.netSupplierMinor,
  recommendedMinor: line.recommendedMinor,
  pvpMinor: line.pvpMinor,
  customerVisible: line.customerVisible,
  imageUrl: line.imageUrl,
  internalNote: line.internalNote,
  fromIata: line.fromIata,
  toIata: line.toIata,
  departTime: line.departTime,
  arriveTime: line.arriveTime,
  carrier: line.carrier,
  flightNumber: line.flightNumber,
  baggage: line.baggage,
  roomType: line.roomType,
  boardBasis: line.boardBasis,
  location: line.location,
});

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const readAggregateRows = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  quoteId: OpaqueId,
): Promise<QuoteAggregate | null> => {
  const quoteRow = first(
    (
      await sql<QuoteRow>`
        SELECT ${QUOTE_COLUMNS}
          FROM "sales"."quote" AS quote
          JOIN "crm"."customer" AS customer
            ON customer."id" = quote."customerId" AND customer."agencyId" = quote."agencyId"
         WHERE quote."agencyId" = ${agencyId}::uuid AND quote."id" = ${quoteId}::uuid
      `.execute(database)
    ).rows,
  );
  if (quoteRow === null) return null;
  const lines = (
    await sql<LineRow>`
      SELECT ${LINE_COLUMNS}
        FROM "sales"."quote_line" AS line
       WHERE line."agencyId" = ${agencyId}::uuid AND line."quoteId" = ${quoteId}::uuid
       ORDER BY line."section", line."position", line."id"
    `.execute(database)
  ).rows.map(mapLine);
  const days = (
    await sql<{ dayIndex: number; title: string; description: string | null }>`
      SELECT "dayIndex", "title", "description"
        FROM "sales"."quote_day"
       WHERE "agencyId" = ${agencyId}::uuid AND "quoteId" = ${quoteId}::uuid
       ORDER BY "dayIndex"
    `.execute(database)
  ).rows.map((row): QuoteDayRecord => ({
    quoteId,
    dayIndex: row.dayIndex,
    title: row.title,
    description: row.description,
  }));

  const versionRows = (
    await sql<{
      id: string;
      versionNumber: number;
      sentAt: Date;
      pvpFinalMinor: string;
      currencyCode: string;
      payloadSha256: Buffer;
      acceptedAt: Date | null;
      acceptedName: string | null;
    }>`
      SELECT version."id"::text AS "id",
             version."versionNumber",
             version."sentAt",
             version."pvpFinalMinor"::text AS "pvpFinalMinor",
             version."currencyCode",
             version."payloadSha256",
             acceptance."acceptedAt",
             acceptance."acceptedName"
        FROM "sales"."quote_version" AS version
        LEFT JOIN "sales"."quote_acceptance" AS acceptance ON acceptance."versionId" = version."id"
       WHERE version."agencyId" = ${agencyId}::uuid AND version."quoteId" = ${quoteId}::uuid
       ORDER BY version."versionNumber"
    `.execute(database)
  ).rows;
  const linkRows = (
    await sql<{
      shareLinkId: string;
      versionId: string;
      versionNumber: number;
      createdAt: Date;
      expiresAt: Date;
      revokedAt: Date | null;
    }>`
      SELECT link."shareLinkId"::text AS "shareLinkId",
             link."versionId"::text AS "versionId",
             version."versionNumber",
             link."createdAt",
             link."expiresAt",
             link."revokedAt"
        FROM "sales"."quote_share_link" AS link
        JOIN "sales"."quote_version" AS version ON version."id" = link."versionId"
       WHERE link."agencyId" = ${agencyId}::uuid AND link."quoteId" = ${quoteId}::uuid
       ORDER BY link."createdAt", link."shareLinkId"
    `.execute(database)
  ).rows;
  const latestNumber = versionRows.reduce((max, row) => Math.max(max, row.versionNumber), 0);
  const versions: QuoteVersionRecord[] = versionRows.map((row) => {
    const acceptance: QuoteAcceptanceRecord | null =
      row.acceptedAt === null || row.acceptedName === null
        ? null
        : { acceptedAt: row.acceptedAt.toISOString(), acceptedName: row.acceptedName };
    const shareLinks: QuoteShareLinkRecord[] = linkRows
      .filter((link) => link.versionId === row.id)
      .map((link) => ({
        shareLinkId: asOpaqueId(link.shareLinkId),
        versionId: asOpaqueId(link.versionId),
        versionNumber: link.versionNumber,
        createdAt: link.createdAt.toISOString(),
        expiresAt: link.expiresAt.toISOString(),
        revokedAt: iso(link.revokedAt),
      }));
    return {
      id: asOpaqueId(row.id),
      quoteId,
      versionNumber: row.versionNumber,
      sentAt: row.sentAt.toISOString(),
      pvpFinalMinor: BigInt(row.pvpFinalMinor),
      currencyCode: row.currencyCode,
      payloadSha256: Buffer.from(row.payloadSha256).toString("hex"),
      acceptance,
      isLatest: row.versionNumber === latestNumber,
      shareLinks,
    };
  });
  return {
    quote: mapQuote(quoteRow),
    lines,
    days,
    versions,
  };
};

const outcomeOf = (rows: readonly { readonly result: string }[]): string => {
  const row = first(rows);
  if (row === null) throw new Error("PostgreSQL returned no quote command outcome");
  return row.result;
};

const lockQuoteOrThrow = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  quoteId: OpaqueId,
): Promise<QuoteRecord | null> => {
  const aggregate = await readAggregateRows(database, agencyId, quoteId);
  return aggregate === null ? null : aggregate.quote;
};

export const createPostgresQuoteRepository = (
  persistence: PostgresPersistence<DatabaseShape>,
): QuoteRepository => {
  /** One transaction, with the authorization re-checked inside it. */
  const inTransaction = async <Result>(
    agencyId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
    permissions: readonly StaffPermissionId[],
    work: (database: Kysely<DatabaseShape>) => Promise<Result>,
  ): Promise<Result> => {
    try {
      return await persistence.transaction.runInTransaction(async (context) =>
        persistence.withTransactionContext(context, async (database) => {
          // The adapter states the permissions it needs for this command and re-checks them against
          // the database; the operation's own proof may name a different (larger or smaller) set.
          await assertStaffAuthorizationInTransaction(
            database,
            { ...authorization, requiredPermissionIds: [...permissions] },
            agencyId,
            permissions,
          );
          return work(database);
        }),
      );
    } catch (error) {
      throw mapPostgresMutationError(error);
    }
  };

  /** Plain reads run in a transaction only to share the authorization re-check. */
  const read = <Result>(
    agencyId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
    permissions: readonly StaffPermissionId[],
    work: (database: Kysely<DatabaseShape>) => Promise<Result>,
  ): Promise<Result> => inTransaction(agencyId, authorization, permissions, work);

  const repository: QuoteRepository = {
    async listQuotes(agencyId, query: QuoteListQuery, authorization): Promise<QuotePage> {
      return read(agencyId, authorization, PERMISSIONS.VIEW, async (database) => {
        const search =
          query.search === null
            ? null
            : `%${query.search.replace(/[\\%_]/gu, (match) => `\\${match}`)}%`;
        const rows = (
          await sql<QuoteRow>`
            SELECT ${QUOTE_COLUMNS}
              FROM "sales"."quote" AS quote
              JOIN "crm"."customer" AS customer
                ON customer."id" = quote."customerId" AND customer."agencyId" = quote."agencyId"
             WHERE quote."agencyId" = ${agencyId}::uuid
               AND (${query.state}::text IS NULL OR quote."state" = ${query.state}::text)
               AND (${query.customerId}::uuid IS NULL OR quote."customerId" = ${query.customerId}::uuid)
               AND (${query.leadId}::uuid IS NULL OR quote."leadId" = ${query.leadId}::uuid)
               AND (
                 ${search}::text IS NULL OR quote."number" ILIKE ${search}::text
                 OR quote."title" ILIKE ${search}::text OR customer."displayName" ILIKE ${search}::text
               )
               AND (
                 ${query.cursor}::uuid IS NULL OR
                 (quote."createdAt", quote."id") < (
                   SELECT cursor_quote."createdAt", cursor_quote."id"
                     FROM "sales"."quote" AS cursor_quote
                    WHERE cursor_quote."agencyId" = ${agencyId}::uuid AND cursor_quote."id" = ${query.cursor}::uuid
                 )
               )
             ORDER BY quote."createdAt" DESC, quote."id" DESC
             LIMIT ${query.limit + 1}
          `.execute(database)
        ).rows;
        const items = rows.slice(0, query.limit).map(mapQuote);
        const last = items[items.length - 1];
        return {
          items,
          nextCursor: rows.length > query.limit && last !== undefined ? last.id : null,
        };
      });
    },

    async readAggregate(agencyId, quoteId, authorization) {
      return read(agencyId, authorization, PERMISSIONS.VIEW, (database) =>
        readAggregateRows(database, agencyId, quoteId),
      );
    },

    async readLeadContext(agencyId, leadId, authorization): Promise<QuoteLeadContext | null> {
      return read(agencyId, authorization, PERMISSIONS.VIEW, async (database) => {
        const row = first(
          (
            await sql<{
              leadId: string;
              state: QuoteLeadContext["state"];
              customerId: string | null;
              displayName: string | null;
              email: string | null;
              phone: string | null;
              primaryGivenName: string | null;
            }>`
              SELECT lead."id"::text AS "leadId",
                     lead."state",
                     COALESCE(lead."customerId", lead."qualifiedCustomerId")::text AS "customerId",
                     customer."displayName",
                     customer."email",
                     customer."phone",
                     primary_person."givenName" AS "primaryGivenName"
                FROM "sales"."lead" AS lead
                LEFT JOIN "crm"."customer" AS customer
                  ON customer."id" = COALESCE(lead."customerId", lead."qualifiedCustomerId")
                 AND customer."agencyId" = lead."agencyId"
                LEFT JOIN "crm"."customer_person" AS link
                  ON link."customerId" = customer."id" AND link."agencyId" = customer."agencyId" AND link."isPrimary"
                LEFT JOIN "crm"."person" AS primary_person
                  ON primary_person."id" = link."personId" AND primary_person."agencyId" = link."agencyId"
               WHERE lead."agencyId" = ${agencyId}::uuid AND lead."id" = ${leadId}::uuid
            `.execute(database)
          ).rows,
        );
        if (row === null) return null;
        const customerId = row.customerId === null ? null : asOpaqueId(row.customerId);
        return {
          leadId: asOpaqueId(row.leadId),
          state: row.state,
          customerId,
          customer:
            customerId === null || row.displayName === null
              ? null
              : {
                  customerId,
                  displayName: row.displayName,
                  email: row.email,
                  phone: row.phone,
                  primaryGivenName: row.primaryGivenName,
                },
        };
      });
    },

    async insertQuote(agencyId, draft: NewQuoteRecord, authorization) {
      return inTransaction(agencyId, authorization, PERMISSIONS.CREATE, async (database) => {
        const number = outcomeOf(
          (
            await sql<{ result: string }>`
              SELECT sales.next_quote_number(${agencyId}::uuid, ${draft.year}::integer) AS "result"
            `.execute(database)
          ).rows,
        );
        const quoteId = createUuidV7();
        await sql`
          INSERT INTO "sales"."quote" ("id", "agencyId", "customerId", "leadId", "number", "title", "destination",
                                       "startDate", "endDate", "adults", "children", "validUntil",
                                       "createdByStaffPrincipalId")
          VALUES (${quoteId}::uuid, ${agencyId}::uuid, ${draft.customerId}::uuid, ${draft.leadId}::uuid,
                  ${number}, ${draft.title}, ${draft.destination}, ${draft.startDate}::date, ${draft.endDate}::date,
                  ${draft.adults}, ${draft.children}, ${draft.validUntil}::date, ${authorization.session.staffPrincipalId})
        `.execute(database);
        const aggregate = await readAggregateRows(database, agencyId, asOpaqueId(quoteId));
        if (aggregate === null)
          throw new Error("Quote disappeared during its creating transaction");
        return aggregate;
      });
    },

    async updateHeader(
      agencyId,
      quoteId,
      expectedLockVersion,
      patch: QuoteHeaderPatch,
      authorization,
    ) {
      return inTransaction(agencyId, authorization, PERMISSIONS.EDIT, async (database) =>
        outcomeOf(
          (
            await sql<{ result: string }>`
              SELECT sales.update_quote(
                ${agencyId}::uuid, ${quoteId}::uuid, ${expectedLockVersion.toString()}::bigint,
                ${patch.title}, ${patch.destination}, ${patch.startDate}::date, ${patch.endDate}::date,
                ${patch.adults}, ${patch.children}, ${patch.validUntil}::date,
                ${patch.pvpOverrideMinor === null ? null : patch.pvpOverrideMinor.toString()}::bigint,
                ${patch.targetMarginBp}, ${patch.agencyNetShareBp}, ${patch.depositBp}, ${patch.balanceDueDays},
                ${patch.heroImageUrl}, ${patch.intro}, ${patch.internalNotes}, ${[...patch.excludedItems]}::text[]
              ) AS "result"
            `.execute(database)
          ).rows,
        ),
      );
    },

    async insertLine(
      agencyId,
      quoteId,
      section,
      draft,
      authorization,
    ): Promise<QuoteLineInsertResult> {
      return inTransaction(agencyId, authorization, PERMISSIONS.EDIT, async (database) => {
        const quote = await lockQuoteOrThrow(database, agencyId, quoteId);
        if (quote === null) return { outcome: "NOT_FOUND", lineId: null };
        if (quote.state !== "DRAFT") return { outcome: "NOT_DRAFT", lineId: null };
        const next = first(
          (
            await sql<{ position: number }>`
              SELECT (COALESCE(MAX("position"), -1) + 1)::integer AS "position"
                FROM "sales"."quote_line"
               WHERE "agencyId" = ${agencyId}::uuid AND "quoteId" = ${quoteId}::uuid AND "section" = ${section}
            `.execute(database)
          ).rows,
        );
        const lineId = createUuidV7();
        const values = lineValues(draft);
        await sql`
          INSERT INTO "sales"."quote_line" ("id", "agencyId", "quoteId", "section", "position", "category", "service",
            "supplier", "description", "startDate", "endDate", "quantity", "netSupplierMinor", "recommendedMinor",
            "pvpMinor", "customerVisible", "imageUrl", "internalNote", "fromIata", "toIata", "departTime",
            "arriveTime", "carrier", "flightNumber", "baggage", "roomType", "boardBasis", "location")
          VALUES (${lineId}::uuid, ${agencyId}::uuid, ${quoteId}::uuid, ${section}, ${next?.position ?? 0},
            ${values.category}, ${values.service}, ${values.supplier}, ${values.description},
            ${values.startDate}::date, ${values.endDate}::date, ${values.quantity},
            ${values.netSupplierMinor}::bigint, ${values.recommendedMinor}::bigint, ${values.pvpMinor}::bigint,
            ${values.customerVisible}, ${values.imageUrl}, ${values.internalNote}, ${values.fromIata},
            ${values.toIata}, ${values.departTime}::time, ${values.arriveTime}::time, ${values.carrier},
            ${values.flightNumber}, ${values.baggage}, ${values.roomType}, ${values.boardBasis}, ${values.location})
        `.execute(database);
        return { outcome: "CREATED", lineId: asOpaqueId(lineId) };
      });
    },

    async updateLine(agencyId, quoteId, lineId, expectedLockVersion, draft, authorization) {
      return inTransaction(agencyId, authorization, PERMISSIONS.EDIT, async (database) => {
        void quoteId;
        const v = lineValues(draft);
        return outcomeOf(
          (
            await sql<{ result: string }>`
              SELECT sales.update_quote_line(
                ${agencyId}::uuid, ${lineId}::uuid, ${expectedLockVersion.toString()}::bigint,
                ${v.category}, ${v.service}, ${v.supplier}, ${v.description}, ${v.startDate}::date, ${v.endDate}::date,
                ${v.quantity}, ${v.netSupplierMinor}::bigint, ${v.recommendedMinor}::bigint, ${v.pvpMinor}::bigint,
                ${v.customerVisible}, ${v.imageUrl}, ${v.internalNote}, ${v.fromIata}, ${v.toIata},
                ${v.departTime}::time, ${v.arriveTime}::time, ${v.carrier}, ${v.flightNumber}, ${v.baggage},
                ${v.roomType}, ${v.boardBasis}, ${v.location}
              ) AS "result"
            `.execute(database)
          ).rows,
        );
      });
    },

    async updateLines(agencyId, quoteId, updates: readonly QuoteLineLockUpdate[], authorization) {
      await inTransaction(agencyId, authorization, PERMISSIONS.EDIT, async (database) => {
        void quoteId;
        for (const update of updates) {
          const v = lineValues(update.line);
          const outcome = outcomeOf(
            (
              await sql<{ result: string }>`
                SELECT sales.update_quote_line(
                  ${agencyId}::uuid, ${update.lineId}::uuid, ${update.expectedLockVersion.toString()}::bigint,
                  ${v.category}, ${v.service}, ${v.supplier}, ${v.description}, ${v.startDate}::date, ${v.endDate}::date,
                  ${v.quantity}, ${v.netSupplierMinor}::bigint, ${v.recommendedMinor}::bigint, ${v.pvpMinor}::bigint,
                  ${v.customerVisible}, ${v.imageUrl}, ${v.internalNote}, ${v.fromIata}, ${v.toIata},
                  ${v.departTime}::time, ${v.arriveTime}::time, ${v.carrier}, ${v.flightNumber}, ${v.baggage},
                  ${v.roomType}, ${v.boardBasis}, ${v.location}
                ) AS "result"
              `.execute(database)
            ).rows,
          );
          assertQuoteWriteOutcome(outcome);
        }
      });
    },

    async deleteLine(agencyId, quoteId, lineId, expectedLockVersion, authorization) {
      return inTransaction(agencyId, authorization, PERMISSIONS.EDIT, async (database) => {
        void quoteId;
        return outcomeOf(
          (
            await sql<{ result: string }>`
              SELECT sales.delete_quote_line(${agencyId}::uuid, ${lineId}::uuid, ${expectedLockVersion.toString()}::bigint) AS "result"
            `.execute(database)
          ).rows,
        );
      });
    },

    async duplicateLine(agencyId, quoteId, lineId, authorization): Promise<QuoteLineInsertResult> {
      return inTransaction(agencyId, authorization, PERMISSIONS.EDIT, async (database) => {
        const aggregate = await readAggregateRows(database, agencyId, quoteId);
        if (aggregate === null) return { outcome: "NOT_FOUND", lineId: null };
        if (aggregate.quote.state !== "DRAFT") return { outcome: "NOT_DRAFT", lineId: null };
        const source = aggregate.lines.find((line) => line.id === lineId);
        if (source === undefined) return { outcome: "NOT_FOUND", lineId: null };
        const copyId = createUuidV7();
        const values = lineValues(lineDraftOf(source));
        const nextPosition =
          aggregate.lines
            .filter((line) => line.section === source.section)
            .reduce((max, line) => Math.max(max, line.position), -1) + 1;
        await sql`
          INSERT INTO "sales"."quote_line" ("id", "agencyId", "quoteId", "section", "position", "category", "service",
            "supplier", "description", "startDate", "endDate", "quantity", "netSupplierMinor", "recommendedMinor",
            "pvpMinor", "customerVisible", "imageUrl", "internalNote", "fromIata", "toIata", "departTime",
            "arriveTime", "carrier", "flightNumber", "baggage", "roomType", "boardBasis", "location")
          VALUES (${copyId}::uuid, ${agencyId}::uuid, ${quoteId}::uuid, ${source.section}, ${nextPosition},
            ${values.category}, ${values.service}, ${values.supplier}, ${values.description},
            ${values.startDate}::date, ${values.endDate}::date, ${values.quantity},
            ${values.netSupplierMinor}::bigint, ${values.recommendedMinor}::bigint, ${values.pvpMinor}::bigint,
            ${values.customerVisible}, ${values.imageUrl}, ${values.internalNote}, ${values.fromIata},
            ${values.toIata}, ${values.departTime}::time, ${values.arriveTime}::time, ${values.carrier},
            ${values.flightNumber}, ${values.baggage}, ${values.roomType}, ${values.boardBasis}, ${values.location})
        `.execute(database);
        // The copy sits directly below its source: rebuild the order with the copy inserted after it.
        const ordered = [
          ...aggregate.lines.map((line) => ({ id: line.id as string, section: line.section })),
        ];
        const sourceIndex = ordered.findIndex((line) => line.id === lineId);
        ordered.splice(sourceIndex + 1, 0, { id: copyId, section: source.section });
        const reordered = outcomeOf(
          (
            await sql<{ result: string }>`
              SELECT sales.reorder_quote_lines(
                ${agencyId}::uuid, ${quoteId}::uuid, ${aggregate.quote.lockVersion.toString()}::bigint,
                ${ordered.map((line) => line.id)}::uuid[], ${ordered.map((line) => line.section)}::text[]
              ) AS "result"
            `.execute(database)
          ).rows,
        );
        assertQuoteWriteOutcome(reordered);
        return { outcome: "CREATED", lineId: asOpaqueId(copyId) };
      });
    },

    async reorderLines(agencyId, quoteId, expectedQuoteLockVersion, order, authorization) {
      return inTransaction(agencyId, authorization, PERMISSIONS.EDIT, async (database) =>
        outcomeOf(
          (
            await sql<{ result: string }>`
              SELECT sales.reorder_quote_lines(
                ${agencyId}::uuid, ${quoteId}::uuid, ${expectedQuoteLockVersion.toString()}::bigint,
                ${order.map((entry) => entry.lineId)}::uuid[], ${order.map((entry) => entry.section)}::text[]
              ) AS "result"
            `.execute(database)
          ).rows,
        ),
      );
    },

    async upsertDay(agencyId, quoteId, expectedLockVersion, day, authorization) {
      return inTransaction(agencyId, authorization, PERMISSIONS.EDIT, async (database) =>
        outcomeOf(
          (
            await sql<{ result: string }>`
              SELECT sales.upsert_quote_day(${agencyId}::uuid, ${quoteId}::uuid, ${expectedLockVersion.toString()}::bigint,
                ${day.dayIndex}::integer, ${day.title}, ${day.description}) AS "result"
            `.execute(database)
          ).rows,
        ),
      );
    },

    async deleteDay(agencyId, quoteId, expectedLockVersion, dayIndex, authorization) {
      return inTransaction(agencyId, authorization, PERMISSIONS.EDIT, async (database) =>
        outcomeOf(
          (
            await sql<{ result: string }>`
              SELECT sales.delete_quote_day(${agencyId}::uuid, ${quoteId}::uuid, ${expectedLockVersion.toString()}::bigint,
                ${dayIndex}::integer) AS "result"
            `.execute(database)
          ).rows,
        ),
      );
    },

    async resetDays(agencyId, quoteId, expectedLockVersion, authorization) {
      return inTransaction(agencyId, authorization, PERMISSIONS.EDIT, async (database) =>
        outcomeOf(
          (
            await sql<{ result: string }>`
              SELECT sales.reset_quote_days(${agencyId}::uuid, ${quoteId}::uuid, ${expectedLockVersion.toString()}::bigint) AS "result"
            `.execute(database)
          ).rows,
        ),
      );
    },

    async setState(agencyId, quoteId, expectedLockVersion, fromStates, toState, authorization) {
      return inTransaction(agencyId, authorization, PERMISSIONS.EDIT, async (database) =>
        outcomeOf(
          (
            await sql<{ result: string }>`
              SELECT sales.set_quote_state(${agencyId}::uuid, ${quoteId}::uuid, ${expectedLockVersion.toString()}::bigint,
                ${[...fromStates]}::text[], ${toState}::text) AS "result"
            `.execute(database)
          ).rows,
        ),
      );
    },

    async publish(
      agencyId,
      quoteId,
      expectedLockVersion,
      plan: QuotePublishPlan,
      authorization,
    ): Promise<QuotePublishResult> {
      return inTransaction(agencyId, authorization, PERMISSIONS.SEND, async (database) => {
        // 1. Lock the quote at the caller's version while it is still DRAFT. The no-op DRAFT to DRAFT
        //    transition bumps the lock version by exactly one, so the lines read next are stable.
        const locked = outcomeOf(
          (
            await sql<{ result: string }>`
              SELECT sales.set_quote_state(${agencyId}::uuid, ${quoteId}::uuid, ${expectedLockVersion.toString()}::bigint,
                ARRAY['DRAFT']::text[], 'DRAFT') AS "result"
            `.execute(database)
          ).rows,
        );
        assertQuoteWriteOutcome(locked);
        const aggregate = await readAggregateRows(database, agencyId, quoteId);
        if (aggregate === null) throw new Error("Quote disappeared while being sent");
        const prepared = plan.prepare(aggregate);
        const canonical = canonicalTripSnapshotV1Json(prepared.payload);
        const versionId = createUuidV7();
        const versionNumber =
          aggregate.versions.reduce((max, version) => Math.max(max, version.versionNumber), 0) + 1;
        const payloadSha256Hex = sha256Hex(canonical);
        await sql`
          INSERT INTO "sales"."quote_version" ("id", "agencyId", "quoteId", "versionNumber", "sentByStaffPrincipalId",
            "canonicalPayload", "payloadSha256", "pvpFinalMinor", "currencyCode")
          VALUES (${versionId}::uuid, ${agencyId}::uuid, ${quoteId}::uuid, ${versionNumber}, ${authorization.session.staffPrincipalId},
            ${canonical}::jsonb, decode(${payloadSha256Hex}, 'hex'), ${prepared.pvpFinalMinor.toString()}::bigint,
            ${prepared.currencyCode})
        `.execute(database);
        const shareLinkId = createUuidV7();
        await sql`
          INSERT INTO "sales"."quote_share_link" ("shareLinkId", "agencyId", "quoteId", "versionId", "tokenHash",
            "createdByStaffPrincipalId", "idempotencyKey", "expiresAt")
          VALUES (${shareLinkId}::uuid, ${agencyId}::uuid, ${quoteId}::uuid, ${versionId}::uuid,
            ${Buffer.from(plan.tokenHash)}, ${authorization.session.staffPrincipalId}, ${shareLinkId},
            ${plan.expiresAt}::timestamptz)
        `.execute(database);
        // 2. Only now, with the version and link written, move the quote to SENT.
        const sent = outcomeOf(
          (
            await sql<{ result: string }>`
              SELECT sales.set_quote_state(${agencyId}::uuid, ${quoteId}::uuid, ${(expectedLockVersion + 1n).toString()}::bigint,
                ARRAY['DRAFT']::text[], 'SENT') AS "result"
            `.execute(database)
          ).rows,
        );
        assertQuoteWriteOutcome(sent);
        const createdAt = new Date().toISOString();
        return {
          outcome: "UPDATED",
          version: {
            id: asOpaqueId(versionId),
            quoteId: asOpaqueId(quoteId),
            versionNumber,
            sentAt: createdAt,
            pvpFinalMinor: prepared.pvpFinalMinor,
            currencyCode: prepared.currencyCode,
            payloadSha256: payloadSha256Hex,
            acceptance: null,
            isLatest: true,
            shareLinks: [],
          },
          shareLink: {
            shareLinkId: asOpaqueId(shareLinkId),
            versionId: asOpaqueId(versionId),
            versionNumber,
            createdAt,
            expiresAt: plan.expiresAt,
            revokedAt: null,
          },
        };
      });
    },

    async revokeShareLink(agencyId, shareLinkId, authorization) {
      return inTransaction(agencyId, authorization, PERMISSIONS.SEND, async (database) => {
        const revoked = await sql<{ shareLinkId: string }>`
          UPDATE "sales"."quote_share_link"
             SET "revokedAt" = now()
           WHERE "agencyId" = ${agencyId}::uuid AND "shareLinkId" = ${shareLinkId}::uuid AND "revokedAt" IS NULL
          RETURNING "shareLinkId"::text AS "shareLinkId"
        `.execute(database);
        if (revoked.rows.length === 1) return "REVOKED";
        const existing = first(
          (
            await sql<{ revoked: boolean }>`
              SELECT ("revokedAt" IS NOT NULL) AS "revoked"
                FROM "sales"."quote_share_link"
               WHERE "agencyId" = ${agencyId}::uuid AND "shareLinkId" = ${shareLinkId}::uuid
            `.execute(database)
          ).rows,
        );
        if (existing === null) return "NOT_FOUND";
        return existing.revoked ? "ALREADY_REVOKED" : "NOT_FOUND";
      });
    },

    async convertToTrip(agencyId, quoteId, authorization) {
      return inTransaction(agencyId, authorization, PERMISSIONS.CONVERT, async (database) => {
        const quote = await lockQuoteOrThrow(database, agencyId, quoteId);
        if (quote === null) return { outcome: "NOT_FOUND", tripId: null, created: false };
        if (quote.convertedTripId !== null) {
          return { outcome: "UPDATED", tripId: quote.convertedTripId, created: false };
        }
        if (quote.state !== "ACCEPTED")
          return { outcome: "INVALID_STATE", tripId: null, created: false };
        if (quote.startDate === null || quote.endDate === null) {
          throw new QuoteRuleError(
            "DATES_REQUIRED",
            "Defina as datas da viagem antes de converter",
          );
        }
        const tripId = createUuidV7();
        await sql`
          INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
          VALUES (${tripId}::uuid, ${agencyId}::uuid, ${quote.title}, ${quote.startDate}::date, ${quote.endDate}::date, 'DRAFT')
        `.execute(database);
        const primary = first(
          (
            await sql<{ personId: string }>`
              SELECT link."personId"::text AS "personId"
                FROM "crm"."customer_person" AS link
               WHERE link."agencyId" = ${agencyId}::uuid AND link."customerId" = ${quote.customerId}::uuid
                 AND link."isPrimary"
               LIMIT 1
            `.execute(database)
          ).rows,
        );
        if (primary !== null) {
          await sql`
            INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
            VALUES (${createUuidV7()}::uuid, ${agencyId}::uuid, ${tripId}::uuid, ${primary.personId}::uuid, 'PRIMARY_TRAVELLER')
          `.execute(database);
        }
        const linked = outcomeOf(
          (
            await sql<{ result: string }>`
              SELECT sales.link_quote_trip(${agencyId}::uuid, ${quoteId}::uuid, ${tripId}::uuid) AS "result"
            `.execute(database)
          ).rows,
        );
        if (linked === "ALREADY_CONVERTED") throw new OptimisticConflictError();
        if (linked !== "UPDATED") assertQuoteWriteOutcome(linked);
        return { outcome: "UPDATED", tripId: asOpaqueId(tripId), created: true };
      });
    },

    async readQuoteShare(tokenHash): Promise<QuoteSharedRecord | null> {
      // Public read: no staff session. The SECURITY DEFINER function only returns live, unrevoked links.
      const row = first(
        (
          await persistence.transaction.runInTransaction(async (context) =>
            persistence.withTransactionContext(context, async (database) =>
              sql<{
                versionId: string;
                versionNumber: number;
                canonicalPayload: unknown;
                expiresAt: Date;
                quoteState: QuoteState;
                validUntil: string;
                isLatest: boolean;
                acceptedAt: Date | null;
                acceptedName: string | null;
              }>`
                SELECT "versionId"::text AS "versionId", "versionNumber", "canonicalPayload", "expiresAt",
                       "quoteState", "validUntil"::text AS "validUntil", "isLatest",
                       "acceptedAt", "acceptedName"
                  FROM sales.read_quote_share(${Buffer.from(tokenHash)})
              `.execute(database),
            ),
          )
        ).rows,
      );
      if (row === null) return null;
      return {
        versionId: asOpaqueId(row.versionId),
        versionNumber: row.versionNumber,
        payload: row.canonicalPayload,
        expiresAt: row.expiresAt.toISOString(),
        quoteState: row.quoteState,
        validUntil: row.validUntil,
        isLatest: row.isLatest,
        acceptance:
          row.acceptedAt === null || row.acceptedName === null
            ? null
            : { acceptedAt: row.acceptedAt.toISOString(), acceptedName: row.acceptedName },
      };
    },

    async acceptQuoteShare(tokenHash, acceptedName) {
      return persistence.transaction
        .runInTransaction(async (context) =>
          persistence.withTransactionContext(context, async (database) =>
            outcomeOf(
              (
                await sql<{ result: string }>`
                SELECT sales.accept_quote_share(${Buffer.from(tokenHash)}, ${acceptedName}) AS "result"
              `.execute(database)
              ).rows,
            ),
          ),
        )
        .catch((error: unknown) => {
          throw mapPostgresMutationError(error);
        });
    },
  };
  return repository;
};
