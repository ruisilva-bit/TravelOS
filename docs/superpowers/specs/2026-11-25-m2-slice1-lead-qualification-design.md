# M2 Slice 1 — Lead capture and qualification to Customer

- **Status:** Approved for implementation (PO decision 2026-11-25: "M2 fatia a fatia")
- **Milestone:** M2 — Commercial funnel, slice 1 of 4 (Lead → Customer; then Travel Request/Opportunity, Quote, Sale)
- **Authority:** `IDEA.md` lifecycle, `docs/PRODUCT_BLUEPRINT.md` §6 ("the next milestone extends backward through that lifecycle"), `docs/DOMAIN_MODEL.md` §CRM/§Sales, `docs/PERMISSIONS.md` permission registry, ADR-001/008/009/012/015.

## 1. Goal

Agency staff can record an unqualified commercial interest (Lead), keep it up to date, and either disqualify it with a reason or qualify it into a Customer — creating a new Customer + primary Person from the Lead contact, or linking an explicitly chosen existing Customer. The Lead is retained after qualification and keeps a reference to that Customer.

Out of scope for this slice: Travel Request, Opportunity, pipelines, assignment/ownership, deduplication/merge, imports, web forms, notifications, Portal exposure of any Lead data.

## 2. Domain (`packages/backend-core/src/modules/sales/`)

`Lead` aggregate:

| Field | Type | Notes |
|---|---|---|
| `id`, `agencyId` | OpaqueId | |
| `source` | `WEBSITE \| PHONE \| EMAIL \| REFERRAL \| WALK_IN \| OTHER` | |
| `contactGivenName`, `contactFamilyName` | non-blank text ≤ 200 | contact snapshot as captured |
| `contactEmail` | text \| null | validated like `validatePersonDraft`; **never** used to auto-link Persons/Customers |
| `contactPhone` | text \| null | ≤ 40 chars, digits/space/`+()-` only |
| `internalNote` | text \| null ≤ 4000 | `INTERNAL_ONLY` |
| `state` | `OPEN \| QUALIFIED \| DISQUALIFIED` | |
| `qualifiedCustomerId` | OpaqueId \| null | required iff `QUALIFIED` |
| `disqualificationReason` | `NO_RESPONSE \| NOT_INTERESTED \| NOT_SERVICEABLE \| DUPLICATE \| OTHER` \| null | required iff `DISQUALIFIED` |
| `lockVersion` | bigint | optimistic concurrency |
| `createdAt`, `updatedAt`, `closedAt` | instants | `closedAt` set on qualify/disqualify |

State machine (commands, never free-form status edits):

```text
OPEN --qualify(createCustomer | linkCustomer)--> QUALIFIED   (terminal)
OPEN --disqualify(reason)-------------------------> DISQUALIFIED (terminal)
OPEN --update(fields)-----------------------------> OPEN
```

Any command on a terminal Lead fails with a typed `LEAD_NOT_OPEN` error. Stale `expectedLockVersion` fails with the existing typed conflict (HTTP 409).

Qualification modes:

- `CREATE_CUSTOMER`: in one transaction create `crm.person` (from contact snapshot), `crm.customer` (`displayName` = `"<given> <family>"` unless provided), `crm.customer_person` (`PRIMARY_CONTACT`, `isPrimary = true`), then mark the Lead `QUALIFIED`.
- `LINK_CUSTOMER`: caller supplies `customerId`; it must exist in the same Agency (composite FK + application check returning `NOT_FOUND`, no existence oracle across Agencies). No Person is created or modified.

## 3. Persistence (migration `0017_m2_sales_lead.cjs`)

- Table `sales.lead` with every column above, `agencyId` FK to the Agency, `UNIQUE (id, agencyId)`.
- Composite FK `(qualifiedCustomerId, agencyId) → crm.customer (id, agencyId) ON DELETE RESTRICT`.
- `CHECK` constraints: non-blank names; enum domains; `state = 'QUALIFIED'` ⇔ `qualifiedCustomerId IS NOT NULL`; `state = 'DISQUALIFIED'` ⇔ `disqualificationReason IS NOT NULL`; `state = 'OPEN'` ⇔ `closedAt IS NULL`; `lockVersion >= 1`.
- Index `(agencyId, state, createdAt DESC, id DESC)` for cursor listing.
- Privileges follow the existing runtime-role pattern of migrations `0005`/`0015`: the Admin runtime role gets `SELECT, INSERT, UPDATE` (no `DELETE`); the Portal runtime role gets **nothing** on `sales` (asserted by integration test). Update the migration checksum manifest with the repository's existing tooling.
- Field registry (DATA_MODEL): owner Sales; classification contact fields `CONFIDENTIAL_PERSONAL`, `internalNote` `INTERNAL_ONLY`; Portal eligibility none; retention follows CRM retention/privacy-deletion policy (privacy deletion of a Lead is a later slice; no blanket soft delete); audit on qualify/disqualify.

