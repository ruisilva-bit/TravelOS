import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import {
  createRuntimeTotpGenerator,
  readStage7RuntimeCredentials,
  requirePortalPrivilegeDenial,
  resolveRuntimePackageImport,
  runStage7RuntimeAcceptance,
} from "./runtime-acceptance-runner.mjs";

const manifest = {
  environment: "DEVELOPMENT",
  authentication: {
    portalRealmCredentialReference: "systemd-credential:portal-auth-realm",
  },
  database: {
    runtimeRoles: {
      portalApi: { credentialReference: "systemd-credential:portal-api-db" },
    },
  },
};

const makePrivilegeProbeDatabase = (error) => ({
  selectFrom: () => ({
    select: () => ({
      executeTakeFirst: async () => {
        throw error;
      },
    }),
  }),
});
const expectedPrivilegeDenial = Object.assign(new Error("synthetic privilege denial"), {
  code: "42501",
});
await requirePortalPrivilegeDenial(
  makePrivilegeProbeDatabase(expectedPrivilegeDenial),
  "trip_ops.trip",
  "title",
);
const unexpectedDatabaseError = Object.assign(new Error("synthetic database diagnostic"), {
  code: "XX000",
});
await assert.rejects(
  requirePortalPrivilegeDenial(
    makePrivilegeProbeDatabase(unexpectedDatabaseError),
    "trip_ops.trip",
    "title",
  ),
  (error) => {
    assert.equal(error.message, "Portal database privilege probe returned an unexpected result");
    assert.equal(error.cause, unexpectedDatabaseError);
    assert.equal(error.message.includes(unexpectedDatabaseError.message), false);
    return true;
  },
);

