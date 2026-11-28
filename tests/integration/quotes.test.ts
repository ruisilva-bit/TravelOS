import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  StaffAuthorizationError,
  asOpaqueId,
  QuoteNotFoundError,
  type OpaqueId,
} from "@travelos/backend-core";
import { createQuoteExpiryTask } from "../../apps/worker/src/quote-expiry-task.js";
import {
  createPostgresPersistence,
  createPostgresPublicQuoteOperations,
  createPostgresQuoteExpiryPort,
  createPostgresStaffQuoteOperations,
  createShareTokenCrypto,
  type PostgresPersistence,
} from "../../packages/database/src/index.js";
import { createUuidV7 } from "../../packages/database/src/uuidv7.js";
import {
  createOwnerClient,
  createStaff,
  host,
  port,
  registrySessionResolver,
  type StaffSessionRegistry,
} from "./helpers/postgres.js";
import {
  agencyId,
  databaseName,
  persistence as tripFixturePersistence,
  primaryStaffFixture,
  queryAs,
  queryAsOwner,
  queryErrorCode,
  queryErrorConstraint,
  setupTripFixtures,
  sqlLiteral,
  teardownTripFixtures,
} from "./helpers/trip-fixtures.js";

const ADMIN = "travelos_admin_api";
const WORKER = "travelos_worker";
const staff = sqlLiteral(primaryStaffFixture.staffPrincipalId);
const agency = sqlLiteral(agencyId);
const today = "(clock_timestamp() AT TIME ZONE 'UTC')::date";

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");
const tokenHash = (token: string) => `decode('${sha256Hex(token)}', 'hex')`;

/** Owner-side seeding. The admin and worker logins are exercised separately below. */
const seedCustomer = async (displayName: string): Promise<string> => {
  const id = createUuidV7();
  await queryAsOwner(
    `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
     VALUES ('${id}'::uuid, ${agency}::uuid, ${sqlLiteral(displayName)})`,
  );
  return id;
};

const seedLead = async (customerId: string | null): Promise<string> => {
  const id = createUuidV7();
  await queryAsOwner(
    `INSERT INTO "sales"."lead" ("id", "agencyId", "source", "contactGivenName", "contactFamilyName",
                                 "state", "lockVersion", "customerId")
     VALUES ('${id}'::uuid, ${agency}::uuid, 'WEBSITE', 'Ana', 'Quotes', 'OPEN', 1,
             ${customerId === null ? "NULL" : `'${customerId}'::uuid`})`,
  );
  return id;
};

interface QuoteOptions {
  readonly customerId: string;
  readonly leadId: string;
  readonly validUntil?: string;
}

let numberCounter = 5000;
const seedQuote = async ({ customerId, leadId, validUntil }: QuoteOptions): Promise<string> => {
  const id = createUuidV7();
  numberCounter += 1;
  const number = `ORC-2027-${String(numberCounter).padStart(4, "0")}`;
  await queryAsOwner(
    `INSERT INTO "sales"."quote" ("id", "agencyId", "customerId", "leadId", "number", "title",
                                  "validUntil", "createdByStaffPrincipalId")
     VALUES ('${id}'::uuid, ${agency}::uuid, '${customerId}'::uuid, '${leadId}'::uuid,
             ${sqlLiteral(number)}, 'Lisboa para Funchal', ${validUntil ? sqlLiteral(validUntil) : `${today} + 14`},
             ${staff})`,
  );
  return id;
};

const seedLine = async (quoteId: string, position: number): Promise<string> => {
  const id = randomUUID();
  await queryAsOwner(
    `INSERT INTO "sales"."quote_line" ("id", "agencyId", "quoteId", "section", "position", "category",
                                       "service", "supplier", "netSupplierMinor", "recommendedMinor", "pvpMinor")
     VALUES ('${id}'::uuid, ${agency}::uuid, '${quoteId}'::uuid, 'BASE', ${position}, 'OTHER',
             'Transfer aeroporto', 'Fornecedor', 70000, 95000, 80000)`,
  );
  return id;
};

const seedVersion = async (quoteId: string, versionNumber: number): Promise<string> => {
  const id = randomUUID();
  await queryAsOwner(
    `INSERT INTO "sales"."quote_version" ("id", "agencyId", "quoteId", "versionNumber", "sentByStaffPrincipalId",
                                          "canonicalPayload", "payloadSha256", "pvpFinalMinor", "currencyCode")
     VALUES ('${id}'::uuid, ${agency}::uuid, '${quoteId}'::uuid, ${versionNumber}, ${staff},
             '{"title":"Proposta"}'::jsonb, decode('${sha256Hex(id)}', 'hex'), 248000, 'EUR')`,
  );
  return id;
};

const seedShareLink = async (
  quoteId: string,
  versionId: string,
  token: string,
  expiresIn = "7 days",
): Promise<string> => {
  const id = randomUUID();
  await queryAsOwner(
    `INSERT INTO "sales"."quote_share_link" ("shareLinkId", "agencyId", "quoteId", "versionId", "tokenHash",
                                             "createdByStaffPrincipalId", "idempotencyKey", "expiresAt")
     VALUES ('${id}'::uuid, ${agency}::uuid, '${quoteId}'::uuid, '${versionId}'::uuid, ${tokenHash(token)},
             ${staff}, '${randomUUID()}', now() + interval '${expiresIn}')`,
  );
  return id;
};

