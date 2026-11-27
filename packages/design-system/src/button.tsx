import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  /** Shows a spinner, marks the button busy and blocks repeat activation. Keep the label text. */
  readonly loading?: boolean;
}

const classes = (variant: ButtonVariant, extra?: string): string =>
  `ds-button ds-button--${variant}${extra ? ` ${extra}` : ""}`;

export function Button({
  variant = "secondary",
  loading = false,
  disabled,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={classes(variant, className)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="ds-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly variant?: ButtonVariant;
  readonly children: ReactNode;
}

/** A link that looks like a Button. Use for navigation; use Button for actions. */
export function ButtonLink({ variant = "secondary", className, ...rest }: ButtonLinkProps) {
  return <a {...rest} className={classes(variant, className)} />;
}
