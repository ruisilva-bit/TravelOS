// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdminApiError,
  createAdminAccommodation,
  createAdminFlight,
  createAdminTripWorkspace,
  getAdminPublicationPreview,
  getAdminSessionContext,
  getAdminTripWorkspace,
  listAdminShareLinks,
  revokeAdminShareLink,
  createAdminShareLink,
  listAdminTrips,
  updateAdminAccommodation,
  updateAdminFlight,
  updateAdminTripWorkspace,
} from "../src/api.js";

const agencyId = "019a0101-0000-7000-8000-000000000002";
const tripId = "019a0101-0000-7000-8000-000000000001";
const flightId = "019a0101-0000-7000-8000-000000000003";
const accommodationId = "019a0101-0000-7000-8000-000000000004";

const workspaceResponse = {
  trip: {
    id: tripId,
    agencyId,
    title: "Viagem de teste",
    startDate: "2027-06-04",
    endDate: "2027-06-11",
    state: "DRAFT",
    workspaceRevision: "3",
    lockVersion: "2",
  },
  flights: [],
  accommodations: [],
};

const publicationProjection = {
  schemaVersion: 1,
  trip: {
    title: "Viagem de teste",
    startDate: "2027-06-04",
    endDate: "2027-06-11",
  },
  items: [],
};

const projectionHash = "a".repeat(64);

const flightDraft = {
  title: "Voo de teste",
  description: "Voo sintético",
  carrier: "Companhia de teste",
  flightNumber: "TT 100",
  departureAirport: "LIS",
  arrivalAirport: "PDL",
  departure: {
    localDate: "2027-06-04",
    localTime: "10:00",
    timezoneName: "UTC",
    instant: "2027-06-04T10:00:00.000Z",
  },
  arrival: {
    localDate: "2027-06-04",
    localTime: "11:00",
    timezoneName: "UTC",
    instant: "2027-06-04T11:00:00.000Z",
  },
  terminal: null,
  cabin: null,
  baggage: null,
  seat: null,
  customerBookingReference: null,
};

