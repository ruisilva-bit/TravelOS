import {
  Button,
  EmptyState,
  PageHeader,
  StateMessage,
  StatusPill,
  Table,
  Tabs,
  ToastProvider,
  useToast,
} from "@travelos/design-system";
import type { StatusTone, TableColumn } from "@travelos/design-system";
import { useCallback, useEffect, useState } from "react";

import { AdminApiError, getAdminCustomer } from "./api.js";
import type { AdminCustomerDetailV1Response } from "@travelos/contracts/admin";
import { crmErrorMessage, isAuthenticationRequired } from "./crm-shared.js";
import { CustomerEditDialog } from "./customer-edit-dialog.js";
import { CustomerPeople } from "./customer-people.js";
import { EntityQuotes } from "./entity-quotes.js";
import { formatDate, formatDateTime } from "./format.js";

type Customer = AdminCustomerDetailV1Response;
type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "not-found" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly customer: Customer };

const leadStateLabel: Record<string, readonly [string, StatusTone]> = {
  OPEN: ["Aberta", "warning"],
  QUALIFIED: ["Qualificada", "success"],
  DISQUALIFIED: ["Desqualificada", "danger"],
};

const tripStateLabel: Record<string, readonly [string, StatusTone]> = {
  DRAFT: ["Em preparação", "warning"],
  CONFIRMED: ["Confirmada", "success"],
  IN_OPERATION: ["Em curso", "success"],
  COMPLETED: ["Concluída", "neutral"],
  CANCELLED: ["Cancelada", "danger"],
};

