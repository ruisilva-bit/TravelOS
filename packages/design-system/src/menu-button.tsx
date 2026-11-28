import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  readonly key: string;
  readonly label: string;
  readonly onSelect: () => void;
  readonly tone?: "default" | "danger";
  readonly disabled?: boolean;
}

export interface MenuButtonProps {
  /** Accessible name of the trigger, e.g. "Ações da linha Voo". */
  readonly label: string;
  readonly items: readonly MenuItem[];
  /** Visible content of the trigger; defaults to a "more" glyph. */
  readonly children?: ReactNode;
}

/** Overflow ("more actions") menu: arrow keys, Home/End, Esc, click-away; focus returns to the trigger. */
export function MenuButton({ label, items, children }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    menu.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
      ?.focus({ preventScroll: true });
    const away = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const openedAt = Date.now();
    // Scroll events queued just before opening must not close the menu straight away.
    const dismiss = (): void => {
      if (Date.now() - openedAt > 250) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  const toggle = (): void => {
    if (!open && trigger.current !== null) {
      const rect = trigger.current.getBoundingClientRect();
      setPosition({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    }
    setOpen(!open);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const entries = Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    );
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number): void => {
      event.preventDefault();
      entries[(next + entries.length) % entries.length]?.focus();
    };
    if (event.key === "ArrowDown") focusAt(index + 1);
    else if (event.key === "ArrowUp") focusAt(index - 1);
    else if (event.key === "Home") focusAt(0);
    else if (event.key === "End") focusAt(entries.length - 1);
    else if (event.key === "Escape") {
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") close(false);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="ds-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
      >
        {children ?? <span aria-hidden="true">⋯</span>}
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              id={menuId}
              className="ds-menu"
              role="menu"
              aria-label={label}
              style={{ top: position.top, right: position.right }}
              onKeyDown={onMenuKeyDown}
            >
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  className="ds-menu__item"
                  data-tone={item.tone === "danger" ? "danger" : undefined}
                  disabled={item.disabled}
                  onClick={() => {
                    close(true);
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
