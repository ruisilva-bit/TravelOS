import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { sql } from "kysely";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  StaffInvitationAcceptanceRejectedError,
  TRIP_OPERATIONS_ROLE_TEMPLATE_KEY,
  PERMISSION_REGISTRY_VERSION,
  asOpaqueId,
  authorizeStaffRequest,
  bootstrapRootAgency,
  type StaffAuthorizationOperationProof,
  type StaffIdentityEnrollmentPort,
  type StaffInvitationRecord,
  type StaffInvitationRepository,
} from "@travelos/backend-core";
import * as authAdapterExports from "../../packages/auth-adapters/src/index.js";
import {
  createLocalOperatorStaffEnrollmentRealm,
  createOneTimeOperatorToken,
  createStaffAuthRealm,
  createStaffInvitationToken,
  digestOneTimeOperatorToken,
  digestStaffInvitationToken,
  dispatchAuthRealmRequest,
  STAFF_AUTH_BASE_PATH,
  type AuthRealm,
  type AuthRealmConfiguration,
} from "../../packages/auth-adapters/src/index.js";
import {
  createStaffAccessRepository,
  createUuidV7,
  type PostgresPersistence,
  type StaffAccessRepository,
} from "../../packages/database/src/index.js";
import * as databaseExports from "../../packages/database/src/index.js";
import {
  createAdminPersistence,
  createDatabase,
  createOwnerClient,
  host,
  migrateToHead,
  port,
  queryAs as queryAsIn,
  queryAsOwner as queryAsOwnerIn,
  queryErrorCode,
  repositoryRoot,
  requireHarness,
  type MigratedDatabase,
} from "./helpers/postgres.js";

type Persistence = PostgresPersistence<Record<string, never>>;

const repositoryRequire = createRequire(
  path.join(repositoryRoot, "packages/auth-adapters/package.json"),
);
const betterAuthRequire = createRequire(repositoryRequire.resolve("better-auth"));
const { createOTP } = (await import(betterAuthRequire.resolve("@better-auth/utils/otp"))) as {
  createOTP(secret: string): { totp(): Promise<string> };
};
const { base32 } = (await import(betterAuthRequire.resolve("@better-auth/utils/base32"))) as {
  base32: { decode(input: string): Uint8Array };
};

// ---------------------------------------------------------------------------------------------
// Staff authentication, MFA, authorization epochs and last-Owner protection.
// ---------------------------------------------------------------------------------------------
const authDatabase = "travelos_staff_auth";
const staffOrigin = "http://admin.travelos.test";
const foreignOrigin = "http://other.travelos.test";
const syntheticRealmKey = createHash("sha512")
  .update("travelos-staff-auth-disposable-realm-key")
  .digest("base64url");
const syntheticCredential = createHash("sha512")
  .update("travelos-staff-auth-disposable-password")
  .digest("base64url");
const rootAgencySeed = {
  agencyId: "019b0000-0000-7000-8000-0000000000b1",
  bootstrapReference: "agency-bootstrap:staff-auth",
  slug: "staff-auth",
} as const;

