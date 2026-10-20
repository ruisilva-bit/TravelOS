import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

const REQUIRED_CREDENTIALS = Object.freeze({
  portalDatabasePassword: "portal-api-db",
  portalRealmKey: "portal-auth-realm",
  staffEmail: "stage7-staff-email",
  staffPassword: "stage7-staff-password",
  staffTotpSeed: "stage7-staff-totp",
});
const SYSTEMD_REFERENCE_PREFIX = "systemd-credential:";
const MAX_RESPONSE_BYTES = 1_048_576;
const DEVELOPMENT_STAFF_COOKIE = "travelos-dev-staff-session";
const DEVELOPMENT_PORTAL_COOKIE = "travelos-dev-portal-session";
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const createUuidV7 = () => {
  const bytes = randomBytes(16);
  let timestamp = BigInt(Date.now());
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const text = bytes.toString("hex");
  return [
    text.slice(0, 8),
    text.slice(8, 12),
    text.slice(12, 16),
    text.slice(16, 20),
    text.slice(20),
  ].join("-");
};

const requireUuidV7 = (value, label) => {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    throw Object.assign(new Error(`${label} is invalid`), {
      code: "RUNTIME_ACCEPTANCE_FIXTURE_CONFLICT",
    });
  }
  return value;
};

const cleanCredentialName = (reference, expectedName) => {
  assert.equal(typeof reference, "string");
  assert.ok(reference.startsWith(SYSTEMD_REFERENCE_PREFIX));
  assert.equal(reference.slice(SYSTEMD_REFERENCE_PREFIX.length), expectedName);
  return expectedName;
};

export const readStage7RuntimeCredentials = async ({
  manifest,
  credentialDirectory = process.env.CREDENTIALS_DIRECTORY,
  readCredential = async (name, directory) => {
    const filePath = path.join(directory, name);
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("not-regular");
    return readFile(filePath, "utf8");
  },
}) => {
  if (manifest?.environment !== "DEVELOPMENT") {
    throw new Error("Stage 7 authenticated acceptance is restricted to DEVELOPMENT");
  }
  if (
    typeof credentialDirectory !== "string" ||
    !path.isAbsolute(credentialDirectory) ||
    path.resolve(credentialDirectory) !== credentialDirectory
  ) {
    throw new Error("An absolute CREDENTIALS_DIRECTORY is required");
  }
  const references = {
    portalDatabasePassword: manifest.database?.runtimeRoles?.portalApi?.credentialReference,
    portalRealmKey: manifest.authentication?.portalRealmCredentialReference,
    staffEmail: `${SYSTEMD_REFERENCE_PREFIX}${REQUIRED_CREDENTIALS.staffEmail}`,
    staffPassword: `${SYSTEMD_REFERENCE_PREFIX}${REQUIRED_CREDENTIALS.staffPassword}`,
    staffTotpSeed: `${SYSTEMD_REFERENCE_PREFIX}${REQUIRED_CREDENTIALS.staffTotpSeed}`,
  };
  const credentials = Object.create(null);
  for (const [key, expectedName] of Object.entries(REQUIRED_CREDENTIALS)) {
    let value;
    try {
      const name = cleanCredentialName(references[key], expectedName);
      value = await readCredential(name, credentialDirectory);
    } catch {
      for (const secretKey of Object.keys(credentials)) credentials[secretKey] = "";
      throw new Error("Required operator credentials are unavailable in CREDENTIALS_DIRECTORY");
    }
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
      for (const secretKey of Object.keys(credentials)) credentials[secretKey] = "";
      throw new Error("Required operator credentials are invalid");
    }
    credentials[key] = value.trim();
    if (credentials[key].length === 0) {
      for (const secretKey of Object.keys(credentials)) credentials[secretKey] = "";
      throw new Error("Required operator credentials are invalid");
    }
  }
  if (!/^[A-Z2-7]{16,128}$/u.test(credentials.staffTotpSeed)) {
    for (const secretKey of Object.keys(credentials)) credentials[secretKey] = "";
    throw new Error("Required operator credentials are invalid");
  }
  return credentials;
};

const statusIs = (response, expected, label) => {
  assert.equal(response.status, expected, `${label} returned unexpected status`);
};
const objectBody = (response, label) => {
  assert.ok(
    response.body !== null && typeof response.body === "object",
    `${label} body is invalid`,
  );
  return response.body;
};
const cookieHeaderFrom = (response, name) => {
  const setCookies = response.headers?.["set-cookie"] ?? response.headers?.getSetCookie?.() ?? [];
  const rows = Array.isArray(setCookies) ? setCookies : [setCookies];
  const prefix = `${name}=`;
  const matching = rows
    .map((row) => String(row).split(";", 1)[0])
    .find((row) => row.startsWith(prefix) && row.length > prefix.length);
  return matching ?? null;
};
const temporaryCookieHeaderFrom = (response) => {
  const setCookies = response.headers?.["set-cookie"] ?? response.headers?.getSetCookie?.() ?? [];
  const rows = Array.isArray(setCookies) ? setCookies : [setCookies];
  return rows
    .map((row) => String(row).split(";", 1)[0])
    .filter((row) => row.includes("=") && row.slice(row.indexOf("=") + 1).length > 0)
    .join("; ");
};
const requireCookie = (response, name, label) => {
  const cookie = cookieHeaderFrom(response, name);
  assert.ok(cookie !== null && cookie.length > name.length + 1, `${label} did not issue a session`);
  return cookie;
};
const requireStatus = (response, expected, label) => {
  statusIs(response, expected, label);
  return response;
};

