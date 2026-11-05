import { WorkspaceFrame } from "@travelos/design-system";
import type { getAdminTripWorkspace, listAdminTrips } from "./api.js";
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
  readonly page: "overview" | "trips" | "staff-invitations" | "detail";
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

const tripStateTone = (state: AdminTrip["state"]): string => {
  if (state === "CONFIRMED" || state === "IN_OPERATION") return " state-pill--positive";
  if (state === "CANCELLED") return " state-pill--negative";
  if (state === "DRAFT") return " state-pill--warning";
  return "";
};

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
  if (state.kind === "loading") {
    return (
      <p className="state-message" role="status" aria-live="polite">
        A carregar viagens…
      </p>
    );
  }

  if (state.kind === "denied") {
    return (
      <section className="state-message state-message--error" aria-labelledby="trips-denied-title">
        <h1 id="trips-denied-title">Acesso não autorizado</h1>
        <p>Não tem permissão para consultar as viagens desta agência.</p>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="state-message state-message--error" role="alert">
        <p>{state.message}</p>
        <div className="state-message__actions">
          <button className="button button--secondary" type="button" onClick={onRetry}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const items = showAll ? state.items : state.items.slice(0, 5);
  if (items.length === 0) {
    return <p className="state-message">Ainda não existem viagens para apresentar.</p>;
  }

  return (
    <>
      <ul className="trip-list" aria-label="Viagens">
        {items.map((trip) => (
          <li className="trip-row" key={trip.id}>
            <div className="trip-row__identity">
              <a
                className="trip-row__title"
                href={`#/trips/${encodeURIComponent(trip.id)}`}
                aria-label={`Abrir viagem: ${trip.title}`}
              >
                {trip.title}
              </a>
            </div>
            <p className="trip-row__date">{formatDateRange(trip.startDate, trip.endDate)}</p>
            <span className={`state-pill trip-row__state${tripStateTone(trip.state)}`}>
              {tripStateLabel[trip.state]}
            </span>
            <span className="trip-row__action" aria-hidden="true">
              →
            </span>
          </li>
        ))}
      </ul>
      {showAll && state.loadMoreError ? (
        <div className="state-message state-message--error" role="alert">
          <p>{state.loadMoreError}</p>
          <button className="button button--secondary" type="button" onClick={onLoadMore}>
            Tentar novamente
          </button>
        </div>
      ) : null}
      {showAll && state.nextCursor !== null ? (
        <div className="state-message__actions">
          <button
            className="button button--secondary"
            type="button"
            onClick={onLoadMore}
            disabled={state.loadingMore}
            aria-busy={state.loadingMore}
          >
            {state.loadingMore ? "A carregar…" : "Carregar mais viagens"}
          </button>
        </div>
      ) : null}
    </>
  );
}

function TripStatePill({ state }: { readonly state: AdminTrip["state"] }) {
  return <span className={`state-pill${tripStateTone(state)}`}>{tripStateLabel[state]}</span>;
}

function DetailError({
  state,
  onRetry,
}: {
  readonly state: Exclude<AdminWorkspaceState, { readonly kind: "ready" }>;
  readonly onRetry: () => void;
}) {
  if (state.kind === "loading") {
    return (
      <p className="state-message" role="status" aria-live="polite">
        A carregar o itinerário…
      </p>
    );
  }
  if (state.kind === "denied") {
    return (
      <section className="state-message state-message--error" aria-labelledby="trip-denied-title">
        <h1 id="trip-denied-title">Acesso não autorizado</h1>
        <p>Não tem permissão para consultar esta viagem.</p>
      </section>
    );
  }
  if (state.kind === "not-found") {
    return (
      <section className="state-message" aria-labelledby="trip-not-found-title">
        <h1 id="trip-not-found-title">Viagem não encontrada</h1>
        <p>Esta viagem não está disponível neste espaço de operações.</p>
      </section>
    );
  }
  return (
    <div className="state-message state-message--error" role="alert">
      <p>{state.message}</p>
      <button className="button button--secondary" type="button" onClick={onRetry}>
        Tentar novamente
      </button>
    </div>
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
      <a className="detail-back" href="#/trips">
        ← Voltar às viagens
      </a>
      <header className="page-heading">
        <div>
          <h1>{trip.title}</h1>
          <p>Itinerário de trabalho · Os dados apresentados pertencem ao espaço de operações.</p>
        </div>
        <TripStatePill state={trip.state} />
      </header>
      <div className="trip-detail-summary">
        <span className="trip-detail-summary__date">
          {formatDateRange(trip.startDate, trip.endDate)}
        </span>
        <span>
          {events.length} {events.length === 1 ? "serviço" : "serviços"}
        </span>
      </div>
      <section aria-labelledby="admin-itinerary-heading">
        <div className="section-heading">
          <h2 id="admin-itinerary-heading">Itinerário</h2>
        </div>
        {events.length === 0 ? (
          <p className="state-message">Ainda não existem serviços neste itinerário.</p>
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
    page === "overview" ? "#/" : page === "staff-invitations" ? "#/staff/invitations" : "#/trips";
  const headerContext =
    page === "overview"
      ? "Visão geral"
      : page === "trips"
        ? "Viagens"
        : page === "staff-invitations"
          ? "Convites de equipa"
          : "Detalhe da viagem";

  return (
    <WorkspaceFrame
      realm="Staff"
      headerContext={headerContext}
      navigation={[
        { href: "#/", label: "Visão geral" },
        { href: "#/trips", label: "Viagens" },
        ...(canInviteStaff ? [{ href: "#/staff/invitations", label: "Convites de equipa" }] : []),
      ]}
      activeHref={activeHref}
      headerActions={
        <button
          className="button button--quiet"
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
        >
          {signingOut ? "A terminar…" : "Terminar sessão"}
        </button>
      }
    >
      {signOutError ? (
        <p className="state-message state-message--error" role="alert">
          {signOutError}
        </p>
      ) : null}
      {page === "detail" ? (
        <TripDetail
          state={workspace}
          onRetry={onRetryWorkspace}
          onWorkspaceUpdated={onWorkspaceUpdated}
          onAuthenticationRequired={onAuthenticationRequired}
        />
      ) : page === "staff-invitations" ? (
        <StaffInvitationsView onAuthenticationRequired={onAuthenticationRequired} />
      ) : (
        <>
          <header className="page-heading">
            <div>
              <h1>{page === "overview" ? "Visão geral" : "Viagens"}</h1>
              <p>
                {page === "overview"
                  ? "Viagens disponíveis no espaço de operações da agência."
                  : "Consulte as viagens disponíveis para a equipa."}
              </p>
            </div>
            {page === "overview" ? (
              <a className="button button--secondary" href="#/trips">
                Ver viagens
              </a>
            ) : null}
          </header>
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
              <div className="section-heading">
                <h2 id="admin-trips-heading">
                  {page === "overview" ? "Viagens recentes" : "Todas as viagens"}
                </h2>
                {trips.kind === "ready" ? (
                  <span className="section-heading__meta">{trips.items.length} nesta página</span>
                ) : null}
              </div>
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
