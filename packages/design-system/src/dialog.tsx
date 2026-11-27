import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "./button.js";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  /** Danger styles the confirm button red and focuses Cancel first. */
  readonly tone?: "default" | "danger";
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  /** Called on Cancel, Esc and backdrop click. */
  readonly onClose: () => void;
}

/** Confirmation dialog: modal, traps Tab, closes on Esc, returns focus to the opener. */
export function Dialog({
  open,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "Cancelar",
  tone = "default",
  busy = false,
  onConfirm,
  onClose,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButton.current?.focus();
    return () => opener?.focus();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== "Tab" || panel.current === null) return;
    const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="ds-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panel}
        className="ds-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onKeyDown={onKeyDown}
      >
        <h2 className="ds-dialog__title" id={titleId}>
          {title}
        </h2>
        {description ? (
          <p className="ds-dialog__description" id={descriptionId}>
            {description}
          </p>
        ) : null}
        {children}
        <div className="ds-dialog__actions">
          <button
            ref={cancelButton}
            type="button"
            className="ds-button ds-button--secondary"
            disabled={busy}
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
