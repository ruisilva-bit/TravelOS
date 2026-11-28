import { createHash } from "node:crypto";

import {
  asOpaqueId,
  CrmIdempotencyConflictError,
  CrmNotFoundError,
  InputValidationError,
  OptimisticConflictError,
  type CreateCustomerInput,
  type CrmCustomerDetailRecord,
  type CrmCustomerListQuery,
  type CrmCustomerPage,
  type CrmCustomerPerson,
  type CrmCustomerSummary,
  type CrmLeadSummary,
  type CrmPersonRecord,
  type CrmRepository,
  type CrmSearchResult,
  type CrmTripSummary,
  type CrmCustomerRole,
  type OpaqueId,
  type PersonUpdateDraft,
  type SetPersonRolesInput,
  type StaffAuthorizationOperationProof,
  type StaffPermissionId,
  type CustomerDetailsDraft,
} from "@travelos/backend-core";
import { sql, type Kysely } from "kysely";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { assertStaffAuthorizationInTransaction } from "../trip-operations/operational-slice-repository.js";
import { createUuidV7 } from "../uuidv7.js";

type DatabaseShape = Record<string, never>;

const CUSTOMER_CREATE_COMMAND = "customer.create";
const CRM_LIST_SEARCH_PAGE_SIZE = 5;
const CRM_NESTED_LIMIT = 50;

/** Permission policy per command; the adapter re-checks it inside the transaction. */
const PERMISSIONS = Object.freeze({
  VIEW: Object.freeze(["customer.view"] as const satisfies readonly StaffPermissionId[]),
  DETAIL: Object.freeze([
    "customer.view",
    "sales.view",
    "trip.view",
  ] as const satisfies readonly StaffPermissionId[]),
  EDIT: Object.freeze(["customer.edit"] as const satisfies readonly StaffPermissionId[]),
  PERSON_EDIT: Object.freeze(["traveller.edit"] as const satisfies readonly StaffPermissionId[]),
  SENSITIVE_EDIT: Object.freeze([
    "traveller.edit",
    "traveller.view_sensitive",
  ] as const satisfies readonly StaffPermissionId[]),
});

