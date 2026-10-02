import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { Client, type QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createLocalOperatorStaffEnrollmentRealm,
  createOneTimeOperatorToken,
  createPortalAuthRealm,
  createStaffAuthRealm,
  digestOneTimeOperatorToken,
  dispatchAuthRealmRequest,
  type AuthRealm,
} from "../../packages/auth-adapters/src/index.js";
import {
  authorizeStaffRequest,
  bootstrapRootAgency,
} from "../../packages/backend-core/src/index.js";
import {
  createPostgresPersistence,
  createStaffAccessRepository,
  createUuidV7,
  type PostgresPersistence,
  type StaffAccessRepository,
} from "../../packages/database/src/index.js";
import {
  inspectMigrationStatus,
  runMigrationChain,
  type MigrationChain,
  type MigrationTarget,
} from "../../tooling/database/migration-runner.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const authAdaptersRequire = createRequire(
  path.join(repositoryRoot, "packages/auth-adapters/package.json"),
);
const betterAuthRequire = createRequire(authAdaptersRequire.resolve("better-auth"));
const { createOTP } = (await import(betterAuthRequire.resolve("@better-auth/utils/otp"))) as {
  createOTP(secret: string): { totp(): Promise<string> };
};
const { base32 } = (await import(betterAuthRequire.resolve("@better-auth/utils/base32"))) as {
  base32: { decode(input: string): Uint8Array };
};
const host = process.env["PGHOST"] ?? "";
const port = Number.parseInt(process.env["PGPORT"] ?? "", 10);
const postgresBin = process.env["TRAVELOS_STAGE4_PG_BIN"] ?? "";
const databaseName = "travelos_stage4_qualification";
const staffOrigin = "http://admin.travelos.test";
const portalOrigin = "http://portal.travelos.test";
const syntheticRealmKey = createHash("sha512")
  .update("travelos-stage-4-disposable-realm-key")
  .digest("base64url");
const syntheticCredential = createHash("sha512")
  .update("travelos-stage-4-disposable-password")
  .digest("base64url");

const productionChain: MigrationChain = {
  directory: path.join(repositoryRoot, "migrations"),
  checksumManifestPath: path.join(repositoryRoot, "migrations/checksums.json"),
};
const migrationTarget: MigrationTarget = {
  host,
  port,
  database: databaseName,
  migratorRole: "travelos_migrator",
  ownerRole: "travelos_owner",
  tls: { mode: "DISABLED_LOOPBACK_ONLY" },
  allowTrustAuthenticationForTests: true,
};

let adminPersistence: PostgresPersistence<Record<string, never>> | null = null;
let portalPersistence: PostgresPersistence<Record<string, never>> | null = null;
let repository: StaffAccessRepository;
let staffRealm: AuthRealm;
let enrollmentRealm: AuthRealm;
let portalRealm: AuthRealm;
let rootAgencyId = "";
let ownerPrincipalId = "";
let invitationToken = createOneTimeOperatorToken();
let recoveryCode = "";
let currentStaffCookie = "";

const clientFor = async (user: string, database = databaseName): Promise<Client> => {
  const client = new Client({
    host,
    port,
    database,
    user,
    application_name: `travelos-stage4-${user}`,
    connectionTimeoutMillis: 5_000,
    ssl: false,
  });
  await client.connect();
  return client;
};

const queryAs = async <Row extends QueryResultRow>(
  user: string,
  statement: string,
): Promise<readonly Row[]> => {
  const client = await clientFor(user);
  try {
    return (await client.query<Row>(statement)).rows;
  } finally {
    await client.end();
  }
};

const queryAsOwner = async <Row extends QueryResultRow>(
  statement: string,
): Promise<readonly Row[]> => {
  const client = await clientFor("travelos_migrator");
  try {
    await client.query('SET ROLE "travelos_owner"');
    await client.query("SET search_path TO pg_catalog");
    return (await client.query<Row>(statement)).rows;
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    await client.end();
  }
};

const queryErrorCode = async (work: () => Promise<unknown>): Promise<string | null> => {
  try {
    await work();
    return null;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error
      ? String((error as { readonly code?: unknown }).code ?? "")
      : null;
  }
};

const runTool = (executable: string, args: readonly string[]) => {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      PGHOST: host,
      PGPORT: String(port),
      PGDATABASE: "postgres",
      PGUSER: "postgres",
      PGSSLMODE: "disable",
    },
  });
  return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
};

const bootstrapDatabase = (): void => {
  const result = runTool(path.join(postgresBin, "psql"), [
    "--no-psqlrc",
    "--set",
    "ON_ERROR_STOP=1",
    "--set",
    `database_name=${databaseName}`,
    "--dbname",
    "postgres",
    "--file",
    path.join(repositoryRoot, "deploy/database/bootstrap-database-and-roles.sql"),
  ]);
  if (result.exitCode !== 0) throw new Error("Stage 4 disposable role/database bootstrap failed");
};

