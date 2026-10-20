import { describe, expect, it, vi } from "vitest";

import {
  asOpaqueId,
  createM1RuntimeAcceptanceFixtureOperations,
  M1RuntimeAcceptanceFixtureConflictError,
  M1StaffAuthorizationError,
  type M1RuntimeAcceptanceFixtureOperations,
  type M1StaffTripOperations,
  type RuntimeAcceptanceFixtureCleanupRepository,
  type RuntimeAcceptanceCleanupReceipt,
  type StaffPermissionId,
} from "@travelos/backend-core";
import {
  STAFF_AUTH_BASE_PATH,
  type AuthRealm,
  type AuthSurfacePolicy,
} from "@travelos/auth-adapters";
import { registerAdminAuthBridge } from "../src/auth-bridge.js";
import type { AdminM1ExpressApplication } from "../src/m1-routes.js";

const agencyId = "00000000-0000-7000-8000-000000000001";
const fixtureRunId = "00000000-0000-7000-8000-000000000002";
const recoveryFixtureRunId = "00000000-0000-7000-8000-000000000003";
const sessionId = "stage7-runtime-cleanup-route-session";
const staffPrincipalId = "stage7-runtime-cleanup-route-staff";
const nowEpochMs = 1_800_000_000_000;
const fixtureHeader = "X-TravelOS-Acceptance-Fixture-Run";
const cleanupPath = "POST /api/admin/runtime-acceptance-fixtures/:fixtureRunId/cleanup";
const policy: AuthSurfacePolicy = {
  canonicalOrigin: "https://admin.example.test",
  expectedHost: "admin.example.test",
};

const requestBody = () => ({
  agencyId,
  person: {
    givenName: "Synthetic",
    familyName: "Traveller",
    email: ["fixture-owner", "example.test"].join("@"),
  },
  customer: { displayName: "Synthetic Travel" },
  customerPersonRole: "PRIMARY_CONTACT",
  trip: {
    title: "Synthetic acceptance trip",
    startDate: "2026-09-25",
    endDate: "2026-09-28",
    state: "DRAFT",
  },
  travellerRole: "PRIMARY_TRAVELLER",
  flight: {
    title: "Flight",
    description: "Synthetic flight",
    carrier: "Example Air",
    flightNumber: "EA100",
    departureAirport: "LIS",
    arrivalAirport: "OPO",
    departure: {
      localDate: "2026-09-25",
      localTime: "09:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-09-25T08:00:00Z",
    },
    arrival: {
      localDate: "2026-09-25",
      localTime: "10:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-09-25T09:00:00Z",
    },
    terminal: null,
    cabin: "ECONOMY",
    baggage: "1 bag",
    seat: null,
    customerBookingReference: "BOOK-1",
  },
  accommodation: {
    title: "Hotel",
    description: "Synthetic hotel",
    propertyName: "Example Hotel",
    checkIn: {
      localDate: "2026-09-25",
      localTime: "15:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-09-25T14:00:00Z",
    },
    checkOut: {
      localDate: "2026-09-28",
      localTime: "11:00",
      timezoneName: "Europe/Lisbon",
      instant: "2026-09-28T10:00:00Z",
    },
    roomDescription: "Double",
    boardType: "BREAKFAST",
    customerBookingReference: "HOTEL-1",
  },
  reservation: {
    supplierName: "Synthetic Supplier",
    supplierReference: "SUP-1",
    customerBookingReference: "CUST-1",
    state: "CONFIRMED",
  },
  supplierCost: {
    amount: { minorUnits: "12345", currency: "EUR", scale: 2 },
    internalNote: "Synthetic internal note",
  },
});

const cleanupReceipt: RuntimeAcceptanceCleanupReceipt = {
  fixtureRunId: asOpaqueId(fixtureRunId),
  state: "CLEANED",
  counts: {
    grantsRevoked: 1,
    publicationsWithdrawn: 1,
    tripsCancelled: 2,
    principalsRetired: 1,
  },
  retainedHistoryCounts: { publicationSnapshots: 2, auditRecords: 5 },
  errorCode: null,
};
const cleanupReceiptWithUnlistedField = {
  ...cleanupReceipt,
  internalExtension: "synthetic-only",
};