export const signInStaff = async ({ requestAdmin, credentials, makeStaffTotpCode }) => {
  const signIn = await requestAdmin({
    method: "POST",
    path: "/api/auth/staff/sign-in/email",
    body: { email: credentials.staffEmail, password: credentials.staffPassword },
  });
  requireStatus(signIn, 200, "Staff sign-in");
  const signInBody = objectBody(signIn, "Staff sign-in");
  const unexpectedSession = cookieHeaderFrom(signIn, DEVELOPMENT_STAFF_COOKIE);
  if (unexpectedSession !== null) {
    await requestAdmin({
      method: "POST",
      path: "/api/auth/staff/sign-out",
      body: {},
      cookie: unexpectedSession,
    });
    throw new Error("Staff sign-in unexpectedly issued a session without MFA");
  }
  assert.equal(signInBody.twoFactorRedirect, true, "Staff sign-in did not complete MFA");
  const challengeCookie = temporaryCookieHeaderFrom(signIn);
  assert.ok(challengeCookie.length > 0, "Staff MFA challenge did not issue its temporary cookie");
  const code = await makeStaffTotpCode(credentials.staffTotpSeed);
  assert.match(code, /^[0-9]{6}$/u, "Staff MFA generator returned an invalid code");
  const verified = await requestAdmin({
    method: "POST",
    path: "/api/auth/staff/two-factor/verify-totp",
    body: { code },
    cookie: challengeCookie,
  });
  requireStatus(verified, 200, "Staff MFA verification");
  return requireCookie(verified, DEVELOPMENT_STAFF_COOKIE, "Staff MFA verification");
};

const signInPortal = async ({ requestPortal, email, password }) => {
  const response = await requestPortal({
    method: "POST",
    path: "/api/auth/portal/sign-in/email",
    body: { email, password },
  });
  requireStatus(response, 200, "Portal sign-in");
  return requireCookie(response, DEVELOPMENT_PORTAL_COOKIE, "Portal sign-in");
};

const tripSliceRequest = ({ agencyId, suffix, sentinel }) => ({
  agencyId,
  person: { givenName: "Stage", familyName: "Seven Acceptance", email: null },
  customer: { displayName: `Stage 7 synthetic customer ${suffix}` },
  customerPersonRole: "PRIMARY_CONTACT",
  trip: {
    title: `Stage 7 synthetic acceptance ${suffix}`,
    startDate: "2030-06-01",
    endDate: "2030-06-04",
    state: "DRAFT",
  },
  travellerRole: "PRIMARY_TRAVELLER",
  flight: {
    title: "Synthetic flight",
    description: "Stage 7 acceptance fixture",
    carrier: "Example Air",
    flightNumber: "EA700",
    departureAirport: "LIS",
    arrivalAirport: "OPO",
    departure: {
      localDate: "2030-06-01",
      localTime: "09:00",
      timezoneName: "Europe/Lisbon",
      instant: "2030-06-01T08:00:00Z",
    },
    arrival: {
      localDate: "2030-06-01",
      localTime: "10:00",
      timezoneName: "Europe/Lisbon",
      instant: "2030-06-01T09:00:00Z",
    },
    terminal: null,
    cabin: "ECONOMY",
    baggage: "Synthetic baggage",
    seat: null,
    customerBookingReference: null,
  },
  accommodation: {
    title: "Synthetic accommodation",
    description: "Published description before workspace edit",
    propertyName: "Example Hotel",
    checkIn: {
      localDate: "2030-06-01",
      localTime: "15:00",
      timezoneName: "Europe/Lisbon",
      instant: "2030-06-01T14:00:00Z",
    },
    checkOut: {
      localDate: "2030-06-04",
      localTime: "11:00",
      timezoneName: "Europe/Lisbon",
      instant: "2030-06-04T10:00:00Z",
    },
    roomDescription: "Synthetic room",
    boardType: "BREAKFAST",
    customerBookingReference: null,
  },
  reservation: {
    supplierName: "Synthetic supplier",
    supplierReference: `STAGE7-${suffix}`,
    customerBookingReference: null,
    state: "CONFIRMED",
  },
  supplierCost: {
    amount: { minorUnits: "12345", currency: "EUR", scale: 2 },
    internalNote: sentinel,
  },
});

const assertPortalSnapshot = (body, expectedTitle, sentinel) => {
  assert.deepEqual(Object.keys(body).sort(), ["items", "schemaVersion", "trip"]);
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.trip.title, expectedTitle);
  assert.ok(Array.isArray(body.items) && body.items.length === 2);
  assert.equal(
    JSON.stringify(body).includes(sentinel),
    false,
    "INTERNAL_ONLY sentinel leaked to Portal",
  );
  assert.equal(
    JSON.stringify(body).includes("supplierCost"),
    false,
    "Supplier cost field leaked to Portal",
  );
  assert.equal(
    JSON.stringify(body).includes("internalNote"),
    false,
    "Internal note field leaked to Portal",
  );
};

