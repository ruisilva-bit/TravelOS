import { createHash } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asOpaqueId,
  createMoney,
  createPublicShareOperations,
  createScheduledLocalDateTime,
  createStaffTripOperations,
  decodeShareToken,
  IdempotencyConflictError,
  ShareLinkNotFoundError,
  TripPublicationNotFoundError,
  type CreateTripSliceInput,
  type PublicShareOperations,
  type StaffShareLinkOperations,
  type StaffTripOperations,
  type StaffTripPreviewOperations,
  type TripSnapshotV1,
} from "@travelos/backend-core";
import {
  createPostgresPublicShareReader,
  createPostgresStaffShareLinkOperations,
  createPostgresStaffTripPreviewOperations,
  createShareTokenCrypto,
  createStaffAccessRepository,
  createUuidV7,
  type PostgresPersistence,
} from "@travelos/database";
import { renderSharePage } from "../../apps/admin-api/src/share-page-renderer.js";
import { createOperationalSliceRepository } from "../../packages/database/src/trip-operations/operational-slice-repository.js";
import { TripSnapshotV1Schema } from "../../packages/contracts/src/share/index.js";
import {
  clientFor,
  createAdminPersistence,
  createDatabase,
  createOwnerClient,
  createStaff,
  migrateToHead,
  queryAs,
  queryErrorCode,
  registrySessionResolver,
  requireHarness,
  type StaffFixture,
  type StaffSessionRegistry,
} from "./helpers/postgres.js";

const databaseName = "travelos_share_links";
const agencyId = asOpaqueId("00000000-0000-7000-8000-000000000001");
const otherAgencyId = "019b0000-0000-7000-8000-000000000003";
const publicOrigin = "https://admin.example.test";
const SENTINELS = ["INTERNAL_ONLY SENTINEL - never publish", "Synthetic Supplier", "12345"];

let persistence: PostgresPersistence<Record<string, never>>;
let owner: Client;
let staff: StaffFixture;
let outsider: StaffFixture;
let staffOperations: StaffTripOperations;
let previewOperations: StaffTripPreviewOperations;
let shareOperations: StaffShareLinkOperations;
let publicOperations: PublicShareOperations;
let slice: Awaited<ReturnType<StaffTripOperations["createTripSlice"]>>;
let supplierReference = "";
const sessions: StaffSessionRegistry = new Map();
const validator = { validate: (value: unknown) => void TripSnapshotV1Schema.parse(value) };

const tripInput = (): CreateTripSliceInput => ({
  agencyId,
  person: {
    givenName: "Synthetic",
    familyName: "Traveller",
    email: `traveller-${createUuidV7()}@example.test`,
  },
  customer: { displayName: "Synthetic Publication Customer" },
  customerPersonRole: "PRIMARY_CONTACT",
  trip: {
    title: "Publication Synthetic Trip",
    startDate: "2026-10-12",
    endDate: "2026-10-15",
    state: "DRAFT",
  },
  travellerRole: "PRIMARY_TRAVELLER",
  flight: {
    title: "Outbound flight",
    description: "Synthetic flight description",
    carrier: "Example Air",
    flightNumber: "EA100",
    departureAirport: "LIS",
    arrivalAirport: "OPO",
    departure: createScheduledLocalDateTime({
      localDate: "2026-10-12",
      localTime: "09:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-10-12T08:00:00Z",
    }),
    arrival: createScheduledLocalDateTime({
      localDate: "2026-10-12",
      localTime: "10:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-10-12T09:00:00Z",
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
      localDate: "2026-10-12",
      localTime: "15:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-10-12T14:00:00Z",
    }),
    checkOut: createScheduledLocalDateTime({
      localDate: "2026-10-15",
      localTime: "11:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-10-15T10:00:00Z",
    }),
    roomDescription: "Double room",
    boardType: "BREAKFAST",
    customerBookingReference: "SYNTH-HOTEL-1",
  },
  reservation: {
    supplierName: "Synthetic Supplier",
    supplierReference: `${supplierReference}`,
    customerBookingReference: "SYNTH-RES-1",
    state: "CONFIRMED",
  },
  supplierCost: {
    amount: createMoney("12345", "EUR", 2),
    internalNote: "INTERNAL_ONLY SENTINEL - never publish",
  },
});