type CustomerRow = {
  readonly id: string;
  readonly agencyId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly notes: string | null;
  readonly lockVersion: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type CustomerSummaryRow = {
  readonly id: string;
  readonly agencyId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly primaryContactName: string | null;
  readonly peopleCount: number;
  readonly lockVersion: string;
  readonly updatedAt: Date;
};

type PersonRow = {
  readonly id: string;
  readonly agencyId: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly nationality: string | null;
  readonly notes: string | null;
  readonly birthDate: string | null;
  readonly passportNumber: string | null;
  readonly passportExpiry: string | null;
  readonly lockVersion: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type PersonLinkRow = PersonRow & {
  readonly roles: readonly CrmCustomerRole[];
  readonly isPrimary: boolean;
};

const PERSON_COLUMNS = sql`
  person."id"::text AS "id",
  person."agencyId"::text AS "agencyId",
  person."givenName",
  person."familyName",
  person."email",
  person."phone",
  person."nationality"::text AS "nationality",
  person."notes",
  person."birthDate"::text AS "birthDate",
  person."passportNumber",
  person."passportExpiry"::text AS "passportExpiry",
  person."lockVersion"::text AS "lockVersion",
  person."createdAt",
  person."updatedAt"
`;

const mapPersonRecord = (row: PersonRow): CrmPersonRecord => ({
  id: asOpaqueId(row.id),
  agencyId: asOpaqueId(row.agencyId),
  givenName: row.givenName,
  familyName: row.familyName,
  email: row.email,
  phone: row.phone,
  nationality: row.nationality,
  notes: row.notes,
  birthDate: row.birthDate,
  passportNumber: row.passportNumber,
  passportExpiry: row.passportExpiry,
  lockVersion: BigInt(row.lockVersion),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const mapCustomerSummary = (row: CustomerSummaryRow): CrmCustomerSummary => ({
  id: asOpaqueId(row.id),
  agencyId: asOpaqueId(row.agencyId),
  displayName: row.displayName,
  email: row.email,
  phone: row.phone,
  primaryContactName: row.primaryContactName,
  peopleCount: row.peopleCount,
  lockVersion: BigInt(row.lockVersion),
  updatedAt: row.updatedAt.toISOString(),
});

const first = <Row>(rows: readonly Row[]): Row | null => rows[0] ?? null;

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const escapeLikePattern = (value: string): string => value.replace(/[\\%_]/gu, (c) => `\\${c}`);

/** Case-insensitive contains pattern; null means no text filter. */
const containsPattern = (query: string | null): string | null =>
  query === null ? null : `%${escapeLikePattern(query.toLowerCase())}%`;

const readCustomerRow = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  customerId: OpaqueId,
): Promise<CustomerRow | null> =>
  first(
    (
      await sql<CustomerRow>`
        SELECT "id"::text AS "id", "agencyId"::text AS "agencyId", "displayName", "email", "phone",
               "notes", "lockVersion"::text AS "lockVersion", "createdAt", "updatedAt"
          FROM "crm"."customer"
         WHERE "agencyId" = ${agencyId}::uuid AND "id" = ${customerId}::uuid
      `.execute(database)
    ).rows,
  );

const readPersonLinks = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  customerId: OpaqueId,
): Promise<readonly CrmCustomerPerson[]> => {
  const rows = (
    await sql<PersonLinkRow>`
      SELECT ${PERSON_COLUMNS},
             array_agg(link."role" ORDER BY link."role")::text[] AS "roles",
             bool_or(link."isPrimary") AS "isPrimary"
        FROM "crm"."customer_person" AS link
        JOIN "crm"."person" AS person
          ON person."id" = link."personId" AND person."agencyId" = link."agencyId"
       WHERE link."agencyId" = ${agencyId}::uuid AND link."customerId" = ${customerId}::uuid
       GROUP BY person."id", person."agencyId"
       ORDER BY person."familyName", person."givenName", person."id"
    `.execute(database)
  ).rows;
  return rows.map((row) => ({
    ...mapPersonRecord(row),
    roles: row.roles,
    isPrimary: row.isPrimary,
  }));
};

const readLeads = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  customerId: OpaqueId,
): Promise<readonly CrmLeadSummary[]> =>
  (
    await sql<{ readonly id: string; readonly name: string; readonly state: string }>`
      SELECT lead."id"::text AS "id",
             lead."contactGivenName" || ' ' || lead."contactFamilyName" AS "name",
             lead."state"
        FROM "sales"."lead" AS lead
       WHERE lead."agencyId" = ${agencyId}::uuid
         AND lead."qualifiedCustomerId" = ${customerId}::uuid
       ORDER BY lead."createdAt" DESC, lead."id" DESC
       LIMIT ${CRM_NESTED_LIMIT}
    `.execute(database)
  ).rows.map((row) => ({ id: asOpaqueId(row.id), name: row.name, state: row.state }));

const readTrips = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  customerId: OpaqueId,
): Promise<readonly CrmTripSummary[]> =>
  (
    await sql<{
      readonly id: string;
      readonly title: string;
      readonly startDate: string;
      readonly endDate: string;
      readonly state: string;
    }>`
      SELECT trip."id"::text AS "id", trip."title", trip."startDate"::text AS "startDate",
             trip."endDate"::text AS "endDate", trip."state"
        FROM "trip_ops"."trip" AS trip
       WHERE trip."agencyId" = ${agencyId}::uuid
         AND EXISTS (
           SELECT 1
             FROM "trip_ops"."trip_traveller" AS traveller
             JOIN "crm"."customer_person" AS link
               ON link."personId" = traveller."personId" AND link."agencyId" = traveller."agencyId"
            WHERE traveller."tripId" = trip."id"
              AND traveller."agencyId" = trip."agencyId"
              AND link."customerId" = ${customerId}::uuid
         )
       ORDER BY trip."startDate" DESC, trip."id" DESC
       LIMIT ${CRM_NESTED_LIMIT}
    `.execute(database)
  ).rows.map((row) => ({
    id: asOpaqueId(row.id),
    title: row.title,
    startDate: row.startDate,
    endDate: row.endDate,
    state: row.state,
  }));

