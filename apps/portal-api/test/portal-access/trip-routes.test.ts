import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PortalAuthRealm, AuthSurfacePolicy } from "@travelos/auth-adapters/portal";
import type { PortalTripSnapshotV1 } from "@travelos/contracts/portal";
import type {
  CurrentPublishedPortalTripSnapshotQuery,
  CurrentPublishedPortalTripSnapshotReader,
} from "@travelos/portal-safe-core/customer-presentation";

import { createPortalApi, type CreatePortalApiOptions } from "../../src/app.js";

const expectedHost = "portal.travelos.test";
const policy: AuthSurfacePolicy = {
  canonicalOrigin: `http://${expectedHost}`,
  expectedHost,
};
const agencyId = "00000000-0000-7000-8000-000000000071";
const tripId = "00000000-0000-7000-8000-000000000072";
const portalSession = {
  realm: "PORTAL" as const,
  sessionId: "portal-session-synthetic",
  principalId: "portal-principal-synthetic",
  expiresAtEpochMs: Date.now() + 60_000,
  agencyId,
  authorizationEpoch: 4n,
  recentMfaVerifiedAtEpochMs: null,
};
const snapshot: PortalTripSnapshotV1 = {
  schemaVersion: 1,
  trip: { title: "Synthetic trip", startDate: "2027-04-01", endDate: "2027-04-04" },
  items: [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

const makePortalRealm = (events: string[] = []): PortalAuthRealm =>
  ({
    kind: "PORTAL",
    basePath: "/api/auth/portal",
    cookieName: "travelos-dev-portal-session",
    secureTransportRequired: false,
    async handle() {
      return new Response(null, { status: 200 });
    },
    async getServerSession(request: Request) {
      events.push("session");
      return request.headers.get("cookie") === "travelos-dev-portal-session=portal-session"
        ? portalSession
        : null;
    },
  }) as PortalAuthRealm;

const apiOptions = (
  realm: PortalAuthRealm,
  reader: CurrentPublishedPortalTripSnapshotReader,
): CreatePortalApiOptions =>
  ({
    expectedHost,
    auth: { realm, policy },
    tripSnapshotReader: reader,
  }) as unknown as CreatePortalApiOptions;

const withPortalApi = async <T>(
  options: CreatePortalApiOptions,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> => {
  const application = await createPortalApi(options);
  await application.listen(0, "127.0.0.1");
  try {
    const address = application.getHttpServer().address();
    if (address === null || typeof address === "string") {
      throw new Error("Portal API test listener did not bind a TCP address");
    }
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await application.close();
  }
};

const requestTrip = (baseUrl: string, id = tripId, headers: Record<string, string> = {}) =>
  request(baseUrl)
    .get(`/api/portal/trips/${id}`)
    .set({ Host: expectedHost, ...headers });

const readerReturning = (
  result: unknown | null,
  events: string[] = [],
): CurrentPublishedPortalTripSnapshotReader => ({
  async readCurrentPublishedTripSnapshot(query: CurrentPublishedPortalTripSnapshotQuery) {
    events.push("reader");
    void query;
    return result;
  },
});

describe("Portal current Trip HTTP read", () => {
  it("rejects a Staff cookie without querying snapshots", async () => {
    const events: string[] = [];
    const reader = {
      readCurrentPublishedTripSnapshot: vi.fn(async () => snapshot),
    } satisfies CurrentPublishedPortalTripSnapshotReader;

    await withPortalApi(apiOptions(makePortalRealm(events), reader), async (baseUrl) => {
      const response = await requestTrip(baseUrl, tripId, {
        cookie: "travelos-dev-staff-session=staff-session",
      });

      expect(response.status).toBe(401);
      expect(response.text).toBe("");
      expect(response.headers["cache-control"]).toBe("no-store, private");
    });

    expect(events).toEqual(["session"]);
    expect(reader.readCurrentPublishedTripSnapshot).not.toHaveBeenCalled();
  });

  it("checks the Portal session before the reader and returns only the strict current snapshot", async () => {
    const events: string[] = [];
    let receivedQuery: CurrentPublishedPortalTripSnapshotQuery | undefined;
    const reader: CurrentPublishedPortalTripSnapshotReader = {
      async readCurrentPublishedTripSnapshot(query) {
        events.push("reader");
        receivedQuery = query;
        return snapshot;
      },
    };

    await withPortalApi(apiOptions(makePortalRealm(events), reader), async (baseUrl) => {
      const response = await requestTrip(baseUrl, tripId, {
        cookie: "travelos-dev-portal-session=portal-session",
      });

      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store, private");
      expect(response.body).toEqual(snapshot);
    });

    expect(events).toEqual(["session", "reader"]);
    expect(receivedQuery).toEqual({
      agencyId,
      portalPrincipalId: "portal-principal-synthetic",
      portalSessionId: "portal-session-synthetic",
      authorizationEpoch: 4n,
      tripId,
    });
  });

  it("uses one empty 404 response for an ungranted Trip and a Trip without an active publication", async () => {
    const reader = readerReturning(null);
    const responseBodies: string[] = [];
    const responseStatuses: number[] = [];

    await withPortalApi(apiOptions(makePortalRealm(), reader), async (baseUrl) => {
      for (const requestedTripId of [tripId, "00000000-0000-7000-8000-000000000073"]) {
        const response = await requestTrip(baseUrl, requestedTripId, {
          cookie: "travelos-dev-portal-session=portal-session",
        });
        responseStatuses.push(response.status);
        responseBodies.push(response.text);
        expect(response.headers["cache-control"]).toBe("no-store, private");
      }
    });

    expect(responseStatuses).toEqual([404, 404]);
    expect(responseBodies).toEqual(["", ""]);
  });

  it("rejects bearer headers before resolving identity or reading data", async () => {
    const events: string[] = [];
    const reader = {
      readCurrentPublishedTripSnapshot: vi.fn(async () => snapshot),
    } satisfies CurrentPublishedPortalTripSnapshotReader;

    await withPortalApi(apiOptions(makePortalRealm(events), reader), async (baseUrl) => {
      const response = await requestTrip(baseUrl, tripId, {
        cookie: "travelos-dev-portal-session=portal-session",
        authorization: "Bearer synthetic-not-a-credential",
      });

      expect(response.status).toBe(403);
      expect(response.text).toBe("");
    });

    expect(events).toEqual([]);
    expect(reader.readCurrentPublishedTripSnapshot).not.toHaveBeenCalled();
  });

  it("returns a generic error for malformed or unexpected snapshot data without leaking sentinels", async () => {
    const events: string[] = [];
    const sentinel = "INTERNAL_ONLY-portal-sentinel";
    const reader = readerReturning({ ...snapshot, supplierCost: sentinel });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await withPortalApi(apiOptions(makePortalRealm(events), reader), async (baseUrl) => {
      const invalidId = await requestTrip(baseUrl, "not-a-uuid", {
        cookie: "travelos-dev-portal-session=portal-session",
      });
      expect(invalidId.status).toBe(400);
      expect(invalidId.text).not.toContain(sentinel);

      const invalidSnapshot = await requestTrip(baseUrl, tripId, {
        cookie: "travelos-dev-portal-session=portal-session",
      });
      expect(invalidSnapshot.status).toBe(500);
      const body = invalidSnapshot.text;
      expect(body).not.toContain(sentinel);
      expect(body).not.toContain("supplierCost");
      expect(invalidSnapshot.headers["cache-control"]).toBe("no-store, private");
    });

    expect(events).toEqual(["session"]);
    expect(log).not.toHaveBeenCalled();
  });

  it("maps reader exceptions to a non-sensitive response and does not log the exception", async () => {
    const sensitiveDiagnostic = "INTERNAL_ONLY-database-detail";
    const reader: CurrentPublishedPortalTripSnapshotReader = {
      async readCurrentPublishedTripSnapshot() {
        throw new Error(sensitiveDiagnostic);
      },
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await withPortalApi(apiOptions(makePortalRealm(), reader), async (baseUrl) => {
      const response = await requestTrip(baseUrl, tripId, {
        cookie: "travelos-dev-portal-session=portal-session",
      });

      expect(response.status).toBe(500);
      expect(response.text).not.toContain(sensitiveDiagnostic);
      expect(response.headers["cache-control"]).toBe("no-store, private");
    });

    expect(log).not.toHaveBeenCalled();
  });
});
