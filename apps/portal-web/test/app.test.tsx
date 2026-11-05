// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const portalSessionState = { signedOut: false };
  const portalAuthClient = {
    signIn: { email: vi.fn() },
    signOut: vi.fn(),
  };
  return {
    portalAuthClient,
    portalSessionState,
    createAuthClient: vi.fn(() => portalAuthClient),
    twoFactorClient: vi.fn(() => ({ name: "should-not-be-used-in-Portal" })),
    fetch: vi.fn(),
  };
});

vi.mock("better-auth/react", () => ({ createAuthClient: mocks.createAuthClient }));
vi.mock("better-auth/client/plugins", () => ({ twoFactorClient: mocks.twoFactorClient }));

import { PortalRoot } from "../src/app.js";

const tripId = "019a0101-0000-7000-8000-000000000011";
const unpublishedTripId = "019a0101-0000-7000-8000-000000000012";

const snapshot = {
  schemaVersion: 1,
  trip: {
    title: "Rota do Pico",
    startDate: "2027-06-04",
    endDate: "2027-06-11",
  },
  items: [
    {
      kind: "FLIGHT",
      title: "Lisboa — Ponta Delgada",
      description: "Voo de ida",
      carrier: "TAP Air Portugal",
      flightNumber: "TP 1863",
      departureAirport: "LIS",
      arrivalAirport: "PDL",
      departure: {
        localDate: "2027-06-04",
        localTime: "10:00",
        timeZone: "UTC",
        instant: "2027-06-04T10:00:00.000Z",
      },
      arrival: {
        localDate: "2027-06-04",
        localTime: "11:50",
        timeZone: "UTC",
        instant: "2027-06-04T11:50:00.000Z",
      },
      terminal: "1",
      cabin: "Económica",
      baggage: "1 bagagem de cabine",
      seat: "12A",
      customerBookingReference: "TRV-TEST-001",
    },
    {
      kind: "ACCOMMODATION",
      title: "Estadia na Praia",
      description: "Alojamento",
      propertyName: "Casa do Atlântico",
      checkIn: {
        localDate: "2027-06-04",
        localTime: "14:00",
        timeZone: "UTC",
        instant: "2027-06-04T14:00:00.000Z",
      },
      checkOut: {
        localDate: "2027-06-11",
        localTime: "11:00",
        timeZone: "UTC",
        instant: "2027-06-11T11:00:00.000Z",
      },
      roomDescription: "Quarto duplo",
      boardType: "Pequeno-almoço",
      customerBookingReference: null,
    },
  ],
};