const cookieHeaderFor = (response: Response): string => {
  const extendedHeaders = response.headers as Headers & { readonly getSetCookie?: () => string[] };
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

beforeAll(async () => {
  if (!/^127\.0\.0\.1$/.test(host) || !Number.isInteger(port) || postgresBin.length === 0) {
    throw new Error("Stage 4 disposable PostgreSQL environment is incomplete");
  }
  bootstrapDatabase();
  const migration = await runMigrationChain(migrationTarget, productionChain);
  expect(migration.result).toBe("PASS");
  adminPersistence = createPostgresPersistence<Record<string, never>>({
    host,
    port,
    database: databaseName,
    user: "travelos_admin_api",
    tls: { mode: "DISABLED_LOOPBACK_ONLY" },
    applicationName: "travelos-stage4-admin-qualification",
    maxConnections: 5,
  });
  portalPersistence = createPostgresPersistence<Record<string, never>>({
    host,
    port,
    database: databaseName,
    user: "travelos_portal_api",
    tls: { mode: "DISABLED_LOOPBACK_ONLY" },
    applicationName: "travelos-stage4-portal-qualification",
    maxConnections: 3,
  });
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
  const portalDatabase = await portalPersistence.withConnection(async (connection) => connection);
  portalRealm = createPortalAuthRealm({
    database: portalDatabase,
    canonicalOrigin: portalOrigin,
    realmKeyMaterial: syntheticRealmKey,
    environment: "DEVELOPMENT",
  });
});

afterAll(async () => {
  await Promise.all([adminPersistence?.destroy(), portalPersistence?.destroy()]);
});

describe.sequential("TravelOS Stage 4 disposable PostgreSQL qualification", () => {
  it("migrates the full controlled chain and enforces Staff/Portal SQL isolation", async () => {
    const status = await inspectMigrationStatus(migrationTarget, productionChain);
    expect(status.currentVersion).toBe("0006_stage4_authorization_hardening");
    expect(
      await queryErrorCode(() =>
        queryAs("travelos_portal_api", 'SELECT * FROM "staff_access"."staff_user"'),
      ),
    ).toBe("42501");
    expect(
      await queryErrorCode(() =>
        queryAs("travelos_admin_api", 'SELECT * FROM "portal_access"."portal_user"'),
      ),
    ).toBe("42501");
  });

  it("serializes one root Agency and stores only the first Owner invitation digest", async () => {
    const first = await bootstrapRootAgency(repository, {
      agencyId: createUuidV7(),
      bootstrapReference: "agency-bootstrap:stage4-qualification",
      slug: "stage4-qualification",
    });
    rootAgencyId = first.agencyId;
    expect(first.created).toBe(true);
    const rerun = await bootstrapRootAgency(repository, {
      agencyId: createUuidV7(),
      bootstrapReference: "agency-bootstrap:stage4-qualification",
      slug: "stage4-qualification",
    });
    expect(rerun).toMatchObject({ agencyId: rootAgencyId, created: false });
    const issuance = await repository.issueFirstOwnerInvitation({
      agencyId: rootAgencyId,
      targetEmail: "owner.stage4@example.test",
      tokenDigest: invitationToken.digest,
      expiresAt: new Date(Date.now() + 60_000),
      operatorIdentity: "TEST_LOCAL_OPERATOR",
    });
    expect(issuance.result).toBe("ISSUED");
    expect(await repository.inspectFirstOwnerInvitation(invitationToken.digest)).toMatchObject({
      result: "VALID",
      agencyId: rootAgencyId,
      targetEmail: "owner.stage4@example.test",
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
      email: "owner.stage4@example.test",
      name: "Stage Four Owner",
      password: syntheticCredential,
    });
    expect(enrolled.status).toBe(200);
    ownerPrincipalId = (await repository.findStaffPrincipalIdByEmail(
      "owner.stage4@example.test",
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
      email: "owner.stage4@example.test",
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
      email: "owner.stage4@example.test",
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
      email: "owner.stage4@example.test",
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
      email: "nomembership.stage4@example.test",
      name: "No Membership",
      password: syntheticCredential,
    });
    expect(noMembership.status).toBe(200);
    const noMembershipPrincipal = await repository.findStaffPrincipalIdByEmail(
      "nomembership.stage4@example.test",
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
    expect(
      await portalRealm.getServerSession(
        new Request(portalOrigin, { headers: { cookie: currentStaffCookie } }),
      ),
    ).toBeNull();
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
          headers: new Headers({ host: "admin.travelos.test", origin: portalOrigin }),
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
          headers: new Headers({ host: "portal.travelos.test" }),
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