const markSent = async (quoteId: string): Promise<void> => {
  const [current] = await queryAsOwner<{ lockVersion: string }>(
    `SELECT "lockVersion"::text AS "lockVersion" FROM "sales"."quote" WHERE id = '${quoteId}'::uuid`,
  );
  const rows = await queryAsOwner<{ result: string }>(
    `SELECT sales.set_quote_state(${agency}::uuid, '${quoteId}'::uuid, ${current?.lockVersion ?? 0},
                                  ARRAY['DRAFT']::text[], 'SENT') AS result`,
  );
  expect(rows[0]?.result).toBe("UPDATED");
};

const lockOf = async (quoteId: string): Promise<string> => {
  const [row] = await queryAsOwner<{ lockVersion: string }>(
    `SELECT "lockVersion"::text AS "lockVersion" FROM "sales"."quote" WHERE id = '${quoteId}'::uuid`,
  );
  return row?.lockVersion ?? "0";
};

const callText = async (sql: string, user = ADMIN): Promise<string | undefined> =>
  (await queryAs<{ result: string }>(user, `SELECT ((${sql}))::text AS result`))[0]?.result;

let customerA = "";
let customerB = "";
let leadA = "";

beforeAll(async () => {
  await setupTripFixtures("travelos_quotes");
  customerA = await seedCustomer("Cliente Quotes A");
  customerB = await seedCustomer("Cliente Quotes B");
  leadA = await seedLead(null);
});

afterAll(async () => {
  await teardownTripFixtures();
});

