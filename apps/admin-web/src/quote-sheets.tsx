import { Button, Dialog, Select, formatMoney } from "@travelos/design-system";
import { useEffect, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";

import { QuoteLineDrawer } from "./quote-line-drawer.js";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  agencyNetMinor,
  minorToDecimal,
  sumMinor,
  warningText,
} from "./quote-format.js";
import type { QuoteCategory, QuoteDetail, QuoteLine, QuoteSection } from "./quote-format.js";
import { orderAfterKeyboardMove, orderAfterMove, sectionLines } from "./quote-order.js";
import type { MoveDirection, OrderEntry } from "./quote-order.js";
import { QuoteSheetRow } from "./quote-sheet-row.js";

const SECTION_COPY: Record<QuoteSection, { title: string; hint: string; empty: string }> = {
  BASE: {
    title: "Proposta",
    hint: "Linhas que entram no preço final.",
    empty: "Ainda não há linhas. Adicione o primeiro serviço.",
  },
  OPTION: {
    title: "Opções",
    hint: "Extras que o cliente pode escolher; não entram no preço final.",
    empty: "Sem opções. Arraste uma linha da Proposta ou adicione uma aqui.",
  },
};

const COLUMNS: readonly string[] = [
  "",
  "Categoria",
  "Serviço",
  "Qtd",
  "NET forn.",
  "Recomend.",
  "NET agência",
  "PVP",
  "Fornecedor",
  "Descrição",
  "Início",
  "Fim",
  "Noites",
  "",
];

const ARROW_MOVES: Readonly<Record<string, MoveDirection>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "to-base",
  ArrowRight: "to-option",
};

export interface QuoteSheetsProps {
  readonly detail: QuoteDetail;
  readonly editable: boolean;
  /** Focus (and briefly highlight) this line; `nonce` lets the same line be requested again. */
  readonly focusRequest: { readonly lineId: string; readonly nonce: number } | null;
  readonly onPatchLine: (line: QuoteLine, patch: Partial<QuoteLine>) => void;
  readonly onAddLine: (section: QuoteSection, category: QuoteCategory) => void;
  readonly onDuplicate: (line: QuoteLine) => void;
  readonly onDelete: (line: QuoteLine) => Promise<void>;
  readonly onReorder: (order: OrderEntry[]) => void;
}

interface DropTarget {
  readonly section: QuoteSection;
  readonly index: number;
}