const count = async (statement: string): Promise<number> =>
  Number((await owner.query<{ count: string }>(statement)).rows[0]?.count ?? "-1");

const counts = async () => ({
  versions: await count('SELECT count(*)::text AS count FROM "trip_ops"."publication_version"'),
  snapshots: await count('SELECT count(*)::text AS count FROM "trip_ops"."publication_snapshot"'),
  links: await count('SELECT count(*)::text AS count FROM "trip_ops"."share_link"'),
  pointers: await count('SELECT count(*)::text AS count FROM "trip_ops"."publication_pointer"'),
  events: await count('SELECT count(*)::text AS count FROM "trip_ops"."publication_event"'),
  outbox: await count(
    'SELECT count(*)::text AS count FROM "integration"."trip_publication_outbox"',
  ),
  lockGeneration: await count(
    'SELECT COALESCE(sum("generation"), 0)::text AS count FROM "trip_ops"."publication_lock"',
  ),
});

const share = (key: string, expiresInDays?: number, cookie = staff.cookie, trip = slice.trip.id) =>
  shareOperations.createShareLink(cookie, trip, {
    idempotencyKey: key,
    ...(expiresInDays === undefined ? {} : { expiresInDays }),
  });

const tokenOf = (url: string): string => url.slice(`${publicOrigin}/v/`.length);

const readPublic = (token: string): Promise<TripSnapshotV1> =>
  publicOperations.readPublicShare(token);

const functionRows = async (user: string, tokenHash: Buffer) => {
  const client = await clientFor(user, databaseName);
  try {
    return (
      await client.query('SELECT * FROM "trip_ops"."read_share_snapshot"($1::bytea)', [tokenHash])
    ).rows;
  } finally {
    await client.end();
  }
};

const hashOf = (token: string): Buffer => {
  const bytes = decodeShareToken(token);
  if (bytes === null) throw new Error("Token has an invalid shape");
  return createHash("sha256").update(bytes).digest();
};

const withTriggersDisabled = async (work: () => Promise<void>): Promise<void> => {
  await owner.query(
    'ALTER TABLE "trip_ops"."share_link" DISABLE TRIGGER "share_link_row_guard_trigger"',
  );
  try {
    await work();
  } finally {
    await owner.query(
      'ALTER TABLE "trip_ops"."share_link" ENABLE TRIGGER "share_link_row_guard_trigger"',
    );
  }
};

beforeAll(async () => {
  requireHarness();
  supplierReference = `SUP-${createUuidV7()}`;
  createDatabase(databaseName);
  const migrated = await migrateToHead(databaseName, {
    agencyId,
    bootstrapReference: "share-link-qualification",
    slug: "share-link-qualification",
  });
  persistence = createAdminPersistence(databaseName, "travelos-share-links", 8);
  owner = await createOwnerClient(databaseName);
  staff = await createStaff(owner, sessions, "share-owner", [], {
    agencyId,
    roleId: migrated.ownerRoleId,
    recentMfa: true,
  });
  await owner.query('DROP INDEX "organization"."agency_single_root_idx"');
  await owner.query(
    `INSERT INTO organization.agency (id, "bootstrapReference", slug) VALUES ($1::uuid, 'share-other', 'share-other')`,
    [otherAgencyId],
  );
  outsider = await createStaff(
    owner,
    sessions,
    "share-outsider",
    ["trip.view", "trip.preview", "trip.publish"],
    { agencyId: otherAgencyId, recentMfa: true },
  );
  const resolver = registrySessionResolver(sessions);
  staffOperations = createStaffTripOperations({
    repository: createOperationalSliceRepository(persistence),
    authorizationRepository: createStaffAccessRepository(persistence),
    sessionResolver: resolver,
  });
  slice = await staffOperations.createTripSlice(staff.cookie, tripInput());
  previewOperations = createPostgresStaffTripPreviewOperations(persistence, resolver, validator);
  shareOperations = createPostgresStaffShareLinkOperations(
    persistence,
    resolver,
    validator,
    publicOrigin,
  );
  publicOperations = createPublicShareOperations({
    reader: createPostgresPublicShareReader(persistence),
    crypto: createShareTokenCrypto(),
    parseSnapshot: (value) => TripSnapshotV1Schema.parse(value) as TripSnapshotV1,
  });
});

