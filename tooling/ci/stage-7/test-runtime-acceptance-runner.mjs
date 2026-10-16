import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import {
  readStage7RuntimeCredentials,
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
    await writeFile(path.join(credentialDirectory, name), `synthetic-${name}`);

  const credentials = await readStage7RuntimeCredentials({ manifest, credentialDirectory });
  assert.deepEqual(Object.keys(credentials).sort(), [
    "portalDatabasePassword",
    "portalRealmKey",
    "staffEmail",
    "staffPassword",
    "staffTotpCode",
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

  const adminCalls = [];
  const portalCalls = [];
  let granted = false;
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
        request.body.code === "synthetic-stage7-staff-totp",
        "Staff MFA uses CREDENTIALS_DIRECTORY input",
      );
      return {
        status: 200,
        headers: { "set-cookie": ["travelos-dev-staff-session=staff-session; HttpOnly"] },
        body: { status: true },
      };
    }
    if (request.path === "/api/staff/session-context") {
      return {
        status: 200,
        headers: {},
        body: { principalId: "staff-1", agencyId: "agency-1", recentMfaVerifiedAtEpochMs: 1 },
      };
    }
    if (request.path === "/api/admin/trips" && request.method === "POST") {
      return {
        status: 201,
        headers: {},
        body: {
          trip: { id: "trip-1", agencyId: "agency-1" },
          accommodations: [{ id: "accommodation-1", lockVersion: "0" }],
        },
      };
    }
    if (request.path.endsWith("/publication-preview")) {
      return {
        status: 200,
        headers: {},
        body: { workspaceRevision: "1", projectionHash: "a".repeat(64), projection: {} },
      };
    }
    if (request.path.endsWith("/publications")) {
      return { status: 200, headers: {}, body: { tripId: "trip-1", isActive: true } };
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
    if (request.path === "/api/auth/staff/sign-out") return { status: 200, headers: {}, body: {} };
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
    if (request.path === "/api/auth/portal/sign-out") return { status: 200, headers: {}, body: {} };
    if (request.method === "GET" && request.cookie === undefined)
      return { status: 401, headers: {}, body: undefined };
    if (request.method === "GET" && !granted) {
      return { status: 404, headers: {}, body: undefined };
    }
    if (request.method === "GET") return { status: 200, headers: {}, body: snapshot };
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
    makeUuid: () => "00000000-0000-4000-8000-000000000001",
    makePassword: () => "EPHEMERAL_PASSWORD_DO_NOT_LOG",
  });
  assert.equal(result.result, "PASS");
  assert.ok(
    Object.values(credentials).every((value) => value === ""),
    "Credential buffers must be cleared after acceptance",
  );
  assert.equal(result.stage8Actions, 0);
  assert.equal(enrolledEmail, "stage7-00000000-0000-4000-8000-000000000001@example.test");
  assert.ok(adminCalls.some((call) => call.path.includes("/publications")));
  assert.ok(adminCalls.some((call) => call.path.includes("/portal-access-grants")));
  assert.ok(portalCalls.some((call) => call.path === "/api/auth/portal/sign-out"));
  assert.equal(JSON.stringify(result).includes("EPHEMERAL_PASSWORD_DO_NOT_LOG"), false);
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
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ result: "PASS", cases: 5 })}\n`);