describe.sequential("Staff authentication and authorization", () => {
  let adminPersistence: Persistence | null = null;
  let repository: StaffAccessRepository;
  let staffRealm: AuthRealm;
  let enrollmentRealm: AuthRealm;
  let migrated: MigratedDatabase;
  let rootAgencyId = "";
  let ownerPrincipalId = "";
  let invitationToken = createOneTimeOperatorToken();
  let recoveryCode = "";
  let currentStaffCookie = "";

  const queryAs = <Row extends Record<string, unknown>>(user: string, statement: string) =>
    queryAsIn<Row>(user, statement, authDatabase);
  const queryAsOwner = <Row extends Record<string, unknown>>(statement: string) =>
    queryAsOwnerIn<Row>(statement, authDatabase);

  beforeAll(async () => {
    requireHarness();
    createDatabase(authDatabase);
    migrated = await migrateToHead(authDatabase, rootAgencySeed);
    adminPersistence = createAdminPersistence<Record<string, never>>(
      authDatabase,
      "travelos-staff-auth-admin",
      5,
    );
    repository = createStaffAccessRepository(adminPersistence);
    const database = await adminPersistence.withConnection(async (connection) => connection);
    staffRealm = createStaffAuthRealm({
      database,
      canonicalOrigin: staffOrigin,
      realmKeyMaterial: syntheticRealmKey,
      environment: "DEVELOPMENT",
    });
    enrollmentRealm = createLocalOperatorStaffEnrollmentRealm({
      database,
      canonicalOrigin: staffOrigin,
      realmKeyMaterial: syntheticRealmKey,
      environment: "DEVELOPMENT",
    });
  });

  afterAll(async () => {
    await adminPersistence?.destroy();
  });

  const cookieHeaderFor = (response: Response): string => {
    const extendedHeaders = response.headers as Headers & {
      readonly getSetCookie?: () => string[];
    };
    const values =
      extendedHeaders.getSetCookie?.() ??
      [response.headers.get("set-cookie")].flatMap((value) => (value === null ? [] : [value]));
    return values
      .flatMap((value) => {
        const cookie = value.split(";", 1)[0];
        return cookie === undefined || cookie.length === 0 ? [] : [cookie];
      })
      .join("; ");
  };

  const authRequest = async (
    realm: AuthRealm,
    origin: string,
    pathSuffix: string,
    body: unknown,
    cookie?: string,
  ): Promise<Response> =>
    realm.handle(
      new Request(new URL(`${realm.basePath}${pathSuffix}`, origin), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          ...(cookie === undefined ? {} : { cookie }),
        },
        body: JSON.stringify(body),
      }),
    );

  const currentOwnerSession = async () => {
    const session = await staffRealm.getServerSession(
      new Request(staffOrigin, { headers: { cookie: currentStaffCookie } }),
    );
    expect(session).not.toBeNull();
    return session!;
  };

  it("serializes one root Agency, keeps bootstrap idempotent and stores only the first Owner invitation digest", async () => {
    rootAgencyId = migrated.rootAgency.agencyId;
    expect(migrated.rootAgency.created).toBe(true);
    expect(migrated.rootAgency.permissionRegistryVersion).toBe(PERMISSION_REGISTRY_VERSION);
    const rerun = await bootstrapRootAgency(repository, {
      agencyId: createUuidV7(),
      bootstrapReference: rootAgencySeed.bootstrapReference,
      slug: rootAgencySeed.slug,
    });
    expect(rerun).toMatchObject({
      agencyId: rootAgencyId,
      created: false,
      ownerRoleId: migrated.rootAgency.ownerRoleId,
      permissionRegistryVersion: PERMISSION_REGISTRY_VERSION,
    });
    const issuance = await repository.issueFirstOwnerInvitation({
      agencyId: rootAgencyId,
      targetEmail: "owner.staff-auth@example.test",
      tokenDigest: invitationToken.digest,
      expiresAt: new Date(Date.now() + 60_000),
      operatorIdentity: "TEST_LOCAL_OPERATOR",
    });
    expect(issuance.result).toBe("ISSUED");
    expect(await repository.inspectFirstOwnerInvitation(invitationToken.digest)).toMatchObject({
      result: "VALID",
      agencyId: rootAgencyId,
      targetEmail: "owner.staff-auth@example.test",
    });
    const rows = await queryAsOwner<{ readonly rootCount: string; readonly tokenDigest: string }>(`
      SELECT (SELECT count(*)::text FROM "organization"."agency") AS "rootCount",
             (SELECT "tokenDigest" FROM "staff_access"."operator_bootstrap_invitation") AS "tokenDigest"
    `);
    expect(rows).toEqual([{ rootCount: "1", tokenDigest: invitationToken.digest }]);
    expect(rows[0]?.tokenDigest).not.toContain(invitationToken.rawToken);
  });

  it("enrolls the invited Owner through Better Auth, verifies the account and disables public Staff signup", async () => {
    const enrolled = await authRequest(enrollmentRealm, staffOrigin, "/sign-up/email", {
      email: "owner.staff-auth@example.test",
      name: "Staff Auth Owner",
      password: syntheticCredential,
    });
    expect(enrolled.status).toBe(200);
    ownerPrincipalId = (await repository.findStaffPrincipalIdByEmail(
      "owner.staff-auth@example.test",
    )) as string;
    expect(ownerPrincipalId).toMatch(/\S/u);
    const consumption = await repository.consumeFirstOwnerInvitation({
      tokenDigest: invitationToken.digest,
      staffPrincipalId: ownerPrincipalId,
      operatorIdentity: "TEST_LOCAL_OPERATOR",
    });
    expect(consumption).toMatchObject({ result: "CONSUMED", agencyId: rootAgencyId });
    const publicSignup = await authRequest(staffRealm, staffOrigin, "/sign-up/email", {
      email: "not-allowed@example.test",
      name: "Denied",
      password: syntheticCredential,
    });
    expect(publicSignup.status).toBeGreaterThanOrEqual(400);
    const rows = await queryAsOwner<{ readonly emailVerified: boolean }>(`
      SELECT "emailVerified" FROM "staff_access"."staff_user" WHERE "id" = '${ownerPrincipalId}'
    `);
    expect(rows).toEqual([{ emailVerified: true }]);
  });

  it("performs real TOTP enrollment, recovery-code login and records recent MFA server-side", async () => {
    const initialLogin = await authRequest(staffRealm, staffOrigin, "/sign-in/email", {
      email: "owner.staff-auth@example.test",
      password: syntheticCredential,
    });
    expect(initialLogin.status).toBe(200);
    const initialCookie = cookieHeaderFor(initialLogin);
    const enable = await authRequest(
      staffRealm,
      staffOrigin,
      "/two-factor/enable",
      { password: syntheticCredential },
      initialCookie,
    );
    expect(enable.status).toBe(200);
    const enabled = (await enable.json()) as {
      readonly totpURI: string;
      readonly backupCodes: readonly string[];
    };
    expect(enabled.backupCodes).toHaveLength(10);
    recoveryCode = enabled.backupCodes[0] ?? "";
    expect(recoveryCode).not.toBe("");
    const encodedSecret = new URL(enabled.totpURI).searchParams.get("secret");
    expect(encodedSecret).not.toBeNull();
    const secret = new TextDecoder().decode(base32.decode(encodedSecret!));
    const code = await createOTP(secret).totp();
    const verified = await authRequest(
      staffRealm,
      staffOrigin,
      "/two-factor/verify-totp",
      { code },
      initialCookie,
    );
    expect(verified.status).toBe(200);
    currentStaffCookie = cookieHeaderFor(verified);
    const totpSession = await currentOwnerSession();
    expect(totpSession).toMatchObject({
      principalId: ownerPrincipalId,
      agencyId: rootAgencyId,
      recentMfaVerifiedAtEpochMs: expect.any(Number),
    });

    const challenge = await authRequest(staffRealm, staffOrigin, "/sign-in/email", {
      email: "owner.staff-auth@example.test",
      password: syntheticCredential,
    });
    expect(challenge.status).toBe(200);
    expect((await challenge.json()) as unknown).toMatchObject({ twoFactorRedirect: true });
    const recovered = await authRequest(
      staffRealm,
      staffOrigin,
      "/two-factor/verify-backup-code",
      { code: recoveryCode },
      cookieHeaderFor(challenge),
    );
    expect(recovered.status).toBe(200);
    currentStaffCookie = cookieHeaderFor(recovered);
    const recoverySession = await currentOwnerSession();
    expect(recoverySession.recentMfaVerifiedAtEpochMs).toEqual(expect.any(Number));

    const reusedChallenge = await authRequest(staffRealm, staffOrigin, "/sign-in/email", {
      email: "owner.staff-auth@example.test",
      password: syntheticCredential,
    });
    const reused = await authRequest(
      staffRealm,
      staffOrigin,
      "/two-factor/verify-backup-code",
      { code: recoveryCode },
      cookieHeaderFor(reusedChallenge),
    );
    expect(reused.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects stale authorization epochs, missing/inactive memberships and wrong Agency proofs", async () => {
    const ownerSession = await currentOwnerSession();
    const before = await repository.getStaffAuthorizationSnapshot(ownerPrincipalId, rootAgencyId);
    expect(before).not.toBeNull();
    const membership = await queryAsOwner<{ readonly id: string }>(`
      SELECT "id"::text AS "id" FROM "staff_access"."staff_membership"
       WHERE "staffPrincipalId" = '${ownerPrincipalId}'
    `);
    const membershipId = membership[0]?.id;
    expect(membershipId).toBeDefined();
    const roleId = createUuidV7();
    await queryAsOwner(`
      INSERT INTO "staff_access"."role" ("id", "agencyId", "displayName")
      VALUES ('${roleId}'::uuid, '${rootAgencyId}'::uuid, 'Epoch Probe');
      INSERT INTO "staff_access"."role_assignment"
        ("id", "agencyId", "membershipId", "roleId", "scopeKind")
      VALUES ('${createUuidV7()}'::uuid, '${rootAgencyId}'::uuid, '${membershipId}'::uuid, '${roleId}'::uuid, 'AGENCY');
    `);
    const after = await repository.getStaffAuthorizationSnapshot(ownerPrincipalId, rootAgencyId);
    expect(after?.authorizationEpoch).not.toBe(before?.authorizationEpoch);
    expect(
      authorizeStaffRequest({
        session: {
          sessionId: ownerSession.sessionId,
          staffPrincipalId: ownerSession.principalId,
          agencyId: ownerSession.agencyId!,
          authorizationEpoch: ownerSession.authorizationEpoch!,
          expiresAtEpochMs: ownerSession.expiresAtEpochMs,
          recentMfaVerifiedAtEpochMs: ownerSession.recentMfaVerifiedAtEpochMs,
        },
        snapshot: after,
        permissionId: "agency.view",
        target: {
          agencyId: rootAgencyId,
          organizationUnitAncestorIds: [],
          requiredAccessLevel: "ALL",
        },
        nowEpochMs: Date.now(),
        recentMfaMaximumAgeMs: null,
      }),
    ).toEqual({ result: "DENY", reason: "AUTHORIZATION_EPOCH_MISMATCH" });
    expect(
      authorizeStaffRequest({
        session: {
          sessionId: ownerSession.sessionId,
          staffPrincipalId: ownerSession.principalId,
          agencyId: "00000000-0000-7000-8000-000000000099",
          authorizationEpoch: after!.authorizationEpoch,
          expiresAtEpochMs: ownerSession.expiresAtEpochMs,
          recentMfaVerifiedAtEpochMs: ownerSession.recentMfaVerifiedAtEpochMs,
        },
        snapshot: after,
        permissionId: "agency.view",
        target: {
          agencyId: rootAgencyId,
          organizationUnitAncestorIds: [],
          requiredAccessLevel: "ALL",
        },
        nowEpochMs: Date.now(),
        recentMfaMaximumAgeMs: null,
      }),
    ).toEqual({ result: "DENY", reason: "WRONG_AGENCY" });

    const noMembership = await authRequest(enrollmentRealm, staffOrigin, "/sign-up/email", {
      email: "nomembership.staff-auth@example.test",
      name: "No Membership",
      password: syntheticCredential,
    });
    expect(noMembership.status).toBe(200);
    const noMembershipPrincipal = await repository.findStaffPrincipalIdByEmail(
      "nomembership.staff-auth@example.test",
    );
    expect(
      await repository.getStaffAuthorizationSnapshot(noMembershipPrincipal!, rootAgencyId),
    ).toBeNull();
    await queryAsOwner(`
      INSERT INTO "staff_access"."staff_membership" ("id", "agencyId", "staffPrincipalId", "state")
      VALUES ('${createUuidV7()}'::uuid, '${rootAgencyId}'::uuid, '${noMembershipPrincipal}'::text, 'ACTIVE');
      UPDATE "staff_access"."staff_membership"
         SET "state" = 'DISABLED'
       WHERE "staffPrincipalId" = '${noMembershipPrincipal}'::text;
    `);
    const inactive = await repository.getStaffAuthorizationSnapshot(
      noMembershipPrincipal!,
      rootAgencyId,
    );
    expect(inactive?.membershipState).toBe("DISABLED");
  });

  it("protects the last Owner and rejects wrong cookies, hosts, origins and token URLs", async () => {
    const lastOwnerMutation = await queryErrorCode(() =>
      queryAsOwner(`
        UPDATE "staff_access"."staff_membership" SET "state" = 'DISABLED'
         WHERE "staffPrincipalId" = '${ownerPrincipalId}'::text
      `),
    );
    expect(lastOwnerMutation).toBe("P0001");
    expect(
      await repository.consumeFirstOwnerInvitation({
        tokenDigest: invitationToken.digest,
        staffPrincipalId: ownerPrincipalId,
        operatorIdentity: "TEST_LOCAL_OPERATOR",
      }),
    ).toEqual({ result: "CONSUMED" });
    await expect(
      dispatchAuthRealmRequest(
        staffRealm,
        { canonicalOrigin: staffOrigin, expectedHost: "admin.travelos.test" },
        {
          method: "GET",
          url: "/api/auth/staff/get-session?token=synthetic",
          headers: new Headers({ host: "admin.travelos.test" }),
          body: undefined,
        },
      ),
    ).resolves.toMatchObject({ status: 403, body: new Uint8Array() });
    await expect(
      dispatchAuthRealmRequest(
        staffRealm,
        { canonicalOrigin: staffOrigin, expectedHost: "admin.travelos.test" },
        {
          method: "POST",
          url: "/api/auth/staff/sign-in/email",
          headers: new Headers({ host: "admin.travelos.test", origin: foreignOrigin }),
          body: {},
        },
      ),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      dispatchAuthRealmRequest(
        staffRealm,
        { canonicalOrigin: staffOrigin, expectedHost: "admin.travelos.test" },
        {
          method: "GET",
          url: "/api/auth/staff/get-session",
          headers: new Headers({ host: "other.travelos.test" }),
          body: undefined,
        },
      ),
    ).resolves.toMatchObject({ status: 404 });

    const ownerAssignment = await queryAsOwner<{ readonly id: string }>(`
      SELECT assignment."id"::text AS "id"
        FROM "staff_access"."role_assignment" AS assignment
        JOIN "staff_access"."staff_membership" AS membership
          ON membership."id" = assignment."membershipId"
        JOIN "staff_access"."role" AS role ON role."id" = assignment."roleId"
       WHERE membership."staffPrincipalId" = '${ownerPrincipalId}'::text
         AND assignment."active"
         AND role."templateKey" = 'agency-owner-v1'
    `);
    const disabledMembership = await queryAsOwner<{ readonly id: string }>(`
      SELECT "id"::text AS "id"
        FROM "staff_access"."staff_membership"
       WHERE "agencyId" = '${rootAgencyId}'::uuid AND "state" = 'DISABLED'
    `);
    expect(ownerAssignment).toHaveLength(1);
    expect(disabledMembership).toHaveLength(1);
    expect(
      await queryErrorCode(() =>
        queryAsOwner(`
          UPDATE "staff_access"."role_assignment"
             SET "membershipId" = '${disabledMembership[0]?.id}'::uuid
           WHERE "id" = '${ownerAssignment[0]?.id}'::uuid
        `),
      ),
    ).toBe("P0001");
    expect(
      await queryErrorCode(() =>
        queryAs(
          "travelos_admin_api",
          `UPDATE "organization"."agency_bootstrap_audit" SET "operatorIdentity" = 'tamper' WHERE false`,
        ),
      ),
    ).toBe("42501");
    invitationToken = { rawToken: "", digest: digestOneTimeOperatorToken("") };
  });
});