afterAll(async () => {
  await owner?.end();
  await persistence?.destroy();
});

describe.sequential("Share links on PostgreSQL", () => {
  it("proves Preview is read-only", async () => {
    const before = await counts();
    const first = await previewOperations.previewTrip(staff.cookie, slice.trip.id);
    const second = await previewOperations.previewTrip(staff.cookie, slice.trip.id);
    expect(first).toEqual(second);
    expect(first.projection.items.map((item) => item.kind)).toEqual(["FLIGHT", "ACCOMMODATION"]);
    expect(JSON.stringify(first.projection)).not.toContain("INTERNAL_ONLY SENTINEL");
    expect(await counts()).toEqual(before);
    expect(before).toMatchObject({ versions: 0, snapshots: 0, links: 0, lockGeneration: 0 });
  });

  it("stores only the 32-byte token hash, never the token, and reads the frozen page", async () => {
    const created = await share("share-first");
    const token = tokenOf(created.url);
    expect(token).toBe(created.token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const row = (
      await owner.query<{ hashHex: string; length: number }>(
        `SELECT encode("tokenHash", 'hex') AS "hashHex", octet_length("tokenHash") AS length
           FROM "trip_ops"."share_link" WHERE "shareLinkId" = $1::uuid`,
        [created.shareLinkId],
      )
    ).rows[0];
    expect(row?.length).toBe(32);
    expect(row?.hashHex).toBe(hashOf(token).toString("hex"));
    for (const table of [
      "share_link",
      "publication_version",
      "publication_snapshot",
      "publication_idempotency",
    ]) {
      const text = (
        await owner.query<{ text: string }>(
          `SELECT t::text AS text FROM "trip_ops"."${table}" AS t`,
        )
      ).rows
        .map((entry) => entry.text)
        .join("\n");
      expect(text).not.toContain(token);
    }
    const snapshot = await readPublic(token);
    expect(snapshot.items.map((item) => item.kind)).toEqual(["FLIGHT", "ACCOMMODATION"]);
    expect(snapshot.trip.title).toBe("Publication Synthetic Trip");
  });

  it("keeps INTERNAL_ONLY values out of the stored payload and the rendered page", async () => {
    const created = await share("share-internal-only");
    const rows = await functionRows("travelos_admin_api", hashOf(created.token));
    expect(rows).toHaveLength(1);
    const payload = String((rows[0] as { canonicalPayload: string }).canonicalPayload);
    const html = renderSharePage(await readPublic(created.token));
    for (const sentinel of [...SENTINELS, supplierReference]) {
      expect(payload).not.toContain(sentinel);
      expect(html).not.toContain(sentinel);
    }
    expect(html).toContain("Example Hotel");
  });

  it("freezes snapshots: later edits change only newly shared links", async () => {
    const before = await share("share-immutable-old");
    const oldTitle = (await readPublic(before.token)).items[1]?.title;
    expect(oldTitle).toBe("Synthetic hotel");
    const accommodation = slice.accommodations[0];
    if (accommodation === undefined) throw new Error("Synthetic accommodation missing");
    await staffOperations.updateAccommodation(staff.cookie, {
      agencyId,
      tripId: slice.trip.id,
      itemId: accommodation.id,
      expectedLockVersion: accommodation.lockVersion,
      title: "Synthetic hotel v2",
      description: "Updated synthetic presentation",
    });
    const after = await share("share-immutable-new");
    expect((await readPublic(before.token)).items[1]?.title).toBe("Synthetic hotel");
    expect((await readPublic(after.token)).items[1]?.title).toBe("Synthetic hotel v2");
    const versions = (
      await owner.query<{ version: number }>(
        `SELECT "version" FROM "trip_ops"."publication_version" WHERE "tripId" = $1::uuid ORDER BY 1`,
        [slice.trip.id],
      )
    ).rows.map((entry) => entry.version);
    expect(versions).toEqual([...versions.keys()].map((index) => index + 1));
  });

  it("lists links without a token or hash, with computed state", async () => {
    const links = await shareOperations.listShareLinks(staff.cookie, slice.trip.id);
    expect(links.length).toBeGreaterThanOrEqual(3);
    expect(links.every((link) => link.state === "ACTIVE")).toBe(true);
    const text = JSON.stringify(links);
    expect(text).not.toMatch(/token/iu);
    expect(Object.keys(links[0] ?? {}).toSorted()).toEqual(
      ["createdAt", "createdBy", "expiresAt", "revokedAt", "shareLinkId", "state"].toSorted(),
    );
  });

  it("honours revocation (idempotent) and expiry in read_share_snapshot", async () => {
    const created = await share("share-revoke");
    const hash = hashOf(created.token);
    expect(await functionRows("travelos_admin_api", hash)).toHaveLength(1);
    await shareOperations.revokeShareLink(staff.cookie, created.shareLinkId);
    await shareOperations.revokeShareLink(staff.cookie, created.shareLinkId);
    expect(await functionRows("travelos_admin_api", hash)).toHaveLength(0);
    await expect(readPublic(created.token)).rejects.toBeInstanceOf(ShareLinkNotFoundError);
    const listed = (await shareOperations.listShareLinks(staff.cookie, slice.trip.id)).find(
      (link) => link.shareLinkId === created.shareLinkId,
    );
    expect(listed?.state).toBe("REVOKED");

    const expiring = await share("share-expire", 1);
    expect(await functionRows("travelos_admin_api", hashOf(expiring.token))).toHaveLength(1);
    await withTriggersDisabled(async () => {
      await owner.query(
        `UPDATE "trip_ops"."share_link"
            SET "createdAt" = now() - interval '10 days', "expiresAt" = now() - interval '1 second'
          WHERE "shareLinkId" = $1::uuid`,
        [expiring.shareLinkId],
      );
    });
    expect(await functionRows("travelos_admin_api", hashOf(expiring.token))).toHaveLength(0);
    await expect(readPublic(expiring.token)).rejects.toBeInstanceOf(ShareLinkNotFoundError);
    expect(
      (await shareOperations.listShareLinks(staff.cookie, slice.trip.id)).find(
        (link) => link.shareLinkId === expiring.shareLinkId,
      )?.state,
    ).toBe("EXPIRED");
    expect(await functionRows("travelos_admin_api", Buffer.alloc(32, 7))).toHaveLength(0);
  });

  it("enforces validity bounds in the use-case and the database", async () => {
    await expect(share("share-too-long", 366)).rejects.toMatchObject({
      code: "INVALID_SHARE_LINK_REQUEST",
    });
    await expect(share("share-zero", 0)).rejects.toMatchObject({
      code: "INVALID_SHARE_LINK_REQUEST",
    });
    const longest = await share("share-365", 365);
    const span = (
      await owner.query<{ days: number }>(
        `SELECT extract(epoch FROM ("expiresAt" - "createdAt")) / 86400 AS days
           FROM "trip_ops"."share_link" WHERE "shareLinkId" = $1::uuid`,
        [longest.shareLinkId],
      )
    ).rows[0];
    expect(Math.round(span?.days ?? 0)).toBe(365);
    expect(
      await queryErrorCode(() =>
        owner.query(
          `INSERT INTO "trip_ops"."share_link"
             ("shareLinkId", "agencyId", "tripId", "publicationId", "tokenHash",
              "createdByStaffPrincipalId", "idempotencyKey", "expiresAt")
           SELECT gen_random_uuid(), "agencyId", "tripId", "publicationId", decode(md5(random()::text) || md5(random()::text), 'hex'),
                  'x', 'bound-check', now() + interval '400 days'
             FROM "trip_ops"."share_link" LIMIT 1`,
        ),
      ),
    ).toBe("23514");
  });

  it("isolates other agencies: create, list and revoke are NOT_FOUND", async () => {
    const mine = await share("share-isolation");
    await expect(share("outsider-create", undefined, outsider.cookie)).rejects.toBeInstanceOf(
      TripPublicationNotFoundError,
    );
    await expect(
      shareOperations.listShareLinks(outsider.cookie, slice.trip.id),
    ).rejects.toBeInstanceOf(TripPublicationNotFoundError);
    await expect(
      shareOperations.revokeShareLink(outsider.cookie, mine.shareLinkId),
    ).rejects.toBeInstanceOf(ShareLinkNotFoundError);
    expect(await readPublic(mine.token)).toBeDefined();
  });

  it("requires authentication, permissions and recent MFA to create; MFA is not needed to revoke", async () => {
    await expect(
      createPostgresStaffShareLinkOperations(
        persistence,
        { resolveStaffSession: async () => null },
        validator,
        publicOrigin,
      ).createShareLink("none", slice.trip.id, { idempotencyKey: "anon" }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const target = await share("share-mfa-target");
    await owner.query(
      `UPDATE "staff_access"."staff_session_context"
          SET "recentMfaVerifiedAt" = now() - interval '2 hours' WHERE "sessionId" = $1`,
      [staff.sessionId],
    );
    try {
      await expect(share("share-stale-mfa")).rejects.toMatchObject({ code: "FORBIDDEN" });
      await shareOperations.revokeShareLink(staff.cookie, target.shareLinkId);
    } finally {
      await owner.query(
        `UPDATE "staff_access"."staff_session_context"
            SET "recentMfaVerifiedAt" = now() WHERE "sessionId" = $1`,
        [staff.sessionId],
      );
    }

    const roleId = (
      await owner.query<{ roleId: string }>(
        `SELECT a."roleId"::text AS "roleId" FROM "staff_access"."role_assignment" a
           WHERE a."membershipId" = $1::uuid`,
        [outsider.membershipId],
      )
    ).rows[0]?.roleId;
    await owner.query(
      `DELETE FROM "staff_access"."role_permission" WHERE "roleId" = $1::uuid AND "permissionId" = 'trip.preview'`,
      [roleId],
    );
    await expect(
      previewOperations.previewTrip(outsider.cookie, slice.trip.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("makes concurrent creation with one idempotency key yield exactly one link", async () => {
    const results = await Promise.allSettled([
      share("share-concurrent"),
      share("share-concurrent"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
      IdempotencyConflictError,
    );
    expect(
      await count(
        `SELECT count(*)::text AS count FROM "trip_ops"."share_link" WHERE "idempotencyKey" = 'share-concurrent'`,
      ),
    ).toBe(1);
    await expect(share("share-concurrent")).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("rolls back version, snapshot and link together when the link insert fails", async () => {
    const before = await counts();
    await owner.query(
      `CREATE FUNCTION "trip_ops"."share_reject_link"() RETURNS trigger
         LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'share rollback probe'; END $$;
       CREATE TRIGGER "share_reject_link" BEFORE INSERT ON "trip_ops"."share_link"
         FOR EACH ROW EXECUTE FUNCTION "trip_ops"."share_reject_link"()`,
    );
    try {
      await expect(share("share-rollback")).rejects.toThrow();
    } finally {
      await owner.query(
        `DROP TRIGGER "share_reject_link" ON "trip_ops"."share_link";
         DROP FUNCTION "trip_ops"."share_reject_link"()`,
      );
    }
    expect(await counts()).toEqual(before);
  });

  it("does not write pointer, event or outbox rows any more", async () => {
    const totals = await counts();
    expect(totals.pointers).toBe(0);
    expect(totals.events).toBe(0);
    expect(totals.outbox).toBe(0);
    expect(totals.versions).toBe(totals.links);
  });

  it("allows only revokedAt NULL to a value; blocks other updates, DELETE and TRUNCATE", async () => {
    const created = await share("share-trigger");
    const id = created.shareLinkId;
    const owned = (statement: string) => queryErrorCode(() => owner.query(statement));
    expect(
      await owned(
        `UPDATE "trip_ops"."share_link" SET "expiresAt" = "expiresAt" + interval '1 day' WHERE "shareLinkId" = '${id}'`,
      ),
    ).toBe("55000");
    expect(
      await owned(
        `UPDATE "trip_ops"."share_link" SET "revokedAt" = now(), "idempotencyKey" = 'changed' WHERE "shareLinkId" = '${id}'`,
      ),
    ).toBe("55000");
    expect(await owned(`DELETE FROM "trip_ops"."share_link" WHERE "shareLinkId" = '${id}'`)).toBe(
      "55000",
    );
    expect(await owned(`TRUNCATE "trip_ops"."share_link"`)).toBe("55000");
    expect(
      await owned(
        `UPDATE "trip_ops"."share_link" SET "revokedAt" = now() WHERE "shareLinkId" = '${id}'`,
      ),
    ).toBeNull();
    expect(
      await owned(
        `UPDATE "trip_ops"."share_link" SET "revokedAt" = NULL WHERE "shareLinkId" = '${id}'`,
      ),
    ).toBe("55000");
    expect(
      await owned(
        `UPDATE "trip_ops"."share_link" SET "revokedAt" = now() + interval '1 day' WHERE "shareLinkId" = '${id}'`,
      ),
    ).toBe("55000");
  });

  it("limits privileges: admin may only revoke; the worker has no access at all", async () => {
    const admin = (statement: string) =>
      queryErrorCode(() => queryAs("travelos_admin_api", statement, databaseName));
    const worker = (statement: string) =>
      queryErrorCode(() => queryAs("travelos_worker", statement, databaseName));
    expect(
      await admin(`UPDATE "trip_ops"."share_link" SET "expiresAt" = now() + interval '2 days'`),
    ).toBe("42501");
    expect(
      await admin(
        `UPDATE "trip_ops"."share_link" SET "tokenHash" = decode(md5(random()::text) || md5(random()::text), 'hex')`,
      ),
    ).toBe("42501");
    expect(await admin(`DELETE FROM "trip_ops"."share_link"`)).toBe("42501");
    expect(await admin(`TRUNCATE "trip_ops"."share_link"`)).toBe("42501");
    expect(await worker(`SELECT 1 FROM "trip_ops"."share_link"`)).toBe("42501");
    expect(
      await worker(
        `SELECT * FROM "trip_ops"."read_share_snapshot"(decode(repeat('00', 32), 'hex'))`,
      ),
    ).toBe("42501");
    const privileges = (
      await owner.query<{ role: string; execute: boolean }>(
        `SELECT r AS role, has_function_privilege(r, 'trip_ops.read_share_snapshot(bytea)', 'EXECUTE') AS execute
           FROM unnest(ARRAY['travelos_admin_runtime', 'travelos_worker_runtime', 'public']) AS r`,
      )
    ).rows;
    expect(Object.fromEntries(privileges.map((entry) => [entry.role, entry.execute]))).toEqual({
      travelos_admin_runtime: true,
      travelos_worker_runtime: false,
      public: false,
    });
    const definer = (
      await owner.query<{ secdef: boolean; config: string[] | null; owner: string }>(
        `SELECT p.prosecdef AS secdef, p.proconfig AS config, pg_get_userbyid(p.proowner) AS owner
           FROM pg_proc p WHERE p.oid = 'trip_ops.read_share_snapshot(bytea)'::regprocedure`,
      )
    ).rows[0];
    expect(definer?.secdef).toBe(true);
    expect(definer?.owner).toBe("travelos_owner");
    expect(definer?.config).toEqual(["search_path=pg_catalog, pg_temp"]);
  });

  it("keeps snapshots and versions immutable and the publication lock closed to the admin role", async () => {
    const version = (
      await owner.query<{ publicationId: string }>(
        `SELECT "publicationId"::text AS "publicationId" FROM "trip_ops"."publication_version" LIMIT 1`,
      )
    ).rows[0]?.publicationId;
    if (version === undefined) throw new Error("No stored publication version");
    const admin = (statement: string) =>
      queryErrorCode(() => queryAs("travelos_admin_api", statement, databaseName));
    expect(
      await admin(
        `UPDATE "trip_ops"."publication_snapshot" SET "canonicalPayload"='{}' WHERE "publicationId"='${version}'::uuid`,
      ),
    ).toBe("42501");
    expect(
      await admin(
        `DELETE FROM "trip_ops"."publication_version" WHERE "publicationId"='${version}'::uuid`,
      ),
    ).toBe("42501");
    expect(
      await admin(`UPDATE "trip_ops"."publication_lock" SET "generation"="generation"+1`),
    ).toBe("42501");
    expect(
      await queryErrorCode(() =>
        owner.query(
          `UPDATE "trip_ops"."publication_snapshot" SET "canonicalPayload"='{}' WHERE "publicationId"='${version}'::uuid`,
        ),
      ),
    ).toBe("55000");
  });
});
