// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PortalApiError,
  getPortalSession,
  listPortalTrips,
  readPortalTripSnapshot,
} from "../src/api.js";

const tripId = "019a0101-0000-7000-8000-000000000011";
const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("Portal same-origin API client", () => {
  it("reads the separate authenticated Portal session", async () => {
    const session = { authenticated: true, portalPrincipalId: "portal-principal-test" };
    fetchMock.mockResolvedValue(response(session));

    await expect(getPortalSession()).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/portal/session-context",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("lists only strictly parsed grant-authorized Portal entries", async () => {
    const page = { items: [], nextCursor: null };
    fetchMock.mockResolvedValue(response(page));

    await expect(listPortalTrips({ limit: 25, cursor: null })).resolves.toEqual(page);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/portal/trips?limit=25",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );

    fetchMock.mockResolvedValue(response({ ...page, mutableWorkspace: { title: "private" } }));
    await expect(listPortalTrips({ limit: 25, cursor: null })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: "Não foi possível validar os dados recebidos.",
    });
  });

  it("fetches a snapshot through the Portal route and hides denied-trip details", async () => {
    fetchMock.mockResolvedValue(response({ internal_error: "private-detail" }, 404));
    const request = readPortalTripSnapshot(tripId);

    await expect(request).rejects.toBeInstanceOf(PortalApiError);
    await expect(request).rejects.toMatchObject({
      code: "NOT_AVAILABLE",
      message: "Esta viagem não está disponível.",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/portal/trips/${tripId}`,
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("rejects a malformed Trip identifier without a request", async () => {
    await expect(readPortalTripSnapshot("/api/admin/trips/1")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
