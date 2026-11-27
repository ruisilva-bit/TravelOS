import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import {
  Button,
  DateField,
  SectionHeading,
  Select,
  StateMessage,
  StatusPill,
  Table,
  TextArea,
  TextField,
} from "@travelos/design-system";

import { TRAVELOS_CANONICAL_TIMEZONE_NAMES } from "@travelos/contracts/admin";
import {
  AdminApiError,
  createAdminAccommodation,
  createAdminFlight,
  createAdminTripWorkspace,
  getAdminPublicationPreview,
  getAdminTripWorkspace,
  listAdminShareLinks,
  revokeAdminShareLink,
  createAdminShareLink,
  updateAdminAccommodation,
  updateAdminFlight,
  updateAdminTripWorkspace,
} from "./api.js";
import { getZonedInstantCandidates } from "./local-date-time.js";

export type AdminWorkflowWorkspace = Awaited<ReturnType<typeof getAdminTripWorkspace>>;
type TripPublicationPreview = Awaited<ReturnType<typeof getAdminPublicationPreview>>;
type ShareLinkList = Awaited<ReturnType<typeof listAdminShareLinks>>;
type CreatedShareLink = Awaited<ReturnType<typeof createAdminShareLink>>;
type FlightDraft = Parameters<typeof createAdminFlight>[1]["flight"];
type AccommodationDraft = Parameters<typeof createAdminAccommodation>[1]["accommodation"];
type FlightItem = AdminWorkflowWorkspace["flights"][number];
type AccommodationItem = AdminWorkflowWorkspace["accommodations"][number];

const textValue = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const nullableValue = (formData: FormData, name: string): string | null =>
  textValue(formData, name) || null;

const safeErrorMessage = (error: unknown): string =>
  error instanceof AdminApiError ? error.message : "Ocorreu um erro. Tente novamente.";

const isAuthenticationRequired = (error: unknown): boolean =>
  error instanceof AdminApiError && error.code === "AUTHENTICATION_REQUIRED";

const isConflict = (error: unknown): boolean =>
  error instanceof AdminApiError && error.code === "CONFLICT";

