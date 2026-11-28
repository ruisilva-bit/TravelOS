import { NumberStepper } from "@travelos/design-system";

import { DraftField } from "./quote-fields.js";
import type { HeaderPatch, QuoteDetail } from "./quote-format.js";

export interface QuoteHeaderProps {
  readonly detail: QuoteDetail;
  readonly editable: boolean;
  readonly saveStatus: string;
  readonly onPatchHeader: (patch: HeaderPatch) => void;
}

/** Title, trip facts and validity. Every field saves when focus leaves it. */
export function QuoteHeader({ detail, editable, saveStatus, onPatchHeader }: QuoteHeaderProps) {
  const { quote } = detail;
  const nullable = (value: string): string | null => (value.trim() === "" ? null : value.trim());
  return (
    <section className="q-header" aria-label="Dados do orçamento">
      <div className="q-header__meta">
        <a href={`#/clientes/${encodeURIComponent(quote.customerId)}`}>
          {quote.customerDisplayName}
        </a>
        <a href={`#/leads/${encodeURIComponent(quote.leadId)}`}>Ver lead</a>
        <span className="q-header__status" role="status" aria-live="polite">
          {saveStatus}
        </span>
      </div>
      <div className="q-header__grid">
        <DraftField
          className="q-header__title"
          label="Título"
          disabled={!editable}
          value={quote.title}
          maxLength={200}
          onCommit={(value) => value.trim() !== "" && onPatchHeader({ title: value.trim() })}
        />
        <DraftField
          label="Destino"
          disabled={!editable}
          value={quote.destination ?? ""}
          maxLength={200}
          onCommit={(value) => onPatchHeader({ destination: nullable(value) })}
        />
        <DraftField
          type="date"
          label="Partida"
          disabled={!editable}
          value={quote.startDate ?? ""}
          onCommit={(value) => onPatchHeader({ startDate: nullable(value) })}
        />
        <DraftField
          type="date"
          label="Regresso"
          disabled={!editable}
          value={quote.endDate ?? ""}
          onCommit={(value) => onPatchHeader({ endDate: nullable(value) })}
        />
        <NumberStepper
          label="Adultos"
          min={1}
          max={50}
          value={quote.adults}
          disabled={!editable}
          onChange={(adults) => onPatchHeader({ adults })}
        />
        <NumberStepper
          label="Crianças"
          min={0}
          max={50}
          value={quote.children}
          disabled={!editable}
          onChange={(children) => onPatchHeader({ children })}
        />
        <DraftField
          type="date"
          label="Válido até"
          disabled={!editable}
          value={quote.validUntil}
          onCommit={(value) => value !== "" && onPatchHeader({ validUntil: value })}
        />
      </div>
    </section>
  );
}
