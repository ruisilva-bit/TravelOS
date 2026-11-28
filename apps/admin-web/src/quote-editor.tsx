import {
  Button,
  ButtonLink,
  Dialog,
  EmptyState,
  MenuButton,
  PageHeader,
  StateMessage,
  StatusPill,
  ToastProvider,
} from "@travelos/design-system";
import { useEffect, useRef, useState } from "react";

import {
  AdminApiError,
  addAdminQuoteLine,
  applyAdminQuoteMargin,
  archiveAdminQuote,
  convertAdminQuoteToTrip,
  declineAdminQuote,
  deleteAdminQuoteLine,
  duplicateAdminQuoteLine,
  reorderAdminQuoteLines,
  reviseAdminQuote,
  revokeAdminQuoteShareLink,
  updateAdminQuote,
  updateAdminQuoteLine,
} from "./api.js";
import { crmErrorMessage, isAuthenticationRequired } from "./crm-shared.js";
import { formatDate } from "./format.js";
import { DraftTextArea } from "./quote-fields.js";
import {
  CATEGORY_NEW_SERVICE,
  STATE_LABELS,
  headerToRequest,
  lineToRequest,
} from "./quote-format.js";
import type {
  HeaderPatch,
  QuoteCategory,
  QuoteDetail,
  QuoteLine,
  QuoteSection,
} from "./quote-format.js";
import { QuoteStateBanner } from "./quote-banners.js";
import { QuoteHeader } from "./quote-header.js";
import { applyOrder } from "./quote-order.js";
import type { OrderEntry } from "./quote-order.js";
import { QuoteSendDialog } from "./quote-send-dialog.js";
import { QuoteSheets } from "./quote-sheets.js";
import { QuoteSummary } from "./quote-summary.js";
import { QuoteVersions } from "./quote-versions.js";
import { QUOTE_CONFLICT_MESSAGE, useQuoteEditor } from "./use-quote-editor.js";

type Confirm = "decline" | "archive" | null;

