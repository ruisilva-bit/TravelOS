import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asOpaqueId,
  CrmIdempotencyConflictError,
  CrmNotFoundError,
  InputValidationError,
  OptimisticConflictError,
  StaffAuthorizationError,
  OWNER_ROLE_PERMISSION_IDS,
  type CrmCustomerDetail,
  type StaffCrmOperations,
  type TripSlice,
} from "../../packages/backend-core/src/index.js";
import {
  createPostgresStaffCrmOperations,
  createUuidV7 as randomUUID,
} from "../../packages/database/src/index.js";
import {
  clientFor,
  createOwnerClient,
  createStaff,
  queryErrorCode,
  registrySessionResolver,
  requireHarness,
  type StaffFixture,
} from "./helpers/postgres.js";
import {
  agencyId,
  baseInput,
  persistence,
  ownerRoleId,
  createTripSlice,
  insertTripWithPrimary,
  queryAsOwner,
  queryErrorConstraint,
  readTripSlice,
  repository,
  setupTripFixtures,
  teardownTripFixtures,
  withOwnerTransaction,
} from "./helpers/trip-fixtures.js";

let slice: TripSlice;

beforeAll(async () => {
  await setupTripFixtures("travelos_crm");
  slice = await createTripSlice(repository, baseInput());
});

afterAll(async () => {
  await teardownTripFixtures();
});