const accommodationDraft = {
  title: "Estadia de teste",
  description: "Alojamento sintético",
  propertyName: "Hotel de teste",
  checkIn: {
    localDate: "2027-06-04",
    localTime: "14:00",
    timezoneName: "UTC",
    instant: "2027-06-04T14:00:00.000Z",
  },
  checkOut: {
    localDate: "2027-06-11",
    localTime: "11:00",
    timezoneName: "UTC",
    instant: "2027-06-11T11:00:00.000Z",
  },
  roomDescription: null,
  boardType: null,
  customerBookingReference: null,
};

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("Admin same-origin API client", () => {
  it("loads and strictly parses the current Staff session context", async () => {
    const session = {
      principalId: "staff-principal-test",
      agencyId,
      authorizationEpoch: "1",
      recentMfaVerifiedAtEpochMs: 1793039999999,
    };
    fetchMock.mockResolvedValue(response(session));

    await expect(getAdminSessionContext()).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/staff/session-context",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("requests a bounded Trip page and never accepts unknown response fields", async () => {
    fetchMock.mockResolvedValue(response({ items: [], nextCursor: null }));

    await expect(listAdminTrips({ limit: 25, cursor: null })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/trips?limit=25",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );

    fetchMock.mockResolvedValue(response({ items: [], nextCursor: null, internalOnly: "private" }));
    await expect(listAdminTrips({ limit: 25, cursor: null })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: "Não foi possível validar os dados recebidos.",
    });
  });

  it("maps access denial to a safe typed error without reading diagnostic bodies", async () => {
    fetchMock.mockResolvedValue(response({ internal_error: "private-detail" }, 403));
    const request = listAdminTrips({ limit: 25, cursor: null });

    await expect(request).rejects.toBeInstanceOf(AdminApiError);
    await expect(request).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      message: "Acesso não autorizado.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a malformed Trip identifier before making a request", async () => {
    await expect(getAdminTripWorkspace("not-a-trip-id")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a Trip with only the minimal customer and primary-traveller fields", async () => {
    fetchMock.mockResolvedValue(response(workspaceResponse, 201));
    const request = {
      customer: { displayName: "Cliente Teste" },
      primaryTraveller: { givenName: "Viajante", familyName: "Teste" },
      trip: { title: "Viagem de teste", startDate: "2027-06-04", endDate: "2027-06-11" },
    };

    await expect(createAdminTripWorkspace(request)).resolves.toEqual(workspaceResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/trips/workspace",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(request),
      }),
    );
  });

  it("sends strict versioned Trip, Flight and Accommodation workspace writes", async () => {
    fetchMock.mockImplementation(async () => response(workspaceResponse));
    const flightCreate = { expectedWorkspaceRevision: "3", flight: flightDraft };
    const flightUpdate = {
      expectedLockVersion: "1",
      expectedWorkspaceRevision: "3",
      flight: flightDraft,
    };
    const accommodationCreate = {
      expectedWorkspaceRevision: "3",
      accommodation: accommodationDraft,
    };
    const accommodationUpdate = {
      expectedLockVersion: "1",
      expectedWorkspaceRevision: "3",
      accommodation: accommodationDraft,
    };
    const tripUpdate = {
      expectedLockVersion: "2",
      expectedWorkspaceRevision: "3",
      trip: { title: "Viagem revista", startDate: "2027-06-04", endDate: "2027-06-11" },
    };

    await createAdminFlight(tripId, flightCreate);
    await updateAdminFlight(tripId, flightId, flightUpdate);
    await createAdminAccommodation(tripId, accommodationCreate);
    await updateAdminAccommodation(tripId, accommodationId, accommodationUpdate);
    await updateAdminTripWorkspace(tripId, tripUpdate);

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/admin/trips/${tripId}/workspace/flights`,
      `/api/admin/trips/${tripId}/workspace/flights/${flightId}`,
      `/api/admin/trips/${tripId}/workspace/accommodations`,
      `/api/admin/trips/${tripId}/workspace/accommodations/${accommodationId}`,
      `/api/admin/trips/${tripId}/workspace`,
    ]);
    for (const [index, method, request] of [
      [0, "POST", flightCreate],
      [1, "PATCH", flightUpdate],
      [2, "POST", accommodationCreate],
      [3, "PATCH", accommodationUpdate],
      [4, "PATCH", tripUpdate],
    ] as const) {
      expect(fetchMock.mock.calls[index]?.[1]).toEqual(
        expect.objectContaining({
          method,
          credentials: "same-origin",
          cache: "no-store",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(request),
        }),
      );
    }
  });

  it("loads a pure publication preview", async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        workspaceRevision: "3",
        projectionHash,
        schemaVersion: 1,
        projection: publicationProjection,
      }),
    );
    await expect(getAdminPublicationPreview(tripId)).resolves.toEqual({
      workspaceRevision: "3",
      projectionHash,
      schemaVersion: 1,
      projection: publicationProjection,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/admin/trips/${tripId}/publication-preview`,
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("creates a share link with an idempotency header and lists links without any token", async () => {
    const token = "Z".repeat(43);
    const created = {
      shareLinkId: "019a0101-0000-7000-8000-000000000006",
      token,
      url: `https://admin.example.test/v/${token}`,
      createdAt: "2027-01-01T12:00:00.000Z",
      expiresAt: "2027-04-01T12:00:00.000Z",
    };
    fetchMock.mockResolvedValueOnce(response(created));
    await expect(
      createAdminShareLink(tripId, { expiresInDays: 90 }, "share-test-key"),
    ).resolves.toEqual(created);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/admin/trips/${tripId}/share-links`,
      expect.objectContaining({
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "idempotency-key": "share-test-key",
        },
        body: JSON.stringify({ expiresInDays: 90 }),
      }),
    );

    const summary = {
      shareLinkId: created.shareLinkId,
      createdAt: created.createdAt,
      expiresAt: created.expiresAt,
      revokedAt: null,
      state: "ACTIVE",
      createdBy: "staff-1",
    };
    fetchMock.mockResolvedValueOnce(response({ links: [summary] }));
    await expect(listAdminShareLinks(tripId)).resolves.toEqual({ links: [summary] });
    fetchMock.mockResolvedValueOnce(response({ links: [{ ...summary, token }] }));
    await expect(listAdminShareLinks(tripId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("revokes a share link and rejects out-of-range validity locally", async () => {
    fetchMock.mockResolvedValueOnce(response({ revoked: true }));
    await expect(
      revokeAdminShareLink("019a0101-0000-7000-8000-000000000006"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/admin/share-links/019a0101-0000-7000-8000-000000000006/revoke",
      expect.objectContaining({ method: "POST" }),
    );
    await expect(createAdminShareLink(tripId, { expiresInDays: 366 }, "k")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it("maps stale write conflicts to a typed error without exposing server diagnostics", async () => {
    fetchMock.mockResolvedValue(response({ internal_error: "private-detail" }, 409));

    await expect(
      updateAdminTripWorkspace(tripId, {
        expectedLockVersion: "2",
        expectedWorkspaceRevision: "3",
        trip: { title: "Viagem revista", startDate: "2027-06-04", endDate: "2027-06-11" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(
      updateAdminTripWorkspace(tripId, {
        expectedLockVersion: "2",
        expectedWorkspaceRevision: "3",
        trip: { title: "Viagem revista", startDate: "2027-06-04", endDate: "2027-06-11" },
      }),
    ).rejects.not.toHaveProperty("message", "private-detail");
  });

  it("rejects an invalid strict write before contacting the Admin API", async () => {
    const invalidRequest = {
      expectedLockVersion: "2",
      expectedWorkspaceRevision: "3",
      trip: { title: "Viagem revista", startDate: "2027-06-04", endDate: "2027-06-11" },
      agencyId,
    } as unknown as Parameters<typeof updateAdminTripWorkspace>[1];
    await expect(updateAdminTripWorkspace(tripId, invalidRequest)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
