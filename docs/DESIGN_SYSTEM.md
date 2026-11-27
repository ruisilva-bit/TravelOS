# TravelOS Design System Foundation

**Status:** Accepted — Phase 0 foundation

## 1. Experience principles

TravelOS should feel modern, calm, contextual, fast and trustworthy. Linear, Stripe, Attio and Notion are quality references for hierarchy and interaction, not templates.

- Show the next useful action and current responsibility before ornamental dashboards.
- Prefer progressive disclosure over enormous forms, sidebars and card grids.
- Preserve context when moving through Customer → Request → Quote → Trip.
- Make dangerous/public actions deliberate without making ordinary work slow.
- Use language from the domain model; never expose database/provider jargon.
- Design hierarchy in grayscale first; brand colour does not carry structure.
- Accessibility and narrow-mobile behaviour are acceptance criteria, not polish.

## 2. Separate product surfaces

### Admin

- desktop-efficient and keyboard-friendly, with responsive tablet/mobile fallback;
- information-dense where operations require it, but not cramped;
- global command/search entry, contextual secondary navigation and clear ownership/status;
- tables only where comparison matters; details use sections and inline actions;
- sensitive finance/document information requires explicit permission and is not rendered then hidden with CSS.

### Customer share link (planned)

Customers have no login (ADR-016). A later read-only share link shows one frozen trip snapshot:

- mobile-first single-column journey narrative with resilient touch targets;
- current published Trip/itinerary, not a mirrored Admin UI;
- simple language and clear last-publication time;
- no customer-visible internal status, supplier cost, margin, staff identity or operational note.

## 3. Information architecture

### Admin initial navigation

Keep top-level areas bounded: Home/Attention, CRM, Sales, Trips, Work/Service, Finance (permission-gated), Documents, and Settings. Contextual entity work remains inside a Customer/Opportunity/Trip workspace rather than duplicating every submodule in navigation.

## 4. Token architecture

Use semantic CSS custom properties consumed through Tailwind:

- primitive scales: neutral/brand/success/warning/danger/info shades;
- semantic surfaces/text/border/focus/action/status tokens;
- typography scale and max readable measure;
- spacing scale based on 4, 8, 12, 16, 24, 32, 48, 64;
- radius, border and a restrained elevation scale;
- motion duration/easing with reduced-motion alternatives;
- density modes for Admin only where tested.

Components use semantic tokens (`--surface-raised`, `--text-muted`, `--action-primary`) rather than raw brand shades. Agency branding may configure approved brand/logo/accent tokens with automatic contrast validation. Error/success and security states cannot be rebranded into ambiguity.

Dark mode is deferred until the light system and accessibility are complete; token design must not prevent it.

## 5. Component ownership

TravelOS owns copied/generated component source in `packages/design-system`. shadcn/ui may accelerate accessible source primitives, and Radix primitives may supply difficult behaviour, but neither is the product design system.

Required primitives include:

- button/link/icon button;
- input/select/combobox/date-time/currency controls;
- dialog/sheet/popover/tooltip/menu with correct focus;
- table/list/filter/pagination;
- status badge and permission-safe redaction;
- toast/inline feedback;
- skeleton/loading/empty/error/offline/stale/conflict states;
- timeline;
- itinerary family card/segment primitives;
- publication status/preview comparison;
- secure document row/download state.

Avoid a component wrapper that adds no information hiding. Components document accessibility, variants, content rules and responsive behaviour.

## 6. Publishing UX contract

Publication is the most important product affordance.

- Admin always distinguishes **Workspace changed**, **Previewing revision N**, **Published vN**, **Not yet published** and **Stale preview**.
- Preview has a persistent, unmistakable “Preview — not visible to customer” banner and no publish side effect.
- Publish is a separate primary action available only with permission/recent MFA.
- The confirmation identifies current published version, candidate revision and customer-visible change summary; it never claims that Preview saved/released anything.
- If revision/hash is stale, publishing stops and asks staff to regenerate/review preview. No silent rebase.
- After publish, UI reports immutable version/time/actor and asynchronous notification state separately.
- Internal-only fields are absent from preview DOM/network data—not blurred or labelled hidden.

