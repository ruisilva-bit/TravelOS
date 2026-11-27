// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Button,
  Card,
  Dialog,
  EmptyState,
  PageHeader,
  Table,
  Tabs,
  ToastProvider,
  useToast,
  WorkspaceFrame,
} from "../src/index.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

interface Row {
  readonly id: string;
  readonly name: string;
}

const columns = [
  { key: "name", header: "Nome", cell: (row: Row) => <a href={`#/${row.id}`}>{row.name}</a> },
  { key: "id", header: "Id", cell: (row: Row) => row.id, align: "right" as const },
];

describe("Table", () => {
  it("renders headers and rows with a caption", () => {
    render(
      <Table
        caption="Clientes"
        columns={columns}
        rows={[{ id: "1", name: "Marta" }]}
        getRowKey={(row) => row.id}
      />,
    );
    const table = screen.getByRole("table", { name: "Clientes" });
    expect(table).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Nome" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Marta" })).toBeInTheDocument();
  });

  it("shows the empty state instead of a table", () => {
    render(
      <Table
        caption="Clientes"
        columns={columns}
        rows={[]}
        getRowKey={(row: Row) => row.id}
        empty={<EmptyState title="Sem clientes" />}
      />,
    );
    expect(screen.getByText("Sem clientes")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a loading state with one polite status", () => {
    render(
      <Table
        caption="Clientes"
        columns={columns}
        rows={[]}
        getRowKey={(row: Row) => row.id}
        loading
        loadingLabel="A carregar clientes…"
        empty={<EmptyState title="Sem clientes" />}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("A carregar clientes…");
    expect(screen.queryByText("Sem clientes")).not.toBeInTheDocument();
    expect(screen.getByRole("table").parentElement?.parentElement).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("offers load more when more pages exist and hides it otherwise", () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <Table
        caption="Clientes"
        columns={columns}
        rows={[{ id: "1", name: "Marta" }]}
        getRowKey={(row) => row.id}
        pagination={{ summary: "1 nesta página", hasMore: true, onLoadMore }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(screen.getByText("1 nesta página")).toBeInTheDocument();
    rerender(
      <Table
        caption="Clientes"
        columns={columns}
        rows={[{ id: "1", name: "Marta" }]}
        getRowKey={(row) => row.id}
        pagination={{ hasMore: false, onLoadMore }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
  });
});

describe("page chrome", () => {
  it("PageHeader renders title, description, status, actions and back link", () => {
    render(
      <PageHeader
        title="Rota do Pico"
        description="Viagem confirmada"
        status={<span>Confirmada</span>}
        actions={<Button>Editar</Button>}
        back={{ href: "#/viagens", label: "← Voltar às viagens" }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Rota do Pico");
    expect(screen.getByText("Viagem confirmada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Voltar às viagens" })).toHaveAttribute(
      "href",
      "#/viagens",
    );
  });

  it("Card names its section from the title", () => {
    render(
      <Card title="Resumo">
        <p>Conteúdo</p>
      </Card>,
    );
    expect(screen.getByRole("region", { name: "Resumo" })).toBeInTheDocument();
  });

  it("EmptyState shows title, description and action", () => {
    render(
      <EmptyState
        title="Em breve"
        description="Ainda não está disponível."
        action={<Button>Ok</Button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Em breve" })).toBeInTheDocument();
    expect(screen.getByText("Ainda não está disponível.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ok" })).toBeInTheDocument();
  });
});

describe("Dialog", () => {
  function Harness({ onConfirm = vi.fn() }: { readonly onConfirm?: () => void }) {
    return <DialogHarness onConfirm={onConfirm} />;
  }
  function DialogHarness({ onConfirm }: { readonly onConfirm: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Abrir
        </button>
        <Dialog
          open={open}
          title="Revogar convite?"
          description="Esta ação não pode ser desfeita."
          confirmLabel="Revogar"
          tone="danger"
          onConfirm={onConfirm}
          onClose={() => setOpen(false)}
        />
      </>
    );
  }

  it("opens as a labelled modal and focuses the safe action", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    const dialog = screen.getByRole("dialog", { name: "Revogar convite?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Esta ação não pode ser desfeita.");
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the opener", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Abrir" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("traps Tab inside the dialog", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    const cancel = screen.getByRole("button", { name: "Cancelar" });
    const confirm = screen.getByRole("button", { name: "Revogar" });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
  });

  it("confirms through the confirm button", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    fireEvent.click(screen.getByRole("button", { name: "Revogar" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("does not close while busy", () => {
    const onClose = vi.fn();
    render(
      <Dialog
        open
        title="A guardar"
        confirmLabel="Confirmar"
        busy
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Toast", () => {
  beforeEach(() => vi.useFakeTimers());

  function Trigger({ tone }: { readonly tone?: "success" | "danger" }) {
    const { notify } = useToast();
    return (
      <button type="button" onClick={() => notify("Guardado", tone)}>
        Guardar
      </button>
    );
  }

  it("announces in a polite live region and auto-dismisses", () => {
    render(
      <ToastProvider>
        <Trigger tone="success" />
      </ToastProvider>,
    );
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(region).toHaveTextContent("Guardado");
    act(() => {
      vi.advanceTimersByTime(6100);
    });
    expect(region).not.toHaveTextContent("Guardado");
  });

  it("keeps errors until dismissed", () => {
    render(
      <ToastProvider>
        <Trigger tone="danger" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Guardado");
    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    expect(screen.getByRole("status")).not.toHaveTextContent("Guardado");
  });
});

describe("Tabs", () => {
  const tabs = [
    { id: "a", label: "Resumo", panel: <p>Painel A</p> },
    { id: "b", label: "Serviços", panel: <p>Painel B</p> },
    { id: "c", label: "Notas", panel: <p>Painel C</p> },
  ];

  it("uses roving tabindex and shows the selected panel", () => {
    render(<Tabs label="Viagem" tabs={tabs} />);
    expect(screen.getByRole("tablist", { name: "Viagem" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Resumo" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Serviços" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Painel A");
  });

  it("moves with arrows, Home and End, wrapping around", () => {
    const onValueChange = vi.fn();
    render(<Tabs label="Viagem" tabs={tabs} onValueChange={onValueChange} />);
    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Serviços" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Serviços" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Painel B");
    fireEvent.keyDown(list, { key: "End" });
    expect(screen.getByRole("tab", { name: "Notas" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Resumo" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Notas" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "Home" });
    expect(screen.getByRole("tab", { name: "Resumo" })).toHaveAttribute("aria-selected", "true");
    expect(onValueChange).toHaveBeenLastCalledWith("a");
  });

  it("selects on click", () => {
    render(<Tabs label="Viagem" tabs={tabs} />);
    fireEvent.click(screen.getByRole("tab", { name: "Notas" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Painel C");
  });
});

describe("WorkspaceFrame", () => {
  const navigation = [
    { href: "#/", label: "Hoje" },
    { href: "#/clientes", label: "Clientes" },
  ];

  it("marks the active link and offers a skip link", () => {
    render(
      <WorkspaceFrame
        realm="Staff"
        headerContext="Hoje"
        navigation={navigation}
        activeHref="#/clientes"
        headerActions={null}
      >
        <p>Conteúdo</p>
      </WorkspaceFrame>,
    );
    expect(screen.getByRole("link", { name: "Clientes" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Hoje" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Saltar para o conteúdo" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveTextContent("Conteúdo");
  });
});
