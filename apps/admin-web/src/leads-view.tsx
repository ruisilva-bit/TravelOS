import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, InputHTMLAttributes, TextareaHTMLAttributes } from "react";

import {
  AdminApiError,
  createAdminLead,
  disqualifyAdminLead,
  getAdminLead,
  listAdminLeads,
  qualifyAdminLead,
  updateAdminLead,
} from "./api.js";
import { createIdempotencyKey } from "./trip-workflows.js";
import "./leads.css";

type AdminLead = Awaited<ReturnType<typeof getAdminLead>>;
type LeadState = AdminLead["state"];
type LeadSource = AdminLead["source"];
type DisqualificationReason = NonNullable<AdminLead["disqualificationReason"]>;
type LeadFields = Parameters<typeof createAdminLead>[0];

const LEAD_PAGE_SIZE = 25;

const sourceLabel: Record<LeadSource, string> = {
  WEBSITE: "Website",
  PHONE: "Telefone",
  EMAIL: "Email",
  REFERRAL: "Recomendação",
  WALK_IN: "Presencial",
  OTHER: "Outra origem",
};
const sourceOptions = Object.keys(sourceLabel) as LeadSource[];

const stateLabel: Record<LeadState, string> = {
  OPEN: "Aberta",
  QUALIFIED: "Qualificada",
  DISQUALIFIED: "Desqualificada",
};

const stateTone: Record<LeadState, string> = {
  OPEN: " state-pill--warning",
  QUALIFIED: " state-pill--positive",
  DISQUALIFIED: " state-pill--negative",
};

const filterLabel: Record<LeadState, string> = {
  OPEN: "Abertas",
  QUALIFIED: "Qualificadas",
  DISQUALIFIED: "Desqualificadas",
};
const filterOptions: readonly LeadState[] = ["OPEN", "QUALIFIED", "DISQUALIFIED"];

const reasonLabel: Record<DisqualificationReason, string> = {
  NO_RESPONSE: "Sem resposta",
  NOT_INTERESTED: "Sem interesse",
  NOT_SERVICEABLE: "Pedido que a agência não serve",
  DUPLICATE: "Duplicado",
  OTHER: "Outro motivo",
};
const reasonOptions = Object.keys(reasonLabel) as DisqualificationReason[];

export const LEAD_CONFLICT_MESSAGE =
  "Este lead foi alterado por outra pessoa — recarregue. As suas alterações não foram guardadas.";

const instantFormatter = new Intl.DateTimeFormat("pt-PT", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const formatInstant = (instant: string): string =>
  `${instantFormatter.format(new Date(instant))} UTC`;

const leadName = (lead: Pick<AdminLead, "contactGivenName" | "contactFamilyName">): string =>
  `${lead.contactGivenName} ${lead.contactFamilyName}`;

const textValue = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const nullableValue = (formData: FormData, name: string): string | null =>
  textValue(formData, name) || null;

const isAuthenticationRequired = (error: unknown): boolean =>
  error instanceof AdminApiError && error.code === "AUTHENTICATION_REQUIRED";

const isConflict = (error: unknown): boolean =>
  error instanceof AdminApiError && error.code === "CONFLICT";

/** A network or availability failure may have been processed; the same idempotency key is retried. */
const isRetryableFailure = (error: unknown): boolean =>
  error instanceof AdminApiError &&
  (error.code === "NETWORK_FAILURE" || error.code === "UNAVAILABLE");

const leadErrorMessage = (error: unknown): string => {
  if (!(error instanceof AdminApiError)) return "Ocorreu um erro. Tente novamente.";
  switch (error.code) {
    case "AUTHENTICATION_REQUIRED":
      return error.message;
    case "ACCESS_DENIED":
      return "Não tem permissão para esta operação sobre leads.";
    case "NOT_FOUND":
      return "O lead ou o cliente indicado não está disponível nesta agência.";
    case "CONFLICT":
      return LEAD_CONFLICT_MESSAGE;
    case "INVALID_REQUEST":
      return "Verifique os dados indicados e tente novamente.";
    case "UNAVAILABLE":
      return "O serviço está temporariamente indisponível.";
    case "NETWORK_FAILURE":
      return "Não foi possível contactar o serviço.";
    default:
      return "Não foi possível validar os dados recebidos.";
  }
};

type InputFieldProps = {
  readonly id: string;
  readonly label: string;
} & InputHTMLAttributes<HTMLInputElement>;
type TextAreaFieldProps = {
  readonly id: string;
  readonly label: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>;

function InputField({ id, label, ...inputProps }: InputFieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} {...inputProps} />
    </div>
  );
}

