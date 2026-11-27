import { useId } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

interface FieldChrome {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  /** Validation message. Sets aria-invalid and is announced with the control. */
  readonly error?: ReactNode;
}

interface FieldFrameProps extends FieldChrome {
  readonly id: string;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}

const describedBy = (id: string, chrome: FieldChrome, extra?: string): string | undefined => {
  const ids = [
    chrome.hint ? `${id}-hint` : null,
    chrome.error ? `${id}-error` : null,
    extra ?? null,
  ].filter((value): value is string => value !== null);
  return ids.length > 0 ? ids.join(" ") : undefined;
};

function FieldFrame({ id, label, hint, error, className, children }: FieldFrameProps) {
  return (
    <div className={className ? `ds-field ${className}` : "ds-field"}>
      <label className="ds-field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint ? (
        <p className="ds-field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="ds-field__error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps
  extends FieldChrome, Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  readonly id?: string;
}

export function TextField({ id, label, hint, error, className, ...input }: TextFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldFrame id={fieldId} label={label} hint={hint} error={error} className={className}>
      <input
        {...input}
        id={fieldId}
        className="ds-control"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, { label, hint, error }, input["aria-describedby"])}
      />
    </FieldFrame>
  );
}

export interface TextAreaProps
  extends FieldChrome, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  readonly id?: string;
}

export function TextArea({ id, label, hint, error, className, ...area }: TextAreaProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldFrame id={fieldId} label={label} hint={hint} error={error} className={className}>
      <textarea
        {...area}
        id={fieldId}
        className="ds-control"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, { label, hint, error }, area["aria-describedby"])}
      />
    </FieldFrame>
  );
}

export interface SelectProps
  extends FieldChrome, Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  readonly id?: string;
}

/** Native select: pass <option> children. Keeps platform keyboard and mobile behaviour. */
export function Select({ id, label, hint, error, className, children, ...select }: SelectProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldFrame id={fieldId} label={label} hint={hint} error={error} className={className}>
      <select
        {...select}
        id={fieldId}
        className="ds-control"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, { label, hint, error }, select["aria-describedby"])}
      >
        {children}
      </select>
    </FieldFrame>
  );
}

export interface DateFieldProps extends Omit<TextFieldProps, "type"> {
  /** Value is always an ISO local date, "YYYY-MM-DD" (or ""). The browser shows it localised. */
  readonly value?: string;
  readonly defaultValue?: string;
}

export function DateField(props: DateFieldProps) {
  return <TextField {...props} type="date" />;
}