export const createIdempotencyKey = (): string => {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

interface TripCreateFormProps {
  readonly onCreated: (workspace: AdminWorkflowWorkspace) => void;
  readonly onAuthenticationRequired: () => void;
}

export function TripCreateForm({ onCreated, onAuthenticationRequired }: TripCreateFormProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const startDate = textValue(formData, "trip.startDate");
    const endDate = textValue(formData, "trip.endDate");
    if (startDate > endDate) {
      setErrorMessage("A data de fim não pode ser anterior à data de início.");
      return;
    }

    setBusy(true);
    setErrorMessage(null);
    try {
      const result = await createAdminTripWorkspace({
        customer: { displayName: textValue(formData, "customer.displayName") },
        primaryTraveller: {
          givenName: textValue(formData, "primaryTraveller.givenName"),
          familyName: textValue(formData, "primaryTraveller.familyName"),
        },
        trip: {
          title: textValue(formData, "trip.title"),
          startDate,
          endDate,
        },
      });
      onCreated(result);
    } catch (error) {
      if (isAuthenticationRequired(error)) onAuthenticationRequired();
      setErrorMessage(safeErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-create-trip" aria-labelledby="admin-create-trip-heading">
      <div className="admin-workflow__actions">
        <Button
          variant="primary"
          type="button"
          aria-expanded={open}
          aria-controls="admin-create-trip-form"
          onClick={() => {
            setOpen((current) => !current);
            setErrorMessage(null);
          }}
        >
          {open ? "Cancelar criação" : "Nova viagem"}
        </Button>
      </div>
      {open ? (
        <form
          id="admin-create-trip-form"
          className="admin-form"
          aria-labelledby="admin-create-trip-heading"
          onSubmit={(event) => void submit(event)}
        >
          <div>
            <h2 id="admin-create-trip-heading">Nova viagem</h2>
            <p className="admin-form__hint">
              Cria a viagem com um cliente e o viajante principal. O itinerário começa vazio.
            </p>
          </div>
          <div className="admin-form__grid">
            <TextField
              id="admin-create-customer"
              name="customer.displayName"
              label="Cliente"
              required
              maxLength={300}
              autoComplete="organization"
            />
            <TextField
              id="admin-create-traveller-given-name"
              name="primaryTraveller.givenName"
              label="Nome próprio do viajante principal"
              required
              maxLength={200}
              autoComplete="given-name"
            />
            <TextField
              id="admin-create-traveller-family-name"
              name="primaryTraveller.familyName"
              label="Apelido do viajante principal"
              required
              maxLength={200}
              autoComplete="family-name"
            />
            <TextField
              id="admin-create-trip-title"
              name="trip.title"
              label="Nome da viagem"
              required
              maxLength={300}
            />
            <DateField
              id="admin-create-trip-start"
              name="trip.startDate"
              label="Data de início"
              required
            />
            <DateField
              id="admin-create-trip-end"
              name="trip.endDate"
              label="Data de fim"
              required
            />
          </div>
          {errorMessage ? (
            <StateMessage tone="error" role="alert">
              {errorMessage}
            </StateMessage>
          ) : null}
          <div className="admin-form__actions">
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "A criar…" : "Criar viagem"}
            </Button>
            <Button
              variant="secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setErrorMessage(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

type ScheduleInput = {
  readonly localDate: string;
  readonly localTime: string;
  readonly timezoneName: string;
};

class ScheduleInputError extends Error {
  readonly prefix: string;
  readonly candidates: readonly string[];

  constructor(message: string, prefix: string, candidates: readonly string[] = []) {
    super(message);
    this.name = "ScheduleInputError";
    this.prefix = prefix;
    this.candidates = candidates;
  }
}

const buildSchedule = (formData: FormData, prefix: string, label: string) => {
  const localDate = textValue(formData, `${prefix}.localDate`);
  const localTime = textValue(formData, `${prefix}.localTime`);
  const timezoneName = textValue(formData, `${prefix}.timezoneName`);
  if (!localDate || !localTime || !timezoneName) {
    throw new ScheduleInputError(`${label}: indique a data, a hora e o fuso horário IANA.`, prefix);
  }

  const candidates = getZonedInstantCandidates(localDate, localTime, timezoneName);
  if (candidates.length === 0) {
    throw new ScheduleInputError(
      `${label}: a hora local não existe neste fuso horário ou os dados são inválidos.`,
      prefix,
    );
  }
  if (candidates.length > 1) {
    const selected = textValue(formData, `${prefix}.occurrence`);
    if (!candidates.includes(selected)) {
      throw new ScheduleInputError(
        `${label}: esta hora ocorre duas vezes; escolha uma das ocorrências antes de guardar.`,
        prefix,
        candidates,
      );
    }
    return { localDate, localTime, timezoneName, instant: selected };
  }
  return { localDate, localTime, timezoneName, instant: candidates[0] ?? "" };
};

function ScheduleFields({
  prefix,
  label,
  value,
  choices,
  onInputChange,
}: {
  readonly prefix: string;
  readonly label: string;
  readonly value: ScheduleInput;
  readonly choices: readonly string[] | undefined;
  readonly onInputChange: (prefix: string) => void;
}) {
  const handleChange = (): void => onInputChange(prefix);
  return (
    <fieldset className="admin-form__fieldset">
      <legend>{label}</legend>
      <div className="admin-form__grid">
        <DateField
          id={`${prefix}-date`}
          name={`${prefix}.localDate`}
          label={`${label} — data local`}
          defaultValue={value.localDate}
          required
          onChange={handleChange}
        />
        <TextField
          id={`${prefix}-time`}
          name={`${prefix}.localTime`}
          label={`${label} — hora local`}
          type="time"
          step={1}
          defaultValue={value.localTime}
          required
          onChange={handleChange}
        />
        <TextField
          id={`${prefix}-timezone`}
          name={`${prefix}.timezoneName`}
          label={`${label} — fuso horário IANA`}
          placeholder="Europe/Lisbon"
          list="travelos-iana-timezones"
          defaultValue={value.timezoneName}
          required
          onChange={handleChange}
        />
        {choices && choices.length > 1 ? (
          <Select
            id={`${prefix}-occurrence`}
            name={`${prefix}.occurrence`}
            label={`${label} — ocorrência da hora`}
            required
            defaultValue=""
          >
            <option value="">Escolha a ocorrência</option>
            {choices.map((instant, index) => (
              <option key={instant} value={instant}>
                {index === 0 ? "Primeira ocorrência" : "Segunda ocorrência"} · UTC{" "}
                {instant.slice(11, 16)}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
    </fieldset>
  );
}

const scheduleInput = (value: {
  readonly localDate: string;
  readonly localTime: string;
  readonly timezoneName: string;
}): ScheduleInput => ({
  localDate: value.localDate,
  localTime: value.localTime,
  timezoneName: value.timezoneName,
});

const emptySchedule = (): ScheduleInput => ({ localDate: "", localTime: "", timezoneName: "" });

function TripForm({
  workspace,
  busy,
  onSave,
  onCancel,
}: {
  readonly workspace: AdminWorkflowWorkspace;
  readonly busy: boolean;
  readonly onSave: (form: HTMLFormElement) => void;
  readonly onCancel: () => void;
}) {
  return (
    <form
      className="admin-form"
      aria-label="Editar dados da viagem"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(event.currentTarget);
      }}
    >
      <div className="admin-form__grid">
        <TextField
          id="admin-edit-trip-title"
          name="trip.title"
          label="Nome da viagem"
          defaultValue={workspace.trip.title}
          required
          maxLength={300}
        />
        <DateField
          id="admin-edit-trip-start"
          name="trip.startDate"
          label="Data de início"
          defaultValue={workspace.trip.startDate}
          required
        />
        <DateField
          id="admin-edit-trip-end"
          name="trip.endDate"
          label="Data de fim"
          defaultValue={workspace.trip.endDate}
          required
        />
      </div>
      <div className="admin-form__actions">
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "A guardar…" : "Guardar viagem"}
        </Button>
        <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function FlightForm({
  item,
  choices,
  busy,
  onSave,
  onCancel,
  onScheduleInputChange,
}: {
  readonly item: FlightItem | undefined;
  readonly choices: Readonly<Record<string, readonly string[]>>;
  readonly busy: boolean;
  readonly onSave: (form: HTMLFormElement, itemId: string | null) => void;
  readonly onCancel: () => void;
  readonly onScheduleInputChange: (prefix: string) => void;
}) {
  const departure = item ? scheduleInput(item.departure) : emptySchedule();
  const arrival = item ? scheduleInput(item.arrival) : emptySchedule();
  return (
    <form
      className="admin-form"
      aria-label={item ? `Editar voo: ${item.title}` : "Adicionar voo"}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(event.currentTarget, item?.id ?? null);
      }}
    >
      <div className="admin-form__grid">
        <TextField
          id="flight-title"
          name="flight.title"
          label="Título do voo"
          defaultValue={item?.title}
          required
          maxLength={300}
        />
        <TextField
          id="flight-carrier"
          name="flight.carrier"
          label="Transportadora"
          defaultValue={item?.carrier}
          required
          maxLength={200}
        />
        <TextField
          id="flight-number"
          name="flight.flightNumber"
          label="Número do voo"
          defaultValue={item?.flightNumber}
          required
          maxLength={50}
        />
        <TextField
          id="flight-departure-airport"
          name="flight.departureAirport"
          label="Aeroporto de partida (IATA)"
          defaultValue={item?.departureAirport}
          required
          minLength={3}
          maxLength={3}
        />
        <TextField
          id="flight-arrival-airport"
          name="flight.arrivalAirport"
          label="Aeroporto de chegada (IATA)"
          defaultValue={item?.arrivalAirport}
          required
          minLength={3}
          maxLength={3}
        />
      </div>
      <TextArea
        id="flight-description"
        name="flight.description"
        label="Descrição do voo"
        defaultValue={item?.description}
        required
        maxLength={10_000}
        rows={3}
      />
      <ScheduleFields
        prefix="departure"
        label="Partida"
        value={departure}
        choices={choices.departure}
        onInputChange={onScheduleInputChange}
      />
      <ScheduleFields
        prefix="arrival"
        label="Chegada"
        value={arrival}
        choices={choices.arrival}
        onInputChange={onScheduleInputChange}
      />
      <div className="admin-form__grid">
        <TextField
          id="flight-terminal"
          name="flight.terminal"
          label="Terminal"
          defaultValue={item?.terminal ?? ""}
          maxLength={100}
        />
        <TextField
          id="flight-cabin"
          name="flight.cabin"
          label="Cabine"
          defaultValue={item?.cabin ?? ""}
          maxLength={100}
        />
        <TextField
          id="flight-baggage"
          name="flight.baggage"
          label="Bagagem"
          defaultValue={item?.baggage ?? ""}
          maxLength={500}
        />
        <TextField
          id="flight-seat"
          name="flight.seat"
          label="Lugar"
          defaultValue={item?.seat ?? ""}
          maxLength={50}
        />
        <TextField
          id="flight-reference"
          name="flight.customerBookingReference"
          label="Referência de reserva"
          defaultValue={item?.customerBookingReference ?? ""}
          maxLength={200}
        />
      </div>
      <div className="admin-form__actions">
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "A guardar…" : "Guardar voo"}
        </Button>
        <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function AccommodationForm({
  item,
  choices,
  busy,
  onSave,
  onCancel,
  onScheduleInputChange,
}: {
  readonly item: AccommodationItem | undefined;
  readonly choices: Readonly<Record<string, readonly string[]>>;
  readonly busy: boolean;
  readonly onSave: (form: HTMLFormElement, itemId: string | null) => void;
  readonly onCancel: () => void;
  readonly onScheduleInputChange: (prefix: string) => void;
}) {
  const checkIn = item ? scheduleInput(item.checkIn) : emptySchedule();
  const checkOut = item ? scheduleInput(item.checkOut) : emptySchedule();
  return (
    <form
      className="admin-form"
      aria-label={item ? `Editar alojamento: ${item.title}` : "Adicionar alojamento"}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(event.currentTarget, item?.id ?? null);
      }}
    >
      <div className="admin-form__grid">
        <TextField
          id="accommodation-title"
          name="accommodation.title"
          label="Título do alojamento"
          defaultValue={item?.title}
          required
          maxLength={300}
        />
        <TextField
          id="accommodation-property"
          name="accommodation.propertyName"
          label="Estabelecimento"
          defaultValue={item?.propertyName}
          required
          maxLength={300}
        />
      </div>
      <TextArea
        id="accommodation-description"
        name="accommodation.description"
        label="Descrição do alojamento"
        defaultValue={item?.description}
        required
        maxLength={10_000}
        rows={3}
      />
      <ScheduleFields
        prefix="checkIn"
        label="Check-in"
        value={checkIn}
        choices={choices.checkIn}
        onInputChange={onScheduleInputChange}
      />
      <ScheduleFields
        prefix="checkOut"
        label="Check-out"
        value={checkOut}
        choices={choices.checkOut}
        onInputChange={onScheduleInputChange}
      />
      <div className="admin-form__grid">
        <TextField
          id="accommodation-room"
          name="accommodation.roomDescription"
          label="Quarto"
          defaultValue={item?.roomDescription ?? ""}
          maxLength={500}
        />
        <TextField
          id="accommodation-board"
          name="accommodation.boardType"
          label="Regime"
          defaultValue={item?.boardType ?? ""}
          maxLength={200}
        />
        <TextField
          id="accommodation-reference"
          name="accommodation.customerBookingReference"
          label="Referência de reserva"
          defaultValue={item?.customerBookingReference ?? ""}
          maxLength={200}
        />
      </div>
      <div className="admin-form__actions">
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "A guardar…" : "Guardar alojamento"}
        </Button>
        <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

const formatDate = (localDate: string): string =>
  new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${localDate}T00:00:00.000Z`));

const formatSnapshotTime = (value: {
  readonly localDate: string;
  readonly localTime: string;
  readonly timeZone: string;
}): string => `${formatDate(value.localDate)} · ${value.localTime} · ${value.timeZone}`;

const formatDateTimeUtc = (value: string): string =>
  new Intl.DateTimeFormat("pt-PT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));

function PreviewItems({ preview }: { readonly preview: TripPublicationPreview }) {
  if (preview.projection.items.length === 0) {
    return <p className="admin-form__hint">O itinerário não contém serviços.</p>;
  }
  return (
    <ol className="admin-preview__items">
      {preview.projection.items.map((item, index) => (
        <li key={`${item.kind}-${index}`}>
          <strong>{item.title}</strong>
          <span>{item.kind === "FLIGHT" ? "Voo" : "Alojamento"}</span>
          {item.kind === "FLIGHT" ? (
            <>
              <span>
                {item.departureAirport} → {item.arrivalAirport}
              </span>
              <span>
                {formatSnapshotTime(item.departure)} – {formatSnapshotTime(item.arrival)}
              </span>
            </>
          ) : (
            <>
              <span>{item.propertyName}</span>
              <span>
                {formatSnapshotTime(item.checkIn)} – {formatSnapshotTime(item.checkOut)}
              </span>
            </>
          )}
          {item.description ? <span>{item.description}</span> : null}
        </li>
      ))}
    </ol>
  );
}

const SHARE_STATE_LABEL = { ACTIVE: "Ativo", EXPIRED: "Expirado", REVOKED: "Revogado" } as const;
const SHARE_STATE_TONE = { ACTIVE: "success", EXPIRED: "warning", REVOKED: "danger" } as const;

function ShareLinkList({
  links,
  loading,
  errorMessage,
  revokingId,
  onRevoke,
  onRetry,
}: {
  readonly links: ShareLinkList | null;
  readonly loading: boolean;
  readonly errorMessage: string | null;
  readonly revokingId: string | null;
  readonly onRevoke: (shareLinkId: string) => void;
  readonly onRetry: () => void;
}) {
  return (
    <section className="admin-publications" aria-labelledby="admin-share-links-title">
      <SectionHeading id="admin-share-links-title" title="Ligações partilhadas" />
      {errorMessage ? (
        <StateMessage
          tone="error"
          role="alert"
          action={<Button onClick={onRetry}>Tentar novamente</Button>}
        >
          {errorMessage}
        </StateMessage>
      ) : (
        <Table
          caption="Ligações partilhadas"
          columns={[
            {
              key: "state",
              header: "Estado",
              cell: (link) => (
                <StatusPill tone={SHARE_STATE_TONE[link.state]}>
                  {SHARE_STATE_LABEL[link.state]}
                </StatusPill>
              ),
            },
            {
              key: "created",
              header: "Criada em",
              cell: (link) => (
                <time dateTime={link.createdAt}>{formatDateTimeUtc(link.createdAt)}</time>
              ),
            },
            {
              key: "expires",
              header: "Expira em",
              cell: (link) => (
                <time dateTime={link.expiresAt}>{formatDateTimeUtc(link.expiresAt)}</time>
              ),
            },
            {
              key: "actions",
              header: <span className="sr-only">Ações</span>,
              align: "right",
              cell: (link) =>
                link.state === "ACTIVE" ? (
                  <Button disabled={revokingId !== null} onClick={() => onRevoke(link.shareLinkId)}>
                    {revokingId === link.shareLinkId ? "A revogar…" : "Revogar"}
                  </Button>
                ) : null,
            },
          ]}
          rows={links?.links ?? []}
          getRowKey={(link) => link.shareLinkId}
          loading={loading}
          loadingLabel="A carregar ligações…"
          empty={<StateMessage>Ainda não existe nenhuma ligação partilhada.</StateMessage>}
        />
      )}
    </section>
  );
}

function PublicationWorkflow({
  workspace,
  preview,
  previewLoading,
  sharing,
  feedback,
  disabled,
  created,
  copyMessage,
  expiresInDays,
  onExpiresInDaysChange,
  onPreview,
  onShare,
  onCopy,
  links,
  linksLoading,
  linksError,
  revokingId,
  onRevoke,
  onRetryLinks,
}: {
  readonly workspace: AdminWorkflowWorkspace;
  readonly preview: TripPublicationPreview | null;
  readonly previewLoading: boolean;
  readonly sharing: boolean;
  readonly feedback: string | null;
  readonly disabled: boolean;
  readonly created: CreatedShareLink | null;
  readonly copyMessage: string | null;
  readonly expiresInDays: string;
  readonly onExpiresInDaysChange: (value: string) => void;
  readonly onPreview: () => void;
  readonly onShare: () => void;
  readonly onCopy: () => void;
  readonly links: ShareLinkList | null;
  readonly linksLoading: boolean;
  readonly linksError: string | null;
  readonly revokingId: string | null;
  readonly onRevoke: (shareLinkId: string) => void;
  readonly onRetryLinks: () => void;
}) {
  return (
    <section
      className="admin-publication-workflow"
      aria-labelledby="admin-publication-workflow-title"
    >
      <div className="admin-section-intro">
        <div>
          <h2 id="admin-publication-workflow-title">Pré-visualização e partilha</h2>
          <p className="admin-form__hint">
            A pré-visualização é apenas de leitura. Partilhar cria uma cópia imutável da viagem e
            uma ligação revogável para o cliente.
          </p>
        </div>
        <Button
          variant="secondary"
          type="button"
          onClick={onPreview}
          disabled={disabled || previewLoading || sharing}
        >
          {previewLoading ? "A preparar…" : "Pré-visualizar como cliente"}
        </Button>
      </div>
      {feedback ? (
        <StateMessage tone="error" role="alert">
          {feedback}
        </StateMessage>
      ) : null}
      {preview ? (
        <div className="admin-preview">
          <h3>Pré-visualização — o que o cliente verá</h3>
          <p>
            Revisão do espaço de trabalho: <strong>{preview.workspaceRevision}</strong>
            {preview.workspaceRevision !== workspace.trip.workspaceRevision
              ? " · Esta pré-visualização está desatualizada."
              : ""}
          </p>
          <h4>{preview.projection.trip.title}</h4>
          <p>
            {formatDate(preview.projection.trip.startDate)} –{" "}
            {formatDate(preview.projection.trip.endDate)}
          </p>
          <PreviewItems preview={preview} />
        </div>
      ) : null}
      <div className="admin-share">
        <TextField
          label="Validade (dias)"
          type="number"
          min={1}
          max={365}
          inputMode="numeric"
          placeholder="90"
          value={expiresInDays}
          onChange={(event) => onExpiresInDaysChange(event.target.value)}
          disabled={disabled || sharing}
        />
        <Button variant="primary" type="button" onClick={onShare} disabled={disabled || sharing}>
          {sharing ? "A partilhar…" : "Partilhar com o cliente"}
        </Button>
      </div>
      {created ? (
        <div className="admin-created-link" role="status" aria-live="polite">
          <p>
            <strong>Ligação criada.</strong> Copie-a agora: por segurança, só é mostrada uma vez.
          </p>
          <TextField label="Ligação para o cliente" type="text" readOnly value={created.url} />
          <Button variant="secondary" type="button" onClick={onCopy}>
            Copiar link
          </Button>
          {copyMessage ? <span> {copyMessage}</span> : null}
        </div>
      ) : null}
      <ShareLinkList
        links={links}
        loading={linksLoading}
        errorMessage={linksError}
        revokingId={revokingId}
        onRevoke={onRevoke}
        onRetry={onRetryLinks}
      />
    </section>
  );
}

interface ActiveEditor {
  readonly kind: "trip" | "flight" | "accommodation";
  readonly itemId: string | null;
}

export function TripWorkspaceEditor({
  workspace,
  onWorkspaceUpdated,
  onAuthenticationRequired,
}: {
  readonly workspace: AdminWorkflowWorkspace;
  readonly onWorkspaceUpdated: (workspace: AdminWorkflowWorkspace) => void;
  readonly onAuthenticationRequired: () => void;
}) {
  const tripId = workspace.trip.id;
  const [activeEditor, setActiveEditor] = useState<ActiveEditor | null>(null);
  const [scheduleChoices, setScheduleChoices] = useState<
    Readonly<Record<string, readonly string[]>>
  >({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [preview, setPreview] = useState<TripPublicationPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [created, setCreated] = useState<CreatedShareLink | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [expiresInDays, setExpiresInDays] = useState("");
  const [links, setLinks] = useState<ShareLinkList | null>(null);
  const [linksLoading, setLinksLoading] = useState(true);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [linksReloadKey, setLinksReloadKey] = useState(0);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLinksLoading(true);
    setLinksError(null);
    void listAdminShareLinks(tripId)
      .then(
        (result) => {
          if (current) setLinks(result);
        },
        (error: unknown) => {
          if (!current) return;
          if (isAuthenticationRequired(error)) onAuthenticationRequired();
          else setLinksError(safeErrorMessage(error));
        },
      )
      .finally(() => {
        if (current) setLinksLoading(false);
      });
    return () => {
      current = false;
    };
  }, [linksReloadKey, onAuthenticationRequired, tripId]);

  const openEditor = (editor: ActiveEditor): void => {
    setActiveEditor(editor);
    setScheduleChoices({});
    setFeedback(null);
    setPreview(null);
  };

  const cancelEditor = (): void => {
    setActiveEditor(null);
    setScheduleChoices({});
    setFeedback(null);
  };

  const clearScheduleChoices = (prefix: string): void => {
    setScheduleChoices((current) => {
      const next = { ...current };
      delete next[prefix];
      return next;
    });
    setFeedback(null);
  };

  const saveWorkspace = async (
    operation: () => Promise<AdminWorkflowWorkspace>,
    successMessage: string,
  ): Promise<void> => {
    setSaving(true);
    setFeedback(null);
    try {
      const updated = await operation();
      onWorkspaceUpdated(updated);
      setActiveEditor(null);
      setScheduleChoices({});
      setPreview(null);
      setFeedback(successMessage);
    } catch (error) {
      if (isAuthenticationRequired(error)) {
        onAuthenticationRequired();
        return;
      }
      if (isConflict(error)) {
        setActiveEditor(null);
        setScheduleChoices({});
        setPreview(null);
        setFeedback(
          "A viagem foi alterada desde a última leitura. Os dados atuais foram recarregados; reveja-os antes de editar novamente.",
        );
        try {
          onWorkspaceUpdated(await getAdminTripWorkspace(tripId));
        } catch (refreshError) {
          if (isAuthenticationRequired(refreshError)) onAuthenticationRequired();
          else setFeedback(safeErrorMessage(refreshError));
        }
        return;
      }
      setFeedback(safeErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const saveTrip = (form: HTMLFormElement): void => {
    const formData = new FormData(form);
    const trip = {
      title: textValue(formData, "trip.title"),
      startDate: textValue(formData, "trip.startDate"),
      endDate: textValue(formData, "trip.endDate"),
    };
    if (trip.startDate > trip.endDate) {
      setFeedback("A data de fim não pode ser anterior à data de início.");
      return;
    }
    void saveWorkspace(
      () =>
        updateAdminTripWorkspace(tripId, {
          expectedLockVersion: workspace.trip.lockVersion,
          expectedWorkspaceRevision: workspace.trip.workspaceRevision,
          trip,
        }),
      "Alterações guardadas. A pré-visualização anterior foi invalidada.",
    );
  };

  const saveFlight = (form: HTMLFormElement, itemId: string | null): void => {
    const formData = new FormData(form);
    let flight: FlightDraft;
    try {
      flight = {
        title: textValue(formData, "flight.title"),
        description: textValue(formData, "flight.description"),
        carrier: textValue(formData, "flight.carrier"),
        flightNumber: textValue(formData, "flight.flightNumber"),
        departureAirport: textValue(formData, "flight.departureAirport").toUpperCase(),
        arrivalAirport: textValue(formData, "flight.arrivalAirport").toUpperCase(),
        departure: buildSchedule(formData, "departure", "Partida"),
        arrival: buildSchedule(formData, "arrival", "Chegada"),
        terminal: nullableValue(formData, "flight.terminal"),
        cabin: nullableValue(formData, "flight.cabin"),
        baggage: nullableValue(formData, "flight.baggage"),
        seat: nullableValue(formData, "flight.seat"),
        customerBookingReference: nullableValue(formData, "flight.customerBookingReference"),
      };
    } catch (error) {
      if (error instanceof ScheduleInputError) {
        if (error.candidates.length > 1) {
          setScheduleChoices((current) => ({ ...current, [error.prefix]: error.candidates }));
        }
        setFeedback(error.message);
      } else {
        setFeedback(safeErrorMessage(error));
      }
      return;
    }

    const operation = itemId
      ? () =>
          updateAdminFlight(tripId, itemId, {
            expectedLockVersion:
              workspace.flights.find((item) => item.id === itemId)?.lockVersion ?? "0",
            expectedWorkspaceRevision: workspace.trip.workspaceRevision,
            flight,
          })
      : () =>
          createAdminFlight(tripId, {
            expectedWorkspaceRevision: workspace.trip.workspaceRevision,
            flight,
          });
    void saveWorkspace(operation, "Voo guardado. A pré-visualização anterior foi invalidada.");
  };

  const saveAccommodation = (form: HTMLFormElement, itemId: string | null): void => {
    const formData = new FormData(form);
    let accommodation: AccommodationDraft;
    try {
      accommodation = {
        title: textValue(formData, "accommodation.title"),
        description: textValue(formData, "accommodation.description"),
        propertyName: textValue(formData, "accommodation.propertyName"),
        checkIn: buildSchedule(formData, "checkIn", "Check-in"),
        checkOut: buildSchedule(formData, "checkOut", "Check-out"),
        roomDescription: nullableValue(formData, "accommodation.roomDescription"),
        boardType: nullableValue(formData, "accommodation.boardType"),
        customerBookingReference: nullableValue(formData, "accommodation.customerBookingReference"),
      };
    } catch (error) {
      if (error instanceof ScheduleInputError) {
        if (error.candidates.length > 1) {
          setScheduleChoices((current) => ({ ...current, [error.prefix]: error.candidates }));
        }
        setFeedback(error.message);
      } else {
        setFeedback(safeErrorMessage(error));
      }
      return;
    }

    const operation = itemId
      ? () =>
          updateAdminAccommodation(tripId, itemId, {
            expectedLockVersion:
              workspace.accommodations.find((item) => item.id === itemId)?.lockVersion ?? "0",
            expectedWorkspaceRevision: workspace.trip.workspaceRevision,
            accommodation,
          })
      : () =>
          createAdminAccommodation(tripId, {
            expectedWorkspaceRevision: workspace.trip.workspaceRevision,
            accommodation,
          });
    void saveWorkspace(
      operation,
      "Alojamento guardado. A pré-visualização anterior foi invalidada.",
    );
  };

  const refreshWorkspaceAfterPreviewConflict = async (): Promise<void> => {
    setPreview(null);
    setFeedback(
      "A pré-visualização ficou desatualizada. Carregámos os dados atuais; gere uma nova pré-visualização.",
    );
    try {
      onWorkspaceUpdated(await getAdminTripWorkspace(tripId));
    } catch (error) {
      if (isAuthenticationRequired(error)) onAuthenticationRequired();
      else setFeedback(safeErrorMessage(error));
    }
  };

  const loadPreview = async (): Promise<void> => {
    setPreviewLoading(true);
    setFeedback(null);
    try {
      const result = await getAdminPublicationPreview(tripId);
      if (result.workspaceRevision !== workspace.trip.workspaceRevision) {
        await refreshWorkspaceAfterPreviewConflict();
        return;
      }
      setPreview(result);
    } catch (error) {
      if (isAuthenticationRequired(error)) onAuthenticationRequired();
      else if (isConflict(error)) await refreshWorkspaceAfterPreviewConflict();
      else setFeedback(safeErrorMessage(error));
    } finally {
      setPreviewLoading(false);
    }
  };

  const share = async (): Promise<void> => {
    const trimmed = expiresInDays.trim();
    const days = trimmed === "" ? undefined : Number(trimmed);
    if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 365)) {
      setFeedback("A validade deve ser um número inteiro de dias entre 1 e 365.");
      return;
    }
    setSharing(true);
    setFeedback(null);
    setCopyMessage(null);
    setCreated(null);
    try {
      const result = await createAdminShareLink(
        tripId,
        days === undefined ? {} : { expiresInDays: days },
        createIdempotencyKey(),
      );
      setCreated(result);
      setLinksReloadKey((current) => current + 1);
    } catch (error) {
      if (isAuthenticationRequired(error)) onAuthenticationRequired();
      else setFeedback(safeErrorMessage(error));
    } finally {
      setSharing(false);
    }
  };

  const copyLink = async (): Promise<void> => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopyMessage("Link copiado.");
    } catch {
      setCopyMessage("Não foi possível copiar; selecione o texto e copie manualmente.");
    }
  };

  const revoke = async (shareLinkId: string): Promise<void> => {
    setRevokingId(shareLinkId);
    setFeedback(null);
    try {
      await revokeAdminShareLink(shareLinkId);
      setLinksReloadKey((current) => current + 1);
    } catch (error) {
      if (isAuthenticationRequired(error)) onAuthenticationRequired();
      else setFeedback(safeErrorMessage(error));
    } finally {
      setRevokingId(null);
    }
  };

  const currentFlight =
    activeEditor?.kind === "flight"
      ? workspace.flights.find((item) => item.id === activeEditor.itemId)
      : undefined;
  const currentAccommodation =
    activeEditor?.kind === "accommodation"
      ? workspace.accommodations.find((item) => item.id === activeEditor.itemId)
      : undefined;

  return (
    <>
      <datalist id="travelos-iana-timezones">
        {TRAVELOS_CANONICAL_TIMEZONE_NAMES.map((timezoneName) => (
          <option key={timezoneName} value={timezoneName} />
        ))}
      </datalist>
      <section className="admin-workflow" aria-labelledby="admin-workspace-edit-title">
        <SectionHeading id="admin-workspace-edit-title" title="Editar espaço de trabalho" />
        {feedback ? (
          <StateMessage tone="error" role="alert">
            {feedback}
          </StateMessage>
        ) : null}
        <div className="admin-workflow__actions">
          <Button
            variant="secondary"
            type="button"
            onClick={() => openEditor({ kind: "trip", itemId: null })}
            disabled={saving || sharing}
          >
            Editar viagem
          </Button>
          <Button
            variant="secondary"
            type="button"
            onClick={() => openEditor({ kind: "flight", itemId: null })}
            disabled={saving || sharing}
          >
            Adicionar voo
          </Button>
          <Button
            variant="secondary"
            type="button"
            onClick={() => openEditor({ kind: "accommodation", itemId: null })}
            disabled={saving || sharing}
          >
            Adicionar alojamento
          </Button>
        </div>
        {activeEditor?.kind === "trip" ? (
          <TripForm workspace={workspace} busy={saving} onSave={saveTrip} onCancel={cancelEditor} />
        ) : null}
        {activeEditor?.kind === "flight" ? (
          <FlightForm
            item={currentFlight}
            choices={scheduleChoices}
            busy={saving}
            onSave={saveFlight}
            onCancel={cancelEditor}
            onScheduleInputChange={clearScheduleChoices}
          />
        ) : null}
        {activeEditor?.kind === "accommodation" ? (
          <AccommodationForm
            item={currentAccommodation}
            choices={scheduleChoices}
            busy={saving}
            onSave={saveAccommodation}
            onCancel={cancelEditor}
            onScheduleInputChange={clearScheduleChoices}
          />
        ) : null}
        {workspace.flights.length || workspace.accommodations.length ? (
          <ul className="admin-workflow__items" aria-label="Serviços editáveis">
            {workspace.flights.map((item) => (
              <li key={item.id}>
                <span>{item.title}</span>
                <Button
                  variant="ghost"
                  type="button"
                  aria-label={`Editar voo: ${item.title}`}
                  onClick={() => openEditor({ kind: "flight", itemId: item.id })}
                  disabled={saving || sharing}
                >
                  Editar voo
                </Button>
              </li>
            ))}
            {workspace.accommodations.map((item) => (
              <li key={item.id}>
                <span>{item.title}</span>
                <Button
                  variant="ghost"
                  type="button"
                  aria-label={`Editar alojamento: ${item.title}`}
                  onClick={() => openEditor({ kind: "accommodation", itemId: item.id })}
                  disabled={saving || sharing}
                >
                  Editar alojamento
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <PublicationWorkflow
        workspace={workspace}
        preview={preview}
        previewLoading={previewLoading}
        sharing={sharing}
        feedback={null}
        disabled={activeEditor !== null || saving}
        created={created}
        copyMessage={copyMessage}
        expiresInDays={expiresInDays}
        onExpiresInDaysChange={setExpiresInDays}
        onPreview={() => void loadPreview()}
        onShare={() => void share()}
        onCopy={() => void copyLink()}
        links={links}
        linksLoading={linksLoading}
        linksError={linksError}
        revokingId={revokingId}
        onRevoke={(shareLinkId) => void revoke(shareLinkId)}
        onRetryLinks={() => setLinksReloadKey((current) => current + 1)}
      />
    </>
  );
}
