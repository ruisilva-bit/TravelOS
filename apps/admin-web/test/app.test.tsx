// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceFrame } from "@travelos/design-system";

const mocks = vi.hoisted(() => {
  const twoFactorRedirect = {
    current: null as null | ((context: { twoFactorMethods?: string[] }) => void | Promise<void>),
  };
  const staffAuthClient = {
    signIn: { email: vi.fn() },
    getSession: vi.fn(),
    twoFactor: { enable: vi.fn(), verifyTotp: vi.fn(), verifyBackupCode: vi.fn() },
    signOut: vi.fn(),
  };
  const twoFactorPlugin = { name: "staff-two-factor-plugin" };
  return {
    staffAuthClient,
    twoFactorPlugin,
    createAuthClient: vi.fn(() => staffAuthClient),
    twoFactorClient: vi.fn(
      (options?: {
        onTwoFactorRedirect?: (context: { twoFactorMethods?: string[] }) => void | Promise<void>;
      }) => {
        twoFactorRedirect.current = options?.onTwoFactorRedirect ?? null;
        return twoFactorPlugin;
      },
    ),
    triggerTwoFactorRedirect: async () =>
      twoFactorRedirect.current?.({ twoFactorMethods: ["totp"] }),
    fetch: vi.fn(),
  };
});

vi.mock("better-auth/react", () => ({ createAuthClient: mocks.createAuthClient }));
vi.mock("better-auth/client/plugins", () => ({ twoFactorClient: mocks.twoFactorClient }));

import { AdminRoot } from "../src/app.js";

const tripId = "019a0101-0000-7000-8000-000000000001";
const agencyId = "019a0101-0000-7000-8000-000000000002";
const flightId = "019a0101-0000-7000-8000-000000000003";
const accommodationId = "019a0101-0000-7000-8000-000000000004";

const staffContext = {
  principalId: "staff-principal-test",
  agencyId,
  authorizationEpoch: "1",
  recentMfaVerifiedAtEpochMs: 1793039999999,
  canInviteStaff: false,
};

const trip = {
  id: tripId,
  agencyId,
  title: "Rota do Pico",
  startDate: "2027-06-04",
  endDate: "2027-06-11",
  state: "CONFIRMED",
  workspaceRevision: "3",
  lockVersion: "2",
};

const workspace = {
  trip,
  flights: [
    {
      id: flightId,
      agencyId,
      tripId,
      family: "FLIGHT",
      state: "CONFIRMED",
      sortOrder: 1,
      title: "Lisboa — Ponta Delgada",
      description: "Voo de ida",
      customerBookingReference: null,
      lockVersion: "1",
      carrier: "TAP Air Portugal",
      flightNumber: "TP 1863",
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
        localTime: "11:50",
        timezoneName: "UTC",
        instant: "2027-06-04T11:50:00.000Z",
      },
      terminal: "1",
      cabin: "Económica",
      baggage: "1 bagagem de cabine",
      seat: "12A",
    },
  ],
  accommodations: [
    {
      id: accommodationId,
      agencyId,
      tripId,
      family: "ACCOMMODATION",
      state: "CONFIRMED",
      sortOrder: 2,
      title: "Estadia na Praia",
      description: "Alojamento",
      customerBookingReference: null,
      lockVersion: "1",
      propertyName: "Casa do Atlântico",
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
      roomDescription: "Quarto duplo",
      boardType: "Pequeno-almoço",
    },
  ],
};

const adminList = { items: [trip], nextCursor: null };

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

const setAdminSessionAndList = (listResponse = jsonResponse(adminList)): void => {
  mocks.fetch.mockImplementation(async (input: unknown) => {
    const path = pathOf(input);
    if (path === "/api/staff/session-context") return jsonResponse(staffContext);
    if (path === "/api/admin/trips?limit=25") return listResponse;
    throw new Error(`Unexpected Admin API request: ${path}`);
  });
};