export const runStage7RuntimeAcceptance = async ({
  manifest,
  credentials,
  requestAdmin,
  requestPortal,
  enrollment,
  makeStaffTotpCode,
  readImmutablePublication,
  makeUuid = createUuidV7,
  makePassword = () => randomBytes(32).toString("base64url"),
}) => {
  assert.equal(manifest?.environment, "DEVELOPMENT", "Runtime acceptance is DEVELOPMENT-only");
  for (const listener of [
    manifest.runtime?.listeners?.adminApi,
    manifest.runtime?.listeners?.portalApi,
  ]) {
    assert.equal(
      listener?.host,
      "127.0.0.1",
      "Acceptance runner permits loopback API listeners only",
    );
    assert.ok(
      Number.isInteger(listener?.port) && listener.port > 0,
      "API listener port is invalid",
    );
  }
  assert.equal(typeof requestAdmin, "function");
  assert.equal(typeof requestPortal, "function");
  assert.equal(typeof enrollment?.enroll, "function");
  assert.equal(typeof makeStaffTotpCode, "function");
  const probes = [];
  let staffCookie;
  let portalCookie;
  let enrolledPrincipalId;
  let agencyId;
  let tripId;
  let ungrantedTripId;
  let issuedGrantId;
  let grantRevoked = false;
  let portalSignedOut = false;
  let staffSignedOut = false;
  let portalPassword;
  let failure;
  let cleanupFailure;
  let fixtureRunId;
  const staffAuthenticationRequest = (request) => {
    const cookie =
      request.cookie ??
      (request.path === "/api/auth/staff/sign-in/email" ? undefined : staffCookie);
    return requestAdmin({ ...request, cookie });
  };
  const cleanupError = (code = "STAGE7_RUNTIME_ACCEPTANCE_CLEANUP_FAILED") =>
    Object.assign(new Error("Runtime acceptance fixture cleanup failed"), {
      code,
      isRuntimeAcceptanceCleanupFailure: true,
    });
  const cleanupFixtureRun = async (runId, { allowNotFound = false } = {}) => {
    const targetRunId = requireUuidV7(runId, "Fixture run identifier");
    const sendCleanup = () =>
      requestAdmin({
        method: "POST",
        path: `/api/admin/runtime-acceptance-fixtures/${targetRunId}/cleanup`,
        body: { idempotencyKey: `stage7-runtime-cleanup-${randomUUID()}` },
        cookie: staffCookie,
      });
    let response;
    try {
      response = await sendCleanup();
    } catch {
      throw cleanupError();
    }
    if (response.status === 401) {
      try {
        staffCookie = await signInStaff({
          requestAdmin: staffAuthenticationRequest,
          credentials,
          makeStaffTotpCode,
        });
      } catch (error) {
        if (error?.isRuntimeAcceptanceCleanupFailure === true) throw error;
        throw cleanupError("STAFF_MFA_REAUTHENTICATION_FAILED");
      }
      try {
        response = await sendCleanup();
      } catch {
        throw cleanupError();
      }
    }
    if (response.status === 404) {
      if (!allowNotFound) throw cleanupError();
      probes.push("fixture-cleanup-not-found-noop");
      return "NOT_FOUND";
    }
    if (response.status !== 200) throw cleanupError();
    let receipt;
    try {
      receipt = objectBody(response, "Runtime acceptance fixture cleanup");
    } catch {
      throw cleanupError();
    }
    if (receipt.fixtureRunId !== targetRunId) throw cleanupError();
    if (receipt.state === "CLEANED" && receipt.errorCode === null) {
      probes.push("runtime-acceptance-fixture-cleaned");
      return "CLEANED";
    }
    if (
      receipt.state === "CLEANUP_PENDING" &&
      ["CLEANUP_STEP_FAILED", "UNEXPECTED_RESOURCE"].includes(receipt.errorCode)
    ) {
      throw cleanupError(receipt.errorCode);
    }
    throw cleanupError();
  };

  try {
    staffCookie = await signInStaff({
      requestAdmin: staffAuthenticationRequest,
      credentials,
      makeStaffTotpCode,
    });
    probes.push("staff-realm-authenticated-with-recent-mfa");

    const rawContextResponse = await requestAdmin({
      method: "GET",
      path: "/api/staff/session-context",
      cookie: staffCookie,
    });
    probes.push(`staff-session-context-http-${rawContextResponse.status}`);
    const contextResponse = requireStatus(rawContextResponse, 200, "Staff session context");
    const context = objectBody(contextResponse, "Staff session context");
    probes.push(`staff-session-context-agency-id-${typeof context.agencyId}`);
    probes.push(`staff-session-context-principal-id-${typeof context.principalId}`);
    probes.push(`staff-session-context-mfa-${typeof context.recentMfaVerifiedAtEpochMs}`);
    assert.equal(typeof context.agencyId, "string");
    assert.equal(typeof context.principalId, "string");
    assert.equal(typeof context.recentMfaVerifiedAtEpochMs, "number");
    agencyId = context.agencyId;
    probes.push("staff-session-scope-confirmed");

    const suffix = requireUuidV7(makeUuid(), "Fixture run identifier");
    fixtureRunId = suffix;
    const sentinel = `STAGE7_INTERNAL_ONLY_${suffix}`;
    const tripInput = tripSliceRequest({ agencyId: context.agencyId, suffix, sentinel });
    const createFixtureTrip = async (input, label, allowRecovery) => {
      let response = await requestAdmin({
        method: "POST",
        path: "/api/admin/trips",
        body: input,
        cookie: staffCookie,
        fixtureRunId,
      });
      if (allowRecovery && response.status === 409) {
        const conflict = objectBody(response, "Runtime acceptance fixture conflict");
        if (conflict.error === "runtime_acceptance_fixture_conflict") {
          const recoveryRunId = conflict.recoveryFixtureRunId;
          const recoveryFailure = Object.assign(
            new Error("Runtime acceptance fixture conflict could not be safely recovered"),
            { code: "RUNTIME_ACCEPTANCE_FIXTURE_CONFLICT" },
          );
          if (
            typeof recoveryRunId !== "string" ||
            !UUID_V7_PATTERN.test(recoveryRunId) ||
            recoveryRunId === fixtureRunId
          ) {
            throw recoveryFailure;
          }
          try {
            await cleanupFixtureRun(recoveryRunId);
          } catch (error) {
            error.acceptanceFailureCode = recoveryFailure.code;
            throw error;
          }
          const previousRunId = fixtureRunId;
          fixtureRunId = requireUuidV7(makeUuid(), "Fresh fixture run identifier");
          if (fixtureRunId === previousRunId || fixtureRunId === recoveryRunId)
            throw recoveryFailure;
          response = await requestAdmin({
            method: "POST",
            path: "/api/admin/trips",
            body: input,
            cookie: staffCookie,
            fixtureRunId,
          });
        }
      }
      return requireStatus(response, 201, label);
    };
    const createResponse = await createFixtureTrip(
      tripInput,
      "Synthetic Trip creation through Admin API",
      true,
    );
    const created = objectBody(createResponse, "Synthetic Trip creation");
    tripId = created.trip?.id;
    const createdAgencyId = created.trip?.agencyId;
    const accommodation = created.accommodations?.[0];
    assert.ok(typeof tripId === "string" && typeof createdAgencyId === "string");
    assert.equal(createdAgencyId, context.agencyId);
    assert.ok(
      typeof accommodation?.id === "string" && typeof accommodation?.lockVersion === "string",
    );
    probes.push("synthetic-business-data-created-through-admin-api");

    const ungrantedInput = tripSliceRequest({
      agencyId: context.agencyId,
      suffix: `${suffix}-cross-trip`,
      sentinel: `STAGE7_INTERNAL_ONLY_CROSS_${suffix}`,
    });
    const ungrantedResponse = await createFixtureTrip(
      ungrantedInput,
      "Synthetic ungranted Trip creation through Admin API",
      false,
    );
    ungrantedTripId = objectBody(ungrantedResponse, "Synthetic ungranted Trip creation").trip?.id;
    assert.ok(typeof ungrantedTripId === "string" && ungrantedTripId !== tripId);

    const email = `stage7-${suffix}@example.test`;
    portalPassword = makePassword();
    const enrollmentResult = await enrollment.enroll({
      email,
      name: "Stage 7 Runtime Acceptance",
      password: portalPassword,
      fixtureRunId,
    });
    enrolledPrincipalId = enrollmentResult.portalPrincipalId;
    assert.ok(typeof enrolledPrincipalId === "string" && enrolledPrincipalId.length > 0);
    probes.push("local-operator-portal-enrollment-verified");

    const unauthenticated = await requestPortal({
      method: "GET",
      path: `/api/portal/trips/${tripId}`,
    });
    requireStatus(unauthenticated, 401, "Unauthenticated Portal Trip read");
    probes.push("unauthenticated-portal-trip-denied");

    portalCookie = await signInPortal({ requestPortal, email, password: portalPassword });
    probes.push("portal-realm-authenticated");

    const beforeGrant = await requestPortal({
      method: "GET",
      path: `/api/portal/trips/${tripId}`,
      cookie: portalCookie,
    });
    requireStatus(beforeGrant, 404, "Portal Trip read before explicit grant");
    probes.push("portal-default-deny-before-grant");

    const preview = objectBody(
      requireStatus(
        await requestAdmin({
          method: "GET",
          path: `/api/admin/trips/${tripId}/publication-preview`,
          cookie: staffCookie,
        }),
        200,
        "Publication preview",
      ),
      "Publication preview",
    );
    assert.equal(typeof preview.workspaceRevision, "string");
    assert.match(preview.projectionHash, /^[0-9a-f]{64}$/u);
    assert.equal(JSON.stringify(preview.projection).includes(sentinel), false);
    const publication = objectBody(
      requireStatus(
        await requestAdmin({
          method: "POST",
          path: `/api/admin/trips/${tripId}/publications`,
          body: {
            expectedWorkspaceRevision: preview.workspaceRevision,
            expectedProjectionHash: preview.projectionHash,
            idempotencyKey: `stage7-runtime-publish-${suffix}`,
          },
          cookie: staffCookie,
        }),
        200,
        "Trip publication through Admin API",
      ),
      "Trip publication",
    );
    assert.equal(publication.tripId, tripId);
    assert.equal(publication.isActive, true);
    probes.push("immutable-publication-created-through-admin-api");

    const grant = objectBody(
      requireStatus(
        await requestAdmin({
          method: "POST",
          path: `/api/admin/trips/${tripId}/portal-access-grants`,
          body: {
            agencyId: createdAgencyId,
            portalPrincipalId: enrolledPrincipalId,
            tripId,
            idempotencyKey: `stage7-runtime-grant-${suffix}`,
            expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
            relationshipLabel: "Stage 7 synthetic acceptance",
          },
          cookie: staffCookie,
        }),
        201,
        "Portal Trip access grant",
      ),
      "Portal Trip access grant",
    );
    issuedGrantId = grant.grantId;
    assert.equal(grant.portalPrincipalId, enrolledPrincipalId);
    assert.equal(grant.tripId, tripId);
    probes.push("explicit-trip-access-grant-issued-through-admin-api");

    const crossTrip = await requestPortal({
      method: "GET",
      path: `/api/portal/trips/${ungrantedTripId}`,
      cookie: portalCookie,
    });
    requireStatus(crossTrip, 404, "Portal access to a different, ungranted Trip");
    probes.push("cross-trip-access-denied");

    const authorizedBeforeEdit = objectBody(
      requireStatus(
        await requestPortal({
          method: "GET",
          path: `/api/portal/trips/${tripId}`,
          cookie: portalCookie,
        }),
        200,
        "Authorized Portal Trip read",
      ),
      "Authorized Portal Trip read",
    );
    assertPortalSnapshot(authorizedBeforeEdit, tripInput.trip.title, sentinel);
    probes.push("authorized-portal-read-uses-allowlisted-snapshot");

    const updateResponse = requireStatus(
      await requestAdmin({
        method: "PATCH",
        path: `/api/admin/itinerary/accommodations/${accommodation.id}`,
        body: {
          itemId: accommodation.id,
          agencyId: createdAgencyId,
          tripId,
          expectedLockVersion: accommodation.lockVersion,
          title: "Synthetic accommodation changed after publication",
          description: "Unpublished workspace edit sentinel",
        },
        cookie: staffCookie,
      }),
      200,
      "Post-publication workspace edit through Admin API",
    );
    objectBody(updateResponse, "Post-publication workspace edit");
    const authorizedAfterEdit = objectBody(
      requireStatus(
        await requestPortal({
          method: "GET",
          path: `/api/portal/trips/${tripId}`,
          cookie: portalCookie,
        }),
        200,
        "Portal Trip read after workspace edit",
      ),
      "Portal Trip read after workspace edit",
    );
    assert.deepEqual(authorizedAfterEdit, authorizedBeforeEdit);
    assertPortalSnapshot(authorizedAfterEdit, tripInput.trip.title, sentinel);
    probes.push("portal-snapshot-unchanged-after-workspace-edit");

    const previewV2 = objectBody(
      requireStatus(
        await requestAdmin({
          method: "GET",
          path: `/api/admin/trips/${tripId}/publication-preview`,
          cookie: staffCookie,
        }),
        200,
        "Version 2 publication preview",
      ),
      "Version 2 publication preview",
    );
    assert.notEqual(previewV2.projectionHash, publication.projectionHash);
    assert.equal(JSON.stringify(previewV2.projection).includes(sentinel), false);
    const publicationV2 = objectBody(
      requireStatus(
        await requestAdmin({
          method: "POST",
          path: `/api/admin/trips/${tripId}/publications`,
          body: {
            expectedWorkspaceRevision: previewV2.workspaceRevision,
            expectedProjectionHash: previewV2.projectionHash,
            idempotencyKey: `stage7-runtime-publish-v2-${suffix}`,
          },
          cookie: staffCookie,
        }),
        200,
        "Version 2 Trip publication through Admin API",
      ),
      "Version 2 Trip publication",
    );
    assert.equal(publicationV2.tripId, tripId);
    assert.equal(publicationV2.version, 2);
    assert.equal(publicationV2.isActive, true);
    assert.notEqual(publicationV2.projectionHash, publication.projectionHash);

    const portalV2 = objectBody(
      requireStatus(
        await requestPortal({
          method: "GET",
          path: `/api/portal/trips/${tripId}`,
          cookie: portalCookie,
        }),
        200,
        "Portal Trip read after version 2 publication",
      ),
      "Portal Trip read after version 2 publication",
    );
    assertPortalSnapshot(portalV2, tripInput.trip.title, sentinel);
    assert.equal(
      JSON.stringify(portalV2).includes("Synthetic accommodation changed after publication"),
      true,
    );

    const history = objectBody(
      requireStatus(
        await requestAdmin({
          method: "GET",
          path: `/api/admin/trips/${tripId}/publications`,
          cookie: staffCookie,
        }),
        200,
        "Trip publication history after version 2",
      ),
      "Trip publication history",
    );
    const historyV1 = history.entries?.find((entry) => entry.version === 1);
    const historyV2 = history.entries?.find((entry) => entry.version === 2);
    assert.equal(historyV1?.projectionHash, publication.projectionHash);
    assert.equal(historyV2?.projectionHash, publicationV2.projectionHash);
    assert.equal(typeof readImmutablePublication, "function");
    const persistedV1 = await readImmutablePublication({ tripId, version: 1 });
    assert.equal(persistedV1?.projectionHash, publication.projectionHash);
    const persistedPayload =
      typeof persistedV1?.canonicalPayload === "string"
        ? JSON.parse(persistedV1.canonicalPayload)
        : persistedV1?.canonicalPayload;
    assert.deepEqual(persistedPayload, publication.projection);
    probes.push("publication-v2-visible-v1-immutable");

    const revokeResponse = await requestAdmin({
      method: "POST",
      path: `/api/admin/portal-access-grants/${issuedGrantId}/revocations`,
      body: {
        agencyId,
        grantId: issuedGrantId,
        idempotencyKey: `stage7-runtime-revoke-${suffix}`,
      },
      cookie: staffCookie,
    });
    probes.push(`portal-access-grant-revocation-http-${revokeResponse.status}`);
    const revoke = objectBody(
      requireStatus(revokeResponse, 200, "Portal Trip access revocation"),
      "Portal Trip access revocation",
    );
    probes.push(`portal-access-grant-revocation-revoked-at-${typeof revoke.revokedAt}`);
    assert.ok(typeof revoke.revokedAt === "string");
    grantRevoked = true;
    const afterRevoke = await requestPortal({
      method: "GET",
      path: `/api/portal/trips/${tripId}`,
      cookie: portalCookie,
    });
    probes.push(`portal-trip-read-after-revocation-http-${afterRevoke.status}`);
    requireStatus(afterRevoke, 401, "Portal Trip read after authorization-epoch revocation");
    probes.push("grant-revocation-invalidates-existing-portal-session");
  } catch (error) {
    if (error?.isRuntimeAcceptanceCleanupFailure === true) {
      cleanupFailure = error;
      if (typeof error.acceptanceFailureCode === "string") {
        failure = Object.assign(new Error("Runtime acceptance fixture recovery failed"), {
          code: error.acceptanceFailureCode,
        });
      }
    } else {
      failure = error;
    }
  } finally {
    if (issuedGrantId !== undefined && !grantRevoked && staffCookie !== undefined) {
      try {
        const revokeResponse = await requestAdmin({
          method: "POST",
          path: `/api/admin/portal-access-grants/${issuedGrantId}/revocations`,
          body: {
            agencyId,
            grantId: issuedGrantId,
            idempotencyKey: `stage7-runtime-cleanup-${makeUuid()}`,
          },
          cookie: staffCookie,
        });
        if (revokeResponse.status >= 200 && revokeResponse.status < 300) {
          grantRevoked = true;
        } else {
          cleanupFailure ??= cleanupError("PORTAL_ACCESS_GRANT_REVOCATION_FAILED");
        }
      } catch {
        cleanupFailure ??= cleanupError("PORTAL_ACCESS_GRANT_REVOCATION_FAILED");
      }
    }
    if (portalCookie !== undefined) {
      try {
        const signOut = await requestPortal({
          method: "POST",
          path: "/api/auth/portal/sign-out",
          body: {},
          cookie: portalCookie,
        });
        if (signOut.status < 200 || signOut.status >= 300) {
          cleanupFailure ??= cleanupError("PORTAL_SESSION_SIGN_OUT_FAILED");
        } else {
          portalSignedOut = true;
        }
      } catch {
        cleanupFailure ??= cleanupError("PORTAL_SESSION_SIGN_OUT_FAILED");
      }
    }
    if (fixtureRunId !== undefined && staffCookie !== undefined) {
      try {
        await cleanupFixtureRun(fixtureRunId, { allowNotFound: true });
      } catch (error) {
        cleanupFailure ??=
          error?.isRuntimeAcceptanceCleanupFailure === true ? error : cleanupError();
      }
    }
    if (staffCookie !== undefined) {
      try {
        const signOut = await requestAdmin({
          method: "POST",
          path: "/api/auth/staff/sign-out",
          body: {},
          cookie: staffCookie,
        });
        if (signOut.status < 200 || signOut.status >= 300) {
          cleanupFailure ??= cleanupError("STAFF_SESSION_SIGN_OUT_FAILED");
        } else {
          staffSignedOut = true;
        }
      } catch {
        cleanupFailure ??= cleanupError("STAFF_SESSION_SIGN_OUT_FAILED");
      }
    }
    if (portalSignedOut && portalCookie !== undefined && tripId !== undefined) {
      try {
        const session = await requestPortal({
          method: "GET",
          path: "/api/auth/portal/get-session",
          cookie: portalCookie,
        });
        if (
          session.status === 200 &&
          (session.body === null || (session.body?.session === null && session.body?.user === null))
        ) {
          probes.push("portal-session-revoked-after-sign-out");
        } else {
          cleanupFailure ??= cleanupError("PORTAL_SESSION_REVOCATION_UNVERIFIED");
        }
      } catch {
        cleanupFailure ??= cleanupError("PORTAL_SESSION_REVOCATION_UNVERIFIED");
      }
    }
    if (staffSignedOut && staffCookie !== undefined) {
      try {
        const context = await requestAdmin({
          method: "GET",
          path: "/api/staff/session-context",
          cookie: staffCookie,
        });
        if (context.status === 401) probes.push("staff-session-revoked-after-sign-out");
        else cleanupFailure ??= cleanupError("STAFF_SESSION_REVOCATION_UNVERIFIED");
      } catch {
        cleanupFailure ??= cleanupError("STAFF_SESSION_REVOCATION_UNVERIFIED");
      }
    }
    if (credentials && typeof credentials === "object") {
      for (const key of Object.keys(credentials)) credentials[key] = "";
    }
  }
  if (failure !== undefined || cleanupFailure !== undefined) {
    const acceptanceFailure = new Error(
      "Stage 7 runtime acceptance failed; sensitive values were not retained",
    );
    acceptanceFailure.code = safeFailureCode(failure ?? cleanupFailure);
    if (cleanupFailure !== undefined) {
      acceptanceFailure.cleanupCode = safeFailureCode(cleanupFailure);
    }
    acceptanceFailure.completedProbes = probes
      .filter((probe) => typeof probe === "string" && /^[a-z0-9-]{1,96}$/u.test(probe))
      .slice(0, 32);
    throw acceptanceFailure;
  }
  assert.equal(grantRevoked, true, "Runtime acceptance grant was not revoked");
  return { result: "PASS", probes, stage8Actions: 0 };
};

