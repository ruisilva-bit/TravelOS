# Stage 9 — First Usable Admin & Customer Portal Implementation Plan

> **For agentic workers:** implement task by task in the existing isolated Stage 9 worktree; use test-first changes and keep exactly one Kanban card in progress.

**Goal:** Deliver a real, Portuguese (Portugal), responsive Admin and Customer Portal in the browser, using the existing Staff/Portal realms, RBAC, explicit TripAccessGrant, and immutable published snapshots.

**Architecture:** Keep the modular monolith and current API composition roots. Add strictly versioned, allowlisted API contracts only where Stage 4–8 have no usable list/create/edit path; enforce authorization in application/persistence paths. Portal reads only authorized Published Snapshots; no frontend or Portal API reaches mutable Admin workspace state.

**Tech Stack:** Pinned Node.js 24.19.0, pnpm 11.21.0, TypeScript, React 19, Vite, Tailwind v4, NestJS APIs, PostgreSQL 18, Kysely/pg, Zod, Vitest, Playwright, owned design system.

**Spec:** Rui's approved Stage 9 brief supplied at `/home/hermes/.hermes/attachments/Pasted content (6-2.8 KB)`; repository `AGENTS.md` and accepted Stages 4–8 documents govern implementation.

## Global Constraints

- Preserve Staff/Portal realm isolation, MFA, CSRF/Origin/Host checks, RBAC scopes, TripAccessGrant, immutable Published Snapshot isolation, INTERNAL_ONLY protection, cache safety and PostgreSQL least privilege.
- Use strict independently authored DTO allowlists; never pass ORM/domain rows through to browser contracts.
- Do not create public signup, fabricate frontend data, use workspace data in Portal, or expose secrets/real PII in evidence.
- Do not add CRM, billing, payments, automatic reservations, external suppliers, or Stage 10 features; Stage 10 actions remain zero.
- Do not compile on CT200, change production, perform destructive operations, or push/merge. Deploy only a locally qualified artifact through the approved DEVELOPMENT procedure.
- Use expected versions/revisions for writes; publication-relevant mutations increment workspace revision; stale writes fail closed.
- Keep accepted historical ADRs, Stage 8 closure/evidence, and Stage 6 deployment contract bytes unchanged; add a Stage 9 successor/extension if deployment semantics need to change.

## Review Focus

1. A Staff session lacking MFA, permission, agency scope, or recent-MFA proof must not list or mutate trips; test direct API denial as well as hidden/disabled UI.
2. A stale Trip/item lock version or workspace revision must return a typed conflict and preserve the current workspace and published snapshot.
3. A Portal session with a revoked/expired grant, another realm's cookie, or no grant must not enumerate or read a trip; test HTTP and snapshot contents.
4. A grant with no active publication must reveal no mutable workspace fields; represent it only as an authorized no-publication state.
5. Credential forms and browser errors must never place passwords, TOTP codes, cookies, or personal data in URLs, logs, screenshots, or evidence; verify narrow-mobile layout and keyboard access.

---

### Task 1: Establish Stage 9 implementation checkpoint

**Files:** Stage 9 plan; Kanban board `travelos-stage9`; no Stage 8 source or evidence edits.

- [x] Confirm current branch is `phase-1/stage-9`, based on peeled GO tag commit `a5cac93bbaa0214456739f7b571795ca8080bfb6`; preserve any unrelated untracked worktree state.
- [x] Record the bounded CT200 read-only baseline from live output: `/opt/travelos/current` resolves to `travelos-stage8-gen03-3d6c977d`, bundled Node is `v24.19.0`, migration head is `0014_stage8_worker_activity`, and `travelos-admin-api.service`, `travelos-portal-api.service`, `travelos-worker.service` and `caddy.service` are active. DNS is unresolved in this environment; forced anonymous requests to `admin.travelos.test` / `portal.travelos.test` return `404` at CT200 (`192.168.1.33`). Keep deployment gated on the approved artifact process and final qualification.
- [x] Promote the single in-progress card to implementation; keep QA, deploy, freeze/review and closure as explicit downstream cards.