## 4. Application and events

Use cases (all authorize inside the use case by permission ID and Agency scope):

| Use case | Permission(s) |
|---|---|
| `listLeads(cursor, state?)`, `getLead(id)` | `sales.view` |
| `createLead`, `updateLead(expectedLockVersion)`, `disqualifyLead(expectedLockVersion, reason)` | `sales.edit` |
| `qualifyLead(expectedLockVersion, mode)` | `sales.edit` **and** `customer.edit` |

- Collections are cursor-paginated (limit ≤ 100), ordered by `createdAt DESC, id DESC`.
- `qualifyLead` and `disqualifyLead` write, in the same transaction: the state change, an Audit event, an Activity entry and an outbox message `LeadQualified` / `LeadDisqualified` carrying only IDs + versions (no contact data).
- Retryable create/qualify/disqualify accept an `Idempotency-Key` following the existing publication idempotency pattern.

## 5. Permissions

- Add `sales.view` and `sales.edit` to `packages/backend-core/src/staff-access/permission-registry.ts` (already documented in `PERMISSIONS.md`).
- The bootstrapped Owner role receives them through the existing all-permissions Owner rule (verify; if Owner is an explicit list, add them there).
- `trip-operations-v1` is **unchanged** in this slice (its exact set is a documented Stage 9 contract). A sales role template is a later decision.

## 6. Admin API (`apps/admin-api`, Admin DTOs in `packages/contracts/src/admin`)

| Method | Path | Body / query |
|---|---|---|
| GET | `/api/admin/leads` | `?cursor&limit&state` |
| POST | `/api/admin/leads` | create DTO |
| GET | `/api/admin/leads/:leadId` | — |
| PATCH | `/api/admin/leads/:leadId` | `expectedLockVersion` + editable fields |
| POST | `/api/admin/leads/:leadId/qualification` | `expectedLockVersion`, `mode`, `customerId?`, `customerDisplayName?` |
| POST | `/api/admin/leads/:leadId/disqualification` | `expectedLockVersion`, `reason` |

Strict Zod schemas (unknown keys rejected), bigint as string, same request-boundary checks as the other Admin routes (`apps/admin-api/src/request-boundary.ts`; Origin required on mutations), `no-store` caching, typed errors (`400` validation, `403` forbidden, `404` not found/cross-Agency, `409` stale/`LEAD_NOT_OPEN`).

## 7. Admin UI (`apps/admin-web`, pt-PT)

- Navigation entry **"Leads"**; list with state filter (Abertas / Qualificadas / Desqualificadas) and "Carregar mais".
- "Novo lead" form; detail view with edit (OPEN only), **"Qualificar"** (criar cliente novo / associar a cliente existente por ID) and **"Desqualificar"** (motivo).
- Conflict (409) shows a non-destructive "Este lead foi alterado por outra pessoa — recarregue" message; no silent overwrite.
- Keyboard accessible, labelled controls, 320 px reflow, visible focus, following existing `workspace-view.tsx` / `trip-workflows.tsx` patterns and the owned design system.

## 8. Tests (evidence required before done)

- Domain unit/property: state machine (all transitions and rejected transitions), field validation, qualification mode rules.
- Application: authorization per use case (missing `sales.view`/`sales.edit`/`customer.edit` → forbidden; role names never checked), stale lock → conflict, idempotent replay, events/audit/activity/outbox written once, email equality creates no link.
- PostgreSQL 18.6 integration (`pnpm test:postgres`): constraints (iff checks, composite FK cross-Agency rejection), Admin role privileges, **Portal role has no `sales` access**, optimistic conflict, cursor pagination, qualify transaction atomicity (failure leaves no Person/Customer).
- Admin API route tests: unknown-field rejection, IDOR (other Agency's lead → 404), Origin enforcement, error mapping.
- Admin web tests (Vitest + Testing Library): list/create/qualify/disqualify flows and conflict message.
- Current-tree gates: `pnpm ci:verify` green.
