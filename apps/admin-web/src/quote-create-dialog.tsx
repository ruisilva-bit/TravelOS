import { Dialog, StateMessage, TextField } from "@travelos/design-system";
import { useEffect, useState } from "react";

import { AdminApiError, createAdminQuote, listAdminLeads } from "./api.js";
import { crmErrorMessage, isAuthenticationRequired } from "./crm-shared.js";

export interface LeadChoice {
  readonly id: string;
  readonly name: string;
  readonly detail?: string | undefined;
}

export const QUOTE_LEAD_NOT_QUALIFIED_MESSAGE =
  "Não foi possível criar o orçamento. Confirme que a lead está qualificada e ligada a um cliente.";

export interface QuoteCreateDialogProps {
  /** Leads to choose from. When absent, qualified leads are loaded. */
  readonly leads?: readonly LeadChoice[];
  /** Pre-selected lead (opened from a lead or customer page). */
  readonly presetLeadId?: string;
  readonly onClose: () => void;
  readonly onAuthenticationRequired: () => void;
}

/** "Novo orçamento": pick the lead (a quote always belongs to a lead and its customer) and open the editor. */
export function QuoteCreateDialog({
  leads,
  presetLeadId,
  onClose,
  onAuthenticationRequired,
}: QuoteCreateDialogProps) {
  const [choices, setChoices] = useState<readonly LeadChoice[] | null>(leads ?? null);
  const [selected, setSelected] = useState<string | null>(presetLeadId ?? null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (leads !== undefined || presetLeadId !== undefined) return;
    let current = true;
    void listAdminLeads({ limit: 50, cursor: null, state: "QUALIFIED" }).then(
      (page) => {
        if (!current) return;
        setChoices(
          page.items.map((lead) => ({
            id: lead.id,
            name: `${lead.contactGivenName} ${lead.contactFamilyName}`.trim(),
            detail: lead.contactEmail ?? lead.contactPhone ?? undefined,
          })),
        );
      },
      (failure: unknown) => {
        if (!current) return;
        if (isAuthenticationRequired(failure)) onAuthenticationRequired();
        setChoices([]);
        setError(crmErrorMessage(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [leads, presetLeadId, onAuthenticationRequired]);

  const needle = search.trim().toLowerCase();
  const visible = (choices ?? []).filter(
    (lead) => needle === "" || lead.name.toLowerCase().includes(needle),
  );

  const create = async (): Promise<void> => {
    if (selected === null) {
      setError("Escolha uma lead para continuar.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const quote = await createAdminQuote({ leadId: selected });
      window.location.hash = `#/orcamentos/${encodeURIComponent(quote.id)}`;
      onClose();
    } catch (failure) {
      if (isAuthenticationRequired(failure)) onAuthenticationRequired();
      setError(
        failure instanceof AdminApiError &&
          (failure.code === "CONFLICT" || failure.code === "INVALID_REQUEST")
          ? QUOTE_LEAD_NOT_QUALIFIED_MESSAGE
          : crmErrorMessage(failure),
      );
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title="Novo orçamento"
      description="O orçamento fica ligado a uma lead e ao respetivo cliente. Título, datas e viajantes são herdados quando existem."
      confirmLabel="Criar orçamento"
      busy={busy}
      onClose={onClose}
      onConfirm={() => void create()}
    >
      {error === null ? null : (
        <StateMessage tone="error" role="alert">
          {error}
        </StateMessage>
      )}
      {presetLeadId !== undefined && leads === undefined ? (
        <p>Será criado um orçamento para esta lead.</p>
      ) : choices === null ? (
        <StateMessage role="status">A carregar leads…</StateMessage>
      ) : (
        <div className="q-leadpicker">
          {choices.length > 6 ? (
            <TextField
              label="Procurar lead"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          ) : null}
          {visible.length === 0 ? (
            <p className="q-leadpicker__empty">
              {choices.length === 0
                ? "Não há leads qualificadas. Qualifique uma lead para criar um orçamento."
                : "Nenhuma lead corresponde à pesquisa."}
            </p>
          ) : (
            <ul aria-label="Leads">
              {visible.map((lead) => (
                <li key={lead.id}>
                  <button
                    type="button"
                    aria-pressed={selected === lead.id}
                    onClick={() => setSelected(lead.id)}
                  >
                    <span>{lead.name}</span>
                    {lead.detail === undefined ? null : <small>{lead.detail}</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}
