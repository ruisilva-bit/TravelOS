// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "./user-shim.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdminCustomerDetailV1Response,
  AdminCustomerPersonV1Response,
} from "@travelos/contracts/admin";
import type * as apiModule from "../src/api.js";
import * as api from "../src/api.js";
import { CUSTOMER_CONFLICT_MESSAGE } from "../src/crm-shared.js";
import { CustomersView } from "../src/customers-view.js";

vi.mock("../src/api.js", async () => {
  const original = await vi.importActual<typeof apiModule>("../src/api.js");
  return {
    ...original,
    listAdminCustomers: vi.fn(),
    getAdminCustomer: vi.fn(),
    createAdminCustomer: vi.fn(),
    updateAdminCustomer: vi.fn(),
    addAdminPerson: vi.fn(),
    updateAdminPerson: vi.fn(),
    setAdminPersonRoles: vi.fn(),
  };
});

const agencyId = "019b0101-0000-7000-8000-000000000001";
const customerId = "019b0101-0000-7000-8000-000000000020";
const personId = "019b0101-0000-7000-8000-000000000030";
const leadId = "019b0101-0000-7000-8000-000000000010";
const tripId = "019b0101-0000-7000-8000-000000000040";

const summary = (id: string, displayName: string, overrides: Record<string, unknown> = {}) => ({
  id,
  agencyId,
  displayName,
  email: "marta@example.test",
  phone: "+351 910 000 000",
  primaryContactName: "Marta Quintela",
  lockVersion: "1",
  updatedAt: "2026-11-27T10:30:00.000Z",
  ...overrides,
});

const person = (
  overrides: Partial<AdminCustomerPersonV1Response> = {},
): AdminCustomerPersonV1Response => ({
  id: personId,
  agencyId,
  givenName: "Marta",
  familyName: "Quintela",
  email: "marta@example.test",
  phone: "+351 910 000 000",
  nationality: "PT",
  notes: null,
  birthDate: "1985-03-09",
  passportNumber: "P1234567",
  passportExpiry: "2031-06-30",
  lockVersion: "2",
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  roles: ["PRIMARY_CONTACT", "PAYER"],
  isPrimary: true,
  ...overrides,
});