### Task 2: Add strict Admin Trip list/detail APIs for the first visible slice

**Files:**
- Create: `packages/contracts/src/admin/trips/workspace-v1.ts`, `packages/contracts/test/admin-trip-workspace-v1.test.ts`.
- Modify: `packages/contracts/src/admin/trips/index.ts` (the Admin entrypoint already re-exports this module).
- Create: `packages/backend-core/src/modules/trip-operations/application/m1-staff-workspace-operations.ts`, `packages/backend-core/test/trip-operations/staff-workspace-operations.test.ts`.
- Create: `packages/database/src/trip-operations/m1-staff-trip-workspace-repository.ts`, `packages/database/src/trip-operations/m1-staff-trip-workspace-operations.ts`; modify `packages/database/src/index.ts`.
- Modify: `apps/admin-api/src/m1-routes.ts`, `apps/admin-api/src/auth-bridge.ts`, `apps/admin-api/src/main.ts`, `apps/admin-api/test/m1-routes.test.ts`.
- Add real PostgreSQL boundary coverage in `tests/integration/stage-7-postgresql.test.ts`, using the existing disposable Stage 8 PostgreSQL harness; do not change migrations or historical evidence.

**Interfaces:** Export `AdminTripWorkspaceListV1QuerySchema`, `AdminTripWorkspaceListV1ResponseSchema`, and `AdminTripWorkspaceV1ResponseSchema`. The list response is `{ items: AdminTripResponse[], nextCursor: string | null }` with at most 50 items; the detail response is `{ trip: AdminTripResponse, flights: AdminFlightResponse[], accommodations: AdminAccommodationResponse[] }` with at most 500 entries per itinerary collection. The strict query accepts `limit` from 1–50 (default 25) and an optional UUID `cursor` (default `null`). Register `GET /api/admin/trips` and `GET /api/admin/trips/:tripId/workspace`; preserve the Stage 5 `GET /api/admin/trips/:tripId` composite contract unchanged.

Export `M1StaffTripWorkspaceOperations` with `listTrips(cookieHeader: unknown, query: { limit: number; cursor: OpaqueId | null }): Promise<M1TripWorkspacePage>` and `readTripWorkspace(cookieHeader: unknown, tripId: OpaqueId): Promise<M1TripWorkspace | null>`. The inward `M1StaffTripWorkspaceReadRepository` port exposes `listTrips(agencyId: OpaqueId, limit: number, cursor: OpaqueId | null, authorization: StaffAuthorizationOperationProof): Promise<M1TripWorkspacePage>` and `readTripWorkspace(agencyId: OpaqueId, tripId: OpaqueId, authorization: StaffAuthorizationOperationProof): Promise<M1TripWorkspace | null>`. `M1TripWorkspacePage` contains `items: readonly Trip[]` and `nextCursor: OpaqueId | null`; `M1TripWorkspace` contains only `trip: Trip`, `flights: readonly FlightItem[]`, and `accommodations: readonly AccommodationItem[]`. Both operations require `trip.view`; application authorization derives Agency from the Staff session, and the PostgreSQL transaction independently rechecks session epoch, Agency, permission and same-Agency Trip ownership. The detail query selects only `trip_ops.trip`, `trip_ops.itinerary_item`, `trip_ops.flight_item_detail` and `trip_ops.accommodation_item_detail`, fetches at most 501 rows per item family, and fails rather than truncating if a family exceeds 500. No Customer/Person/Traveller PII, Reservation, SupplierCost, raw rows or `INTERNAL_ONLY` fields are selected or serialized. Customer/traveller association remains in Task 6.

