import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type TripSlice } from "../../packages/backend-core/src/index.js";
import { createUuidV7 as randomUUID } from "../../packages/database/src/index.js";
import {
  agencyId,
  baseInput,
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