## 7. Itinerary UX

- Items remain independently editable/reorderable and identifiable by family.
- Flight legs are individual segments; grouping may visually connect them.
- Reservations are shown as related booking records, not nested “the same object.” One reservation can link across item cards.
- Local time and zone/airport context are primary; UTC is not customer UI.
- Warnings flag ambiguous/nonexistent DST local times before save/publish.
- Operational details and Customer Presentation fields are separated in Admin editing.
- Visibility control explains inheritance and permanently locked INTERNAL_ONLY status without offering an override.

## 8. Forms, errors and concurrency

- Label every control; placeholders are examples, not labels.
- Preserve typed input after safe validation errors and focus the first invalid field.
- Currency controls accept decimal text but convert/validate exact minor units; never JS float calculations.
- Optimistic conflicts show what became stale and provide reload/reapply choices; never last-write-wins silently.
- Destructive/revoking actions require explicit confirmation proportional to consequence.
- Permission denied, not found and cross-scope cases avoid existence leakage while giving staff useful safe guidance.
- Async job states distinguish queued, processing, retrying, failed and completed.

## 9. Accessibility baseline

Target WCAG 2.2 AA:

- complete keyboard operation, visible focus and logical focus order;
- skip links/landmarks/headings and accessible names;
- focus trapping/restoration for overlays;
- status changes announced through appropriate live regions without noise;
- 4.5:1 normal text and 3:1 large/UI graphical contrast minimums;
- no information conveyed only by colour, position or animation;
- touch targets at least 44×44 CSS pixels on customer-facing critical actions;
- zoom/reflow at 400%, narrow 320px layouts and text-size increase;
- prefers-reduced-motion and no essential timed interactions;
- itinerary/financial tables have list/card alternatives where mobile/accessibility demands it;
- dates/times/currencies have locale-aware visible text and unambiguous machine values.

Automated axe checks are necessary but manual keyboard/screen-reader review is required for critical flows.

## 10. Responsive and performance budgets

- Customer-facing views are designed at narrow mobile first, then enhanced.
- Admin supports core approve/publish/customer-service actions on narrow mobile but may provide richer desktop comparison surfaces.
- Avoid horizontal page scrolling; data grids may have explicit contained overflow with fixed context.
- Static app shell and route/code splitting keep initial JS bounded; define measured budgets during M1 and fail CI on material regression.
- Images use responsive dimensions, lazy loading and safe provider/proxy policy.
- Loading skeletons preserve layout; stale/offline states never present an old draft as current published truth.

## 11. White-label rules

Allowed runtime configuration:

- Agency display name, approved logo/favicon assets;
- constrained brand accent palette passing contrast checks;
- contact details and welcome content via published Agency Profile;
- locale/time-zone defaults.

A custom domain becomes usable only after declarative ownership/TLS verification and exact inclusion in the instance manifest. Unknown hosts receive no Agency-branded page or distinguishable tenant-existence response; the UI never tries to select an Agency from an arbitrary browser host.

Not configurable:

- security/permission wording that would mislead;
- publication/preview status semantics;
- error/success meaning and accessible focus styles;
- layout/component source;
- arbitrary CSS/JavaScript/HTML;
- customer-specific routes or code.

White-label assets are versioned/scanned/published, not read from mutable settings directly by customer-facing views.

## 12. Design acceptance

Before a component/flow is “done”:

- use real representative/sensitive-safe content lengths and all states;
- pass desktop, 320px and representative mobile viewport;
- pass keyboard, focus, contrast, screen-reader labels and reduced-motion checks;
- prove hidden/forbidden data is absent from DOM/network;
- prove Preview/Published/stale states cannot be confused;
- have no unexpected console/network errors;
- use design-system tokens/components rather than local arbitrary values.

Phase 0 defines this foundation only; no UI assets/components are implemented.
