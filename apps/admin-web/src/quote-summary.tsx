import {
  Button,
  CheckboxField,
  Dialog,
  Select,
  StateMessage,
  formatMoney,
} from "@travelos/design-system";
import { useState } from "react";

import { DraftField } from "./quote-fields.js";
import {
  bpToPercentText,
  decimalToMinor,
  formatBp,
  minorToDecimal,
  percentToBp,
  sumMinor,
  warningText,
} from "./quote-format.js";
import type { HeaderPatch, QuoteDetail } from "./quote-format.js";
import { formatDate } from "./format.js";

type Rounding = "CENT" | "EURO" | "TEN_EUROS";

const ROUNDING_LABELS: Record<Rounding, string> = {
  CENT: "ao cêntimo",
  EURO: "ao euro",
  TEN_EUROS: "à dezena de euros",
};

const ROUNDING_OPTION: Record<Rounding, string> = {
  CENT: "Ao cêntimo",
  EURO: "Ao euro",
  TEN_EUROS: "À dezena de euros",
};

export interface QuoteSummaryProps {
  readonly detail: QuoteDetail;
  readonly editable: boolean;
  readonly onPatchHeader: (patch: HeaderPatch) => void;
  readonly onApplyMargin: (rounding: Rounding) => void;
  readonly onFocusLine: (lineId: string) => void;
}

export function QuoteSummary({
  detail,
  editable,
  onPatchHeader,
  onApplyMargin,
  onFocusLine,
}: QuoteSummaryProps) {
  const { quote, totals, warnings } = detail;
  const [open, setOpen] = useState(false);
  const [rounding, setRounding] = useState<Rounding>("EURO");
  const [confirming, setConfirming] = useState(false);
  const [targetError, setTargetError] = useState<string | undefined>();
  const currency = quote.currencyCode;
  const money = (minor: string): string => formatMoney(minorToDecimal(minor, currency), currency);
  const overridden = quote.pvpOverrideMinor !== null;
  const optionsTotal = sumMinor(totals.optionsPvp.map((entry) => entry.pvpMinor));
  const row = (label: string, value: string, extra?: string) => (
    <div className="q-sum__row" key={label}>
      <dt>{label}</dt>
      <dd>
        {value}
        {extra === undefined ? null : <span className="q-sum__extra">{extra}</span>}
      </dd>
    </div>
  );

  return (
    <aside className="q-summary" aria-label="Resumo de preço">
      <button
        type="button"
        className="q-summary__toggle"
        aria-expanded={open}
        aria-controls="q-summary-body"
        onClick={() => setOpen(!open)}
      >
        <span>PVP final</span>
        <strong>{money(totals.pvpFinalMinor)}</strong>
        <span className="q-summary__chevron" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      <div className="q-summary__body" id="q-summary-body" data-open={open ? "true" : "false"}>
        <div className="q-summary__price">
          <span className="q-summary__label">PVP final</span>
          <strong className="q-summary__pvp">{money(totals.pvpFinalMinor)}</strong>
          <span className="q-summary__per">
            {money(totals.perPersonMinor)} por pessoa ({quote.adults + quote.children})
          </span>
          <CheckboxField
            label="Fixar manualmente"
            hint={
              overridden
                ? undefined
                : `Soma automática das linhas: ${money(totals.baseLinesPvpMinor)}`
            }
            checked={overridden}
            disabled={!editable}
            onChange={(event) =>
              onPatchHeader({
                pvpOverrideMinor: event.target.checked ? totals.pvpFinalMinor : null,
              })
            }
          />
          {overridden ? (
            <DraftField
              money
              currency={currency}
              label="PVP fixado (€)"
              disabled={!editable}
              value={minorToDecimal(quote.pvpOverrideMinor ?? "0", currency)}
              onCommit={(value) =>
                onPatchHeader({ pvpOverrideMinor: decimalToMinor(value, currency) })
              }
            />
          ) : null}
        </div>
        <dl className="q-sum__list">
          {row("NET agência", money(totals.baseAgencyNetMinor))}
          {row("Recomendado", money(totals.baseRecommendedMinor))}
          {row("Lucro", money(totals.profitMinor), formatBp(totals.profitBp))}
          {row(
            "Margem recomendada",
            money(totals.recommendedMarginMinor),
            formatBp(totals.recommendedMarginBp),
          )}
          {row(`Sinal (${bpToPercentText(quote.depositBp)} %)`, money(totals.depositMinor))}
          {row(
            "Saldo",
            money(totals.balanceMinor),
            totals.balanceDueNow
              ? "a pagar já"
              : totals.balanceDueDate === null
                ? undefined
                : `até ${formatDate(totals.balanceDueDate)}`,
          )}
          {row("Opções (à parte)", money(optionsTotal))}
        </dl>
        <div className="q-sum__margin">
          <DraftField
            label="Margem alvo (%)"
            disabled={!editable}
            error={targetError}
            value={bpToPercentText(quote.targetMarginBp)}
            onCommit={(value) => {
              const bp = percentToBp(value);
              if (bp === null || bp > 9000) {
                setTargetError("Indique uma percentagem entre 0 e 90.");
                return;
              }
              setTargetError(undefined);
              onPatchHeader({ targetMarginBp: bp });
            }}
          />
          <Select
            label="Arredondar PVP"
            value={rounding}
            disabled={!editable}
            onChange={(event) => setRounding(event.target.value as Rounding)}
          >
            {(Object.keys(ROUNDING_LABELS) as Rounding[]).map((key) => (
              <option key={key} value={key}>
                {ROUNDING_OPTION[key]}
              </option>
            ))}
          </Select>
          <Button disabled={!editable} onClick={() => setConfirming(true)}>
            Aplicar margem alvo
          </Button>
        </div>
        <details className="q-sum__terms">
          <summary>Condições de pagamento</summary>
          <DraftField
            label="Sinal (%)"
            disabled={!editable}
            value={bpToPercentText(quote.depositBp)}
            onCommit={(value) => {
              const bp = percentToBp(value);
              if (bp !== null && bp <= 10_000) onPatchHeader({ depositBp: bp });
            }}
          />
          <DraftField
            label="Saldo (dias antes da partida)"
            disabled={!editable}
            value={String(quote.balanceDueDays)}
            onCommit={(value) => {
              const days = Number.parseInt(value, 10);
              if (days >= 0 && days <= 365) onPatchHeader({ balanceDueDays: days });
            }}
          />
        </details>
        <section className="q-sum__warnings" aria-label="Avisos">
          {warnings.length === 0 ? (
            <StateMessage tone="success" role="status">
              Sem avisos.
            </StateMessage>
          ) : (
            <>
              <h3>Avisos ({warnings.length})</h3>
              <ul>
                {warnings.map((warning, index) => (
                  <li key={`${warning.code}-${warning.lineId ?? index}`}>
                    {warning.lineId === undefined ? (
                      warningText(warning.code)
                    ) : (
                      <button type="button" onClick={() => onFocusLine(warning.lineId as string)}>
                        {warningText(warning.code)}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
      <Dialog
        open={confirming}
        title="Aplicar margem alvo?"
        description={`Os PVP de todas as linhas da proposta serão recalculados para uma margem de ${bpToPercentText(quote.targetMarginBp)} %, arredondados ${ROUNDING_LABELS[rounding]}. Os valores atuais serão substituídos.`}
        confirmLabel="Aplicar margem"
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onApplyMargin(rounding);
        }}
      />
    </aside>
  );
}