const requestLoopback =
  (listener, expectedHost, canonicalOrigin) =>
  ({ method, path: requestPath, body, cookie, fixtureRunId }) =>
    new Promise((resolve, reject) => {
      if (!requestPath.startsWith("/") || requestPath.startsWith("//")) {
        reject(new Error("Invalid local acceptance request path"));
        return;
      }
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const headers = {
        host: expectedHost,
        accept: "application/json",
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json", "content-length": payload.length }),
        ...(cookie === undefined ? {} : { cookie }),
        ...(fixtureRunId === undefined
          ? {}
          : { "x-travelos-acceptance-fixture-run": fixtureRunId }),
        ...(method === "GET" ? {} : { origin: canonicalOrigin }),
      };
      const request = http.request(
        {
          hostname: listener.host,
          port: listener.port,
          method,
          path: requestPath,
          headers,
          timeout: 10_000,
        },
        (response) => {
          const chunks = [];
          let bytes = 0;
          response.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > MAX_RESPONSE_BYTES)
              request.destroy(new Error("Acceptance response exceeded its limit"));
            else chunks.push(chunk);
          });
          response.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let parsed;
            if (raw.length > 0) {
              try {
                parsed = JSON.parse(raw);
              } catch {
                reject(new Error("Acceptance API returned invalid JSON"));
                return;
              }
            }
            resolve({ status: response.statusCode ?? 0, headers: response.headers, body: parsed });
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error("Acceptance API request timed out")));
      request.on("error", () => reject(new Error("Acceptance API request failed")));
      if (payload !== undefined) request.write(payload);
      request.end();
    });