describe.sequential("Staff invitations", () => {
  // ---------------------------------------------------------------------------------------------
  // Staff invitation lifecycle.
  // ---------------------------------------------------------------------------------------------
  const invitationDatabase = "travelos_staff_invitations";
  const invitationAgencyId = "019a0000-0000-7000-8000-000000000091";
  const freshAgencyId = invitationAgencyId;
  const expectedTripOperationsPermissions = [
    { permissionId: "agency.view", scopeKind: "AGENCY", accessLevel: "ALL" },
    { permissionId: "customer.edit", scopeKind: "AGENCY", accessLevel: "ALL" },
    { permissionId: "traveller.edit", scopeKind: "AGENCY", accessLevel: "ALL" },
    { permissionId: "trip.access.manage", scopeKind: "AGENCY", accessLevel: "ALL" },
    { permissionId: "trip.edit", scopeKind: "AGENCY", accessLevel: "ALL" },
    { permissionId: "trip.preview", scopeKind: "AGENCY", accessLevel: "ALL" },
    { permissionId: "trip.publish", scopeKind: "AGENCY", accessLevel: "ALL" },
    { permissionId: "trip.view", scopeKind: "AGENCY", accessLevel: "ALL" },
  ] as const;

  let owner: Client | undefined;
  let worker: Client | undefined;
  let adminPersistence: Persistence | undefined;
  let secondAdminPersistence: Persistence | undefined;
  let ownerRoleId = "";
  let ownerPrincipalId = "";
  let ownerSessionId = "";
  let ownerSessionExpiresAt = new Date(0);
  let ownerMfaVerifiedAt = new Date(0);

  const readTripOperationsRole = async (
    client: Client,
    agencyId: string,
  ): Promise<{
    readonly roleId: string | null;
    readonly displayName: string | null;
    readonly isSystemTemplate: boolean | null;
    readonly permissions: readonly {
      permissionId: string;
      scopeKind: string;
      accessLevel: string;
    }[];
  }> => {
    const role = (
      await client.query<{
        roleId: string;
        displayName: string;
        isSystemTemplate: boolean;
      }>(
        'SELECT "id"::text AS "roleId", "displayName", "isSystemTemplate" FROM staff_access.role WHERE "agencyId"=$1::uuid AND "templateKey"=$2',
        [agencyId, TRIP_OPERATIONS_ROLE_TEMPLATE_KEY],
      )
    ).rows[0];
    if (role === undefined) {
      return { roleId: null, displayName: null, isSystemTemplate: null, permissions: [] };
    }
    const permissions = (
      await client.query<{ permissionId: string; scopeKind: string; accessLevel: string }>(
        'SELECT "permissionId", "scopeKind", "accessLevel" FROM staff_access.role_permission WHERE "roleId"=$1::uuid ORDER BY "permissionId", "scopeKind", "accessLevel"',
        [role.roleId],
      )
    ).rows;
    return { ...role, permissions };
  };

  const requireInvitationRepository = (
    persistence: PostgresPersistence<Record<string, never>> = adminPersistence!,
  ): StaffInvitationRepository => {
    const factory = (
      databaseExports as unknown as {
        createPostgresStaffInvitationRepository?: (
          input: PostgresPersistence<Record<string, never>>,
        ) => StaffInvitationRepository;
      }
    ).createPostgresStaffInvitationRepository;
    expect(factory).toBeTypeOf("function");
    return factory!(persistence);
  };

  const authorizationForOwner = async (
    nowEpochMs = Date.now(),
  ): Promise<StaffAuthorizationOperationProof> => {
    if (owner === undefined)
      throw new Error("Staff invitation test owner connection is unavailable");
    const recentMfa = new Date(nowEpochMs - 5_000);
    await owner.query(
      'UPDATE staff_access.staff_session_context SET "recentMfaVerifiedAt"=$1, "updatedAt"=$1 WHERE "sessionId"=$2',
      [recentMfa, ownerSessionId],
    );
    const membership = (
      await owner.query<{ authorizationEpoch: string }>(
        'SELECT "authorizationEpoch"::text AS "authorizationEpoch" FROM staff_access.staff_membership WHERE "agencyId"=$1::uuid AND "staffPrincipalId"=$2',
        [freshAgencyId, ownerPrincipalId],
      )
    ).rows[0];
    if (membership === undefined) throw new Error("Synthetic Owner membership disappeared");
    ownerMfaVerifiedAt = recentMfa;
    return {
      session: {
        sessionId: ownerSessionId,
        staffPrincipalId: ownerPrincipalId,
        agencyId: freshAgencyId,
        authorizationEpoch: BigInt(membership.authorizationEpoch),
        expiresAtEpochMs: ownerSessionExpiresAt.getTime(),
        recentMfaVerifiedAtEpochMs: recentMfa.getTime(),
      },
      requiredPermissionIds: ["staff.invite"],
      nowEpochMs,
    };
  };

  const invitationRepository = (): StaffInvitationRepository => requireInvitationRepository();

  const issueInvitation = async (
    repository = invitationRepository(),
    targetEmail = `qa-${randomUUID()}@example.test`,
    tokenDigest = randomBytes(32).toString("hex"),
  ): Promise<{ readonly record: StaffInvitationRecord; readonly tokenDigest: string }> => {
    const nowEpochMs = Date.now();
    const record = await repository.issue({
      agencyId: asOpaqueId(freshAgencyId),
      actorStaffPrincipalId: ownerPrincipalId,
      targetEmail,
      tokenDigest,
      roleTemplateKey: TRIP_OPERATIONS_ROLE_TEMPLATE_KEY,
      expiresAtEpochMs: nowEpochMs + 60 * 60 * 1_000,
      nowEpochMs,
      authorization: await authorizationForOwner(nowEpochMs),
    });
    return { record, tokenDigest };
  };

  const enrollmentThatCreatesStaffUser = (
    persistence: PostgresPersistence<Record<string, never>>,
    id = `staff-invitation-staff-${createUuidV7()}`,
  ): StaffIdentityEnrollmentPort => ({
    async enroll(context, input) {
      await persistence.withTransactionContext(context, async (database) => {
        await sql`
        INSERT INTO "staff_access"."staff_user"
          ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
        VALUES (
          ${id}, ${input.name}, ${input.email}, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `.execute(database);
      });
      return { staffPrincipalId: id };
    },
  });

  type StaffInvitationEnrollmentInput = {
    readonly email: string;
    readonly name: string;
    readonly password: string;
  };

  type StaffInvitationEnrollmentServiceFactory = (configuration: AuthRealmConfiguration) => {
    readonly enroll: (
      input: StaffInvitationEnrollmentInput,
    ) => Promise<{ readonly staffPrincipalId: string }>;
  };

  const staffInvitationEnrollmentFactory = (): StaffInvitationEnrollmentServiceFactory | null => {
    const candidate = (authAdapterExports as unknown as Record<string, unknown>)[
      "createStaffInvitationEnrollmentService"
    ];
    return typeof candidate === "function"
      ? (candidate as StaffInvitationEnrollmentServiceFactory)
      : null;
  };

  const staffAuthRealmConfiguration = (
    database: AuthRealmConfiguration["database"],
  ): AuthRealmConfiguration => ({
    database,
    canonicalOrigin: "http://admin.travelos.test",
    realmKeyMaterial: randomBytes(32).toString("base64url"),
    environment: "DEVELOPMENT",
  });

  const waitForBlockedSecondAccept = async (
    applicationName: string,
    timeoutMs = 5_000,
  ): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await owner!.query<{ blocked: boolean }>(
        `SELECT EXISTS (
         SELECT 1 FROM pg_catalog.pg_stat_activity
          WHERE application_name=$1 AND cardinality(pg_catalog.pg_blocking_pids(pid)) > 0
       ) AS blocked`,
        [applicationName],
      );
      if (result.rows[0]?.blocked === true) return true;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return false;
  };

  beforeAll(async () => {
    requireHarness();
    createDatabase(invitationDatabase);
    const migratedInvitations = await migrateToHead(invitationDatabase, {
      agencyId: invitationAgencyId,
      bootstrapReference: "staff-invitation-fresh",
      slug: "staff-invitation-fresh",
    });
    ownerRoleId = migratedInvitations.ownerRoleId;
    owner = await createOwnerClient(invitationDatabase);
    adminPersistence = createAdminPersistence(invitationDatabase, "staff-invitation-admin-test", 2);
    secondAdminPersistence = createAdminPersistence(
      invitationDatabase,
      "staff-invitation-concurrent-second",
      1,
    );
    worker = new Client({
      host,
      port,
      database: invitationDatabase,
      user: "travelos_worker",
      ssl: false,
    });
    await worker.connect();

    ownerPrincipalId = `staff-invitation-owner-${randomUUID()}`;
    ownerSessionId = `staff-invitation-session-${randomUUID()}`;
    ownerSessionExpiresAt = new Date(Date.now() + 60 * 60 * 1_000);
    ownerMfaVerifiedAt = new Date(Date.now() - 5_000);
    await owner.query(
      'INSERT INTO staff_access.staff_user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1,$2,$3,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',
      [ownerPrincipalId, "Synthetic Invitation Owner", `owner-${randomUUID()}@example.test`],
    );
    const membershipId = createUuidV7();
    await owner.query(
      'INSERT INTO staff_access.staff_membership (id, "agencyId", "staffPrincipalId", state) VALUES ($1,$2::uuid,$3,\'ACTIVE\')',
      [membershipId, freshAgencyId, ownerPrincipalId],
    );
    await owner.query(
      'INSERT INTO staff_access.role_assignment (id, "agencyId", "membershipId", "roleId", "scopeKind", "active") VALUES ($1,$2::uuid,$3::uuid,$4::uuid,\'AGENCY\',true)',
      [createUuidV7(), freshAgencyId, membershipId, ownerRoleId],
    );
    await owner.query(
      'INSERT INTO staff_access.staff_session (id, "expiresAt", token, "updatedAt", "userId") VALUES ($1,$2,$3,CURRENT_TIMESTAMP,$4)',
      [
        ownerSessionId,
        ownerSessionExpiresAt,
        randomBytes(32).toString("base64url"),
        ownerPrincipalId,
      ],
    );
    const ownerMembership = (
      await owner.query<{ authorizationEpoch: string }>(
        'SELECT "authorizationEpoch"::text AS "authorizationEpoch" FROM staff_access.staff_membership WHERE "id"=$1::uuid',
        [membershipId],
      )
    ).rows[0];
    if (ownerMembership === undefined)
      throw new Error("Synthetic Owner membership was not created");
    await owner.query(
      'INSERT INTO staff_access.staff_session_context ("sessionId", "staffPrincipalId", "agencyId", "authorizationEpoch", "recentMfaVerifiedAt") VALUES ($1,$2,$3::uuid,$4,$5)',
      [
        ownerSessionId,
        ownerPrincipalId,
        freshAgencyId,
        ownerMembership.authorizationEpoch,
        ownerMfaVerifiedAt,
      ],
    );
  });

  afterAll(async () => {
    await Promise.allSettled([
      ...(adminPersistence === undefined ? [] : [adminPersistence.destroy()]),
      ...(secondAdminPersistence === undefined ? [] : [secondAdminPersistence.destroy()]),
      ...(worker === undefined ? [] : [worker.end()]),
      ...(owner === undefined ? [] : [owner.end()]),
    ]);
  });

  it("seeds the exact fixed Trip Operations role for a freshly bootstrapped Agency", async () => {
    const freshRole = await readTripOperationsRole(owner!, freshAgencyId);
    expect(freshRole.roleId).not.toBeNull();
    expect(freshRole.displayName).toBe("Trip Operations");
    expect(freshRole.isSystemTemplate).toBe(true);
    expect(freshRole.permissions).toEqual(expectedTripOperationsPermissions);
  });

  it("grants invitation data only to the Staff Admin runtime, never Worker", async () => {
    const privileges = (
      await owner!.query<Record<string, boolean>>(`
        SELECT has_schema_privilege('travelos_admin_api', 'staff_access', 'USAGE') AS admin_staff_schema,
               has_table_privilege('travelos_admin_api', 'staff_access.staff_invitation', 'SELECT') AS admin_invitation_select,
               has_table_privilege('travelos_admin_api', 'staff_access.staff_invitation', 'INSERT') AS admin_invitation_insert,
               has_table_privilege('travelos_admin_api', 'staff_access.staff_invitation', 'UPDATE') AS admin_invitation_update,
               has_table_privilege('travelos_admin_api', 'staff_access.staff_invitation', 'DELETE') AS admin_invitation_delete,
               has_table_privilege('travelos_worker', 'staff_access.staff_invitation', 'SELECT') AS worker_invitation_select,
               has_table_privilege('travelos_admin_api', 'audit.staff_invitation_event', 'SELECT') AS admin_audit_select,
               has_table_privilege('travelos_admin_api', 'audit.staff_invitation_event', 'INSERT') AS admin_audit_insert,
               has_table_privilege('travelos_admin_api', 'audit.staff_invitation_event', 'UPDATE') AS admin_audit_update,
               has_table_privilege('travelos_worker', 'audit.staff_invitation_event', 'SELECT') AS worker_audit_select
      `)
    ).rows[0];
    expect(privileges).toEqual({
      admin_staff_schema: true,
      admin_invitation_select: true,
      admin_invitation_insert: true,
      admin_invitation_update: true,
      admin_invitation_delete: false,
      worker_invitation_select: false,
      admin_audit_select: true,
      admin_audit_insert: true,
      admin_audit_update: false,
      worker_audit_select: false,
    });
    await expect(
      worker!.query("SELECT id FROM staff_access.staff_invitation LIMIT 1"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      worker!.query("SELECT id FROM audit.staff_invitation_event LIMIT 1"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("declares composite same-Agency constraints for role, issuer, consumer and audit references", async () => {
    const constraints = (
      await owner!.query<{ definition: string }>(`
        SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid) AS definition
          FROM pg_catalog.pg_constraint AS constraint_row
          JOIN pg_catalog.pg_class AS relation ON relation.oid=constraint_row.conrelid
          JOIN pg_catalog.pg_namespace AS schema ON schema.oid=relation.relnamespace
         WHERE (schema.nspname='staff_access' AND relation.relname='staff_invitation')
            OR (schema.nspname='audit' AND relation.relname='staff_invitation_event')
      `)
    ).rows.map(({ definition }) => definition);
    expect(
      constraints.some((definition) =>
        /FOREIGN KEY \("roleId", "agencyId"\).*REFERENCES staff_access\.role\(id, "agencyId"\)/u.test(
          definition,
        ),
      ),
    ).toBe(true);
    expect(
      constraints.some((definition) =>
        /FOREIGN KEY \("agencyId", "createdByStaffPrincipalId"\).*REFERENCES staff_access\.staff_membership\("agencyId", "staffPrincipalId"\)/u.test(
          definition,
        ),
      ),
    ).toBe(true);
    expect(
      constraints.some((definition) =>
        /FOREIGN KEY \("agencyId", "consumedStaffPrincipalId"\).*REFERENCES staff_access\.staff_membership\("agencyId", "staffPrincipalId"\)/u.test(
          definition,
        ),
      ),
    ).toBe(true);
    expect(
      constraints.some((definition) =>
        /FOREIGN KEY \("agencyId", "invitationId"\).*REFERENCES staff_access\.staff_invitation\("agencyId", id\)/u.test(
          definition,
        ),
      ),
    ).toBe(true);
  });

  it("issues, lists, reissues and revokes with one-use digests and atomic audit", async () => {
    const repository = invitationRepository();
    const issued = await issueInvitation(repository);
    expect(issued.record.status).toBe("PENDING");
    expect(issued.record.tokenDigest).toBe(issued.tokenDigest);
    expect(issued.record.targetEmail).toMatch(/^qa-[0-9a-f-]+@example\.test$/u);

    const nowEpochMs = Date.now();
    const firstPage = await repository.listAndExpireDue({
      agencyId: asOpaqueId(freshAgencyId),
      actorStaffPrincipalId: ownerPrincipalId,
      nowEpochMs,
      limit: 1,
      cursor: null,
      authorization: await authorizationForOwner(nowEpochMs),
    });
    expect(firstPage.items.map(({ invitationId }) => invitationId)).toContain(
      issued.record.invitationId,
    );
    expect(firstPage.items[0]).not.toHaveProperty("token");

    const reissueNow = Date.now();
    const reissued = await repository.reissue({
      agencyId: asOpaqueId(freshAgencyId),
      invitationId: issued.record.invitationId,
      actorStaffPrincipalId: ownerPrincipalId,
      tokenDigest: randomBytes(32).toString("hex"),
      expiresAtEpochMs: reissueNow + 60 * 60 * 1_000,
      nowEpochMs: reissueNow,
      authorization: await authorizationForOwner(reissueNow),
    });
    expect(reissued.status).toBe("PENDING");
    expect(reissued.invitationId).not.toBe(issued.record.invitationId);
    const priorState = (
      await owner!.query<{ status: string }>(
        'SELECT "status" FROM staff_access.staff_invitation WHERE "id"=$1::uuid',
        [issued.record.invitationId],
      )
    ).rows[0];
    expect(priorState?.status).toBe("REVOKED");

    const revokeNow = Date.now();
    const revoked = await repository.revoke({
      agencyId: asOpaqueId(freshAgencyId),
      invitationId: reissued.invitationId,
      actorStaffPrincipalId: ownerPrincipalId,
      nowEpochMs: revokeNow,
      authorization: await authorizationForOwner(revokeNow),
    });
    expect(revoked.status).toBe("REVOKED");
    const audit = (
      await owner!.query<{
        eventType: string;
        invitationId: string;
        relatedInvitationId: string | null;
      }>(
        'SELECT "eventType", "invitationId"::text AS "invitationId", "relatedInvitationId"::text AS "relatedInvitationId" FROM audit.staff_invitation_event WHERE "agencyId"=$1::uuid ORDER BY "occurredAt", "id"',
        [freshAgencyId],
      )
    ).rows;
    expect(audit).toEqual([
      { eventType: "ISSUED", invitationId: issued.record.invitationId, relatedInvitationId: null },
      {
        eventType: "REISSUED",
        invitationId: issued.record.invitationId,
        relatedInvitationId: reissued.invitationId,
      },
      { eventType: "REVOKED", invitationId: reissued.invitationId, relatedInvitationId: null },
    ]);
  });

  it("materializes due expirations once and returns a bounded cursor page", async () => {
    const repository = invitationRepository();
    const issued = await issueInvitation(repository);
    const nowEpochMs = Date.now();
    await owner!.query(
      'UPDATE staff_access.staff_invitation SET "createdAt"=to_timestamp($2::double precision/1000.0), "expiresAt"=to_timestamp($3::double precision/1000.0) WHERE "id"=$1::uuid',
      [issued.record.invitationId, nowEpochMs - 120_000, nowEpochMs - 1],
    );
    const pageIds = new Set<string>();
    const pageStatuses = new Map<string, string>();
    let cursor: ReturnType<typeof asOpaqueId> | null = null;
    let reachedLastPage = false;
    for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
      const pageNow = Date.now();
      const page = await repository.listAndExpireDue({
        agencyId: asOpaqueId(freshAgencyId),
        actorStaffPrincipalId: ownerPrincipalId,
        nowEpochMs: pageNow,
        limit: 2,
        cursor,
        authorization: await authorizationForOwner(pageNow),
      });
      expect(page.items.length).toBeLessThanOrEqual(2);
      for (const item of page.items) {
        expect(pageIds.has(item.invitationId)).toBe(false);
        pageIds.add(item.invitationId);
        pageStatuses.set(item.invitationId, item.status);
      }
      if (page.nextCursor === null) {
        reachedLastPage = true;
        break;
      }
      cursor = page.nextCursor;
    }
    expect(reachedLastPage).toBe(true);
    expect(pageStatuses.get(issued.record.invitationId)).toBe("EXPIRED");
    const expiryEvents = (
      await owner!.query<{ count: number }>(
        'SELECT count(*)::integer AS count FROM audit.staff_invitation_event WHERE "invitationId"=$1::uuid AND "eventType"=\'EXPIRED\'',
        [issued.record.invitationId],
      )
    ).rows[0]?.count;
    expect(expiryEvents).toBe(1);
  });

  it("consumes identity, membership, fixed Agency role and audit in one transaction", async () => {
    const repository = invitationRepository();
    const ephemeralBearer = randomBytes(32).toString("base64url");
    const tokenDigest = createHash("sha256").update(ephemeralBearer).digest("hex");
    const issued = await issueInvitation(repository, undefined, tokenDigest);
    const ephemeralPassword = randomBytes(32).toString("base64url");
    const enrollment = enrollmentThatCreatesStaffUser(adminPersistence!);
    await repository.accept(
      {
        tokenDigest,
        name: "Synthetic QA Staff",
        password: ephemeralPassword,
        nowEpochMs: Date.now(),
      },
      enrollment,
    );
    const consumed = (
      await owner!.query<{ status: string; consumedStaffPrincipalId: string | null }>(
        'SELECT "status", "consumedStaffPrincipalId" FROM staff_access.staff_invitation WHERE "id"=$1::uuid',
        [issued.record.invitationId],
      )
    ).rows[0];
    expect(consumed?.status).toBe("CONSUMED");
    expect(consumed?.consumedStaffPrincipalId).toMatch(/^staff-invitation-staff-/u);
    const assignment = (
      await owner!.query<{ templateKey: string; scopeKind: string; active: boolean }>(
        `SELECT role."templateKey", assignment."scopeKind", assignment."active"
           FROM staff_access.role_assignment AS assignment
           JOIN staff_access.role AS role ON role."id"=assignment."roleId"
          WHERE assignment."membershipId"=(
            SELECT membership."id" FROM staff_access.staff_membership AS membership
             WHERE membership."staffPrincipalId"=$1
          )`,
        [consumed?.consumedStaffPrincipalId],
      )
    ).rows[0];
    expect(assignment).toEqual({
      templateKey: TRIP_OPERATIONS_ROLE_TEMPLATE_KEY,
      scopeKind: "AGENCY",
      active: true,
    });
    const stored = JSON.stringify(
      (
        await owner!.query(
          'SELECT "tokenDigest", "targetEmail", "status" FROM staff_access.staff_invitation WHERE "id"=$1::uuid',
          [issued.record.invitationId],
        )
      ).rows,
    );
    expect(stored).not.toContain(ephemeralBearer);
    expect(stored).not.toContain(ephemeralPassword);
    const consumedEvents = (
      await owner!.query<{ count: number }>(
        'SELECT count(*)::integer AS count FROM audit.staff_invitation_event WHERE "invitationId"=$1::uuid AND "eventType"=\'CONSUMED\'',
        [issued.record.invitationId],
      )
    ).rows[0]?.count;
    expect(consumedEvents).toBe(1);
  });

  it("enrolls a verified Better Auth identity inside acceptance without creating a session", async () => {
    const factory = staffInvitationEnrollmentFactory();
    expect(factory).toBeTypeOf("function");
    if (factory === null) return;

    const targetEmail = `better-auth-${randomUUID()}@example.test`;
    const inviteToken = createStaffInvitationToken();
    const issued = await issueInvitation(invitationRepository(), targetEmail, inviteToken.digest);
    const password = randomBytes(32).toString("base64url");
    const serviceShape = {
      keys: [] as string[],
      hasHandle: false,
      hasCookieName: false,
      resultKeys: [] as string[],
    };
    let returnedPrincipalId = "";
    const enrollment: StaffIdentityEnrollmentPort = {
      async enroll(context, input) {
        return adminPersistence!.withTransactionContext(context, async (database) => {
          const service = factory(staffAuthRealmConfiguration(database));
          serviceShape.keys = Object.keys(service).sort();
          serviceShape.hasHandle = "handle" in service;
          serviceShape.hasCookieName = "cookieName" in service;
          const result = await service.enroll(input);
          serviceShape.resultKeys = Object.keys(result).sort();
          returnedPrincipalId = result.staffPrincipalId;
          return result;
        });
      },
    };

    await invitationRepository().accept(
      {
        tokenDigest: digestStaffInvitationToken(inviteToken.token),
        name: "Synthetic Better Auth QA",
        password,
        nowEpochMs: Date.now(),
      },
      enrollment,
    );

    const principal = (
      await owner!.query<{ id: string; emailVerified: boolean }>(
        'SELECT "id", "emailVerified" FROM staff_access.staff_user WHERE "email"=$1',
        [targetEmail],
      )
    ).rows[0];
    expect(principal?.id).toBe(returnedPrincipalId);
    expect(principal?.emailVerified).toBe(true);
    expect(serviceShape).toEqual({
      keys: ["enroll"],
      hasHandle: false,
      hasCookieName: false,
      resultKeys: ["staffPrincipalId"],
    });

    const persisted = (
      await owner!.query<{
        accountCount: number;
        sessionCount: number;
        verificationRows: number;
        rawPasswordPersisted: boolean;
        inviteDigestPersisted: boolean;
        rawInviteTokenPersisted: boolean;
      }>(
        `SELECT
           (SELECT count(*)::integer FROM staff_access.staff_account WHERE "userId"=$1) AS "accountCount",
           (SELECT count(*)::integer FROM staff_access.staff_session WHERE "userId"=$1) AS "sessionCount",
           (SELECT count(*)::integer FROM staff_access.staff_verification WHERE "identifier"=$2) AS "verificationRows",
           EXISTS (
             SELECT 1 FROM staff_access.staff_account
              WHERE "userId"=$1 AND "password"=$3
           ) AS "rawPasswordPersisted",
           EXISTS (
             SELECT 1 FROM staff_access.staff_invitation
              WHERE "id"=$4::uuid AND "tokenDigest"=$5
           ) AS "inviteDigestPersisted",
           EXISTS (
             SELECT 1 FROM staff_access.staff_invitation
              WHERE "id"=$4::uuid AND "tokenDigest"=$6
           ) AS "rawInviteTokenPersisted"`,
        [
          returnedPrincipalId,
          targetEmail,
          password,
          issued.record.invitationId,
          inviteToken.digest,
          inviteToken.token,
        ],
      )
    ).rows[0];
    expect(persisted).toEqual({
      accountCount: 1,
      sessionCount: 0,
      verificationRows: 0,
      rawPasswordPersisted: false,
      inviteDigestPersisted: true,
      rawInviteTokenPersisted: false,
    });
  });

  it("rolls back Better Auth identity and account rows when membership insertion fails", async () => {
    const factory = staffInvitationEnrollmentFactory();
    expect(factory).toBeTypeOf("function");
    if (factory === null) return;

    const targetEmail = `rollback-${randomUUID()}@example.test`;
    const inviteToken = createStaffInvitationToken();
    const issued = await issueInvitation(invitationRepository(), targetEmail, inviteToken.digest);
    const password = randomBytes(32).toString("base64url");
    const suffix = randomUUID().replaceAll("-", "");
    const triggerName = `staff_invitation_fail_membership_${suffix}`;
    const functionName = `staff_invitation_fail_membership_fn_${suffix}`;
    let functionCreated = false;
    let triggerCreated = false;

    try {
      await owner!.query(`
        CREATE FUNCTION staff_access.${functionName}() RETURNS trigger
        LANGUAGE plpgsql
        AS $staff_invitation$
        BEGIN
          RAISE EXCEPTION 'synthetic Staff invitation membership failure'
            USING ERRCODE = '23514';
        END
        $staff_invitation$
      `);
      functionCreated = true;
      await owner!.query(`
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON staff_access.staff_membership
        FOR EACH ROW EXECUTE FUNCTION staff_access.${functionName}()
      `);
      triggerCreated = true;

      const enrollment: StaffIdentityEnrollmentPort = {
        async enroll(context, input) {
          return adminPersistence!.withTransactionContext(context, (database) =>
            factory(staffAuthRealmConfiguration(database)).enroll(input),
          );
        },
      };
      await expect(
        invitationRepository().accept(
          {
            tokenDigest: digestStaffInvitationToken(inviteToken.token),
            name: "Synthetic Rollback QA",
            password,
            nowEpochMs: Date.now(),
          },
          enrollment,
        ),
      ).rejects.toThrow();
    } finally {
      if (triggerCreated) {
        await owner!.query(`DROP TRIGGER ${triggerName} ON staff_access.staff_membership`);
      }
      if (functionCreated) {
        await owner!.query(`DROP FUNCTION staff_access.${functionName}()`);
      }
    }

    const state = (
      await owner!.query<{
        users: number;
        accounts: number;
        verifications: number;
        sessions: number;
        memberships: number;
        invitationStatus: string;
        consumedEvents: number;
      }>(
        `SELECT
           (SELECT count(*)::integer FROM staff_access.staff_user WHERE "email"=$1) AS users,
           (SELECT count(*)::integer FROM staff_access.staff_account AS account
             JOIN staff_access.staff_user AS principal ON principal."id"=account."userId"
            WHERE principal."email"=$1) AS accounts,
           (SELECT count(*)::integer FROM staff_access.staff_verification
             WHERE "identifier"=$1) AS verifications,
           (SELECT count(*)::integer FROM staff_access.staff_session AS session
             JOIN staff_access.staff_user AS principal ON principal."id"=session."userId"
            WHERE principal."email"=$1) AS sessions,
           (SELECT count(*)::integer FROM staff_access.staff_membership AS membership
             JOIN staff_access.staff_user AS principal ON principal."id"=membership."staffPrincipalId"
            WHERE principal."email"=$1) AS memberships,
           (SELECT "status" FROM staff_access.staff_invitation WHERE "id"=$2::uuid) AS "invitationStatus",
           (SELECT count(*)::integer FROM audit.staff_invitation_event
             WHERE "invitationId"=$2::uuid AND "eventType"='CONSUMED') AS "consumedEvents"`,
        [targetEmail, issued.record.invitationId],
      )
    ).rows[0];
    expect(state).toEqual({
      users: 0,
      accounts: 0,
      verifications: 0,
      sessions: 0,
      memberships: 0,
      invitationStatus: "PENDING",
      consumedEvents: 0,
    });
  });

  it("keeps the ordinary Staff sign-up endpoint disabled and session-free", async () => {
    const targetEmail = `public-signup-${randomUUID()}@example.test`;
    const password = randomBytes(32).toString("base64url");
    let cookieName = "";
    const signup = await adminPersistence!.withConnection(async (database) => {
      const configuration = staffAuthRealmConfiguration(database);
      const realm = createStaffAuthRealm(configuration);
      cookieName = realm.cookieName;
      return realm.handle(
        new Request(`${configuration.canonicalOrigin}${STAFF_AUTH_BASE_PATH}/sign-up/email`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: configuration.canonicalOrigin,
          },
          body: JSON.stringify({ email: targetEmail, name: "Synthetic Public Signup", password }),
        }),
      );
    });
    expect(signup.ok).toBe(false);
    expect(signup.headers.get("set-cookie") ?? "").not.toContain(`${cookieName}=`);

    const persisted = (
      await owner!.query<{ users: number; sessions: number }>(
        `SELECT
           (SELECT count(*)::integer FROM staff_access.staff_user WHERE "email"=$1) AS users,
           (SELECT count(*)::integer FROM staff_access.staff_session AS session
             JOIN staff_access.staff_user AS principal ON principal."id"=session."userId"
            WHERE principal."email"=$1) AS sessions`,
        [targetEmail],
      )
    ).rows[0];
    expect(persisted).toEqual({ users: 0, sessions: 0 });
  });

  it("rejects an existing identity without consuming the invitation or creating membership", async () => {
    const repository = invitationRepository();
    const targetEmail = `duplicate-${randomUUID()}@example.test`;
    const issued = await issueInvitation(repository, targetEmail);
    const existingPrincipalId = `staff-invitation-existing-${randomUUID()}`;
    await owner!.query(
      'INSERT INTO staff_access.staff_user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1,$2,$3,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',
      [existingPrincipalId, "Synthetic Existing Identity", targetEmail],
    );
    await expect(
      repository.accept(
        {
          tokenDigest: issued.tokenDigest,
          name: "Synthetic Duplicate",
          password: randomBytes(32).toString("base64url"),
          nowEpochMs: Date.now(),
        },
        enrollmentThatCreatesStaffUser(adminPersistence!),
      ),
    ).rejects.toBeInstanceOf(StaffInvitationAcceptanceRejectedError);
    const state = (
      await owner!.query<{ status: string; memberships: number; consumedEvents: number }>(
        `SELECT invitation."status",
                (SELECT count(*)::integer FROM staff_access.staff_membership WHERE "staffPrincipalId"=$2) AS memberships,
                (SELECT count(*)::integer FROM audit.staff_invitation_event WHERE "invitationId"=invitation."id" AND "eventType"='CONSUMED') AS "consumedEvents"
           FROM staff_access.staff_invitation AS invitation
          WHERE invitation."id"=$1::uuid`,
        [issued.record.invitationId, existingPrincipalId],
      )
    ).rows[0];
    expect(state).toEqual({ status: "PENDING", memberships: 0, consumedEvents: 0 });
  });

  it("serializes concurrent accepts so exactly one identity and consume event commit", async () => {
    const repository = invitationRepository();
    const ephemeralBearer = randomBytes(32).toString("base64url");
    const tokenDigest = createHash("sha256").update(ephemeralBearer).digest("hex");
    const issued = await issueInvitation(repository, undefined, tokenDigest);
    const input = {
      tokenDigest,
      name: "Synthetic Concurrent Staff",
      password: randomBytes(32).toString("base64url"),
      nowEpochMs: Date.now(),
    };
    let releaseFirstEnrollment: (() => void) | undefined;
    let signalFirstEnrollment: (() => void) | undefined;
    const firstEnrollmentStarted = new Promise<void>((resolve) => {
      signalFirstEnrollment = resolve;
    });
    const holdFirstEnrollment = new Promise<void>((resolve) => {
      releaseFirstEnrollment = resolve;
    });
    let enrollmentCalls = 0;
    const firstEnrollment: StaffIdentityEnrollmentPort = {
      async enroll(context, enrollmentInput) {
        enrollmentCalls += 1;
        const id = `staff-invitation-concurrent-${createUuidV7()}`;
        await adminPersistence!.withTransactionContext(context, async (database) => {
          await sql`
            INSERT INTO "staff_access"."staff_user"
              ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
            VALUES (
              ${id}, ${enrollmentInput.name}, ${enrollmentInput.email}, true,
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
          `.execute(database);
        });
        signalFirstEnrollment?.();
        await holdFirstEnrollment;
        return { staffPrincipalId: id };
      },
    };
    const secondRepository = requireInvitationRepository(secondAdminPersistence!);
    let secondSettled = false;
    let secondAccept: Promise<void> | undefined;
    let firstResult: Promise<void> | undefined;
    try {
      firstResult = repository.accept(input, firstEnrollment);
      await Promise.race([
        firstEnrollmentStarted,
        firstResult.then(
          () => {
            throw new Error("First acceptance completed before identity enrollment began");
          },
          (error: unknown) => {
            throw error;
          },
        ),
      ]);
      secondAccept = secondRepository
        .accept(input, enrollmentThatCreatesStaffUser(secondAdminPersistence!))
        .finally(() => {
          secondSettled = true;
        });
      const blocked = await waitForBlockedSecondAccept("staff-invitation-concurrent-second");
      expect(blocked).toBe(true);
      expect(secondSettled).toBe(false);
    } finally {
      releaseFirstEnrollment?.();
    }
    const outcomes = await Promise.allSettled([firstResult!, secondAccept!]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(enrollmentCalls).toBe(1);
    const counts = (
      await owner!.query<{ memberships: number; consumedEvents: number; status: string }>(
        `SELECT (SELECT count(*)::integer FROM staff_access.staff_membership WHERE "staffPrincipalId" LIKE 'staff-invitation-concurrent-%') AS memberships,
                (SELECT count(*)::integer FROM audit.staff_invitation_event WHERE "invitationId"=$1::uuid AND "eventType"='CONSUMED') AS "consumedEvents",
                (SELECT "status" FROM staff_access.staff_invitation WHERE "id"=$1::uuid) AS status`,
        [issued.record.invitationId],
      )
    ).rows[0];
    expect(counts).toEqual({ memberships: 1, consumedEvents: 1, status: "CONSUMED" });
  });

  it("keeps invitation audit append-only even for owner SQL and denies Admin mutation", async () => {
    const issued = await issueInvitation();
    const event = (
      await owner!.query<{ id: string }>(
        'SELECT "id"::text AS "id" FROM audit.staff_invitation_event WHERE "invitationId"=$1::uuid AND "eventType"=\'ISSUED\'',
        [issued.record.invitationId],
      )
    ).rows[0];
    expect(event).toBeDefined();
    await expect(
      owner!.query(
        'UPDATE audit.staff_invitation_event SET "eventType"=\'REVOKED\' WHERE "id"=$1::uuid',
        [event?.id],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      owner!.query('DELETE FROM audit.staff_invitation_event WHERE "id"=$1::uuid', [event?.id]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(owner!.query("TRUNCATE audit.staff_invitation_event")).rejects.toMatchObject({
      code: "55000",
    });
    const adminClient = new Client({
      host,
      port,
      database: invitationDatabase,
      user: "travelos_admin_api",
      ssl: false,
      application_name: "staff-invitation-admin-acl-test",
    });
    await adminClient.connect();
    try {
      await expect(
        adminClient.query(
          'UPDATE audit.staff_invitation_event SET "eventType"=\'REVOKED\' WHERE "id"=$1::uuid',
          [event?.id],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await adminClient.end();
    }
  });
});