function TextAreaField({ id, label, ...inputProps }: TextAreaFieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} {...inputProps} />
    </div>
  );
}

function LeadFieldset({
  idPrefix,
  initial,
}: {
  readonly idPrefix: string;
  readonly initial: LeadFields | null;
}) {
  return (
    <div className="admin-form__grid">
      <div className="field">
        <label htmlFor={`${idPrefix}-source`}>Origem</label>
        <select
          id={`${idPrefix}-source`}
          name="source"
          required
          defaultValue={initial?.source ?? "PHONE"}
        >
          {sourceOptions.map((source) => (
            <option key={source} value={source}>
              {sourceLabel[source]}
            </option>
          ))}
        </select>
      </div>
      <InputField
        id={`${idPrefix}-given-name`}
        name="contactGivenName"
        label="Nome próprio do contacto"
        required
        maxLength={200}
        autoComplete="off"
        defaultValue={initial?.contactGivenName ?? ""}
      />
      <InputField
        id={`${idPrefix}-family-name`}
        name="contactFamilyName"
        label="Apelido do contacto"
        required
        maxLength={200}
        autoComplete="off"
        defaultValue={initial?.contactFamilyName ?? ""}
      />
      <InputField
        id={`${idPrefix}-email`}
        name="contactEmail"
        label="Email do contacto"
        type="email"
        maxLength={320}
        autoComplete="off"
        defaultValue={initial?.contactEmail ?? ""}
      />
      <InputField
        id={`${idPrefix}-phone`}
        name="contactPhone"
        label="Telefone do contacto"
        type="tel"
        maxLength={40}
        pattern="[0-9 +()\-]+"
        title="Apenas algarismos, espaços e os símbolos + ( ) -"
        autoComplete="off"
        defaultValue={initial?.contactPhone ?? ""}
      />
      <TextAreaField
        id={`${idPrefix}-note`}
        name="internalNote"
        label="Nota interna (visível só para a equipa)"
        rows={3}
        maxLength={4000}
        defaultValue={initial?.internalNote ?? ""}
      />
    </div>
  );
}

const readLeadFields = (formData: FormData): LeadFields => ({
  source: textValue(formData, "source") as LeadSource,
  contactGivenName: textValue(formData, "contactGivenName"),
  contactFamilyName: textValue(formData, "contactFamilyName"),
  contactEmail: nullableValue(formData, "contactEmail"),
  contactPhone: nullableValue(formData, "contactPhone"),
  internalNote: nullableValue(formData, "internalNote"),
});

function LeadStatePill({ state }: { readonly state: LeadState }) {
  return <span className={`state-pill${stateTone[state]}`}>{stateLabel[state]}</span>;
}

