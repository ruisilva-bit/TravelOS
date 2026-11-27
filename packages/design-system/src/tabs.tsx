import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export interface TabItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly panel: ReactNode;
}

/** Tabs with roving tabindex: one tab stop; arrows, Home and End move and activate. */
export function Tabs({
  tabs,
  label,
  value,
  defaultValue,
  onValueChange,
}: {
  readonly tabs: readonly TabItem[];
  /** Accessible name of the tab list. */
  readonly label: string;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (id: string) => void;
}) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultValue ?? tabs[0]?.id ?? "");
  const selected = value ?? internal;
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const select = (id: string): void => {
    if (value === undefined) setInternal(id);
    onValueChange?.(id);
    buttons.current.get(id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = tabs.findIndex((tab) => tab.id === selected);
    const count = tabs.length;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % count;
    else if (event.key === "ArrowLeft") next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    const target = next === null ? undefined : tabs[next];
    if (target === undefined) return;
    event.preventDefault();
    select(target.id);
  };

  const active = tabs.find((tab) => tab.id === selected) ?? tabs[0];

  return (
    <div>
      <div className="ds-tablist" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) buttons.current.set(tab.id, node);
              else buttons.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            className="ds-tab"
            id={`${baseId}-tab-${tab.id}`}
            aria-selected={tab.id === active?.id}
            aria-controls={`${baseId}-panel-${tab.id}`}
            tabIndex={tab.id === active?.id ? 0 : -1}
            onClick={() => select(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {active ? (
        <div
          className="ds-tabpanel"
          role="tabpanel"
          id={`${baseId}-panel-${active.id}`}
          aria-labelledby={`${baseId}-tab-${active.id}`}
          tabIndex={0}
        >
          {active.panel}
        </div>
      ) : null}
    </div>
  );
}