const submitFirstLogin = (): void => {
  fireEvent.change(screen.getByLabelText("Email profissional"), {
    target: { value: "staff@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Palavra-passe"), {
    target: { value: "synthetic-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
};

const enableFirstMfaFactor = async (): Promise<void> => {
  fireEvent.change(screen.getByLabelText("Palavra-passe atual"), {
    target: { value: "synthetic-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ativar autenticação" }));
  expect(await screen.findByLabelText("URI de configuração TOTP")).toHaveValue(
    "otpauth://totp/TravelOS%20Staff:staff@example.test?secret=SYNTHETIC-TOTP-SEED&issuer=TravelOS%20Staff",
  );
  expect(screen.getByText("RECOVERY-CODE-ONE")).toBeInTheDocument();
  expect(screen.queryByLabelText("Código da aplicação de autenticação")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Guardei os códigos de recuperação num local seguro"));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  expect(screen.queryByLabelText("URI de configuração TOTP")).not.toBeInTheDocument();
  expect(screen.queryByText("RECOVERY-CODE-ONE")).not.toBeInTheDocument();
};

beforeEach(() => {
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.staffAuthClient.signIn.email.mockReset().mockResolvedValue({ data: {}, error: null });
  mocks.staffAuthClient.getSession
    .mockReset()
    .mockResolvedValue({ data: { user: { twoFactorEnabled: true } }, error: null });
  mocks.staffAuthClient.twoFactor.enable.mockReset().mockResolvedValue({
    data: {
      totpURI:
        "otpauth://totp/TravelOS%20Staff:staff@example.test?secret=SYNTHETIC-TOTP-SEED&issuer=TravelOS%20Staff",
      backupCodes: ["RECOVERY-CODE-ONE", "RECOVERY-CODE-TWO"],
    },
    error: null,
  });
  mocks.staffAuthClient.twoFactor.verifyTotp
    .mockReset()
    .mockResolvedValue({ data: {}, error: null });
  mocks.staffAuthClient.twoFactor.verifyBackupCode
    .mockReset()
    .mockResolvedValue({ data: {}, error: null });
  mocks.staffAuthClient.signOut
    .mockReset()
    .mockResolvedValue({ data: { success: true }, error: null });
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Admin Web", () => {
  it("uses only the Staff auth realm and enables its MFA client", () => {
    expect(mocks.createAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: window.location.origin,
        basePath: "/api/auth/staff",
        fetchOptions: expect.objectContaining({ credentials: "same-origin" }),
        plugins: expect.arrayContaining([mocks.twoFactorPlugin]),
      }),
    );
    expect(mocks.twoFactorClient).toHaveBeenCalledOnce();
    expect(mocks.twoFactorClient.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ onTwoFactorRedirect: expect.any(Function) }),
    );
  });

  it("renders a same-realm POST login when no Staff session exists", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 401 }));

    render(<AdminRoot />);

    expect(await screen.findByRole("heading", { name: "Entrar na equipa" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "TravelOS, início" }).querySelector("svg"),
    ).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Entrar na equipa" });
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/auth/staff/sign-in/email");
    expect(screen.getByLabelText("Email profissional")).toHaveAttribute("name", "email");
    expect(screen.getByLabelText("Palavra-passe")).toHaveAttribute("name", "password");
    expect(screen.getByLabelText("Palavra-passe")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.queryByRole("link", { name: /criar conta|registar/i })).not.toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/staff/session-context",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("requires MFA before loading the real Trip list and logs out through Staff auth", async () => {
    let sessionRequests = 0;
    let signedOut = false;
    mocks.fetch.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const path = pathOf(input);
      if (path === "/api/staff/session-context") {
        sessionRequests += 1;
        return sessionRequests === 1 || signedOut
          ? new Response(null, { status: 401 })
          : jsonResponse(staffContext);
      }
      if (path === "/api/admin/trips?limit=25") return jsonResponse(adminList);
      if (path === `/api/admin/trips/${tripId}/workspace`) return jsonResponse(workspace);
      if (path === `/api/admin/trips/${tripId}/publications`) {
        return jsonResponse({ entries: [], nextCursor: null });
      }
      throw new Error(`Unexpected Admin API request: ${path} ${init?.method ?? ""}`);
    });
    mocks.staffAuthClient.signIn.email.mockImplementation(async () => {
      await mocks.triggerTwoFactorRedirect();
      return { data: {}, error: null };
    });
    mocks.staffAuthClient.signOut.mockImplementation(async () => {
      signedOut = true;
      return { data: { success: true }, error: null };
    });

    render(<AdminRoot />);
    await screen.findByRole("heading", { name: "Entrar na equipa" });
    fireEvent.change(screen.getByLabelText("Email profissional"), {
      target: { value: "staff@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Palavra-passe"), {
      target: { value: "synthetic-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(
      await screen.findByRole("heading", { name: "Confirmar identidade" }),
    ).toBeInTheDocument();
    expect(mocks.staffAuthClient.signIn.email).toHaveBeenCalledWith({
      email: "staff@example.test",
      password: "synthetic-password",
    });
    expect(mocks.fetch).not.toHaveBeenCalledWith("/api/admin/trips?limit=25", expect.anything());

    fireEvent.change(screen.getByLabelText("Código de autenticação"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
    expect(await screen.findByText("Rota do Pico")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "TravelOS, início" })).toHaveLength(2);
    expect(mocks.staffAuthClient.twoFactor.verifyTotp).toHaveBeenCalledWith({ code: "123456" });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/admin/trips?limit=25",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
    expect(document.body.textContent).not.toContain(tripId);
    expect(window.location.href).not.toContain("synthetic-password");
    expect(window.location.href).not.toContain("123456");

    fireEvent.click(screen.getByRole("link", { name: "Viagens" }));
    expect(await screen.findByRole("heading", { name: "Viagens" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("link", { name: "Abrir viagem: Rota do Pico" }));
    expect(await screen.findByRole("heading", { name: "Rota do Pico" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Terminar sessão" }));
    expect(await screen.findByRole("heading", { name: "Entrar na equipa" })).toBeInTheDocument();
    expect(mocks.staffAuthClient.signOut).toHaveBeenCalledOnce();
  });

  it("supports a recovery code as an alternate Staff MFA verification", async () => {
    let sessionRequests = 0;
    mocks.fetch.mockImplementation(async (input: unknown) => {
      const path = pathOf(input);
      if (path === "/api/staff/session-context") {
        sessionRequests += 1;
        return sessionRequests === 1
          ? new Response(null, { status: 401 })
          : jsonResponse(staffContext);
      }
      if (path === "/api/admin/trips?limit=25")
        return jsonResponse({ items: [], nextCursor: null });
      throw new Error(`Unexpected Admin API request: ${path}`);
    });
    mocks.staffAuthClient.signIn.email.mockImplementation(async () => {
      await mocks.triggerTwoFactorRedirect();
      return { data: {}, error: null };
    });

    render(<AdminRoot />);
    await screen.findByRole("heading", { name: "Entrar na equipa" });
    fireEvent.change(screen.getByLabelText("Email profissional"), {
      target: { value: "staff@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Palavra-passe"), {
      target: { value: "synthetic-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await screen.findByRole("heading", { name: "Confirmar identidade" });
    fireEvent.click(screen.getByRole("button", { name: "Usar código de recuperação" }));
    expect(screen.getByLabelText("Código de recuperação")).toHaveAttribute("autocomplete", "off");
    expect(screen.getByRole("form", { name: "Confirmar identidade" })).toHaveAttribute(
      "action",
      "/api/auth/staff/two-factor/verify-backup-code",
    );
    fireEvent.change(screen.getByLabelText("Código de recuperação"), {
      target: { value: "synthetic-recovery-code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
    expect(mocks.staffAuthClient.twoFactor.verifyBackupCode).toHaveBeenCalledWith({
      code: "synthetic-recovery-code",
    });
    expect(window.location.href).not.toContain("synthetic-recovery-code");
  });

  it("renders the Trip detail from the strict workspace API in itinerary chronology", async () => {
    window.history.replaceState({}, "", `/#/trips/${tripId}`);
    mocks.fetch.mockImplementation(async (input: unknown) => {
      const path = pathOf(input);
      if (path === "/api/staff/session-context") return jsonResponse(staffContext);
      if (path === `/api/admin/trips/${tripId}/workspace`) return jsonResponse(workspace);
      if (path === `/api/admin/trips/${tripId}/publications`)
        return jsonResponse({ entries: [], nextCursor: null });
      throw new Error(`Unexpected Admin API request: ${path}`);
    });

    render(<AdminRoot />);

    expect(await screen.findByRole("heading", { name: "Rota do Pico" })).toBeInTheDocument();
    expect(screen.getByText("TP 1863")).toBeInTheDocument();
    expect(screen.getByText("Casa do Atlântico")).toBeInTheDocument();
    expect(screen.getByText(/10:00.*UTC/u, { selector: "time" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(agencyId);
    expect(document.body.textContent).not.toContain(tripId);
    expect(mocks.fetch).toHaveBeenCalledWith(
      `/api/admin/trips/${tripId}/workspace`,
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("shows an authorization state instead of leaking API diagnostics", async () => {
    setAdminSessionAndList(
      new Response(JSON.stringify({ internal_error: "private-detail" }), { status: 403 }),
    );

    render(<AdminRoot />);

    expect(
      await screen.findByRole("heading", { name: "Acesso não autorizado" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Entrar na equipa" })).not.toBeInTheDocument();
    expect(screen.queryByText("private-detail")).not.toBeInTheDocument();
  });

  it("treats unknown Admin API fields as an invalid response and shows the real empty state", async () => {
    setAdminSessionAndList(
      jsonResponse({ items: [], nextCursor: null, internalOnly: "do-not-render" }),
    );

    render(<AdminRoot />);

    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
    expect(
      await screen.findByText("Não foi possível validar os dados recebidos."),
    ).toBeInTheDocument();
    expect(screen.queryByText("do-not-render")).not.toBeInTheDocument();

    setAdminSessionAndList(jsonResponse({ items: [], nextCursor: null }));
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(
      await screen.findByText("Ainda não existem viagens para apresentar."),
    ).toBeInTheDocument();
  });

  it("closes the mobile navigation on Escape and restores focus", () => {
    const { container } = render(
      <WorkspaceFrame
        realm="Staff"
        headerContext="Viagens"
        navigation={[
          { href: "#/", label: "Visão geral" },
          { href: "#/trips", label: "Viagens" },
        ]}
        activeHref="#/trips"
        headerActions={<button type="button">Terminar sessão</button>}
      >
        <h1>Viagens</h1>
      </WorkspaceFrame>,
    );

    const toggle = screen.getByRole("button", { name: "Abrir navegação" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector(".workspace-mobile-nav")).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });

    const closedToggle = screen.getByRole("button", { name: "Abrir navegação" });
    expect(closedToggle).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector(".workspace-mobile-nav")).toBeNull();
    expect(closedToggle).toHaveFocus();
  });

  it("creates only the minimal Customer, primary Traveller and Trip workspace", async () => {
    const createdWorkspace = {
      trip: {
        id: tripId,
        agencyId,
        title: "Viagem de teste",
        startDate: "2027-06-04",
        endDate: "2027-06-11",
        state: "DRAFT",
        workspaceRevision: "1",
        lockVersion: "1",
      },
      flights: [],
      accommodations: [],
    };
    const emptyHistory = { entries: [], nextCursor: null };
    mocks.fetch.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const path = pathOf(input);
      if (path === "/api/staff/session-context") return jsonResponse(staffContext);
      if (path === "/api/admin/trips?limit=25")
        return jsonResponse({ items: [], nextCursor: null });
      if (path === "/api/admin/trips/workspace" && init?.method === "POST")
        return jsonResponse(createdWorkspace, 201);
      if (path === `/api/admin/trips/${tripId}/workspace`) return jsonResponse(createdWorkspace);
      if (path === `/api/admin/trips/${tripId}/publications`) return jsonResponse(emptyHistory);
      throw new Error(`Unexpected Admin API request: ${path} ${init?.method ?? ""}`);
    });
    window.history.replaceState({}, "", "/#/trips");

    render(<AdminRoot />);
    await screen.findByRole("heading", { name: "Viagens" });
    fireEvent.click(screen.getByRole("button", { name: "Nova viagem" }));
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "Cliente de teste" } });
    fireEvent.change(screen.getByLabelText("Nome próprio do viajante principal"), {
      target: { value: "Joana" },
    });
    fireEvent.change(screen.getByLabelText("Apelido do viajante principal"), {
      target: { value: "Exemplo" },
    });
    fireEvent.change(screen.getByLabelText("Nome da viagem"), {
      target: { value: "Viagem de teste" },
    });
    fireEvent.change(screen.getByLabelText("Data de início"), {
      target: { value: "2027-06-04" },
    });
    fireEvent.change(screen.getByLabelText("Data de fim"), {
      target: { value: "2027-06-11" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar viagem" }));

    expect(await screen.findByRole("heading", { name: "Viagem de teste" })).toBeInTheDocument();
    const createCall = mocks.fetch.mock.calls.find(
      ([input, init]) => pathOf(input) === "/api/admin/trips/workspace" && init?.method === "POST",
    );
    expect(createCall?.[1]?.body).toBe(
      JSON.stringify({
        customer: { displayName: "Cliente de teste" },
        primaryTraveller: { givenName: "Joana", familyName: "Exemplo" },
        trip: { title: "Viagem de teste", startDate: "2027-06-04", endDate: "2027-06-11" },
      }),
    );
    expect(window.location.hash).toBe(`#/trips/${tripId}`);
  });

  it("edits the Trip and Accommodation, previews the exact revision, publishes it and shows history", async () => {
    const projectionHash = "b".repeat(64);
    let currentWorkspace = structuredClone(workspace);
    let history = { entries: [], nextCursor: null } as {
      entries: Array<{
        version: number;
        publishedAt: string;
        actorReference: string;
        schemaVersion: 1;
        projectionHash: string;
        isActive: boolean;
      }>;
      nextCursor: string | null;
    };
    const projection = {
      schemaVersion: 1,
      trip: {
        title: "Rota revista",
        startDate: "2027-06-04",
        endDate: "2027-06-11",
      },
      items: [],
    };
    mocks.fetch.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const path = pathOf(input);
      if (path === "/api/staff/session-context") return jsonResponse(staffContext);
      if (path === `/api/admin/trips/${tripId}/workspace` && init?.method === "GET")
        return jsonResponse(currentWorkspace);
      if (path === `/api/admin/trips/${tripId}/publications` && init?.method === "GET")
        return jsonResponse(history);
      if (path === `/api/admin/trips/${tripId}/workspace` && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as {
          expectedLockVersion: string;
          expectedWorkspaceRevision: string;
          trip: { title: string; startDate: string; endDate: string };
        };
        expect(body.expectedLockVersion).toBe(currentWorkspace.trip.lockVersion);
        expect(body.expectedWorkspaceRevision).toBe(currentWorkspace.trip.workspaceRevision);
        currentWorkspace = {
          ...currentWorkspace,
          trip: {
            ...currentWorkspace.trip,
            ...body.trip,
            workspaceRevision: "4",
            lockVersion: "3",
          },
        };
        return jsonResponse(currentWorkspace);
      }
      if (
        path === `/api/admin/trips/${tripId}/workspace/accommodations/${accommodationId}` &&
        init?.method === "PATCH"
      ) {
        const body = JSON.parse(String(init.body)) as {
          expectedLockVersion: string;
          expectedWorkspaceRevision: string;
          accommodation: { title: string };
        };
        expect(body.expectedLockVersion).toBe("1");
        expect(body.expectedWorkspaceRevision).toBe("4");
        currentWorkspace = {
          ...currentWorkspace,
          trip: { ...currentWorkspace.trip, workspaceRevision: "5" },
          accommodations: currentWorkspace.accommodations.map((item) =>
            item.id === accommodationId
              ? { ...item, ...body.accommodation, lockVersion: "2" }
              : item,
          ),
        };
        return jsonResponse(currentWorkspace);
      }
      if (path === `/api/admin/trips/${tripId}/publication-preview`)
        return jsonResponse({
          workspaceRevision: currentWorkspace.trip.workspaceRevision,
          projectionHash,
          schemaVersion: 1,
          projection,
        });
      if (path === `/api/admin/trips/${tripId}/publications` && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          expectedWorkspaceRevision: string;
          expectedProjectionHash: string;
          idempotencyKey: string;
        };
        expect(body).toEqual({
          expectedWorkspaceRevision: "5",
          expectedProjectionHash: projectionHash,
          idempotencyKey: expect.any(String),
        });
        history = {
          entries: [
            {
              version: 1,
              publishedAt: "2027-01-01T12:00:00.000Z",
              actorReference: "staff-principal-test",
              schemaVersion: 1,
              projectionHash,
              isActive: true,
            },
          ],
          nextCursor: null,
        };
        return jsonResponse({
          publicationId: "019a0101-0000-7000-8000-000000000005",
          tripId,
          version: 1,
          publishedAt: "2027-01-01T12:00:00.000Z",
          schemaVersion: 1,
          projectionHash,
          isActive: true,
          projection,
        });
      }
      throw new Error(`Unexpected Admin API request: ${path} ${init?.method ?? ""}`);
    });
    window.history.replaceState({}, "", `/#/trips/${tripId}`);

    render(<AdminRoot />);
    await screen.findByRole("heading", { name: "Rota do Pico" });
    fireEvent.click(screen.getByRole("button", { name: "Editar viagem" }));
    expect(screen.getByRole("button", { name: "Pré-visualizar publicação" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Nome da viagem"), {
      target: { value: "Rota revista" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar viagem" }));
    expect(await screen.findByRole("heading", { name: "Rota revista" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Editar alojamento/u }));
    fireEvent.change(screen.getByLabelText("Título do alojamento"), {
      target: { value: "Estadia revista" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar alojamento" }));
    expect(await screen.findByRole("heading", { name: "Estadia revista" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar publicação" }));
    expect(await screen.findByText("Pré-visualização — ainda não publicada")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publicar versão" }));
    expect(await screen.findByText("Versão 1 publicada")).toBeInTheDocument();
    expect(await screen.findByText("Versão 1 · Ativa")).toBeInTheDocument();
    expect(screen.getByText("Rota revista")).toBeInTheDocument();
  });

  it("invalidates a stale publication preview after a typed conflict", async () => {
    const projectionHash = "c".repeat(64);
    let workspaceReads = 0;
    const refreshedWorkspace = {
      ...workspace,
      trip: {
        ...workspace.trip,
        title: "Rota atualizada por outra pessoa",
        workspaceRevision: "4",
        lockVersion: "3",
      },
    };
    const projection = {
      schemaVersion: 1,
      trip: { title: "Rota do Pico", startDate: "2027-06-04", endDate: "2027-06-11" },
      items: [],
    };
    mocks.fetch.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const path = pathOf(input);
      if (path === "/api/staff/session-context") return jsonResponse(staffContext);
      if (path === `/api/admin/trips/${tripId}/workspace`) {
        workspaceReads += 1;
        return jsonResponse(workspaceReads === 1 ? workspace : refreshedWorkspace);
      }
      if (path === `/api/admin/trips/${tripId}/publications` && init?.method === "GET")
        return jsonResponse({ entries: [], nextCursor: null });
      if (path === `/api/admin/trips/${tripId}/publication-preview`)
        return jsonResponse({
          workspaceRevision: "3",
          projectionHash,
          schemaVersion: 1,
          projection,
        });
      if (path === `/api/admin/trips/${tripId}/publications` && init?.method === "POST")
        return new Response(null, { status: 409 });
      throw new Error(`Unexpected Admin API request: ${path} ${init?.method ?? ""}`);
    });
    window.history.replaceState({}, "", `/#/trips/${tripId}`);

    render(<AdminRoot />);
    await screen.findByRole("heading", { name: "Rota do Pico" });
    fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar publicação" }));
    expect(await screen.findByText("Pré-visualização — ainda não publicada")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publicar versão" }));

    expect(await screen.findByText(/A pré-visualização ficou desatualizada/u)).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Rota atualizada por outra pessoa" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publicar versão" })).not.toBeInTheDocument();
    expect(
      mocks.fetch.mock.calls.filter(
        ([input, init]) =>
          pathOf(input) === `/api/admin/trips/${tripId}/publications` && init?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("offers invitation management only when the Staff session context grants the UI hint", async () => {
    window.history.replaceState({}, "", "/#/staff/invitations");
    mocks.fetch.mockImplementation(async (input: unknown) => {
      const path = pathOf(input);
      if (path === "/api/staff/session-context")
        return jsonResponse({ ...staffContext, canInviteStaff: true });
      if (path === "/api/admin/staff/invitations?limit=25")
        return jsonResponse({ items: [], nextCursor: null });
      throw new Error(`Unexpected Admin API request: ${path}`);
    });

    render(<AdminRoot />);

    expect(await screen.findByRole("heading", { name: "Convites de equipa" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Convites de equipa" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/admin/staff/invitations?limit=25",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
    expect(mocks.fetch).not.toHaveBeenCalledWith("/api/admin/trips?limit=25", expect.anything());
  });

  it("routes the Leads navigation entry to the lead list without loading Trips", async () => {
    window.history.replaceState({}, "", "/#/leads");
    mocks.fetch.mockImplementation(async (input: unknown) => {
      const path = pathOf(input);
      if (path === "/api/staff/session-context") return jsonResponse(staffContext);
      if (path === "/api/admin/leads?limit=25&state=OPEN")
        return jsonResponse({ items: [], nextCursor: null });
      throw new Error(`Unexpected Admin API request: ${path}`);
    });

    render(<AdminRoot />);

    expect(await screen.findByRole("heading", { name: "Leads", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Leads" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText("Não existem leads neste estado.")).toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalledWith("/api/admin/trips?limit=25", expect.anything());
  });

  it("opens a lead detail route and rejects a malformed lead identifier", async () => {
    const detailLeadId = "019b0101-0000-7000-8000-000000000010";
    window.history.replaceState({}, "", `/#/leads/${detailLeadId}`);
    mocks.fetch.mockImplementation(async (input: unknown) => {
      const path = pathOf(input);
      if (path === "/api/staff/session-context") return jsonResponse(staffContext);
      if (path === `/api/admin/leads/${detailLeadId}`) return new Response(null, { status: 404 });
      throw new Error(`Unexpected Admin API request: ${path}`);
    });
    render(<AdminRoot />);
    expect(await screen.findByRole("heading", { name: "Lead não encontrado" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Leads" })).toHaveAttribute("aria-current", "page");
    cleanup();

    window.history.replaceState({}, "", "/#/leads/not-a-uuid");
    render(<AdminRoot />);
    expect(await screen.findByRole("heading", { name: "Endereço inválido" })).toBeInTheDocument();
  });

  it("denies direct invitation navigation when the server UI hint is absent", async () => {
    window.history.replaceState({}, "", "/#/staff/invitations");
    mocks.fetch.mockImplementation(async (input: unknown) => {
      const path = pathOf(input);
      if (path === "/api/staff/session-context")
        return jsonResponse({ ...staffContext, canInviteStaff: false });
      throw new Error(`Unexpected Admin API request: ${path}`);
    });

    render(<AdminRoot />);

    expect(
      await screen.findByRole("heading", { name: "Acesso não autorizado" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A sua sessão não tem autorização para gerir convites de Staff."),
    ).toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalledWith(
      "/api/admin/staff/invitations?limit=25",
      expect.anything(),
    );
    expect(mocks.fetch).not.toHaveBeenCalledWith("/api/admin/trips?limit=25", expect.anything());
  });

  it("accepts an invitation on a generic public route without loading Staff context", async () => {
    window.history.replaceState({}, "", "/#/staff/invitations/accept");
    mocks.fetch.mockImplementation(async (input: unknown, init?: RequestInit) => {
      if (pathOf(input) === "/api/staff/invitations/accept" && init?.method === "POST") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected Admin API request: ${pathOf(input)} ${init?.method ?? ""}`);
    });

    render(<AdminRoot />);

    expect(
      await screen.findByRole("heading", { name: "Aceitar convite de Staff" }),
    ).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Aceitar convite de Staff" });
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/staff/invitations/accept");
    fireEvent.change(screen.getByLabelText("Código do convite"), {
      target: { value: "A".repeat(43) },
    });
    fireEvent.change(screen.getByLabelText("Nome completo"), {
      target: { value: "QA Staff" },
    });
    fireEvent.change(screen.getByLabelText("Criar palavra-passe"), {
      target: { value: "synthetic-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aceitar convite" }));

    expect(await screen.findByRole("heading", { name: "Convite aceite" })).toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalledWith("/api/staff/session-context", expect.anything());
    expect(window.location.href).not.toContain("A".repeat(43));
    expect(window.location.href).not.toContain("synthetic-password");
  });

  it("requires recovery-code confirmation and valid TOTP before first Staff access", async () => {
    let sessionRequests = 0;
    mocks.fetch.mockImplementation(async (input: unknown) => {
      const path = pathOf(input);
      if (path === "/api/staff/session-context") {
        sessionRequests += 1;
        return sessionRequests === 1
          ? new Response(null, { status: 401 })
          : jsonResponse(staffContext);
      }
      if (path === "/api/admin/trips?limit=25") return jsonResponse(adminList);
      throw new Error(`Unexpected Admin API request: ${path}`);
    });
    mocks.staffAuthClient.getSession.mockResolvedValueOnce({
      data: { user: { twoFactorEnabled: false } },
      error: null,
    });

    render(<AdminRoot />);
    await screen.findByRole("heading", { name: "Entrar na equipa" });
    submitFirstLogin();

    expect(
      await screen.findByRole("heading", { name: "Configurar autenticação de dois fatores" }),
    ).toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalledWith("/api/admin/trips?limit=25", expect.anything());
    expect(mocks.staffAuthClient.getSession).toHaveBeenCalledOnce();

    await enableFirstMfaFactor();
    expect(mocks.staffAuthClient.twoFactor.enable).toHaveBeenCalledWith({
      password: "synthetic-password",
      issuer: "TravelOS Staff",
    });
    expect(mocks.staffAuthClient.twoFactor.verifyTotp).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalledWith("/api/admin/trips?limit=25", expect.anything());

    fireEvent.change(screen.getByLabelText("Código da aplicação de autenticação"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validar e continuar" }));

    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
    expect(mocks.staffAuthClient.twoFactor.verifyTotp).toHaveBeenCalledWith({ code: "123456" });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/admin/trips?limit=25",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
    expect(document.body.textContent).not.toContain("SYNTHETIC-TOTP-SEED");
    expect(document.body.textContent).not.toContain("RECOVERY-CODE-ONE");
    expect(window.location.href).not.toContain("SYNTHETIC-TOTP-SEED");
    expect(window.location.href).not.toContain("123456");
    expect(window.localStorage.length).toBe(0);
  });

  it("keeps an invalid first-time TOTP outside the authenticated Admin workspace", async () => {
    let sessionRequests = 0;
    mocks.fetch.mockImplementation(async (input: unknown) => {
      const path = pathOf(input);
      if (path === "/api/staff/session-context") {
        sessionRequests += 1;
        return new Response(null, { status: 401 });
      }
      throw new Error(`Unexpected Admin API request: ${path}`);
    });
    mocks.staffAuthClient.getSession.mockResolvedValueOnce({
      data: { user: { twoFactorEnabled: false } },
      error: null,
    });
    mocks.staffAuthClient.twoFactor.verifyTotp.mockResolvedValueOnce({
      data: null,
      error: { message: "invalid synthetic code" },
    });

    render(<AdminRoot />);
    await screen.findByRole("heading", { name: "Entrar na equipa" });
    submitFirstLogin();
    await screen.findByRole("heading", { name: "Configurar autenticação de dois fatores" });
    await enableFirstMfaFactor();
    fireEvent.change(screen.getByLabelText("Código da aplicação de autenticação"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validar e continuar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível validar o código. Tente novamente.",
    );
    expect(screen.queryByRole("heading", { name: "Visão geral" })).not.toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalledWith("/api/admin/trips?limit=25", expect.anything());
    expect(sessionRequests).toBe(1);
  });
});
