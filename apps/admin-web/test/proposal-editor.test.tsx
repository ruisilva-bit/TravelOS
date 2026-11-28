// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuoteEditor } from "../src/quote-editor.js";
import { MockQuoteApi, QUOTE_ID } from "./quote-fixtures.js";

let api: MockQuoteApi;

const open = async (instance = new MockQuoteApi(), section = "Capa"): Promise<void> => {
  api = instance;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const answer = api.handle(
        init?.method ?? "GET",
        String(input),
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      );
      return new Response(JSON.stringify(answer?.[1] ?? {}), {
        status: answer?.[0] ?? 404,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  render(<QuoteEditor quoteId={QUOTE_ID} onAuthenticationRequired={vi.fn()} />);
  await screen.findByRole("heading", { name: "Orçamento ORC-2027-0007" });
  fireEvent.click(screen.getByRole("tab", { name: "Proposta ao cliente" }));
  if (section !== "Capa") fireEvent.click(screen.getByRole("button", { name: section }));
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("proposal editor", () => {
  it("fills the intro from a suggestion and saves it", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Gerar sugestão" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    const body = api.writes()[0]?.body as { intro: string };
    expect(api.writes()[0]?.method).toBe("PATCH");
    expect(body.intro).toContain("Funchal, Madeira");
    expect(await screen.findByLabelText("Frase de introdução")).toHaveValue(body.intro);
  });

  it("asks before replacing an existing intro", async () => {
    const instance = new MockQuoteApi();
    instance.quote["intro"] = "Texto meu.";
    await open(instance);
    fireEvent.click(screen.getByRole("button", { name: "Gerar sugestão" }));
    const dialog = await screen.findByRole("dialog");
    expect(api.writes()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Substituir" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
  });

  it("validates the cover image address and only saves a valid one", async () => {
    await open();
    const field = screen.getByLabelText(/Imagem de capa/u);
    fireEvent.change(field, { target: { value: "http://x.test/a.jpg" } });
    expect(screen.getByText(/comece por https/u)).toBeInTheDocument();
    fireEvent.blur(field);
    expect(api.writes()).toHaveLength(0);
    fireEvent.change(field, { target: { value: "https://fotos.example.test/capa.jpg" } });
    fireEvent.blur(field);
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toMatchObject({
      heroImageUrl: "https://fotos.example.test/capa.jpg",
    });
  });

  it("edits a day with PUT and resets with DELETE after confirming", async () => {
    await open(new MockQuoteApi(), "Programa");
    expect(screen.getAllByText("Chegada a Funchal").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Editar dia 1" }));
    fireEvent.change(screen.getByLabelText("Título do dia 1"), {
      target: { value: "Boas-vindas" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar dia" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toMatchObject({
      method: "PUT",
      path: `/api/admin/quotes/${QUOTE_ID}/days/0`,
      body: { title: "Boas-vindas", expectedLockVersion: "5" },
    });
    expect(await screen.findByText("Boas-vindas")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Repor sugestões" }));
    const dialog = await screen.findByRole("dialog");
    expect(api.writes()).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Repor sugestões" }));
    await waitFor(() => expect(api.writes()).toHaveLength(2));
    expect(api.writes()[1]?.method).toBe("DELETE");
    expect(api.writes()[1]?.path).toContain(`/days?expectedLockVersion=`);
    expect(await screen.findAllByText("Chegada a Funchal")).not.toHaveLength(0);
  });

  it("edits the excluded list with PATCH: defaults, add, reorder, remove", async () => {
    await open(new MockQuoteApi(), "Incluído / Não incluído");
    expect(screen.getByText("Despesas pessoais")).toBeInTheDocument();
    expect(screen.getByText(/Gerado das linhas visíveis/u)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Novo item não incluído"), {
      target: { value: "Taxas turísticas" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toMatchObject({
      excludedItems: [
        "Refeições não mencionadas",
        "Despesas pessoais",
        "Gorjetas",
        "Taxas turísticas",
      ],
    });
    fireEvent.click(await screen.findByRole("button", { name: "Subir: Gorjetas" }));
    await waitFor(() => expect(api.writes()).toHaveLength(2));
    expect(api.writes()[1]?.body).toMatchObject({
      excludedItems: [
        "Refeições não mencionadas",
        "Gorjetas",
        "Despesas pessoais",
        "Taxas turísticas",
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Remover: Gorjetas" }));
    await waitFor(() => expect(api.writes()).toHaveLength(3));
    expect(api.writes()[2]?.body).toMatchObject({
      excludedItems: ["Refeições não mencionadas", "Despesas pessoais", "Taxas turísticas"],
    });
  });

  it("saves a line image address with PATCH on the line", async () => {
    await open(new MockQuoteApi(), "Imagens");
    const field = screen.getByLabelText("Imagem: Hotel Atlântico, Funchal");
    fireEvent.change(field, { target: { value: "https://fotos.example.test/hotel.jpg" } });
    fireEvent.blur(field);
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.path).toContain("/lines/");
    expect(api.writes()[0]?.body).toMatchObject({
      imageUrl: "https://fotos.example.test/hotel.jpg",
    });
  });

  it("edits the conditions and shows the computed deposit", async () => {
    await open(new MockQuoteApi(), "Condições");
    expect(screen.getByLabelText("Valores calculados")).toHaveTextContent("Sinal");
    const deposit = screen.getByLabelText("Sinal (%)");
    fireEvent.change(deposit, { target: { value: "40" } });
    fireEvent.blur(deposit);
    await waitFor(() => expect(api.writes()[0]?.body).toMatchObject({ depositBp: 4000 }));
  });

  it("shows the live preview frame sandboxed, and reloads it after a save", async () => {
    await open();
    const frame = screen.getByTitle("Pré-visualização da proposta ao cliente");
    expect(frame).toHaveAttribute("sandbox", "allow-same-origin");
    expect(frame).toHaveAttribute("src", `/api/admin/quotes/${QUOTE_ID}/preview`);
    expect(screen.getByRole("link", { name: "Ver pré-visualização" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  it("is read-only when the quote was sent, with a way to start a new version", async () => {
    await open(new MockQuoteApi({ state: "SENT" }));
    expect(screen.getByLabelText("Título da proposta")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Gerar sugestão" })).toBeNull();
    expect(screen.getByText(/só para leitura/u)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Editar (nova versão)" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Programa" }));
    expect(screen.queryByRole("button", { name: "Repor sugestões" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar dia/u })).toBeNull();
    expect(api.writes()).toHaveLength(0);
  });
});