export function QuoteSheets({
  detail,
  editable,
  focusRequest,
  onPatchLine,
  onAddLine,
  onDuplicate,
  onDelete,
  onReorder,
}: QuoteSheetsProps) {
  const { quote, lines, warnings } = detail;
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<QuoteLine | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [addCategory, setAddCategory] = useState<Record<QuoteSection, QuoteCategory | null>>({
    BASE: null,
    OPTION: null,
  });
  const refocusHandle = useRef<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (refocusHandle.current === null) return;
    const handle = root.current?.querySelector<HTMLElement>(
      `[data-line-id="${refocusHandle.current}"] [data-handle]`,
    );
    refocusHandle.current = null;
    handle?.focus();
  });

  useEffect(() => {
    if (focusRequest === null) return;
    const row = root.current?.querySelector<HTMLElement>(`[data-line-id="${focusRequest.lineId}"]`);
    if (row === null || row === undefined) return;
    row.scrollIntoView?.({ block: "center", behavior: "smooth" });
    row.querySelector<HTMLElement>('[data-sheet-col="service"]')?.focus();
    setHighlight(focusRequest.lineId);
    const timer = window.setTimeout(() => setHighlight(null), 2200);
    return () => window.clearTimeout(timer);
  }, [focusRequest]);

  const warningsOf = (lineId: string): string[] =>
    warnings.filter((warning) => warning.lineId === lineId).map((w) => warningText(w.code));

  const move = (line: QuoteLine, direction: MoveDirection): void => {
    const order = orderAfterKeyboardMove(lines, line.id, direction);
    if (order === null) return;
    refocusHandle.current = line.id;
    const entry = order.findIndex((candidate) => candidate.lineId === line.id);
    const placed = order[entry];
    const inSheet = order.filter((candidate) => candidate.section === placed?.section);
    const place = inSheet.findIndex((candidate) => candidate.lineId === line.id) + 1;
    const title = placed === undefined ? "" : SECTION_COPY[placed.section].title;
    setAnnouncement(
      `${line.service} movida para a posição ${place} de ${inSheet.length} em ${title}.`,
    );
    onReorder(order);
  };

  const onRowKeyDown = (line: QuoteLine) => (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (!editable) return;
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      const direction = ARROW_MOVES[event.key];
      if (direction !== undefined) {
        event.preventDefault();
        move(line, direction);
      }
      return;
    }
    // Single-letter shortcuts only when the row handle has focus, so typing in cells is never hijacked.
    const target = event.target as HTMLElement;
    if (!target.hasAttribute("data-handle") || event.ctrlKey || event.metaKey) return;
    if (event.key === "n" || event.key === "N") {
      event.preventDefault();
      onAddLine(line.section, line.category);
    } else if (event.key === "d" || event.key === "D") {
      event.preventDefault();
      onDuplicate(line);
    } else if (event.key === "Delete") {
      event.preventDefault();
      setDeleting(line);
    }
  };

  const onRowDragOver = (line: QuoteLine) => (event: DragEvent<HTMLTableRowElement>) => {
    if (dragId === null) return;
    event.preventDefault();
    event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    const siblings = sectionLines(lines, line.section).filter((entry) => entry.id !== dragId);
    const at = siblings.findIndex((entry) => entry.id === line.id);
    const index = at === -1 ? siblings.length : at + (after ? 1 : 0);
    setDrop({ section: line.section, index });
  };

  const finishDrag = (): void => {
    setDragId(null);
    setDrop(null);
  };

  const onDrop = (section: QuoteSection) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const target = drop?.section === section ? drop : { section, index: Number.MAX_SAFE_INTEGER };
    if (dragId !== null) {
      const line = lines.find((entry) => entry.id === dragId);
      if (line !== undefined) {
        onReorder(orderAfterMove(lines, dragId, target.section, target.index));
        setAnnouncement(`${line.service} movida para ${SECTION_COPY[target.section].title}.`);
      }
    }
    finishDrag();
  };

  const edgeOf = (line: QuoteLine): "before" | "after" | null => {
    if (drop === null || dragId === null || drop.section !== line.section) return null;
    const siblings = sectionLines(lines, line.section).filter((entry) => entry.id !== dragId);
    if (drop.index < siblings.length) return siblings[drop.index]?.id === line.id ? "before" : null;
    return siblings[siblings.length - 1]?.id === line.id ? "after" : null;
  };

  const drawerLine = drawerId === null ? undefined : lines.find((line) => line.id === drawerId);

  return (
    <div ref={root} className="q-sheets">
      {(["BASE", "OPTION"] as const).map((section) => {
        const rows = sectionLines(lines, section);
        const copy = SECTION_COPY[section];
        const money = (minor: string): string =>
          formatMoney(minorToDecimal(minor, quote.currencyCode), quote.currencyCode);
        const times = (pick: (line: QuoteLine) => string): string =>
          sumMinor(rows.map((line) => (BigInt(pick(line)) * BigInt(line.quantity)).toString()));
        const category =
          addCategory[section] ?? rows[rows.length - 1]?.category ?? ("FLIGHT" as QuoteCategory);
        return (
          <section key={section} className="q-sheet" aria-labelledby={`q-sheet-${section}`}>
            <header className="q-sheet__head">
              <h2 id={`q-sheet-${section}`}>
                {copy.title} <span className="q-sheet__count">{rows.length}</span>
              </h2>
              <p>{copy.hint}</p>
            </header>
            <div className="q-sheet__scroll">
              <table
                className="q-table"
                onDragOver={(e) => dragId !== null && e.preventDefault()}
                onDrop={onDrop(section)}
              >
                <caption className="sr-only">{copy.title}: linhas do orçamento</caption>
                <thead>
                  <tr>
                    {COLUMNS.map((name, index) => (
                      <th
                        key={index}
                        scope="col"
                        className={index >= 3 && index <= 7 ? "q-num" : undefined}
                      >
                        {name === "" ? (
                          <span className="sr-only">{index === 0 ? "Mover" : "Ações"}</span>
                        ) : (
                          name
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr
                      className="q-empty"
                      data-drop={drop?.section === section ? "after" : undefined}
                      onDragOver={(event) => {
                        if (dragId === null) return;
                        event.preventDefault();
                        setDrop({ section, index: 0 });
                      }}
                    >
                      <td colSpan={COLUMNS.length}>{copy.empty}</td>
                    </tr>
                  ) : null}
                  {rows.map((line) => (
                    <QuoteSheetRow
                      key={line.id}
                      line={line}
                      currency={quote.currencyCode}
                      agencyNetShareBp={quote.agencyNetShareBp}
                      editable={editable}
                      warnings={warningsOf(line.id)}
                      highlighted={highlight === line.id}
                      dragging={dragId === line.id}
                      dropEdge={edgeOf(line)}
                      onPatch={(patch) => onPatchLine(line, patch)}
                      onDuplicate={() => onDuplicate(line)}
                      onDetails={() => setDrawerId(line.id)}
                      onMoveSheet={() => move(line, section === "BASE" ? "to-option" : "to-base")}
                      onDelete={() => setDeleting(line)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", line.id);
                        event.dataTransfer.effectAllowed = "move";
                        const row = event.currentTarget.closest("tr");
                        if (row !== null) event.dataTransfer.setDragImage?.(row, 16, 16);
                        setDragId(line.id);
                      }}
                      onDragEnd={finishDrag}
                      onDragOver={onRowDragOver(line)}
                      onKeyDown={onRowKeyDown(line)}
                    />
                  ))}
                </tbody>
                {rows.length > 0 ? (
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={4}>
                        Total {copy.title.toLowerCase()}
                      </th>
                      <td className="q-num">{money(times((l) => l.netSupplierMinor))}</td>
                      <td className="q-num">{money(times((l) => l.recommendedMinor))}</td>
                      <td className="q-num">
                        {money(
                          times((l) =>
                            agencyNetMinor(
                              l.netSupplierMinor,
                              l.recommendedMinor,
                              quote.agencyNetShareBp,
                            ),
                          ),
                        )}
                      </td>
                      <td className="q-num q-num--strong">{money(times((l) => l.pvpMinor))}</td>
                      <td colSpan={6} />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
            {editable ? (
              <div className="q-sheet__add">
                <Select
                  label="Categoria da nova linha"
                  value={category}
                  onChange={(event) =>
                    setAddCategory((current) => ({
                      ...current,
                      [section]: event.target.value as QuoteCategory,
                    }))
                  }
                >
                  {CATEGORY_ORDER.map((value) => (
                    <option key={value} value={value}>
                      {CATEGORY_LABELS[value]}
                    </option>
                  ))}
                </Select>
                <Button onClick={() => onAddLine(section, category)}>+ Linha</Button>
              </div>
            ) : null}
          </section>
        );
      })}
      {editable ? (
        <p className="q-help" id="quote-sheet-help">
          Teclado: Tab e Enter percorrem as células. Na pega de uma linha: N nova linha, D duplicar,
          Delete apagar, Alt+↑/↓ mover, Alt+←/→ trocar entre Proposta e Opções.
        </p>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {drawerLine === undefined ? null : (
        <QuoteLineDrawer
          key={drawerLine.id + drawerLine.lockVersion}
          line={drawerLine}
          editable={editable}
          onSave={(patch) => onPatchLine(drawerLine, patch)}
          onClose={() => setDrawerId(null)}
        />
      )}
      <Dialog
        open={deleting !== null}
        tone="danger"
        title="Apagar linha?"
        description={
          deleting === null
            ? undefined
            : `A linha “${deleting.service}” será removida do orçamento.`
        }
        confirmLabel="Apagar linha"
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const line = deleting;
          setDeleting(null);
          if (line !== null) void onDelete(line);
        }}
      />
    </div>
  );
}