const defaultBeginCleanup: RuntimeAcceptanceFixtureCleanupRepository["beginCleanup"] =
  async () => ({
    status: "CLEANED",
    receipt: cleanupReceiptWithUnlistedField,
  });

interface InvokeResult {
  readonly statusCode: number | null;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string | readonly string[]>>;
  readonly nextError: unknown;
}

type Handler = Parameters<AdminM1ExpressApplication["post"]>[1];
type FixtureRouteOperations = {
  readonly createFixtureTrip: M1StaffTripOperations["createRuntimeAcceptanceFixtureTrip"];
  readonly cleanupFixture: M1RuntimeAcceptanceFixtureOperations["cleanupFixture"];
};

const makeM1Operations = () => {
  const createTripSlice = vi
    .fn<M1StaffTripOperations["createTripSlice"]>()
    .mockRejectedValue(new M1StaffAuthorizationError("FORBIDDEN"));
  const createRuntimeAcceptanceFixtureTrip =
    vi.fn<M1StaffTripOperations["createRuntimeAcceptanceFixtureTrip"]>();
  const operations = {
    createTripSlice,
    createRuntimeAcceptanceFixtureTrip,
    readTripSlice: vi.fn<M1StaffTripOperations["readTripSlice"]>(),
    updateAccommodation: vi.fn<M1StaffTripOperations["updateAccommodation"]>(),
    updateInternalSupplierNote: vi.fn<M1StaffTripOperations["updateInternalSupplierNote"]>(),
    cancelTrip: vi.fn<M1StaffTripOperations["cancelTrip"]>(),
  } as unknown as M1StaffTripOperations;
  return { operations, createTripSlice, createRuntimeAcceptanceFixtureTrip };
};

const makeCleanupOperations = ({
  permissions = ["runtime_acceptance.fixture.manage"],
  recentMfaVerifiedAtEpochMs = nowEpochMs,
  session = true,
  beginCleanup = defaultBeginCleanup,
}: {
  readonly permissions?: readonly StaffPermissionId[];
  readonly recentMfaVerifiedAtEpochMs?: number | null;
  readonly session?: boolean;
  readonly beginCleanup?: RuntimeAcceptanceFixtureCleanupRepository["beginCleanup"];
} = {}) => {
  const resolveStaffSession = vi.fn(async () =>
    session
      ? {
          sessionId,
          staffPrincipalId,
          agencyId,
          authorizationEpoch: 1n,
          expiresAtEpochMs: nowEpochMs + 60_000,
          recentMfaVerifiedAtEpochMs,
        }
      : null,
  );
  const getStaffAuthorizationSnapshot = vi.fn(async () => ({
    staffPrincipalId,
    agencyId,
    membershipState: "ACTIVE" as const,
    authorizationEpoch: 1n,
    assignments: permissions.map((permissionId) => ({
      agencyId,
      permissionId,
      scopeKind: "AGENCY" as const,
      organizationUnitId: null,
      accessLevel: "ALL" as const,
      active: true,
    })),
  }));
  const repository = {
    beginCleanup: vi.fn(beginCleanup),
    completeCleanup: vi.fn(async () => cleanupReceipt),
  };
  const operations = createM1RuntimeAcceptanceFixtureOperations({
    repository,
    authorizationRepository: { getStaffAuthorizationSnapshot },
    sessionResolver: { resolveStaffSession },
    nowEpochMs: () => nowEpochMs,
    tripOperations: {
      readTripSlice: vi.fn(),
      cancelTrip: vi.fn(),
    },
    tripAccessOperations: {
      revokeTripAccessGrant: vi.fn(),
      retireFixturePortalPrincipal: vi.fn(),
    },
    publicationOperations: { withdrawActivePublication: vi.fn() },
  });
  return { operations, repository, resolveStaffSession, getStaffAuthorizationSnapshot };
};