function LeadCreateForm({
  onCreated,
  onAuthenticationRequired,
}: {
  readonly onCreated: (lead: AdminLead) => void;
  readonly onAuthenticationRequired: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const fields = readLeadFields(new FormData(event.currentTarget));
    idempotencyKey.current ??= createIdempotencyKey();
    setBusy(true);
    setErrorMessage(null);
    try {
      const lead = await createAdminLead(fields, idempotencyKey.current);
      idempotencyKey.current = null;
      onCreated(lead);
    } catch (error) {
      if (isAuthenticationRequired(error)) onAuthenticationRequired();
      if (!isRetryableFailure(error)) idempotencyKey.current = null;
      setErrorMessage(leadErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-create-trip" aria-labelledby="lead-create-heading">
      <div className="admin-workflow__actions">
        <button
          className="button button--primary"
          type="button"
          aria-expanded={open}
          aria-controls="lead-create-form"
          onClick={() => {
            setOpen((current) => !current);
            setErrorMessage(null);
          }}
        >
          {open ? "Cancelar" : "Novo lead"}
        </button>
      </div>
      {open ? (
        <form
          id="lead-create-form"
          className="admin-form"
          aria-labelledby="lead-create-heading"
          aria-busy={busy}
          onSubmit={(event) => void submit(event)}
        >
          <div>
            <h2 id="lead-create-heading">Novo lead</h2>
            <p className="admin-form__hint">
              Regista um interesse comercial ainda não qualificado. Não cria cliente nem viagem.
            </p>
          </div>
          <LeadFieldset idPrefix="lead-create" initial={null} />
          {errorMessage ? (
            <p className="admin-form__message" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <div className="admin-form__actions">
            <button className="button button--primary" type="submit" disabled={busy}>
              {busy ? "A guardar…" : "Guardar lead"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

type LeadListState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly items: readonly AdminLead[];
      readonly nextCursor: string | null;
      readonly loadingMore: boolean;
      readonly loadMoreError: string | null;
    };

function LeadList({ onAuthenticationRequired }: { readonly onAuthenticationRequired: () => void }) {
  const [filter, setFilter] = useState<LeadState>("OPEN");
  const [list, setList] = useState<LeadListState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let current = true;
    setList({ kind: "loading" });
    void listAdminLeads({ limit: LEAD_PAGE_SIZE, cursor: null, state: filter }).then(
      (page) => {
        if (current) {
          setList({
            kind: "ready",
            items: page.items,
            nextCursor: page.nextCursor,
            loadingMore: false,
            loadMoreError: null,
          });
        }
      },
      (error: unknown) => {
        if (!current) return;
        if (isAuthenticationRequired(error)) onAuthenticationRequired();
        setList(
          error instanceof AdminApiError && error.code === "ACCESS_DENIED"
            ? { kind: "denied" }
            : { kind: "error", message: leadErrorMessage(error) },
        );
      },
    );
    return () => {
      current = false;
    };
  }, [filter, onAuthenticationRequired, reloadKey]);

  const loadMore = async (): Promise<void> => {
    if (list.kind !== "ready" || list.nextCursor === null || list.loadingMore) return;
    const cursor = list.nextCursor;
    setList({ ...list, loadingMore: true, loadMoreError: null });
    try {
      const page = await listAdminLeads({ limit: LEAD_PAGE_SIZE, cursor, state: filter });
      setList((current) => {
        if (current.kind !== "ready") return current;
        const known = new Set(current.items.map((item) => item.id));
        return {
          ...current,
          items: [...current.items, ...page.items.filter((item) => !known.has(item.id))],
          nextCursor: page.nextCursor,
          loadingMore: false,
          loadMoreError: null,
        };
      });
    } catch (error) {
      if (isAuthenticationRequired(error)) onAuthenticationRequired();
      setList((current) =>
        current.kind === "ready"
          ? { ...current, loadingMore: false, loadMoreError: leadErrorMessage(error) }
          : current,
      );
    }
  };

  return (
    <>
      <header className="page-heading">
        <div>
          <h1>Leads</h1>
          <p>Interesses comerciais por qualificar, qualificados em clientes ou desqualificados.</p>
        </div>
      </header>
      <LeadCreateForm
        onCreated={(lead) => {
          window.location.hash = `#/leads/${encodeURIComponent(lead.id)}`;
        }}
        onAuthenticationRequired={onAuthenticationRequired}
      />
      <div className="lead-filter" role="group" aria-label="Filtrar leads por estado">
        {filterOptions.map((option) => (
          <button
            key={option}
            className={`button ${filter === option ? "button--primary" : "button--secondary"}`}
            type="button"
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
          >
            {filterLabel[option]}
          </button>
        ))}
      </div>
      <section aria-labelledby="lead-list-heading" aria-busy={list.kind === "loading"}>
        <div className="section-heading">
          <h2 id="lead-list-heading">{filterLabel[filter]}</h2>
          {list.kind === "ready" ? (
            <span className="section-heading__meta">{list.items.length} nesta página</span>
          ) : null}
        </div>
        {list.kind === "loading" ? (
          <p className="state-message" role="status" aria-live="polite">
            A carregar leads…
          </p>
        ) : list.kind === "denied" ? (
          <p className="state-message state-message--error" role="alert">
            Não tem permissão para consultar os leads desta agência.
          </p>
        ) : list.kind === "error" ? (
          <div className="state-message state-message--error" role="alert">
            <p>{list.message}</p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              Tentar novamente
            </button>
          </div>
        ) : list.items.length === 0 ? (
          <p className="state-message">Não existem leads neste estado.</p>
        ) : (
          <>
            <ul className="lead-list" aria-label={`Leads: ${filterLabel[filter]}`}>
              {list.items.map((lead) => (
                <li className="lead-row" key={lead.id}>
                  <div className="lead-row__identity">
                    <a
                      className="lead-row__title"
                      href={`#/leads/${encodeURIComponent(lead.id)}`}
                      aria-label={`Abrir lead: ${leadName(lead)}`}
                    >
                      {leadName(lead)}
                    </a>
                    <p className="lead-row__meta">{sourceLabel[lead.source]}</p>
                  </div>
                  <p className="lead-row__date">
                    <time dateTime={lead.createdAt}>{formatInstant(lead.createdAt)}</time>
                  </p>
                  <LeadStatePill state={lead.state} />
                </li>
              ))}
            </ul>
            {list.loadMoreError ? (
              <p className="admin-form__message" role="alert">
                {list.loadMoreError}
              </p>
            ) : null}
            {list.nextCursor !== null ? (
              <div className="state-message__actions">
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={list.loadingMore}
                  aria-busy={list.loadingMore}
                >
                  {list.loadingMore ? "A carregar…" : "Carregar mais"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}

type LeadDetailState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "not-found" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly lead: AdminLead };

type LeadPanel = "none" | "qualify" | "disqualify";
type QualifyMode = "CREATE_CUSTOMER" | "LINK_CUSTOMER";

function LeadSummary({ lead }: { readonly lead: AdminLead }) {
  const facts: readonly (readonly [string, string | null])[] = [
    ["Origem", sourceLabel[lead.source]],
    ["Email", lead.contactEmail],
    ["Telefone", lead.contactPhone],
    ["Registado em", formatInstant(lead.createdAt)],
    ["Fechado em", lead.closedAt === null ? null : formatInstant(lead.closedAt)],
    [
      "Motivo de desqualificação",
      lead.disqualificationReason === null ? null : reasonLabel[lead.disqualificationReason],
    ],
    ["Cliente associado (identificador)", lead.qualifiedCustomerId],
    ["Nota interna", lead.internalNote],
  ];
  return (
    <dl className="lead-facts">
      {facts
        .filter((fact): fact is readonly [string, string] => fact[1] !== null && fact[1] !== "")
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function LeadDetail({
  leadId,
  onAuthenticationRequired,
}: {
  readonly leadId: string;
  readonly onAuthenticationRequired: () => void;
}) {
  const [detail, setDetail] = useState<LeadDetailState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [panel, setPanel] = useState<LeadPanel>("none");
  const [qualifyMode, setQualifyMode] = useState<QualifyMode>("CREATE_CUSTOMER");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const qualifyKey = useRef<string | null>(null);
  const disqualifyKey = useRef<string | null>(null);

  useEffect(() => {
    let current = true;
    setDetail({ kind: "loading" });
    void getAdminLead(leadId).then(
      (lead) => {
        if (current) setDetail({ kind: "ready", lead });
      },
      (error: unknown) => {
        if (!current) return;
        if (isAuthenticationRequired(error)) onAuthenticationRequired();
        if (error instanceof AdminApiError && error.code === "ACCESS_DENIED") {
          setDetail({ kind: "denied" });
        } else if (error instanceof AdminApiError && error.code === "NOT_FOUND") {
          setDetail({ kind: "not-found" });
        } else {
          setDetail({ kind: "error", message: leadErrorMessage(error) });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [leadId, onAuthenticationRequired, reloadKey]);

  const reload = useCallback((): void => {
    setConflict(false);
    setFeedback(null);
    setSuccess(null);
    setPanel("none");
    qualifyKey.current = null;
    disqualifyKey.current = null;
    setReloadKey((key) => key + 1);
  }, []);

  /** Runs one command; a 409 never overwrites local input, it asks the person to reload. */
  const runCommand = async (
    work: () => Promise<AdminLead>,
    successMessage: string,
    key: { current: string | null },
  ): Promise<void> => {
    setBusy(true);
    setFeedback(null);
    setSuccess(null);
    setConflict(false);
    try {
      const lead = await work();
      key.current = null;
      setDetail({ kind: "ready", lead });
      setPanel("none");
      setSuccess(successMessage);
    } catch (error) {
      if (isAuthenticationRequired(error)) onAuthenticationRequired();
      if (!isRetryableFailure(error)) key.current = null;
      if (isConflict(error)) setConflict(true);
      else setFeedback(leadErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (detail.kind === "loading") {
    return (
      <p className="state-message" role="status" aria-live="polite">
        A carregar o lead…
      </p>
    );
  }
  if (detail.kind === "denied") {
    return (
      <section className="state-message state-message--error" aria-labelledby="lead-denied-title">
        <h1 id="lead-denied-title">Acesso não autorizado</h1>
        <p>Não tem permissão para consultar este lead.</p>
      </section>
    );
  }
  if (detail.kind === "not-found") {
    return (
      <section className="state-message" aria-labelledby="lead-not-found-title">
        <h1 id="lead-not-found-title">Lead não encontrado</h1>
        <p>Este lead não está disponível nesta agência.</p>
        <a className="detail-back" href="#/leads">
          ← Voltar aos leads
        </a>
      </section>
    );
  }
  if (detail.kind === "error") {
    return (
      <div className="state-message state-message--error" role="alert">
        <p>{detail.message}</p>
        <button className="button button--secondary" type="button" onClick={reload}>
          Tentar novamente
        </button>
      </div>
    );
  }

  const lead = detail.lead;
  const isOpen = lead.state === "OPEN";

  const saveChanges = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const fields = readLeadFields(new FormData(event.currentTarget));
    await runCommand(
      () => updateAdminLead(lead.id, { expectedLockVersion: lead.lockVersion, ...fields }),
      "Alterações guardadas.",
      { current: null },
    );
  };

  const confirmQualification = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    qualifyKey.current ??= createIdempotencyKey();
    const displayName = textValue(formData, "customerDisplayName");
    const body =
      qualifyMode === "CREATE_CUSTOMER"
        ? ({
            expectedLockVersion: lead.lockVersion,
            mode: "CREATE_CUSTOMER",
            ...(displayName === "" ? {} : { customerDisplayName: displayName }),
          } as const)
        : ({
            expectedLockVersion: lead.lockVersion,
            mode: "LINK_CUSTOMER",
            customerId: textValue(formData, "customerId"),
          } as const);
    await runCommand(
      () => qualifyAdminLead(lead.id, body, qualifyKey.current ?? createIdempotencyKey()),
      qualifyMode === "CREATE_CUSTOMER"
        ? "Lead qualificado: foi criado um novo cliente."
        : "Lead qualificado e associado ao cliente existente.",
      qualifyKey,
    );
  };

  const confirmDisqualification = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    disqualifyKey.current ??= createIdempotencyKey();
    const reason = textValue(formData, "reason") as DisqualificationReason;
    await runCommand(
      () =>
        disqualifyAdminLead(
          lead.id,
          { expectedLockVersion: lead.lockVersion, reason },
          disqualifyKey.current ?? createIdempotencyKey(),
        ),
      "Lead desqualificado.",
      disqualifyKey,
    );
  };

  return (
    <>
      <a className="detail-back" href="#/leads">
        ← Voltar aos leads
      </a>
      <header className="page-heading">
        <div>
          <h1>{leadName(lead)}</h1>
          <p>Lead · os dados de contacto e a nota interna são visíveis apenas à equipa.</p>
        </div>
        <LeadStatePill state={lead.state} />
      </header>
      {success ? (
        <p className="admin-form__success" role="status">
          {success}
        </p>
      ) : null}
      {conflict ? (
        <div className="state-message state-message--error" role="alert">
          <p>{LEAD_CONFLICT_MESSAGE}</p>
          <button className="button button--secondary" type="button" onClick={reload}>
            Recarregar lead
          </button>
        </div>
      ) : null}
      {feedback ? (
        <p className="admin-form__message" role="alert">
          {feedback}
        </p>
      ) : null}
      <LeadSummary lead={lead} />
      {isOpen ? (
        <>
          <div className="admin-workflow__actions lead-actions">
            <button
              className="button button--primary"
              type="button"
              aria-expanded={panel === "qualify"}
              aria-controls="lead-qualify-form"
              disabled={busy}
              onClick={() => setPanel(panel === "qualify" ? "none" : "qualify")}
            >
              Qualificar
            </button>
            <button
              className="button button--secondary"
              type="button"
              aria-expanded={panel === "disqualify"}
              aria-controls="lead-disqualify-form"
              disabled={busy}
              onClick={() => setPanel(panel === "disqualify" ? "none" : "disqualify")}
            >
              Desqualificar
            </button>
          </div>
          {panel === "qualify" ? (
            <form
              id="lead-qualify-form"
              className="admin-form"
              aria-labelledby="lead-qualify-heading"
              aria-busy={busy}
              onSubmit={(event) => void confirmQualification(event)}
            >
              <div>
                <h2 id="lead-qualify-heading">Qualificar lead</h2>
                <p className="admin-form__hint">
                  A qualificação é definitiva. O email nunca associa automaticamente um cliente
                  existente.
                </p>
              </div>
              <fieldset className="admin-form__fieldset">
                <legend>Cliente</legend>
                <div className="lead-radio">
                  <input
                    id="lead-qualify-mode-create"
                    type="radio"
                    name="qualifyMode"
                    value="CREATE_CUSTOMER"
                    checked={qualifyMode === "CREATE_CUSTOMER"}
                    onChange={() => setQualifyMode("CREATE_CUSTOMER")}
                  />
                  <label htmlFor="lead-qualify-mode-create">Criar cliente novo</label>
                </div>
                <div className="lead-radio">
                  <input
                    id="lead-qualify-mode-link"
                    type="radio"
                    name="qualifyMode"
                    value="LINK_CUSTOMER"
                    checked={qualifyMode === "LINK_CUSTOMER"}
                    onChange={() => setQualifyMode("LINK_CUSTOMER")}
                  />
                  <label htmlFor="lead-qualify-mode-link">Associar a cliente existente</label>
                </div>
              </fieldset>
              {qualifyMode === "CREATE_CUSTOMER" ? (
                <InputField
                  id="lead-qualify-display-name"
                  name="customerDisplayName"
                  label="Nome do cliente (opcional)"
                  maxLength={300}
                  placeholder={leadName(lead)}
                  autoComplete="off"
                />
              ) : (
                <InputField
                  id="lead-qualify-customer-id"
                  name="customerId"
                  label="Identificador do cliente existente"
                  required
                  maxLength={36}
                  spellCheck={false}
                  autoComplete="off"
                />
              )}
              <div className="admin-form__actions">
                <button className="button button--primary" type="submit" disabled={busy}>
                  {busy ? "A qualificar…" : "Confirmar qualificação"}
                </button>
              </div>
            </form>
          ) : null}
          {panel === "disqualify" ? (
            <form
              id="lead-disqualify-form"
              className="admin-form"
              aria-labelledby="lead-disqualify-heading"
              aria-busy={busy}
              onSubmit={(event) => void confirmDisqualification(event)}
            >
              <div>
                <h2 id="lead-disqualify-heading">Desqualificar lead</h2>
                <p className="admin-form__hint">
                  O lead é mantido com o motivo indicado e deixa de poder ser alterado.
                </p>
              </div>
              <div className="field">
                <label htmlFor="lead-disqualify-reason">Motivo</label>
                <select id="lead-disqualify-reason" name="reason" required defaultValue="">
                  <option value="" disabled>
                    Selecione um motivo
                  </option>
                  {reasonOptions.map((reason) => (
                    <option key={reason} value={reason}>
                      {reasonLabel[reason]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="admin-form__actions">
                <button className="button button--primary" type="submit" disabled={busy}>
                  {busy ? "A desqualificar…" : "Confirmar desqualificação"}
                </button>
              </div>
            </form>
          ) : null}
          <form
            key={lead.lockVersion}
            className="admin-form"
            aria-labelledby="lead-edit-heading"
            aria-busy={busy}
            onSubmit={(event) => void saveChanges(event)}
          >
            <div>
              <h2 id="lead-edit-heading">Editar lead</h2>
              <p className="admin-form__hint">
                Só é possível editar leads abertos. Se outra pessoa os alterar entretanto, não há
                sobreposição silenciosa.
              </p>
            </div>
            <LeadFieldset idPrefix="lead-edit" initial={lead} />
            <div className="admin-form__actions">
              <button className="button button--primary" type="submit" disabled={busy}>
                {busy ? "A guardar…" : "Guardar alterações"}
              </button>
            </div>
          </form>
        </>
      ) : (
        <p className="state-message">
          Este lead está {stateLabel[lead.state].toLowerCase()} e já não pode ser alterado.
        </p>
      )}
    </>
  );
}

export function LeadsView({
  leadId,
  onAuthenticationRequired,
}: {
  readonly leadId: string | null;
  readonly onAuthenticationRequired: () => void;
}) {
  return leadId === null ? (
    <LeadList onAuthenticationRequired={onAuthenticationRequired} />
  ) : (
    <LeadDetail leadId={leadId} onAuthenticationRequired={onAuthenticationRequired} />
  );
}
