import type { QuoteDetail, QuoteLine, QuoteSection } from "./quote-format.js";

export interface OrderEntry {
  readonly lineId: string;
  readonly section: QuoteSection;
}

export type MoveDirection = "up" | "down" | "to-base" | "to-option";

/** Lines of one sheet in display order. */
export const sectionLines = (lines: readonly QuoteLine[], section: QuoteSection): QuoteLine[] =>
  lines.filter((line) => line.section === section).toSorted((a, b) => a.position - b.position);

/** The whole order of both sheets, Proposta first, as the line-order endpoint expects. */
export const currentOrder = (lines: readonly QuoteLine[]): OrderEntry[] =>
  (["BASE", "OPTION"] as const).flatMap((section) =>
    sectionLines(lines, section).map((line) => ({ lineId: line.id, section })),
  );

/** Moves one line to `index` of `section` (index counts the target sheet without the moved line). */
export const orderAfterMove = (
  lines: readonly QuoteLine[],
  lineId: string,
  section: QuoteSection,
  index: number,
): OrderEntry[] => {
  const rest = currentOrder(lines).filter((entry) => entry.lineId !== lineId);
  const base = rest.filter((entry) => entry.section === "BASE");
  const option = rest.filter((entry) => entry.section === "OPTION");
  const target = section === "BASE" ? base : option;
  target.splice(Math.max(0, Math.min(index, target.length)), 0, { lineId, section });
  return [...base, ...option];
};

/** Keyboard move: Alt+Up/Down within a sheet, Alt+Left/Right between sheets (kept at the same row). */
export const orderAfterKeyboardMove = (
  lines: readonly QuoteLine[],
  lineId: string,
  direction: MoveDirection,
): OrderEntry[] | null => {
  const line = lines.find((candidate) => candidate.id === lineId);
  if (line === undefined) return null;
  const own = sectionLines(lines, line.section);
  const position = own.findIndex((candidate) => candidate.id === lineId);
  if (direction === "up")
    return position <= 0 ? null : orderAfterMove(lines, lineId, line.section, position - 1);
  if (direction === "down") {
    return position >= own.length - 1
      ? null
      : orderAfterMove(lines, lineId, line.section, position + 1);
  }
  const target = direction === "to-base" ? "BASE" : "OPTION";
  if (target === line.section) return null;
  return orderAfterMove(
    lines,
    lineId,
    target,
    Math.min(position, sectionLines(lines, target).length),
  );
};

/** Applies an order locally (optimistic update) before the server confirms it. */
export const applyOrder = (detail: QuoteDetail, order: readonly OrderEntry[]): QuoteDetail => {
  const counters: Record<QuoteSection, number> = { BASE: 0, OPTION: 0 };
  const placed = new Map<string, { section: QuoteSection; position: number }>();
  for (const entry of order) {
    placed.set(entry.lineId, { section: entry.section, position: counters[entry.section]++ });
  }
  return {
    ...detail,
    lines: detail.lines.map((line) => {
      const next = placed.get(line.id);
      return next === undefined ? line : { ...line, ...next };
    }),
  };
};
