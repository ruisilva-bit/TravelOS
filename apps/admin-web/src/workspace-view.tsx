import {
  Button,
  ButtonLink,
  EmptyState,
  PageHeader,
  SectionHeading,
  StateMessage,
  StatusPill,
  Table,
  WorkspaceFrame,
} from "@travelos/design-system";
import type { StatusTone, TableColumn } from "@travelos/design-system";
import type { getAdminTripWorkspace, listAdminTrips } from "./api.js";
import { CustomersView } from "./customers-view.js";
import { GlobalSearch } from "./global-search.js";
import { LeadsView } from "./leads-view.js";
import { QuotesView } from "./quotes-view.js";
import { StaffInvitationsView } from "./staff-invitations-view.js";
import { TripCreateForm, TripWorkspaceEditor } from "./trip-workflows.js";
import type { AdminWorkflowWorkspace } from "./trip-workflows.js";

export type AdminTrip = Awaited<ReturnType<typeof listAdminTrips>>["items"][number];
export type AdminWorkspace = Awaited<ReturnType<typeof getAdminTripWorkspace>>;

export type AdminTripsState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly items: readonly AdminTrip[];
      readonly nextCursor: string | null;
      readonly loadingMore: boolean;
      readonly loadMoreError: string | null;
    };

export type AdminWorkspaceState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "not-found" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly workspace: AdminWorkspace };

interface AdminWorkspaceViewProps {
  readonly page:
    | "overview"
    | "trips"
    | "leads"
    | "lead-detail"
    | "staff-invitations"
    | "detail"
    | "customers"
    | "customer-detail"
    | "quotes"
    | "quote-detail"
    | "tasks";
  readonly leadId: string | null;
  readonly customerId?: string | null;
  readonly quoteId?: string | null;
  readonly canInviteStaff: boolean;
  readonly trips: AdminTripsState;
  readonly workspace: AdminWorkspaceState;
  readonly onRetryTrips: () => void;
  readonly onLoadMore: () => void;
  readonly onRetryWorkspace: () => void;
  readonly onTripCreated: (workspace: AdminWorkflowWorkspace) => void;
  readonly onWorkspaceUpdated: (workspace: AdminWorkflowWorkspace) => void;
  readonly onAuthenticationRequired: () => void;
  readonly onSignOut: () => void;
  readonly signingOut: boolean;
  readonly signOutError: string | null;
}

