// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "./user-shim.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as apiModule from "../src/api.js";
import * as api from "../src/api.js";
import { GlobalSearch } from "../src/global-search.js";

vi.mock("../src/api.js", async () => {
  const original = await vi.importActual<typeof apiModule>("../src/api.js");
  return { ...original, searchAdmin: vi.fn() };
});

const agencyId = "019b0101-0000-7000-8000-000000000001";
const customerId = "019b0101-0000-7000-8000-000000000020";
const leadId = "019b0101-0000-7000-8000-000000000010";
const tripId = "019b0101-0000-7000-8000-000000000040";
const onAuthenticationRequired = vi.fn();

beforeEach(() => {
  window.location.hash = "";
  vi.mocked(api.searchAdmin).mockResolvedValue({
    customers: [
      {
        id: customerId,
        agencyId,
        displayName: "Marta Quintela",
        email: "marta@example.test",
        phone: null,
        primaryContactName: "Marta Quintela",
        lockVersion: "1",
        updatedAt: "2026-11-27T10:30:00.000Z",
      },
    ],
    leads: [{ id: leadId, name: "Açores em junho", state: "OPEN" }],
    trips: [
      {
        id: tripId,
        title: "Pico e Faial",
        startDate: "2027-06-10",
        endDate: "2027-06-17",
        state: "CONFIRMED",
      },
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderSearch = () =>
  render(<GlobalSearch onAuthenticationRequired={onAuthenticationRequired} />);

describe("global search", () => {
  it("focuses with Ctrl+K and shows grouped results as a combobox", async () => {
    renderSearch();
    const box = screen.getByRole("combobox", { name: /Pesquisar/u });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(box).toHaveFocus();

    await userEvent.type(box, "ma");
    await screen.findAllByRole("option");
    const listbox = screen.getByRole("listbox", { name: "Resultados da pesquisa" });
    expect(api.searchAdmin).toHaveBeenCalledWith("ma");
    expect(screen.getByRole("group", { name: "Clientes" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Leads" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Viagens" })).toBeInTheDocument();
    expect(listbox).toBeVisible();
    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("navigates with arrows and Enter, and closes with Escape", async () => {
    renderSearch();
    const box = screen.getByRole("combobox");
    await userEvent.type(box, "ma");
    await screen.findAllByRole("option");
    const options = screen.getAllByRole("option");
    expect(box).toHaveAttribute("aria-activedescendant", options[0]?.id);

    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(options[2]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowUp}");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    expect(window.location.hash).toBe(`#/leads/${leadId}`);

    await userEvent.type(box, "ma");
    await screen.findAllByRole("option");
    await userEvent.keyboard("{Escape}");
    expect(box).toHaveAttribute("aria-expanded", "false");
  });

  it("navigates to customers and trips and ignores one-character input", async () => {
    renderSearch();
    const box = screen.getByRole("combobox");
    await userEvent.type(box, "m");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(api.searchAdmin).not.toHaveBeenCalled();

    await userEvent.type(box, "a");
    await userEvent.click((await screen.findAllByRole("option"))[0]!);
    expect(window.location.hash).toBe(`#/clientes/${customerId}`);

    await userEvent.type(box, "pi");
    await userEvent.click((await screen.findAllByRole("option"))[2]!);
    expect(window.location.hash).toBe(`#/viagens/${tripId}`);
  });

  it("says when nothing matches", async () => {
    vi.mocked(api.searchAdmin).mockResolvedValue({ customers: [], leads: [], trips: [] });
    renderSearch();
    await userEvent.type(screen.getByRole("combobox"), "zz");
    await waitFor(() => expect(screen.getByText("Sem resultados.")).toBeInTheDocument());
  });
});
