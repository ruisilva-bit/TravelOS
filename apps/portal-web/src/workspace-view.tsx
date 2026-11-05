import { WorkspaceFrame } from "@travelos/design-system";
import type { listPortalTrips, readPortalTripSnapshot } from "./api.js";

export type PortalTripListItem = Awaited<ReturnType<typeof listPortalTrips>>["items"][number];
export type PortalSnapshot = Awaited<ReturnType<typeof readPortalTripSnapshot>>;

export type PortalTripsState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly items: readonly PortalTripListItem[];
      readonly nextCursor: string | null;
      readonly loadingMore: boolean;
      readonly loadMoreError: string | null;
    };

export type PortalSnapshotState =
  | { readonly kind: "loading" }
  | { readonly kind: "not-available" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly snapshot: PortalSnapshot };

interface PortalWorkspaceViewProps {
  readonly page: "trips" | "detail";
  readonly trips: PortalTripsState;
  readonly snapshot: PortalSnapshotState;
  readonly onRetryTrips: () => void;
  readonly onLoadMore: () => void;
  readonly onRetrySnapshot: () => void;
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

const scheduleText = (schedule: {
  readonly localDate: string;
  readonly localTime: string;
  readonly timeZone: string;
}): string =>
  `${formatLocalDate(schedule.localDate)} · ${schedule.localTime} · ${schedule.timeZone}`;

function SnapshotFacts({
  facts,
}: {
  readonly facts: readonly (readonly [string, string | null])[];
}) {
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

function PublishedTripCard({
  item,
}: {
  readonly item: Extract<PortalTripListItem, { publicationState: "PUBLISHED" }>;
}) {
  return (
    <li>
      <a
        className="portal-trip-card"
        href={`#/trips/${encodeURIComponent(item.tripId)}`}
        aria-label={`Abrir itinerário: ${item.snapshot.trip.title}`}
      >
        <h2 className="portal-trip-card__title">{item.snapshot.trip.title}</h2>
        <p className="portal-trip-card__date">
          {formatDateRange(item.snapshot.trip.startDate, item.snapshot.trip.endDate)}
        </p>
        <span className="state-pill state-pill--positive">Publicado</span>
      </a>
    </li>
  );
}

function NoPublicationCard() {
  return (
    <li className="portal-pending-card">
      <h2>Aguarda publicação</h2>
      <p>A sua agência ainda não publicou um itinerário para esta viagem.</p>
    </li>
  );
}

function PortalTripsList({
  state,
  onRetry,
  onLoadMore,
}: {
  readonly state: PortalTripsState;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
}) {
  if (state.kind === "loading") {
    return (
      <p className="state-message" role="status" aria-live="polite">
        A carregar as suas viagens…
      </p>
    );
  }
  if (state.kind === "denied") {
    return (
      <div className="state-message state-message--error" role="alert">
        Não foi possível validar o acesso às viagens.
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="state-message state-message--error" role="alert">
        <p>{state.message}</p>
        <button className="button button--secondary" type="button" onClick={onRetry}>
          Tentar novamente
        </button>
      </div>
    );
  }
  if (state.items.length === 0) {
    return <p className="state-message">Não tem viagens disponíveis neste momento.</p>;
  }

  return (
    <>
      <ul className="trip-list" aria-label="As minhas viagens">
        {state.items.map((item) =>
          item.publicationState === "PUBLISHED" ? (
            <PublishedTripCard key={item.tripId} item={item} />
          ) : (
            <NoPublicationCard key={item.tripId} />
          ),
        )}
      </ul>
      {state.loadMoreError ? (
        <div className="state-message state-message--error" role="alert">
          <p>{state.loadMoreError}</p>
          <button className="button button--secondary" type="button" onClick={onLoadMore}>
            Tentar novamente
          </button>
        </div>
      ) : null}
      {state.nextCursor !== null ? (
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

function PortalSnapshotDetail({
  state,
  onRetry,
}: {
  readonly state: PortalSnapshotState;
  readonly onRetry: () => void;
}) {
  if (state.kind === "loading") {
    return (
      <p className="state-message" role="status" aria-live="polite">
        A carregar o itinerário publicado…
      </p>
    );
  }
  if (state.kind === "not-available") {
    return (
      <section className="state-message" aria-labelledby="portal-trip-unavailable-title">
        <h1 id="portal-trip-unavailable-title">Esta viagem não está disponível.</h1>
        <p>Não foi possível encontrar um itinerário autorizado para esta viagem.</p>
        <a className="text-link" href="#/trips">
          Voltar às minhas viagens
        </a>
      </section>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="state-message state-message--error" role="alert">
        <p>{state.message}</p>
        <button className="button button--secondary" type="button" onClick={onRetry}>
          Tentar novamente
        </button>
      </div>
    );
  }

  const { trip, items } = state.snapshot;
  const events = items
    .map((item, index) => ({
      item,
      id: `${item.kind}-${index}`,
      instant: item.kind === "FLIGHT" ? item.departure.instant : item.checkIn.instant,
      time: item.kind === "FLIGHT" ? item.departure : item.checkIn,
    }))
    .sort((left, right) => Date.parse(left.instant) - Date.parse(right.instant));

  return (
    <>
      <a className="detail-back" href="#/trips">
        ← Voltar às minhas viagens
      </a>
      <header className="page-heading">
        <div>
          <h1>{trip.title}</h1>
          <p>Itinerário publicado</p>
        </div>
        <span className="state-pill state-pill--positive">Publicado</span>
      </header>
      <div className="trip-detail-summary">
        <span className="trip-detail-summary__date">
          {formatDateRange(trip.startDate, trip.endDate)}
        </span>
        <span>
          {events.length} {events.length === 1 ? "serviço" : "serviços"}
        </span>
      </div>
      <section aria-labelledby="portal-itinerary-heading">
        <div className="section-heading">
          <h2 id="portal-itinerary-heading">Itinerário</h2>
        </div>
        {events.length === 0 ? (
          <p className="state-message">Este itinerário ainda não tem serviços publicados.</p>
        ) : (
          <ol className="itinerary-list">
            {events.map(({ item, id, instant, time }) => (
              <li className="itinerary-event" key={id}>
                <time className="itinerary-event__time" dateTime={instant}>
                  {scheduleText(time)}
                </time>
                <span className="itinerary-event__marker" aria-hidden="true" />
                <article className="itinerary-event__content">
                  <span className="itinerary-event__kind">
                    {item.kind === "FLIGHT" ? "Voo" : "Alojamento"}
                  </span>
                  <h2 className="itinerary-event__title">{item.title}</h2>
                  {item.description ? (
                    <p className="itinerary-event__description">{item.description}</p>
                  ) : null}
                  {item.kind === "FLIGHT" ? (
                    <>
                      <p className="itinerary-route">
                        {item.departureAirport} → {item.arrivalAirport}
                      </p>
                      <SnapshotFacts
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
                    </>
                  ) : (
                    <SnapshotFacts
                      facts={[
                        ["Estabelecimento", item.propertyName],
                        ["Check-in", scheduleText(item.checkIn)],
                        ["Check-out", scheduleText(item.checkOut)],
                        ["Quarto", item.roomDescription],
                        ["Regime", item.boardType],
                        ["Referência", item.customerBookingReference],
                      ]}
                    />
                  )}
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

export function PortalWorkspaceView({
  page,
  trips,
  snapshot,
  onRetryTrips,
  onLoadMore,
  onRetrySnapshot,
  onSignOut,
  signingOut,
  signOutError,
}: PortalWorkspaceViewProps) {
  return (
    <WorkspaceFrame
      realm="Portal"
      headerContext={page === "trips" ? "As minhas viagens" : "Itinerário publicado"}
      navigation={[{ href: "#/trips", label: "As minhas viagens" }]}
      activeHref="#/trips"
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
      {page === "trips" ? (
        <>
          <header className="page-heading">
            <div>
              <h1>As minhas viagens</h1>
              <p>Itinerários disponibilizados pela sua agência.</p>
            </div>
          </header>
          <section aria-labelledby="portal-trips-heading" aria-busy={trips.kind === "loading"}>
            <div className="section-heading">
              <h2 id="portal-trips-heading">Viagens com acesso</h2>
              {trips.kind === "ready" ? (
                <span className="section-heading__meta">{trips.items.length} nesta página</span>
              ) : null}
            </div>
            <PortalTripsList state={trips} onRetry={onRetryTrips} onLoadMore={onLoadMore} />
          </section>
        </>
      ) : (
        <PortalSnapshotDetail state={snapshot} onRetry={onRetrySnapshot} />
      )}
    </WorkspaceFrame>
  );
}
