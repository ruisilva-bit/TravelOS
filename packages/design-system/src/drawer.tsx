import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DrawerProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  /** Action buttons pinned to the bottom of the panel. */
  readonly footer?: ReactNode;
  readonly closeLabel?: string;
  /** Called on the close button, Esc and backdrop click. */
  readonly onClose: () => void;
}

/** Side panel for editing one record's details: modal, traps Tab, Esc closes, focus returns. */
export function Drawer({
  open,
  title,
  description,
  children,
  footer,
  closeLabel = "Fechar",
  onClose,
}: DrawerProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = panel.current?.querySelector<HTMLElement>(".ds-drawer__body");
    (body?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.current)?.focus();
    return () => opener?.focus();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
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
      className="ds-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className="ds-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="ds-drawer__header">
          <div>
            <h2 className="ds-drawer__title" id={titleId}>
              {title}
            </h2>
            {description ? <p className="ds-drawer__description">{description}</p> : null}
          </div>
          <button type="button" className="ds-button ds-button--ghost" onClick={onClose}>
            {closeLabel}
          </button>
        </header>
        <div className="ds-drawer__body">{children}</div>
        {footer ? <footer className="ds-drawer__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
