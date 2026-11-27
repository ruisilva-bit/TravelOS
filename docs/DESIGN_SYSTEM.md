# TravelOS Design System

Internal back-office for one Portuguese travel agency, used all day by 1–5 people. Code lives in
`packages/design-system` (components + `src/styles.css` tokens); screens live in `apps/admin-web`.

## 1. Principles

- **Calm.** Neutral surfaces, one brand colour, colour only for state. No decoration that does not help a decision.
- **Dense but readable.** 14px body text, 36px controls, tables for lists. Dense is for scanning, not cramming: one primary action per view.
- **Fast.** Everything works from the keyboard. Forms keep what was typed after an error. Lists load more in place; no full-page spinners.
- **Honest.** Show real states (loading, empty, error, conflict). Never show a stale value as current. Destructive actions are explicit.
- **Staff only.** Never render INTERNAL_ONLY data into anything customer-facing; hiding with CSS is not enforcement (see AGENTS.md).
- **Accessible by default (WCAG 2.2 AA).** Visible focus, labelled controls, 4.5:1 text, 3:1 controls, meaning never by colour alone, reflow at 320px, reduced motion respected.

## 2. Tokens (`styles.css`, CSS custom properties)

Components read **semantic** tokens only, never raw hex. A dark theme is a second value set for the same names (no component change); it is not built yet.

| Group | Tokens |
| --- | --- |
| Surface | `--surface-canvas` (app background), `-raised` (cards, sheet), `-soft` (table header, hover), `-active` (selected nav), `-scrim` |
| Text | `--text-primary`, `--text-muted`, `--text-on-action`, `--text-link` |
| Line | `--border-subtle`, `--border-rule` (row dividers), `--control-border` (4.4:1), `--focus-ring` |
| Action | `--action-primary` (teal #1b6c80, 6.0:1 on white), `-hover`, `--action-negative`, `-hover` |
| Status | `--status-{neutral,info,success,warning,danger}-{fg,bg}`, every pair at least 6:1 |
| Type | IBM Plex Sans stack; `--font-size-xs 12`, `sm 13`, `md 14` (body), `lg 16`, `xl 22` (page title). Weights 400/500/600 only. Numbers in tables use tabular figures |
| Space | 4px base: `--space-1..16` = 4, 8, 12, 16, 24, 32, 48, 64 |
| Shape | `--radius-sm 6`, `-medium 12`, `-lg 16`; `--shadow-overlay` only for dialog, toast, mobile menu; `--control-height 36`, `--touch-target 44` |

## 3. Components (import from `@travelos/design-system`)

| Component | Use it for / rules |
| --- | --- |
| `Button`, `ButtonLink` | `primary` once per view; `secondary` default; `danger` for destructive confirm only; `ghost` for low-emphasis row actions. `loading` keeps the label, shows a spinner and blocks repeats. Use `ButtonLink` when it navigates |
| `TextField`, `TextArea`, `Select`, `DateField` | Always a visible label (placeholder is an example, not a label). `hint` for format help, `error` for validation; both are wired to `aria-describedby`. `DateField` value is `YYYY-MM-DD` |
| `MoneyField` | Amount is a **decimal string** (`"1234.50"`) plus ISO currency code, never a JS number. EUR/USD/GBP allow 2 decimals, JPY 0. Helpers: `formatMoney`, `isValidMoneyAmount`, `normalizeMoneyInput` |
| `Table` | Lists of records: `columns`, `rows`, `empty`, `loading`, optional `pagination` ("Carregar mais"). First column is the link to the record. Scrolls inside its own container on narrow screens |
| `StatusPill` | One short word for a state, with a tone: neutral, info, success, warning, danger. Map domain states to tones in the screen, not in the component |
| `Card`, `SectionHeading` | Group related content; do not nest cards |
| `PageHeader` | One per page: title (h1), description, `status` pill, `actions`, optional `back` link |
| `EmptyState`, `StateMessage` | `EmptyState` for no data, denied, not found, errors that replace content; `StateMessage` for inline loading/error/success (use `role="alert"` for failures, `status` for the rest) |
| `Dialog` | Confirmation only. Traps focus, Esc closes, focus returns to the opener. Danger tone focuses Cancel first. Prefer undo or inline confirmation for reversible actions |
| `ToastProvider`, `useToast` | Short confirmation after an action ("Guardado."). Polite live region; errors stay until dismissed. Never the only place an error appears |
| `Tabs` | Switch views of one record. Arrow keys, Home and End move between tabs |
| `WorkspaceFrame` | Shell: sidebar on desktop, top bar and menu at 768px and below; skip link; `aria-current` on the active item |

New screen-specific styling goes in `apps/admin-web/src/screens.css` using tokens. If two screens need the same thing, promote it here.

## 4. Navigation and routes

Hoje `#/` · Clientes `#/clientes` · Leads `#/leads` · Orçamentos `#/orcamentos` · Viagens `#/viagens` (alias `#/trips`) · Tarefas `#/tarefas` · Equipa `#/equipa` (alias `#/staff/invitations`, only with permission). Sections without a screen show `EmptyState` "Em breve". Hash routing, no router library.

## 5. Writing guide (European Portuguese, pt-PT)

- **Tone:** direct, polite, short. Use the formal "você" form implicitly (imperative "Guarde", not "Guarda"). No exclamation marks, no jargon from the database or API.
- **Buttons are verbs:** "Guardar lead", "Criar viagem", "Tentar novamente". Progress: "A guardar…" (pt-PT gerund form "A + infinitivo", not "Guardando").
- **Errors say what happened and what to do:** "Não foi possível guardar. Tente novamente." Never blame the person; never show codes.
- **Empty states explain the next step:** "Ainda não existem viagens." plus an action when one exists.
- **Dates:** `27/11/2026` in tables; `27 de novembro de 2026` in prose; times 24h `14:30`; always say the time zone when it matters. Machine value is ISO (`<time dateTime>`).
- **Money:** `1 234,56 €` (non-breaking space as thousands separator, comma decimal, symbol after a non-breaking space). Currency code other than EUR when ambiguous.
- **Phone:** `+351 912 345 678`. **Names:** given name then family name, as typed.
- Use "Staff" only where the UI already does; prefer "equipa". Say "viagem", "orçamento", "cliente", "lead" consistently; do not mix "reserva" and "booking".

## 6. Done means

Works by keyboard only; labels and live regions read correctly; checked at 1280px and 390px; every state of the data (loading, empty, error, denied) designed; uses tokens and shared components rather than local styles.
