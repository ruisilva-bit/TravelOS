import { createHash } from "node:crypto";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { STAFF_AUTH_BASE_PATH, type AuthRealm } from "../../packages/auth-adapters/src/index.js";
import {
  asOpaqueId,
  createMoney,
  createScheduledLocalDateTime,
  createStaffTripOperations,
  createStaffTripWorkspaceOperations,
  TripNotFoundError,
  type CreateTripSliceInput,
  type StaffTripWorkspaceWriteOperations,
  StaffAuthorizationError,
  OptimisticConflictError,
  TRAVELOS_CANONICAL_TIMEZONE_NAMES,
  type StaffAuthorizationOperationProof,
  type TripSlice,
} from "../../packages/backend-core/src/index.js";
import {
  createTripSlice as createTripSliceWithAuthorization,
  readTripSlice as readTripSliceWithAuthorization,
} from "../../packages/backend-core/src/modules/trip-operations/application/trip-slice.js";
import {
  createUuidV7 as randomUUID,
  mapPostgresMutationError,
  type PostgresPersistence,
} from "../../packages/database/src/index.js";
import * as databaseModule from "../../packages/database/src/index.js";
import { createStaffAccessRepository } from "../../packages/database/src/index.js";
import { createPostgresPersistence } from "../../packages/database/src/postgres/postgres-persistence.js";
import { createPostgresStaffTripWorkspaceRepository } from "../../packages/database/src/trip-operations/staff-trip-workspace-repository.js";
import { createOperationalSliceRepository } from "../../packages/database/src/trip-operations/operational-slice-repository.js";
import { createAdminApi } from "../../apps/admin-api/src/app.js";
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
  baseInput,
  clientFor,
  CREATE_PERMISSION_IDS,
  createTripSlice,
  insertTripWithPrimary,
  localPartsForInstant,
  ownerRoleId,
  persistence,
  primaryAccommodation,
  primaryFlight,
  primaryReservation,
  primaryStaffFixture,
  primarySupplierCost,
  queryAs,
  queryAsOwner,
  queryErrorCode,
  queryErrorConstraint,
  READ_PERMISSION_IDS,
  readTripSlice,
  repository,
  setupTripFixtures,
  sqlLiteral,
  staffAccessRepository,
  staffSessions,
  teardownTripFixtures,
  updateAccommodation,
  updateInternalSupplierNote,
  withOwnerTransaction,
  authorizationFor,
} from "./helpers/trip-fixtures.js";

let slice: TripSlice;

beforeAll(async () => {
  await setupTripFixtures("travelos_trips");
});

afterAll(async () => {
  await teardownTripFixtures();
});