describe.sequential("quotes schema, functions and privileges (0004)", () => {
  it("allocates ORC-YYYY-NNNN numbers sequentially and per year", async () => {
    const first = await callText(`sales.next_quote_number(${agency}::uuid, 2027)`);
    const second = await callText(`sales.next_quote_number(${agency}::uuid, 2027)`);
    const nextYear = await callText(`sales.next_quote_number(${agency}::uuid, 2028)`);
    expect(first).toBe("ORC-2027-0001");
    expect(second).toBe("ORC-2027-0002");
    expect(nextYear).toBe("ORC-2028-0001");
    expect(
      await queryErrorCode(() => queryAs(ADMIN, "SELECT sales.next_quote_number(NULL, 2027)")),
    ).toBe("22023");
  });

  it("links a lead to its customer only through the CAS function and rejects mismatched quotes", async () => {
    expect(
      await callText(
        `sales.set_lead_customer(${agency}::uuid, '${leadA}'::uuid, 7, '${customerA}'::uuid)`,
      ),
    ).toBe("STALE");
    expect(
      await callText(
        `sales.set_lead_customer(${agency}::uuid, '${leadA}'::uuid, 1, '${customerA}'::uuid)`,
      ),
    ).toBe("UPDATED");
    expect(
      await callText(
        `sales.set_lead_customer(${agency}::uuid, '${leadA}'::uuid, 1, '${customerA}'::uuid)`,
      ),
    ).toBe("STALE");
    expect(
      await callText(
        `sales.set_lead_customer(${agency}::uuid, '${randomUUID()}'::uuid, 1, '${customerA}'::uuid)`,
      ),
    ).toBe("NOT_FOUND");

    const mismatch = await queryErrorConstraint(() =>
      queryAsOwner(
        `INSERT INTO "sales"."quote" ("id", "agencyId", "customerId", "leadId", "number", "title", "createdByStaffPrincipalId")
         VALUES ('${randomUUID()}'::uuid, ${agency}::uuid, '${customerB}'::uuid, '${leadA}'::uuid,
                 'ORC-2027-9001', 'Mismatch', ${staff})`,
      ),
    );
    expect(mismatch).toBe("quote_lead_customer_mismatch");

    const quoteId = await seedQuote({ customerId: customerA, leadId: leadA });
    expect(quoteId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(
      await callText(
        `sales.set_lead_customer(${agency}::uuid, '${leadA}'::uuid, 2, '${customerB}'::uuid)`,
      ),
    ).toBe("CUSTOMER_MISMATCH");
  });

  it("rejects a quote number that does not match the ORC shape and invalid lock tokens", async () => {
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `INSERT INTO "sales"."quote" ("id", "agencyId", "customerId", "leadId", "number", "title", "createdByStaffPrincipalId")
           VALUES ('${randomUUID()}'::uuid, ${agency}::uuid, '${customerA}'::uuid, '${leadA}'::uuid, 'X-1', 'Bad', ${staff})`,
        ),
      ),
    ).toBe("quote_number_shape");
    expect(
      await queryErrorCode(() =>
        queryAs(
          ADMIN,
          `SELECT sales.update_quote(${agency}::uuid, NULL, 0, 'x', NULL, NULL, NULL, 1, 0, ${today}, NULL, 1500, 2000, 3000, 45, NULL, NULL, NULL, ARRAY[]::text[])`,
        ),
      ),
    ).toBe("22023");
  });

  it("applies header CAS: STALE on a stale token, UPDATED on the current one, NOT_DRAFT after send", async () => {
    const quoteId = await seedQuote({ customerId: customerA, leadId: leadA });
    const update = (version: number, title = "Lisboa para Funchal 2") =>
      callText(
        `sales.update_quote(${agency}::uuid, '${quoteId}'::uuid, ${version}, ${sqlLiteral(title)}, 'Funchal', '2027-03-10', '2027-03-17', 2, 0, ${today} + 30, 248000, 1500, 2000, 3000, 45, NULL, NULL, NULL, ARRAY['Gorjetas']::text[])`,
      );
    expect(await update(7)).toBe("STALE");
    expect(await update(0)).toBe("UPDATED");
    expect(await update(0)).toBe("STALE");
    expect(await update(1)).toBe("UPDATED");
    await markSent(quoteId);
    expect(await update(3)).toBe("NOT_DRAFT");
  });

  it("freezes lines once the quote leaves DRAFT and reorders atomically while DRAFT", async () => {
    const quoteId = await seedQuote({ customerId: customerA, leadId: leadA });
    const first = await seedLine(quoteId, 0);
    const second = await seedLine(quoteId, 1);

    const reorderOutOfSet = await queryErrorCode(() =>
      queryAs(
        ADMIN,
        `SELECT sales.reorder_quote_lines(${agency}::uuid, '${quoteId}'::uuid, 0,
        ARRAY['${first}'::uuid], ARRAY['BASE']::text[])`,
      ),
    );
    expect(reorderOutOfSet).toBe("22023");
    // The rejected reorder left positions untouched and did not bump the quote.
    const positions = await queryAsOwner<{ id: string; position: number }>(
      `SELECT id, position FROM "sales"."quote_line" WHERE "quoteId" = '${quoteId}'::uuid ORDER BY position`,
    );
    expect(positions.map(({ id }) => id)).toEqual([first, second]);

    expect(
      await callText(`sales.reorder_quote_lines(${agency}::uuid, '${quoteId}'::uuid, 0,
      ARRAY['${second}','${first}']::uuid[], ARRAY['OPTION','BASE']::text[])`),
    ).toBe("UPDATED");
    const reordered = await queryAsOwner<{ id: string; section: string; position: number }>(
      `SELECT id, section, position FROM "sales"."quote_line" WHERE "quoteId" = '${quoteId}'::uuid ORDER BY section, position`,
    );
    expect(reordered).toEqual([
      { id: first, section: "BASE", position: 0 },
      { id: second, section: "OPTION", position: 0 },
    ]);
    expect(
      await callText(
        `sales.reorder_quote_lines(${agency}::uuid, '${quoteId}'::uuid, 0, ARRAY['${first}']::uuid[], ARRAY['BASE']::text[])`,
      ),
    ).toBe("STALE");

    const lineUpdate = (version: number) =>
      callText(
        [
          `sales.update_quote_line(${agency}::uuid, '${first}'::uuid, ${version}`,
          "'OTHER', 'Transfer', 'Fornecedor', NULL, NULL, NULL, 1",
          "70000, 95000, 90000, true",
          "NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)",
        ].join(", "),
      );
    expect(await lineUpdate(9)).toBe("STALE");
    expect(await lineUpdate(1)).toBe("UPDATED"); // reorder already advanced the line token once

    await markSent(quoteId);
    expect(await lineUpdate(2)).toBe("NOT_DRAFT");
    expect(await callText(`sales.delete_quote_line(${agency}::uuid, '${second}'::uuid, 1)`)).toBe(
      "NOT_DRAFT",
    );
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `INSERT INTO "sales"."quote_line" ("id", "agencyId", "quoteId", "section", "position", "category", "service")
           VALUES ('${randomUUID()}'::uuid, ${agency}::uuid, '${quoteId}'::uuid, 'BASE', 9, 'OTHER', 'Late line')`,
        ),
      ),
    ).toBe("quote_not_draft");
  });

  it("keeps versions immutable and share links changeable only by a one-time revocation", async () => {
    const quoteId = await seedQuote({ customerId: customerA, leadId: leadA });
    const versionId = await seedVersion(quoteId, 1);
    const linkId = await seedShareLink(quoteId, versionId, "token-revocation");

    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "sales"."quote_version" SET "pvpFinalMinor" = 1 WHERE id = '${versionId}'::uuid`,
        ),
      ),
    ).toBe("quote_version_immutable");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(`DELETE FROM "sales"."quote_version" WHERE id = '${versionId}'::uuid`),
      ),
    ).toBe("quote_version_immutable");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "sales"."quote_share_link" SET "expiresAt" = now() + interval '90 days' WHERE "shareLinkId" = '${linkId}'::uuid`,
        ),
      ),
    ).toBe("quote_share_link_immutable");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `DELETE FROM "sales"."quote_share_link" WHERE "shareLinkId" = '${linkId}'::uuid`,
        ),
      ),
    ).toBe("quote_share_link_immutable");

    await queryAsOwner(
      `UPDATE "sales"."quote_share_link" SET "revokedAt" = now() WHERE "shareLinkId" = '${linkId}'::uuid`,
    );
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "sales"."quote_share_link" SET "revokedAt" = NULL WHERE "shareLinkId" = '${linkId}'::uuid`,
        ),
      ),
    ).toBe("quote_share_link_immutable");
  });

  it("accepts a sent version once and refuses expired, revoked and unknown links", async () => {
    const quoteId = await seedQuote({ customerId: customerA, leadId: leadA });
    await markSent(quoteId);
    const versionId = await seedVersion(quoteId, 1);
    await seedShareLink(quoteId, versionId, "token-accept");

    const accept = (token: string, name = "Ana Quotes") =>
      callText(`sales.accept_quote_share(${tokenHash(token)}, ${sqlLiteral(name)})`);
    expect(await accept("token-unknown")).toBe("UNAVAILABLE");
    expect(await accept("token-accept")).toBe("ACCEPTED");
    expect(await accept("token-accept")).toBe("ALREADY_ACCEPTED");
    const state = await queryAsOwner<{ state: string }>(
      `SELECT state FROM "sales"."quote" WHERE id = '${quoteId}'::uuid`,
    );
    expect(state[0]?.state).toBe("ACCEPTED");
    const shared = await queryAs<{ acceptedName: string }>(
      ADMIN,
      `SELECT "acceptedName" FROM sales.read_quote_share(${tokenHash("token-accept")})`,
    );
    expect(shared).toEqual([{ acceptedName: "Ana Quotes" }]);

    const expiredQuote = await seedQuote({ customerId: customerA, leadId: leadA });
    await markSent(expiredQuote);
    const expiredVersion = await seedVersion(expiredQuote, 1);
    await seedShareLink(expiredQuote, expiredVersion, "token-expired", "1 second");
    await queryAsOwner(`SELECT pg_sleep(1.5)`);
    expect(await accept("token-expired")).toBe("UNAVAILABLE");

    const revokedQuote = await seedQuote({ customerId: customerA, leadId: leadA });
    await markSent(revokedQuote);
    const revokedVersion = await seedVersion(revokedQuote, 1);
    const revokedLink = await seedShareLink(revokedQuote, revokedVersion, "token-revoked");
    await queryAsOwner(
      `UPDATE "sales"."quote_share_link" SET "revokedAt" = now() WHERE "shareLinkId" = '${revokedLink}'::uuid`,
    );
    expect(await accept("token-revoked")).toBe("UNAVAILABLE");
  });

  it("refuses to accept a superseded version, reports isLatest, and keeps the link readable after revision", async () => {
    const quoteId = await seedQuote({ customerId: customerA, leadId: leadA });
    await markSent(quoteId);
    const firstVersion = await seedVersion(quoteId, 1);
    await seedShareLink(quoteId, firstVersion, "token-superseded");
    const accept = (token: string) =>
      callText(`sales.accept_quote_share(${tokenHash(token)}, 'Ana Quotes')`);

    const latestBefore = await queryAs<{ isLatest: boolean }>(
      ADMIN,
      `SELECT "isLatest" FROM sales.read_quote_share(${tokenHash("token-superseded")})`,
    );
    expect(latestBefore).toEqual([{ isLatest: true }]);

    // Revise: SENT -> DRAFT keeps the existing link, then a new version is sent.
    expect(
      await callText(
        `sales.set_quote_state(${agency}::uuid, '${quoteId}'::uuid, ${await lockOf(quoteId)}, ARRAY['SENT'], 'DRAFT')`,
      ),
    ).toBe("UPDATED");
    expect(await accept("token-superseded")).toBe("UNAVAILABLE");
    await markSent(quoteId);
    await seedVersion(quoteId, 2);

    const latestAfter = await queryAs<{ isLatest: boolean; quoteState: string }>(
      ADMIN,
      `SELECT "isLatest", "quoteState" FROM sales.read_quote_share(${tokenHash("token-superseded")})`,
    );
    expect(latestAfter).toEqual([{ isLatest: false, quoteState: "SENT" }]);
    expect(await accept("token-superseded")).toBe("SUPERSEDED");
    const acceptances = await queryAsOwner<{ count: string }>(
      `SELECT count(*)::text AS count FROM "sales"."quote_acceptance" WHERE "versionId" = '${firstVersion}'::uuid`,
    );
    expect(acceptances[0]?.count).toBe("0");
  });

  it("maintains quote days only while DRAFT and links a converted trip only after acceptance", async () => {
    const quoteId = await seedQuote({ customerId: customerA, leadId: leadA });
    const upsert = (version: string | number) =>
      callText(
        `sales.upsert_quote_day(${agency}::uuid, '${quoteId}'::uuid, ${version}, 0, 'Chegada', NULL)`,
      );
    expect(await upsert(await lockOf(quoteId))).toBe("UPDATED");
    expect(await upsert(99)).toBe("STALE");
    expect(
      await callText(
        `sales.delete_quote_day(${agency}::uuid, '${quoteId}'::uuid, ${await lockOf(quoteId)}, 0)`,
      ),
    ).toBe("DELETED");
    expect(
      await callText(
        `sales.link_quote_trip(${agency}::uuid, '${quoteId}'::uuid, gen_random_uuid())`,
      ),
    ).toBe("INVALID_STATE");
    await markSent(quoteId);
    expect(await upsert(await lockOf(quoteId))).toBe("NOT_DRAFT");
    expect(
      await callText(
        `sales.reset_quote_days(${agency}::uuid, '${quoteId}'::uuid, ${await lockOf(quoteId)})`,
      ),
    ).toBe("NOT_DRAFT");
  });

  it("expires SENT quotes past their validity through the worker function", async () => {
    const pastQuote = await seedQuote({
      customerId: customerA,
      leadId: leadA,
      validUntil: "2020-01-01",
    });
    await markSent(pastQuote);
    const futureQuote = await seedQuote({ customerId: customerA, leadId: leadA });
    await markSent(futureQuote);
    const count = await callText(`job_runtime.expire_quotes(now())`, WORKER);
    expect(Number(count)).toBeGreaterThanOrEqual(1);
    const states = await queryAsOwner<{ id: string; state: string }>(
      `SELECT id, state FROM "sales"."quote" WHERE id IN ('${pastQuote}'::uuid, '${futureQuote}'::uuid)`,
    );
    expect(Object.fromEntries(states.map(({ id, state }) => [id, state]))).toEqual({
      [pastQuote]: "EXPIRED",
      [futureQuote]: "SENT",
    });
    expect(await callText(`job_runtime.expire_quotes(now())`, WORKER)).toBe("0");
  });

  it("the worker expiry task expires a SENT quote past validity after one tick", async () => {
    const overdueQuote = await seedQuote({
      customerId: customerA,
      leadId: leadA,
      validUntil: "2020-01-02",
    });
    await markSent(overdueQuote);
    const workerPersistence = createPostgresPersistence({
      host,
      port,
      database: databaseName,
      user: WORKER,
      tls: { mode: "DISABLED_LOOPBACK_ONLY" },
      applicationName: "worker-quote-expiry-test",
      maxConnections: 2,
    });
    try {
      const logs: unknown[] = [];
      const task = createQuoteExpiryTask({
        port: createPostgresQuoteExpiryPort(
          workerPersistence as PostgresPersistence<Record<string, never>>,
        ),
        clock: Date.now,
        log: (record) => logs.push(record),
      });
      await task.tick();
      const [row] = await queryAsOwner<{ state: string }>(
        `SELECT state FROM "sales"."quote" WHERE id = '${overdueQuote}'::uuid`,
      );
      expect(row?.state).toBe("EXPIRED");
      expect(logs).toContainEqual(
        expect.objectContaining({ action: "quote_expiry", outcome: "SUCCEEDED" }),
      );
    } finally {
      await workerPersistence.destroy();
    }
  });

  it("denies the admin runtime any direct UPDATE or DELETE on quote tables and the worker any internal column", async () => {
    const quoteId = await seedQuote({ customerId: customerA, leadId: leadA });
    expect(
      await queryErrorCode(() =>
        queryAs(ADMIN, `UPDATE sales.quote SET title = 'x' WHERE id = '${quoteId}'::uuid`),
      ),
    ).toBe("42501");
    expect(await queryErrorCode(() => queryAs(ADMIN, `DELETE FROM sales.quote_line`))).toBe(
      "42501",
    );
    expect(
      await queryErrorCode(() =>
        queryAs(ADMIN, `UPDATE sales.quote_version SET "pvpFinalMinor" = 1`),
      ),
    ).toBe("42501");
    expect(
      await queryErrorCode(() =>
        queryAs(WORKER, `SELECT "netSupplierMinor" FROM sales.quote_line`),
      ),
    ).toBe("42501");
    expect(
      await queryErrorCode(() => queryAs(WORKER, `SELECT "internalNotes" FROM sales.quote`)),
    ).toBe("42501");
    expect(
      await queryErrorCode(() => queryAs(WORKER, `UPDATE sales.quote SET state = 'EXPIRED'`)),
    ).toBe("42501");
  });
});

describe.sequential("quote application flow over PostgreSQL", () => {
  const sessions: StaffSessionRegistry = new Map();
  const sessionResolver = registrySessionResolver(sessions);
  let owner: Awaited<ReturnType<typeof createOwnerClient>> | null = null;
  let operations: ReturnType<typeof createPostgresStaffQuoteOperations>;
  let publicOperations: ReturnType<typeof createPostgresPublicQuoteOperations>;
  let persistenceForFlow: PostgresPersistence<Record<string, never>>;
  let editorCookie = "";
  let viewerCookie = "";
  let flowCustomer = "";
  let flowLead = "";
  let flowLeadWithoutCustomer = "";
  const shareTokens = createShareTokenCrypto();

  const seedPrimaryPerson = async (customerId: string, givenName: string): Promise<void> => {
    const personId = createUuidV7();
    await queryAsOwner(
      `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName", "email")
       VALUES ('${personId}'::uuid, ${agency}::uuid, ${sqlLiteral(givenName)}, 'Quintela', 'marta@example.test')`,
    );
    await queryAsOwner(
      `INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
       VALUES (${agency}::uuid, '${customerId}'::uuid, '${personId}'::uuid, 'PRIMARY_CONTACT', true)`,
    );
  };

  beforeAll(async () => {
    persistenceForFlow = tripFixturePersistence as PostgresPersistence<Record<string, never>>;
    owner = await createOwnerClient(databaseName);
    const editor = await createStaff(
      owner,
      sessions,
      "quote-editor",
      ["quote.view", "quote.edit", "quote.send", "customer.view", "trip.edit"],
      // Sending a customer-visible version requires recent MFA, like share links.
      { agencyId: agencyId as string, recentMfa: true },
    );
    editorCookie = editor.cookie;
    const viewer = await createStaff(owner, sessions, "quote-viewer", ["quote.view"], {
      agencyId: agencyId as string,
    });
    viewerCookie = viewer.cookie;
    operations = createPostgresStaffQuoteOperations(persistenceForFlow, {
      sessionResolver,
      shareTokens,
      publicBaseUrl: "https://propostas.test",
    });
    publicOperations = createPostgresPublicQuoteOperations(persistenceForFlow, shareTokens);
    flowCustomer = await seedCustomer("Marta Quintela");
    await seedPrimaryPerson(flowCustomer, "Marta");
    flowLead = await seedLead(flowCustomer);
    flowLeadWithoutCustomer = await seedLead(null);
  });

  afterAll(async () => {
    await owner?.end();
  });

  const quoteIdOf = (quote: { readonly id: string }) => quote.id as OpaqueId;

  it("creates, prices and sends a proposal whose customer snapshot has no internal fields", async () => {
    await expect(
      operations.createQuote(editorCookie, asOpaqueId(flowLeadWithoutCustomer), {}),
    ).rejects.toMatchObject({ code: "LEAD_NOT_QUALIFIED" });
    await expect(
      operations.createQuote(viewerCookie, asOpaqueId(flowLead), {}),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);

    const quote = await operations.createQuote(editorCookie, asOpaqueId(flowLead), {
      destination: "Funchal",
      startDate: "2027-03-10",
      endDate: "2027-03-17",
    });
    expect(quote.number).toMatch(/^ORC-\d{4}-\d{4}$/u);
    expect(quote.title).toBe("Funchal · Marta Quintela");
    expect(quote.customerId).toBe(flowCustomer);

    const quoteId = quoteIdOf(quote);
    await operations.addLine(editorCookie, quoteId, {
      section: "BASE",
      line: {
        category: "FLIGHT",
        fromIata: "LIS",
        toIata: "FNC",
        departTime: "08:15",
        arriveTime: "09:30",
        carrier: "TAP",
        flightNumber: "TP1234",
        startDate: "2027-03-10",
        endDate: "2027-03-10",
        netSupplierMinor: 70000n,
        recommendedMinor: 95000n,
        supplier: "SEGREDO fornecedor",
        internalNote: "SEGREDO nota",
      },
    });
    const withHotel = await operations.addLine(editorCookie, quoteId, {
      section: "BASE",
      line: {
        category: "ACCOMMODATION",
        service: "Hotel Estrela",
        location: "Funchal",
        roomType: "Duplo",
        boardBasis: "Meia pensão",
        netSupplierMinor: 72000n,
        recommendedMinor: 92000n,
      },
    });
    expect(withHotel.lines.map((line) => line.service)).toContain("Hotel Estrela");
    const priced = await operations.applyTargetMargin(editorCookie, quoteId, {
      lineIds: null,
      rounding: "EURO",
    });
    expect(priced.lines.every((line) => line.pvpMinor > 0n)).toBe(true);

    const sent = await operations.sendQuote(editorCookie, quoteId, {
      expectedLockVersion: priced.quote.lockVersion,
      expiresAt: null,
    });
    expect(sent.versionNumber).toBe(1);
    expect(sent.messageText).toContain("Olá Marta");
    expect(sent.whatsappUrl).toContain("wa.me/");

    const shown = await publicOperations.readPublicQuote(sent.token, "2027-01-01");
    const serialized = JSON.stringify(shown.payload);
    expect(serialized).not.toContain("SEGREDO");
    expect(serialized).not.toContain("netSupplier");
    expect(serialized).not.toContain("recommended");
    expect(shown.isLatest).toBe(true);
    expect(shown.accepted).toBeNull();
  });

  it("accepts once, then converts the accepted quote into an idempotent trip", async () => {
    const quote = await operations.createQuote(editorCookie, asOpaqueId(flowLead), {
      destination: "Porto",
      startDate: "2027-05-01",
      endDate: "2027-05-03",
    });
    const quoteId = quoteIdOf(quote);
    await operations.addLine(editorCookie, quoteId, {
      section: "BASE",
      line: {
        category: "ACCOMMODATION",
        service: "Hotel Porto",
        pvpMinor: 90000n,
        netSupplierMinor: 60000n,
      },
    });
    const sent = await operations.sendQuote(editorCookie, quoteId, {
      expectedLockVersion: quote.lockVersion,
      expiresAt: null,
    });
    expect(await publicOperations.acceptPublicQuote(sent.token, "Marta Quintela")).toBe("ACCEPTED");
    expect(await publicOperations.acceptPublicQuote(sent.token, "Marta Quintela")).toBe(
      "ALREADY_ACCEPTED",
    );
    const accepted = await publicOperations.readPublicQuote(sent.token, "2027-01-01");
    expect(accepted.accepted?.name).toBe("Marta Quintela");

    const first = await operations.convertToTrip(editorCookie, quoteId);
    expect(first.created).toBe(true);
    const second = await operations.convertToTrip(editorCookie, quoteId);
    expect(second).toEqual({ tripId: first.tripId, created: false });
    const trips = await queryAsOwner<{ title: string; state: string }>(
      `SELECT title, state FROM trip_ops.trip WHERE id = '${first.tripId}'::uuid`,
    );
    expect(trips).toEqual([{ title: "Porto · Marta Quintela", state: "DRAFT" }]);
    const travellers = await queryAsOwner<{ role: string }>(
      `SELECT role FROM trip_ops.trip_traveller WHERE "tripId" = '${first.tripId}'::uuid`,
    );
    expect(travellers).toEqual([{ role: "PRIMARY_TRAVELLER" }]);

    await expect(
      operations.convertToTrip(editorCookie, asOpaqueId(flowLead)),
    ).rejects.toBeInstanceOf(QuoteNotFoundError);
  });

  it("converts an accepted flight and hotel quote into items, reservations and NET costs once", async () => {
    const quote = await operations.createQuote(editorCookie, asOpaqueId(flowLead), {
      destination: "Madeira",
      startDate: "2027-06-01",
      endDate: "2027-06-05",
    });
    const quoteId = quoteIdOf(quote);
    await operations.addLine(editorCookie, quoteId, {
      section: "BASE",
      line: {
        category: "FLIGHT",
        service: "Ida LIS-FNC",
        supplier: "TAP",
        fromIata: "LIS",
        toIata: "FNC",
        departTime: "08:15",
        arriveTime: "09:30",
        carrier: "TAP",
        flightNumber: "TP1234",
        startDate: "2027-06-01",
        endDate: "2027-06-01",
        pvpMinor: 95000n,
        netSupplierMinor: 70000n,
      },
    });
    await operations.addLine(editorCookie, quoteId, {
      section: "BASE",
      line: {
        category: "FLIGHT",
        service: "Volta FNC-LIS",
        supplier: "TAP",
        fromIata: "FNC",
        toIata: "LIS",
        departTime: "18:00",
        arriveTime: "20:10",
        carrier: "TAP",
        flightNumber: "TP1235",
        startDate: "2027-06-05",
        endDate: "2027-06-05",
        pvpMinor: 95000n,
        netSupplierMinor: 50000n,
      },
    });
    await operations.addLine(editorCookie, quoteId, {
      section: "BASE",
      line: {
        category: "ACCOMMODATION",
        service: "Hotel Estrela",
        supplier: "Hotel Estrela, Lda",
        location: "Funchal",
        roomType: "Duplo",
        boardBasis: "Meia pensão",
        startDate: "2027-06-01",
        endDate: "2027-06-05",
        pvpMinor: 120000n,
        netSupplierMinor: 72000n,
      },
    });
    const sent = await operations.sendQuote(editorCookie, quoteId, {
      expectedLockVersion: quote.lockVersion,
      expiresAt: null,
    });
    expect(await publicOperations.acceptPublicQuote(sent.token, "Marta Quintela")).toBe("ACCEPTED");

    const first = await operations.convertToTrip(editorCookie, quoteId);
    expect(first.created).toBe(true);
    const counts = async () => {
      const [row] = await queryAsOwner<{
        items: string;
        flights: string;
        accommodations: string;
        reservations: string;
        links: string;
        costs: string;
        netMinor: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM trip_ops.itinerary_item WHERE "tripId" = '${first.tripId}'::uuid) AS items,
           (SELECT count(*)::text FROM trip_ops.flight_item_detail WHERE "tripId" = '${first.tripId}'::uuid) AS flights,
           (SELECT count(*)::text FROM trip_ops.accommodation_item_detail WHERE "tripId" = '${first.tripId}'::uuid) AS accommodations,
           (SELECT count(*)::text FROM trip_ops.reservation WHERE "tripId" = '${first.tripId}'::uuid) AS reservations,
           (SELECT count(*)::text FROM trip_ops.reservation_item_link WHERE "tripId" = '${first.tripId}'::uuid) AS links,
           (SELECT count(*)::text FROM finance.supplier_cost_line WHERE "tripId" = '${first.tripId}'::uuid) AS costs,
           (SELECT COALESCE(sum("amountMinor"), 0)::text FROM finance.supplier_cost_line WHERE "tripId" = '${first.tripId}'::uuid) AS "netMinor"`,
      );
      return row;
    };
    expect(await counts()).toEqual({
      items: "3",
      flights: "2",
      accommodations: "1",
      reservations: "2",
      links: "3",
      costs: "2",
      netMinor: "192000",
    });
    const flights = await queryAsOwner<{
      departureAirport: string;
      departureTimezone: string;
      arrivalTimezone: string;
      departureInstant: Date;
    }>(
      `SELECT "departureAirport", "departureTimezone", "arrivalTimezone", "departureInstant"
         FROM trip_ops.flight_item_detail WHERE "tripId" = '${first.tripId}'::uuid
        ORDER BY "departureInstant"`,
    );
    expect(
      flights.map(({ departureAirport, departureTimezone, arrivalTimezone }) => ({
        departureAirport,
        departureTimezone,
        arrivalTimezone,
      })),
    ).toEqual([
      {
        departureAirport: "LIS",
        departureTimezone: "Europe/Lisbon",
        arrivalTimezone: "Atlantic/Madeira",
      },
      {
        departureAirport: "FNC",
        departureTimezone: "Atlantic/Madeira",
        arrivalTimezone: "Europe/Lisbon",
      },
    ]);
    const costs = await queryAsOwner<{
      classification: string;
      supplierName: string;
      amountMinor: string;
    }>(
      `SELECT c.classification, r."supplierName", c."amountMinor"::text AS "amountMinor"
         FROM finance.supplier_cost_line c
         JOIN trip_ops.reservation r ON r.id = c."reservationId"
        WHERE c."tripId" = '${first.tripId}'::uuid
        ORDER BY r."supplierName"`,
    );
    expect(costs).toEqual([
      { classification: "INTERNAL_ONLY", supplierName: "Hotel Estrela, Lda", amountMinor: "72000" },
      { classification: "INTERNAL_ONLY", supplierName: "TAP", amountMinor: "120000" },
    ]);

    const second = await operations.convertToTrip(editorCookie, quoteId);
    expect(second).toEqual({ tripId: first.tripId, created: false });
    expect(await counts()).toEqual({
      items: "3",
      flights: "2",
      accommodations: "1",
      reservations: "2",
      links: "3",
      costs: "2",
      netMinor: "192000",
    });
  });

  it("supersedes an older link after revision, and refuses acceptance of the old version", async () => {
    const quote = await operations.createQuote(editorCookie, asOpaqueId(flowLead), {
      destination: "Évora",
    });
    const quoteId = quoteIdOf(quote);
    await operations.addLine(editorCookie, quoteId, {
      section: "BASE",
      line: { category: "OTHER", service: "Visita guiada", pvpMinor: 5000n },
    });
    const v1 = await operations.sendQuote(editorCookie, quoteId, {
      expectedLockVersion: quote.lockVersion,
      expiresAt: null,
    });
    const revised = await operations.reviseQuote(
      editorCookie,
      quoteId,
      BigInt(await lockOf(quoteId)),
    );
    expect(revised.quote.state).toBe("DRAFT");
    const v2 = await operations.sendQuote(editorCookie, quoteId, {
      expectedLockVersion: revised.quote.lockVersion,
      expiresAt: null,
    });
    expect(v2.versionNumber).toBe(2);
    expect((await publicOperations.readPublicQuote(v1.token, "2027-01-01")).isLatest).toBe(false);
    expect(await publicOperations.acceptPublicQuote(v1.token, "Marta Quintela")).toBe("SUPERSEDED");
    expect(await publicOperations.acceptPublicQuote(v2.token, "Marta Quintela")).toBe("ACCEPTED");
  });

  it("refuses an expired link, a revoked link and an unknown token with the same not-found answer", async () => {
    const quote = await operations.createQuote(editorCookie, asOpaqueId(flowLead), {
      destination: "Braga",
    });
    const quoteId = quoteIdOf(quote);
    await operations.addLine(editorCookie, quoteId, {
      section: "BASE",
      line: { category: "OTHER", service: "Jantar", pvpMinor: 4000n },
    });
    const short = await operations.sendQuote(editorCookie, quoteId, {
      expectedLockVersion: quote.lockVersion,
      expiresAt: new Date(Date.now() + 1_500).toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(await publicOperations.acceptPublicQuote(short.token, "Marta Quintela")).toBe(
      "UNAVAILABLE",
    );

    const second = await operations.createQuote(editorCookie, asOpaqueId(flowLead), {
      destination: "Coimbra",
    });
    const secondId = quoteIdOf(second);
    await operations.addLine(editorCookie, secondId, {
      section: "BASE",
      line: { category: "OTHER", service: "Visita", pvpMinor: 4000n },
    });
    const revocable = await operations.sendQuote(editorCookie, secondId, {
      expectedLockVersion: second.lockVersion,
      expiresAt: null,
    });
    const linkRows = await queryAsOwner<{ shareLinkId: string }>(
      `SELECT "shareLinkId"::text AS "shareLinkId" FROM "sales"."quote_share_link" WHERE "quoteId" = '${secondId}'::uuid`,
    );
    await operations.revokeShareLink(editorCookie, asOpaqueId(linkRows[0]!.shareLinkId));
    await expect(
      publicOperations.readPublicQuote(revocable.token, "2027-01-01"),
    ).rejects.toBeInstanceOf(QuoteNotFoundError);
    await expect(
      publicOperations.readPublicQuote("B".repeat(43), "2027-01-01"),
    ).rejects.toBeInstanceOf(QuoteNotFoundError);
  });
});
