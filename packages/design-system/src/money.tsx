import { useId } from "react";
import type { ChangeEvent, InputHTMLAttributes, ReactNode } from "react";

const MINOR_DIGITS: Readonly<Record<string, number>> = {
  EUR: 2,
  USD: 2,
  GBP: 2,
  CHF: 2,
  JPY: 0,
};

const SYMBOLS: Readonly<Record<string, string>> = {
  EUR: "€",
  USD: "US$",
  GBP: "£",
  JPY: "JP¥",
};

const NBSP = " ";

/** Decimal places allowed for a currency (ISO 4217 minor units). Unknown codes default to 2. */
export const currencyFractionDigits = (currency: string): number =>
  MINOR_DIGITS[currency.toUpperCase()] ?? 2;

/**
 * Normalises typed text to a canonical decimal string ("1234.5"): accepts "," or "." as the
 * separator, drops everything that is not a digit, and truncates to the currency's decimals.
 * Never converts to a JS number.
 */
export function normalizeMoneyInput(raw: string, currency: string): string {
  const digits = currencyFractionDigits(currency);
  const cleaned = raw.replace(/[^0-9.,]/gu, "").replace(/,/gu, ".");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  if (digits === 0) return cleaned.slice(0, firstDot);
  const whole = cleaned.slice(0, firstDot);
  const fraction = cleaned.slice(firstDot + 1).replace(/\./gu, "");
  return `${whole}.${fraction.slice(0, digits)}`;
}

/** True when `amount` is a complete, valid decimal string for the currency. */
export function isValidMoneyAmount(amount: string, currency: string): boolean {
  const digits = currencyFractionDigits(currency);
  const pattern = digits === 0 ? /^\d+$/u : new RegExp(`^\\d+(\\.\\d{1,${String(digits)}})?$`, "u");
  return pattern.test(amount);
}

/** Formats a decimal string for display in pt-PT: "1234.5" + EUR -> "1 234,50 €". String maths only. */
export function formatMoney(amount: string, currency: string): string {
  const digits = currencyFractionDigits(currency);
  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [wholeRaw = "0", fractionRaw = ""] = unsigned.split(".");
  const whole = (wholeRaw === "" ? "0" : wholeRaw).replace(/\B(?=(\d{3})+(?!\d))/gu, NBSP);
  const fraction = fractionRaw.padEnd(digits, "0").slice(0, digits);
  const number = `${negative ? "-" : ""}${whole}${digits > 0 ? `,${fraction}` : ""}`;
  const code = currency.toUpperCase();
  return `${number}${NBSP}${SYMBOLS[code] ?? code}`;
}

export interface MoneyFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "value" | "defaultValue" | "onChange" | "type" | "inputMode"
> {
  readonly id?: string;
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  /** Decimal string using "." ("1234.50"). Never a JS number. */
  readonly value: string;
  /** ISO 4217 code shown as a suffix. */
  readonly currency: string;
  /** Receives the normalised decimal string. */
  readonly onValueChange: (amount: string) => void;
}

export function MoneyField({
  id,
  label,
  hint,
  error,
  value,
  currency,
  onValueChange,
  className,
  ...input
}: MoneyFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const code = currency.toUpperCase();
  const describedBy =
    [`${fieldId}-currency`, hint ? `${fieldId}-hint` : null, error ? `${fieldId}-error` : null]
      .filter((part): part is string => part !== null)
      .join(" ") || undefined;
  const handleChange = (event: ChangeEvent<HTMLInputElement>): void =>
    onValueChange(normalizeMoneyInput(event.target.value, code));
  return (
    <div className={className ? `ds-field ${className}` : "ds-field"}>
      <label className="ds-field__label" htmlFor={fieldId}>
        {label}
      </label>
      <div className="ds-money">
        <input
          {...input}
          id={fieldId}
          className="ds-control"
          type="text"
          inputMode={currencyFractionDigits(code) === 0 ? "numeric" : "decimal"}
          autoComplete="off"
          value={value}
          onChange={handleChange}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        <span className="ds-money__currency" id={`${fieldId}-currency`}>
          {code}
        </span>
      </div>
      {hint ? (
        <p className="ds-field__hint" id={`${fieldId}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="ds-field__error" id={`${fieldId}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