- [x] **RED contracts:** In `admin-trip-workspace-v1.test.ts`, add `accepts_strict_workspace_list_and_detail_allowlists` and `rejects_unknown_fields_and_out_of_range_pagination`; assert exact allowed keys and that `INTERNAL_ONLY`, customer/person/traveller, reservation, and supplier-cost sentinels are rejected. Run `pnpm exec vitest run --config tooling/testing/vitest.config.ts packages/contracts/test/admin-trip-workspace-v1.test.ts` and confirm failure is the missing V1 contract export.
- [x] **GREEN contracts:** Implement and export the three strict V1 schemas; rerun the same command and confirm both tests pass.
- [x] **RED application:** In `staff-workspace-operations.test.ts`, add `listTrips_requires_trip_view_and_uses_the_session_agency`, `readTripWorkspace_rejects_unauthenticated_session_before_repository_access`, and `readTripWorkspace_rejects_missing_trip_view_before_repository_access`; assert exact repository arguments and no repository call on denial. Run the focused Vitest file and confirm failure is the missing application interface/use case.
- [x] **GREEN application:** Implement `M1StaffTripWorkspaceOperations`, `M1TripWorkspacePage`, `M1TripWorkspace`, and fixed `trip.view` authorization; export them from `packages/backend-core/src/index.ts`; rerun the focused file.
- [x] **RED routes:** Extend `apps/admin-api/test/m1-routes.test.ts` with `lists_trips_with_strict_cursor_query_and_no_store`, `reads_only_the_workspace_allowlist`, `returns_404_for_another_agency_trip`, and `rejects_unknown_or_out_of_range_list_queries`; confirm missing routes fail before implementation.
- [x] **GREEN routes/composition:** Add explicit route mappers and strict query parsing; wire the new PostgreSQL operations through `main.ts` and `auth-bridge.ts`; retain Host/Origin/Authorization-header checks and `no-store, private` on both reads. Run the focused contract, application, and Admin API Vitest tests.
- [x] **RED/GREEN PostgreSQL boundary:** Add `workspace_list_and_detail_recheck_trip_view_and_agency_without_customer_or_cost_reads` to the real disposable PostgreSQL integration suite. Seed a Trip with no Reservation/SupplierCost, verify list/detail succeed for the authorized Staff session, verify an unknown local Trip returns `null`/HTTP `404`, verify a mismatched Agency proof and a proof without `trip.view` are rejected, and prove the least-privilege role cannot read Customer/Person/Traveller, Reservation or SupplierCost tables. Migration `0005_root_agency_staff_authorization.cjs` enforces one root Agency per database, so a real foreign-Agency row cannot be seeded in this disposable instance; cross-instance host isolation remains a deployment gate. Run `TRAVELOS_STAGE8_ARTIFACT_ROOT=<verified-stage8-extracted-root> TRAVELOS_STAGE8_EVIDENCE_DIR=.hermes/state/stage9-api-postgres-<run> node tooling/database/run-stage-8-disposable.mjs`; first observe the new test fail, then rerun after implementation and confirm the PostgreSQL 18.6 cluster stops and is cleaned up.

### Task 3: Add Portal authorized-trip listing from Published Snapshots only

**Files:**
- Create: `packages/contracts/src/portal/customer-presentation/authorized-trip-list-v1.ts`, `packages/contracts/test/portal-authorized-trip-list-v1.test.ts`.
- Modify: `packages/contracts/src/portal/index.ts`.
- Create: `packages/portal-safe-core/src/customer-presentation/list-authorized-portal-trips.ts`, `packages/portal-safe-core/test/customer-presentation/list-authorized-trips.test.ts`.
- Modify: `packages/portal-safe-core/src/customer-presentation/index.ts`.
- Modify: `apps/portal-api/src/trip-routes.ts`, `trip-read-repository.ts`, `app.ts`, `main.ts`; test `apps/portal-api/test/portal-access/trip-routes.test.ts`.
- Add real Portal-role coverage to `tests/integration/stage-7-postgresql.test.ts`; do not widen the Portal database role or add workspace privileges.

