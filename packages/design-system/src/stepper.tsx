import { useId, useState } from "react";

export interface NumberStepperProps {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly disabled?: boolean;
  readonly onChange: (value: number) => void;
}

/** Small whole-number control with − and + buttons; typing is allowed and committed on blur. */
export function NumberStepper({
  label,
  value,
  min = 0,
  max = 99,
  disabled,
  onChange,
}: NumberStepperProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (next: number): number => Math.min(max, Math.max(min, next));
  const finish = (): void => {
    if (draft === null) return;
    setDraft(null);
    const parsed = draft === "" ? value : clamp(Number.parseInt(draft, 10));
    if (parsed !== value) onChange(parsed);
  };
  return (
    <div className="ds-field ds-stepper-field">
      <label className="ds-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="ds-stepper">
        <button
          type="button"
          className="ds-stepper__button"
          aria-label={`Diminuir ${label.toLowerCase()}`}
          disabled={disabled || value <= min}
          onClick={() => onChange(clamp(value - 1))}
        >
          −
        </button>
        <input
          id={id}
          className="ds-stepper__value"
          inputMode="numeric"
          autoComplete="off"
          value={draft ?? String(value)}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value.replace(/\D/gu, ""))}
          onBlur={finish}
          onKeyDown={(event) => {
            if (event.key === "Enter") finish();
          }}
        />
        <button
          type="button"
          className="ds-stepper__button"
          aria-label={`Aumentar ${label.toLowerCase()}`}
          disabled={disabled || value >= max}
          onClick={() => onChange(clamp(value + 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}
