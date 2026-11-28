import { DateField, TextArea, TextField, normalizeMoneyInput } from "@travelos/design-system";
import { useState } from "react";

interface DraftFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onCommit: (value: string) => void;
  readonly hint?: string;
  readonly error?: string | undefined;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly maxLength?: number;
  readonly placeholder?: string;
}

/** Text or date field that keeps what is typed and saves once, when focus leaves the field. */
export function DraftField({
  type = "text",
  money,
  currency = "EUR",
  value,
  onCommit,
  ...rest
}: DraftFieldProps & {
  readonly type?: "text" | "date";
  readonly money?: boolean;
  readonly currency?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const finish = (): void => {
    if (draft === null) return;
    setDraft(null);
    if (draft !== value) onCommit(money === true ? padDecimal(draft, currency) : draft);
  };
  const common = {
    ...rest,
    value: shown,
    onBlur: finish,
    onChange: (event: { target: { value: string } }) =>
      setDraft(
        money === true ? normalizeMoneyInput(event.target.value, currency) : event.target.value,
      ),
    onKeyDown: (event: { key: string }) => {
      if (event.key === "Enter") finish();
    },
  };
  return type === "date" ? (
    <DateField {...common} />
  ) : (
    <TextField {...common} inputMode={money === true ? "decimal" : undefined} />
  );
}

const padDecimal = (amount: string, currency: string): string => {
  if (currency === "JPY") return amount === "" ? "0" : amount;
  const [whole = "0", fraction = ""] = amount.split(".");
  return `${whole === "" ? "0" : whole}.${fraction.padEnd(2, "0")}`;
};

/** Multi-line text that saves once, when focus leaves it. */
export function DraftTextArea({
  label,
  hint,
  value,
  disabled,
  maxLength,
  onCommit,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly disabled?: boolean;
  readonly maxLength?: number;
  readonly onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <TextArea
      label={label}
      hint={hint}
      value={draft ?? value}
      disabled={disabled}
      maxLength={maxLength}
      rows={4}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onCommit(draft);
        setDraft(null);
      }}
    />
  );
}
