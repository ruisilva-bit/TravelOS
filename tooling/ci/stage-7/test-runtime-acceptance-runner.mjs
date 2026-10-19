import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  let granted = false;
  let createdTripCount = 0;
  let previewCount = 0;
  let publicationCount = 0;
  let portalSignedOut = false;
  let staffSignedOut = false;
  const snapshot = {
    schemaVersion: 1,
    trip: {
      title: "Stage 7 synthetic acceptance 00000000-0000-4000-8000-000000000001",
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
      return { status: 200, headers: {}, body: { revokedAt: "2030-06-01T00:00:00Z" } };
    }
    if (request.path.includes("/portal-access-grants/") && request.method === "POST") {
      return { status: 200, headers: {}, body: { revokedAt: "2030-06-01T00:00:00Z" } };
    }
    if (request.path.includes("/itinerary/accommodations/") && request.method === "PATCH") {
      return { status: 200, headers: {}, body: {} };
    }
    if (request.path === "/api/auth/staff/sign-out") {
      staffSignedOut = true;
      return { status: 200, headers: {}, body: {} };
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
    if (request.method === "GET" && !granted) {
      return { status: 404, headers: {}, body: undefined };
    }
    if (request.method === "GET")
      return { status: 200, headers: {}, body: publicationCount >= 2 ? snapshotV2 : snapshot };
    throw new Error(`Unexpected Portal request ${request.method} ${request.path}`);
  };
  let enrolledEmail;
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
        return { portalPrincipalId: "portal-1" };
      },
    },
    readImmutablePublication: async ({ tripId, version }) => {
      assert.equal(tripId, "trip-1");
      assert.equal(version, 1);
      return { projectionHash: "a".repeat(64), canonicalPayload: JSON.stringify(snapshot) };
    },
    makeUuid: () => "00000000-0000-4000-8000-000000000001",
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
  assert.ok(result.probes.includes("portal-session-revoked-after-sign-out"));
  assert.ok(result.probes.includes("staff-session-revoked-after-sign-out"));
  assert.equal(
    enrolledEmail,
    ["stage7-00000000-0000-4000-8000-000000000001", "example.test"].join("@"),
  );
  assert.ok(adminCalls.some((call) => call.path.includes("/publications")));
  assert.ok(adminCalls.some((call) => call.path.includes("/portal-access-grants")));
  assert.ok(portalCalls.some((call) => call.path === "/api/auth/portal/sign-out"));
  assert.equal(JSON.stringify(result).includes("EPHEMERAL_PASSWORD_DO_NOT_LOG"), false);
  assert.equal(JSON.stringify(result).includes("KN4W45DIMV2GSY2UN52HAU3FMNZGK5BRGIZQ"), false);
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
  await writeFile(
    path.join(operatorRelease, "release.json"),
    JSON.stringify({
      artifactId: "travelos-phase-1-m1-stage-7-gen09-0015a8e1",
      source: { successorBaselineGeneration: "gen09" },
    }),
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
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ result: "PASS", cases: 8 })}\n`);