describe.sequential("CRM continuity and primary-traveller invariants", () => {
  it("enforces exactly one primary traveller at commit and during replacement", async () => {
    const emptyTripId = randomUUID();
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
           VALUES ('${emptyTripId}'::uuid, '${agencyId}'::uuid, 'Invalid empty trip', '2026-09-25', '2026-09-28', 'DRAFT')`,
        ),
      ),
    ).toBe("trip_primary_traveller_exactly_one");

    const replacementTripId = randomUUID();
    const originalPersonId = randomUUID();
    const originalTravellerId = randomUUID();
    await insertTripWithPrimary({
      tripId: replacementTripId,
      personId: originalPersonId,
      travellerId: originalTravellerId,
      title: "Primary replacement",
    });
    const competingPersonId = randomUUID();
    const competingTravellerId = randomUUID();
    await queryAsOwner(
      `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
       VALUES ('${competingPersonId}'::uuid, '${agencyId}'::uuid, 'Competing', 'Traveller')`,
    );
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
           VALUES ('${competingTravellerId}'::uuid, '${agencyId}'::uuid, '${replacementTripId}'::uuid, '${competingPersonId}'::uuid, 'PRIMARY_TRAVELLER')`,
        ),
      ),
    ).toBe("trip_primary_traveller_idx");

    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `DELETE FROM "trip_ops"."trip_traveller"
            WHERE "id" = '${originalTravellerId}'::uuid`,
        ),
      ),
    ).toBe("trip_primary_traveller_exactly_one");

    const reparentTargetTripId = randomUUID();
    await insertTripWithPrimary({
      tripId: reparentTargetTripId,
      personId: randomUUID(),
      travellerId: randomUUID(),
      title: "Reparent target",
    });
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."trip_traveller"
              SET "tripId" = '${reparentTargetTripId}'::uuid
            WHERE "id" = '${originalTravellerId}'::uuid`,
        ),
      ),
    ).toBe("trip_primary_traveller_idx");

    const replacementPersonId = randomUUID();
    const replacementTravellerId = randomUUID();
    const replacementCustomerId = randomUUID();
    await withOwnerTransaction(async (client) => {
      await client.query(
        `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
         VALUES ('${replacementPersonId}'::uuid, '${agencyId}'::uuid, 'Replacement', 'Traveller')`,
      );
      await client.query(
        `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
         VALUES ('${replacementCustomerId}'::uuid, '${agencyId}'::uuid, 'Replacement Customer')`,
      );
      await client.query(
        `INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
         VALUES ('${agencyId}'::uuid, '${replacementCustomerId}'::uuid, '${replacementPersonId}'::uuid, 'PRIMARY_CONTACT', true)`,
      );
      await client.query(
        `DELETE FROM "trip_ops"."trip_traveller"
          WHERE "id" = '${originalTravellerId}'::uuid`,
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
         VALUES ('${replacementTravellerId}'::uuid, '${agencyId}'::uuid, '${replacementTripId}'::uuid, '${replacementPersonId}'::uuid, 'PRIMARY_TRAVELLER')`,
      );
    });
    const replacementRows = await queryAsOwner<{ readonly id: string; readonly role: string }>(
      `SELECT "id"::text AS "id", "role"
         FROM "trip_ops"."trip_traveller"
        WHERE "agencyId" = '${agencyId}'::uuid AND "tripId" = '${replacementTripId}'::uuid
          AND "role" = 'PRIMARY_TRAVELLER'`,
    );
    expect(replacementRows).toEqual([{ id: replacementTravellerId, role: "PRIMARY_TRAVELLER" }]);
  });

  it("enforces primary traveller CustomerPerson continuity and permits child-before-parent repair", async () => {
    const invalidTripId = randomUUID();
    const invalidPersonId = randomUUID();
    const invalidTravellerId = randomUUID();
    expect(
      await queryErrorConstraint(() =>
        withOwnerTransaction(async (client) => {
          await client.query(
            `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
             VALUES ('${invalidPersonId}'::uuid, '${agencyId}'::uuid, 'Continuity', 'Invalid')`,
          );
          await client.query(
            `INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
             VALUES ('${invalidTripId}'::uuid, '${agencyId}'::uuid, 'Invalid continuity', '2026-09-25', '2026-09-28', 'DRAFT')`,
          );
          await client.query(
            `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
             VALUES ('${invalidTravellerId}'::uuid, '${agencyId}'::uuid, '${invalidTripId}'::uuid, '${invalidPersonId}'::uuid, 'PRIMARY_TRAVELLER')`,
          );
        }),
      ),
    ).toBe("trip_primary_traveller_customer_continuity");

    const childFirstTripId = randomUUID();
    const childFirstPersonId = randomUUID();
    const childFirstTravellerId = randomUUID();
    const childFirstCustomerId = randomUUID();
    await withOwnerTransaction(async (client) => {
      await client.query(
        `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
         VALUES ('${childFirstPersonId}'::uuid, '${agencyId}'::uuid, 'Child', 'First')`,
      );
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      await client.query(
        `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
         VALUES ('${childFirstTravellerId}'::uuid, '${agencyId}'::uuid, '${childFirstTripId}'::uuid, '${childFirstPersonId}'::uuid, 'PRIMARY_TRAVELLER')`,
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
         VALUES ('${childFirstTripId}'::uuid, '${agencyId}'::uuid, 'Child-first trip', '2026-09-25', '2026-09-28', 'DRAFT')`,
      );
      await client.query(
        `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
         VALUES ('${childFirstCustomerId}'::uuid, '${agencyId}'::uuid, 'Child-first customer')`,
      );
      await client.query(
        `INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
         VALUES ('${agencyId}'::uuid, '${childFirstCustomerId}'::uuid, '${childFirstPersonId}'::uuid, 'PRIMARY_CONTACT', true)`,
      );
    });
    const childFirstRevision = await queryAsOwner<{ readonly revision: string }>(
      `SELECT "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" = '${childFirstTripId}'::uuid`,
    );
    expect(childFirstRevision).toEqual([{ revision: "1" }]);

    const repairedTripId = randomUUID();
    const repairedPersonId = randomUUID();
    const repairedTravellerId = randomUUID();
    const repairedCustomerId = randomUUID();
    await withOwnerTransaction(async (client) => {
      await client.query(
        `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
         VALUES ('${repairedPersonId}'::uuid, '${agencyId}'::uuid, 'Continuity', 'Repaired')`,
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
         VALUES ('${repairedTripId}'::uuid, '${agencyId}'::uuid, 'Repaired continuity', '2026-09-25', '2026-09-28', 'DRAFT')`,
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
         VALUES ('${repairedTravellerId}'::uuid, '${agencyId}'::uuid, '${repairedTripId}'::uuid, '${repairedPersonId}'::uuid, 'PRIMARY_TRAVELLER')`,
      );
      await client.query(
        `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
         VALUES ('${repairedCustomerId}'::uuid, '${agencyId}'::uuid, 'Repaired continuity customer')`,
      );
      await client.query(
        `INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
         VALUES ('${agencyId}'::uuid, '${repairedCustomerId}'::uuid, '${repairedPersonId}'::uuid, 'PRIMARY_CONTACT', true)`,
      );
    });
    const continuityTrip = await queryAsOwner<{ readonly id: string }>(
      `SELECT "id"::text AS "id"
         FROM "trip_ops"."trip_traveller"
        WHERE "id" = '${repairedTravellerId}'::uuid
          AND "role" = 'PRIMARY_TRAVELLER'`,
    );
    expect(continuityTrip).toEqual([{ id: repairedTravellerId }]);

    const deletionTripId = randomUUID();
    const deletionPersonId = randomUUID();
    await insertTripWithPrimary({
      tripId: deletionTripId,
      personId: deletionPersonId,
      travellerId: randomUUID(),
      title: "Continuity deletion",
    });
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `DELETE FROM "crm"."customer_person"
            WHERE "agencyId" = '${agencyId}'::uuid
              AND "personId" = '${deletionPersonId}'::uuid
              AND "isPrimary" = true`,
        ),
      ),
    ).toBe("trip_primary_traveller_customer_continuity");
  });

  it("qualifies deferred primary reparenting for rejection and repaired commit", async () => {
    const rejectedSourceTripId = randomUUID();
    const rejectedSourcePersonId = randomUUID();
    const rejectedSourceTravellerId = randomUUID();
    const rejectedTargetTripId = randomUUID();
    const rejectedTargetTravellerId = randomUUID();
    await insertTripWithPrimary({
      tripId: rejectedSourceTripId,
      personId: rejectedSourcePersonId,
      travellerId: rejectedSourceTravellerId,
      title: "Reparent rejected source",
    });
    await insertTripWithPrimary({
      tripId: rejectedTargetTripId,
      personId: randomUUID(),
      travellerId: rejectedTargetTravellerId,
      title: "Reparent rejected target",
    });
    expect(
      await queryErrorConstraint(() =>
        withOwnerTransaction(async (client) => {
          await client.query(
            `DELETE FROM "trip_ops"."trip_traveller"
              WHERE "id" = '${rejectedTargetTravellerId}'::uuid`,
          );
          await client.query(
            `UPDATE "trip_ops"."trip_traveller"
                SET "tripId" = '${rejectedTargetTripId}'::uuid
              WHERE "id" = '${rejectedSourceTravellerId}'::uuid`,
          );
        }),
      ),
    ).toBe("trip_primary_traveller_exactly_one");

    const sourceTripId = randomUUID();
    const sourcePersonId = randomUUID();
    const sourceTravellerId = randomUUID();
    const targetTripId = randomUUID();
    const targetTravellerId = randomUUID();
    const replacementPersonId = randomUUID();
    const replacementCustomerId = randomUUID();
    await insertTripWithPrimary({
      tripId: sourceTripId,
      personId: sourcePersonId,
      travellerId: sourceTravellerId,
      title: "Reparent repaired source",
    });
    await insertTripWithPrimary({
      tripId: targetTripId,
      personId: randomUUID(),
      travellerId: targetTravellerId,
      title: "Reparent repaired target",
    });
    await queryAsOwner(
      `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
       VALUES ('${replacementPersonId}'::uuid, '${agencyId}'::uuid, 'Replacement', 'Primary')`,
    );
    await queryAsOwner(
      `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
       VALUES ('${replacementCustomerId}'::uuid, '${agencyId}'::uuid, 'Replacement Customer')`,
    );
    await queryAsOwner(
      `INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
       VALUES ('${agencyId}'::uuid, '${replacementCustomerId}'::uuid, '${replacementPersonId}'::uuid, 'PRIMARY_CONTACT', true)`,
    );
    await withOwnerTransaction(async (client) => {
      await client.query(
        `DELETE FROM "trip_ops"."trip_traveller"
          WHERE "id" = '${targetTravellerId}'::uuid`,
      );
      await client.query(
        `UPDATE "trip_ops"."trip_traveller"
            SET "tripId" = '${targetTripId}'::uuid, "role" = 'TRAVELLER'
          WHERE "id" = '${sourceTravellerId}'::uuid`,
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
         VALUES ('${randomUUID()}'::uuid, '${agencyId}'::uuid, '${sourceTripId}'::uuid, '${replacementPersonId}'::uuid, 'PRIMARY_TRAVELLER')`,
      );
      await client.query(
        `UPDATE "trip_ops"."trip_traveller"
            SET "role" = 'PRIMARY_TRAVELLER'
          WHERE "id" = '${sourceTravellerId}'::uuid`,
      );
    });
    const repairedRows = await queryAsOwner<{
      readonly tripId: string;
      readonly role: string;
      readonly personId: string;
    }>(
      `SELECT "tripId"::text AS "tripId", "role", "personId"::text AS "personId"
         FROM "trip_ops"."trip_traveller"
        WHERE "agencyId" = '${agencyId}'::uuid
          AND "tripId" IN ('${sourceTripId}'::uuid, '${targetTripId}'::uuid)
          AND "role" = 'PRIMARY_TRAVELLER'
        ORDER BY "tripId"`,
    );
    expect(repairedRows).toEqual(
      [
        { tripId: sourceTripId, role: "PRIMARY_TRAVELLER", personId: replacementPersonId },
        { tripId: targetTripId, role: "PRIMARY_TRAVELLER", personId: sourcePersonId },
      ].sort((left, right) => left.tripId.localeCompare(right.tripId)),
    );
  });

  it("keeps the designated primary continuity rows when valid secondary rows exist", async () => {
    const secondaryPersonId = randomUUID();
    const secondaryCustomerId = randomUUID();
    const secondaryTravellerId = randomUUID();
    await queryAsOwner(
      `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
       VALUES ('${secondaryPersonId}'::uuid, '${agencyId}'::uuid, 'Secondary', 'Traveller')`,
    );
    await queryAsOwner(
      `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
       VALUES ('${secondaryCustomerId}'::uuid, '${agencyId}'::uuid, 'Secondary Customer')`,
    );
    await queryAsOwner(
      `INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
       VALUES ('${agencyId}'::uuid, '${secondaryCustomerId}'::uuid, '${secondaryPersonId}'::uuid, 'PAYER', false)`,
    );
    await queryAsOwner(
      `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
       VALUES ('${secondaryTravellerId}'::uuid, '${agencyId}'::uuid, '${slice.trip.id}'::uuid, '${secondaryPersonId}'::uuid, 'TRAVELLER')`,
    );
    const projected = await readTripSlice(repository, agencyId, slice.trip.id);
    expect(projected).not.toBeNull();
    expect(projected?.person.id).toBe(slice.person.id);
    expect(projected?.customer.id).toBe(slice.customer.id);
    expect(projected?.customerPerson.isPrimary).toBe(true);
    expect(projected?.traveller.id).toBe(slice.traveller.id);
    expect(projected?.traveller.role).toBe("PRIMARY_TRAVELLER");
  });
});