function QuoteEditorBody({
  quoteId,
  onAuthenticationRequired,
}: {
  readonly quoteId: string;
  readonly onAuthenticationRequired: () => void;
}) {
  const editor = useQuoteEditor(quoteId, onAuthenticationRequired);
  const { detail, run, load, saving } = editor;
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [focusRequest, setFocusRequest] = useState<{ lineId: string; nonce: number } | null>(null);
  const [savedOnce, setSavedOnce] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const wasSaving = useRef(false);

  useEffect(() => {
    if (wasSaving.current && !saving && editor.error === null && !editor.conflict)
      setSavedOnce(true);
    wasSaving.current = saving;
  }, [saving, editor.error, editor.conflict]);

  if (load.kind === "loading")
    return <StateMessage role="status">A carregar o orçamento…</StateMessage>;
  if (load.kind === "denied") {
    return (
      <EmptyState
        tone="error"
        headingLevel={1}
        title="Acesso não autorizado"
        description="Não tem permissão para consultar este orçamento."
      />
    );
  }
  if (load.kind === "not-found") {
    return (
      <EmptyState
        headingLevel={1}
        title="Orçamento não encontrado"
        description="Este orçamento não está disponível nesta agência."
        action={<ButtonLink href="#/orcamentos">Ver orçamentos</ButtonLink>}
      />
    );
  }
  if (load.kind === "error" || detail === null) {
    return (
      <StateMessage
        tone="error"
        role="alert"
        action={<Button onClick={() => void editor.reload()}>Tentar novamente</Button>}
      >
        {load.kind === "error" ? load.message : "Não foi possível carregar o orçamento."}
      </StateMessage>
    );
  }

  const { quote } = detail;
  const editable = quote.state === "DRAFT";
  const [stateLabel, stateTone] = STATE_LABELS[quote.state];
  const id = quote.id;

  const patchHeader = (patch: HeaderPatch): void => {
    void run(
      (current) => updateAdminQuote(id, headerToRequest(current, patch)),
      (current) => ({ ...current, quote: { ...current.quote, ...patch } }),
    );
  };

  const patchLine = (line: QuoteLine, patch: Partial<QuoteLine>): void => {
    const cleaned: Partial<QuoteLine> = { ...patch };
    if (patch.category !== undefined) {
      if (patch.category !== "FLIGHT") {
        Object.assign(cleaned, {
          fromIata: null,
          toIata: null,
          departTime: null,
          arriveTime: null,
          carrier: null,
          flightNumber: null,
          baggage: null,
        });
      }
      if (patch.category !== "ACCOMMODATION") {
        Object.assign(cleaned, { roomType: null, boardBasis: null, location: null });
      }
    }
    void run(
      (current) => {
        const latest = current.lines.find((entry) => entry.id === line.id);
        return latest === undefined
          ? Promise.resolve(current)
          : updateAdminQuoteLine(id, line.id, lineToRequest(latest, cleaned));
      },
      (current) => ({
        ...current,
        lines: current.lines.map((entry) =>
          entry.id === line.id ? { ...entry, ...cleaned } : entry,
        ),
      }),
    );
  };

  const focusNew = (before: QuoteDetail, after: QuoteDetail | null): void => {
    if (after === null) return;
    const known = new Set(before.lines.map((entry) => entry.id));
    const created = after.lines.find((entry) => !known.has(entry.id));
    if (created !== undefined) setFocusRequest({ lineId: created.id, nonce: Date.now() });
  };

  const addLine = (section: QuoteSection, category: QuoteCategory): void => {
    const before = detail;
    void run(() =>
      addAdminQuoteLine(id, { section, category, service: CATEGORY_NEW_SERVICE[category] }),
    ).then((after) => focusNew(before, after));
  };

  const duplicate = (line: QuoteLine): void => {
    const before = detail;
    void run(() => duplicateAdminQuoteLine(id, line.id)).then((after) => focusNew(before, after));
  };

  const remove = async (line: QuoteLine): Promise<void> => {
    await run((current) => {
      const latest = current.lines.find((entry) => entry.id === line.id) ?? line;
      return deleteAdminQuoteLine(id, line.id, latest.lockVersion);
    });
  };

  const reorder = (order: OrderEntry[]): void => {
    void run(
      (current) =>
        reorderAdminQuoteLines(id, { expectedLockVersion: current.quote.lockVersion, order }),
      (current) => applyOrder(current, order),
    );
  };

  const attempt = async (work: () => Promise<unknown>): Promise<boolean> => {
    setActionError(null);
    try {
      await work();
      return true;
    } catch (failure) {
      if (isAuthenticationRequired(failure)) onAuthenticationRequired();
      else if (failure instanceof AdminApiError && failure.code === "CONFLICT")
        setActionError(QUOTE_CONFLICT_MESSAGE);
      else setActionError(crmErrorMessage(failure));
      return false;
    }
  };

  const transition = (kind: "decline" | "archive"): void => {
    const work = kind === "decline" ? declineAdminQuote : archiveAdminQuote;
    void run((current) => work(id, { expectedLockVersion: current.quote.lockVersion }));
  };

  const more = [
    ...(quote.state === "SENT"
      ? [{ key: "decline", label: "Marcar como recusado", onSelect: () => setConfirm("decline") }]
      : []),
    ...(quote.state !== "ARCHIVED" && quote.state !== "ACCEPTED"
      ? [{ key: "archive", label: "Arquivar", onSelect: () => setConfirm("archive") }]
      : []),
  ];

  return (
    <>
      <PageHeader
        back={{ href: "#/orcamentos", label: "← Voltar aos orçamentos" }}
        title={`Orçamento ${quote.number}`}
        description={`${quote.customerDisplayName} · válido até ${formatDate(quote.validUntil)}`}
        status={<StatusPill tone={stateTone}>{stateLabel}</StatusPill>}
        actions={
          <>
            <ButtonLink
              href={`/api/admin/quotes/${encodeURIComponent(id)}/preview`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Pré-visualizar proposta
            </ButtonLink>
            {quote.state === "DRAFT" ? (
              <Button variant="primary" onClick={() => setSending(true)}>
                Enviar ao cliente
              </Button>
            ) : null}
            {quote.state === "SENT" ? (
              <Button
                variant="primary"
                onClick={() =>
                  void run((current) =>
                    reviseAdminQuote(id, { expectedLockVersion: current.quote.lockVersion }),
                  )
                }
              >
                Editar (nova versão)
              </Button>
            ) : null}
            {more.length > 0 ? <MenuButton label="Mais ações do orçamento" items={more} /> : null}
          </>
        }
      />
      {editor.conflict ? (
        <StateMessage
          tone="error"
          role="alert"
          action={<Button onClick={() => void editor.reload()}>Recarregar orçamento</Button>}
        >
          {QUOTE_CONFLICT_MESSAGE}
        </StateMessage>
      ) : null}
      {editor.error === null ? null : (
        <StateMessage
          tone="error"
          role="alert"
          action={<Button onClick={() => editor.setError(null)}>Fechar</Button>}
        >
          {editor.error}
        </StateMessage>
      )}
      {actionError === null ? null : (
        <StateMessage tone="error" role="alert">
          {actionError}
        </StateMessage>
      )}
      <QuoteStateBanner
        detail={detail}
        stateLabel={stateLabel}
        onConvert={() =>
          void attempt(async () => {
            const converted = await convertAdminQuoteToTrip(id);
            window.location.hash = `#/viagens/${encodeURIComponent(converted.tripId)}`;
          })
        }
      />
      <QuoteHeader
        detail={detail}
        editable={editable}
        saveStatus={saving ? "A guardar…" : savedOnce ? "Guardado." : ""}
        onPatchHeader={patchHeader}
      />
      <div className="q-layout">
        <div className="q-main">
          <QuoteSheets
            detail={detail}
            editable={editable}
            focusRequest={focusRequest}
            onPatchLine={patchLine}
            onAddLine={addLine}
            onDuplicate={duplicate}
            onDelete={remove}
            onReorder={reorder}
          />
          <section className="q-notes" aria-label="Notas internas">
            <DraftTextArea
              label="Notas internas"
              hint="Visível apenas à agência."
              value={quote.internalNotes ?? ""}
              disabled={!editable}
              maxLength={8000}
              onCommit={(value) =>
                patchHeader({ internalNotes: value.trim() === "" ? null : value.trim() })
              }
            />
          </section>
          <QuoteVersions
            versions={detail.versions}
            onRevoke={async (link) => {
              if (await attempt(() => revokeAdminQuoteShareLink(link.shareLinkId)))
                await editor.reload();
            }}
          />
        </div>
        <QuoteSummary
          detail={detail}
          editable={editable}
          onPatchHeader={patchHeader}
          onApplyMargin={(rounding) =>
            void run(() => applyAdminQuoteMargin(id, { lineIds: null, rounding }))
          }
          onFocusLine={(lineId) => setFocusRequest({ lineId, nonce: Date.now() })}
        />
      </div>
      {sending ? (
        <QuoteSendDialog
          detail={detail}
          onSent={() => void editor.reload()}
          onClose={() => setSending(false)}
          onAuthenticationRequired={onAuthenticationRequired}
        />
      ) : null}
      <Dialog
        open={confirm !== null}
        tone="danger"
        title={confirm === "decline" ? "Marcar como recusado?" : "Arquivar orçamento?"}
        description={
          confirm === "decline"
            ? "O orçamento passa a recusado e os links enviados deixam de aceitar a proposta."
            : "O orçamento sai da lista ativa. Esta ação não se pode desfazer aqui."
        }
        confirmLabel={confirm === "decline" ? "Marcar como recusado" : "Arquivar"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const kind = confirm;
          setConfirm(null);
          if (kind !== null) transition(kind);
        }}
      />
    </>
  );
}

/** `#/orcamentos/:id` */
export function QuoteEditor({
  quoteId,
  onAuthenticationRequired,
}: {
  readonly quoteId: string;
  readonly onAuthenticationRequired: () => void;
}) {
  return (
    <ToastProvider>
      <QuoteEditorBody
        key={quoteId}
        quoteId={quoteId}
        onAuthenticationRequired={onAuthenticationRequired}
      />
    </ToastProvider>
  );
}
