import {
  Button,
  EmptyState,
  PageHeader,
  StateMessage,
  StatusPill,
  Table,
  TextField,
} from "@travelos/design-system";
import type { AdminQuoteV1Response } from "@travelos/contracts/admin";
import type { TableColumn } from "@travelos/design-system";
import { useEffect, useState } from "react";

import { AdminApiError, listAdminQuotes } from "./api.js";
import { crmErrorMessage, isAuthenticationRequired } from "./crm-shared.js";
import { formatDate, formatDateTime } from "./format.js";
import { QuoteCreateDialog } from "./quote-create-dialog.js";
import { STATE_LABELS } from "./quote-format.js";
import type { QuoteState } from "./quote-format.js";

type Quote = AdminQuoteV1Response;

const FILTERS: readonly (readonly [QuoteState | "", string])[] = [
  ["", "Todos"],
  ["DRAFT", "Rascunho"],
  ["SENT", "Enviado"],
  ["ACCEPTED", "Aceite"],
  ["DECLINED", "Recusado"],
  ["EXPIRED", "Expirado"],
];

export const quoteColumns: readonly TableColumn<Quote>[] = [
  {
    key: "number",
    header: "Nº",
    cell: (quote) => (
      <a className="ds-table__link" href={`#/orcamentos/${encodeURIComponent(quote.id)}`}>
        {quote.number}
      </a>
    ),
  },
  { key: "title", header: "Título", cell: (quote) => quote.title },
  {
    key: "customer",
    header: "Cliente",
    cell: (quote) => (
      <a href={`#/clientes/${encodeURIComponent(quote.customerId)}`}>{quote.customerDisplayName}</a>
    ),
  },
  {
    key: "dates",
    header: "Datas",
    cell: (quote) =>
      quote.startDate === null
        ? "—"
        : `${formatDate(quote.startDate)} – ${formatDate(quote.endDate)}`,
  },
  {
    key: "state",
    header: "Estado",
    cell: (quote) => {
      const [label, tone] = STATE_LABELS[quote.state];
      return <StatusPill tone={tone}>{label}</StatusPill>;
    },
  },
  { key: "valid", header: "Validade", cell: (quote) => formatDate(quote.validUntil) },
  { key: "updated", header: "Atualizado", cell: (quote) => formatDateTime(quote.updatedAt) },
];

type ListState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly items: readonly Quote[];
      readonly next: string | null;
      readonly more: boolean;
    };

/** `#/orcamentos` */
export function QuotesList({
  onAuthenticationRequired,
}: {
  readonly onAuthenticationRequired: () => void;
}) {
  const [state, setState] = useState<QuoteState | "">("");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(typed.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [typed]);

  useEffect(() => {
    let current = true;
    setList({ kind: "loading" });
    void listAdminQuotes({ ...(state === "" ? {} : { state }), q: search, limit: 25 }).then(
      (page) =>
        current &&
        setList({ kind: "ready", items: page.items, next: page.nextCursor, more: false }),
      (failure: unknown) => {
        if (!current) return;
        if (isAuthenticationRequired(failure)) onAuthenticationRequired();
        setList(
          failure instanceof AdminApiError && failure.code === "ACCESS_DENIED"
            ? { kind: "denied" }
            : { kind: "error", message: crmErrorMessage(failure) },
        );
      },
    );
    return () => {
      current = false;
    };
  }, [state, search, reloadKey, onAuthenticationRequired]);

  const loadMore = async (): Promise<void> => {
    if (list.kind !== "ready" || list.next === null) return;
    const cursor = list.next;
    setList({ ...list, more: true });
    try {
      const page = await listAdminQuotes({
        ...(state === "" ? {} : { state }),
        q: search,
        cursor,
        limit: 25,
      });
      setList((now) =>
        now.kind === "ready"
          ? {
              kind: "ready",
              items: [...now.items, ...page.items],
              next: page.nextCursor,
              more: false,
            }
          : now,
      );
    } catch (failure) {
      if (isAuthenticationRequired(failure)) onAuthenticationRequired();
      setList((now) => (now.kind === "ready" ? { ...now, more: false } : now));
    }
  };

  return (
    <>
      <PageHeader
        title="Orçamentos"
        description="Propostas em preparação e enviadas. Cada orçamento pertence a uma lead e ao respetivo cliente."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Novo orçamento
          </Button>
        }
      />
      <div className="q-filters">
        <div className="lead-filter" role="group" aria-label="Filtrar por estado">
          {FILTERS.map(([value, label]) => (
            <Button
              key={label}
              variant={state === value ? "primary" : "secondary"}
              aria-pressed={state === value}
              onClick={() => setState(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <TextField
          className="q-filters__search"
          label="Pesquisar"
          placeholder="Número, título ou cliente"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </div>
      {list.kind === "denied" ? (
        <EmptyState
          tone="error"
          title="Acesso não autorizado"
          description="Não tem permissão para consultar orçamentos."
        />
      ) : list.kind === "error" ? (
        <StateMessage
          tone="error"
          role="alert"
          action={<Button onClick={() => setReloadKey((key) => key + 1)}>Tentar novamente</Button>}
        >
          {list.message}
        </StateMessage>
      ) : (
        <Table
          caption="Orçamentos"
          columns={quoteColumns}
          rows={list.kind === "ready" ? list.items : []}
          getRowKey={(quote) => quote.id}
          loading={list.kind === "loading"}
          empty={
            <EmptyState
              title="Ainda não existem orçamentos"
              description="Crie o primeiro a partir de uma lead qualificada."
              action={<Button onClick={() => setCreating(true)}>Novo orçamento</Button>}
            />
          }
          pagination={
            list.kind === "ready"
              ? {
                  summary: `${list.items.length} nesta página`,
                  hasMore: list.next !== null,
                  loadingMore: list.more,
                  onLoadMore: () => void loadMore(),
                }
              : undefined
          }
        />
      )}
      {creating ? (
        <QuoteCreateDialog
          onClose={() => setCreating(false)}
          onAuthenticationRequired={onAuthenticationRequired}
        />
      ) : null}
    </>
  );
}