// Synthetic address built at runtime, as in the trip fixtures, so no literal address is committed.
const AT = String.fromCharCode(64);
const crmDatabaseName = "travelos_crm";
const otherAgencyId = "019b0000-0000-7000-8000-00000000c001";
const crmSessions = new Map<string, unknown>();
const sessionResolver = registrySessionResolver(crmSessions);

let crmOwner: Awaited<ReturnType<typeof createOwnerClient>> | undefined;
let crmOperations: StaffCrmOperations | undefined;
let ownerStaff: StaffFixture | undefined;
let readerStaff: StaffFixture | undefined;
let noPermissionStaff: StaffFixture | undefined;
let otherAgencyCustomerId = "";
let otherAgencyPersonId = "";

const ops = (): StaffCrmOperations => crmOperations!;

const READER_PERMISSIONS = ["customer.view", "sales.view", "trip.view"] as const;
const EDITOR_PERMISSIONS = [...READER_PERMISSIONS, "customer.edit", "traveller.edit"] as const;

const expectError = async (
  work: Promise<unknown>,
  expected: new (...parameters: never[]) => Error,
): Promise<Error> => {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(expected);
  return error as Error;
};

const personDraft = (overrides: Record<string, unknown> = {}) => ({
  givenName: "Ana",
  familyName: "Costa",
  email: `ana.costa${AT}example.test`,
  phone: "+351 912 345 678",
  nationality: "PT",
  notes: null,
  ...overrides,
});