const detail = (people = [person()]): AdminCustomerDetailV1Response => ({
  id: customerId,
  agencyId,
  displayName: "Marta Quintela",
  email: "marta@example.test",
  phone: "+351 910 000 000",
  notes: "Prefere voos de manhã",
  lockVersion: "3",
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-27T23:30:00.000Z",
  people,
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

const onAuthenticationRequired = vi.fn();
const renderList = () =>
  render(<CustomersView customerId={null} onAuthenticationRequired={onAuthenticationRequired} />);
const renderRecord = () =>
  render(
    <CustomersView customerId={customerId} onAuthenticationRequired={onAuthenticationRequired} />,
  );

beforeEach(() => {
  window.location.hash = "";
  vi.mocked(api.listAdminCustomers).mockResolvedValue({
    items: [summary(customerId, "Marta Quintela")],
    nextCursor: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("customers list", () => {
  it("renders customers with Lisbon dates and searches with q", async () => {
    renderList();
    const link = await screen.findByRole("link", { name: "Abrir cliente: Marta Quintela" });
    expect(link).toHaveAttribute("href", `#/clientes/${customerId}`);
    expect(screen.getByText("27/11/2026")).toBeInTheDocument();
    expect(api.listAdminCustomers).toHaveBeenLastCalledWith({ limit: 25, cursor: null, q: null });

    vi.mocked(api.listAdminCustomers).mockResolvedValueOnce({
      items: [summary("019b0101-0000-7000-8000-000000000021", "Rui Tavares")],
      nextCursor: null,
    });
    await userEvent.type(screen.getByLabelText("Pesquisar clientes"), "Ta");
    await waitFor(() =>
      expect(api.listAdminCustomers).toHaveBeenLastCalledWith({ limit: 25, cursor: null, q: "Ta" }),
    );
    expect(await screen.findByText("Rui Tavares")).toBeInTheDocument();
  });

  it("does not search below two characters", async () => {
    renderList();
    await screen.findByRole("link", { name: "Abrir cliente: Marta Quintela" });
    await userEvent.type(screen.getByLabelText("Pesquisar clientes"), "T");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(api.listAdminCustomers).toHaveBeenCalledTimes(1);
  });

  it("loads more with the cursor and shows the empty state with a call to action", async () => {
    vi.mocked(api.listAdminCustomers).mockResolvedValueOnce({
      items: [summary(customerId, "Marta Quintela")],
      nextCursor: "cursor-1",
    });
    renderList();
    await userEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    await waitFor(() =>
      expect(api.listAdminCustomers).toHaveBeenLastCalledWith({
        limit: 25,
        cursor: "cursor-1",
        q: null,
      }),
    );
    cleanup();

    vi.mocked(api.listAdminCustomers).mockResolvedValue({ items: [], nextCursor: null });
    renderList();
    expect(await screen.findByText("Ainda não existem clientes")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Novo cliente" }).length).toBeGreaterThan(1);
  });
});

describe("new customer", () => {
  it("auto-fills the display name until edited, then navigates to the record", async () => {
    vi.mocked(api.createAdminCustomer).mockResolvedValue(detail());
    renderList();
    await userEvent.click(await screen.findByRole("button", { name: "Novo cliente" }));
    const dialog = await screen.findByRole("dialog", { name: "Novo cliente" });
    const display = within(dialog).getByLabelText("Nome do cliente");

    await userEvent.type(within(dialog).getByLabelText("Nome"), "Marta");
    await userEvent.type(within(dialog).getByLabelText("Apelido"), "Quintela");
    expect(display).toHaveValue("Marta Quintela");

    await userEvent.clear(display);
    await userEvent.type(display, "Família Quintela");
    await userEvent.type(within(dialog).getByLabelText("Apelido"), "s");
    expect(display).toHaveValue("Família Quintela");

    await userEvent.type(within(dialog).getByLabelText("Email"), "marta@example.test");
    await userEvent.click(within(dialog).getByRole("button", { name: "Criar cliente" }));

    await waitFor(() => expect(window.location.hash).toBe(`#/clientes/${customerId}`));
    expect(api.createAdminCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "Família Quintela",
        primaryPerson: expect.objectContaining({ givenName: "Marta", familyName: "Quintelas" }),
      }),
      expect.any(String),
    );
  });

  it("validates required names before calling the API", async () => {
    renderList();
    await userEvent.click(await screen.findByRole("button", { name: "Novo cliente" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Criar cliente" }));
    expect(within(dialog).getByText("Indique o nome.")).toBeInTheDocument();
    expect(api.createAdminCustomer).not.toHaveBeenCalled();
  });
});

describe("customer record", () => {
  it("shows header, tabs, people with roles and links to leads and trips", async () => {
    vi.mocked(api.getAdminCustomer).mockResolvedValue(detail());
    renderRecord();
    expect(await screen.findByRole("heading", { level: 1, name: "Marta Quintela" })).toBeVisible();
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Pessoas (1)", "Leads (1)", "Viagens (1)", "Orçamentos", "Notas"]);

    const people = screen.getByRole("table", { name: "Pessoas do cliente" });
    expect(within(people).getByText("Contacto principal")).toBeInTheDocument();
    expect(within(people).getByText("Pagador")).toBeInTheDocument();
    expect(within(people).getByText("Nasc. 09/03/1985")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Leads (1)" }));
    expect(screen.getByRole("link", { name: "Açores em junho" })).toHaveAttribute(
      "href",
      `#/leads/${leadId}`,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Viagens (1)" }));
    expect(screen.getByRole("link", { name: "Pico e Faial" })).toHaveAttribute(
      "href",
      `#/viagens/${tripId}`,
    );
    expect(screen.getByText("10/06/2027 – 17/06/2027")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Notas" }));
    expect(screen.getByText("Prefere voos de manhã")).toBeInTheDocument();
  });

  it("hides sensitive fields when the response does not carry them", async () => {
    vi.mocked(api.getAdminCustomer).mockResolvedValue(
      detail([person({ birthDate: null, passportNumber: null, passportExpiry: null })]),
    );
    renderRecord();
    await screen.findByRole("table", { name: "Pessoas do cliente" });
    expect(screen.getByText("Sem permissão para ver dados sensíveis")).toBeInTheDocument();
    expect(screen.queryByText(/Passaporte/u)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Editar Marta Quintela" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar pessoa" });
    expect(within(dialog).queryByLabelText("Data de nascimento")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Passaporte (n.º)")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Nacionalidade")).toHaveValue("PT");
  });

  it("edits a person with sensitive fields when present and sends the lock version", async () => {
    vi.mocked(api.getAdminCustomer).mockResolvedValue(detail());
    vi.mocked(api.updateAdminPerson).mockResolvedValue(person());
    renderRecord();
    await userEvent.click(await screen.findByRole("button", { name: "Editar Marta Quintela" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar pessoa" });
    expect(within(dialog).getByLabelText("Passaporte (n.º)")).toHaveValue("P1234567");
    await userEvent.selectOptions(within(dialog).getByLabelText("Nacionalidade"), "ES");
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar pessoa" }));
    await waitFor(() =>
      expect(api.updateAdminPerson).toHaveBeenCalledWith(
        personId,
        expect.objectContaining({
          expectedLockVersion: "2",
          nationality: "ES",
          passportNumber: "P1234567",
        }),
      ),
    );
    await waitFor(() => expect(api.getAdminCustomer).toHaveBeenCalledTimes(2));
  });

  it("sets roles with the primary contact checkbox", async () => {
    vi.mocked(api.getAdminCustomer).mockResolvedValue(detail());
    vi.mocked(api.setAdminPersonRoles).mockResolvedValue(detail());
    renderRecord();
    await userEvent.click(await screen.findByRole("button", { name: "Papéis de Marta Quintela" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByLabelText("Viajante"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar papéis" }));
    await waitFor(() =>
      expect(api.setAdminPersonRoles).toHaveBeenCalledWith(customerId, personId, {
        roles: ["PRIMARY_CONTACT", "TRAVELLER", "PAYER"],
        isPrimary: true,
      }),
    );
  });

  it("shows the conflict message on 409 and keeps what was typed", async () => {
    vi.mocked(api.getAdminCustomer).mockResolvedValue(detail());
    vi.mocked(api.updateAdminCustomer).mockRejectedValue(new api.AdminApiError("CONFLICT", 409));
    renderRecord();
    await userEvent.click(await screen.findByRole("button", { name: "Editar cliente" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar cliente" });
    const name = within(dialog).getByLabelText("Nome do cliente");
    await userEvent.clear(name);
    await userEvent.type(name, "Marta Q.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar cliente" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(CUSTOMER_CONFLICT_MESSAGE);
    expect(api.updateAdminCustomer).toHaveBeenCalledWith(
      customerId,
      expect.objectContaining({ expectedLockVersion: "3", displayName: "Marta Q." }),
    );
    expect(name).toHaveValue("Marta Q.");
  });

  it("shows not found", async () => {
    vi.mocked(api.getAdminCustomer).mockRejectedValue(new api.AdminApiError("NOT_FOUND", 404));
    renderRecord();
    expect(await screen.findByText("Cliente não encontrado")).toBeInTheDocument();
  });
});

describe("keyboard", () => {
  it("closes dialogs with Escape", async () => {
    renderList();
    await userEvent.click(await screen.findByRole("button", { name: "Novo cliente" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
