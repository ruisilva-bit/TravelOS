import {
  Button,
  EmptyState,
  PageHeader,
  StateMessage,
  Table,
  TextField,
} from "@travelos/design-system";
import type { TableColumn } from "@travelos/design-system";
import { useCallback, useEffect, useRef, useState } from "react";

import { AdminApiError, listAdminCustomers } from "./api.js";
import type { AdminCustomerListV1Response } from "@travelos/contracts/admin";
import { crmErrorMessage, isAuthenticationRequired } from "./crm-shared.js";
import { CustomerCreateDialog } from "./customer-create-dialog.js";
import { formatDate } from "./format.js";

type CustomerSummary = AdminCustomerListV1Response["items"][number];

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

const customerHref = (id: string): string => `#/clientes/${encodeURIComponent(id)}`;

const columns: readonly TableColumn<CustomerSummary>[] = [
  {
    key: "name",
    header: "Cliente",
    cell: (customer) => (
      <a
        className="ds-table__link"
        href={customerHref(customer.id)}
        aria-label={`Abrir cliente: ${customer.displayName}`}
      >
        {customer.displayName}
      </a>
    ),
  },
  { key: "contact", header: "Contacto principal", cell: (c) => c.primaryContactName ?? "—" },
  {
    key: "reach",
    header: "Email / telefone",
    cell: (c) =>
      c.email || c.phone ? (
        <span className="crm-stack">
          {c.email ? <span>{c.email}</span> : null}
          {c.phone ? <span className="crm-muted">{c.phone}</span> : null}
        </span>
      ) : (
        "—"
      ),
  },
  {
    key: "updated",
    header: "Atualizado em",
    cell: (c) => <time dateTime={c.updatedAt}>{formatDate(c.updatedAt)}</time>,
  },
];

type ListState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly items: readonly CustomerSummary[];
      readonly nextCursor: string | null;
      readonly loadingMore: boolean;
      readonly loadMoreError: string | null;
    };

export function CustomersList({
  onAuthenticationRequired,
}: {
  readonly onAuthenticationRequired: () => void;
}) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = input.trim();
    const next = trimmed.length >= MIN_QUERY_LENGTH ? trimmed : null;
    const timer = setTimeout(() => setQuery(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const handleFailure = useCallback(
    (error: unknown): ListState | null => {
      if (isAuthenticationRequired(error)) {
        onAuthenticationRequired();
        return null;
      }
      return error instanceof AdminApiError && error.code === "ACCESS_DENIED"
        ? { kind: "denied" }
        : { kind: "error", message: crmErrorMessage(error) };
    },
    [onAuthenticationRequired],
  );

  useEffect(() => {
    const id = ++requestId.current;
    setState({ kind: "loading" });
    void listAdminCustomers({ limit: PAGE_SIZE, cursor: null, q: query }).then(
      (page) => {
        if (id !== requestId.current) return;
        setState({
          kind: "ready",
          items: page.items,
          nextCursor: page.nextCursor,
          loadingMore: false,
          loadMoreError: null,
        });
      },
      (error: unknown) => {
        if (id !== requestId.current) return;
        const failure = handleFailure(error);
        if (failure) setState(failure);
      },
    );
  }, [query, reloadKey, handleFailure]);

  const loadMore = async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null || state.loadingMore) return;
    const id = requestId.current;
    const cursor = state.nextCursor;
    setState({ ...state, loadingMore: true, loadMoreError: null });
    try {
      const page = await listAdminCustomers({ limit: PAGE_SIZE, cursor, q: query });
      if (id !== requestId.current) return;
      setState((current) =>
        current.kind === "ready"
          ? {
              ...current,
              items: [...current.items, ...page.items],
              nextCursor: page.nextCursor,
              loadingMore: false,
            }
          : current,
      );
    } catch (error) {
      if (id !== requestId.current) return;
      if (isAuthenticationRequired(error)) {
        onAuthenticationRequired();
        return;
      }
      setState((current) =>
        current.kind === "ready"
          ? { ...current, loadingMore: false, loadMoreError: crmErrorMessage(error) }
          : current,
      );
    }
  };

  const newCustomerButton = (
    <Button variant="primary" onClick={() => setCreating(true)}>
      Novo cliente
    </Button>
  );

  if (state.kind === "denied") {
    return (
      <>
        <PageHeader title="Clientes" />
        <EmptyState
          tone="error"
          title="Acesso não autorizado"
          description="Não tem permissão para consultar os clientes desta agência."
        />
      </>
    );
  }

  const ready = state.kind === "ready";
  const searching = query !== null;
  return (
    <>
      <PageHeader
        title="Clientes"
        description="Pessoas e famílias que viajam com a agência."
        actions={newCustomerButton}
      />
      <div className="crm-toolbar">
        <TextField
          type="search"
          label="Pesquisar clientes"
          hint="Nome, email ou telefone. Mínimo de 2 letras."
          placeholder="Ex.: Quintela"
          value={input}
          autoComplete="off"
          onChange={(event) => setInput(event.target.value)}
        />
      </div>
      {state.kind === "error" ? (
        <StateMessage
          tone="error"
          role="alert"
          action={<Button onClick={() => setReloadKey((key) => key + 1)}>Tentar novamente</Button>}
        >
          {state.message}
        </StateMessage>
      ) : (
        <>
          <Table
            caption="Clientes"
            columns={columns}
            rows={ready ? state.items : []}
            getRowKey={(customer) => customer.id}
            loading={state.kind === "loading"}
            loadingLabel="A carregar clientes…"
            empty={
              searching ? (
                <EmptyState
                  title="Nenhum cliente encontrado"
                  description="Experimente outro nome, email ou telefone, ou crie um novo cliente."
                  action={newCustomerButton}
                />
              ) : (
                <EmptyState
                  title="Ainda não existem clientes"
                  description="Crie o primeiro cliente para começar a registar pessoas, leads e viagens."
                  action={newCustomerButton}
                />
              )
            }
            pagination={
              ready
                ? {
                    summary: `${state.items.length} ${state.items.length === 1 ? "cliente" : "clientes"}`,
                    hasMore: state.nextCursor !== null,
                    onLoadMore: () => void loadMore(),
                    loadingMore: state.loadingMore,
                    loadMoreLabel: "Carregar mais",
                  }
                : undefined
            }
          />
          {ready && state.loadMoreError ? (
            <StateMessage
              tone="error"
              role="alert"
              action={<Button onClick={() => void loadMore()}>Tentar novamente</Button>}
            >
              {state.loadMoreError}
            </StateMessage>
          ) : null}
        </>
      )}
      {creating ? (
        <CustomerCreateDialog
          open
          onClose={() => setCreating(false)}
          onAuthenticationRequired={onAuthenticationRequired}
          onCreated={(customer) => {
            setCreating(false);
            window.location.hash = customerHref(customer.id);
          }}
        />
      ) : null}
    </>
  );
}