const registerRoutes = ({
  environment = "DEVELOPMENT",
  m1Operations,
  fixtureOperations,
}: {
  readonly environment?: "DEVELOPMENT" | "PRODUCTION";
  readonly m1Operations: M1StaffTripOperations;
  readonly fixtureOperations?: FixtureRouteOperations;
}) => {
  const routes = new Map<string, Handler>();
  const express = {
    use() {},
    get(path: string, handler: Handler) {
      routes.set(`GET ${path}`, handler);
    },
    post(path: string, handler: Handler) {
      routes.set(`POST ${path}`, handler);
    },
    patch(path: string, handler: Handler) {
      routes.set(`PATCH ${path}`, handler);
    },
  };
  const realm = {
    kind: "STAFF",
    basePath: STAFF_AUTH_BASE_PATH,
  } as unknown as AuthRealm;
  const options = {
    realm,
    policy,
    staffAccessRepository: { getStaffAuthorizationSnapshot: vi.fn() },
    m1Operations,
    environment,
    ...(fixtureOperations === undefined
      ? {}
      : { m1RuntimeAcceptanceFixtureOperations: fixtureOperations }),
  };
  registerAdminAuthBridge(
    { getHttpAdapter: () => ({ getInstance: () => express }) },
    options as unknown as Parameters<typeof registerAdminAuthBridge>[1],
  );
  return routes;
};