const dateFormatter = new Intl.DateTimeFormat("pt-PT", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const formatLocalDate = (localDate: string): string =>
  dateFormatter.format(new Date(`${localDate}T00:00:00Z`));

const formatDateRange = (startDate: string, endDate: string): string =>
  `${formatLocalDate(startDate)} – ${formatLocalDate(endDate)}`;

const tripStateLabel: Record<AdminTrip["state"], string> = {
  DRAFT: "Em preparação",
  CONFIRMED: "Confirmada",
  IN_OPERATION: "Em curso",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
};

const tripStateTone = (state: AdminTrip["state"]): StatusTone => {
  if (state === "CONFIRMED" || state === "IN_OPERATION") return "success";
  if (state === "CANCELLED") return "danger";
  if (state === "DRAFT") return "warning";
  return "neutral";
};

const tripColumns: readonly TableColumn<AdminTrip>[] = [
  {
    key: "title",
    header: "Viagem",
    cell: (trip) => (
      <a
        className="ds-table__link"
        href={`#/viagens/${encodeURIComponent(trip.id)}`}
        aria-label={`Abrir viagem: ${trip.title}`}
      >
        {trip.title}
      </a>
    ),
  },
  {
    key: "dates",
    header: "Datas",
    cell: (trip) => formatDateRange(trip.startDate, trip.endDate),
  },
  {
    key: "state",
    header: "Estado",
    cell: (trip) => <TripStatePill state={trip.state} />,
  },
];

function TripsList({
  state,
  onRetry,
  onLoadMore,
  showAll,
}: {
  readonly state: AdminTripsState;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
  readonly showAll: boolean;
}) {
  if (state.kind === "denied") {
    return (
      <EmptyState
        tone="error"
        headingLevel={1}
        title="Acesso não autorizado"
        description="Não tem permissão para consultar as viagens desta agência."
      />
    );
  }

  if (state.kind === "error") {
    return (
      <StateMessage
        tone="error"
        role="alert"
        action={<Button onClick={onRetry}>Tentar novamente</Button>}
      >
        {state.message}
      </StateMessage>
    );
  }

  const ready = state.kind === "ready";
  const items = ready ? (showAll ? state.items : state.items.slice(0, 5)) : [];
  return (
    <>
      <Table
        caption="Viagens"
        columns={tripColumns}
        rows={items}
        getRowKey={(trip) => trip.id}
        loading={state.kind === "loading"}
        loadingLabel="A carregar viagens…"
        empty={<StateMessage>Ainda não existem viagens para apresentar.</StateMessage>}
        pagination={
          ready && showAll
            ? {
                hasMore: state.nextCursor !== null,
                onLoadMore,
                loadingMore: state.loadingMore,
                loadMoreLabel: "Carregar mais viagens",
              }
            : undefined
        }
      />
      {ready && showAll && state.loadMoreError ? (
        <StateMessage
          tone="error"
          role="alert"
          action={<Button onClick={onLoadMore}>Tentar novamente</Button>}
        >
          {state.loadMoreError}
        </StateMessage>
      ) : null}
    </>
  );
}

function TripStatePill({ state }: { readonly state: AdminTrip["state"] }) {
  return <StatusPill tone={tripStateTone(state)}>{tripStateLabel[state]}</StatusPill>;
}

function DetailError({
  state,
  onRetry,
}: {
  readonly state: Exclude<AdminWorkspaceState, { readonly kind: "ready" }>;
  readonly onRetry: () => void;
}) {
  if (state.kind === "loading") {
    return <StateMessage role="status">A carregar o itinerário…</StateMessage>;
  }
  if (state.kind === "denied") {
    return (
      <EmptyState
        tone="error"
        headingLevel={1}
        title="Acesso não autorizado"
        description="Não tem permissão para consultar esta viagem."
      />
    );
  }
  if (state.kind === "not-found") {
    return (
      <EmptyState
        headingLevel={1}
        title="Viagem não encontrada"
        description="Esta viagem não está disponível neste espaço de operações."
      />
    );
  }
  return (
    <StateMessage
      tone="error"
      role="alert"
      action={<Button onClick={onRetry}>Tentar novamente</Button>}
    >
      {state.message}
    </StateMessage>
  );
}

function scheduleText(schedule: {
  readonly localDate: string;
  readonly localTime: string;
  readonly timezoneName: string;
}): string {
  return `${formatLocalDate(schedule.localDate)} · ${schedule.localTime} · ${schedule.timezoneName}`;
}

function Facts({ facts }: { readonly facts: readonly (readonly [string, string | null])[] }) {
  const visibleFacts = facts.filter(
    (fact): fact is readonly [string, string] => fact[1] !== null && fact[1] !== "",
  );
  if (visibleFacts.length === 0) return null;
  return (
    <dl className="itinerary-event__facts">
      {visibleFacts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FlightEvent({ item }: { readonly item: AdminWorkspace["flights"][number] }) {
  return (
    <article className="itinerary-event__content">
      <span className="itinerary-event__kind">Voo</span>
      <h2 className="itinerary-event__title">{item.title}</h2>
      {item.description ? <p className="itinerary-event__description">{item.description}</p> : null}
      <p className="itinerary-route">
        {item.departureAirport} → {item.arrivalAirport}
      </p>
      <Facts
        facts={[
          ["Transportadora", item.carrier],
          ["Voo", item.flightNumber],
          ["Partida", scheduleText(item.departure)],
          ["Chegada", scheduleText(item.arrival)],
          ["Terminal", item.terminal],
          ["Cabine", item.cabin],
          ["Bagagem", item.baggage],
          ["Lugar", item.seat],
          ["Referência", item.customerBookingReference],
        ]}
      />
    </article>
  );
}

function AccommodationEvent({ item }: { readonly item: AdminWorkspace["accommodations"][number] }) {
  return (
    <article className="itinerary-event__content">
      <span className="itinerary-event__kind">Alojamento</span>
      <h2 className="itinerary-event__title">{item.title}</h2>
      {item.description ? <p className="itinerary-event__description">{item.description}</p> : null}
      <Facts
        facts={[
          ["Estabelecimento", item.propertyName],
          ["Check-in", scheduleText(item.checkIn)],
          ["Check-out", scheduleText(item.checkOut)],
          ["Quarto", item.roomDescription],
          ["Regime", item.boardType],
          ["Referência", item.customerBookingReference],
        ]}
      />
    </article>
  );
}

function TripDetail({
  state,
  onRetry,
  onWorkspaceUpdated,
  onAuthenticationRequired,
}: {
  readonly state: AdminWorkspaceState;
  readonly onRetry: () => void;
  readonly onWorkspaceUpdated: (workspace: AdminWorkflowWorkspace) => void;
  readonly onAuthenticationRequired: () => void;
}) {
  if (state.kind !== "ready") {
    return <DetailError state={state} onRetry={onRetry} />;
  }

  const { trip, flights, accommodations } = state.workspace;
  const events = [
    ...flights.map((item) => ({
      kind: "flight" as const,
      id: item.id,
      instant: item.departure.instant,
      time: item.departure,
      item,
    })),
    ...accommodations.map((item) => ({
      kind: "accommodation" as const,
      id: item.id,
      instant: item.checkIn.instant,
      time: item.checkIn,
      item,
    })),
  ].sort((left, right) => Date.parse(left.instant) - Date.parse(right.instant));

  return (
    <>
      <PageHeader
        back={{ href: "#/viagens", label: "← Voltar às viagens" }}
        title={trip.title}
        description="Itinerário de trabalho · Os dados apresentados pertencem ao espaço de operações."
        status={<TripStatePill state={trip.state} />}
      />
      <div className="trip-detail-summary">
        <span className="trip-detail-summary__date">
          {formatDateRange(trip.startDate, trip.endDate)}
        </span>
        <span>
          {events.length} {events.length === 1 ? "serviço" : "serviços"}
        </span>
      </div>
      <section aria-labelledby="admin-itinerary-heading">
        <SectionHeading id="admin-itinerary-heading" title="Itinerário" />
        {events.length === 0 ? (
          <StateMessage>Ainda não existem serviços neste itinerário.</StateMessage>
        ) : (
          <ol className="itinerary-list">
            {events.map((event) => (
              <li className="itinerary-event" key={event.id}>
                <time className="itinerary-event__time" dateTime={event.instant}>
                  {scheduleText(event.time)}
                </time>
                <span className="itinerary-event__marker" aria-hidden="true" />
                {event.kind === "flight" ? (
                  <FlightEvent item={event.item} />
                ) : (
                  <AccommodationEvent item={event.item} />
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
      <TripWorkspaceEditor
        workspace={state.workspace}
        onWorkspaceUpdated={onWorkspaceUpdated}
        onAuthenticationRequired={onAuthenticationRequired}
      />
    </>
  );
}

export function AdminWorkspaceView({
  page,
  leadId,
  customerId = null,
  quoteId = null,
  canInviteStaff,
  trips,
  workspace,
  onRetryTrips,
  onLoadMore,
  onRetryWorkspace,
  onTripCreated,
  onWorkspaceUpdated,
  onAuthenticationRequired,
  onSignOut,
  signingOut,
  signOutError,
}: AdminWorkspaceViewProps) {
  const activeHref =
    page === "overview"
      ? "#/"
      : page === "staff-invitations"
        ? "#/equipa"
        : page === "leads" || page === "lead-detail"
          ? "#/leads"
          : page === "customers" || page === "customer-detail"
            ? "#/clientes"
            : page === "quotes" || page === "quote-detail"
              ? "#/orcamentos"
              : page === "tasks"
                ? "#/tarefas"
                : "#/viagens";
  const navigation = [
    { href: "#/", label: "Hoje" },
    { href: "#/clientes", label: "Clientes" },
    { href: "#/leads", label: "Leads" },
    { href: "#/orcamentos", label: "Orçamentos" },
    { href: "#/viagens", label: "Viagens" },
    { href: "#/tarefas", label: "Tarefas" },
    ...(canInviteStaff ? [{ href: "#/equipa", label: "Equipa" }] : []),
  ];
  const headerContext = navigation.find((item) => item.href === activeHref)?.label ?? "";

  return (
    <WorkspaceFrame
      realm="Staff"
      headerContext={page === "detail" ? "Detalhe da viagem" : headerContext}
      navigation={navigation}
      activeHref={activeHref}
      headerActions={
        <>
          <GlobalSearch onAuthenticationRequired={onAuthenticationRequired} />
          <Button variant="ghost" onClick={onSignOut} loading={signingOut}>
            {signingOut ? "A terminar…" : "Terminar sessão"}
          </Button>
        </>
      }
    >
      {signOutError ? (
        <StateMessage tone="error" role="alert">
          {signOutError}
        </StateMessage>
      ) : null}
      {page === "leads" || page === "lead-detail" ? (
        <LeadsView
          leadId={page === "lead-detail" ? leadId : null}
          onAuthenticationRequired={onAuthenticationRequired}
        />
      ) : page === "detail" ? (
        <TripDetail
          state={workspace}
          onRetry={onRetryWorkspace}
          onWorkspaceUpdated={onWorkspaceUpdated}
          onAuthenticationRequired={onAuthenticationRequired}
        />
      ) : page === "staff-invitations" ? (
        <StaffInvitationsView onAuthenticationRequired={onAuthenticationRequired} />
      ) : page === "customers" || page === "customer-detail" ? (
        <CustomersView
          customerId={page === "customer-detail" ? customerId : null}
          onAuthenticationRequired={onAuthenticationRequired}
        />
      ) : page === "quotes" || page === "quote-detail" ? (
        <QuotesView
          quoteId={page === "quote-detail" ? quoteId : null}
          onAuthenticationRequired={onAuthenticationRequired}
        />
      ) : page === "tasks" ? (
        <>
          <PageHeader title={headerContext} />
          <EmptyState
            title="Em breve"
            description="Esta secção ainda está em preparação. Por agora, trabalhe a partir de Leads e Viagens."
            action={
              <ButtonLink variant="secondary" href="#/viagens">
                Ver viagens
              </ButtonLink>
            }
          />
        </>
      ) : (
        <>
          <PageHeader
            title={page === "overview" ? "Hoje" : "Viagens"}
            description={
              page === "overview"
                ? "Viagens recentes e o que a equipa tem em mãos."
                : "Consulte as viagens disponíveis para a equipa."
            }
            actions={
              page === "overview" ? (
                <ButtonLink variant="secondary" href="#/viagens">
                  Ver viagens
                </ButtonLink>
              ) : undefined
            }
          />
          {page === "trips" ? (
            <TripCreateForm
              onCreated={onTripCreated}
              onAuthenticationRequired={onAuthenticationRequired}
            />
          ) : null}
          {trips.kind === "denied" ? (
            <TripsList state={trips} onRetry={onRetryTrips} onLoadMore={onLoadMore} showAll />
          ) : (
            <section aria-labelledby="admin-trips-heading" aria-busy={trips.kind === "loading"}>
              <SectionHeading
                id="admin-trips-heading"
                title={page === "overview" ? "Viagens recentes" : "Todas as viagens"}
                meta={trips.kind === "ready" ? `${trips.items.length} nesta página` : undefined}
              />
              <TripsList
                state={trips}
                onRetry={onRetryTrips}
                onLoadMore={onLoadMore}
                showAll={page === "trips"}
              />
            </section>
          )}
        </>
      )}
    </WorkspaceFrame>
  );
}