**Interfaces:** `GET /api/portal/trips` accepts only `limit` (decimal integer 1–50, default 25) and optional UUID `cursor`. `PortalAuthorizedTripListV1ResponseSchema` is `{ items, nextCursor }`, at most 50 items; each item is exactly `{ tripId, publicationState: "PUBLISHED", snapshot }` with a V1 snapshot or `{ tripId, publicationState: "NO_PUBLICATION" }`. `listAuthorizedPortalTrips({ session, nowEpochMs, limit, cursor, reader })` derives Agency/principal/session/authorization epoch from the Portal session, rejects expired/invalid identity or pagination without calling the reader, and strictly parses the bounded result. `CurrentAuthorizedPortalTripListReader.listCurrentAuthorizedTrips(query)` is implemented by one PostgreSQL statement that rechecks session context, principal epoch, active non-expired `trip.view_current` grant, current publication pointer, immutable version and snapshot. It selects no workspace Trip, itinerary, Customer, Person or Traveller tables; a dangling/unsupported active publication fails closed rather than becoming `NO_PUBLICATION`.

- [x] **RED/GREEN contract:** `portal-authorized-trip-list-v1.test.ts` covers default/50-item query bounds, malformed/unknown query fields, strict published/no-publication variants, workspace/PII/INTERNAL_ONLY rejection and response cap. Confirm the missing export fails as assertions, then pass with the V1 schemas.
- [x] **RED/GREEN safe-core:** `list-authorized-trips.test.ts` proves scoped session derivation, expired/malformed-session and invalid-pagination short-circuit, strict DTO failure, and enforcement of the requested page size.
- [x] **RED routes:** Extend `portal-access/trip-routes.test.ts` with `lists_current_authorized_snapshots_with_no_store`, `rejects_staff_cookie_before_list_reader`, `rejects_duplicate_unknown_and_out_of_range_list_queries`, and `does_not_disclose_reader_diagnostics`; observe behavior failures before route implementation.
- [x] **GREEN routes/composition:** Register `GET /api/portal/trips` without changing the existing detail route; preserve Host/Origin/Authorization-header checks, Portal realm session verification and `Cache-Control: no-store, private`; wire the reader in `main.ts`.
- [x] **RED/GREEN PostgreSQL boundary:** Exercise a real Portal session with a grant to a published Trip and a grant to an unpublished Trip; verify only those IDs are listed, snapshots are current/strict, no-publication contains no mutable fields, and cursor pagination is stable. Verify expired/revoked/ungranted grants and stale authorization epochs return no Trip; use the real Portal database role and prove workspace `SELECT` remains denied. Run through the extracted Stage 8 PostgreSQL harness and confirm cluster/temp-root cleanup.

### Task 4: Deliver the first visible Admin and Portal browser slice

**Files:** `apps/admin-web/src/**`, `apps/portal-web/src/**`, owned `packages/design-system/src/**`, both app tests, and Playwright configuration as needed. Keep each SPA and auth realm separate.

- [x] Deal and record one light app-screen direction using the app-screen design guide; use TravelOS's itinerary chronology and distinct Flight/Accommodation events as product-specific detail, not decorative or fabricated metrics.
- [x] Add test-first same-origin API/auth helpers, strict DTO parsing, typed errors, real Staff and Portal login/logout, Staff MFA challenge/verification and current session context. Login forms use non-GET native semantics before hydration.
- [x] Build the Admin login, accessible responsive shell/sidebar/header, data-derived dashboard, real Trip list and Trip detail from the new APIs; include loading, empty, error and permission-denied states.
- [x] Build the Portal login/logout, grant-authorized trip list and immutable snapshot itinerary with Flight/Accommodation presentation; include no-access, no-publication, loading and error states. Never show mutable workspace data.
- [x] Add component tests and Playwright journeys for login/MFA, navigation, real Admin Trip list/detail, authorized Portal snapshot and ungranted Portal denial. Capture real desktop and phone screenshots without credentials or personal data.
- [x] Run component tests, accessibility checks, desktop/tablet/390px browser checks, console/network checks, and production builds of both SPAs.

### Task 5: Qualify and deliver the first visible DEVELOPMENT milestone

**Files:** Stage 9 deployment extension/packaging/tests only if required; never rewrite accepted deployment or Stage 8 artifacts.

