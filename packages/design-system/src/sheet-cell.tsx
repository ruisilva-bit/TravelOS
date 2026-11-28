import { useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";

import type { CategoryTone } from "./category-chip.js";
import { currencyFractionDigits, normalizeMoneyInput } from "./money.js";

export type SheetCellKind = "text" | "date" | "integer" | "money";

export interface SheetCellInputProps {
  /** Accessible name; a spreadsheet cell has no visible label of its own. */
  readonly label: string;
  readonly value: string;
  /** Called once when the person leaves the cell or presses Enter, only if the value changed. */
  readonly onCommit: (value: string) => void;
  readonly kind?: SheetCellKind;
  /** ISO currency code for `money` cells; the value is a decimal string, never a number. */
  readonly currency?: string;
  readonly column?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly maxLength?: number;
  readonly readOnly?: boolean;
}

const padMoney = (amount: string, currency: string): string => {
  const digits = currencyFractionDigits(currency);
  if (amount === "" || amount === ".") return digits === 0 ? "0" : `0.${"0".repeat(digits)}`;
  const [whole = "0", fraction = ""] = amount.split(".");
  const safeWhole = whole === "" ? "0" : whole;
  return digits === 0 ? safeWhole : `${safeWhole}.${fraction.padEnd(digits, "0")}`;
};

const moveVertically = (cell: HTMLElement, direction: 1 | -1): void => {
  const row = cell.closest("[data-sheet-row]");
  const column = cell.getAttribute("data-sheet-col");
  if (row === null || column === null) return;
  let sibling = direction === 1 ? row.nextElementSibling : row.previousElementSibling;
  while (sibling !== null && !sibling.hasAttribute("data-sheet-row")) {
    sibling = direction === 1 ? sibling.nextElementSibling : sibling.previousElementSibling;
  }
  sibling?.querySelector<HTMLElement>(`[data-sheet-col="${column}"]`)?.focus();
};

/**
 * Compact borderless input for dense spreadsheet-like tables. Keeps a local draft while focused;
 * Enter commits and moves to the same column in the next row (Shift+Enter: previous), Esc reverts,
 * Tab follows the natural order.
 */
export function SheetCellInput({
  label,
  value,
  onCommit,
  kind = "text",
  currency = "EUR",
  column,
  placeholder,
  disabled,
  maxLength,
  readOnly,
}: SheetCellInputProps) {
  const [draft, setDraftState] = useState<string | null>(null);
  // The ref is the source of truth for commits: Enter commits and then moves focus, whose blur
  // would otherwise see the stale draft and commit a second time.
  const draftRef = useRef<string | null>(null);
  const setDraft = (next: string | null): void => {
    draftRef.current = next;
    setDraftState(next);
  };
  const shown = draft ?? value;
  const numeric = kind === "money" || kind === "integer";

  const finish = (): void => {
    const pending = draftRef.current;
    if (pending === null) return;
    const next = kind === "money" ? padMoney(pending, currency) : pending;
    setDraft(null);
    if (next !== value) onCommit(next);
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value;
    if (kind === "money") setDraft(normalizeMoneyInput(raw, currency));
    else if (kind === "integer") setDraft(raw.replace(/\D/gu, ""));
    else setDraft(raw);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      const target = event.currentTarget;
      finish();
      moveVertically(target, event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape" && draft !== null) {
      event.stopPropagation();
      setDraft(null);
    }
  };

  return (
    <input
      className="ds-sheet-input"
      type={kind === "date" ? "date" : "text"}
      inputMode={kind === "money" ? "decimal" : kind === "integer" ? "numeric" : undefined}
      data-numeric={numeric ? "true" : undefined}
      data-sheet-col={column}
      aria-label={label}
      autoComplete="off"
      value={shown}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={readOnly}
      maxLength={maxLength}
      onChange={onChange}
      onBlur={finish}
      onKeyDown={onKeyDown}
    />
  );
}

export interface SheetCellSelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
  readonly column?: string;
  /** Styles the select as a category chip of that colour. */
  readonly tone?: CategoryTone;
  readonly disabled?: boolean;
}

export function SheetCellSelect({
  label,
  value,
  options,
  onChange,
  column,
  tone,
  disabled,
}: SheetCellSelectProps) {
  return (
    <select
      className="ds-sheet-input ds-sheet-select"
      data-sheet-col={column}
      data-category={tone}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