const readCustomerDetail = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  customerId: OpaqueId,
): Promise<CrmCustomerDetailRecord | null> => {
  const row = await readCustomerRow(database, agencyId, customerId);
  if (row === null) return null;
  return {
    id: asOpaqueId(row.id),
    agencyId: asOpaqueId(row.agencyId),
    displayName: row.displayName,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    lockVersion: BigInt(row.lockVersion),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    people: await readPersonLinks(database, agencyId, customerId),
    leads: await readLeads(database, agencyId, customerId),
    trips: await readTrips(database, agencyId, customerId),
  };
};

/**
 * Reads a Person without a row lock: the admin runtime holds no UPDATE privilege, so the protected
 * compare-and-swap function is the serialization point. A concurrent commit makes that UPDATE fail
 * under REPEATABLE READ (SQLSTATE 40001), which maps to an optimistic conflict.
 */
const readPersonRow = async (
  database: Kysely<DatabaseShape>,
  agencyId: OpaqueId,
  personId: OpaqueId,
): Promise<PersonRow | null> =>
  first(
    (
      await sql<PersonRow>`
        SELECT ${PERSON_COLUMNS}
          FROM "crm"."person" AS person
         WHERE person."agencyId" = ${agencyId}::uuid AND person."id" = ${personId}::uuid
      `.execute(database)
    ).rows,
  );

/** Customer filter used by list and search: name, email or phone of the Customer or any Person. */
const customerMatches = (pattern: string | null) => sql`
  (
    ${pattern}::text IS NULL OR
    lower(customer."displayName") LIKE ${pattern}::text OR
    lower(customer."email") LIKE ${pattern}::text OR
    lower(customer."phone") LIKE ${pattern}::text OR
    EXISTS (
      SELECT 1
        FROM "crm"."customer_person" AS link
        JOIN "crm"."person" AS person
          ON person."id" = link."personId" AND person."agencyId" = link."agencyId"
       WHERE link."agencyId" = customer."agencyId" AND link."customerId" = customer."id"
         AND (
           lower(person."givenName" || ' ' || person."familyName") LIKE ${pattern}::text OR
           lower(person."email") LIKE ${pattern}::text OR
           lower(person."phone") LIKE ${pattern}::text
         )
    )
  )
`;

const customerSummaryColumns = sql`
  customer."id"::text AS "id",
  customer."agencyId"::text AS "agencyId",
  customer."displayName",
  customer."email",
  customer."phone",
  (
    SELECT person."givenName" || ' ' || person."familyName"
      FROM "crm"."customer_person" AS link
      JOIN "crm"."person" AS person
        ON person."id" = link."personId" AND person."agencyId" = link."agencyId"
     WHERE link."agencyId" = customer."agencyId" AND link."customerId" = customer."id"
       AND link."isPrimary"
     LIMIT 1
  ) AS "primaryContactName",
  (
    SELECT count(DISTINCT link."personId")::integer
      FROM "crm"."customer_person" AS link
     WHERE link."agencyId" = customer."agencyId" AND link."customerId" = customer."id"
  ) AS "peopleCount",
  customer."lockVersion"::text AS "lockVersion",
  customer."updatedAt"
`;

const isIdempotencyRace = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { readonly code?: unknown }).code === "23505" &&
  (error as { readonly constraint?: unknown }).constraint === "customer_idempotency_pkey";

/** Maps PostgreSQL CRM outcomes to typed application errors; never leaks other driver errors. */
const mapCrmError = (error: unknown): unknown => {
  if (error instanceof Error) {
    const code = (error as { readonly code?: unknown }).code;
    if (code === "40001") return new OptimisticConflictError();
    if (code === "22023") return new InputValidationError(error.message);
  }
  return error;
};

const createRequestHash = (input: CreateCustomerInput): string =>
  sha256Hex(
    JSON.stringify([
      CUSTOMER_CREATE_COMMAND,
      input.customer.displayName,
      input.customer.email,
      input.customer.phone,
      input.customer.notes,
      input.primaryPerson.givenName,
      input.primaryPerson.familyName,
      input.primaryPerson.email,
      input.primaryPerson.phone,
    ]),
  );