describe.sequential("Trip workspace persistence", () => {
  it("uses PostgreSQL bigint lock versions on every mutable root", async () => {
    const columns = await queryAsOwner<{
      readonly schemaName: string;
      readonly tableName: string;
      readonly dataType: string;
    }>(
      `SELECT roots.schema_name AS "schemaName", roots.table_name AS "tableName",
              pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS "dataType"
         FROM (VALUES
           ('crm', 'person'),
           ('crm', 'customer'),
           ('trip_ops', 'trip'),
           ('trip_ops', 'itinerary_item'),
           ('trip_ops', 'reservation'),
           ('finance', 'supplier_cost_line')
         ) AS roots(schema_name, table_name)
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.nspname = roots.schema_name
         JOIN pg_catalog.pg_class AS relation
           ON relation.relnamespace = namespace.oid
          AND relation.relname = roots.table_name
         JOIN pg_catalog.pg_attribute AS attribute
           ON attribute.attrelid = relation.oid
          AND attribute.attname = 'lockVersion'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
        ORDER BY roots.schema_name, roots.table_name`,
    );
    expect(columns).toEqual([
      { schemaName: "crm", tableName: "customer", dataType: "bigint" },
      { schemaName: "crm", tableName: "person", dataType: "bigint" },
      { schemaName: "finance", tableName: "supplier_cost_line", dataType: "bigint" },
      { schemaName: "trip_ops", tableName: "itinerary_item", dataType: "bigint" },
      { schemaName: "trip_ops", tableName: "reservation", dataType: "bigint" },
      { schemaName: "trip_ops", tableName: "trip", dataType: "bigint" },
    ]);
  });

  it("creates the complete scoped continuity, itinerary, reservation/link and internal Money slice", async () => {
    slice = await createTripSlice(repository, baseInput());
    expect(slice.person.agencyId).toBe(agencyId);
    expect(slice.customerPerson.personId).toBe(slice.person.id);
    expect(slice.traveller.tripId).toBe(slice.trip.id);
    expect(primaryFlight(slice).family).toBe("FLIGHT");
    expect(primaryAccommodation(slice).family).toBe("ACCOMMODATION");
    expect(slice.reservationItemLinks).toHaveLength(2);
    expect(slice.reservationItemLinks.every((link) => link.tripId === slice.trip.id)).toBe(true);
    expect(primarySupplierCost(slice).classification).toBe("INTERNAL_ONLY");
    expect(primarySupplierCost(slice).amount.minorUnits).toBe(12345n);
    expect(slice.trip.workspaceRevision).toBe(1n);
    expect([
      slice.person.lockVersion,
      slice.customer.lockVersion,
      slice.trip.lockVersion,
      primaryFlight(slice).lockVersion,
      primaryAccommodation(slice).lockVersion,
      primaryReservation(slice).lockVersion,
      primarySupplierCost(slice).lockVersion,
    ]).toEqual([0n, 0n, 0n, 0n, 0n, 0n, 0n]);
  });

  it("keeps authorization snapshots and Trip reads Agency-isolated with two disposable Agency fixtures", async () => {
    const secondAgencyId = randomUUID();
    const staffPrincipalId = randomUUID();
    const rootMembershipId = randomUUID();
    const secondMembershipId = randomUUID();
    const rootSessionId = `trips-root-session-${randomUUID()}`;
    const secondSessionId = `trips-second-session-${randomUUID()}`;
    const rootRoleId = randomUUID();
    const secondRoleId = randomUUID();
    const rootAssignmentId = randomUUID();
    const secondAssignmentId = randomUUID();
    const syntheticEmailAddress = `trips-multi-agency-${staffPrincipalId}@example.test`;
    let syntheticTopologyCreated = false;

    try {
      await withOwnerTransaction(async (client) => {
        // Only the disposable qualification DB relaxes the production single-root index.
        await client.query('DROP INDEX "organization"."agency_single_root_idx"');
        await client.query(
          `INSERT INTO "organization"."agency" ("id", "bootstrapReference", "slug")
           VALUES ($1::uuid, $2, $3)`,
          [secondAgencyId, `trips-multi-agency-${secondAgencyId}`, `trips-${secondAgencyId}`],
        );
        await client.query(
          `INSERT INTO "staff_access"."staff_user" ("id", "name", "email", "emailVerified", "twoFactorEnabled")
           VALUES ($1, $2, $3, true, true)`,
          [staffPrincipalId, "Trips Multi-Agency Fixture", syntheticEmailAddress],
        );
        await client.query(
          `INSERT INTO "staff_access"."staff_membership" ("id", "agencyId", "staffPrincipalId", "state")
           VALUES ($1::uuid, $2::uuid, $3, 'ACTIVE'), ($4::uuid, $5::uuid, $3, 'ACTIVE')`,
          [rootMembershipId, agencyId, staffPrincipalId, secondMembershipId, secondAgencyId],
        );
        await client.query(
          `INSERT INTO "staff_access"."staff_session" ("id", "expiresAt", "token", "updatedAt", "userId")
           VALUES ($1, now() + interval '1 hour', $2, now(), $4),
                  ($3, now() + interval '1 hour', $5, now(), $4)`,
          [
            rootSessionId,
            `token-${randomUUID()}`,
            secondSessionId,
            staffPrincipalId,
            `token-${randomUUID()}`,
          ],
        );
        await client.query(
          `INSERT INTO "staff_access"."role" ("id", "agencyId", "displayName")
           VALUES ($1::uuid, $2::uuid, 'Trips Root Qualification'),
                  ($3::uuid, $4::uuid, 'Trips Second Agency Qualification')`,
          [rootRoleId, agencyId, secondRoleId, secondAgencyId],
        );
        await client.query(
          `INSERT INTO "staff_access"."role_permission" ("roleId", "permissionId", "scopeKind", "accessLevel")
           SELECT $1::uuid, permission_id, 'AGENCY', 'ALL'
             FROM unnest($2::text[]) AS permission_id`,
          [rootRoleId, [...READ_PERMISSION_IDS, "trip.edit"]],
        );
        await client.query(
          `INSERT INTO "staff_access"."role_permission" ("roleId", "permissionId", "scopeKind", "accessLevel")
           SELECT $1::uuid, permission_id, 'AGENCY', 'ALL'
             FROM unnest($2::text[]) AS permission_id`,
          [secondRoleId, [...READ_PERMISSION_IDS, "finance.manage_costs"]],
        );
        await client.query(
          `INSERT INTO "staff_access"."role_assignment"
             ("id", "agencyId", "membershipId", "roleId", "scopeKind", "organizationUnitId", "active")
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'AGENCY', NULL, true),
                  ($5::uuid, $6::uuid, $7::uuid, $8::uuid, 'AGENCY', NULL, true)`,
          [
            rootAssignmentId,
            agencyId,
            rootMembershipId,
            rootRoleId,
            secondAssignmentId,
            secondAgencyId,
            secondMembershipId,
            secondRoleId,
          ],
        );
        await client.query(
          `INSERT INTO "staff_access"."staff_session_context"
             ("sessionId", "staffPrincipalId", "agencyId", "authorizationEpoch", "recentMfaVerifiedAt")
           SELECT session.id, membership."staffPrincipalId", membership."agencyId", membership."authorizationEpoch", NULL
             FROM (VALUES ($1::text, $2::uuid), ($3::text, $4::uuid)) AS sessions(id, "agencyId")
             JOIN "staff_access"."staff_session" AS session ON session."id" = sessions.id
             JOIN "staff_access"."staff_membership" AS membership
               ON membership."staffPrincipalId" = session."userId"
              AND membership."agencyId" = sessions."agencyId"`,
          [rootSessionId, agencyId, secondSessionId, secondAgencyId],
        );
      });
      syntheticTopologyCreated = true;

      const rootSnapshot = await staffAccessRepository.getStaffAuthorizationSnapshot(
        staffPrincipalId,
        agencyId,
      );
      const secondSnapshot = await staffAccessRepository.getStaffAuthorizationSnapshot(
        staffPrincipalId,
        secondAgencyId,
      );
      expect(rootSnapshot?.agencyId).toBe(agencyId);
      expect(
        rootSnapshot?.assignments.every((assignment) => assignment.agencyId === agencyId),
      ).toBe(true);
      expect(rootSnapshot?.assignments.map(({ permissionId }) => permissionId).toSorted()).toEqual(
        [...READ_PERMISSION_IDS, "trip.edit"].toSorted(),
      );
      expect(secondSnapshot?.agencyId).toBe(secondAgencyId);
      expect(
        secondSnapshot?.assignments.every((assignment) => assignment.agencyId === secondAgencyId),
      ).toBe(true);
      expect(
        secondSnapshot?.assignments.map(({ permissionId }) => permissionId).toSorted(),
      ).toEqual([...READ_PERMISSION_IDS, "finance.manage_costs"].toSorted());
      const nowEpochMs = Date.now();
      const rootAuthorization: StaffAuthorizationOperationProof = {
        session: {
          sessionId: rootSessionId,
          staffPrincipalId,
          agencyId,
          authorizationEpoch: rootSnapshot!.authorizationEpoch,
          expiresAtEpochMs: nowEpochMs + 60 * 60 * 1_000,
          recentMfaVerifiedAtEpochMs: null,
        },
        requiredPermissionIds: READ_PERMISSION_IDS,
        nowEpochMs,
      };
      const secondAuthorization: StaffAuthorizationOperationProof = {
        session: {
          sessionId: secondSessionId,
          staffPrincipalId,
          agencyId: secondAgencyId,
          authorizationEpoch: secondSnapshot!.authorizationEpoch,
          expiresAtEpochMs: nowEpochMs + 60 * 60 * 1_000,
          recentMfaVerifiedAtEpochMs: null,
        },
        requiredPermissionIds: READ_PERMISSION_IDS,
        nowEpochMs,
      };
      expect(
        await readTripSliceWithAuthorization(
          repository,
          asOpaqueId(secondAgencyId),
          slice.trip.id,
          secondAuthorization,
        ),
      ).toBeNull();
      expect(
        await readTripSliceWithAuthorization(
          repository,
          agencyId,
          slice.trip.id,
          rootAuthorization,
        ),
      ).not.toBeNull();
    } finally {
      if (syntheticTopologyCreated) {
        await withOwnerTransaction(async (client) => {
          await client.query(
            `DELETE FROM "staff_access"."role_assignment" WHERE "id" IN ($1::uuid, $2::uuid)`,
            [rootAssignmentId, secondAssignmentId],
          );
          await client.query(`DELETE FROM "staff_access"."staff_session" WHERE "id" IN ($1, $2)`, [
            rootSessionId,
            secondSessionId,
          ]);
          await client.query(
            `DELETE FROM "staff_access"."staff_membership" WHERE "id" IN ($1::uuid, $2::uuid)`,
            [rootMembershipId, secondMembershipId],
          );
          await client.query(
            `DELETE FROM "staff_access"."role" WHERE "id" IN ($1::uuid, $2::uuid)`,
            [rootRoleId, secondRoleId],
          );
          await client.query(`DELETE FROM "staff_access"."staff_user" WHERE "id" = $1`, [
            staffPrincipalId,
          ]);
          await client.query(`DELETE FROM "organization"."agency" WHERE "id" = $1::uuid`, [
            secondAgencyId,
          ]);
          await client.query(
            'CREATE UNIQUE INDEX "agency_single_root_idx" ON "organization"."agency" ((true))',
          );
        });
      }
    }

    const rootRows = await queryAsOwner<{ readonly count: string }>(
      `SELECT count(*)::text AS "count" FROM "organization"."agency" WHERE "isRoot"`,
    );
    expect(rootRows).toEqual([{ count: "1" }]);
    const singletonIndex = await queryAsOwner<{ readonly indexName: string | null }>(
      `SELECT pg_catalog.to_regclass('organization.agency_single_root_idx')::text AS "indexName"`,
    );
    expect(singletonIndex[0]?.indexName).toBe("organization.agency_single_root_idx");
  });

  it("rechecks current Staff authorization inside the mutation transaction", async () => {
    const session = staffSessions.get(agencyId);
    if (session === undefined) throw new Error("The primary Staff session fixture is unavailable");
    const before = await readTripSlice(repository, agencyId, slice.trip.id);
    if (before === null) throw new Error("The authorized Trip is unavailable before revocation");
    const currentAccommodation = primaryAccommodation(before);
    const revokingRepository: Parameters<typeof createStaffTripOperations>[0]["repository"] = {
      async createTripWorkspace() {
        throw new Error(
          "Unexpected minimal Trip workspace creation in the Trips authorization test",
        );
      },
      createTripSlice: repository.createTripSlice,
      getTripSlice: repository.getTripSlice,
      updateAccommodation: async (input, authorization) => {
        await withOwnerTransaction(async (client) => {
          const result = await client.query(
            `UPDATE "staff_access"."role_assignment"
              SET "active" = false, "revokedAt" = CURRENT_TIMESTAMP
            WHERE "id" = $1::uuid AND "active"`,
            [primaryStaffFixture.assignmentId],
          );
          if (result.rowCount !== 1) {
            throw new Error("The qualification Staff role assignment was not revoked");
          }
        });
        return repository.updateAccommodation(input, authorization);
      },
      updateInternalSupplierNote: repository.updateInternalSupplierNote,
      cancelTrip: repository.cancelTrip,
      createRuntimeAcceptanceFixtureTrip: repository.createRuntimeAcceptanceFixtureTrip,
    };
    const operations = createStaffTripOperations({
      repository: revokingRepository,
      authorizationRepository: staffAccessRepository,
      sessionResolver: {
        resolveStaffSession: async (cookieHeader) =>
          cookieHeader === "trips-authorization-session" ? session : null,
      },
    });

    let fixtureRestorationFailure: Error | undefined;
    try {
      await expect(
        operations.updateAccommodation("trips-authorization-session", {
          agencyId,
          tripId: before.trip.id,
          itemId: currentAccommodation.id,
          expectedLockVersion: currentAccommodation.lockVersion,
          title: "Must not persist after role revocation",
          description: "The transaction must recheck current permissions",
        }),
      ).rejects.toBeInstanceOf(StaffAuthorizationError);
    } finally {
      try {
        await withOwnerTransaction(async (client) => {
          await client.query(
            `UPDATE "staff_access"."role_assignment"
              SET "active" = true, "revokedAt" = NULL
            WHERE "id" = $1::uuid AND NOT "active"`,
            [primaryStaffFixture.assignmentId],
          );
        });
        const refreshedSnapshot = await staffAccessRepository.getStaffAuthorizationSnapshot(
          primaryStaffFixture.staffPrincipalId,
          agencyId,
        );
        if (refreshedSnapshot === null) {
          fixtureRestorationFailure = new Error(
            "The restored Staff authorization fixture was not readable",
          );
        } else {
          await withOwnerTransaction(async (client) => {
            await client.query(
              `UPDATE "staff_access"."staff_session_context"
                  SET "authorizationEpoch" = $1::bigint
                WHERE "sessionId" = $2`,
              [refreshedSnapshot.authorizationEpoch.toString(), session.sessionId],
            );
          });
          staffSessions.set(agencyId, {
            ...session,
            authorizationEpoch: refreshedSnapshot.authorizationEpoch,
            expiresAtEpochMs: Date.now() + 60 * 60 * 1_000,
          });
        }
      } catch (error) {
        fixtureRestorationFailure = new Error("Failed to restore the Staff authorization fixture", {
          cause: error,
        });
      }
    }
    if (fixtureRestorationFailure !== undefined) throw fixtureRestorationFailure;

    const after = await readTripSlice(repository, agencyId, slice.trip.id);
    if (after === null) throw new Error("The Trip disappeared after authorization revalidation");
    expect(after.trip.workspaceRevision).toBe(before.trip.workspaceRevision);
    expect(primaryAccommodation(after)).toEqual(currentAccommodation);
  });

  it("rejects fabricated Staff session metadata at the database boundary before creating rows", async () => {
    const input = baseInput();
    const tripTitle = `Rejected forged session ${randomUUID()}`;
    const forgedAuthorization = authorizationFor(agencyId, CREATE_PERMISSION_IDS);
    const unbackedAuthorization: StaffAuthorizationOperationProof = {
      ...forgedAuthorization,
      session: {
        ...forgedAuthorization.session,
        sessionId: `nonexistent-${randomUUID()}`,
        expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
        recentMfaVerifiedAtEpochMs: Date.now(),
      },
    };

    await expect(
      createTripSliceWithAuthorization(
        repository,
        { ...input, trip: { ...input.trip, title: tripTitle } },
        unbackedAuthorization,
      ),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);

    const rows = await queryAsOwner<{ readonly count: string }>(
      `SELECT count(*)::text AS "count" FROM "trip_ops"."trip" WHERE "title" = '${tripTitle}'`,
    );
    expect(rows).toEqual([{ count: "0" }]);
  });

  it("rejects caller-selected weak permissions at the repository boundary before mutation", async () => {
    const before = await readTripSlice(repository, agencyId, slice.trip.id);
    if (before === null)
      throw new Error("The authorized Trip is unavailable before weak-permission probe");
    const accommodation = primaryAccommodation(before);
    const weakAuthorization = authorizationFor(agencyId, ["trip.view"]);

    await expect(
      repository.updateAccommodation(
        {
          agencyId,
          tripId: before.trip.id,
          itemId: accommodation.id,
          expectedLockVersion: accommodation.lockVersion,
          title: "Must not persist under read-only permission",
          description: "Repository policy must require trip.edit",
        },
        weakAuthorization,
      ),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);

    const after = await readTripSlice(repository, agencyId, slice.trip.id);
    if (after === null) throw new Error("The Trip disappeared after weak-permission rejection");
    expect(after.trip.workspaceRevision).toBe(before.trip.workspaceRevision);
    expect(primaryAccommodation(after)).toEqual(accommodation);
  });

  it("increments once per committed relevant transaction and returns typed conflicts for stale and racing writes", async () => {
    const edited = await updateAccommodation(repository, {
      agencyId,
      tripId: slice.trip.id,
      itemId: primaryAccommodation(slice).id,
      expectedLockVersion: primaryAccommodation(slice).lockVersion,
      title: "Porto hotel updated",
      description: "Updated synthetic accommodation",
    });
    expect(edited.trip.workspaceRevision).toBe(slice.trip.workspaceRevision + 1n);
    expect(primaryAccommodation(edited).lockVersion).toBe(
      primaryAccommodation(slice).lockVersion + 1n,
    );
    await expect(
      updateAccommodation(repository, {
        agencyId,
        tripId: slice.trip.id,
        itemId: primaryAccommodation(slice).id,
        expectedLockVersion: primaryAccommodation(slice).lockVersion,
        title: "Stale write",
        description: "Must fail",
      }),
    ).rejects.toBeInstanceOf(OptimisticConflictError);
    const afterStale = await readTripSlice(repository, agencyId, slice.trip.id);
    if (afterStale === null) throw new Error("The Trip disappeared after a stale CAS rejection");
    expect(afterStale.trip.workspaceRevision).toBe(edited.trip.workspaceRevision);
    expect(primaryAccommodation(afterStale).lockVersion).toBe(
      primaryAccommodation(edited).lockVersion,
    );
    expect(primaryAccommodation(afterStale).title).toBe(primaryAccommodation(edited).title);

    const secondEdit = await updateAccommodation(repository, {
      agencyId,
      tripId: slice.trip.id,
      itemId: primaryAccommodation(edited).id,
      expectedLockVersion: primaryAccommodation(edited).lockVersion,
      title: "Porto hotel updated twice",
      description: "Second committed edit",
    });
    expect(secondEdit.trip.workspaceRevision).toBe(edited.trip.workspaceRevision + 1n);
    expect(primaryAccommodation(secondEdit).lockVersion).toBe(
      primaryAccommodation(edited).lockVersion + 1n,
    );

    const internal = await updateInternalSupplierNote(repository, {
      agencyId,
      tripId: slice.trip.id,
      reservationId: primaryReservation(slice).id,
      expectedLockVersion: primarySupplierCost(slice).lockVersion,
      internalNote: "Updated internal-only note",
    });
    expect(internal.trip.workspaceRevision).toBe(secondEdit.trip.workspaceRevision);
    expect(primarySupplierCost(internal).lockVersion).toBe(
      primarySupplierCost(slice).lockVersion + 1n,
    );
    expect(primarySupplierCost(internal).internalNote).toBe("Updated internal-only note");
    await expect(
      updateInternalSupplierNote(repository, {
        agencyId,
        tripId: slice.trip.id,
        reservationId: primaryReservation(slice).id,
        expectedLockVersion: primarySupplierCost(slice).lockVersion,
        internalNote: "Stale supplier-cost note",
      }),
    ).rejects.toBeInstanceOf(OptimisticConflictError);
    const afterStaleSupplierCost = await readTripSlice(repository, agencyId, slice.trip.id);
    if (afterStaleSupplierCost === null) {
      throw new Error("The Trip disappeared after a stale supplier-cost CAS rejection");
    }
    expect(afterStaleSupplierCost.trip.workspaceRevision).toBe(internal.trip.workspaceRevision);
    expect(primarySupplierCost(afterStaleSupplierCost).lockVersion).toBe(
      primarySupplierCost(internal).lockVersion,
    );
    expect(primarySupplierCost(afterStaleSupplierCost).internalNote).toBe(
      primarySupplierCost(internal).internalNote,
    );

    const concurrent = await Promise.allSettled([
      updateAccommodation(repository, {
        agencyId,
        tripId: slice.trip.id,
        itemId: primaryAccommodation(slice).id,
        expectedLockVersion: primaryAccommodation(secondEdit).lockVersion,
        title: "Concurrent accommodation A",
        description: "Concurrent description A",
      }),
      updateAccommodation(repository, {
        agencyId,
        tripId: slice.trip.id,
        itemId: primaryAccommodation(slice).id,
        expectedLockVersion: primaryAccommodation(secondEdit).lockVersion,
        title: "Concurrent accommodation B",
        description: "Concurrent description B",
      }),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = concurrent.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toBeInstanceOf(
      OptimisticConflictError,
    );
    const committed = concurrent.find((result) => result.status === "fulfilled");
    if (committed?.status !== "fulfilled") throw new Error("No concurrent CAS mutation committed");
    expect(committed.value.trip.workspaceRevision).toBe(secondEdit.trip.workspaceRevision + 1n);
  });

  it("round-trips and compare-and-swaps bigint lock versions beyond JavaScript safe integer", async () => {
    const input = baseInput();
    const seeded = await createTripSlice(repository, {
      ...input,
      trip: { ...input.trip, title: "Bigint lock version qualification" },
    });
    const highLockVersion = 9_007_199_254_740_993n;
    await withOwnerTransaction(async (client) => {
      await client.query(
        `UPDATE "trip_ops"."itinerary_item"
            SET "lockVersion" = $1::bigint
          WHERE "agencyId" = $2::uuid
            AND "tripId" = $3::uuid
            AND "id" = $4::uuid`,
        [highLockVersion.toString(), agencyId, seeded.trip.id, primaryAccommodation(seeded).id],
      );
      await client.query(
        `UPDATE "finance"."supplier_cost_line"
            SET "lockVersion" = $1::bigint
          WHERE "agencyId" = $2::uuid
            AND "tripId" = $3::uuid
            AND "reservationId" = $4::uuid`,
        [highLockVersion.toString(), agencyId, seeded.trip.id, primaryReservation(seeded).id],
      );
    });

    const loaded = await readTripSlice(repository, agencyId, seeded.trip.id);
    if (loaded === null) throw new Error("The high-version Trip fixture was not readable");
    expect(primaryAccommodation(loaded).lockVersion).toBe(highLockVersion);
    expect(primarySupplierCost(loaded).lockVersion).toBe(highLockVersion);

    const updatedAccommodation = await updateAccommodation(repository, {
      agencyId,
      tripId: seeded.trip.id,
      itemId: primaryAccommodation(loaded).id,
      expectedLockVersion: highLockVersion,
      title: "Bigint version updated",
      description: "Exact compare-and-swap beyond Number.MAX_SAFE_INTEGER",
    });
    expect(primaryAccommodation(updatedAccommodation).lockVersion).toBe(highLockVersion + 1n);

    const updatedInternal = await updateInternalSupplierNote(repository, {
      agencyId,
      tripId: seeded.trip.id,
      reservationId: primaryReservation(loaded).id,
      expectedLockVersion: highLockVersion,
      internalNote: "Bigint version note update",
    });
    expect(primarySupplierCost(updatedInternal).lockVersion).toBe(highLockVersion + 1n);
    expect(updatedInternal.trip.workspaceRevision).toBe(
      updatedAccommodation.trip.workspaceRevision,
    );
  });

  it("rolls back both workspace revision and deduplication state with a failed transaction", async () => {
    const input = baseInput();
    const seeded = await createTripSlice(repository, {
      ...input,
      trip: { ...input.trip, title: "Workspace revision rollback qualification" },
    });
    await expect(
      withOwnerTransaction(async (client) => {
        await client.query(
          `UPDATE "trip_ops"."itinerary_item"
              SET "customerTitle" = 'Rolled-back title'
            WHERE "agencyId" = $1::uuid
              AND "tripId" = $2::uuid
              AND "id" = $3::uuid`,
          [agencyId, seeded.trip.id, primaryAccommodation(seeded).id],
        );
        throw new Error("Intentional transaction rollback");
      }),
    ).rejects.toThrow("Intentional transaction rollback");
    const rolledBack = await readTripSlice(repository, agencyId, seeded.trip.id);
    if (rolledBack === null) throw new Error("The rollback Trip fixture was not readable");
    expect(rolledBack.trip.workspaceRevision).toBe(seeded.trip.workspaceRevision);
    expect(primaryAccommodation(rolledBack).title).toBe(primaryAccommodation(seeded).title);

    const committed = await updateAccommodation(repository, {
      agencyId,
      tripId: seeded.trip.id,
      itemId: primaryAccommodation(seeded).id,
      expectedLockVersion: primaryAccommodation(seeded).lockVersion,
      title: "Committed after rollback",
      description: "The transaction marker was rolled back too",
    });
    expect(committed.trip.workspaceRevision).toBe(seeded.trip.workspaceRevision + 1n);
  });

  it("increments workspace revision for projected Person, Customer and CustomerPerson changes", async () => {
    const projectionInput = baseInput();
    const projectedSlice = await createTripSlice(repository, {
      ...projectionInput,
      trip: { ...projectionInput.trip, title: "CRM projection revision trip" },
    });
    const readRevision = async (): Promise<bigint> => {
      const rows = await queryAsOwner<{ readonly revision: string }>(
        `SELECT "workspaceRevision"::text AS "revision"
           FROM "trip_ops"."trip"
          WHERE "id" = '${projectedSlice.trip.id}'::uuid
            AND "agencyId" = '${agencyId}'::uuid`,
      );
      return BigInt(rows[0]!.revision);
    };
    let revision = await readRevision();
    await queryAsOwner(
      `UPDATE "crm"."person"
          SET "givenName" = 'Projected Updated'
        WHERE "id" = '${projectedSlice.person.id}'::uuid
          AND "agencyId" = '${agencyId}'::uuid`,
    );
    expect(await readRevision()).toBe(revision + 1n);
    revision += 1n;
    await queryAsOwner(
      `UPDATE "crm"."customer"
          SET "displayName" = 'Projected Customer Updated'
        WHERE "id" = '${projectedSlice.customer.id}'::uuid
          AND "agencyId" = '${agencyId}'::uuid`,
    );
    expect(await readRevision()).toBe(revision + 1n);
    revision += 1n;
    await queryAsOwner(
      `UPDATE "crm"."customer_person"
          SET "role" = 'PAYER'
        WHERE "agencyId" = '${agencyId}'::uuid
          AND "customerId" = '${projectedSlice.customer.id}'::uuid
          AND "personId" = '${projectedSlice.person.id}'::uuid
          AND "role" = 'PRIMARY_CONTACT'`,
    );
    expect(await readRevision()).toBe(revision + 1n);
  });

  it("rejects direct workspace revision and lockVersion writes through the actual Admin login role", async () => {
    const before = await queryAsOwner<{ readonly revision: string }>(
      `SELECT "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" = '${slice.trip.id}'::uuid
          AND "agencyId" = '${agencyId}'::uuid`,
    );
    const deniedStatements = [
      `UPDATE "trip_ops"."trip"
          SET "workspaceRevision" = 0
        WHERE "id" = '${slice.trip.id}'::uuid
          AND "agencyId" = '${agencyId}'::uuid`,
      `UPDATE "trip_ops"."itinerary_item"
          SET "lockVersion" = 99
        WHERE "id" = '${primaryAccommodation(slice).id}'::uuid
          AND "agencyId" = '${agencyId}'::uuid`,
      `UPDATE "finance"."supplier_cost_line"
          SET "lockVersion" = 99
        WHERE "reservationId" = '${primaryReservation(slice).id}'::uuid
          AND "agencyId" = '${agencyId}'::uuid`,
      `INSERT INTO "trip_ops"."trip"
        ("id", "agencyId", "title", "startDate", "endDate", "state", "workspaceRevision")
       VALUES ('${randomUUID()}'::uuid, '${agencyId}'::uuid, 'Forbidden revision insert', '2026-09-25', '2026-09-28', 'DRAFT', 99)`,
      `INSERT INTO "trip_ops"."trip"
        ("id", "agencyId", "title", "startDate", "endDate", "state", "lockVersion")
       VALUES ('${randomUUID()}'::uuid, '${agencyId}'::uuid, 'Forbidden version insert', '2026-09-25', '2026-09-28', 'DRAFT', 99)`,
      `SELECT "trip_ops"."touch_workspace_revision"('${agencyId}'::uuid, '${slice.trip.id}'::uuid)`,
      `UPDATE "trip_ops"."workspace_revision_touch"
          SET "lastTransactionId" = pg_catalog.pg_current_xact_id()
        WHERE "agencyId" = '${agencyId}'::uuid
          AND "tripId" = '${slice.trip.id}'::uuid`,
    ];
    for (const statement of deniedStatements) {
      expect(await queryErrorCode(() => queryAs("travelos_admin_api", statement))).toBe("42501");
    }

    const accommodationCall =
      `SELECT "trip_ops"."cas_update_accommodation_presentation"(` +
      `'${agencyId}'::uuid, '${slice.trip.id}'::uuid, '${primaryAccommodation(slice).id}'::uuid, ` +
      `0::bigint, 'forbidden worker edit', 'forbidden')`;
    const supplierCostCall =
      `SELECT "trip_ops"."cas_update_supplier_cost_internal_note"(` +
      `'${agencyId}'::uuid, '${slice.trip.id}'::uuid, '${primaryReservation(slice).id}'::uuid, ` +
      `0::bigint, 'forbidden worker edit')`;
    for (const role of ["travelos_worker"] as const) {
      for (const statement of [accommodationCall, supplierCostCall]) {
        expect(await queryErrorCode(() => queryAs(role, statement))).toBe("42501");
      }
    }

    const after = await queryAsOwner<{ readonly revision: string }>(
      `SELECT "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" = '${slice.trip.id}'::uuid
          AND "agencyId" = '${agencyId}'::uuid`,
    );
    expect(after[0]?.revision).toBe(before[0]?.revision);
  });

  it("ignores a forged transaction-local marker while deduplicating multiple relevant edits", async () => {
    const input = baseInput();
    const seeded = await createTripSlice(repository, {
      ...input,
      trip: { ...input.trip, title: "Revision marker spoof qualification" },
    });
    const accommodation = primaryAccommodation(seeded);
    const markerName = `travelos.revision_touch_${createHash("md5")
      .update(`${agencyId}:${seeded.trip.id}`)
      .digest("hex")}`;
    const client = await clientFor("travelos_admin_api");
    let expectedLockVersion = accommodation.lockVersion;
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_catalog.set_config($1::text, pg_catalog.txid_current()::text, true)",
        [markerName],
      );
      for (const [title, description] of [
        ["Marker spoof first edit", "First same-transaction change"],
        ["Marker spoof second edit", "Second same-transaction change"],
      ] as const) {
        const result = await client.query<{ readonly updated: boolean }>(
          `SELECT "trip_ops"."cas_update_accommodation_presentation"(
             $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::text, $6::text
           ) AS "updated"`,
          [
            agencyId,
            seeded.trip.id,
            accommodation.id,
            expectedLockVersion.toString(),
            title,
            description,
          ],
        );
        expect(result.rows[0]?.updated).toBe(true);
        expectedLockVersion += 1n;
      }

      const customerPersonResult = await client.query(
        `UPDATE "crm"."customer_person"
            SET "role" = "role"
          WHERE "agencyId" = $1::uuid
            AND "customerId" = $2::uuid
            AND "personId" = $3::uuid
            AND "role" = 'PRIMARY_CONTACT'`,
        [agencyId, seeded.customerPerson.customerId, seeded.customerPerson.personId],
      );
      expect(customerPersonResult.rowCount).toBe(1);

      const travellerResult = await client.query(
        `UPDATE "trip_ops"."trip_traveller"
            SET "role" = "role"
          WHERE "agencyId" = $1::uuid AND "tripId" = $2::uuid AND "id" = $3::uuid`,
        [agencyId, seeded.trip.id, seeded.traveller.id],
      );
      expect(travellerResult.rowCount).toBe(1);

      const reservationItemLink = seeded.reservationItemLinks[0];
      if (reservationItemLink === undefined) {
        throw new Error("The marker-spoof Trip fixture has no Reservation–Item link");
      }
      const reservationLinkResult = await client.query(
        `UPDATE "trip_ops"."reservation_item_link"
            SET "linkRole" = "linkRole"
          WHERE "agencyId" = $1::uuid
            AND "tripId" = $2::uuid
            AND "reservationId" = $3::uuid
            AND "itineraryItemId" = $4::uuid`,
        [
          agencyId,
          seeded.trip.id,
          reservationItemLink.reservationId,
          reservationItemLink.itineraryItemId,
        ],
      );
      expect(reservationLinkResult.rowCount).toBe(1);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }

    const projected = await readTripSlice(repository, agencyId, seeded.trip.id);
    if (projected === null) throw new Error("The marker-spoof Trip fixture was not readable");
    expect(projected.trip.workspaceRevision).toBe(seeded.trip.workspaceRevision + 1n);
    expect(primaryAccommodation(projected).lockVersion).toBe(accommodation.lockVersion + 2n);
    expect(primaryAccommodation(projected).title).toBe("Marker spoof second edit");
  });

  it("increments an Admin-created Trip despite a forged transaction-local revision marker", async () => {
    const input = baseInput();
    const seeded = await createTripSlice(repository, {
      ...input,
      trip: { ...input.trip, title: "Trip insert marker spoof qualification" },
    });
    const tripId = randomUUID();
    const travellerId = randomUUID();
    const markerName = `travelos.revision_touch_${createHash("md5")
      .update(`${agencyId}:${tripId}`)
      .digest("hex")}`;
    const client = await clientFor("travelos_admin_api");
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_catalog.set_config($1::text, pg_catalog.txid_current()::text, true)",
        [markerName],
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip"
          ("id", "agencyId", "title", "startDate", "endDate", "state")
         VALUES ($1::uuid, $2::uuid, $3::text, $4::date, $5::date, $6::text)`,
        [tripId, agencyId, "Forged marker Trip", "2026-09-25", "2026-09-28", "DRAFT"],
      );
      await client.query(
        `INSERT INTO "trip_ops"."trip_traveller"
          ("id", "agencyId", "tripId", "personId", "role")
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'PRIMARY_TRAVELLER')`,
        [travellerId, agencyId, tripId, seeded.person.id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }

    const rows = await queryAsOwner<{ readonly revision: string }>(
      `SELECT "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" = ${sqlLiteral(tripId)}::uuid
          AND "agencyId" = ${sqlLiteral(agencyId)}::uuid`,
    );
    expect(rows[0]?.revision).toBe("1");
  });

  it("serializes continuity writes under READ COMMITTED and REPEATABLE READ", async () => {
    for (const isolation of ["READ COMMITTED", "REPEATABLE READ"] as const) {
      const personId = randomUUID();
      const customerId = randomUUID();
      const tripId = randomUUID();
      const travellerId = randomUUID();
      await withOwnerTransaction(async (client) => {
        await client.query(
          `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
           VALUES ('${personId}'::uuid, '${agencyId}'::uuid, 'Concurrent', '${isolation.replaceAll(" ", "")}')`,
        );
        await client.query(
          `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
           VALUES ('${customerId}'::uuid, '${agencyId}'::uuid, 'Concurrent customer ${isolation}')`,
        );
        await client.query(
          `INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
           VALUES ('${agencyId}'::uuid, '${customerId}'::uuid, '${personId}'::uuid, 'PRIMARY_CONTACT', true)`,
        );
      });

      const firstClient = await clientFor("travelos_migrator");
      const secondClient = await clientFor("travelos_migrator");
      let secondInsertError: unknown = null;
      let secondCommitError: unknown = null;
      try {
        await Promise.all([
          firstClient.query('SET ROLE "travelos_owner"'),
          secondClient.query('SET ROLE "travelos_owner"'),
        ]);
        await Promise.all([firstClient.query("BEGIN"), secondClient.query("BEGIN")]);
        await Promise.all([
          firstClient.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`),
          secondClient.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`),
        ]);
        await Promise.all([
          firstClient.query(
            `SELECT count(*) FROM "trip_ops"."trip_traveller" WHERE "personId" = '${personId}'::uuid`,
          ),
          secondClient.query(
            `SELECT count(*) FROM "trip_ops"."trip_traveller" WHERE "personId" = '${personId}'::uuid`,
          ),
        ]);
        await firstClient.query(
          `DELETE FROM "crm"."customer_person"
            WHERE "agencyId" = '${agencyId}'::uuid
              AND "customerId" = '${customerId}'::uuid
              AND "personId" = '${personId}'::uuid`,
        );
        await secondClient.query(
          `INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
           VALUES ('${tripId}'::uuid, '${agencyId}'::uuid, 'Concurrent trip ${isolation}', '2026-09-25', '2026-09-28', 'DRAFT')`,
        );
        const secondPid = Number(
          (await secondClient.query<{ readonly pid: number }>("SELECT pg_backend_pid() AS pid"))
            .rows[0]?.pid,
        );
        const secondInsert = secondClient
          .query(
            `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
             VALUES ('${travellerId}'::uuid, '${agencyId}'::uuid, '${tripId}'::uuid, '${personId}'::uuid, 'PRIMARY_TRAVELLER')`,
          )
          .catch((error: unknown) => {
            secondInsertError = error;
          });
        let observedBlocking = false;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const blocking = await firstClient.query<{ readonly blocked: boolean }>(
            `SELECT cardinality(pg_blocking_pids(${secondPid})) > 0 AS "blocked"`,
          );
          if (blocking.rows[0]?.blocked === true) {
            observedBlocking = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(observedBlocking).toBe(true);
        await firstClient.query("COMMIT");
        await secondInsert;
        if (secondInsertError === null) {
          await secondClient.query("COMMIT").catch((error: unknown) => {
            secondCommitError = error;
          });
        }
        expect(
          (secondInsertError as { readonly code?: string } | null)?.code ??
            (secondCommitError as { readonly code?: string } | null)?.code,
        ).toMatch(/^(?:23514|40001)$/u);
        await secondClient.query("ROLLBACK").catch(() => undefined);
      } finally {
        await firstClient.query("ROLLBACK").catch(() => undefined);
        await secondClient.query("ROLLBACK").catch(() => undefined);
        await firstClient.end();
        await secondClient.end();
      }
      const invalidRows = await queryAsOwner<{ readonly count: string }>(
        `SELECT count(*)::text AS "count"
           FROM "trip_ops"."trip_traveller" AS traveller
          WHERE traveller."tripId" = '${tripId}'::uuid
            AND traveller."role" = 'PRIMARY_TRAVELLER'
            AND NOT EXISTS (
              SELECT 1 FROM "crm"."customer_person" AS relationship
               WHERE relationship."agencyId" = traveller."agencyId"
                 AND relationship."personId" = traveller."personId"
                 AND relationship."isPrimary" = true
            )`,
      );
      expect(invalidRows).toEqual([{ count: "0" }]);
    }
  });

  it("increments both workspace revisions when a child moves between trips", async () => {
    const secondTripId = randomUUID();
    const secondTripPersonId = randomUUID();
    const secondTripTravellerId = randomUUID();
    const movablePersonId = randomUUID();
    const movableTravellerId = randomUUID();
    await insertTripWithPrimary({
      tripId: secondTripId,
      personId: secondTripPersonId,
      travellerId: secondTripTravellerId,
      title: "Revision reassignment trip",
    });
    await queryAsOwner(
      `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
       VALUES ('${movablePersonId}'::uuid, '${agencyId}'::uuid, 'Movable', 'Traveller')`,
    );
    await queryAsOwner(
      `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
       VALUES ('${movableTravellerId}'::uuid, '${agencyId}'::uuid, '${slice.trip.id}'::uuid, '${movablePersonId}'::uuid, 'TRAVELLER')`,
    );
    const before = await queryAsOwner<{ readonly id: string; readonly revision: string }>(
      `SELECT "id"::text AS "id", "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" IN ('${slice.trip.id}'::uuid, '${secondTripId}'::uuid)
        ORDER BY "id"`,
    );
    await queryAsOwner(
      `UPDATE "trip_ops"."trip_traveller"
          SET "tripId" = '${secondTripId}'::uuid
        WHERE "id" = '${movableTravellerId}'::uuid`,
    );
    const after = await queryAsOwner<{ readonly id: string; readonly revision: string }>(
      `SELECT "id"::text AS "id", "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" IN ('${slice.trip.id}'::uuid, '${secondTripId}'::uuid)
        ORDER BY "id"`,
    );
    const beforeById = new Map(before.map((row) => [row.id, BigInt(row.revision)]));
    expect(after).toHaveLength(2);
    for (const row of after) expect(BigInt(row.revision)).toBe(beforeById.get(row.id)! + 1n);
  });

  it("maps a real repeatable-read SQLSTATE 40001 to an M1 optimistic conflict", async () => {
    const firstClient = await clientFor("travelos_migrator");
    const secondClient = await clientFor("travelos_migrator");
    let secondError: unknown = null;
    try {
      await Promise.all([
        firstClient.query('SET ROLE "travelos_owner"'),
        secondClient.query('SET ROLE "travelos_owner"'),
      ]);
      await Promise.all([firstClient.query("BEGIN"), secondClient.query("BEGIN")]);
      await Promise.all([
        firstClient.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"),
        secondClient.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"),
      ]);
      await Promise.all([
        firstClient.query(
          `SELECT "lockVersion" FROM "finance"."supplier_cost_line" WHERE "id" = '${primarySupplierCost(slice).id}'::uuid`,
        ),
        secondClient.query(
          `SELECT "lockVersion" FROM "finance"."supplier_cost_line" WHERE "id" = '${primarySupplierCost(slice).id}'::uuid`,
        ),
      ]);
      await firstClient.query(
        `UPDATE "finance"."supplier_cost_line"
            SET "internalNote" = 'Serialization winner', "lockVersion" = "lockVersion" + 1
          WHERE "id" = '${primarySupplierCost(slice).id}'::uuid`,
      );
      const blockedUpdate = secondClient.query(
        `UPDATE "finance"."supplier_cost_line"
            SET "internalNote" = 'Serialization loser', "lockVersion" = "lockVersion" + 1
          WHERE "id" = '${primarySupplierCost(slice).id}'::uuid`,
      );
      await firstClient.query("COMMIT");
      await blockedUpdate.catch((error: unknown) => {
        secondError = error;
      });
      expect((secondError as { readonly code?: string } | null)?.code).toBe("40001");
      expect(mapPostgresMutationError(secondError)).toBeInstanceOf(OptimisticConflictError);
      await secondClient.query("ROLLBACK");
    } finally {
      await firstClient.query("ROLLBACK").catch(() => undefined);
      await secondClient.query("ROLLBACK").catch(() => undefined);
      await firstClient.end();
      await secondClient.end();
    }
  });

  it("maps a real repository PostgreSQL deadlock SQLSTATE 40P01 through the registered Admin HTTP route", async () => {
    const current = await readTripSlice(repository, agencyId, slice.trip.id);
    if (current === null) throw new Error("The deadlock Trip fixture is unavailable");
    const cost = primarySupplierCost(current);
    const reservation = primaryReservation(current);
    const session = staffSessions.get(agencyId);
    if (session === undefined)
      throw new Error("The deadlock fixture requires an active Staff session");
    const activePersistence = persistence;
    if (activePersistence === null) throw new Error("The PostgreSQL persistence is unavailable");

    const blockerClient = await clientFor("travelos_migrator");
    const observerClient = await clientFor("travelos_migrator");
    const dummySessionIds = Array.from({ length: 64 }, () => `deadlock-${randomUUID()}`);
    let application: Awaited<ReturnType<typeof createAdminApi>> | null = null;
    let requestCompletion: Promise<void> | null = null;
    let requestError: unknown;
    let responseStatus: number | undefined;
    let responseBody: unknown;
    let responseCacheControl: string | undefined;
    let routeSqlState: string | undefined;
    let blockerSqlState: string | undefined;
    let observedRouteBlocking = false;

    try {
      await blockerClient.query('SET ROLE "travelos_owner"');
      await blockerClient.query("BEGIN");
      await blockerClient.query(
        `INSERT INTO "staff_access"."staff_session" ("id", "expiresAt", "token", "updatedAt", "userId")
         SELECT dummy."sessionId", now() + interval '1 hour', 'deadlock-token-' || dummy."sessionId", now(), $1
           FROM unnest($2::text[]) AS dummy("sessionId")`,
        [primaryStaffFixture.staffPrincipalId, dummySessionIds],
      );
      await blockerClient.query(
        `SELECT "id" FROM "staff_access"."staff_session" WHERE "id" = ANY($1::text[]) FOR UPDATE`,
        [dummySessionIds],
      );
      await blockerClient.query(
        `SELECT "id" FROM "staff_access"."staff_membership"
          WHERE "agencyId" = $1::uuid AND "staffPrincipalId" = $2 FOR UPDATE`,
        [agencyId, session.staffPrincipalId],
      );
      const blockerPid = Number(
        (await blockerClient.query<{ readonly pid: number }>("SELECT pg_backend_pid() AS pid"))
          .rows[0]?.pid,
      );

      const observedPersistence: PostgresPersistence<Record<string, never>> = {
        transaction: {
          runInTransaction: async (work) => {
            try {
              return await activePersistence.transaction.runInTransaction(work);
            } catch (error) {
              const code =
                typeof error === "object" && error !== null && "code" in error
                  ? (error as { readonly code?: unknown }).code
                  : undefined;
              if (code === "40P01") routeSqlState = code;
              throw error;
            }
          },
        },
        withConnection: activePersistence.withConnection.bind(activePersistence),
        withTransactionContext: activePersistence.withTransactionContext.bind(activePersistence),
        poolMetrics: activePersistence.poolMetrics.bind(activePersistence),
        destroy: activePersistence.destroy.bind(activePersistence),
      };
      const deadlockRepository = createOperationalSliceRepository(observedPersistence);
      const expectedHost = "admin-trips-deadlock.example.test";
      const deadlockRealm: AuthRealm = {
        kind: "STAFF",
        basePath: STAFF_AUTH_BASE_PATH,
        cookieName: "travelos-trips-deadlock-session",
        secureTransportRequired: false,
        async handle() {
          return new Response(null, { status: 404 });
        },
        async getServerSession() {
          return null;
        },
      };
      const operations = createStaffTripOperations({
        repository: deadlockRepository as unknown as Parameters<
          typeof createStaffTripOperations
        >[0]["repository"],
        authorizationRepository: staffAccessRepository,
        sessionResolver: {
          async resolveStaffSession() {
            return session;
          },
        },
      });
      application = await createAdminApi({
        expectedHost,
        auth: {
          realm: deadlockRealm,
          policy: { canonicalOrigin: `http://${expectedHost}`, expectedHost },
          staffAccessRepository,
          tripOperations: operations as unknown as NonNullable<
            NonNullable<Parameters<typeof createAdminApi>[0]["auth"]>["tripOperations"]
          >,
        },
      });

      requestCompletion = request(application.getHttpServer())
        .patch(`/api/admin/reservations/${reservation.id}/internal-note`)
        .set("Host", expectedHost)
        .set("Origin", `http://${expectedHost}`)
        .set("Cookie", "travelos-trips-deadlock-session=opaque")
        .send({
          agencyId,
          tripId: current.trip.id,
          reservationId: reservation.id,
          expectedLockVersion: cost.lockVersion.toString(),
          internalNote: "Real PostgreSQL deadlock qualification",
        })
        .then((response) => {
          responseStatus = response.status;
          responseBody = response.body;
          responseCacheControl = response.headers["cache-control"];
        })
        .catch((error: unknown) => {
          requestError = error;
        });

      for (let attempt = 0; attempt < 200; attempt += 1) {
        const blocked = await observerClient.query<{ readonly pid: number }>(
          `SELECT activity.pid::integer AS "pid"
             FROM pg_catalog.pg_stat_activity AS activity
            WHERE $1::integer = ANY(pg_catalog.pg_blocking_pids(activity.pid))`,
          [blockerPid],
        );
        if (blocked.rows.length > 0) {
          observedRouteBlocking = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(
        observedRouteBlocking,
        `Admin request did not wait on the blocker; status=${String(responseStatus)}, body=${JSON.stringify(responseBody)}, requestError=${String(requestError)}`,
      ).toBe(true);

      await blockerClient
        .query(`SELECT "id" FROM "staff_access"."staff_session" WHERE "id" = $1 FOR UPDATE`, [
          session.sessionId,
        ])
        .catch((error: unknown) => {
          const code =
            typeof error === "object" && error !== null && "code" in error
              ? (error as { readonly code?: unknown }).code
              : undefined;
          if (code === "40P01") blockerSqlState = code;
        });

      if (requestCompletion !== null) await requestCompletion;
      expect(blockerSqlState).not.toBe("40P01");
      expect(routeSqlState).toBe("40P01");
      expect(requestError).toBeUndefined();
      expect(responseStatus).toBe(409);
      expect(responseBody).toEqual({ error: "transaction_conflict" });
      expect(responseCacheControl).toBe("private, no-store");
      await blockerClient.query("ROLLBACK");

      const after = await readTripSlice(repository, agencyId, current.trip.id);
      if (after === null) throw new Error("The Trip disappeared after deadlock rollback");
      expect(after.trip.workspaceRevision).toBe(current.trip.workspaceRevision);
      expect(primarySupplierCost(after)).toEqual(cost);
    } finally {
      await blockerClient.query("ROLLBACK").catch(() => undefined);
      if (requestCompletion !== null) await requestCompletion.catch(() => undefined);
      await application?.close();
      await observerClient.end();
      await blockerClient.end();
    }
  });

  it("maps a real stale supplier-cost compare-and-swap through the registered Admin HTTP route", async () => {
    const input = baseInput();
    const seeded = await createTripSlice(repository, {
      ...input,
      trip: { ...input.trip, title: "Real stale supplier-cost HTTP qualification" },
    });
    const current = await updateInternalSupplierNote(repository, {
      agencyId,
      tripId: seeded.trip.id,
      reservationId: primaryReservation(seeded).id,
      expectedLockVersion: primarySupplierCost(seeded).lockVersion,
      internalNote: "Current supplier-cost note",
    });
    const session = staffSessions.get(agencyId);
    if (session === undefined) {
      throw new Error(
        "The stale supplier-cost HTTP qualification requires a Staff session fixture",
      );
    }
    const expectedHost = "admin-trips-stale-cost.example.test";
    const staleCostRealm: AuthRealm = {
      kind: "STAFF",
      basePath: STAFF_AUTH_BASE_PATH,
      cookieName: "travelos-trips-stale-cost-session",
      secureTransportRequired: false,
      async handle() {
        return new Response(null, { status: 404 });
      },
      async getServerSession() {
        return null;
      },
    };
    const operations = createStaffTripOperations({
      repository: repository as unknown as Parameters<
        typeof createStaffTripOperations
      >[0]["repository"],
      authorizationRepository: staffAccessRepository,
      sessionResolver: {
        async resolveStaffSession() {
          return session;
        },
      },
    });
    const application = await createAdminApi({
      expectedHost,
      auth: {
        realm: staleCostRealm,
        policy: { canonicalOrigin: `http://${expectedHost}`, expectedHost },
        staffAccessRepository,
        tripOperations: operations as unknown as NonNullable<
          NonNullable<Parameters<typeof createAdminApi>[0]["auth"]>["tripOperations"]
        >,
      },
    });
    try {
      const response = await request(application.getHttpServer())
        .patch(`/api/admin/reservations/${primaryReservation(current).id}/internal-note`)
        .set("Host", expectedHost)
        .set("Origin", `http://${expectedHost}`)
        .set("Cookie", "travelos-trips-stale-cost-session=opaque")
        .send({
          agencyId,
          tripId: current.trip.id,
          reservationId: primaryReservation(current).id,
          expectedLockVersion: primarySupplierCost(seeded).lockVersion.toString(),
          internalNote: "Stale supplier-cost note must not persist",
        })
        .expect(409);
      expect(response.body).toEqual({ error: "optimistic_conflict" });
      expect(response.headers["cache-control"]).toBe("private, no-store");
    } finally {
      await application.close();
    }
    const after = await readTripSlice(repository, agencyId, current.trip.id);
    if (after === null) throw new Error("The stale supplier-cost HTTP fixture disappeared");
    expect(primarySupplierCost(after).lockVersion).toBe(primarySupplierCost(current).lockVersion);
    expect(primarySupplierCost(after).internalNote).toBe("Current supplier-cost note");
    expect(after.trip.workspaceRevision).toBe(current.trip.workspaceRevision);
  });

  it("increments both workspace revisions when a dependency-free reservation moves between trips", async () => {
    const sourceTripId = randomUUID();
    const targetTripId = randomUUID();
    const reservationId = randomUUID();
    await insertTripWithPrimary({
      tripId: sourceTripId,
      personId: randomUUID(),
      travellerId: randomUUID(),
      title: "Reservation source",
    });
    await insertTripWithPrimary({
      tripId: targetTripId,
      personId: randomUUID(),
      travellerId: randomUUID(),
      title: "Reservation target",
    });
    await queryAsOwner(
      `INSERT INTO "trip_ops"."reservation"
        ("id", "agencyId", "tripId", "supplierName", "supplierReference", "customerBookingReference", "state")
       VALUES ('${reservationId}'::uuid, '${agencyId}'::uuid, '${sourceTripId}'::uuid, 'Move Supplier', 'MOVE-1', NULL, 'CONFIRMED')`,
    );
    const before = await queryAsOwner<{ readonly id: string; readonly revision: string }>(
      `SELECT "id"::text AS "id", "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" IN ('${sourceTripId}'::uuid, '${targetTripId}'::uuid)
        ORDER BY "id"`,
    );
    await queryAsOwner(
      `UPDATE "trip_ops"."reservation"
          SET "tripId" = '${targetTripId}'::uuid
        WHERE "id" = '${reservationId}'::uuid`,
    );
    const after = await queryAsOwner<{ readonly id: string; readonly revision: string }>(
      `SELECT "id"::text AS "id", "workspaceRevision"::text AS "revision"
         FROM "trip_ops"."trip"
        WHERE "id" IN ('${sourceTripId}'::uuid, '${targetTripId}'::uuid)
        ORDER BY "id"`,
    );
    const beforeById = new Map(before.map((row) => [row.id, BigInt(row.revision)]));
    expect(after).toHaveLength(2);
    for (const row of after) expect(BigInt(row.revision)).toBe(beforeById.get(row.id)! + 1n);
  });

  it("serializes concurrent opposite-direction child moves without a revision deadlock", async () => {
    const leftTripId = "00000000-0000-7000-8000-000000000010";
    const rightTripId = "00000000-0000-7000-8000-000000000011";
    const leftPrimaryPersonId = randomUUID();
    const rightPrimaryPersonId = randomUUID();
    const leftPrimaryTravellerId = randomUUID();
    const rightPrimaryTravellerId = randomUUID();
    const leftPersonId = randomUUID();
    const rightPersonId = randomUUID();
    const leftTravellerId = randomUUID();
    const rightTravellerId = randomUUID();
    await insertTripWithPrimary({
      tripId: leftTripId,
      personId: leftPrimaryPersonId,
      travellerId: leftPrimaryTravellerId,
      title: "Concurrent left",
    });
    await insertTripWithPrimary({
      tripId: rightTripId,
      personId: rightPrimaryPersonId,
      travellerId: rightPrimaryTravellerId,
      title: "Concurrent right",
    });
    await queryAsOwner(
      `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
       VALUES
         ('${leftPersonId}'::uuid, '${agencyId}'::uuid, 'Left', 'Traveller'),
         ('${rightPersonId}'::uuid, '${agencyId}'::uuid, 'Right', 'Traveller')`,
    );
    await queryAsOwner(
      `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
       VALUES
         ('${leftTravellerId}'::uuid, '${agencyId}'::uuid, '${leftTripId}'::uuid, '${leftPersonId}'::uuid, 'TRAVELLER'),
         ('${rightTravellerId}'::uuid, '${agencyId}'::uuid, '${rightTripId}'::uuid, '${rightPersonId}'::uuid, 'TRAVELLER')`,
    );
    const beforeRevisions = await queryAsOwner<{
      readonly id: string;
      readonly workspaceRevision: string;
      readonly lockVersion: string;
    }>(
      `SELECT "id"::text AS "id", "workspaceRevision"::text AS "workspaceRevision", "lockVersion"
         FROM "trip_ops"."trip"
        WHERE "id" IN ('${leftTripId}'::uuid, '${rightTripId}'::uuid)`,
    );

    const leftClient = await clientFor("travelos_migrator");
    const rightClient = await clientFor("travelos_migrator");
    try {
      await Promise.all([
        leftClient.query('SET ROLE "travelos_owner"'),
        rightClient.query('SET ROLE "travelos_owner"'),
      ]);
      await leftClient.query("BEGIN");
      await leftClient.query("SET LOCAL lock_timeout = '2s'");
      await leftClient.query(
        `UPDATE "trip_ops"."trip_traveller"
            SET "tripId" = '${rightTripId}'::uuid
          WHERE "id" = '${leftTravellerId}'::uuid`,
      );
      await rightClient.query("BEGIN");
      await rightClient.query("SET LOCAL lock_timeout = '2s'");
      const rightPid = Number(
        (await rightClient.query<{ readonly pid: number }>("SELECT pg_backend_pid() AS pid"))
          .rows[0]?.pid,
      );
      const rightMove = rightClient.query(
        `UPDATE "trip_ops"."trip_traveller"
            SET "tripId" = '${leftTripId}'::uuid
          WHERE "id" = '${rightTravellerId}'::uuid`,
      );
      let observedBlocking = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const blocking = await leftClient.query<{ readonly blocked: boolean }>(
          `SELECT cardinality(pg_blocking_pids(${rightPid})) > 0 AS "blocked"`,
        );
        if (blocking.rows[0]?.blocked === true) {
          observedBlocking = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(observedBlocking).toBe(true);
      await leftClient.query("COMMIT");
      await rightMove;
      await rightClient.query("COMMIT");
    } finally {
      await leftClient.query("ROLLBACK").catch(() => undefined);
      await rightClient.query("ROLLBACK").catch(() => undefined);
      await leftClient.end();
      await rightClient.end();
    }
    const moved = await queryAsOwner<{ readonly id: string; readonly tripId: string }>(
      `SELECT "id"::text AS "id", "tripId"::text AS "tripId"
         FROM "trip_ops"."trip_traveller"
        WHERE "id" IN ('${leftTravellerId}'::uuid, '${rightTravellerId}'::uuid)
        ORDER BY "id"`,
    );
    expect(new Map(moved.map((row) => [row.id, row.tripId]))).toEqual(
      new Map([
        [leftTravellerId, rightTripId],
        [rightTravellerId, leftTripId],
      ]),
    );

    const afterRevisions = await queryAsOwner<{
      readonly id: string;
      readonly workspaceRevision: string;
      readonly lockVersion: string;
    }>(
      `SELECT "id"::text AS "id", "workspaceRevision"::text AS "workspaceRevision", "lockVersion"
         FROM "trip_ops"."trip"
        WHERE "id" IN ('${leftTripId}'::uuid, '${rightTripId}'::uuid)`,
    );
    const beforeById = new Map(beforeRevisions.map((row) => [row.id, row]));
    expect(afterRevisions).toHaveLength(2);
    for (const row of afterRevisions) {
      const before = beforeById.get(row.id);
      expect(before).toBeDefined();
      expect(BigInt(row.workspaceRevision)).toBe(BigInt(before!.workspaceRevision) + 2n);
      expect(row.lockVersion).toBe(before!.lockVersion);
    }
  });

  it("persists and reads plural typed itinerary items, reservations and many-to-many links", async () => {
    const input = baseInput();
    const seeded = await createTripSlice(repository, {
      ...input,
      trip: { ...input.trip, title: "Plural cardinality qualification" },
    });
    const secondFlightId = randomUUID();
    const secondAccommodationId = randomUUID();
    const secondReservationId = randomUUID();
    const thirdReservationId = randomUUID();
    const secondReservationReference = `SUP-${randomUUID()}`;
    const thirdReservationReference = `SUP-${randomUUID()}`;

    await withOwnerTransaction(async (client) => {
      await client.query(
        `INSERT INTO "trip_ops"."itinerary_item"
           ("id", "agencyId", "tripId", "family", "state", "sortOrder", "customerTitle", "customerDescription")
         VALUES
           ($1::uuid, $2::uuid, $3::uuid, 'FLIGHT', 'CONFIRMED', 3, 'Return flight', 'Synthetic return flight'),
           ($4::uuid, $2::uuid, $3::uuid, 'ACCOMMODATION', 'CONFIRMED', 4, 'Second hotel', 'Synthetic second stay')`,
        [secondFlightId, agencyId, seeded.trip.id, secondAccommodationId],
      );
      await client.query(
        `INSERT INTO "trip_ops"."flight_item_detail"
           ("agencyId", "tripId", "itemId", "carrier", "flightNumber", "departureAirport", "arrivalAirport",
            "departureDate", "departureTime", "departureTimezone", "departureInstant", "arrivalDate", "arrivalTime",
            "arrivalTimezone", "arrivalInstant")
         VALUES
           ($1::uuid, $2::uuid, $3::uuid, 'Example Air', 'EA200', 'LIS', 'MAD',
            '2026-09-25', '11:00', 'Europe/Lisbon', '2026-09-25T10:00:00Z', '2026-09-25', '12:30',
            'Europe/Lisbon', '2026-09-25T11:30:00Z')`,
        [agencyId, seeded.trip.id, secondFlightId],
      );
      await client.query(
        `INSERT INTO "trip_ops"."accommodation_item_detail"
           ("agencyId", "tripId", "itemId", "propertyName", "checkInDate", "checkInTime", "checkInTimezone", "checkInInstant",
            "checkOutDate", "checkOutTime", "checkOutTimezone", "checkOutInstant")
         VALUES
           ($1::uuid, $2::uuid, $3::uuid, 'Example Inn', '2026-09-25', '16:00', 'Europe/Lisbon', '2026-09-25T15:00:00Z',
            '2026-09-27', '10:00', 'Europe/Lisbon', '2026-09-27T09:00:00Z')`,
        [agencyId, seeded.trip.id, secondAccommodationId],
      );
      await client.query(
        `INSERT INTO "trip_ops"."reservation"
           ("id", "agencyId", "tripId", "supplierName", "supplierReference", "state")
         VALUES
           ($1::uuid, $2::uuid, $3::uuid, 'Example Supplier', $4, 'CONFIRMED'),
           ($5::uuid, $2::uuid, $3::uuid, 'Example Supplier', $6, 'CONFIRMED')`,
        [
          secondReservationId,
          agencyId,
          seeded.trip.id,
          secondReservationReference,
          thirdReservationId,
          thirdReservationReference,
        ],
      );
      await client.query(
        `INSERT INTO "trip_ops"."reservation_item_link"
           ("agencyId", "tripId", "reservationId", "itineraryItemId", "linkRole")
         VALUES
           ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'PRIMARY'),
           ($1::uuid, $2::uuid, $5::uuid, $6::uuid, 'PRIMARY'),
           ($1::uuid, $2::uuid, $5::uuid, $4::uuid, 'SECONDARY')`,
        [
          agencyId,
          seeded.trip.id,
          secondReservationId,
          secondFlightId,
          thirdReservationId,
          primaryFlight(seeded).id,
        ],
      );
    });

    const projected = await readTripSlice(repository, agencyId, seeded.trip.id);
    if (projected === null) throw new Error("Plural qualification Trip was not readable");
    const plural = projected;
    expect(plural.flights.map((item) => [item.id, item.sortOrder])).toEqual([
      [primaryFlight(seeded).id, 1],
      [secondFlightId, 3],
    ]);
    expect(plural.accommodations.map((item) => [item.id, item.sortOrder])).toEqual([
      [primaryAccommodation(seeded).id, 2],
      [secondAccommodationId, 4],
    ]);
    const expectedReservationRows = await queryAsOwner<{ readonly id: string }>(
      `SELECT "id"::text AS "id"
         FROM "trip_ops"."reservation"
        WHERE "agencyId" = '${agencyId}'::uuid AND "tripId" = '${seeded.trip.id}'::uuid
        ORDER BY "createdAt", "id"`,
    );
    expect(plural.reservations.map((reservation) => reservation.id)).toEqual(
      expectedReservationRows.map((reservation) => reservation.id),
    );
    expect(plural.reservations).toHaveLength(3);
    const expectedLinkRows = await queryAsOwner<{
      readonly reservationId: string;
      readonly itineraryItemId: string;
    }>(
      `SELECT "reservationId"::text AS "reservationId", "itineraryItemId"::text AS "itineraryItemId"
         FROM "trip_ops"."reservation_item_link"
        WHERE "agencyId" = '${agencyId}'::uuid AND "tripId" = '${seeded.trip.id}'::uuid
        ORDER BY "reservationId", "itineraryItemId"`,
    );
    expect(
      plural.reservationItemLinks.map(({ reservationId, itineraryItemId }) => ({
        reservationId,
        itineraryItemId,
      })),
    ).toEqual(expectedLinkRows);
    expect(plural.reservationItemLinks).toHaveLength(5);
    const linkedItemIdsForFirstReservation = new Set(
      plural.reservationItemLinks
        .filter((link) => link.reservationId === primaryReservation(seeded).id)
        .map((link) => link.itineraryItemId),
    );
    expect(linkedItemIdsForFirstReservation).toEqual(
      new Set([primaryFlight(seeded).id, primaryAccommodation(seeded).id]),
    );
    expect(
      plural.reservationItemLinks.filter(
        (link) => link.itineraryItemId === primaryFlight(seeded).id,
      ),
    ).toHaveLength(2);
    expect(plural.supplierCosts.map((cost) => cost.reservationId)).toEqual([
      primaryReservation(seeded).id,
    ]);
    expect(plural.traveller.role).toBe("PRIMARY_TRAVELLER");

    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `INSERT INTO "trip_ops"."reservation_item_link"
             ("agencyId", "tripId", "reservationId", "itineraryItemId", "linkRole")
           VALUES ('${agencyId}'::uuid, '${seeded.trip.id}'::uuid, '${primaryReservation(seeded).id}'::uuid,
                   '${randomUUID()}'::uuid, 'PRIMARY')`,
        ),
      ),
    ).toBe("reservation_link_item_trip_fk");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `INSERT INTO "trip_ops"."reservation_item_link"
             ("agencyId", "tripId", "reservationId", "itineraryItemId", "linkRole")
           VALUES ('${agencyId}'::uuid, '${seeded.trip.id}'::uuid, '${randomUUID()}'::uuid,
                   '${primaryFlight(seeded).id}'::uuid, 'PRIMARY')`,
        ),
      ),
    ).toBe("reservation_link_reservation_trip_fk");
    expect(
      await queryErrorCode(() =>
        withOwnerTransaction(async (client) => {
          await client.query(
            `INSERT INTO "trip_ops"."itinerary_item"
               ("id", "agencyId", "tripId", "family", "state", "sortOrder", "customerTitle", "customerDescription")
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'FLIGHT', 'DRAFT', 5, 'Incomplete flight', 'No detail row')`,
            [randomUUID(), agencyId, seeded.trip.id],
          );
        }),
      ),
    ).toBe("P0001");
    expect(
      await queryErrorCode(() =>
        withOwnerTransaction(async (client) => {
          await client.query(
            `INSERT INTO "trip_ops"."itinerary_item"
               ("id", "agencyId", "tripId", "family", "state", "sortOrder", "customerTitle", "customerDescription")
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'ACCOMMODATION', 'DRAFT', 6, 'Incomplete hotel', 'No detail row')`,
            [randomUUID(), agencyId, seeded.trip.id],
          );
        }),
      ),
    ).toBe("P0001");
  });

  it("enforces the four-digit temporal contract at the PostgreSQL boundary", async () => {
    const input = baseInput();
    const temporalSlice = await createTripSlice(repository, {
      ...input,
      trip: { ...input.trip, title: "Temporal calendar-boundary qualification" },
    });
    const flightId = primaryFlight(temporalSlice).id;
    const accommodationId = primaryAccommodation(temporalSlice).id;
    const tripId = temporalSlice.trip.id;

    const datesFor = async () =>
      queryAsOwner<{ readonly startDate: string; readonly endDate: string }>(
        `SELECT "startDate"::text AS "startDate", "endDate"::text AS "endDate"
           FROM "trip_ops"."trip" WHERE "id" = '${tripId}'::uuid`,
      );
    const setTripDate = async (dateLiteral: string) =>
      queryAsOwner(
        `UPDATE "trip_ops"."trip"
            SET "startDate" = DATE '${dateLiteral}', "endDate" = DATE '${dateLiteral}'
          WHERE "id" = '${tripId}'::uuid`,
      );

    await setTripDate("1000-01-01");
    expect(await datesFor()).toEqual([{ startDate: "1000-01-01", endDate: "1000-01-01" }]);
    await setTripDate("9999-12-31");
    expect(await datesFor()).toEqual([{ startDate: "9999-12-31", endDate: "9999-12-31" }]);
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."trip" SET "startDate" = DATE '0999-12-31'
            WHERE "id" = '${tripId}'::uuid`,
        ),
      ),
    ).toBe("trip_date_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."trip" SET "endDate" = DATE '10000-01-01'
            WHERE "id" = '${tripId}'::uuid`,
        ),
      ),
    ).toBe("trip_date_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."trip" SET "endDate" = DATE 'infinity'
            WHERE "id" = '${tripId}'::uuid`,
        ),
      ),
    ).toBe("trip_date_policy");
    expect(await queryErrorCode(() => queryAsOwner("SELECT DATE '2026-02-30'"))).toBe("22008");

    await queryAsOwner(
      `UPDATE "trip_ops"."flight_item_detail"
          SET "departureDate" = DATE '1000-01-01',
              "departureTime" = TIME '00:00:00',
              "departureTimezone" = 'UTC',
              "departureInstant" = TIMESTAMPTZ '1000-01-01 00:00:00+00',
              "arrivalDate" = DATE '1000-01-01',
              "arrivalTime" = TIME '00:00:01',
              "arrivalTimezone" = 'UTC',
              "arrivalInstant" = TIMESTAMPTZ '1000-01-01 00:00:01+00'
        WHERE "itemId" = '${flightId}'::uuid`,
    );
    await queryAsOwner(
      `UPDATE "trip_ops"."flight_item_detail"
          SET "departureDate" = DATE '9999-12-31',
              "departureTime" = TIME '23:59:58',
              "departureTimezone" = 'UTC',
              "departureInstant" = TIMESTAMPTZ '9999-12-31 23:59:58.999+00',
              "arrivalDate" = DATE '9999-12-31',
              "arrivalTime" = TIME '23:59:59',
              "arrivalTimezone" = 'UTC',
              "arrivalInstant" = TIMESTAMPTZ '9999-12-31 23:59:59.999+00'
        WHERE "itemId" = '${flightId}'::uuid`,
    );
    const flightUpperBoundary = await queryAsOwner<{ readonly arrival: string }>(
      `SELECT to_char("arrivalInstant" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "arrival"
         FROM "trip_ops"."flight_item_detail" WHERE "itemId" = '${flightId}'::uuid`,
    );
    expect(flightUpperBoundary[0]?.arrival).toBe("9999-12-31T23:59:59.999");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureInstant" = TIMESTAMPTZ '0999-12-31 23:00:00+00'
            WHERE "itemId" = '${flightId}'::uuid`,
        ),
      ),
    ).toBe("scheduled_instant_calendar_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureInstant" = TIMESTAMPTZ '10000-01-01 00:00:00+00'
            WHERE "itemId" = '${flightId}'::uuid`,
        ),
      ),
    ).toBe("scheduled_instant_calendar_policy");

    await queryAsOwner(
      `UPDATE "trip_ops"."accommodation_item_detail"
          SET "checkInDate" = DATE '1000-01-01',
              "checkInTime" = TIME '00:00:00',
              "checkInTimezone" = 'UTC',
              "checkInInstant" = TIMESTAMPTZ '1000-01-01 00:00:00+00',
              "checkOutDate" = DATE '1000-01-01',
              "checkOutTime" = TIME '00:01:00',
              "checkOutTimezone" = 'UTC',
              "checkOutInstant" = TIMESTAMPTZ '1000-01-01 00:01:00+00'
        WHERE "itemId" = '${accommodationId}'::uuid`,
    );
    await queryAsOwner(
      `UPDATE "trip_ops"."accommodation_item_detail"
          SET "checkInDate" = DATE '9999-12-31',
              "checkInTime" = TIME '23:59:58',
              "checkInTimezone" = 'UTC',
              "checkInInstant" = TIMESTAMPTZ '9999-12-31 23:59:58.999+00',
              "checkOutDate" = DATE '9999-12-31',
              "checkOutTime" = TIME '23:59:59',
              "checkOutTimezone" = 'UTC',
              "checkOutInstant" = TIMESTAMPTZ '9999-12-31 23:59:59.999+00'
        WHERE "itemId" = '${accommodationId}'::uuid`,
    );
    const accommodationUpperBoundary = await queryAsOwner<{ readonly checkOut: string }>(
      `SELECT to_char("checkOutInstant" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "checkOut"
         FROM "trip_ops"."accommodation_item_detail" WHERE "itemId" = '${accommodationId}'::uuid`,
    );
    expect(accommodationUpperBoundary[0]?.checkOut).toBe("9999-12-31T23:59:59.999");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."accommodation_item_detail"
              SET "checkInInstant" = TIMESTAMPTZ '0999-12-31 23:00:00+00'
            WHERE "itemId" = '${accommodationId}'::uuid`,
        ),
      ),
    ).toBe("scheduled_instant_calendar_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."accommodation_item_detail"
              SET "checkOutInstant" = TIMESTAMPTZ '10000-01-01 00:00:00+00'
            WHERE "itemId" = '${accommodationId}'::uuid`,
        ),
      ),
    ).toBe("scheduled_instant_calendar_policy");

    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureDate" = DATE '2026-09-25',
                  "departureTime" = TIME '09:00:00',
                  "departureTimezone" = 'Europe/Lisbon',
                  "departureInstant" = TIMESTAMPTZ '2026-09-25 08:00:00+00',
                  "arrivalDate" = DATE '2026-09-25',
                  "arrivalTime" = TIME '08:00:00',
                  "arrivalTimezone" = 'Europe/Lisbon',
                  "arrivalInstant" = TIMESTAMPTZ '2026-09-25 07:00:00+00'
            WHERE "itemId" = '${flightId}'::uuid`,
        ),
      ),
    ).toBe("flight_time_order");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."accommodation_item_detail"
              SET "checkInDate" = DATE '2026-09-25',
                  "checkInTime" = TIME '15:00:00',
                  "checkInTimezone" = 'Europe/Lisbon',
                  "checkInInstant" = TIMESTAMPTZ '2026-09-25 14:00:00+00',
                  "checkOutDate" = DATE '2026-09-25',
                  "checkOutTime" = TIME '11:00:00',
                  "checkOutTimezone" = 'Europe/Lisbon',
                  "checkOutInstant" = TIMESTAMPTZ '2026-09-25 10:00:00+00'
            WHERE "itemId" = '${accommodationId}'::uuid`,
        ),
      ),
    ).toBe("accommodation_time_order");

    const temporalPolicies = await queryAsOwner<{
      readonly constraintName: string;
      readonly validated: boolean;
    }>(`
      SELECT constraint_row.conname AS "constraintName",
             constraint_row.convalidated AS "validated"
        FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conname IN (
         'trip_date_policy',
         'flight_departure_instant_calendar_policy',
         'flight_arrival_instant_calendar_policy',
         'accommodation_check_instant_calendar_policy',
         'accommodation_check_out_instant_calendar_policy'
       )
       ORDER BY constraint_row.conname
    `);
    expect(temporalPolicies).toHaveLength(5);
    expect(temporalPolicies.every((policy) => policy.validated)).toBe(true);
  });

  it("proves Agency and same-Trip constraints, wrong-family rejection and no float columns", async () => {
    const secondInput = baseInput();
    const secondSlice = await createTripSlice(repository, {
      ...secondInput,
      trip: { ...secondInput.trip, title: "Second Trips qualification trip" },
    });
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureTime" = TIME '24:00:00'
            WHERE "itemId" = '${primaryFlight(slice).id}'::uuid`,
        ),
      ),
    ).toBe("flight_local_time_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."accommodation_item_detail"
              SET "checkInTime" = TIME '24:00:00'
            WHERE "itemId" = '${primaryAccommodation(slice).id}'::uuid`,
        ),
      ),
    ).toBe("accommodation_local_time_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureTime" = TIME '09:00:00.001'
            WHERE "itemId" = '${primaryFlight(slice).id}'::uuid`,
        ),
      ),
    ).toBe("flight_local_time_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureInstant" = '2026-09-25T08:00:00.000001Z'::timestamptz
            WHERE "itemId" = '${primaryFlight(slice).id}'::uuid`,
        ),
      ),
    ).toBe("flight_instant_precision_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureTimezone" = 'Mars/Phobos'
            WHERE "itemId" = '${primaryFlight(slice).id}'::uuid`,
        ),
      ),
    ).toBe("scheduled_timezone_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureTimezone" = 'Asia/Kolkata'
            WHERE "itemId" = '${primaryFlight(slice).id}'::uuid`,
        ),
      ),
    ).toBe("scheduled_timezone_policy");
    const canonicalTimezoneLiterals = TRAVELOS_CANONICAL_TIMEZONE_NAMES.map(sqlLiteral).join(", ");
    const persistedTimezoneNames = await queryAsOwner<{ readonly name: string }>(
      `SELECT name
         FROM pg_catalog.pg_timezone_names
        WHERE name IN (${canonicalTimezoneLiterals})`,
    );
    expect(new Set(persistedTimezoneNames.map((row) => row.name))).toEqual(
      new Set(TRAVELOS_CANONICAL_TIMEZONE_NAMES),
    );
    const semanticProbeInstants = ["2026-01-15T12:34:56Z", "2026-07-15T12:34:56Z"] as const;
    const semanticProbeValues = semanticProbeInstants
      .map((instant) => `(${sqlLiteral(instant)}, ${sqlLiteral(instant)}::timestamptz)`)
      .join(", ");
    const semanticRows = await queryAsOwner<{
      readonly name: string;
      readonly instantLabel: string;
      readonly localTuple: string;
    }>(
      `SELECT zones.name,
              instants."instantLabel",
              to_char(instants."instant" AT TIME ZONE zones.name, 'YYYY-MM-DD"T"HH24:MI:SS') AS "localTuple"
         FROM unnest(ARRAY[${canonicalTimezoneLiterals}]::text[]) AS zones(name)
         CROSS JOIN (VALUES ${semanticProbeValues}) AS instants("instantLabel", "instant")`,
    );
    expect(semanticRows).toHaveLength(TRAVELOS_CANONICAL_TIMEZONE_NAMES.length * 2);
    for (const row of semanticRows) {
      expect(row.localTuple).toBe(localPartsForInstant(row.instantLabel, row.name));
    }

    await expect(
      queryAsOwner(
        `SELECT "trip_ops"."assert_scheduled_temporal_tuple"(
          DATE '2026-10-25', TIME '01:30:00', 'Europe/Lisbon',
          TIMESTAMPTZ '2026-10-25T00:30:00Z', 'DST overlap earlier'
        )`,
      ),
    ).resolves.toHaveLength(1);
    await expect(
      queryAsOwner(
        `SELECT "trip_ops"."assert_scheduled_temporal_tuple"(
          DATE '2026-10-25', TIME '01:30:00', 'Europe/Lisbon',
          TIMESTAMPTZ '2026-10-25T01:30:00Z', 'DST overlap later'
        )`,
      ),
    ).resolves.toHaveLength(1);
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `SELECT "trip_ops"."assert_scheduled_temporal_tuple"(
            DATE '2026-03-29', TIME '01:30:00', 'Europe/Lisbon',
            TIMESTAMPTZ '2026-03-29T01:30:00Z', 'DST gap'
          )`,
        ),
      ),
    ).toBe("scheduled_local_tuple_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."flight_item_detail"
              SET "departureTime" = TIME '09:01:00'
            WHERE "itemId" = '${primaryFlight(slice).id}'::uuid`,
        ),
      ),
    ).toBe("scheduled_local_tuple_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."accommodation_item_detail"
              SET "checkOutInstant" = '2026-09-28T10:00:00.000001Z'::timestamptz
            WHERE "itemId" = '${primaryAccommodation(slice).id}'::uuid`,
        ),
      ),
    ).toBe("accommodation_instant_precision_policy");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `UPDATE "trip_ops"."accommodation_item_detail"
              SET "checkOutTimezone" = 'Mars/Phobos'
            WHERE "itemId" = '${primaryAccommodation(slice).id}'::uuid`,
        ),
      ),
    ).toBe("scheduled_timezone_policy");
    const supportedOffset = await queryAsOwner<{ readonly instant: string }>(
      `SELECT ('2026-09-25T00:00:00+15:59'::timestamptz AT TIME ZONE 'UTC')::text AS "instant"`,
    );
    expect(supportedOffset[0]?.instant).toBe("2026-09-24 08:01:00");
    expect(
      await queryErrorCode(() => queryAsOwner(`SELECT '2026-09-25T00:00:00+16:00'::timestamptz`)),
    ).toBe("22009");
    expect(
      await queryErrorCode(() =>
        queryAsOwner(
          `INSERT INTO "trip_ops"."reservation_item_link" ("agencyId", "tripId", "reservationId", "itineraryItemId", "linkRole")
           VALUES ('00000000-0000-7000-8000-000000000099'::uuid, '${slice.trip.id}'::uuid, '${primaryReservation(slice).id}'::uuid, '${primaryFlight(slice).id}'::uuid, 'PRIMARY')`,
        ),
      ),
    ).toBe("23503");
    expect(
      await queryErrorConstraint(() =>
        queryAsOwner(
          `INSERT INTO "trip_ops"."reservation_item_link" ("agencyId", "tripId", "reservationId", "itineraryItemId", "linkRole")
           VALUES ('${agencyId}'::uuid, '${slice.trip.id}'::uuid, '${primaryReservation(secondSlice).id}'::uuid, '${primaryFlight(secondSlice).id}'::uuid, 'PRIMARY')`,
        ),
      ),
    ).toBe("reservation_link_reservation_trip_fk");
    expect(
      await queryErrorCode(() =>
        queryAsOwner(
          `INSERT INTO "trip_ops"."flight_item_detail"
             ("agencyId", "tripId", "itemId", "carrier", "flightNumber", "departureAirport", "arrivalAirport", "departureDate", "departureTime", "departureTimezone", "departureInstant", "arrivalDate", "arrivalTime", "arrivalTimezone", "arrivalInstant")
           VALUES ('${agencyId}'::uuid, '${slice.trip.id}'::uuid, '${primaryAccommodation(slice).id}'::uuid, 'Bad', 'BAD', 'LIS', 'OPO', '2026-09-25', '09:00', 'Europe/Lisbon', '2026-09-25T08:00:00Z', '2026-09-25', '10:00', 'Europe/Lisbon', '2026-09-25T09:00:00Z')`,
        ),
      ),
    ).toBe("P0001");
    expect(
      await queryErrorCode(() =>
        queryAsOwner(
          `INSERT INTO "trip_ops"."accommodation_item_detail"
             ("agencyId", "tripId", "itemId", "propertyName", "checkInDate", "checkInTime", "checkInTimezone", "checkInInstant", "checkOutDate", "checkOutTime", "checkOutTimezone", "checkOutInstant")
           VALUES ('${agencyId}'::uuid, '${slice.trip.id}'::uuid, '${primaryFlight(slice).id}'::uuid,
                   'Wrong-family detail', '2026-09-25', '15:00', 'Europe/Lisbon', '2026-09-25T14:00:00Z',
                   '2026-09-28', '11:00', 'Europe/Lisbon', '2026-09-28T10:00:00Z')`,
        ),
      ),
    ).toBe("P0001");
  });

  it("denies reads without a current Agency membership", async () => {
    const otherAgency = asOpaqueId("00000000-0000-7000-8000-000000000099");
    const nowEpochMs = Date.now();
    const unassignedAgencyAuthorization: StaffAuthorizationOperationProof = {
      session: {
        sessionId: primaryStaffFixture.sessionId,
        staffPrincipalId: primaryStaffFixture.staffPrincipalId,
        agencyId: otherAgency,
        authorizationEpoch: 1n,
        expiresAtEpochMs: nowEpochMs + 60 * 60 * 1_000,
        recentMfaVerifiedAtEpochMs: null,
      },
      requiredPermissionIds: READ_PERMISSION_IDS,
      nowEpochMs,
    };
    await expect(
      readTripSliceWithAuthorization(
        repository,
        otherAgency,
        slice.trip.id,
        unassignedAgencyAuthorization,
      ),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
  });
});

const workspaceDatabase = "travelos_trips";
const withOwnerLogin = async <Result>(
  database: string,
  work: (client: Client) => Promise<Result>,
): Promise<Result> => {
  const client = await createOwnerClient(database);
  try {
    return await work(client);
  } finally {
    await client.end();
  }
};

/** A fabricated Owner session (full capabilities, recent MFA) resolved through the registry. */
const createWorkspaceHarness = async () => {
  const sessions: StaffSessionRegistry = new Map();
  const owner = await createOwnerClient(workspaceDatabase);
  try {
    const staff = await createStaff(owner, sessions, "workspace", [], {
      agencyId,
      roleId: ownerRoleId,
      recentMfa: true,
    });
    return {
      cookie: staff.cookie,
      sessionId: staff.sessionId,
      principalId: staff.principalId,
      resolver: registrySessionResolver(sessions),
    };
  } finally {
    await owner.end();
  }
};

const workspaceDraft = (title: string): CreateTripSliceInput => ({
  agencyId: asOpaqueId(agencyId),
  person: {
    givenName: "Synthetic",
    familyName: "Cleanup Traveller",
    email: `workspace-workspace-${randomUUID()}@example.test`,
  },
  customer: { displayName: "Workspace Customer" },
  customerPersonRole: "PRIMARY_CONTACT",
  trip: { title, startDate: "2027-10-12", endDate: "2027-10-15", state: "DRAFT" },
  travellerRole: "PRIMARY_TRAVELLER",
  flight: {
    title: "Outbound flight",
    description: "Synthetic flight description",
    carrier: "Example Air",
    flightNumber: "EA100",
    departureAirport: "LIS",
    arrivalAirport: "OPO",
    departure: createScheduledLocalDateTime({
      localDate: "2027-10-12",
      localTime: "09:00",
      timezoneName: "Europe/Lisbon",
      instant: "2027-10-12T08:00:00Z",
    }),
    arrival: createScheduledLocalDateTime({
      localDate: "2027-10-12",
      localTime: "10:00",
      timezoneName: "Europe/Lisbon",
      instant: "2027-10-12T09:00:00Z",
    }),
    terminal: null,
    cabin: "ECONOMY",
    baggage: "One cabin bag",
    seat: null,
    customerBookingReference: "SYNTH-FLIGHT-1",
  },
  accommodation: {
    title: "Synthetic hotel",
    description: "Synthetic accommodation description",
    propertyName: "Example Hotel",
    checkIn: createScheduledLocalDateTime({
      localDate: "2027-10-12",
      localTime: "15:00",
      timezoneName: "Europe/Lisbon",
      instant: "2027-10-12T14:00:00Z",
    }),
    checkOut: createScheduledLocalDateTime({
      localDate: "2027-10-15",
      localTime: "11:00",
      timezoneName: "Europe/Lisbon",
      instant: "2027-10-15T10:00:00Z",
    }),
    roomDescription: "Double room",
    boardType: "BREAKFAST",
    customerBookingReference: "SYNTH-HOTEL-1",
  },
  reservation: {
    supplierName: "Synthetic Supplier",
    supplierReference: `SUP-${randomUUID()}`,
    customerBookingReference: "SYNTH-RES-1",
    state: "CONFIRMED",
  },
  supplierCost: {
    amount: createMoney("12345", "EUR", 2),
    internalNote: "Synthetic workspace qualification note",
  },
});

describe.sequential("Trip workspace create and edit flows", () => {
  it("creates_an_authorized_minimal_trip_workspace_with_an_empty_itinerary", async () => {
    const { cookie, resolver } = await createWorkspaceHarness();
    if (persistence === null) {
      throw new Error("Workspace Staff persistence fixture was not initialized");
    }
    const operations = databaseModule.createPostgresStaffTripOperations(persistence, resolver);
    const marker = randomUUID();
    const requestBody = {
      customer: { displayName: `Workspace synthetic customer ${marker}` },
      primaryTraveller: { givenName: "Workspace", familyName: `Synthetic-${marker}` },
      trip: {
        title: `Workspace synthetic trip ${marker}`,
        startDate: "2026-12-01",
        endDate: "2026-12-05",
      },
    };

    const trip = await operations.createTripWorkspace(cookie, requestBody);

    expect(trip).toMatchObject({
      agencyId: asOpaqueId(agencyId),
      title: requestBody.trip.title,
      startDate: requestBody.trip.startDate,
      endDate: requestBody.trip.endDate,
      state: "DRAFT",
      workspaceRevision: 1n,
      lockVersion: 0n,
    });
    const persisted = await withOwnerLogin(workspaceDatabase, (client) =>
      client.query(
        `SELECT trip."agencyId"::text AS "agencyId", trip."title", trip."state",
                trip."workspaceRevision"::text AS "workspaceRevision",
                trip."lockVersion"::text AS "lockVersion", customer."displayName",
                person."givenName", person."familyName", customer_person."role" AS "customerPersonRole",
                customer_person."isPrimary" AS "customerPersonPrimary", traveller."role" AS "travellerRole",
                (SELECT count(*)::text FROM "trip_ops"."itinerary_item" AS item
                  WHERE item."agencyId" = trip."agencyId" AND item."tripId" = trip."id") AS "itemCount",
                (SELECT count(*)::text FROM "trip_ops"."reservation" AS reservation
                  WHERE reservation."agencyId" = trip."agencyId" AND reservation."tripId" = trip."id") AS "reservationCount",
                (SELECT count(*)::text FROM "finance"."supplier_cost_line" AS cost
                  WHERE cost."agencyId" = trip."agencyId" AND cost."tripId" = trip."id") AS "supplierCostCount"
           FROM "trip_ops"."trip" AS trip
           JOIN "trip_ops"."trip_traveller" AS traveller
             ON traveller."agencyId" = trip."agencyId" AND traveller."tripId" = trip."id"
            AND traveller."role" = 'PRIMARY_TRAVELLER'
           JOIN "crm"."person" AS person
             ON person."agencyId" = traveller."agencyId" AND person."id" = traveller."personId"
           JOIN "crm"."customer_person" AS customer_person
             ON customer_person."agencyId" = person."agencyId" AND customer_person."personId" = person."id"
            AND customer_person."isPrimary" = true
           JOIN "crm"."customer" AS customer
             ON customer."agencyId" = customer_person."agencyId" AND customer."id" = customer_person."customerId"
          WHERE trip."id" = $1::uuid`,
        [trip.id],
      ),
    );
    expect(persisted.rows).toEqual([
      {
        agencyId: agencyId,
        title: requestBody.trip.title,
        state: "DRAFT",
        workspaceRevision: "1",
        lockVersion: "0",
        displayName: requestBody.customer.displayName,
        givenName: "Workspace",
        familyName: requestBody.primaryTraveller.familyName,
        customerPersonRole: "PRIMARY_CONTACT",
        customerPersonPrimary: true,
        travellerRole: "PRIMARY_TRAVELLER",
        itemCount: "0",
        reservationCount: "0",
        supplierCostCount: "0",
      },
    ]);
  });

  it("persists Flight, Accommodation and Trip edits with workspace revision and item lock CAS", async () => {
    const { cookie, resolver } = await createWorkspaceHarness();
    if (persistence === null) {
      throw new Error("Workspace Staff persistence fixture was not initialized");
    }
    const createWriteOperations = Reflect.get(
      databaseModule,
      "createPostgresStaffTripWorkspaceWriteOperations",
    );
    expect(typeof createWriteOperations).toBe("function");
    if (typeof createWriteOperations !== "function") {
      throw new Error("PostgreSQL Staff workspace write operations are not exported");
    }
    const writeOperations = Reflect.apply(createWriteOperations, undefined, [
      persistence,
      resolver,
    ]) as StaffTripWorkspaceWriteOperations;
    const tripOperations = databaseModule.createPostgresStaffTripOperations(persistence, resolver);
    const marker = randomUUID();
    const trip = await tripOperations.createTripWorkspace(cookie, {
      customer: { displayName: `Workspace CAS customer ${marker}` },
      primaryTraveller: { givenName: "Workspace", familyName: `CAS-${marker}` },
      trip: {
        title: `Workspace CAS trip ${marker}`,
        startDate: "2027-10-12",
        endDate: "2027-10-15",
      },
    });
    const drafts = workspaceDraft(`Workspace CAS draft ${marker}`);

    const withFlight = await writeOperations.createFlight(cookie, trip.id, {
      expectedWorkspaceRevision: 1n,
      flight: drafts.flight,
    });
    expect(withFlight).toMatchObject({
      trip: { id: trip.id, workspaceRevision: 2n, lockVersion: 0n },
      flights: [
        {
          title: drafts.flight.title,
          flightNumber: drafts.flight.flightNumber,
          state: "DRAFT",
          sortOrder: 1,
          lockVersion: 0n,
        },
      ],
      accommodations: [],
    });
    const withAccommodation = await writeOperations.createAccommodation(cookie, trip.id, {
      expectedWorkspaceRevision: 2n,
      accommodation: drafts.accommodation,
    });
    expect(withAccommodation).toMatchObject({
      trip: { id: trip.id, workspaceRevision: 3n, lockVersion: 0n },
      accommodations: [
        {
          title: drafts.accommodation.title,
          propertyName: drafts.accommodation.propertyName,
          state: "DRAFT",
          sortOrder: 2,
          lockVersion: 0n,
        },
      ],
    });
    const flight = withAccommodation.flights[0];
    const accommodation = withAccommodation.accommodations[0];
    expect(flight).toBeDefined();
    expect(accommodation).toBeDefined();
    if (!flight || !accommodation) throw new Error("Created itinerary items were not returned");

    const editedFlight = {
      ...drafts.flight,
      title: "Updated outbound flight",
      description: "Updated synthetic flight details",
      flightNumber: "EA101",
    };
    const withEditedFlight = await writeOperations.updateFlight(cookie, trip.id, flight.id, {
      expectedWorkspaceRevision: 3n,
      expectedLockVersion: 0n,
      flight: editedFlight,
    });
    expect(withEditedFlight).toMatchObject({
      trip: { workspaceRevision: 4n, lockVersion: 0n },
      flights: [
        { id: flight.id, title: "Updated outbound flight", flightNumber: "EA101", lockVersion: 1n },
      ],
    });

    const editedAccommodation = {
      ...drafts.accommodation,
      title: "Updated hotel stay",
      description: "Updated synthetic accommodation details",
      propertyName: "Updated Example Hotel",
    };
    const withEditedAccommodation = await writeOperations.updateAccommodation(
      cookie,
      trip.id,
      accommodation.id,
      {
        expectedWorkspaceRevision: 4n,
        expectedLockVersion: 0n,
        accommodation: editedAccommodation,
      },
    );
    expect(withEditedAccommodation).toMatchObject({
      trip: { workspaceRevision: 5n, lockVersion: 0n },
      accommodations: [
        {
          id: accommodation.id,
          title: "Updated hotel stay",
          propertyName: "Updated Example Hotel",
          lockVersion: 1n,
        },
      ],
    });

    const withEditedTrip = await writeOperations.updateTrip(cookie, trip.id, {
      expectedWorkspaceRevision: 5n,
      expectedLockVersion: 0n,
      trip: {
        title: "Updated Workspace CAS trip",
        startDate: "2027-10-12",
        endDate: "2027-10-16",
      },
    });
    expect(withEditedTrip.trip).toMatchObject({
      title: "Updated Workspace CAS trip",
      startDate: "2027-10-12",
      endDate: "2027-10-16",
      workspaceRevision: 6n,
      lockVersion: 1n,
    });

    await expect(
      writeOperations.updateAccommodation(cookie, trip.id, accommodation.id, {
        expectedWorkspaceRevision: 5n,
        expectedLockVersion: 1n,
        accommodation: drafts.accommodation,
      }),
    ).rejects.toBeInstanceOf(OptimisticConflictError);
    await expect(
      writeOperations.updateAccommodation(cookie, trip.id, accommodation.id, {
        expectedWorkspaceRevision: 6n,
        expectedLockVersion: 0n,
        accommodation: drafts.accommodation,
      }),
    ).rejects.toBeInstanceOf(OptimisticConflictError);

    const persisted = await withOwnerLogin(workspaceDatabase, (client) =>
      client.query(
        `SELECT trip."title" AS "tripTitle", trip."workspaceRevision"::text AS "workspaceRevision",
                trip."lockVersion"::text AS "tripLockVersion", flight."sortOrder" AS "flightOrder",
                flight."customerTitle" AS "flightTitle", flight."lockVersion"::text AS "flightLockVersion",
                flight_detail."flightNumber", accommodation."sortOrder" AS "accommodationOrder",
                accommodation."customerTitle" AS "accommodationTitle",
                accommodation."lockVersion"::text AS "accommodationLockVersion",
                accommodation_detail."propertyName"
           FROM "trip_ops"."trip" AS trip
           JOIN "trip_ops"."itinerary_item" AS flight
             ON flight."agencyId" = trip."agencyId" AND flight."tripId" = trip."id"
            AND flight."family" = 'FLIGHT'
           JOIN "trip_ops"."flight_item_detail" AS flight_detail
             ON flight_detail."agencyId" = flight."agencyId" AND flight_detail."tripId" = flight."tripId"
            AND flight_detail."itemId" = flight."id"
           JOIN "trip_ops"."itinerary_item" AS accommodation
             ON accommodation."agencyId" = trip."agencyId" AND accommodation."tripId" = trip."id"
            AND accommodation."family" = 'ACCOMMODATION'
           JOIN "trip_ops"."accommodation_item_detail" AS accommodation_detail
             ON accommodation_detail."agencyId" = accommodation."agencyId"
            AND accommodation_detail."tripId" = accommodation."tripId"
            AND accommodation_detail."itemId" = accommodation."id"
          WHERE trip."id" = $1::uuid`,
        [trip.id],
      ),
    );
    expect(persisted.rows).toEqual([
      {
        tripTitle: "Updated Workspace CAS trip",
        workspaceRevision: "6",
        tripLockVersion: "1",
        flightOrder: 1,
        flightTitle: "Updated outbound flight",
        flightLockVersion: "1",
        flightNumber: "EA101",
        accommodationOrder: 2,
        accommodationTitle: "Updated hotel stay",
        accommodationLockVersion: "1",
        propertyName: "Updated Example Hotel",
      },
    ]);
  });

  it("does not update an itinerary item through a different Trip scope", async () => {
    const { cookie, resolver } = await createWorkspaceHarness();
    if (persistence === null) {
      throw new Error("Workspace Staff persistence fixture was not initialized");
    }
    const createWriteOperations = Reflect.get(
      databaseModule,
      "createPostgresStaffTripWorkspaceWriteOperations",
    );
    expect(typeof createWriteOperations).toBe("function");
    if (typeof createWriteOperations !== "function") {
      throw new Error("PostgreSQL Staff workspace write operations are not exported");
    }
    const writeOperations = Reflect.apply(createWriteOperations, undefined, [
      persistence,
      resolver,
    ]) as StaffTripWorkspaceWriteOperations;
    const tripOperations = databaseModule.createPostgresStaffTripOperations(persistence, resolver);
    const marker = randomUUID();
    const sourceTrip = await tripOperations.createTripWorkspace(cookie, {
      customer: { displayName: `Workspace scope source ${marker}` },
      primaryTraveller: { givenName: "Workspace", familyName: `ScopeSource-${marker}` },
      trip: {
        title: `Workspace scope source ${marker}`,
        startDate: "2027-10-12",
        endDate: "2027-10-15",
      },
    });
    const targetTrip = await tripOperations.createTripWorkspace(cookie, {
      customer: { displayName: `Workspace scope target ${marker}` },
      primaryTraveller: { givenName: "Workspace", familyName: `ScopeTarget-${marker}` },
      trip: {
        title: `Workspace scope target ${marker}`,
        startDate: "2027-10-12",
        endDate: "2027-10-15",
      },
    });
    const drafts = workspaceDraft(`Workspace scope draft ${marker}`);
    const sourceWorkspace = await writeOperations.createFlight(cookie, sourceTrip.id, {
      expectedWorkspaceRevision: 1n,
      flight: drafts.flight,
    });
    const flight = sourceWorkspace.flights[0];
    expect(flight).toBeDefined();
    if (!flight) throw new Error("Created source Flight was not returned");

    await expect(
      writeOperations.updateFlight(cookie, targetTrip.id, flight.id, {
        expectedWorkspaceRevision: 1n,
        expectedLockVersion: 0n,
        flight: { ...drafts.flight, title: "Cross-Trip update must be rejected" },
      }),
    ).rejects.toBeInstanceOf(TripNotFoundError);

    const persisted = await withOwnerLogin(workspaceDatabase, (client) =>
      client.query(
        `SELECT trip."id"::text AS "tripId",
                trip."workspaceRevision"::text AS "workspaceRevision",
                item."customerTitle" AS "flightTitle",
                item."lockVersion"::text AS "flightLockVersion"
           FROM "trip_ops"."trip" AS trip
           LEFT JOIN "trip_ops"."itinerary_item" AS item
             ON item."agencyId" = trip."agencyId" AND item."tripId" = trip."id"
            AND item."family" = 'FLIGHT'
          WHERE trip."id" = ANY($1::uuid[])
          ORDER BY trip."id"::text`,
        [[sourceTrip.id, targetTrip.id]],
      ),
    );
    const sourceRow = persisted.rows.find((row) => row["tripId"] === sourceTrip.id);
    const targetRow = persisted.rows.find((row) => row["tripId"] === targetTrip.id);
    expect(sourceRow).toMatchObject({
      workspaceRevision: "2",
      flightTitle: drafts.flight.title,
      flightLockVersion: "0",
    });
    expect(targetRow).toMatchObject({
      workspaceRevision: "1",
      flightTitle: null,
      flightLockVersion: null,
    });
  });

  it("rolls back a Flight itinerary row when detail insertion fails", async () => {
    const { cookie, resolver } = await createWorkspaceHarness();
    if (persistence === null) {
      throw new Error("Workspace Staff persistence fixture was not initialized");
    }
    const createWriteOperations = Reflect.get(
      databaseModule,
      "createPostgresStaffTripWorkspaceWriteOperations",
    );
    expect(typeof createWriteOperations).toBe("function");
    if (typeof createWriteOperations !== "function") {
      throw new Error("PostgreSQL Staff workspace write operations are not exported");
    }
    const writeOperations = Reflect.apply(createWriteOperations, undefined, [
      persistence,
      resolver,
    ]) as StaffTripWorkspaceWriteOperations;
    const tripOperations = databaseModule.createPostgresStaffTripOperations(persistence, resolver);
    const marker = randomUUID();
    const trip = await tripOperations.createTripWorkspace(cookie, {
      customer: { displayName: `Workspace atomic Flight customer ${marker}` },
      primaryTraveller: { givenName: "Workspace", familyName: `AtomicFlight-${marker}` },
      trip: {
        title: `Workspace atomic Flight ${marker}`,
        startDate: "2027-10-12",
        endDate: "2027-10-15",
      },
    });
    const drafts = workspaceDraft(`Workspace atomic Flight draft ${marker}`);
    await withOwnerLogin(workspaceDatabase, (client) =>
      client.query(`
        CREATE OR REPLACE FUNCTION "trip_ops"."workspace_test_reject_flight_detail_insert"()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $workspace_failure$
        BEGIN
          IF NEW."flightNumber" = 'EA999' THEN
            RAISE EXCEPTION 'Workspace test injected Flight detail failure'
              USING ERRCODE = 'P0001';
          END IF;
          RETURN NEW;
        END
        $workspace_failure$;
        CREATE TRIGGER "workspace_test_reject_flight_detail_insert"
          BEFORE INSERT ON "trip_ops"."flight_item_detail"
          FOR EACH ROW EXECUTE FUNCTION "trip_ops"."workspace_test_reject_flight_detail_insert"();
      `),
    );
    try {
      await expect(
        writeOperations.createFlight(cookie, trip.id, {
          expectedWorkspaceRevision: 1n,
          flight: { ...drafts.flight, flightNumber: "EA999" },
        }),
      ).rejects.toThrow("Workspace test injected Flight detail failure");
    } finally {
      await withOwnerLogin(workspaceDatabase, (client) =>
        client.query(`
          DROP TRIGGER IF EXISTS "workspace_test_reject_flight_detail_insert"
            ON "trip_ops"."flight_item_detail";
          DROP FUNCTION IF EXISTS "trip_ops"."workspace_test_reject_flight_detail_insert"();
        `),
      );
    }
    const persisted = await withOwnerLogin(workspaceDatabase, (client) =>
      client.query(
        `SELECT trip."workspaceRevision"::text AS "workspaceRevision",
                (SELECT count(*)::text
                   FROM "trip_ops"."itinerary_item" AS item
                  WHERE item."agencyId" = trip."agencyId" AND item."tripId" = trip."id") AS "itemCount",
                (SELECT count(*)::text
                   FROM "trip_ops"."flight_item_detail" AS detail
                  WHERE detail."agencyId" = trip."agencyId" AND detail."tripId" = trip."id") AS "flightDetailCount"
           FROM "trip_ops"."trip" AS trip
          WHERE trip."id" = $1::uuid`,
        [trip.id],
      ),
    );
    expect(persisted.rows).toEqual([
      { workspaceRevision: "1", itemCount: "0", flightDetailCount: "0" },
    ]);
  });

  it("rolls_back_customer_person_and_trip_when_primary_traveller_creation_fails", async () => {
    const { cookie, resolver } = await createWorkspaceHarness();
    if (persistence === null) {
      throw new Error("Workspace Staff persistence fixture was not initialized");
    }
    const operations = databaseModule.createPostgresStaffTripOperations(persistence, resolver);
    const marker = randomUUID();
    const requestBody = {
      customer: { displayName: `Workspace rollback customer ${marker}` },
      primaryTraveller: { givenName: "Workspace", familyName: `Rollback-${marker}` },
      trip: {
        title: `Workspace atomic rollback ${marker}`,
        startDate: "2026-12-01",
        endDate: "2026-12-05",
      },
    };
    await withOwnerLogin(workspaceDatabase, async (client) => {
      await client.query(`
        CREATE OR REPLACE FUNCTION "trip_ops"."workspace_test_reject_primary_traveller"()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $workspace_failure$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM "trip_ops"."trip" AS trip
             WHERE trip."id" = NEW."tripId"
               AND trip."title" LIKE 'Workspace atomic rollback %'
          ) THEN
            RAISE EXCEPTION 'Workspace test injected primary traveller failure'
              USING ERRCODE = 'P0001';
          END IF;
          RETURN NEW;
        END
        $workspace_failure$;
        CREATE TRIGGER "workspace_test_reject_primary_traveller"
          BEFORE INSERT ON "trip_ops"."trip_traveller"
          FOR EACH ROW EXECUTE FUNCTION "trip_ops"."workspace_test_reject_primary_traveller"();
      `);
    });
    try {
      await expect(operations.createTripWorkspace(cookie, requestBody)).rejects.toThrow(
        "Workspace test injected primary traveller failure",
      );
    } finally {
      await withOwnerLogin(workspaceDatabase, async (client) => {
        await client.query(`
          DROP TRIGGER IF EXISTS "workspace_test_reject_primary_traveller"
            ON "trip_ops"."trip_traveller";
          DROP FUNCTION IF EXISTS "trip_ops"."workspace_test_reject_primary_traveller"();
        `);
      });
    }
    const persisted = await withOwnerLogin(workspaceDatabase, (client) =>
      client.query(
        `SELECT
           (SELECT count(*)::text FROM "crm"."person" WHERE "familyName" = $1) AS "personCount",
           (SELECT count(*)::text FROM "crm"."customer" WHERE "displayName" = $2) AS "customerCount",
           (SELECT count(*)::text FROM "trip_ops"."trip" WHERE "title" = $3) AS "tripCount"`,
        [
          requestBody.primaryTraveller.familyName,
          requestBody.customer.displayName,
          requestBody.trip.title,
        ],
      ),
    );
    expect(persisted.rows).toEqual([{ personCount: "0", customerCount: "0", tripCount: "0" }]);
  });

  it("workspace_list_and_detail_recheck_trip_view_and_agency_without_customer_or_cost_reads", async () => {
    const {
      cookie,
      sessionId,
      resolver,
      principalId: staffPrincipalId,
    } = await createWorkspaceHarness();
    const restrictedPersonId = randomUUID();
    const tripId = randomUUID();
    const tripTravellerId = randomUUID();
    const flightId = randomUUID();
    const accommodationId = randomUUID();
    const roleName = `workspace_workspace_${randomUUID().replaceAll("-", "")}`;
    if (!/^workspace_workspace_[0-9a-f]{32}$/u.test(roleName)) {
      throw new Error("Workspace restricted workspace role name is invalid");
    }
    const quotedRole = `"${roleName}"`;
    let restrictedPersistence: PostgresPersistence<Record<string, never>> | null = null;
    let roleCreated = false;

    const createRestrictedRole = async (): Promise<void> => {
      const client = new Client({
        host,
        port,
        database: workspaceDatabase,
        user: "postgres",
        ssl: false,
      });
      await client.connect();
      try {
        await client.query(
          `CREATE ROLE ${quotedRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS`,
        );
        roleCreated = true;
        await client.query(`GRANT CONNECT ON DATABASE "${workspaceDatabase}" TO ${quotedRole}`);
        await client.query(
          `GRANT USAGE ON SCHEMA "staff_access", "trip_ops", "crm", "finance" TO ${quotedRole}`,
        );
        await client.query(
          `GRANT SELECT ON TABLE
             "staff_access"."staff_session",
             "staff_access"."staff_session_context",
             "staff_access"."staff_membership",
             "staff_access"."role_assignment",
             "staff_access"."role_permission",
             "trip_ops"."trip",
             "trip_ops"."itinerary_item",
             "trip_ops"."flight_item_detail",
             "trip_ops"."accommodation_item_detail"
           TO ${quotedRole}`,
        );
        await client.query(
          `GRANT UPDATE ON TABLE
             "staff_access"."staff_session",
             "staff_access"."staff_session_context",
             "staff_access"."staff_membership"
           TO ${quotedRole}`,
        );
      } finally {
        await client.end();
      }
    };

    try {
      await withOwnerLogin(workspaceDatabase, async (client) => {
        await client.query("BEGIN");
        try {
          await client.query(
            `INSERT INTO "crm"."person" ("id", "agencyId", "givenName", "familyName")
             VALUES ($1::uuid, $2::uuid, 'Synthetic', 'Restricted')`,
            [restrictedPersonId, agencyId],
          );
          const restrictedCustomerId = randomUUID();
          await client.query(
            `INSERT INTO "crm"."customer" ("id", "agencyId", "displayName")
             VALUES ($1::uuid, $2::uuid, 'Workspace restricted customer')`,
            [restrictedCustomerId, agencyId],
          );
          await client.query(
            `INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'PRIMARY_CONTACT', true)`,
            [agencyId, restrictedCustomerId, restrictedPersonId],
          );
          await client.query(
            `INSERT INTO "trip_ops"."trip" ("id", "agencyId", "title", "startDate", "endDate", "state")
             VALUES ($1::uuid, $2::uuid, 'Workspace restricted workspace Trip', '2026-12-01', '2026-12-02', 'DRAFT')`,
            [tripId, agencyId],
          );
          await client.query(
            `INSERT INTO "trip_ops"."trip_traveller" ("id", "agencyId", "tripId", "personId", "role")
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'PRIMARY_TRAVELLER')`,
            [tripTravellerId, agencyId, tripId, restrictedPersonId],
          );
          await client.query(
            `INSERT INTO "trip_ops"."itinerary_item"
               ("id", "agencyId", "tripId", "family", "state", "sortOrder", "customerTitle", "customerDescription")
             VALUES
               ($1::uuid, $2::uuid, $3::uuid, 'FLIGHT', 'CONFIRMED', 1, 'Synthetic flight', 'Synthetic flight details'),
               ($4::uuid, $2::uuid, $3::uuid, 'ACCOMMODATION', 'CONFIRMED', 2, 'Synthetic stay', 'Synthetic accommodation details')`,
            [flightId, agencyId, tripId, accommodationId],
          );
          await client.query(
            `INSERT INTO "trip_ops"."flight_item_detail"
               ("agencyId", "tripId", "itemId", "carrier", "flightNumber", "departureAirport", "arrivalAirport",
                "departureDate", "departureTime", "departureTimezone", "departureInstant",
                "arrivalDate", "arrivalTime", "arrivalTimezone", "arrivalInstant")
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'Synthetic Air', 'SA101', 'LIS', 'OPO',
                     '2026-12-01', '10:00:00', 'Europe/Lisbon', '2026-12-01T10:00:00.000Z',
                     '2026-12-01', '12:00:00', 'Europe/Lisbon', '2026-12-01T12:00:00.000Z')`,
            [agencyId, tripId, flightId],
          );
          await client.query(
            `INSERT INTO "trip_ops"."accommodation_item_detail"
               ("agencyId", "tripId", "itemId", "propertyName",
                "checkInDate", "checkInTime", "checkInTimezone", "checkInInstant",
                "checkOutDate", "checkOutTime", "checkOutTimezone", "checkOutInstant")
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'Synthetic Hotel',
                     '2026-12-01', '15:00:00', 'Europe/Lisbon', '2026-12-01T15:00:00.000Z',
                     '2026-12-02', '10:00:00', 'Europe/Lisbon', '2026-12-02T10:00:00.000Z')`,
            [agencyId, tripId, accommodationId],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
      });
      await createRestrictedRole();
      restrictedPersistence = createPostgresPersistence<Record<string, never>>({
        host,
        port,
        database: workspaceDatabase,
        user: roleName,
        tls: { mode: "DISABLED_LOOPBACK_ONLY" },
        applicationName: "travelos-workspace-workspace-least-privilege-test",
        maxConnections: 2,
      });

      const access = createStaffAccessRepository(restrictedPersistence);
      const snapshot = await access.getStaffAuthorizationSnapshot(staffPrincipalId, agencyId);
      expect(snapshot).not.toBeNull();
      if (snapshot === null) return;
      const nowEpochMs = Date.now();
      const authorization: StaffAuthorizationOperationProof = {
        session: {
          sessionId,
          staffPrincipalId,
          agencyId,
          authorizationEpoch: snapshot.authorizationEpoch,
          expiresAtEpochMs: nowEpochMs + 60 * 60 * 1_000,
          recentMfaVerifiedAtEpochMs: nowEpochMs,
        },
        requiredPermissionIds: ["trip.view"],
        nowEpochMs,
      };
      const workspaceRepository = createPostgresStaffTripWorkspaceRepository(restrictedPersistence);
      const page = await workspaceRepository.listTrips(agencyId, 50, null, authorization);
      expect(page.items.some((trip) => trip.id === tripId)).toBe(true);
      expect(page.items.every((trip) => trip.agencyId === agencyId)).toBe(true);
      const workspace = await workspaceRepository.readTripWorkspace(
        agencyId,
        asOpaqueId(tripId),
        authorization,
      );
      expect(workspace).toMatchObject({
        trip: { id: tripId, agencyId, title: "Workspace restricted workspace Trip" },
        flights: [{ id: flightId, flightNumber: "SA101" }],
        accommodations: [{ id: accommodationId, propertyName: "Synthetic Hotel" }],
      });
      expect(
        await workspaceRepository.readTripWorkspace(agencyId, randomUUID(), authorization),
      ).toBeNull();
      await expect(
        workspaceRepository.readTripWorkspace(randomUUID(), tripId, authorization),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        workspaceRepository.readTripWorkspace(agencyId, asOpaqueId(tripId), {
          ...authorization,
          requiredPermissionIds: ["trip.access.manage"],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const privilegeClient = new Client({
        host,
        port,
        database: workspaceDatabase,
        user: roleName,
        ssl: false,
      });
      await privilegeClient.connect();
      try {
        const privileges = await privilegeClient.query<{
          readonly customer: boolean;
          readonly person: boolean;
          readonly customerPerson: boolean;
          readonly traveller: boolean;
          readonly reservation: boolean;
          readonly cost: boolean;
        }>(
          `SELECT has_table_privilege(current_user, 'crm.customer', 'SELECT') AS customer,
                  has_table_privilege(current_user, 'crm.person', 'SELECT') AS person,
                  has_table_privilege(current_user, 'crm.customer_person', 'SELECT') AS "customerPerson",
                  has_table_privilege(current_user, 'trip_ops.trip_traveller', 'SELECT') AS traveller,
                  has_table_privilege(current_user, 'trip_ops.reservation', 'SELECT') AS reservation,
                  has_table_privilege(current_user, 'finance.supplier_cost_line', 'SELECT') AS cost`,
        );
        expect(privileges.rows).toEqual([
          {
            customer: false,
            person: false,
            customerPerson: false,
            traveller: false,
            reservation: false,
            cost: false,
          },
        ]);
      } finally {
        await privilegeClient.end();
      }

      const serializedWorkspace =
        JSON.stringify(workspace, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ) ?? "";
      expect(serializedWorkspace).not.toContain("INTERNAL_ONLY");
      expect(serializedWorkspace).not.toContain("supplierCosts");
      const piiTrip = await databaseModule
        .createPostgresStaffTripOperations(persistence!, resolver)
        .createTripWorkspace(cookie, {
          customer: { displayName: "Workspace PII Customer" },
          primaryTraveller: { givenName: "Pii", familyName: "Traveller" },
          trip: { title: "Workspace PII Trip", startDate: "2026-12-01", endDate: "2026-12-02" },
        });
      const piiBearingTrip = await workspaceRepository.readTripWorkspace(
        agencyId,
        asOpaqueId(piiTrip.id),
        authorization,
      );
      expect(piiBearingTrip).not.toBeNull();
      const serializedPiiBearingTrip =
        JSON.stringify(piiBearingTrip, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ) ?? "";
      expect(serializedPiiBearingTrip).not.toContain("Workspace PII Customer");
      expect(serializedPiiBearingTrip).not.toContain('"familyName":"Traveller"');

      const appOperations = createStaffTripWorkspaceOperations({
        repository: workspaceRepository,
        authorizationRepository: access,
        sessionResolver: resolver,
      });
      expect((await appOperations.readTripWorkspace(cookie, asOpaqueId(tripId)))?.trip.id).toBe(
        tripId,
      );
    } finally {
      await restrictedPersistence?.destroy();
      await withOwnerLogin(workspaceDatabase, async (client) => {
        await client.query("BEGIN");
        try {
          await client.query(
            `DELETE FROM "trip_ops"."itinerary_item" WHERE "agencyId" = $1::uuid AND "tripId" = $2::uuid`,
            [agencyId, tripId],
          );
          await client.query(
            `DELETE FROM "trip_ops"."trip_traveller" WHERE "agencyId" = $1::uuid AND "tripId" = $2::uuid`,
            [agencyId, tripId],
          );
          await client.query(
            `DELETE FROM "trip_ops"."trip" WHERE "agencyId" = $1::uuid AND "id" = $2::uuid`,
            [agencyId, tripId],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
      });
      if (roleCreated) {
        const client = new Client({
          host,
          port,
          database: workspaceDatabase,
          user: "postgres",
          ssl: false,
        });
        await client.connect();
        try {
          await client.query(`DROP OWNED BY ${quotedRole}`);
          await client.query(`DROP ROLE ${quotedRole}`);
        } finally {
          await client.end();
        }
      }
    }
  });
});