const resolveRuntimePackageRoot = (appRoot, packageName) =>
  realpath(path.join(appRoot, "node_modules", ...packageName.split("/")));

// Compute a fresh challenge only after Staff sign-in, using the exact Better
// Auth OTP implementation shipped with the runtime adapter.
export const createRuntimeTotpGenerator = async (appRoot) => {
  const adapterRoot = await resolveRuntimePackageRoot(appRoot, "@travelos/auth-adapters");
  const packageFile = await realpath(path.join(adapterRoot, "package.json"));
  const adapterRequire = createRequire(packageFile);
  const betterAuthRequire = createRequire(adapterRequire.resolve("better-auth"));
  const { createOTP } = betterAuthRequire("@better-auth/utils/otp");
  const { base32 } = betterAuthRequire("@better-auth/utils/base32");
  return async (encodedSeed) => {
    assert.match(encodedSeed, /^[A-Z2-7]{16,128}$/u, "Invalid Staff TOTP seed");
    const decodedSeed = base32.decode(encodedSeed);
    try {
      return createOTP(new TextDecoder("utf-8", { fatal: true }).decode(decodedSeed)).totp();
    } finally {
      decodedSeed.fill(0);
    }
  };
};

export const resolveRuntimePackageImport = async ({ appRoot, packageName, exportName = "." }) => {
  const packageRoot = await resolveRuntimePackageRoot(appRoot, packageName);
  const packageMetadata = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  );
  const exportPath = packageMetadata.exports?.[exportName]?.import;
  assert.ok(typeof exportPath === "string" && exportPath.startsWith("./"));
  const entryPath = await realpath(path.join(packageRoot, exportPath));
  assert.ok(entryPath.startsWith(`${packageRoot}${path.sep}`));
  return pathToFileURL(entryPath).href;
};