export const createPostgresCrmRepository = (
  persistence: PostgresPersistence<DatabaseShape>,
): CrmRepository => {
  const withCrmTransaction = async <Result>(
    agencyId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
    permissions: readonly StaffPermissionId[],
    work: (database: Kysely<DatabaseShape>, actorId: string) => Promise<Result>,
  ): Promise<Result> => {
    // A concurrent request with the same idempotency key loses the key insert; one retry then
    // observes the committed Customer and replays it.
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
        throw mapCrmError(error);
      }
    }
  };

  const requireDetail = async (
    database: Kysely<DatabaseShape>,
    agencyId: OpaqueId,
    customerId: OpaqueId,
  ): Promise<CrmCustomerDetailRecord> => {
    const detail = await readCustomerDetail(database, agencyId, customerId);
    if (detail === null) throw new CrmNotFoundError();
    return detail;
  };

  const repository: CrmRepository = {
    async listCustomers(
      agencyId,
      query: CrmCustomerListQuery,
      authorization,
    ): Promise<CrmCustomerPage> {
      return withCrmTransaction(agencyId, authorization, PERMISSIONS.VIEW, async (database) => {
        const pattern = containsPattern(query.query);
        const rows = (
          await sql<CustomerSummaryRow>`
            SELECT ${customerSummaryColumns}
              FROM "crm"."customer" AS customer
             WHERE customer."agencyId" = ${agencyId}::uuid
               AND ${customerMatches(pattern)}
               AND (
                 ${query.cursor}::uuid IS NULL OR
                 (customer."displayName", customer."id") > (
                   SELECT cursor_customer."displayName", cursor_customer."id"
                     FROM "crm"."customer" AS cursor_customer
                    WHERE cursor_customer."agencyId" = ${agencyId}::uuid
                      AND cursor_customer."id" = ${query.cursor}::uuid
                 )
               )
             ORDER BY customer."displayName" ASC, customer."id" ASC
             LIMIT ${query.limit + 1}
          `.execute(database)
        ).rows;
        const items = rows.slice(0, query.limit).map(mapCustomerSummary);
        const lastItem = items[items.length - 1];
        return {
          items,
          nextCursor: rows.length > query.limit && lastItem !== undefined ? lastItem.id : null,
        };
      });
    },

    async getCustomer(agencyId, customerId, authorization) {
      return withCrmTransaction(agencyId, authorization, PERMISSIONS.DETAIL, (database) =>
        readCustomerDetail(database, agencyId, customerId),
      );
    },

    async createCustomer(agencyId, input, authorization) {
      return withCrmTransaction(
        agencyId,
        authorization,
        PERMISSIONS.EDIT,
        async (database, actorId) => {
          const requestHash = createRequestHash(input);
          if (input.idempotencyKey !== null) {
            const prior = first(
              (
                await sql<{ readonly customerId: string; readonly requestHash: string }>`
                  SELECT "customerId"::text AS "customerId", "requestHash"
                    FROM "crm"."customer_idempotency"
                   WHERE "agencyId" = ${agencyId}::uuid
                     AND "staffPrincipalId" = ${actorId}
                     AND "command" = ${CUSTOMER_CREATE_COMMAND}
                     AND "idempotencyKey" = ${input.idempotencyKey}
                `.execute(database)
              ).rows,
            );
            if (prior !== null) {
              if (prior.requestHash.trim() !== requestHash) {
                throw new CrmIdempotencyConflictError();
              }
              return requireDetail(database, agencyId, asOpaqueId(prior.customerId));
            }
          }

          const customerId = createUuidV7();
          const personId = createUuidV7();
          await sql`
            INSERT INTO "crm"."customer" ("id", "agencyId", "displayName", "email", "phone", "notes")
            VALUES (${customerId}::uuid, ${agencyId}::uuid, ${input.customer.displayName},
                    ${input.customer.email}, ${input.customer.phone}, ${input.customer.notes})
          `.execute(database);
          await sql`
            INSERT INTO "crm"."person"
              ("id", "agencyId", "givenName", "familyName", "email", "phone", "nationality", "notes")
            VALUES (${personId}::uuid, ${agencyId}::uuid, ${input.primaryPerson.givenName},
                    ${input.primaryPerson.familyName}, ${input.primaryPerson.email},
                    ${input.primaryPerson.phone}, ${input.primaryPerson.nationality},
                    ${input.primaryPerson.notes})
          `.execute(database);
          await sql`
            INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
            VALUES (${agencyId}::uuid, ${customerId}::uuid, ${personId}::uuid, 'PRIMARY_CONTACT', true)
          `.execute(database);
          if (input.idempotencyKey !== null) {
            await sql`
              INSERT INTO "crm"."customer_idempotency"
                ("agencyId", "staffPrincipalId", "command", "idempotencyKey", "customerId", "requestHash")
              VALUES (${agencyId}::uuid, ${actorId}, ${CUSTOMER_CREATE_COMMAND},
                      ${input.idempotencyKey}, ${customerId}::uuid, ${requestHash})
            `.execute(database);
          }
          return requireDetail(database, agencyId, asOpaqueId(customerId));
        },
      );
    },

    async updateCustomer(
      agencyId,
      customerId,
      expectedLockVersion,
      customer: CustomerDetailsDraft,
      authorization,
    ) {
      return withCrmTransaction(agencyId, authorization, PERMISSIONS.EDIT, async (database) => {
        const outcome = await sql<{ readonly outcome: string }>`
          SELECT "crm"."update_customer"(
            ${agencyId}::uuid, ${customerId}::uuid, ${expectedLockVersion.toString()}::bigint,
            ${customer.displayName}::text, ${customer.email}::text, ${customer.phone}::text,
            ${customer.notes}::text
          ) AS "outcome"
        `.execute(database);
        const result = first(outcome.rows)?.outcome;
        if (result === "NOT_FOUND") return null;
        if (result === "STALE") throw new OptimisticConflictError();
        if (result !== "UPDATED") throw new Error("CRM customer update returned no outcome");
        return requireDetail(database, agencyId, customerId);
      });
    },

    async addPerson(agencyId, customerId, input, authorization) {
      return withCrmTransaction(agencyId, authorization, PERMISSIONS.EDIT, async (database) => {
        const customer = await readCustomerRow(database, agencyId, customerId);
        if (customer === null) return null;
        const personId = createUuidV7();
        await sql`
          INSERT INTO "crm"."person"
            ("id", "agencyId", "givenName", "familyName", "email", "phone", "nationality", "notes")
          VALUES (${personId}::uuid, ${agencyId}::uuid, ${input.person.givenName},
                  ${input.person.familyName}, ${input.person.email}, ${input.person.phone},
                  ${input.person.nationality}, ${input.person.notes})
        `.execute(database);
        const outcome = await sql<{ readonly outcome: string }>`
          SELECT "crm"."set_customer_person_roles"(
            ${agencyId}::uuid, ${customerId}::uuid, ${personId}::uuid, ${[...input.roles]}::text[], false
          ) AS "outcome"
        `.execute(database);
        if (first(outcome.rows)?.outcome !== "UPDATED") throw new CrmNotFoundError();
        return requireDetail(database, agencyId, customerId);
      });
    },

    async updatePerson(
      agencyId,
      personId,
      expectedLockVersion,
      person: PersonUpdateDraft,
      authorization,
    ) {
      const sensitive =
        person.birthDate !== undefined ||
        person.passportNumber !== undefined ||
        person.passportExpiry !== undefined;
      return withCrmTransaction(
        agencyId,
        authorization,
        sensitive ? PERMISSIONS.SENSITIVE_EDIT : PERMISSIONS.PERSON_EDIT,
        async (database) => {
          const current = await readPersonRow(database, agencyId, personId);
          if (current === null) return null;
          if (BigInt(current.lockVersion) !== expectedLockVersion) {
            throw new OptimisticConflictError();
          }
          // Omitted sensitive fields keep their stored values; null clears them.
          const birthDate = person.birthDate === undefined ? current.birthDate : person.birthDate;
          const passportNumber =
            person.passportNumber === undefined ? current.passportNumber : person.passportNumber;
          const passportExpiry =
            person.passportExpiry === undefined ? current.passportExpiry : person.passportExpiry;
          const outcome = await sql<{ readonly outcome: string }>`
            SELECT "crm"."update_person"(
              ${agencyId}::uuid, ${personId}::uuid, ${expectedLockVersion.toString()}::bigint,
              ${person.givenName}::text, ${person.familyName}::text, ${person.email}::text,
              ${person.phone}::text, ${birthDate}::date, ${person.nationality}::text,
              ${person.notes}::text, ${passportNumber}::text, ${passportExpiry}::date
            ) AS "outcome"
          `.execute(database);
          const result = first(outcome.rows)?.outcome;
          if (result === "NOT_FOUND") return null;
          if (result === "STALE") throw new OptimisticConflictError();
          if (result !== "UPDATED") throw new Error("CRM person update returned no outcome");
          const updated = await readPersonRow(database, agencyId, personId);
          if (updated === null) throw new CrmNotFoundError();
          return mapPersonRecord(updated);
        },
      );
    },

    async setPersonRoles(
      agencyId,
      customerId,
      personId,
      input: SetPersonRolesInput,
      authorization,
    ) {
      return withCrmTransaction(agencyId, authorization, PERMISSIONS.EDIT, async (database) => {
        const outcome = await sql<{ readonly outcome: string }>`
          SELECT "crm"."set_customer_person_roles"(
            ${agencyId}::uuid, ${customerId}::uuid, ${personId}::uuid,
            ${[...input.roles]}::text[], ${input.isPrimary}::boolean
          ) AS "outcome"
        `.execute(database);
        if (first(outcome.rows)?.outcome === "NOT_FOUND") return null;
        return requireDetail(database, agencyId, customerId);
      });
    },

    async search(agencyId, query, authorization): Promise<CrmSearchResult> {
      return withCrmTransaction(agencyId, authorization, PERMISSIONS.DETAIL, async (database) => {
        const pattern = containsPattern(query);
        const customers = (
          await sql<CustomerSummaryRow>`
            SELECT ${customerSummaryColumns}
              FROM "crm"."customer" AS customer
             WHERE customer."agencyId" = ${agencyId}::uuid
               AND ${customerMatches(pattern)}
             ORDER BY customer."displayName" ASC, customer."id" ASC
             LIMIT ${CRM_LIST_SEARCH_PAGE_SIZE}
          `.execute(database)
        ).rows.map(mapCustomerSummary);
        const leads = (
          await sql<{ readonly id: string; readonly name: string; readonly state: string }>`
            SELECT lead."id"::text AS "id",
                   lead."contactGivenName" || ' ' || lead."contactFamilyName" AS "name",
                   lead."state"
              FROM "sales"."lead" AS lead
             WHERE lead."agencyId" = ${agencyId}::uuid
               AND (
                 lower(lead."contactGivenName" || ' ' || lead."contactFamilyName") LIKE ${pattern}::text OR
                 lower(lead."contactEmail") LIKE ${pattern}::text OR
                 lower(lead."contactPhone") LIKE ${pattern}::text
               )
             ORDER BY lead."createdAt" DESC, lead."id" DESC
             LIMIT ${CRM_LIST_SEARCH_PAGE_SIZE}
          `.execute(database)
        ).rows.map((row) => ({ id: asOpaqueId(row.id), name: row.name, state: row.state }));
        const trips = (
          await sql<{
            readonly id: string;
            readonly title: string;
            readonly startDate: string;
            readonly endDate: string;
            readonly state: string;
          }>`
            SELECT trip."id"::text AS "id", trip."title", trip."startDate"::text AS "startDate",
                   trip."endDate"::text AS "endDate", trip."state"
              FROM "trip_ops"."trip" AS trip
             WHERE trip."agencyId" = ${agencyId}::uuid
               AND lower(trip."title") LIKE ${pattern}::text
             ORDER BY trip."startDate" DESC, trip."id" DESC
             LIMIT ${CRM_LIST_SEARCH_PAGE_SIZE}
          `.execute(database)
        ).rows.map((row) => ({
          id: asOpaqueId(row.id),
          title: row.title,
          startDate: row.startDate,
          endDate: row.endDate,
          state: row.state,
        }));
        return { customers, leads, trips };
      });
    },
  };
  return Object.freeze(repository);
};
