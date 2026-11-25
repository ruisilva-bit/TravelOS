// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LEAD_CONFLICT_MESSAGE, LeadsView } from "../src/leads-view.js";

const agencyId = "019b0101-0000-7000-8000-000000000001";
const leadId = "019b0101-0000-7000-8000-000000000010";
const secondLeadId = "019b0101-0000-7000-8000-000000000011";
const customerId = "019b0101-0000-7000-8000-000000000020";

const lead = (overrides: Record<string, unknown> = {}) => ({
  id: leadId,
  agencyId,
  source: "WEBSITE",
  contactGivenName: "Marta",
  contactFamilyName: "Quintela",
  contactEmail: null,
  contactPhone: "+351 910 000 000",
  internalNote: "Quer visitar o Pico em junho",
  state: "OPEN",
  qualifiedCustomerId: null,
  disqualificationReason: null,
  lockVersion: "1",
  createdAt: "2026-11-25T10:00:00.000Z",
  updatedAt: "2026-11-25T10:00:00.000Z",
  closedAt: null,
  ...overrides,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

const fetchMock = vi.fn();
const calls: RecordedCall[] = [];

const respondWith = (handler: (call: RecordedCall) => Response | Promise<Response>): void => {
  fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const call: RecordedCall = {
      method: init?.method ?? "GET",
      path: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handler(call);
  });
};

const callsTo = (method: string, path: string): readonly RecordedCall[] =>
  calls.filter((call) => call.method === method && call.path === path);

const onAuthenticationRequired = vi.fn();
const renderList = () =>
  render(<LeadsView leadId={null} onAuthenticationRequired={onAuthenticationRequired} />);
const renderDetail = (id = leadId) =>
  render(<LeadsView leadId={id} onAuthenticationRequired={onAuthenticationRequired} />);

beforeEach(() => {
  calls.length = 0;
  fetchMock.mockReset();
  onAuthenticationRequired.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Admin Lead list", () => {
  it("loads open leads first and switches the server-side state filter", async () => {
    respondWith((call) => {
      if (call.path === "/api/admin/leads?limit=25&state=OPEN") {
        return jsonResponse({ items: [lead()], nextCursor: null });
      }
      if (call.path === "/api/admin/leads?limit=25&state=QUALIFIED") {
        return jsonResponse({
          items: [
            lead({
              id: secondLeadId,
              contactGivenName: "Rui",
              contactFamilyName: "Pires",
              state: "QUALIFIED",
              qualifiedCustomerId: customerId,
              lockVersion: "2",
              closedAt: "2026-11-25T11:00:00.000Z",
            }),
          ],
          nextCursor: null,
        });
      }
      throw new Error(`Unexpected request ${call.path}`);
    });
    renderList();

    expect(await screen.findByRole("link", { name: "Abrir lead: Marta Quintela" })).toHaveAttribute(
      "href",
      `#/leads/${leadId}`,
    );
    expect(screen.getByRole("button", { name: "Abertas" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Aberta")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Qualificadas" }));
    expect(await screen.findByRole("link", { name: "Abrir lead: Rui Pires" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Abrir lead: Marta Quintela" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Qualificada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desqualificadas" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("loads more with the cursor without duplicating rows", async () => {
    respondWith((call) => {
      if (call.path === "/api/admin/leads?limit=25&state=OPEN") {
        return jsonResponse({ items: [lead()], nextCursor: leadId });
      }
      if (call.path === `/api/admin/leads?limit=25&cursor=${leadId}&state=OPEN`) {
        return jsonResponse({
          items: [
            lead(),
            lead({ id: secondLeadId, contactGivenName: "Rui", contactFamilyName: "Pires" }),
          ],
          nextCursor: null,
        });
      }
      throw new Error(`Unexpected request ${call.path}`);
    });
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByRole("link", { name: "Abrir lead: Rui Pires" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Abrir lead: Marta Quintela" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
  });

  it("shows an empty state and an authorization state instead of diagnostics", async () => {
    respondWith(() => jsonResponse({ items: [], nextCursor: null }));
    renderList();
    expect(await screen.findByText("Não existem leads neste estado.")).toBeInTheDocument();
    cleanup();
    respondWith(
      () => new Response(JSON.stringify({ internal: "private-detail" }), { status: 403 }),
    );
    renderList();
    expect(
      await screen.findByText("Não tem permissão para consultar os leads desta agência."),
    ).toBeInTheDocument();
    expect(screen.queryByText("private-detail")).not.toBeInTheDocument();
  });

  it("asks the shell to re-authenticate on 401", async () => {
    respondWith(() => new Response(null, { status: 401 }));
    renderList();
    await waitFor(() => expect(onAuthenticationRequired).toHaveBeenCalled());
  });

  it("creates a lead with an idempotency key and opens its detail", async () => {
    respondWith((call) => {
      if (call.method === "GET") return jsonResponse({ items: [], nextCursor: null });
      if (call.method === "POST" && call.path === "/api/admin/leads") {
        return jsonResponse(lead({ id: secondLeadId, source: "PHONE" }), 201);
      }
      throw new Error(`Unexpected request ${call.method} ${call.path}`);
    });
    renderList();
    await screen.findByText("Não existem leads neste estado.");
    fireEvent.click(screen.getByRole("button", { name: "Novo lead" }));
    fireEvent.change(screen.getByLabelText("Origem"), { target: { value: "PHONE" } });
    fireEvent.change(screen.getByLabelText("Nome próprio do contacto"), {
      target: { value: "Marta" },
    });
    fireEvent.change(screen.getByLabelText("Apelido do contacto"), {
      target: { value: "Quintela" },
    });
    fireEvent.change(screen.getByLabelText("Telefone do contacto"), {
      target: { value: "+351 910 000 000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar lead" }));

    await waitFor(() => expect(window.location.hash).toBe(`#/leads/${secondLeadId}`));
    const [post] = callsTo("POST", "/api/admin/leads");
    expect(post?.body).toEqual({
      source: "PHONE",
      contactGivenName: "Marta",
      contactFamilyName: "Quintela",
      contactEmail: null,
      contactPhone: "+351 910 000 000",
      internalNote: null,
    });
    expect(post?.headers["idempotency-key"]).toMatch(/^[0-9a-f]{32}$/u);
  });

  it("reuses the idempotency key after a network failure but not after a rejection", async () => {
    let attempts = 0;
    respondWith((call) => {
      if (call.method === "GET") return jsonResponse({ items: [], nextCursor: null });
      attempts += 1;
      if (attempts === 1) throw new TypeError("network down");
      if (attempts === 2) return jsonResponse({}, 403);
      return jsonResponse(lead({ id: secondLeadId }), 201);
    });
    renderList();
    await screen.findByText("Não existem leads neste estado.");
    fireEvent.click(screen.getByRole("button", { name: "Novo lead" }));
    fireEvent.change(screen.getByLabelText("Nome próprio do contacto"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Apelido do contacto"), { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar lead" }));
    expect(await screen.findByText("Não foi possível contactar o serviço.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar lead" }));
    expect(
      await screen.findByText("Não tem permissão para esta operação sobre leads."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar lead" }));
    await waitFor(() => expect(window.location.hash).toBe(`#/leads/${secondLeadId}`));
    const keys = callsTo("POST", "/api/admin/leads").map((call) => call.headers["idempotency-key"]);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });
});

describe("Admin Lead detail", () => {
  const detailPath = `/api/admin/leads/${leadId}`;

  it("shows the contact facts and the open-lead actions", async () => {
    respondWith(() => jsonResponse(lead()));
    renderDetail();
    expect(
      await screen.findByRole("heading", { name: "Marta Quintela", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Quer visitar o Pico em junho").length).toBeGreaterThan(0);
    expect(screen.getByText("Nota interna")).toBeInTheDocument();
    expect(screen.getByText("+351 910 000 000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Qualificar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desqualificar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar alterações" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nome próprio do contacto")).toHaveValue("Marta");
  });

  it("edits an open lead sending the expected lock version", async () => {
    respondWith((call) =>
      call.method === "PATCH"
        ? jsonResponse(lead({ contactGivenName: "Marta Paula", lockVersion: "2" }))
        : jsonResponse(lead()),
    );
    renderDetail();
    await screen.findByRole("button", { name: "Guardar alterações" });
    fireEvent.change(screen.getByLabelText("Nome próprio do contacto"), {
      target: { value: "Marta Paula" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar alterações" }));
    expect(await screen.findByText("Alterações guardadas.")).toBeInTheDocument();
    const [patch] = callsTo("PATCH", detailPath);
    expect(patch?.body).toMatchObject({
      expectedLockVersion: "1",
      contactGivenName: "Marta Paula",
      contactFamilyName: "Quintela",
    });
    expect(
      await screen.findByRole("heading", { name: "Marta Paula Quintela", level: 1 }),
    ).toBeInTheDocument();
  });

  it("qualifies into a new Customer and then offers no further actions", async () => {
    respondWith((call) =>
      call.method === "POST"
        ? jsonResponse(
            lead({
              state: "QUALIFIED",
              qualifiedCustomerId: customerId,
              lockVersion: "2",
              closedAt: "2026-11-25T11:00:00.000Z",
            }),
          )
        : jsonResponse(lead()),
    );
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Qualificar" }));
    expect(screen.getByLabelText("Criar cliente novo")).toBeChecked();
    fireEvent.change(screen.getByLabelText("Nome do cliente (opcional)"), {
      target: { value: "Quintela Viagens" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar qualificação" }));

    expect(
      await screen.findByText("Lead qualificado: foi criado um novo cliente."),
    ).toBeInTheDocument();
    const [post] = callsTo("POST", `${detailPath}/qualification`);
    expect(post?.body).toEqual({
      expectedLockVersion: "1",
      mode: "CREATE_CUSTOMER",
      customerDisplayName: "Quintela Viagens",
    });
    expect(post?.headers["idempotency-key"]).toBeTruthy();
    expect(screen.getByText("Qualificada")).toBeInTheDocument();
    expect(screen.getByText(customerId)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Qualificar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar alterações" })).not.toBeInTheDocument();
    expect(screen.getByText(/já não pode ser alterado/u)).toBeInTheDocument();
  });

  it("omits the display name when left blank and links an existing Customer by id", async () => {
    respondWith((call) =>
      call.method === "POST"
        ? jsonResponse(
            lead({
              state: "QUALIFIED",
              qualifiedCustomerId: customerId,
              lockVersion: "2",
              closedAt: "2026-11-25T11:00:00.000Z",
            }),
          )
        : jsonResponse(lead()),
    );
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Qualificar" }));
    fireEvent.click(screen.getByLabelText("Associar a cliente existente"));
    expect(screen.queryByLabelText("Nome do cliente (opcional)")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Identificador do cliente existente"), {
      target: { value: customerId },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar qualificação" }));
    expect(
      await screen.findByText("Lead qualificado e associado ao cliente existente."),
    ).toBeInTheDocument();
    expect(callsTo("POST", `${detailPath}/qualification`)[0]?.body).toEqual({
      expectedLockVersion: "1",
      mode: "LINK_CUSTOMER",
      customerId,
    });
  });

  it("explains a missing linked Customer without changing the lead", async () => {
    respondWith((call) =>
      call.method === "POST" ? new Response(null, { status: 404 }) : jsonResponse(lead()),
    );
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Qualificar" }));
    fireEvent.click(screen.getByLabelText("Associar a cliente existente"));
    fireEvent.change(screen.getByLabelText("Identificador do cliente existente"), {
      target: { value: customerId },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar qualificação" }));
    expect(
      await screen.findByText("O lead ou o cliente indicado não está disponível nesta agência."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Qualificar" })).toBeInTheDocument();
    expect(screen.getByText("Aberta")).toBeInTheDocument();
  });

  it("rejects a malformed Customer id before any request is sent", async () => {
    respondWith(() => jsonResponse(lead()));
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Qualificar" }));
    fireEvent.click(screen.getByLabelText("Associar a cliente existente"));
    fireEvent.change(screen.getByLabelText("Identificador do cliente existente"), {
      target: { value: "not-a-uuid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar qualificação" }));
    expect(
      await screen.findByText("Verifique os dados indicados e tente novamente."),
    ).toBeInTheDocument();
    expect(callsTo("POST", `${detailPath}/qualification`)).toHaveLength(0);
  });

  it("disqualifies with a reason", async () => {
    respondWith((call) =>
      call.method === "POST"
        ? jsonResponse(
            lead({
              state: "DISQUALIFIED",
              disqualificationReason: "NO_RESPONSE",
              lockVersion: "2",
              closedAt: "2026-11-25T11:00:00.000Z",
            }),
          )
        : jsonResponse(lead()),
    );
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Desqualificar" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "NO_RESPONSE" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar desqualificação" }));
    expect(await screen.findByText("Lead desqualificado.")).toBeInTheDocument();
    expect(callsTo("POST", `${detailPath}/disqualification`)[0]?.body).toEqual({
      expectedLockVersion: "1",
      reason: "NO_RESPONSE",
    });
    expect(screen.getByText("Desqualificada")).toBeInTheDocument();
    expect(screen.getByText("Sem resposta")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desqualificar" })).not.toBeInTheDocument();
  });

  it("shows the non-destructive conflict message and keeps the typed input until reload", async () => {
    let reloads = 0;
    respondWith((call) => {
      if (call.method === "PATCH") return jsonResponse({ error: "optimistic_conflict" }, 409);
      reloads += 1;
      return jsonResponse(
        reloads === 1 ? lead() : lead({ contactGivenName: "Marta Outra", lockVersion: "2" }),
      );
    });
    renderDetail();
    await screen.findByRole("button", { name: "Guardar alterações" });
    fireEvent.change(screen.getByLabelText("Nome próprio do contacto"), {
      target: { value: "Marta Editada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar alterações" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(LEAD_CONFLICT_MESSAGE);
    expect(LEAD_CONFLICT_MESSAGE).toContain("Este lead foi alterado por outra pessoa — recarregue");
    // The user's input is preserved and nothing was overwritten silently.
    expect(screen.getByLabelText("Nome próprio do contacto")).toHaveValue("Marta Editada");
    expect(callsTo("PATCH", detailPath)).toHaveLength(1);

    fireEvent.click(within(alert).getByRole("button", { name: "Recarregar lead" }));
    expect(
      await screen.findByRole("heading", { name: "Marta Outra Quintela", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nome próprio do contacto")).toHaveValue("Marta Outra");
  });

  it("shows the conflict message when the lead was closed by someone else", async () => {
    respondWith((call) =>
      call.method === "POST" ? jsonResponse({ error: "LEAD_NOT_OPEN" }, 409) : jsonResponse(lead()),
    );
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Desqualificar" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "OTHER" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar desqualificação" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(LEAD_CONFLICT_MESSAGE);
  });

  it("renders not-found and denied states without leaking identifiers", async () => {
    respondWith(() => new Response(null, { status: 404 }));
    renderDetail();
    expect(await screen.findByRole("heading", { name: "Lead não encontrado" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Voltar aos leads" })).toHaveAttribute(
      "href",
      "#/leads",
    );
    cleanup();
    respondWith(() => new Response(null, { status: 403 }));
    renderDetail();
    expect(
      await screen.findByRole("heading", { name: "Acesso não autorizado" }),
    ).toBeInTheDocument();
  });

  it("renders a closed lead read-only", async () => {
    respondWith(() =>
      jsonResponse(
        lead({
          state: "DISQUALIFIED",
          disqualificationReason: "DUPLICATE",
          lockVersion: "2",
          closedAt: "2026-11-25T11:00:00.000Z",
        }),
      ),
    );
    renderDetail();
    expect(await screen.findByText("Desqualificada")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nome próprio do contacto")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Qualificar" })).not.toBeInTheDocument();
  });
});
