import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import { TravelOSMark } from "./travelos-mark.js";

export interface WorkspaceNavigationItem {
  readonly href: string;
  readonly label: string;
}

interface WorkspaceFrameProps {
  readonly realm: "Staff";
  readonly headerContext: string;
  readonly navigation: readonly WorkspaceNavigationItem[];
  readonly activeHref: string;
  readonly headerActions: ReactNode;
  readonly children: ReactNode;
}

function Brand({
  realm,
  className,
}: {
  readonly realm: WorkspaceFrameProps["realm"];
  readonly className?: string;
}) {
  return (
    <a
      className={className === undefined ? "workspace-brand" : `workspace-brand ${className}`}
      href="#/"
      aria-label="TravelOS, início"
    >
      <TravelOSMark />
      <span>TravelOS</span>
      <span className="workspace-brand__realm">{realm}</span>
    </a>
  );
}

function Navigation({
  items,
  activeHref,
  id,
  onNavigate,
}: {
  readonly items: readonly WorkspaceNavigationItem[];
  readonly activeHref: string;
  readonly id?: string;
  readonly onNavigate: () => void;
}) {
  return (
    <nav
      id={id}
      className={id === undefined ? "workspace-sidebar__nav" : "workspace-mobile-nav"}
      aria-label="Navegação principal"
    >
      {items.map((item) => (
        <a
          key={item.href}
          className="workspace-nav-link"
          href={item.href}
          aria-current={item.href === activeHref ? "page" : undefined}
          onClick={onNavigate}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

export function WorkspaceFrame({
  realm,
  headerContext,
  navigation,
  activeHref,
  headerActions,
  children,
}: WorkspaceFrameProps) {
  const navigationId = useId();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const mobileNavigationToggle = useRef<HTMLButtonElement | null>(null);
  const closeNavigation = (): void => setMobileNavigationOpen(false);

  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setMobileNavigationOpen(false);
      mobileNavigationToggle.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavigationOpen]);

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <Brand realm={realm} />
        <p className="workspace-sidebar__scope">Operações</p>
        <Navigation items={navigation} activeHref={activeHref} onNavigate={closeNavigation} />
        <footer className="workspace-sidebar__footer">Sessão {realm} ativa</footer>
      </aside>
      <div className="workspace-area">
        <header className="workspace-topbar">
          <Brand realm={realm} className="workspace-topbar__brand" />
          <span className="workspace-topbar__context">{headerContext}</span>
          <div className="workspace-topbar__actions">
            {headerActions}
            <button
              className="button button--quiet workspace-mobile-toggle"
              type="button"
              aria-controls={navigationId}
              aria-expanded={mobileNavigationOpen}
              aria-label={mobileNavigationOpen ? "Fechar navegação" : "Abrir navegação"}
              ref={mobileNavigationToggle}
              onClick={() => setMobileNavigationOpen((open) => !open)}
            >
              {mobileNavigationOpen ? "Fechar" : "Menu"}
            </button>
          </div>
          {mobileNavigationOpen ? (
            <Navigation
              id={navigationId}
              items={navigation}
              activeHref={activeHref}
              onNavigate={closeNavigation}
            />
          ) : null}
        </header>
        <main className="workspace-sheet">
          <div className="workspace-main">{children}</div>
        </main>
      </div>
    </div>
  );
}