const invoke = async (
  routes: ReadonlyMap<string, Handler>,
  key: string,
  {
    body,
    params = {},
    headers = {
      host: policy.expectedHost,
      origin: policy.canonicalOrigin,
      cookie: "staff-session=synthetic",
    },
  }: {
    readonly body?: unknown;
    readonly params?: Readonly<Record<string, string>>;
    readonly headers?: Record<string, string | string[] | undefined>;
  } = {},
): Promise<InvokeResult> => {
  const handler = routes.get(key);
  if (handler === undefined) {
    return { statusCode: null, body: undefined, headers: {}, nextError: undefined };
  }
  const response = {
    statusCode: null as number | null,
    body: undefined as unknown,
    headers: {} as Record<string, string | readonly string[]>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | readonly string[]) {
      this.headers[name.toLowerCase()] = value;
    },
    end() {},
    json(value: unknown) {
      this.body = value;
    },
  };
  let nextError: unknown;
  handler(
    {
      method: key.split(" ")[0] ?? "POST",
      url: key.slice(key.indexOf(" ") + 1),
      originalUrl: key.slice(key.indexOf(" ") + 1),
      headers,
      body,
      params,
    },
    response,
    (error: unknown) => {
      nextError = error;
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  return {
    statusCode: response.statusCode,
    body: response.body,
    headers: response.headers,
    nextError,
  };
};

describe("Admin runtime acceptance fixture cleanup routes", () => {
  it("cleanupRouteRequiresStaffRecentMfaAndFixturePermission", async () => {
    const m1 = makeM1Operations();
    const permitted = makeCleanupOperations();
    const routes = registerRoutes({
      m1Operations: m1.operations,
      fixtureOperations: {
        createFixtureTrip: m1.operations.createRuntimeAcceptanceFixtureTrip,
        cleanupFixture: permitted.operations.cleanupFixture,
      },
    });

    const accepted = await invoke(routes, cleanupPath, {
      body: { idempotencyKey: "cleanup-request-1" },
      params: { fixtureRunId },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.body).toEqual(cleanupReceipt);
    expect(accepted.body).not.toHaveProperty("internalExtension");
    expect(permitted.repository.beginCleanup).toHaveBeenCalledOnce();

    const staleMfa = makeCleanupOperations({
      recentMfaVerifiedAtEpochMs: nowEpochMs - 6 * 60 * 1_000,
    });
    const staleMfaRoutes = registerRoutes({
      m1Operations: m1.operations,
      fixtureOperations: {
        createFixtureTrip: m1.operations.createRuntimeAcceptanceFixtureTrip,
        cleanupFixture: staleMfa.operations.cleanupFixture,
      },
    });
    const staleMfaResponse = await invoke(staleMfaRoutes, cleanupPath, {
      body: { idempotencyKey: "cleanup-request-1" },
      params: { fixtureRunId },
    });
    expect(staleMfaResponse.statusCode).toBe(403);
    expect(staleMfa.repository.beginCleanup).not.toHaveBeenCalled();

    const missingPermission = makeCleanupOperations({ permissions: [] });
    const missingPermissionRoutes = registerRoutes({
      m1Operations: m1.operations,
      fixtureOperations: {
        createFixtureTrip: m1.operations.createRuntimeAcceptanceFixtureTrip,
        cleanupFixture: missingPermission.operations.cleanupFixture,
      },
    });
    const missingPermissionResponse = await invoke(missingPermissionRoutes, cleanupPath, {
      body: { idempotencyKey: "cleanup-request-1" },
      params: { fixtureRunId },
    });
    expect(missingPermissionResponse.statusCode).toBe(403);
    expect(missingPermission.repository.beginCleanup).not.toHaveBeenCalled();

    const anonymous = makeCleanupOperations({ session: false });
    const anonymousRoutes = registerRoutes({
      m1Operations: m1.operations,
      fixtureOperations: {
        createFixtureTrip: m1.operations.createRuntimeAcceptanceFixtureTrip,
        cleanupFixture: anonymous.operations.cleanupFixture,
      },
    });
    const anonymousResponse = await invoke(anonymousRoutes, cleanupPath, {
      body: { idempotencyKey: "cleanup-request-1" },
      params: { fixtureRunId },
    });
    expect(anonymousResponse.statusCode).toBe(401);
    expect(anonymous.repository.beginCleanup).not.toHaveBeenCalled();

    permitted.resolveStaffSession.mockClear();
    const wrongSurface = await invoke(routes, cleanupPath, {
      body: { idempotencyKey: "cleanup-request-1" },
      params: { fixtureRunId },
      headers: {
        host: "portal.example.test",
        origin: policy.canonicalOrigin,
        cookie: "staff-session=synthetic",
      },
    });
    expect(wrongSurface.statusCode).toBe(404);
    expect(permitted.resolveStaffSession).not.toHaveBeenCalled();
  });

  it("cleanupRouteRejectsCrossAgencyAndUnknownFields", async () => {
    const m1 = makeM1Operations();
    const cleanup = makeCleanupOperations({ beginCleanup: async () => null });
    const routes = registerRoutes({
      m1Operations: m1.operations,
      fixtureOperations: {
        createFixtureTrip: m1.operations.createRuntimeAcceptanceFixtureTrip,
        cleanupFixture: cleanup.operations.cleanupFixture,
      },
    });

    const extraAgencyField = await invoke(routes, cleanupPath, {
      body: {
        idempotencyKey: "cleanup-request-1",
        agencyId: "00000000-0000-7000-8000-000000000099",
      },
      params: { fixtureRunId },
    });
    expect(extraAgencyField.statusCode).toBe(400);
    expect(cleanup.repository.beginCleanup).not.toHaveBeenCalled();

    const unknownRun = await invoke(routes, cleanupPath, {
      body: { idempotencyKey: "cleanup-request-1" },
      params: { fixtureRunId },
    });
    const crossAgencyRun = await invoke(routes, cleanupPath, {
      body: { idempotencyKey: "cleanup-request-1" },
      params: { fixtureRunId: "00000000-0000-7000-8000-000000000099" },
    });
    expect(unknownRun.statusCode).toBe(404);
    expect(crossAgencyRun.statusCode).toBe(404);
    expect(unknownRun.body).toBe(crossAgencyRun.body);
    expect(cleanup.repository.beginCleanup).toHaveBeenCalledTimes(2);
    expect(cleanup.repository.beginCleanup).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ agencyId: asOpaqueId(agencyId) }),
      expect.any(Object),
    );
    expect(cleanup.repository.beginCleanup).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ agencyId: asOpaqueId(agencyId) }),
      expect.any(Object),
    );
  });

  it("cleanupRouteIsNotRegisteredOutsideDevelopment", () => {
    const m1 = makeM1Operations();
    const cleanup = makeCleanupOperations();
    const routes = registerRoutes({
      environment: "PRODUCTION",
      m1Operations: m1.operations,
      fixtureOperations: {
        createFixtureTrip: m1.operations.createRuntimeAcceptanceFixtureTrip,
        cleanupFixture: cleanup.operations.cleanupFixture,
      },
    });
    expect(routes.has(cleanupPath)).toBe(false);
    expect(cleanup.repository.beginCleanup).not.toHaveBeenCalled();
  });

  it("fixtureTripHeaderFailsClosedWithoutDevelopmentCapability", async () => {
    const m1 = makeM1Operations();
    const routes = registerRoutes({ environment: "PRODUCTION", m1Operations: m1.operations });
    const response = await invoke(routes, "POST /api/admin/trips", {
      body: requestBody(),
      headers: {
        host: policy.expectedHost,
        origin: policy.canonicalOrigin,
        cookie: "staff-session=synthetic",
        [fixtureHeader]: fixtureRunId,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(m1.createTripSlice).not.toHaveBeenCalled();
    expect(m1.createRuntimeAcceptanceFixtureTrip).not.toHaveBeenCalled();
  });

  it("onlyCreatorReceivesPendingRunIdOnFixtureConflict", async () => {
    const creator = makeM1Operations();
    creator.createRuntimeAcceptanceFixtureTrip.mockRejectedValue(
      new M1RuntimeAcceptanceFixtureConflictError(asOpaqueId(recoveryFixtureRunId)),
    );
    const creatorRoutes = registerRoutes({
      m1Operations: creator.operations,
      fixtureOperations: {
        createFixtureTrip: creator.operations.createRuntimeAcceptanceFixtureTrip,
        cleanupFixture: makeCleanupOperations().operations.cleanupFixture,
      },
    });
    const creatorResponse = await invoke(creatorRoutes, "POST /api/admin/trips", {
      body: requestBody(),
      headers: {
        host: policy.expectedHost,
        origin: policy.canonicalOrigin,
        cookie: "staff-session=synthetic",
        [fixtureHeader]: fixtureRunId,
      },
    });
    expect(creatorResponse.statusCode).toBe(409);
    expect(creatorResponse.body).toEqual({
      error: "runtime_acceptance_fixture_conflict",
      recoveryFixtureRunId,
    });
    expect(creator.createRuntimeAcceptanceFixtureTrip).toHaveBeenCalledOnce();
    expect(creator.createTripSlice).not.toHaveBeenCalled();

    const otherCreator = makeM1Operations();
    otherCreator.createRuntimeAcceptanceFixtureTrip.mockRejectedValue(
      new M1RuntimeAcceptanceFixtureConflictError(null),
    );
    const otherCreatorRoutes = registerRoutes({
      m1Operations: otherCreator.operations,
      fixtureOperations: {
        createFixtureTrip: otherCreator.operations.createRuntimeAcceptanceFixtureTrip,
        cleanupFixture: makeCleanupOperations().operations.cleanupFixture,
      },
    });
    const otherCreatorResponse = await invoke(otherCreatorRoutes, "POST /api/admin/trips", {
      body: requestBody(),
      headers: {
        host: policy.expectedHost,
        origin: policy.canonicalOrigin,
        cookie: "staff-session=synthetic",
        [fixtureHeader]: fixtureRunId,
      },
    });
    expect(otherCreatorResponse.statusCode).toBe(409);
    expect(otherCreatorResponse.body).toEqual({ error: "runtime_acceptance_fixture_conflict" });
    expect(JSON.stringify(otherCreatorResponse.body)).not.toContain(recoveryFixtureRunId);
  });
});
