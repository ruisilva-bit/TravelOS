import { MenuButton, SheetCellInput, SheetCellSelect, formatMoney } from "@travelos/design-system";
import type { DragEvent, KeyboardEvent } from "react";

import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  agencyNetMinor,
  categoryTone,
  decimalToMinor,
  minorToDecimal,
  nightsBetween,
} from "./quote-format.js";
import type { QuoteCategory, QuoteLine } from "./quote-format.js";

const CATEGORY_OPTIONS = CATEGORY_ORDER.map((value) => ({ value, label: CATEGORY_LABELS[value] }));

export interface QuoteRowProps {
  readonly line: QuoteLine;
  readonly currency: string;
  readonly agencyNetShareBp: number;
  readonly editable: boolean;
  readonly warnings: readonly string[];
  readonly highlighted: boolean;
  readonly dragging: boolean;
  readonly dropEdge: "before" | "after" | null;
  readonly onPatch: (patch: Partial<QuoteLine>) => void;
  readonly onDuplicate: () => void;
  readonly onDetails: () => void;
  readonly onMoveSheet: () => void;
  readonly onDelete: () => void;
  readonly onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  readonly onDragEnd: () => void;
  readonly onDragOver: (event: DragEvent<HTMLTableRowElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => void;
}

export function QuoteSheetRow({
  line,
  currency,
  agencyNetShareBp,
  editable,
  warnings,
  highlighted,
  dragging,
  dropEdge,
  onPatch,
  onDuplicate,
  onDetails,
  onMoveSheet,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOver,
  onKeyDown,
}: QuoteRowProps) {
  const name = line.service === "" ? "sem nome" : line.service;
  const nights =
    line.category === "ACCOMMODATION" ? nightsBetween(line.startDate, line.endDate) : null;
  const money = (minor: string): string => minorToDecimal(minor, currency);
  const agencyNet = agencyNetMinor(line.netSupplierMinor, line.recommendedMinor, agencyNetShareBp);
  const moneyCell = (
    column: string,
    label: string,
    field: "netSupplierMinor" | "recommendedMinor" | "pvpMinor",
  ) => (
    <SheetCellInput
      kind="money"
      currency={currency}
      column={column}
      label={`${label}: ${name}`}
      value={money(line[field])}
      disabled={!editable}
      onCommit={(value) => onPatch({ [field]: decimalToMinor(value, currency) })}
    />
  );

  return (
    <tr
      className="q-row"
      data-sheet-row
      data-line-id={line.id}
      data-category={categoryTone(line.category)}
      data-highlight={highlighted ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      data-drop={dropEdge ?? undefined}
      onDragOver={onDragOver}
      onKeyDown={onKeyDown}
    >
      <td className="q-cell q-cell--handle">
        <button
          type="button"
          className="q-handle"
          data-handle
          draggable={editable}
          disabled={!editable}
          aria-label={`Mover linha ${name}`}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight N D Delete"
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <span aria-hidden="true">⋮⋮</span>
        </button>
      </td>
      <td className="q-cell" data-label="Categoria">
        <SheetCellSelect
          column="category"
          label={`Categoria: ${name}`}
          tone={categoryTone(line.category)}
          value={line.category}
          options={CATEGORY_OPTIONS}
          disabled={!editable}
          onChange={(value) => onPatch({ category: value as QuoteCategory })}
        />
      </td>
      <td className="q-cell q-cell--wide" data-label="Serviço">
        <SheetCellInput
          column="service"
          label={`Serviço: ${name}`}
          value={line.service}
          maxLength={200}
          disabled={!editable}
          onCommit={(value) => {
            if (value.trim() !== "") onPatch({ service: value.trim() });
          }}
        />
      </td>
      <td className="q-cell q-cell--qty" data-label="Qtd">
        <SheetCellInput
          kind="integer"
          column="quantity"
          label={`Quantidade: ${name}`}
          value={String(line.quantity)}
          disabled={!editable}
          onCommit={(value) => {
            const quantity = Number.parseInt(value, 10);
            if (quantity >= 1) onPatch({ quantity });
          }}
        />
      </td>
      <td className="q-cell" data-label="NET fornecedor">
        {moneyCell("net", "NET fornecedor", "netSupplierMinor")}
      </td>
      <td className="q-cell" data-label="Recomendado">
        {moneyCell("recommended", "Recomendado", "recommendedMinor")}
      </td>
      <td className="q-cell q-cell--num q-cell--auto" data-label="NET agência">
        <span title="Calculado: NET mais a parte da agência da diferença até ao recomendado">
          {formatMoney(money(agencyNet), currency)}
        </span>
      </td>
      <td className="q-cell" data-label="PVP">
        {moneyCell("pvp", "PVP", "pvpMinor")}
      </td>
      <td className="q-cell" data-label="Fornecedor">
        <SheetCellInput
          column="supplier"
          label={`Fornecedor: ${name}`}
          value={line.supplier ?? ""}
          maxLength={200}
          disabled={!editable}
          onCommit={(value) => onPatch({ supplier: value.trim() === "" ? null : value.trim() })}
        />
      </td>
      <td className="q-cell q-cell--wide" data-label="Descrição">
        <SheetCellInput
          column="description"
          label={`Descrição: ${name}`}
          value={line.description ?? ""}
          maxLength={2000}
          disabled={!editable}
          onCommit={(value) => onPatch({ description: value.trim() === "" ? null : value.trim() })}
        />
      </td>
      <td className="q-cell" data-label="Início">
        <SheetCellInput
          kind="date"
          column="start"
          label={`Início: ${name}`}
          value={line.startDate ?? ""}
          disabled={!editable}
          onCommit={(value) => onPatch({ startDate: value === "" ? null : value })}
        />
      </td>
      <td className="q-cell" data-label="Fim">
        <SheetCellInput
          kind="date"
          column="end"
          label={`Fim: ${name}`}
          value={line.endDate ?? ""}
          disabled={!editable}
          onCommit={(value) => onPatch({ endDate: value === "" ? null : value })}
        />
      </td>
      <td className="q-cell q-cell--num q-cell--auto" data-label="Noites">
        <span title="Calculado a partir das datas">{nights === null ? "" : nights}</span>
      </td>
      <td className="q-cell q-cell--actions">
        {warnings.length > 0 ? (
          <span className="q-warn" title={warnings.join(" ")}>
            <span aria-hidden="true">!</span>
            <span className="sr-only">Aviso: {warnings.join(" ")}</span>
          </span>
        ) : null}
        <MenuButton
          label={`Ações da linha ${name}`}
          items={[
            { key: "duplicate", label: "Duplicar", onSelect: onDuplicate, disabled: !editable },
            {
              key: "move",
              label: line.section === "BASE" ? "Mover para Opções" : "Mover para Proposta",
              onSelect: onMoveSheet,
              disabled: !editable,
            },
            { key: "details", label: "Detalhes…", onSelect: onDetails },
            {
              key: "delete",
              label: "Apagar",
              onSelect: onDelete,
              tone: "danger",
              disabled: !editable,
            },
          ]}
        />
      </td>
    </tr>
  );
}
