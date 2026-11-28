import type { ReactNode } from "react";

export interface SectionNavItem {
  readonly id: string;
  readonly label: ReactNode;
}

/**
 * Navigation between the sections of one long form. A vertical list on desktop; on narrow
 * screens it becomes a single scrolling row of tabs. The active item carries `aria-current`.
 */
export function SectionNav({
  items,
  value,
  onChange,
  label,
}: {
  readonly items: readonly SectionNavItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  /** Accessible name of the navigation. */
  readonly label: string;
}) {
  return (
    <nav className="ds-section-nav" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="ds-section-nav__item"
          aria-current={item.id === value ? "true" : undefined}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
