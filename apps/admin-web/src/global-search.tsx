import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { searchAdmin } from "./api.js";
import { isAuthenticationRequired } from "./crm-shared.js";

interface SearchOption {
  readonly key: string;
  readonly group: "Clientes" | "Leads" | "Viagens";
  readonly label: string;
  readonly detail: string | null;
  readonly href: string;
}

type SearchState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly options: readonly SearchOption[] };

const DEBOUNCE_MS = 250;
const MIN_LENGTH = 2;
const GROUPS: readonly SearchOption["group"][] = ["Clientes", "Leads", "Viagens"];

const toOptions = (result: Awaited<ReturnType<typeof searchAdmin>>): readonly SearchOption[] => [
  ...result.customers.map((customer) => ({
    key: `c-${customer.id}`,
    group: "Clientes" as const,
    label: customer.displayName,
    detail: customer.email ?? customer.phone,
    href: `#/clientes/${encodeURIComponent(customer.id)}`,
  })),
  ...result.leads.map((lead) => ({
    key: `l-${lead.id}`,
    group: "Leads" as const,
    label: lead.name,
    detail: null,
    href: `#/leads/${encodeURIComponent(lead.id)}`,
  })),
  ...result.trips.map((trip) => ({
    key: `t-${trip.id}`,
    group: "Viagens" as const,
    label: trip.title,
    detail: null,
    href: `#/viagens/${encodeURIComponent(trip.id)}`,
  })),
];

export function GlobalSearch({
  onAuthenticationRequired,
}: {
  readonly onAuthenticationRequired: () => void;
}) {
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const input = useRef<HTMLInputElement | null>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed.length < MIN_LENGTH) {
      setState({ kind: "idle" });
      return;
    }
    let current = true;
    setState({ kind: "loading" });
    const timer = setTimeout(() => {
      void searchAdmin(trimmed).then(
        (result) => {
          if (!current) return;
          setState({ kind: "ready", options: toOptions(result) });
          setActive(0);
        },
        (error: unknown) => {
          if (!current) return;
          if (isAuthenticationRequired(error)) onAuthenticationRequired();
          else setState({ kind: "error" });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text, onAuthenticationRequired]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const options = useMemo(() => (state.kind === "ready" ? state.options : []), [state]);
  const optionId = (index: number): string => `${baseId}-option-${String(index)}`;
  const expanded = open && state.kind !== "idle";

  const choose = (option: SearchOption): void => {
    setOpen(false);
    setText("");
    setState({ kind: "idle" });
    window.location.hash = option.href;
    input.current?.blur();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      if (options.length > 0) setActive((index) => (index + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (options.length > 0) setActive((index) => (index - 1 + options.length) % options.length);
    } else if (event.key === "Enter") {
      const option = options[active];
      if (expanded && option) {
        event.preventDefault();
        choose(option);
      }
    } else if (event.key === "Escape") {
      if (expanded) {
        event.preventDefault();
        setOpen(false);
      } else if (text !== "") {
        setText("");
      }
    }
  };

  const message =
    state.kind === "loading"
      ? "A pesquisar…"
      : state.kind === "error"
        ? "Não foi possível pesquisar. Tente novamente."
        : state.kind === "ready" && state.options.length === 0
          ? "Sem resultados."
          : null;

  return (
    <div className="global-search" ref={container}>
      <input
        ref={input}
        className="ds-control global-search__input"
        type="search"
        role="combobox"
        aria-label="Pesquisar clientes, leads e viagens"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listboxId}
        aria-activedescendant={expanded && options.length > 0 ? optionId(active) : undefined}
        placeholder="Pesquisar… (Ctrl+K)"
        autoComplete="off"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <div className="global-search__panel" hidden={!expanded}>
        <div id={listboxId} role="listbox" aria-label="Resultados da pesquisa">
          {GROUPS.map((group) => {
            const groupOptions = options.filter((option) => option.group === group);
            if (groupOptions.length === 0) return null;
            return (
              <div role="group" aria-label={group} key={group}>
                <div className="global-search__group" aria-hidden="true">
                  {group}
                </div>
                {groupOptions.map((option) => {
                  const index = options.indexOf(option);
                  return (
                    <div
                      key={option.key}
                      id={optionId(index)}
                      role="option"
                      aria-selected={index === active}
                      className="global-search__option"
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => setActive(index)}
                      onClick={() => choose(option)}
                    >
                      <span>{option.label}</span>
                      {option.detail ? (
                        <span className="global-search__detail">{option.detail}</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <p className="global-search__message" role="status">
          {message}
        </p>
      </div>
    </div>
  );
}