const createFamily = (overrides: Record<string, unknown> = {}, key: string | null = null) =>
  ops().createCustomer(ownerStaff!.cookie, {
    customer: {
      displayName: "Familia Costa",
      email: `familia${AT}example.test`,
      phone: "+351 210 000 111",
      notes: null,
      ...overrides,
    },
    primaryPerson: personDraft(),
    idempotencyKey: key,
  });

/** Returns the PostgreSQL constraint named by a rejected call, or null when it succeeded. */
const constraintOf = async (work: () => Promise<unknown>): Promise<string | null> => {
  const error = await work().then(
    () => null,
    (reason: unknown) => reason,
  );
  return (error as { constraint?: string } | null)?.constraint ?? null;
};

const primaryOf = (detail: CrmCustomerDetail) => detail.people.find((person) => person.isPrimary)!;

describe.sequential("CRM customers, people, search and privileges", () => {
  beforeAll(async () => {
    requireHarness();
    crmOwner = await createOwnerClient(crmDatabaseName);
    // A second root-less Agency exists only in this disposable database, to prove isolation.
    await crmOwner.query('DROP INDEX "organization"."agency_single_root_idx"');
    await crmOwner.query(
      `INSERT INTO organization.agency (id, "bootstrapReference", slug) VALUES ($1::uuid, 'crm-other', 'crm-other')`,
      [otherAgencyId],
    );
    otherAgencyCustomerId = randomUUID();
    otherAgencyPersonId = randomUUID();
    await crmOwner.query(
      `INSERT INTO crm.customer (id, "agencyId", "displayName") VALUES ($1::uuid, $2::uuid, 'Outra Agencia')`,
      [otherAgencyCustomerId, otherAgencyId],
    );
    await crmOwner.query(
      `INSERT INTO crm.person (id, "agencyId", "givenName", "familyName", "passportNumber")
       VALUES ($1::uuid, $2::uuid, 'Outra', 'Pessoa', 'OTHER-PASSPORT')`,
      [otherAgencyPersonId, otherAgencyId],
    );
    ownerStaff = await createStaff(crmOwner, crmSessions, "crm-owner", [], {
      agencyId,
      roleId: ownerRoleId,
    });
    readerStaff = await createStaff(crmOwner, crmSessions, "crm-reader", [...READER_PERMISSIONS], {
      agencyId,
    });
    noPermissionStaff = await createStaff(crmOwner, crmSessions, "crm-none", [], { agencyId });
    crmOperations = createPostgresStaffCrmOperations(persistence!, sessionResolver);
  });

  afterAll(async () => {
    await crmOwner?.end();
  });

  it("gives the bootstrapped Owner the customer and traveller permissions", async () => {
    const rows = await crmOwner!.query<{ permissionId: string }>(
      `SELECT permission."permissionId"
         FROM staff_access.role_permission AS permission
        WHERE permission."roleId" = $1::uuid`,
      [ownerRoleId],
    );
    const permissions = rows.rows.map((row) => row.permissionId);
    expect(permissions).toEqual(
      expect.arrayContaining([
        "customer.view",
        "customer.edit",
        "traveller.view_sensitive",
        "traveller.edit",
      ]),
    );
    expect([...permissions].toSorted()).toEqual([...OWNER_ROLE_PERMISSION_IDS].toSorted());
  });

  it("creates a customer with its primary contact and lists, gets and searches it", async () => {
    const created = await createFamily({ displayName: "Familia Lima" }, null);
    expect(created.displayName).toBe("Familia Lima");
    expect(created.people).toHaveLength(1);
    expect(primaryOf(created).roles).toEqual(["PRIMARY_CONTACT"]);
    expect(primaryOf(created).nationality).toBe("PT");

    const fetched = await ops().getCustomer(ownerStaff!.cookie, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.lockVersion).toBe(0n);

    const listed = await ops().listCustomers(readerStaff!.cookie, {
      limit: 50,
      cursor: null,
      query: null,
    });
    expect(listed.items.map((item) => item.id)).toContain(created.id);
    expect(listed.items.map((item) => item.id)).not.toContain(otherAgencyCustomerId);
  });

  it("searches customers case-insensitively by display name, customer email, phone and person email", async () => {
    const created = await createFamily({
      displayName: "Familia Searchable",
      phone: "+351 917 000 333",
    });
    const byName = await ops().search(readerStaff!.cookie, "FAMILIA SEARCHABLE");
    expect(byName.customers.map((customer) => customer.id)).toContain(created.id);
    const byEmail = await ops().search(readerStaff!.cookie, `Familia${AT}Example.TEST`);
    expect(byEmail.customers.map((customer) => customer.id)).toContain(created.id);
    const byPhone = await ops().search(readerStaff!.cookie, "917 000 333");
    expect(byPhone.customers.map((customer) => customer.id)).toContain(created.id);
    const byPersonEmail = await ops().search(readerStaff!.cookie, `ana.costa${AT}example`);
    expect(byPersonEmail.customers.length).toBeGreaterThan(0);
    expect(byPersonEmail.customers.length).toBeLessThanOrEqual(5);
    const none = await ops().search(readerStaff!.cookie, "zzz-no-such-crm-text");
    expect(none.customers).toEqual([]);
  });

  it("searches leads and trips the caller may see, and rejects out-of-bounds queries", async () => {
    const tripId = randomUUID();
    await insertTripWithPrimary({
      tripId,
      personId: randomUUID(),
      travellerId: randomUUID(),
      title: "Roteiro Algarve CRM",
    });
    const leadId = randomUUID();
    await crmOwner!.query(
      `INSERT INTO sales.lead (id, "agencyId", source, "contactGivenName", "contactFamilyName", state)
       VALUES ($1::uuid, $2::uuid, 'EMAIL', 'Algarve CRM', 'Contacto', 'OPEN')`,
      [leadId, agencyId],
    );
    const result = await ops().search(readerStaff!.cookie, "algarve crm");
    expect(result.trips.map((trip) => trip.id)).toContain(tripId);
    expect(result.leads.map((lead) => lead.id)).toContain(leadId);
    await expectError(ops().search(readerStaff!.cookie, "a"), InputValidationError);
    await expectError(ops().search(readerStaff!.cookie, "x".repeat(101)), InputValidationError);
  });

  it("updates a customer with the current lock version and rejects a stale one", async () => {
    const created = await createFamily({ displayName: "Familia Versionada" });
    const updated = await ops().updateCustomer(ownerStaff!.cookie, created.id, {
      expectedLockVersion: 0n,
      customer: { displayName: "Familia Versionada Lda", email: null, phone: null, notes: "VIP" },
    });
    expect(updated.displayName).toBe("Familia Versionada Lda");
    expect(updated.notes).toBe("VIP");
    expect(updated.lockVersion).toBe(1n);

    await expectError(
      ops().updateCustomer(ownerStaff!.cookie, created.id, {
        expectedLockVersion: 0n,
        customer: { displayName: "Stale", email: null, phone: null, notes: null },
      }),
      OptimisticConflictError,
    );
  });

  it("returns not found for another Agency's customer and person", async () => {
    await expectError(
      ops().getCustomer(ownerStaff!.cookie, asOpaqueId(otherAgencyCustomerId)),
      CrmNotFoundError,
    );
    await expectError(
      ops().updatePerson(ownerStaff!.cookie, asOpaqueId(otherAgencyPersonId), {
        expectedLockVersion: 0n,
        person: {
          givenName: "Hacked",
          familyName: "Person",
          email: null,
          phone: null,
          nationality: null,
          notes: null,
        },
      }),
      CrmNotFoundError,
    );
  });

  it("denies reads without customer.view and writes without customer.edit", async () => {
    await expectError(
      ops().listCustomers(noPermissionStaff!.cookie, { limit: 10, cursor: null, query: null }),
      StaffAuthorizationError,
    );
    await expectError(ops().search(noPermissionStaff!.cookie, "familia"), StaffAuthorizationError);
    await expectError(
      ops().createCustomer(readerStaff!.cookie, {
        customer: { displayName: "Nope", email: null, phone: null, notes: null },
        primaryPerson: personDraft(),
        idempotencyKey: null,
      }),
      StaffAuthorizationError,
    );
  });

  it("replays an identical idempotent create and rejects the key reused for a different request", async () => {
    const key = `crm-create-${randomUUID()}`;
    const first = await createFamily({ displayName: "Familia Idempotente" }, key);
    const replay = await createFamily({ displayName: "Familia Idempotente" }, key);
    expect(replay.id).toBe(first.id);
    await expectError(
      createFamily({ displayName: "Familia Diferente" }, key),
      CrmIdempotencyConflictError,
    );
  });

  it("keeps passport and birth-date fields redacted for readers and writable only with traveller.view_sensitive", async () => {
    const created = await createFamily({ displayName: "Familia Sensivel" });
    const person = primaryOf(created);
    const withPassport = await ops().updatePerson(ownerStaff!.cookie, person.id, {
      expectedLockVersion: 0n,
      person: {
        givenName: "Ana",
        familyName: "Costa",
        email: `ana.costa${AT}example.test`,
        phone: "+351 912 345 678",
        nationality: "PT",
        notes: null,
        birthDate: "1984-03-02",
        passportNumber: "PT-SECRET-42",
        passportExpiry: "2031-07-01",
      },
    });
    expect(withPassport.passportNumber).toBe("PT-SECRET-42");
    expect(withPassport.birthDate).toBe("1984-03-02");

    // Without traveller.view_sensitive the same person is returned with the sensitive fields blank.
    const reader = await ops().getCustomer(readerStaff!.cookie, created.id);
    expect(primaryOf(reader)).toMatchObject({
      passportNumber: null,
      passportExpiry: null,
      birthDate: null,
      givenName: "Ana",
    });

    // An editor without view_sensitive cannot write passport fields, and an omitted field is kept.
    const editorOnly = await createStaff(
      crmOwner!,
      crmSessions,
      "crm-editor",
      [...EDITOR_PERMISSIONS],
      { agencyId },
    );
    await expectError(
      ops().updatePerson(editorOnly.cookie, person.id, {
        expectedLockVersion: 1n,
        person: {
          givenName: "Ana",
          familyName: "Costa",
          email: null,
          phone: null,
          nationality: null,
          notes: null,
          passportNumber: "NEW",
        },
      }),
      StaffAuthorizationError,
    );
    const kept = await ops().updatePerson(editorOnly.cookie, person.id, {
      expectedLockVersion: 1n,
      person: {
        givenName: "Ana",
        familyName: "Costa-Silva",
        email: null,
        phone: null,
        nationality: null,
        notes: null,
      },
    });
    expect(kept.familyName).toBe("Costa-Silva");
    // The editor's response is redacted, so the omitted passport field is verified through the owner.
    expect(kept.passportNumber).toBeNull();
    expect(kept.lockVersion).toBe(2n);
    expect(primaryOf(await ops().getCustomer(ownerStaff!.cookie, created.id))).toMatchObject({
      passportNumber: "PT-SECRET-42",
      passportExpiry: "2031-07-01",
      birthDate: "1984-03-02",
    });
  });

  it("denies person edits without traveller.edit and fails closed on a stale person version", async () => {
    const created = await createFamily({ displayName: "Familia Pessoa" });
    const person = primaryOf(created);
    await expectError(
      ops().updatePerson(readerStaff!.cookie, person.id, {
        expectedLockVersion: 0n,
        person: {
          givenName: "Ana",
          familyName: "Costa",
          email: null,
          phone: null,
          nationality: null,
          notes: null,
        },
      }),
      StaffAuthorizationError,
    );
    await expectError(
      ops().updatePerson(ownerStaff!.cookie, person.id, {
        expectedLockVersion: 7n,
        person: {
          givenName: "Ana",
          familyName: "Costa",
          email: null,
          phone: null,
          nationality: null,
          notes: null,
        },
      }),
      OptimisticConflictError,
    );
  });

  it("hides passport columns from the worker role at the database boundary", async () => {
    const worker = await clientFor("travelos_worker", crmDatabaseName);
    try {
      const code = await queryErrorCode(() =>
        worker.query('SELECT "passportNumber" FROM "crm"."person" LIMIT 1'),
      );
      expect(code).toBe("42501");
    } finally {
      await worker.end();
    }
  });

  it("adds people, switches the primary contact and keeps trip continuity intact", async () => {
    const created = await createFamily({ displayName: "Familia Continuidade" });
    const originalPrimary = primaryOf(created);
    const added = await ops().addPerson(ownerStaff!.cookie, created.id, {
      person: personDraft({
        givenName: "Bruno",
        familyName: "Costa",
        email: null,
        phone: null,
        nationality: null,
      }),
      roles: ["TRAVELLER"],
    });
    expect(added.people).toHaveLength(2);
    const bruno = added.people.find((person) => person.givenName === "Bruno")!;
    expect(bruno.roles).toEqual(["TRAVELLER"]);
    expect(bruno.isPrimary).toBe(false);

    // Promoting Bruno demotes the original primary contact in one transaction.
    const switched = await ops().setPersonRoles(ownerStaff!.cookie, created.id, bruno.id, {
      roles: ["PRIMARY_CONTACT", "TRAVELLER"],
      isPrimary: true,
    });
    expect(primaryOf(switched).id).toBe(bruno.id);
    expect(switched.people.filter((person) => person.isPrimary)).toHaveLength(1);
    expect(switched.people.find((person) => person.id === originalPrimary.id)!.isPrimary).toBe(
      false,
    );

    // Demoting the primary without promoting someone else is rejected.
    await expectError(
      ops().setPersonRoles(ownerStaff!.cookie, created.id, bruno.id, {
        roles: ["TRAVELLER"],
        isPrimary: false,
      }),
      InputValidationError,
    );

    // A trip whose PRIMARY_TRAVELLER is the original contact keeps continuity only while that
    // person stays the Customer's primary, so demoting them is rejected at commit.
    const tripId = randomUUID();
    await withOwnerTransaction(async (client) => {
      await client.query(
        `INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
         VALUES ($1::uuid, $2::uuid, 'Continuidade CRM', '2026-10-01', '2026-10-03', 'DRAFT')`,
        [tripId, agencyId],
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'PRIMARY_TRAVELLER')`,
        [randomUUID(), agencyId, tripId, bruno.id],
      );
    });
    const violation = await constraintOf(() =>
      ops().setPersonRoles(ownerStaff!.cookie, created.id, originalPrimary.id, {
        roles: ["PRIMARY_CONTACT"],
        isPrimary: true,
      }),
    );
    expect(violation).toBe("trip_primary_traveller_customer_continuity");
    // The rejected change rolled back: Bruno is still the primary contact.
    expect(primaryOf(await ops().getCustomer(ownerStaff!.cookie, created.id)).id).toBe(bruno.id);
  });

  it("rejects an unknown or repeated role", async () => {
    const created = await createFamily({ displayName: "Familia Papeis" });
    await expectError(
      ops().setPersonRoles(ownerStaff!.cookie, created.id, primaryOf(created).id, {
        roles: ["OWNER" as never],
        isPrimary: true,
      }),
      InputValidationError,
    );
    await expectError(
      ops().setPersonRoles(ownerStaff!.cookie, created.id, primaryOf(created).id, {
        roles: ["PRIMARY_CONTACT", "PRIMARY_CONTACT"],
        isPrimary: true,
      }),
      InputValidationError,
    );
  });
});