- [x] Validate the exact deployment contract, extracted artifact, app markers/assets, checksums and sensitive-data scan locally; confirm prebuilt SPAs/APIs and no compilation on CT200.
- [x] Preserve the verified CT200 baseline: current migration head `0014_stage8_worker_activity`, Node `v24.19.0`, active API/Worker/Caddy units, exact host allowlist and `192.168.1.33:80` bind. Rui authorized a versioned DEVELOPMENT Caddy route change only; keep `admin off`, add only static roots plus exact API/health proxies, and make no DNS/hosts/firewall/port/production changes.
- [x] Before any CT200 mutation, pass disposable qualification and the approved backup/restore-probe, headroom, artifact and security gates; stop if any preflight diverges.
- [x] Deploy only the qualified DEVELOPMENT artifact using the root-owned Stage 9 operator; validate and back up the exact Caddy baseline, atomically install the versioned config, restart Caddy (admin API is off, so `ExecReload` cannot apply config), and restart only Admin/Portal APIs. Never restart Worker. Verify host routing, static assets, API/auth routing, service health and real browser journeys; rollback release and Caddy config on failure.
- [x] Keep the implementation card open for remaining Stage 9 work while this visible milestone is available; do not wait for final freeze or optional polish.

### Task 6: Complete the usable Trip/Preview/Publish workflows after the early milestone

**Files:** strict Admin contracts, backend-core application operations, database adapters, Admin API routes and PostgreSQL tests; `apps/admin-web/src/**`, `apps/portal-web/src/**` and end-to-end journeys.

- [x] Add test-first minimal Trip/customer/primary-traveller creation; allow an empty initial itinerary because Rui's requested flow creates the Trip before adding Flights and Accommodation. Never require or synthesize Reservation/SupplierCost.
- [x] Add permission-checked Flight and Accommodation create/update plus Trip update using expected `lock_version` and `workspace_revision`; exercise same-Agency/same-Trip constraints, stale conflict and no partial write.
- [x] Complete Admin forms for Trip, Flight, Accommodation and minimal client/traveller data; wire Preview, Publish, history/status and typed stale-preview/conflict feedback to existing APIs/contracts.
- [x] Complete browser v1/v2 acceptance: publish v1, verify Portal v1, edit Accommodation, verify Portal still reads v1, publish v2, verify Portal reads v2; prove a client without TripAccessGrant cannot enumerate/read the Trip.
- [x] Run PostgreSQL constraints/privilege and route/component/E2E regressions; preserve immutability, INTERNAL_ONLY, no-store, realm and host/origin checks.

### Task 7: Final Stage 9 verification, evidence and closure

**Files:** Stage 9 tests, evidence, review, adjudication, closure and annotated-tag artifacts; no Stage 10 artifacts/actions.

- [ ] Preserve the deployed v1 deployment extension; add a strict v2 successor pinned to active gen05/current Caddy, explicitly declaring the Stage 9 migration `0015_stage9_trip_workspace_writes.cjs` from current head `0014` to candidate head `0015`; retain Stage 8 lineage, the host allowlist, controlled migrator/restore gate, no Worker restart and Stage 10 = 0.
- [ ] Add and test a Stage 9 candidate-scoped one-shot canonical CI runner before the final candidate run; do not change the Stage 8 runner.
- [ ] Complete the capability matrix against the original brief, including user entry point, persisted effect, permissions, correction/conflict behavior, empty/error state and browser evidence.
- [ ] Run the exact pinned clean install, full lint/typecheck/format/architecture/unit/integration/build gates, production-artifact browser E2E, real Portal isolation/grant denial and no-secret scan after the final source change.
- [ ] Rehearse deployment/restore and verify the artifact contract and actual CT200 DEVELOPMENT URLs; retain redacted outputs and real screenshots.
- [ ] Execute one canonical CI run for the qualified candidate; do not repeat a consumed candidate run. Build the deterministic freeze only after all changes and tests are complete.
- [ ] Request independent review, adjudicate every finding with evidence, and issue GO/NO-GO for the exact frozen bytes. If GO, create the requested local commit and annotated Stage 9 tag; do not push or merge.
- [ ] Verify Stage 10 action count remains zero and reconcile all Kanban cards to actual evidence.