const task6Cases = [];
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "stage7-runner-credentials-"));
try {
  const runtimeRoot = path.join(temporaryRoot, "release");
  const portalPackageRoot = path.join(runtimeRoot, "apps/portal-api");
  const configPackageRoot = path.join(portalPackageRoot, "node_modules/@travelos/config");
  await mkdir(path.join(configPackageRoot, "dist"), { recursive: true });
  await writeFile(
    path.join(configPackageRoot, "package.json"),
    JSON.stringify({ exports: { ".": { import: "./dist/index.js" } } }),
  );
  await writeFile(
    path.join(configPackageRoot, "dist/index.js"),
    'export const marker = "loaded";\n',
  );
  const configModule = await import(
    await resolveRuntimePackageImport({
      appRoot: portalPackageRoot,
      packageName: "@travelos/config",
    })
  );
  assert.equal(configModule.marker, "loaded");
  await assert.rejects(
    resolveRuntimePackageImport({
      appRoot: portalPackageRoot,
      packageName: "@travelos/auth-adapters",
      exportName: "./portal",
    }),
  );

  const credentialDirectory = path.join(temporaryRoot, "credentials");
  await mkdir(credentialDirectory);
  const names = [
    "portal-api-db",
    "portal-auth-realm",
    "stage7-staff-email",
    "stage7-staff-password",
    "stage7-staff-totp",
  ];
  for (const name of names)
    await writeFile(
      path.join(credentialDirectory, name),
      name === "stage7-staff-totp" ? "KN4W45DIMV2GSY2UN52HAU3FMNZGK5BRGIZQ" : `synthetic-${name}`,
      { mode: 0o600 },
    );

  const credentials = await readStage7RuntimeCredentials({ manifest, credentialDirectory });
  const makeTotp = await createRuntimeTotpGenerator(path.join(process.cwd(), "apps/portal-api"));
  assert.match(await makeTotp("KN4W45DIMV2GSY2UN52HAU3FMNZGK5BRGIZQ"), /^[0-9]{6}$/u);
  await assert.rejects(makeTotp("123456"), /Invalid Staff TOTP seed/u);
  assert.deepEqual(Object.keys(credentials).sort(), [
    "portalDatabasePassword",
    "portalRealmKey",
    "staffEmail",
    "staffPassword",
    "staffTotpSeed",
  ]);
  assert.ok(
    Object.values(credentials).every((value) => typeof value === "string" && value.length > 0),
  );

  await assert.rejects(
    readStage7RuntimeCredentials({ manifest, credentialDirectory: "relative/credentials" }),
    /absolute CREDENTIALS_DIRECTORY/u,
  );
  await assert.rejects(
    readStage7RuntimeCredentials({
      manifest,
      credentialDirectory: path.join(temporaryRoot, "missing"),
    }),
    (error) => {
      assert.equal(error.message.includes("synthetic-stage7-staff-password"), false);
      return /required operator credentials/iu.test(error.message);
    },
  );
  await writeFile(path.join(credentialDirectory, "stage7-staff-totp"), "123456", { mode: 0o600 });
  await assert.rejects(
    readStage7RuntimeCredentials({ manifest, credentialDirectory }),
    /required operator credentials are invalid/iu,
    "An expiring six-digit TOTP code must not be accepted as a reusable secret",
  );
  await writeFile(
    path.join(credentialDirectory, "stage7-staff-totp"),
    "KN4W45DIMV2GSY2UN52HAU3FMNZGK5BRGIZQ",
    { mode: 0o600 },
  );
  await rm(path.join(credentialDirectory, "stage7-staff-totp"));
  await symlink(
    path.join(temporaryRoot, "missing-target"),
    path.join(credentialDirectory, "stage7-staff-totp"),
  );
  await assert.rejects(
    readStage7RuntimeCredentials({ manifest, credentialDirectory }),
    /required operator credentials are unavailable/iu,
  );
  await rm(path.join(credentialDirectory, "stage7-staff-totp"));
  await writeFile(
    path.join(credentialDirectory, "stage7-staff-totp"),
    "KN4W45DIMV2GSY2UN52HAU3FMNZGK5BRGIZQ",
    { mode: 0o600 },
  );

  const adminCalls = [];
  const portalCalls = [];
  const lifecycleEvents = [];
  let granted = false;
  let grantRevoked = false;
  let createdTripCount = 0;
  let previewCount = 0;
  let publicationCount = 0;
  let portalSignedOut = false;
  let staffSignedOut = false;
  const snapshot = {
    schemaVersion: 1,
    trip: {
      title: "Stage 7 synthetic acceptance 00000000-0000-7000-8000-000000000001",
      startDate: "2030-06-01",
      endDate: "2030-06-04",
    },
    items: [
      { kind: "FLIGHT", description: "Stage 7 acceptance fixture" },
      { kind: "ACCOMMODATION", description: "Published description before workspace edit" },
    ],
  };
  const snapshotV2 = {
    ...snapshot,
    trip: { ...snapshot.trip },
    items: snapshot.items.map((item) => ({ ...item })),
  };
  snapshotV2.items[1].title = "Synthetic accommodation changed after publication";
  let totpGeneratedAfterChallenge = false;
  const adminRequest = async (request) => {
    adminCalls.push(request);
    if (request.path === "/api/auth/staff/sign-in/email") {
      assert.ok(
        request.body.password === "synthetic-stage7-staff-password",
        "Staff sign-in uses CREDENTIALS_DIRECTORY input",
      );
      return {
        status: 200,
        headers: { "set-cookie": ["staff-challenge=temporary; HttpOnly"] },
        body: { twoFactorRedirect: true },
      };
    }
    if (request.path === "/api/auth/staff/two-factor/verify-totp") {
      assert.ok(
        request.body.code === "654321" && totpGeneratedAfterChallenge,
        "Staff MFA uses CREDENTIALS_DIRECTORY input",
      );
      return {
        status: 200,
        headers: { "set-cookie": ["travelos-dev-staff-session=staff-session; HttpOnly"] },
        body: { status: true },
      };
    }
    if (request.path === "/api/staff/session-context") {
      if (staffSignedOut) return { status: 401, headers: {}, body: undefined };
      return {
        status: 200,
        headers: {},
        body: { principalId: "staff-1", agencyId: "agency-1", recentMfaVerifiedAtEpochMs: 1 },
      };
    }
    if (request.path === "/api/admin/trips" && request.method === "POST") {
      createdTripCount += 1;
      return {
        status: 201,
        headers: {},
        body: {
          trip: { id: `trip-${createdTripCount}`, agencyId: "agency-1" },
          accommodations: [{ id: `accommodation-${createdTripCount}`, lockVersion: "0" }],
        },
      };
    }
    if (request.path.endsWith("/publication-preview")) {
      previewCount += 1;
      return {
        status: 200,
        headers: {},
        body: {
          workspaceRevision: String(previewCount),
          projectionHash: (previewCount === 1 ? "a" : "b").repeat(64),
          projection: previewCount === 1 ? snapshot : snapshotV2,
        },
      };
    }
    if (request.path.endsWith("/publications")) {
      if (request.method === "GET") {
        return {
          status: 200,
          headers: {},
          body: {
            entries: [
              { version: 1, projectionHash: "a".repeat(64) },
              { version: 2, projectionHash: "b".repeat(64) },
            ],
          },
        };
      }
      publicationCount += 1;
      return {
        status: 200,
        headers: {},
        body: {
          publicationId: `publication-${publicationCount}`,
          tripId: "trip-1",
          version: publicationCount,
          isActive: true,
          projectionHash: (publicationCount === 1 ? "a" : "b").repeat(64),
          projection: publicationCount === 1 ? snapshot : snapshotV2,
        },
      };
    }
    if (request.path.endsWith("/portal-access-grants") && request.method === "POST") {
      granted = true;
      return {
        status: 201,
        headers: {},
        body: { grantId: "grant-1", portalPrincipalId: "portal-1", tripId: "trip-1" },
      };
    }
    if (request.path.endsWith("/revocations")) {
      granted = false;
      grantRevoked = true;
      return { status: 200, headers: {}, body: { revokedAt: "2030-06-01T00:00:00Z" } };
    }
    if (request.path.includes("/portal-access-grants/") && request.method === "POST") {
      return { status: 200, headers: {}, body: { revokedAt: "2030-06-01T00:00:00Z" } };
    }
    if (request.path.includes("/itinerary/accommodations/") && request.method === "PATCH") {
      return { status: 200, headers: {}, body: {} };
    }
    if (request.path === "/api/auth/staff/sign-out") {
      lifecycleEvents.push("staff-sign-out");
      staffSignedOut = true;
      return { status: 200, headers: {}, body: {} };
    }
    if (
      request.path.startsWith("/api/admin/runtime-acceptance-fixtures/") &&
      request.path.endsWith("/cleanup")
    ) {
      const fixtureRunId = request.path.split("/").at(-2);
      lifecycleEvents.push(`fixture-cleanup:${fixtureRunId}`);
      return {
        status: 200,
        headers: {},
        body: {
          fixtureRunId,
          state: "CLEANED",
          counts: {
            grantsRevoked: 1,
            publicationsWithdrawn: 1,
            tripsCancelled: 2,
            principalsRetired: 1,
          },
          retainedHistoryCounts: { publicationSnapshots: 2, auditRecords: 5 },
          errorCode: null,
        },
      };
    }
    throw new Error(`Unexpected Admin request ${request.method} ${request.path}`);
  };
  const portalRequest = async (request) => {
    portalCalls.push(request);
    if (request.path === "/api/auth/portal/sign-in/email") {
      assert.ok(
        request.body.password === "EPHEMERAL_PASSWORD_DO_NOT_LOG",
        "Portal sign-in uses only generated temporary password",
      );
      return {
        status: 200,
        headers: { "set-cookie": ["travelos-dev-portal-session=portal-session; HttpOnly"] },
        body: {},
      };
    }
    if (request.path === "/api/auth/portal/sign-out") {
      lifecycleEvents.push("portal-sign-out");
      portalSignedOut = true;
      return { status: 200, headers: {}, body: {} };
    }
    if (request.path === "/api/auth/portal/get-session") {
      return {
        status: 200,
        headers: {},
        body: portalSignedOut ? { session: null, user: null } : { session: {}, user: {} },
      };
    }
    if (request.method === "GET" && request.cookie === undefined)
      return { status: 401, headers: {}, body: undefined };
    if (request.method === "GET" && request.path.endsWith("/trip-2"))
      return { status: 404, headers: {}, body: undefined };
    if (request.method === "GET" && grantRevoked)
      return { status: 401, headers: {}, body: undefined };
    if (request.method === "GET" && !granted) {
      return { status: 404, headers: {}, body: undefined };
    }
    if (request.method === "GET")
      return { status: 200, headers: {}, body: publicationCount >= 2 ? snapshotV2 : snapshot };
    throw new Error(`Unexpected Portal request ${request.method} ${request.path}`);
  };
  let enrolledEmail;
  let enrolledFixtureRunId;
  const result = await runStage7RuntimeAcceptance({
    manifest: {
      environment: "DEVELOPMENT",
      hosts: { admin: "admin.travelos.test", portal: "portal.travelos.test" },
      runtime: {
        listeners: {
          adminApi: { host: "127.0.0.1", port: 3101 },
          portalApi: { host: "127.0.0.1", port: 3102 },
        },
      },
    },
    credentials,
    requestAdmin: adminRequest,
    requestPortal: portalRequest,
    enrollment: {
      async enroll(input) {
        enrolledEmail = input.email;
        enrolledFixtureRunId = input.fixtureRunId;
        return { portalPrincipalId: "portal-1" };
      },
    },
    readImmutablePublication: async ({ tripId, version }) => {
      assert.equal(tripId, "trip-1");
      assert.equal(version, 1);
      return { projectionHash: "a".repeat(64), canonicalPayload: JSON.stringify(snapshot) };
    },
    makeUuid: () => "00000000-0000-7000-8000-000000000001",
    makePassword: () => "EPHEMERAL_PASSWORD_DO_NOT_LOG",
    makeStaffTotpCode: async (seed) => {
      assert.equal(seed, "KN4W45DIMV2GSY2UN52HAU3FMNZGK5BRGIZQ");
      assert.equal(adminCalls.at(-1)?.path, "/api/auth/staff/sign-in/email");
      totpGeneratedAfterChallenge = true;
      return "654321";
    },
  });
  assert.equal(result.result, "PASS");
  assert.ok(
    Object.values(credentials).every((value) => value === ""),
    "Credential buffers must be cleared after acceptance",
  );
  assert.equal(result.stage8Actions, 0);
  assert.ok(result.probes.includes("cross-trip-access-denied"));
  assert.ok(result.probes.includes("publication-v2-visible-v1-immutable"));
  assert.ok(result.probes.includes("portal-access-grant-revocation-http-200"));
  assert.ok(result.probes.includes("portal-access-grant-revocation-revoked-at-string"));
  assert.ok(result.probes.includes("portal-trip-read-after-revocation-http-401"));
  assert.ok(result.probes.includes("portal-session-revoked-after-sign-out"));
  assert.ok(result.probes.includes("staff-session-revoked-after-sign-out"));
  assert.equal(
    enrolledEmail,
    ["stage7-00000000-0000-7000-8000-000000000001", "example.test"].join("@"),
  );
  const fixtureTripCalls = adminCalls.filter(
    (call) => call.path === "/api/admin/trips" && call.method === "POST",
  );
  assert.equal(fixtureTripCalls.length, 2);
  const initialFixtureRunId = fixtureTripCalls[0].fixtureRunId;
  assert.match(
    initialFixtureRunId ?? "",
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  assert.ok(fixtureTripCalls.every((call) => call.fixtureRunId === initialFixtureRunId));
  assert.equal(enrolledFixtureRunId, initialFixtureRunId);
  const cleanupEventIndex = lifecycleEvents.indexOf(`fixture-cleanup:${initialFixtureRunId}`);
  const staffSignOutEventIndex = lifecycleEvents.indexOf("staff-sign-out");
  assert.ok(cleanupEventIndex >= 0, "Fixture cleanup must run on successful acceptance");
  assert.ok(
    cleanupEventIndex < staffSignOutEventIndex,
    "Fixture cleanup must run before Staff sign-out",
  );
  assert.ok(adminCalls.some((call) => call.path.includes("/publications")));
  assert.ok(adminCalls.some((call) => call.path.includes("/portal-access-grants")));
  assert.ok(portalCalls.some((call) => call.path === "/api/auth/portal/sign-out"));
  assert.equal(JSON.stringify(result).includes("EPHEMERAL_PASSWORD_DO_NOT_LOG"), false);
  assert.equal(JSON.stringify(result).includes("KN4W45DIMV2GSY2UN52HAU3FMNZGK5BRGIZQ"), false);
  task6Cases.push("usesOneRunIdForBothTripsAndPortalEnrollment");
  const minimalManifest = {
    environment: "DEVELOPMENT",
    runtime: {
      listeners: {
        adminApi: { host: "127.0.0.1", port: 3101 },
        portalApi: { host: "127.0.0.1", port: 3102 },
      },
    },
  };
  const successfulTripResponse = (index) => ({
    status: 201,
    headers: {},
    body: {
      trip: { id: `trip-${index}`, agencyId: "agency-1" },
      accommodations: [{ id: `accommodation-${index}`, lockVersion: "0" }],
    },
  });
  const cleanFixtureResponse = (fixtureRunId) => ({
    status: 200,
    headers: {},
    body: {
      fixtureRunId,
      state: "CLEANED",
      counts: {
        grantsRevoked: 0,
        publicationsWithdrawn: 0,
        tripsCancelled: 1,
        principalsRetired: 0,
      },
      retainedHistoryCounts: { publicationSnapshots: 0, auditRecords: 1 },
      errorCode: null,
    },
  });
  const makeMinimalScenario = async ({
    uuidValues,
    onTripCreate,
    onCleanup,
    totpCodes = ["111111", "222222", "333333"],
  }) => {
    const scenarioCredentials = await readStage7RuntimeCredentials({
      manifest,
      credentialDirectory,
    });
    const ids = uuidValues === undefined ? [] : [...uuidValues];
    const makeUuid =
      uuidValues === undefined
        ? undefined
        : () => {
            const value = ids.shift();
            assert.ok(value !== undefined, "Test UUID sequence exhausted");
            return value;
          };
    const events = [];
    const adminRequests = [];
    const signedOutCookies = new Set();
    let challengeCount = 0;
    let tripCreateCount = 0;
    let cleanupCount = 0;
    const requestAdmin = async (request) => {
      adminRequests.push(request);
      if (request.path === "/api/auth/staff/sign-in/email") {
        assert.equal(
          request.cookie,
          undefined,
          "A fresh Staff sign-in must not reuse an old session cookie",
        );
        challengeCount += 1;
        events.push(`staff-challenge:${challengeCount}`);
        return {
          status: 200,
          headers: { "set-cookie": [`staff-challenge=challenge-${challengeCount}; HttpOnly`] },
          body: { twoFactorRedirect: true },
        };
      }
      if (request.path === "/api/auth/staff/two-factor/verify-totp") {
        assert.equal(request.body.code, totpCodes[challengeCount - 1]);
        events.push(`staff-mfa-verified:${challengeCount}`);
        return {
          status: 200,
          headers: {
            "set-cookie": [`travelos-dev-staff-session=staff-session-${challengeCount}; HttpOnly`],
          },
          body: { status: true },
        };
      }
      if (request.path === "/api/staff/session-context") {
        if (signedOutCookies.has(request.cookie))
          return { status: 401, headers: {}, body: undefined };
        return {
          status: 200,
          headers: {},
          body: {
            principalId: "staff-1",
            agencyId: "agency-1",
            recentMfaVerifiedAtEpochMs: 1,
          },
        };
      }
      if (request.path === "/api/admin/trips" && request.method === "POST") {
        tripCreateCount += 1;
        events.push(`trip-create:${tripCreateCount}:${request.fixtureRunId ?? "missing"}`);
        return onTripCreate(request, tripCreateCount);
      }
      if (
        request.path.startsWith("/api/admin/runtime-acceptance-fixtures/") &&
        request.path.endsWith("/cleanup")
      ) {
        cleanupCount += 1;
        const fixtureRunId = request.path.split("/").at(-2);
        events.push(`fixture-cleanup:${fixtureRunId}`);
        return onCleanup(request, cleanupCount, fixtureRunId);
      }
      if (request.path === "/api/auth/staff/sign-out") {
        signedOutCookies.add(request.cookie);
        events.push("staff-sign-out");
        return { status: 200, headers: {}, body: {} };
      }
      throw new Error(`Unexpected minimal Admin request ${request.method} ${request.path}`);
    };
    const makeStaffTotpCode = async (seed) => {
      assert.equal(seed, "KN4W45DIMV2GSY2UN52HAU3FMNZGK5BRGIZQ");
      assert.equal(events.at(-1), `staff-challenge:${challengeCount}`);
      events.push(`totp-generated:${challengeCount}`);
      return totpCodes[challengeCount - 1];
    };
    return {
      adminRequests,
      credentials: scenarioCredentials,
      events,
      run: () =>
        runStage7RuntimeAcceptance({
          manifest: minimalManifest,
          credentials: scenarioCredentials,
          requestAdmin,
          requestPortal: async () => {
            throw new Error("Minimal acceptance scenario must not reach Portal API");
          },
          enrollment: { enroll: async () => ({ portalPrincipalId: "unused" }) },
          makeStaffTotpCode,
          readImmutablePublication: async () => null,
          ...(makeUuid === undefined ? {} : { makeUuid }),
        }),
    };
  };
  const captureFailure = async (scenario) => {
    try {
      await scenario.run();
    } catch (error) {
      assert.ok(Object.values(scenario.credentials).every((value) => value === ""));
      return error;
    }
    assert.fail("Expected the synthetic acceptance scenario to fail");
  };

  const attemptsCleanupBeforeSignOutOnSuccessAndFailure = async () => {
    const scenario = await makeMinimalScenario({
      onTripCreate: async () => {
        throw Object.assign(new Error("synthetic timeout"), { code: "SYNTHETIC_TIMEOUT" });
      },
      onCleanup: async () => ({ status: 404, headers: {}, body: { error: "NOT_FOUND" } }),
    });
    const failure = await captureFailure(scenario);
    assert.equal(
      failure.message,
      "Stage 7 runtime acceptance failed; sensitive values were not retained",
    );
    const cleanupIndex = scenario.events.findIndex((event) => event.startsWith("fixture-cleanup:"));
    const signOutIndex = scenario.events.indexOf("staff-sign-out");
    const createdRunId = scenario.adminRequests.find(
      (request) => request.path === "/api/admin/trips" && request.method === "POST",
    )?.fixtureRunId;
    assert.match(
      createdRunId ?? "",
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      "The runner must generate a valid UUIDv7 fixture run ID",
    );
    assert.ok(scenario.events.includes(`fixture-cleanup:${createdRunId}`));
    assert.ok(cleanupIndex >= 0, "A timed-out first Trip create must trigger cleanup");
    assert.ok(cleanupIndex < signOutIndex, "Cleanup must precede Staff sign-out after failure");
    assert.equal(failure.cleanupCode, undefined, "NOT_FOUND is a clean cleanup no-op");

    const assertionScenario = await makeMinimalScenario({
      uuidValues: ["00000000-0000-7000-8000-000000000020"],
      onTripCreate: async (_request, index) =>
        index === 1
          ? successfulTripResponse(index)
          : { status: 500, headers: {}, body: { error: "synthetic" } },
      onCleanup: async (_request, _index, fixtureRunId) => cleanFixtureResponse(fixtureRunId),
    });
    const assertionFailure = await captureFailure(assertionScenario);
    assert.equal(assertionFailure.code, "ERR_ASSERTION");
    const assertionRunId = assertionScenario.adminRequests.find(
      (request) => request.path === "/api/admin/trips" && request.method === "POST",
    )?.fixtureRunId;
    const assertionCleanup = assertionScenario.adminRequests.find(
      (request) =>
        request.path === `/api/admin/runtime-acceptance-fixtures/${assertionRunId}/cleanup`,
    );
    assert.equal(
      assertionCleanup?.cookie,
      "travelos-dev-staff-session=staff-session-1",
      "Cleanup must use the authenticated Staff session",
    );
    assert.ok(
      assertionScenario.events.indexOf(`fixture-cleanup:${assertionRunId}`) <
        assertionScenario.events.indexOf("staff-sign-out"),
      "A thrown acceptance assertion must clean up before Staff sign-out",
    );
  };
  await attemptsCleanupBeforeSignOutOnSuccessAndFailure();
  task6Cases.push("attemptsCleanupBeforeSignOutOnSuccessAndFailure");

  const retriesWithFreshMfaAfterExpiredSession = async () => {
    const scenario = await makeMinimalScenario({
      uuidValues: ["00000000-0000-7000-8000-000000000012"],
      onTripCreate: async (_request, index) => {
        if (index === 1) return successfulTripResponse(index);
        throw Object.assign(new Error("synthetic assertion failure"), {
          code: "SYNTHETIC_ACCEPTANCE_FAILURE",
        });
      },
      onCleanup: async (_request, index) =>
        index === 1
          ? { status: 401, headers: {}, body: undefined }
          : { status: 404, headers: {}, body: { error: "NOT_FOUND" } },
    });
    await captureFailure(scenario);
    assert.equal(
      scenario.events.filter((event) => event.startsWith("staff-challenge:")).length,
      2,
      "An expired Staff session must be replaced with a fresh MFA challenge",
    );
    assert.deepEqual(
      scenario.events.filter((event) => event.startsWith("totp-generated:")),
      ["totp-generated:1", "totp-generated:2"],
    );
    assert.ok(
      scenario.events.indexOf("staff-challenge:2") < scenario.events.indexOf("totp-generated:2"),
      "A new TOTP must be calculated only after the new challenge",
    );
    assert.ok(scenario.events.includes("staff-mfa-verified:2"));
  };
  await retriesWithFreshMfaAfterExpiredSession();
  task6Cases.push("retriesWithFreshMfaAfterExpiredSession");

  const cleansCreatorPendingRunBeforeStartingFreshRun = async () => {
    const priorFixtureRunId = "00000000-0000-7000-8000-000000000013";
    const firstFixtureRunId = "00000000-0000-7000-8000-000000000014";
    const freshFixtureRunId = "00000000-0000-7000-8000-000000000015";
    const scenario = await makeMinimalScenario({
      uuidValues: [firstFixtureRunId, freshFixtureRunId],
      onTripCreate: async (_request, index) => {
        if (index === 1)
          return {
            status: 409,
            headers: {},
            body: {
              error: "runtime_acceptance_fixture_conflict",
              recoveryFixtureRunId: priorFixtureRunId,
            },
          };
        if (index === 2) return successfulTripResponse(index);
        throw Object.assign(new Error("synthetic stop after recovery"), {
          code: "SYNTHETIC_ACCEPTANCE_FAILURE",
        });
      },
      onCleanup: async (_request, _index, fixtureRunId) =>
        fixtureRunId === priorFixtureRunId
          ? cleanFixtureResponse(fixtureRunId)
          : { status: 404, headers: {}, body: { error: "NOT_FOUND" } },
    });
    await captureFailure(scenario);
    const tripCalls = scenario.adminRequests.filter(
      (request) => request.path === "/api/admin/trips" && request.method === "POST",
    );
    assert.equal(tripCalls.length, 3);
    assert.equal(tripCalls[0].fixtureRunId, firstFixtureRunId);
    assert.equal(tripCalls[1].fixtureRunId, freshFixtureRunId);
    assert.equal(tripCalls[2].fixtureRunId, freshFixtureRunId);
    assert.ok(
      scenario.events.indexOf(`fixture-cleanup:${priorFixtureRunId}`) <
        scenario.events.indexOf(`trip-create:2:${freshFixtureRunId}`),
      "The prior creator-owned run must be cleaned before retrying with a fresh UUID",
    );
  };
  await cleansCreatorPendingRunBeforeStartingFreshRun();
  task6Cases.push("cleansCreatorPendingRunBeforeStartingFreshRun");

  const cleanupFailureReturnsNonzeroAndDoesNotStartAnotherRun = async () => {
    const priorFixtureRunId = "00000000-0000-7000-8000-000000000016";
    const scenario = await makeMinimalScenario({
      uuidValues: ["00000000-0000-7000-8000-000000000017", "00000000-0000-7000-8000-000000000018"],
      onTripCreate: async () => ({
        status: 409,
        headers: {},
        body: {
          error: "runtime_acceptance_fixture_conflict",
          recoveryFixtureRunId: priorFixtureRunId,
        },
      }),
      onCleanup: async (_request, _index, fixtureRunId) =>
        fixtureRunId === priorFixtureRunId
          ? {
              status: 200,
              headers: {},
              body: {
                ...cleanFixtureResponse(fixtureRunId).body,
                state: "CLEANUP_PENDING",
                errorCode: "CLEANUP_STEP_FAILED",
              },
            }
          : { status: 404, headers: {}, body: { error: "NOT_FOUND" } },
    });
    const failure = await captureFailure(scenario);
    assert.equal(failure.cleanupCode, "CLEANUP_STEP_FAILED");
    assert.equal(
      scenario.adminRequests.filter((request) => request.path === "/api/admin/trips").length,
      1,
      "A new run must not start after failed recovery cleanup",
    );
    assert.ok(scenario.events.includes("staff-sign-out"));

    const notFoundScenario = await makeMinimalScenario({
      uuidValues: ["00000000-0000-7000-8000-000000000017", "00000000-0000-7000-8000-000000000018"],
      onTripCreate: async () => ({
        status: 409,
        headers: {},
        body: {
          error: "runtime_acceptance_fixture_conflict",
          recoveryFixtureRunId: priorFixtureRunId,
        },
      }),
      onCleanup: async () => ({ status: 404, headers: {}, body: { error: "NOT_FOUND" } }),
    });
    const notFoundFailure = await captureFailure(notFoundScenario);
    assert.equal(notFoundFailure.code, "RUNTIME_ACCEPTANCE_FIXTURE_CONFLICT");
    assert.equal(notFoundFailure.cleanupCode, "STAGE7_RUNTIME_ACCEPTANCE_CLEANUP_FAILED");
    assert.equal(
      notFoundScenario.adminRequests.filter(
        (request) => request.path === "/api/admin/trips" && request.method === "POST",
      ).length,
      1,
      "A prior run returning generic NOT_FOUND must not be treated as cleaned",
    );
  };
  await cleanupFailureReturnsNonzeroAndDoesNotStartAnotherRun();
  task6Cases.push("cleanupFailureReturnsNonzeroAndDoesNotStartAnotherRun");

  const runnerOutputContainsNoSecretValues = async () => {
    const scenario = await makeMinimalScenario({
      uuidValues: ["00000000-0000-7000-8000-000000000019"],
      onTripCreate: async () => {
        throw Object.assign(new Error("EPHEMERAL_PASSWORD_DO_NOT_LOG"), {
          code: "SYNTHETIC_ACCEPTANCE_FAILURE",
        });
      },
      onCleanup: async (_request, _index, fixtureRunId) => ({
        status: 200,
        headers: {},
        body: {
          ...cleanFixtureResponse(fixtureRunId).body,
          state: "CLEANUP_PENDING",
          errorCode: "CLEANUP_STEP_FAILED",
        },
      }),
    });
    const failure = await captureFailure(scenario);
    assert.equal(failure.code, "SYNTHETIC_ACCEPTANCE_FAILURE");
    assert.equal(failure.cleanupCode, "CLEANUP_STEP_FAILED");
    const sanitized = JSON.stringify({
      message: failure.message,
      code: failure.code,
      cleanupCode: failure.cleanupCode,
      completedProbes: failure.completedProbes,
    });
    for (const secret of [
      "EPHEMERAL_PASSWORD_DO_NOT_LOG",
      "synthetic-stage7-staff-password",
      "KN4W45DIMV2GSY2UN52HAU3FMNZGK5BRGIZQ",
      "111111",
      "staff-session-1",
    ]) {
      assert.equal(sanitized.includes(secret), false);
    }
  };
  await runnerOutputContainsNoSecretValues();
  task6Cases.push("runnerOutputContainsNoSecretValues");
  const failClosedCredentials = await readStage7RuntimeCredentials({
    manifest,
    credentialDirectory,
  });
  await assert.rejects(
    runStage7RuntimeAcceptance({
      manifest: {
        environment: "DEVELOPMENT",
        runtime: {
          listeners: {
            adminApi: { host: "127.0.0.1", port: 3101 },
            portalApi: { host: "127.0.0.1", port: 3102 },
          },
        },
      },
      credentials: failClosedCredentials,
      requestAdmin: async () => ({
        status: 200,
        headers: { "set-cookie": ["travelos-dev-staff-session=unverified; HttpOnly"] },
        body: { twoFactorRedirect: false },
      }),
      requestPortal: async () => {
        throw new Error("Must never reach Portal API");
      },
      enrollment: {
        enroll: async () => {
          throw new Error("Must never enroll");
        },
      },
      makeStaffTotpCode: async () => {
        throw new Error("Must never generate TOTP");
      },
    }),
    (error) =>
      error.message === "Stage 7 runtime acceptance failed; sensitive values were not retained",
  );
  assert.ok(Object.values(failClosedCredentials).every((value) => value === ""));
  const progressCredentials = await readStage7RuntimeCredentials({ manifest, credentialDirectory });
  let diagnosticStaffSignedOut = false;
  const partialAdminRequest = async (request) => {
    if (request.path === "/api/auth/staff/sign-in/email") {
      return {
        status: 200,
        headers: { "set-cookie": ["staff-challenge=temporary; HttpOnly"] },
        body: { twoFactorRedirect: true },
      };
    }
    if (request.path === "/api/auth/staff/two-factor/verify-totp") {
      return {
        status: 200,
        headers: { "set-cookie": ["travelos-dev-staff-session=verified; HttpOnly"] },
        body: { status: true },
      };
    }
    if (request.path === "/api/auth/staff/sign-out") {
      diagnosticStaffSignedOut = true;
      return { status: 200, headers: {}, body: {} };
    }
    if (request.path === "/api/staff/session-context") {
      return diagnosticStaffSignedOut
        ? { status: 401, headers: {}, body: undefined }
        : { status: 200, headers: {}, body: {} };
    }
    throw new Error("Unexpected diagnostic Admin request");
  };
  await assert.rejects(
    runStage7RuntimeAcceptance({
      manifest: {
        ...manifest,
        runtime: {
          listeners: {
            adminApi: { host: "127.0.0.1", port: 3101 },
            portalApi: { host: "127.0.0.1", port: 3102 },
          },
        },
      },
      credentials: progressCredentials,
      requestAdmin: partialAdminRequest,
      requestPortal: async () => {
        throw new Error("Must not reach Portal API before Staff scope is confirmed");
      },
      enrollment: { enroll: async () => ({ portalPrincipalId: "unused" }) },
      makeStaffTotpCode: async () => "654321",
    }),
    (error) => {
      assert.equal(
        error.message,
        "Stage 7 runtime acceptance failed; sensitive values were not retained",
      );
      assert.deepEqual(error.completedProbes, [
        "staff-realm-authenticated-with-recent-mfa",
        "staff-session-context-http-200",
        "staff-session-context-agency-id-undefined",
        "staff-session-context-principal-id-undefined",
        "staff-session-context-mfa-undefined",
        "staff-session-revoked-after-sign-out",
      ]);
      return true;
    },
  );
  assert.ok(Object.values(progressCredentials).every((value) => value === ""));
  const grantRequest = adminCalls.find((call) => call.path.endsWith("/portal-access-grants"));
  const grantExpiresAt = Date.parse(grantRequest.body.expiresAt);
  assert.ok(Number.isFinite(grantExpiresAt) && grantExpiresAt > Date.now());
  assert.ok(
    grantExpiresAt <= Date.now() + 16 * 60_000,
    "Temporary Trip grant must have bounded expiry",
  );

  const runnerSource = await readFile(
    new URL("./runtime-acceptance-runner.mjs", import.meta.url),
    "utf8",
  );
  assert.match(runnerSource, /CREDENTIALS_DIRECTORY/u);
  assert.match(runnerSource, /x-travelos-acceptance-fixture-run/iu);
  assert.doesNotMatch(runnerSource, /\.(?:listen|createServer)\s*\(/u);
  assert.doesNotMatch(runnerSource, /node:child_process|\bspawn\s*\(/u);

  const operatorRelease = path.join(temporaryRoot, "operator-release");
  const operatorDirectory = path.join(operatorRelease, "operator");
  const configDirectory = path.join(
    operatorRelease,
    "apps/portal-api/node_modules/@travelos/config/dist",
  );
  await mkdir(operatorDirectory, { recursive: true });
  await mkdir(configDirectory, { recursive: true });
  await mkdir(path.join(operatorRelease, "deployment"));
  const operatorExtension = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      candidate: { generation: "gen13" },
      stage7Actions: 1,
      stage8Actions: 0,
    }),
  );
  await writeFile(
    path.join(operatorRelease, "deployment/stage-7-extension.v2.json"),
    operatorExtension,
  );
  const operatorReleaseMetadata = {
    artifactId: "travelos-phase-1-m1-stage-7-gen13-0015a8e1",
    source: {
      successorBaselineGeneration: "gen13",
      commit: "0015a8e1be16195d3333a8c9dfe53c107f83c30b",
    },
    stage7DeploymentContract: {
      path: "deployment/stage-7-extension.v2.json",
      sha256: createHash("sha256").update(operatorExtension).digest("hex"),
    },
  };
  await writeFile(
    path.join(operatorRelease, "release.json"),
    JSON.stringify(operatorReleaseMetadata),
  );
  await writeFile(
    path.join(operatorRelease, "apps/portal-api/node_modules/@travelos/config/package.json"),
    JSON.stringify({ exports: { ".": { import: "./dist/index.js" } } }),
  );
  await writeFile(
    path.join(configDirectory, "index.js"),
    'export const loadDevelopmentInstanceManifest = async () => { const error = new Error("fixture"); error.code = "ENOENT"; throw error; };\n',
  );
  await writeFile(path.join(operatorDirectory, "stage7-runtime-acceptance.mjs"), runnerSource);
  const operatorCurrent = path.join(temporaryRoot, "operator-current");
  await symlink(operatorRelease, operatorCurrent);
  const operatorCredentials = path.join(temporaryRoot, "operator-credentials");
  await mkdir(operatorCredentials);
  const symlinkRunner = spawnSync(
    process.execPath,
    [
      path.join(operatorCurrent, "operator/stage7-runtime-acceptance.mjs"),
      `--manifest=${path.join(temporaryRoot, "missing-development-manifest.json")}`,
    ],
    {
      cwd: temporaryRoot,
      encoding: "utf8",
      env: { ...process.env, CREDENTIALS_DIRECTORY: operatorCredentials },
    },
  );
  assert.equal(
    symlinkRunner.status,
    1,
    "A symlink-launched one-shot runner must never silently exit 0",
  );
  assert.equal(symlinkRunner.stdout, "");
  assert.match(symlinkRunner.stderr, /"result":"FAIL"/u);
  assert.match(symlinkRunner.stderr, /manifest validation/u);
  assert.match(symlinkRunner.stderr, /ENOENT/u);
  for (const mutation of [
    { ...operatorReleaseMetadata, artifactId: "travelos-phase-1-m1-stage-7-gen09-0015a8e1" },
    {
      ...operatorReleaseMetadata,
      source: { ...operatorReleaseMetadata.source, successorBaselineGeneration: "gen09" },
    },
    {
      ...operatorReleaseMetadata,
      stage7DeploymentContract: {
        ...operatorReleaseMetadata.stage7DeploymentContract,
        sha256: "0".repeat(64),
      },
    },
  ]) {
    await writeFile(path.join(operatorRelease, "release.json"), JSON.stringify(mutation));
    const rejected = spawnSync(
      process.execPath,
      [
        path.join(operatorCurrent, "operator/stage7-runtime-acceptance.mjs"),
        `--manifest=${path.join(temporaryRoot, "missing-development-manifest.json")}`,
      ],
      { cwd: temporaryRoot, encoding: "utf8" },
    );
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /artifact identity preflight/u);
    assert.doesNotMatch(rejected.stderr, /credential delivery/u);
  }
  task6Cases.push(
    "successor-cli-passes-identity-and-rejects-cross-generation-or-contract-tampering",
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(
  `${JSON.stringify({ result: "PASS", cases: 8 + task6Cases.length, task6Cases })}\n`,
);