function StatePill({
  state,
  labels,
}: {
  readonly state: string;
  readonly labels: Record<string, readonly [string, StatusTone]>;
}) {
  const [label, tone] = labels[state] ?? [state, "neutral" as StatusTone];
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

const leadColumns: readonly TableColumn<Customer["leads"][number]>[] = [
  {
    key: "name",
    header: "Lead",
    cell: (lead) => (
      <a className="ds-table__link" href={`#/leads/${encodeURIComponent(lead.id)}`}>
        {lead.name}
      </a>
    ),
  },
  {
    key: "state",
    header: "Estado",
    cell: (lead) => <StatePill state={lead.state} labels={leadStateLabel} />,
  },
];

const tripColumns: readonly TableColumn<Customer["trips"][number]>[] = [
  {
    key: "title",
    header: "Viagem",
    cell: (trip) => (
      <a className="ds-table__link" href={`#/viagens/${encodeURIComponent(trip.id)}`}>
        {trip.title}
      </a>
    ),
  },
  {
    key: "dates",
    header: "Datas",
    cell: (trip) => `${formatDate(trip.startDate)} – ${formatDate(trip.endDate)}`,
  },
  {
    key: "state",
    header: "Estado",
    cell: (trip) => <StatePill state={trip.state} labels={tripStateLabel} />,
  },
];

function CustomerRecordBody({
  customer,
  onChanged,
  onReplace,
  onAuthenticationRequired,
}: {
  readonly customer: Customer;
  readonly onChanged: () => void;
  readonly onReplace: (customer: Customer) => void;
  readonly onAuthenticationRequired: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { notify } = useToast();
  const reach = [customer.email, customer.phone].filter((value): value is string => !!value);

  return (
    <>
      <PageHeader
        back={{ href: "#/clientes", label: "← Voltar aos clientes" }}
        title={customer.displayName}
        description={reach.length > 0 ? reach.join(" · ") : "Sem contactos registados."}
        actions={<Button onClick={() => setEditing(true)}>Editar cliente</Button>}
      />
      <p className="crm-meta">
        Criado em <time dateTime={customer.createdAt}>{formatDate(customer.createdAt)}</time> ·
        Atualizado em{" "}
        <time dateTime={customer.updatedAt}>{formatDateTime(customer.updatedAt)}</time>
      </p>
      <Tabs
        label="Secções do cliente"
        tabs={[
          {
            id: "people",
            label: `Pessoas (${customer.people.length})`,
            panel: (
              <CustomerPeople
                customerId={customer.id}
                people={customer.people}
                canViewSensitive={customer.canViewSensitive}
                onChanged={() => {
                  notify("Guardado.", "success");
                  onChanged();
                }}
                onAuthenticationRequired={onAuthenticationRequired}
              />
            ),
          },
          {
            id: "leads",
            label: `Leads (${customer.leads.length})`,
            panel: (
              <Table
                caption="Leads do cliente"
                columns={leadColumns}
                rows={customer.leads}
                getRowKey={(lead) => lead.id}
                empty={
                  <EmptyState
                    title="Sem leads"
                    description="Este cliente ainda não tem leads associadas."
                  />
                }
              />
            ),
          },
          {
            id: "trips",
            label: `Viagens (${customer.trips.length})`,
            panel: (
              <Table
                caption="Viagens do cliente"
                columns={tripColumns}
                rows={customer.trips}
                getRowKey={(trip) => trip.id}
                empty={
                  <EmptyState
                    title="Sem viagens"
                    description="Este cliente ainda não tem viagens."
                  />
                }
              />
            ),
          },
          {
            id: "quotes",
            label: "Orçamentos",
            panel: (
              <EntityQuotes
                customerId={customer.id}
                leads={customer.leads.map((lead) => ({ id: lead.id, name: lead.name }))}
                canCreate={customer.leads.length > 0}
                blockedReason="Crie primeiro uma lead para este cliente."
                onAuthenticationRequired={onAuthenticationRequired}
              />
            ),
          },
          {
            id: "notes",
            label: "Notas",
            panel: customer.notes ? (
              <p className="crm-notes">{customer.notes}</p>
            ) : (
              <EmptyState
                title="Sem notas"
                description="Registe observações úteis sobre este cliente."
                action={<Button onClick={() => setEditing(true)}>Editar cliente</Button>}
              />
            ),
          },
        ]}
      />
      {editing ? (
        <CustomerEditDialog
          customer={customer}
          onClose={() => setEditing(false)}
          onAuthenticationRequired={onAuthenticationRequired}
          onSaved={(updated) => {
            setEditing(false);
            onReplace(updated);
            notify("Guardado.", "success");
          }}
        />
      ) : null}
    </>
  );
}

export function CustomerRecord({
  customerId,
  onAuthenticationRequired,
}: {
  readonly customerId: string;
  readonly onAuthenticationRequired: () => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let current = true;
    // Keep showing the record while it refreshes after an edit; only the first load blanks.
    if (reloadKey === 0) setState({ kind: "loading" });
    void getAdminCustomer(customerId).then(
      (customer) => {
        if (current) setState({ kind: "ready", customer });
      },
      (error: unknown) => {
        if (!current) return;
        if (isAuthenticationRequired(error)) {
          onAuthenticationRequired();
          return;
        }
        if (error instanceof AdminApiError && error.code === "ACCESS_DENIED") {
          setState({ kind: "denied" });
        } else if (error instanceof AdminApiError && error.code === "NOT_FOUND") {
          setState({ kind: "not-found" });
        } else {
          setState({ kind: "error", message: crmErrorMessage(error) });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [customerId, reloadKey, onAuthenticationRequired]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  if (state.kind === "loading")
    return <StateMessage role="status">A carregar o cliente…</StateMessage>;
  if (state.kind === "denied") {
    return (
      <EmptyState
        tone="error"
        headingLevel={1}
        title="Acesso não autorizado"
        description="Não tem permissão para consultar este cliente."
      />
    );
  }
  if (state.kind === "not-found") {
    return (
      <EmptyState
        headingLevel={1}
        title="Cliente não encontrado"
        description="Este cliente não está disponível nesta agência."
        action={<Button onClick={() => (window.location.hash = "#/clientes")}>Ver clientes</Button>}
      />
    );
  }
  if (state.kind === "error") {
    return (
      <StateMessage
        tone="error"
        role="alert"
        action={<Button onClick={reload}>Tentar novamente</Button>}
      >
        {state.message}
      </StateMessage>
    );
  }
  return (
    <ToastProvider>
      <CustomerRecordBody
        customer={state.customer}
        onChanged={reload}
        onReplace={(customer) => setState({ kind: "ready", customer })}
        onAuthenticationRequired={onAuthenticationRequired}
      />
    </ToastProvider>
  );
}