const authorizedTripList = {
  items: [
    { tripId, publicationState: "PUBLISHED", snapshot },
    { tripId: unpublishedTripId, publicationState: "NO_PUBLICATION" },
  ],
  nextCursor: null,
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const pathOf = (input: unknown): string => {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.toString()
          : String(input);
  const url = new URL(raw, window.location.origin);
  return `${url.pathname}${url.search}`;
};

const setPortalSessionAndList = (listResponse = jsonResponse(authorizedTripList)): void => {
  mocks.fetch.mockImplementation(async (input: unknown) => {
    const path = pathOf(input);
    if (path === "/api/portal/session-context") {
      return mocks.portalSessionState.signedOut
        ? new Response(null, { status: 401 })
        : jsonResponse({ authenticated: true, portalPrincipalId: "portal-principal-test" });
    }
    if (path === "/api/portal/trips?limit=25") return listResponse;
    if (path === `/api/portal/trips/${tripId}`) return jsonResponse(snapshot);
    throw new Error(`Unexpected Portal API request: ${path}`);
  });
};

beforeEach(() => {
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.portalSessionState.signedOut = false;
  mocks.portalAuthClient.signIn.email.mockReset().mockResolvedValue({ data: {}, error: null });
  mocks.portalAuthClient.signOut.mockReset().mockImplementation(async () => {
    mocks.portalSessionState.signedOut = true;
    return { data: { success: true }, error: null };
  });
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Customer Portal Web", () => {
  it("uses the isolated Portal auth realm without a Staff MFA plugin", () => {
    expect(mocks.createAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: window.location.origin,
        basePath: "/api/auth/portal",
        fetchOptions: expect.objectContaining({ credentials: "same-origin" }),
      }),
    );
    expect(mocks.twoFactorClient).not.toHaveBeenCalled();
  });

  it("renders a Portal-only POST login without public signup", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 401 }));

    render(<PortalRoot />);

    expect(await screen.findByRole("heading", { name: "Entrar no Portal" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "TravelOS, início" }).querySelector("svg"),
    ).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Entrar no Portal" });
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/auth/portal/sign-in/email");
    expect(screen.getByLabelText("Email")).toHaveAttribute("name", "email");
    expect(screen.getByLabelText("Palavra-passe")).toHaveAttribute("name", "password");
    expect(screen.queryByRole("link", { name: /criar conta|registar/i })).not.toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/portal/session-context",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("renders only grant-authorized snapshots and a safe no-publication marker", async () => {
    setPortalSessionAndList();

    render(<PortalRoot />);

    expect(await screen.findByRole("heading", { name: "As minhas viagens" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "TravelOS, início" })).toHaveLength(2);
    expect(await screen.findByText("Rota do Pico")).toBeInTheDocument();
    expect(screen.getByText("Aguarda publicação")).toBeInTheDocument();
    expect(
      screen.getByText("A sua agência ainda não publicou um itinerário para esta viagem."),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(unpublishedTripId);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/portal/trips?limit=25",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
    expect(mocks.fetch.mock.calls.map(([input]) => pathOf(input)).join(" ")).not.toContain(
      "/api/admin/",
    );
  });

  it("opens only the immutable Portal snapshot and presents its real itinerary", async () => {
    setPortalSessionAndList();

    render(<PortalRoot />);
    fireEvent.click(await screen.findByRole("link", { name: "Abrir itinerário: Rota do Pico" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Rota do Pico" }),
    ).toBeInTheDocument();
    expect(screen.getByText("TP 1863")).toBeInTheDocument();
    expect(screen.getByText("Casa do Atlântico")).toBeInTheDocument();
    expect(screen.getByText("TRV-TEST-001")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(tripId);
    expect(mocks.fetch).toHaveBeenCalledWith(
      `/api/portal/trips/${tripId}`,
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
    expect(mocks.fetch.mock.calls.map(([input]) => pathOf(input)).join(" ")).not.toContain(
      "/api/admin/",
    );

    fireEvent.click(screen.getByRole("button", { name: "Terminar sessão" }));
    expect(await screen.findByRole("heading", { name: "Entrar no Portal" })).toBeInTheDocument();
    expect(mocks.portalAuthClient.signOut).toHaveBeenCalledOnce();
  });

  it("hides a direct trip route when the Portal API denies access", async () => {
    window.history.replaceState({}, "", `/#/trips/${unpublishedTripId}`);
    mocks.fetch.mockImplementation(async (input: unknown) => {
      const path = pathOf(input);
      if (path === "/api/portal/session-context") {
        return jsonResponse({ authenticated: true, portalPrincipalId: "portal-principal-test" });
      }
      if (path === `/api/portal/trips/${unpublishedTripId}`) {
        return new Response(JSON.stringify({ internal_error: "private-detail" }), { status: 404 });
      }
      throw new Error(`Unexpected Portal API request: ${path}`);
    });

    render(<PortalRoot />);

    expect(
      await screen.findByRole("heading", { name: "Esta viagem não está disponível." }),
    ).toBeInTheDocument();
    expect(screen.queryByText("private-detail")).not.toBeInTheDocument();
    expect(screen.queryByText("Rota do Pico")).not.toBeInTheDocument();
  });

  it("supports Portal login and shows the true empty state", async () => {
    let sessionRequests = 0;
    mocks.fetch.mockImplementation(async (input: unknown) => {
      const path = pathOf(input);
      if (path === "/api/portal/session-context") {
        sessionRequests += 1;
        return sessionRequests === 1
          ? new Response(null, { status: 401 })
          : jsonResponse({ authenticated: true, portalPrincipalId: "portal-principal-test" });
      }
      if (path === "/api/portal/trips?limit=25")
        return jsonResponse({ items: [], nextCursor: null });
      throw new Error(`Unexpected Portal API request: ${path}`);
    });

    render(<PortalRoot />);
    await screen.findByRole("heading", { name: "Entrar no Portal" });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "customer@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Palavra-passe"), {
      target: { value: "synthetic-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(
      await screen.findByText("Não tem viagens disponíveis neste momento."),
    ).toBeInTheDocument();
    expect(mocks.portalAuthClient.signIn.email).toHaveBeenCalledWith({
      email: "customer@example.test",
      password: "synthetic-password",
    });
    expect(window.location.href).not.toContain("synthetic-password");
  });
});
