import { CategoryChip, formatMoney } from "@travelos/design-system";

import { formatDate } from "./format.js";
import { imageLines } from "./proposal-content.js";
import { ImageUrlField } from "./proposal-image-field.js";
import { DraftField } from "./quote-fields.js";
import {
  CATEGORY_LABELS,
  bpToPercentText,
  categoryTone,
  minorToDecimal,
  percentToBp,
} from "./quote-format.js";
import type { HeaderPatch, QuoteDetail, QuoteLine } from "./quote-format.js";

/** Imagens: one optional photo per visible line, accommodation and activities first. */
export function ProposalImages({
  detail,
  editable,
  onPatchLine,
}: {
  readonly detail: QuoteDetail;
  readonly editable: boolean;
  readonly onPatchLine: (line: QuoteLine, patch: Partial<QuoteLine>) => void;
}) {
  const lines = imageLines(detail.lines);
  return (
    <div className="pe-form">
      <p className="pe-hint">Use imagens com direitos de utilização.</p>
      {lines.length === 0 ? (
        <p className="pe-hint">Ainda não há linhas visíveis ao cliente.</p>
      ) : null}
      {lines.map((line) => (
        <div key={line.id} className="pe-line-image">
          <CategoryChip tone={categoryTone(line.category)}>
            {CATEGORY_LABELS[line.category]}
          </CategoryChip>
          <ImageUrlField
            label={`Imagem: ${line.service}`}
            value={line.imageUrl}
            disabled={!editable}
            onCommit={(imageUrl) => onPatchLine(line, { imageUrl })}
          />
        </div>
      ))}
    </div>
  );
}

/** Condições: validity, deposit and balance, with the computed values. */
export function ProposalConditions({
  detail,
  editable,
  onPatchHeader,
}: {
  readonly detail: QuoteDetail;
  readonly editable: boolean;
  readonly onPatchHeader: (patch: HeaderPatch) => void;
}) {
  const { quote, totals } = detail;
  const money = (minor: string): string =>
    formatMoney(minorToDecimal(minor, quote.currencyCode), quote.currencyCode);
  return (
    <div className="pe-form">
      <DraftField
        type="date"
        label="Válido até"
        disabled={!editable}
        value={quote.validUntil}
        onCommit={(value) => value !== "" && onPatchHeader({ validUntil: value })}
      />
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
          const days = Number(value);
          if (Number.isInteger(days) && days >= 0 && days <= 365)
            onPatchHeader({ balanceDueDays: days });
        }}
      />
      <dl className="pe-computed" aria-label="Valores calculados">
        <div>
          <dt>Validade</dt>
          <dd>{formatDate(quote.validUntil)}</dd>
        </div>
        <div>
          <dt>Sinal</dt>
          <dd>{money(totals.depositMinor)}</dd>
        </div>
        <div>
          <dt>Saldo</dt>
          <dd>
            {money(totals.balanceMinor)}
            {totals.balanceDueNow
              ? " · a pagar já"
              : totals.balanceDueDate === null
                ? ""
                : ` · até ${formatDate(totals.balanceDueDate)}`}
          </dd>
        </div>
      </dl>
    </div>
  );
}
