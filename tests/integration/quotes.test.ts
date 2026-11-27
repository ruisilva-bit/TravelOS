import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  agencyId,
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
  const id = randomUUID();
  await queryAsOwner(
    `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
     VALUES ('${id}'::uuid, ${agency}::uuid, ${sqlLiteral(displayName)})`,
  );
  return id;
};

const seedLead = async (customerId: string | null): Promise<string> => {
  const id = randomUUID();
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
  const id = randomUUID();
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
