// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuoteCreateDialog } from "../src/quote-create-dialog.js";
import { QuoteEditor } from "../src/quote-editor.js";
import { SEND_RECENT_MFA_MESSAGE } from "../src/quote-send-dialog.js";
import { MockQuoteApi, QUOTE_ID } from "./quote-fixtures.js";

let api: MockQuoteApi;
let override: ((method: string, url: string) => [number, unknown] | null) | null = null;

const install = (instance: MockQuoteApi): void => {
  api = instance;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const url = String(input);
      const forced = override?.(method, url) ?? null;
      const answer =
        forced ??
        api.handle(method, url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
      if (answer === null) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(answer[1]), {
        status: answer[0],
        headers: { "content-type": "application/json" },
      });
    }),
  );
};

const open = async (instance = new MockQuoteApi()): Promise<void> => {
  install(instance);
  render(<QuoteEditor quoteId={QUOTE_ID} onAuthenticationRequired={vi.fn()} />);
  await screen.findByRole("heading", { name: "Orçamento ORC-2027-0007" });
};

const writes = () => api.writes();

beforeEach(() => {
  override = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("quote editor sheets", () => {
  it("shows both sheets with automatic totals from the API", async () => {
    await open();
    expect(screen.getByRole("heading", { name: /Proposta/u })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Opções/u })).toBeInTheDocument();
    const summary = screen.getByRole("complementary", { name: "Resumo de preço" });
    expect(within(summary).getAllByText(/1\s804,00\s€/u).length).toBeGreaterThan(0);
    // NET agência is automatic and read-only text, not an input.
    expect(screen.queryByLabelText(/NET agência:/u)).toBeNull();
    // Nights are derived from the dates.
    expect(
      screen.getAllByTitle("Calculado a partir das datas").some((cell) => cell.textContent === "7"),
    ).toBe(true);
  });

  it("saves one full line PATCH when an inline cell loses focus", async () => {
    await open();
    const cell = screen.getByLabelText("Fornecedor: Passeio de levada");
    fireEvent.change(cell, { target: { value: "Levadas Exemplo" } });
    fireEvent.blur(cell);
    await waitFor(() => expect(writes()).toHaveLength(1));
    const [call] = writes();
    expect(call?.method).toBe("PATCH");
    expect(call?.path).toContain("/lines/");
    expect(call?.body).toMatchObject({
      supplier: "Levadas Exemplo",
      service: "Passeio de levada",
      expectedLockVersion: "1",
      pvpMinor: "6500",
    });
    expect(await screen.findByLabelText("Fornecedor: Passeio de levada")).toHaveValue(
      "Levadas Exemplo",
    );
  });

  it("sends money as minor-unit strings, never floats", async () => {
    await open();
    const cell = screen.getByLabelText("PVP: Seguro de viagem");
    fireEvent.change(cell, { target: { value: "41,5" } });
    fireEvent.blur(cell);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toMatchObject({ pvpMinor: "4150" });
  });

  it("adds a line to the sheet with the previous category and focuses its service", async () => {
    await open();
    const base = screen.getByRole("region", { name: /Proposta/u });
    fireEvent.click(within(base).getByRole("button", { name: "+ Linha" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toMatchObject({
      section: "BASE",
      category: "CAR",
      service: "Aluguer de carro",
    });
    await waitFor(() =>
      expect(screen.getAllByLabelText("Serviço: Aluguer de carro").length).toBeGreaterThan(0),
    );
  });

  it("N and D act on the row whose handle has focus", async () => {
    await open();
    const handle = screen.getByRole("button", { name: "Mover linha Seguro de viagem" });
    handle.focus();
    fireEvent.keyDown(handle, { key: "d" });
    await waitFor(() => expect(writes().some((c) => c.path.endsWith("/duplicate"))).toBe(true));
    fireEvent.keyDown(handle, { key: "n" });
    await waitFor(() =>
      expect(writes().some((c) => c.method === "POST" && c.path.endsWith("/lines"))).toBe(true),
    );
  });

  it("Alt+ArrowUp reorders through line-order and announces the move", async () => {
    await open();
    const handle = screen.getByRole("button", { name: "Mover linha Voo Funchal – Lisboa" });
    fireEvent.keyDown(handle, { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.method).toBe("PUT");
    expect(writes()[0]?.path).toBe(`/api/admin/quotes/${QUOTE_ID}/line-order`);
    const order = (writes()[0]?.body as { order: { lineId: string }[] }).order;
    expect(order[0]?.lineId).toBe("019b0301-0000-7000-8000-000000000102");
    expect(
      await screen.findByText(/movida para a posição 1 de 7 em Proposta/u),
    ).toBeInTheDocument();
  });

  it("Alt+ArrowRight moves a line to Opções", async () => {
    await open();
    const handle = screen.getByRole("button", { name: "Mover linha Seguro de viagem" });
    fireEvent.keyDown(handle, { key: "ArrowRight", altKey: true });
    await waitFor(() => expect(writes()).toHaveLength(1));
    const order = (writes()[0]?.body as { order: { lineId: string; section: string }[] }).order;
    expect(
      order.find((entry) => entry.lineId === "019b0301-0000-7000-8000-000000000106")?.section,
    ).toBe("OPTION");
  });

  it("drag and drop onto another row sends the new order", async () => {
    await open();
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", setDragImage: vi.fn() };
    const handle = screen.getByRole("button", { name: "Mover linha Seguro de viagem" });
    fireEvent.dragStart(handle, { dataTransfer });
    const target = screen
      .getByLabelText("Serviço: Voo Lisboa – Funchal")
      .closest("tr") as HTMLElement;
    fireEvent.dragOver(target, { dataTransfer, clientY: 0 });
    fireEvent.drop(target.closest("table") as HTMLElement, { dataTransfer });
    await waitFor(() => expect(writes()).toHaveLength(1));
    const order = (writes()[0]?.body as { order: { lineId: string }[] }).order;
    expect(order[0]?.lineId).toBe("019b0301-0000-7000-8000-000000000106");
  });

  it("asks before deleting and sends the line lock version", async () => {
    await open();
    const handle = screen.getByRole("button", { name: "Mover linha Seguro de viagem" });
    fireEvent.keyDown(handle, { key: "Delete" });
    const dialog = await screen.findByRole("dialog", { name: "Apagar linha?" });
    expect(writes()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Apagar linha" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.method).toBe("DELETE");
    expect(writes()[0]?.path).toContain("expectedLockVersion=1");
  });

  it("clicking a line warning focuses that line", async () => {
    await open();
    fireEvent.click(
      screen.getByRole("button", { name: "Falta indicar o fornecedor desta linha." }),
    );
    await waitFor(() => expect(screen.getByLabelText("Serviço: Passeio de levada")).toHaveFocus());
  });
});

describe("quote editor summary and states", () => {
  it("applies the target margin after confirmation", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar margem alvo" }));
    const dialog = await screen.findByRole("dialog", { name: "Aplicar margem alvo?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Aplicar margem" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.path).toBe(`/api/admin/quotes/${QUOTE_ID}/apply-margin`);
    expect(writes()[0]?.body).toEqual({ lineIds: null, rounding: "EURO" });
  });

  it("pins the PVP manually as minor units", async () => {
    await open();
    fireEvent.click(screen.getByLabelText("Fixar manualmente"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toMatchObject({ pvpOverrideMinor: "180400" });
  });

  it("shows the conflict message with a reload button on 409", async () => {
    await open();
    override = (method) => (method === "PATCH" ? [409, {}] : null);
    const cell = screen.getByLabelText("Serviço: Seguro de viagem");
    fireEvent.change(cell, { target: { value: "Seguro completo" } });
    fireEvent.blur(cell);
    const alert = await screen.findByText(/foi alterado por outra pessoa/u);
    expect(alert).toBeInTheDocument();
    override = null;
    fireEvent.click(screen.getByRole("button", { name: "Recarregar orçamento" }));
    await waitFor(() => expect(screen.queryByText(/foi alterado por outra pessoa/u)).toBeNull());
  });

  it("shows the accepted banner and converts to a trip", async () => {
    const instance = new MockQuoteApi({
      state: "ACCEPTED",
      versions: [
        {
          id: "019b0301-0000-7000-8000-000000000501",
          quoteId: QUOTE_ID,
          versionNumber: 1,
          sentAt: "2026-11-28T09:00:00.000Z",
          pvpFinalMinor: "100000",
          currencyCode: "EUR",
          payloadSha256: "ab".repeat(32),
          acceptance: { acceptedAt: "2026-11-29T10:00:00.000Z", acceptedName: "Marta Quintela" },
          isLatest: true,
          shareLinks: [],
        },
      ],
    });
    await open(instance);
    expect(screen.getByText("Aceite por Marta Quintela em 29/11/2026.")).toBeInTheDocument();
    // Accepted quotes are read-only.
    expect(screen.getByLabelText("Serviço: Seguro de viagem")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Converter em viagem" }));
    await waitFor(() =>
      expect(window.location.hash).toBe("#/viagens/019b0301-0000-7000-8000-000000000701"),
    );
  });

  it("offers a new version for a sent quote", async () => {
    await open(new MockQuoteApi({ state: "SENT" }));
    expect(screen.getByLabelText("Serviço: Seguro de viagem")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Editar (nova versão)" }));
    await waitFor(() => expect(writes()[0]?.path).toBe(`/api/admin/quotes/${QUOTE_ID}/revise`));
    await waitFor(() => expect(screen.getByLabelText("Serviço: Seguro de viagem")).toBeEnabled());
  });

  it("opens the draft preview in a new tab", async () => {
    await open();
    const link = screen.getByRole("link", { name: "Pré-visualizar proposta" });
    expect(link).toHaveAttribute("href", `/api/admin/quotes/${QUOTE_ID}/preview`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});

describe("sending", () => {
  it("creates the version, then copies the link and the (edited) message", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao cliente" }));
    const dialog = await screen.findByRole("dialog", { name: "Enviar ao cliente" });
    expect(dialog).toHaveTextContent("12/12/2026");
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar link e mensagem" }));
    const ready = await screen.findByRole("dialog", { name: "Proposta pronta a enviar" });
    expect(writes()[0]?.body).toEqual({ expectedLockVersion: "5", expiresAt: null });

    fireEvent.click(within(ready).getByRole("button", { name: "Copiar link" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`https://propostas.example.test/v/${"A".repeat(43)}`),
    );

    const message = within(ready).getByLabelText("Mensagem");
    expect((message as HTMLTextAreaElement).value).toContain("Olá Marta, segue a vossa proposta");
    fireEvent.change(message, { target: { value: "Olá Marta, aqui está." } });
    fireEvent.click(within(ready).getByRole("button", { name: "Copiar mensagem" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("Olá Marta, aqui está."));
    expect(within(ready).getByRole("link", { name: "Abrir email" })).toHaveAttribute(
      "href",
      expect.stringContaining("body=Ol%C3%A1%20Marta%2C%20aqui%20est%C3%A1."),
    );
    expect(within(ready).getByRole("link", { name: "Abrir WhatsApp" })).toHaveAttribute(
      "href",
      expect.stringContaining("https://wa.me/351912345678?text=Ol%C3%A1%20Marta%2C"),
    );
    // The sent quote is reloaded and becomes read-only.
    await waitFor(() => expect(screen.getByLabelText("Serviço: Seguro de viagem")).toBeDisabled());
  });

  it("explains the recent-MFA requirement on 403", async () => {
    await open();
    override = (method, url) => (method === "POST" && url.endsWith("/send") ? [403, {}] : null);
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao cliente" }));
    const dialog = await screen.findByRole("dialog", { name: "Enviar ao cliente" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar link e mensagem" }));
    expect(await screen.findByText(SEND_RECENT_MFA_MESSAGE)).toBeInTheDocument();
  });
});

describe("new quote dialog", () => {
  it("creates a quote for the pre-selected lead and opens the editor", async () => {
    install(new MockQuoteApi());
    const onClose = vi.fn();
    render(
      <QuoteCreateDialog
        presetLeadId="019b0301-0000-7000-8000-000000000003"
        onClose={onClose}
        onAuthenticationRequired={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Criar orçamento" }));
    await waitFor(() => expect(window.location.hash).toBe(`#/orcamentos/${QUOTE_ID}`));
    expect(writes()[0]?.body).toEqual({ leadId: "019b0301-0000-7000-8000-000000000003" });
  });

  it("makes the person choose a lead when none is given", async () => {
    install(new MockQuoteApi());
    override = (_method, url) =>
      url.startsWith("/api/admin/leads") ? [200, { items: [], nextCursor: null }] : null;
    render(<QuoteCreateDialog onClose={vi.fn()} onAuthenticationRequired={vi.fn()} />);
    expect(await screen.findByText(/Não há leads qualificadas/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Criar orçamento" }));
    expect(await screen.findByText("Escolha uma lead para continuar.")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });
});

describe("quotes of a lead", () => {
  it("lists them and blocks creation until the lead is qualified", async () => {
    install(new MockQuoteApi());
    const { EntityQuotes } = await import("../src/entity-quotes.js");
    render(
      <EntityQuotes
        leadId="019b0301-0000-7000-8000-000000000003"
        canCreate={false}
        blockedReason="Qualifique a lead para criar orçamentos."
        onAuthenticationRequired={vi.fn()}
      />,
    );
    expect(await screen.findByRole("link", { name: "ORC-2027-0007" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo orçamento" })).toBeDisabled();
    expect(screen.getByText("Qualifique a lead para criar orçamentos.")).toBeInTheDocument();
  });
});
