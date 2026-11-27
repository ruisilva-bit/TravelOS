import type { ReactNode } from "react";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

/** Compact state label. The text always carries the meaning; colour only reinforces it. */
export function StatusPill({
  tone = "neutral",
  className,
  children,
}: {
  readonly tone?: StatusTone;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <span className={`ds-pill ds-pill--${tone}${className ? ` ${className}` : ""}`}>
      {children}
    </span>
  );
}