const safeFailureCodeValue = (value) =>
  typeof value === "string" && /^[A-Z0-9_]{1,64}$/u.test(value) ? value : null;

const safeFailureCode = (error) =>
  safeFailureCodeValue(error?.code) ?? "STAGE7_RUNTIME_ACCEPTANCE_ERROR";

export const requirePortalPrivilegeDenial = async (database, table, column) => {
  try {
    await database.selectFrom(table).select(column).executeTakeFirst();
  } catch (error) {
    if (error?.code === "42501") return;
    throw new Error("Portal database privilege probe returned an unexpected result", {
      cause: error,
    });
  }
  throw new Error("Portal database role can read a forbidden mutable or internal table");
};

const verifyPortalDatabaseIsolation = async (database) => {
  await requirePortalPrivilegeDenial(database, "trip_ops.trip", "title");
  await requirePortalPrivilegeDenial(database, "finance.supplier_cost_line", "internalNote");
};

const runCli = async () => {
  let failureStage = "operator arguments";
  let failure = null;
  let operatorCredentialValues;
  let portalDatabase;
  let result;
  try {
    const argumentsList = process.argv.slice(2);
    assert.equal(
      argumentsList.length,
      1,
      "Usage: node stage7-runtime-acceptance.mjs --manifest=/absolute/path",
    );
    assert.ok(argumentsList[0].startsWith("--manifest="), "Only --manifest is accepted");
    const manifestPath = argumentsList[0].slice("--manifest=".length);
    assert.ok(path.isAbsolute(manifestPath), "Manifest path must be absolute");
    const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
    const artifactRoot = path.resolve(scriptDirectory, "..");

    failureStage = "artifact identity preflight";
    const release = JSON.parse(await readFile(path.join(artifactRoot, "release.json"), "utf8"));
    assert.match(release.artifactId, /^travelos-phase-1-m1-stage-7-gen09-[a-f0-9]{8}$/u);
    assert.equal(release.source?.successorBaselineGeneration, "gen09");

    const portalPackageRoot = path.join(artifactRoot, "apps/portal-api");
    failureStage = "runtime dependency resolution";
    const config = await import(
      await resolveRuntimePackageImport({
        appRoot: portalPackageRoot,
        packageName: "@travelos/config",
      })
    );

    failureStage = "manifest validation";
    const manifest = await config.loadDevelopmentInstanceManifest(manifestPath);
    assert.equal(
      manifest.environment,
      "DEVELOPMENT",
      "Acceptance runner is not enabled outside DEVELOPMENT",
    );

    failureStage = "credential delivery";
    operatorCredentialValues = await readStage7RuntimeCredentials({ manifest });

    failureStage = "Portal realm initialization";
    const portalAuth = await import(
      await resolveRuntimePackageImport({
        appRoot: portalPackageRoot,
        packageName: "@travelos/auth-adapters",
        exportName: "./portal",
      })
    );
    const adapterPackageRoot = await resolveRuntimePackageRoot(
      portalPackageRoot,
      "@travelos/auth-adapters",
    );
    const adapterRealmPath = await realpath(path.join(adapterPackageRoot, "dist/realm.js"));
    assert.ok(adapterRealmPath.startsWith(`${adapterPackageRoot}${path.sep}`));
    const adapterRealm = await import(pathToFileURL(adapterRealmPath).href);
    portalDatabase = portalAuth.createAuthRealmPostgresDatabase({
      host: manifest.database.host,
      port: manifest.database.port,
      database: manifest.database.name,
      user: manifest.database.runtimeRoles.portalApi.roleName,
      password: operatorCredentialValues.portalDatabasePassword,
      tls: { mode: manifest.database.tlsPolicy },
      applicationName: "travelos-stage7-acceptance",
      maxConnections: 2,
    });
    const enrollment = adapterRealm.createLocalOperatorPortalEnrollmentService({
      database: portalDatabase.database,
      canonicalOrigin: `http://${manifest.hosts.portal}`,
      realmKeyMaterial: operatorCredentialValues.portalRealmKey,
      environment: manifest.environment,
    });
    const requestAdmin = requestLoopback(
      manifest.runtime.listeners.adminApi,
      manifest.hosts.admin,
      `http://${manifest.hosts.admin}`,
    );
    const requestPortal = requestLoopback(
      manifest.runtime.listeners.portalApi,
      manifest.hosts.portal,
      `http://${manifest.hosts.portal}`,
    );
    const readImmutablePublication = async ({ tripId, version }) =>
      portalDatabase.database
        .selectFrom("trip_ops.publication_version as version")
        .innerJoin(
          "trip_ops.publication_snapshot as snapshot",
          "snapshot.publicationId",
          "version.publicationId",
        )
        .select([
          "version.projectionHash as projectionHash",
          "snapshot.canonicalPayload as canonicalPayload",
        ])
        .where("version.tripId", "=", tripId)
        .where("version.version", "=", version)
        .executeTakeFirst();
    failureStage = "authenticated API acceptance";
    result = await runStage7RuntimeAcceptance({
      manifest,
      credentials: operatorCredentialValues,
      requestAdmin,
      requestPortal,
      enrollment,
      readImmutablePublication,
      makeStaffTotpCode: await createRuntimeTotpGenerator(portalPackageRoot),
    });
    failureStage = "Portal database privilege isolation";
    await verifyPortalDatabaseIsolation(portalDatabase.database);
    result.probes.push("portal-role-denies-workspace-and-internal-table-reads");
  } catch (error) {
    const completedProbes = Array.isArray(error?.completedProbes)
      ? error.completedProbes
          .filter((probe) => typeof probe === "string" && /^[a-z0-9-]{1,96}$/u.test(probe))
          .slice(0, 32)
      : null;
    const cleanupCode = safeFailureCodeValue(error?.cleanupCode);
    failure = {
      result: "FAIL",
      stage: failureStage,
      code: safeFailureCode(error),
      ...(cleanupCode === null ? {} : { cleanupCode }),
      ...(completedProbes === null ? {} : { completedProbes }),
    };
  } finally {
    if (operatorCredentialValues !== undefined) {
      for (const key of Object.keys(operatorCredentialValues)) operatorCredentialValues[key] = "";
    }
    if (portalDatabase !== undefined) {
      try {
        await portalDatabase.destroy();
      } catch (error) {
        if (failure === null) {
          failure = { result: "FAIL", stage: "resource cleanup", code: safeFailureCode(error) };
        }
      }
    }
  }
  if (failure !== null) {
    process.stderr.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

const invokedPath = process.argv[1]
  ? await realpath(path.resolve(process.argv[1])).catch(() => null)
  : null;
const modulePath = await realpath(fileURLToPath(import.meta.url));
const directEntry = invokedPath !== null && invokedPath === modulePath;
if (directEntry) {
  runCli().catch(() => {
    process.stderr.write(
      '{"result":"FAIL","stage":"runner lifecycle","code":"STAGE7_RUNTIME_ACCEPTANCE_ERROR"}\n',
    );
    process.exitCode = 1;
  });
}
