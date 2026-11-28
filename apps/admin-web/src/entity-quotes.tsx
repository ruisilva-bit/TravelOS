import { Button, EmptyState, StateMessage, Table } from "@travelos/design-system";
import type { AdminQuoteV1Response } from "@travelos/contracts/admin";
import { useEffect, useState } from "react";

import { listAdminLeadQuotes, listAdminQuotes } from "./api.js";
import { crmErrorMessage, isAuthenticationRequired } from "./crm-shared.js";
import { QuoteCreateDialog } from "./quote-create-dialog.js";
import type { LeadChoice } from "./quote-create-dialog.js";
import { quoteColumns } from "./quotes-list.js";

type Quotes = readonly AdminQuoteV1Response[];

const COLUMNS = quoteColumns.filter((column) =>
  ["number", "title", "state", "valid"].includes(column.key),
);

/** "Orçamentos" of one lead (`leadId`) or one customer (`customerId`, leads to choose from in `leads`). */
export function EntityQuotes({
  leadId,
  customerId,
  leads,
  canCreate = true,
  blockedReason,
  onAuthenticationRequired,
}: {
  readonly leadId?: string;
  readonly customerId?: string;
  readonly leads?: readonly LeadChoice[];
  readonly canCreate?: boolean;
  readonly blockedReason?: string;
  readonly onAuthenticationRequired: () => void;
}) {
  const [quotes, setQuotes] = useState<Quotes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let current = true;
    setError(null);
    const request =
      leadId !== undefined
        ? listAdminLeadQuotes(leadId)
        : listAdminQuotes({ customerId: customerId ?? "", limit: 50 });
    void request.then(
      (page) => current && setQuotes(page.items),
      (failure: unknown) => {
        if (!current) return;
        if (isAuthenticationRequired(failure)) onAuthenticationRequired();
        setError(crmErrorMessage(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [leadId, customerId, reloadKey, onAuthenticationRequired]);

  const create = (
    <Button variant="primary" disabled={!canCreate} onClick={() => setCreating(true)}>
      Novo orçamento
    </Button>
  );
  return (
    <section className="q-entity" aria-label="Orçamentos">
      <div className="q-entity__bar">
        {create}
        {!canCreate && blockedReason !== undefined ? <span>{blockedReason}</span> : null}
      </div>
      {error === null ? null : (
        <StateMessage
          tone="error"
          role="alert"
          action={<Button onClick={() => setReloadKey((key) => key + 1)}>Tentar novamente</Button>}
        >
          {error}
        </StateMessage>
      )}
      <Table
        caption="Orçamentos"
        columns={COLUMNS}
        rows={quotes ?? []}
        getRowKey={(quote) => quote.id}
        loading={quotes === null && error === null}
        empty={<EmptyState title="Sem orçamentos" description="Ainda não existem orçamentos." />}
      />
      {creating ? (
        <QuoteCreateDialog
          {...(leadId === undefined ? {} : { presetLeadId: leadId })}
          {...(leads === undefined ? {} : { leads })}
          onClose={() => setCreating(false)}
          onAuthenticationRequired={onAuthenticationRequired}
        />
      ) : null}
    </section>
  );
}
