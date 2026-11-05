# Stage 9 Secure Staff Invitation and QA Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task in the existing Stage 9 worktree. Steps use checkbox syntax. Keep exactly one execution card in progress; do not commit unless Rui explicitly asks.

**Goal:** Deliver the approved, audited Staff-invitation flow and create one dedicated lower-privilege QA login in CT200 DEVELOPMENT after its successor artifact passes all required gates.

**Architecture:** Keep the modular monolith and existing Staff realm. Add a Staff-invitation application capability with a PostgreSQL transaction that atomically enrolls the Better Auth identity, membership, fixed role assignment, invitation consumption and audit event; expose only narrow Admin API routes, never a generic enrollment auth handler. Extend the existing Admin SPA for invitation management, acceptance and first-time TOTP enrollment; Portal authorization and snapshot reads remain unchanged.

**Tech Stack:** Pinned Node.js 24.19.0, pnpm 11.21.0, TypeScript, Better Auth 1.6.27, Kysely 0.29.5, PostgreSQL 18.6 disposable integration runner, Zod, Vitest, Playwright, React 19, Vite, and the owned design system.

**Spec:** `docs/superpowers/specs/2026-11-02-stage9-staff-invitation-design.md` (approved by Rui on 2026-11-02).

## Global Constraints

- This is an approved Stage 9 scope extension: a supported Admin UI/API capability, not one-off or SQL provisioning.
- `staff.invite` is Agency-scoped; invitation administration requires recent MFA no older than 5 minutes.
- The only inviteable template is `trip-operations-v1`, with exactly `agency.view`, `customer.edit`, `traveller.edit`, `trip.view`, `trip.edit`, `trip.preview`, `trip.publish`, and `trip.access.manage`; it excludes `staff.invite`, `staff.view`, `staff.manage_roles`, `staff.suspend`, `agency.manage_settings`, finance, reservation, `trip.withdraw_publication`, and `runtime_acceptance.fixture.manage`.
- Invitation tokens are 32 random bytes, stored only as a SHA-256 digest, single-use, and expire after 60 minutes. The target email is Owner-approved; do not claim independent mailbox proof or add an email vendor.
- Keep public Staff signup disabled. Do not use `createLocalOperatorStaffEnrollmentRealm`, `tooling/auth/bootstrap-first-owner.ts`, SQL provisioning, or arbitrary role IDs.
- Identity, active Agency membership, fixed role assignment, token consumption and immutable invitation audit commit atomically. Portal runtime receives no access to the new Staff invitation tables.
- Passwords, invitation tokens, Better Auth verification tokens, TOTP seeds and recovery codes must not enter URLs, persistent browser storage, logs, screenshots, Telegram or evidence. Use synthetic fixtures only.
- Gen10 is already active in CT200 DEVELOPMENT at migration head `0015_stage9_trip_workspace_writes`; its one canonical CI has already passed and is consumed. Do not rerun gen10 CI. Reconcile the live Gen10 receipts against stale local gen05 constants/contracts before preparing a successor.
- Build locally; never compile on CT200. Before migration, require a fresh read-only preflight and approved backup/restore proof, preserve the pre-migration backup, and stop on any release/head/helper/disk/restore divergence.
- Preserve Caddy, exact hosts/listeners, DNS, firewall, production and Stage 8 artifacts. No production, Stage 10, push, merge or commit actions; `stage10Actions` remains `0`.
- A successor candidate needs its own source/artifact/predecessor validation, exactly ten hash-linked qualification receipts, and one new canonical CI run. Do not fabricate or overwrite receipts.
- Create the QA account only through the invitation flow after candidate deployment/readback. The Owner/MFA session may issue the invitation but is never used as the QA identity. Ask Rui for the target email immediately before issuance; Rui chooses the password in the browser/password-manager flow. Never send credentials by Telegram.

## Review Focus

1. Missing, malformed, expired, revoked, consumed and unknown invitation tokens must produce an enumeration-safe denial and no partial identity, membership, assignment or audit writes; pin this in application and PostgreSQL tests.
2. Concurrent acceptance/reissue/revoke of the same invitation must serialize to one valid state transition, at most one Staff identity and exactly one matching audit event; test with real PostgreSQL.
3. A new, disabled, stale-MFA, revoked-membership or wrong-Agency Staff session must not obtain Admin session context or call any business endpoint before TOTP is enabled and verified; test both API denial and UI state.
4. Caller-supplied Agency, actor, role template, permission set, unknown fields, malformed cursor and a token accepted for another email must be rejected or ignored without widening authority; test strict DTOs and the live permission check.
5. Credential-channel failure must never fall back to a GET/query, persistent browser storage, request logs, cacheable responses or no-JavaScript credential submission; also assert Portal runtime cannot read invitation/audit data.

---

## File Map

- Contracts: add strict invitation request/list/one-time-issue/acceptance schemas under `packages/contracts/src/admin/staff/`; extend the server-derived Admin Staff session-context contract with `canInviteStaff`.
- Application: add a focused `packages/backend-core/src/modules/staff-access/` invitation domain/application module; keep Better Auth, HTTP, Kysely and DB rows out of this layer. Add the fixed role template to the code-owned permission registry.
- Persistence: add only `migrations/0016_stage9_staff_invitations.cjs` and a focused `packages/database/src/staff-access/staff-invitation-repository.ts`; do not edit an applied migration.
- Auth adapter: add a purpose-specific token factory and a narrow Staff invitation enrollment service. The service returns no `AuthRealm`, `handle`, cookie or session and uses Better Auth internally in the acceptance transaction.
- Admin API: add `staff-invitation-routes.ts` and a small bounded invitation-acceptance rate limiter; wire only through the existing Admin composition root and current Host/Origin/cache controls.
- Admin SPA: add a focused invitation view/API client and first-time MFA enrollment state; keep token/recovery-code handling in component memory only.
- Integration: add `tests/integration/stage-9-staff-invitations-postgresql.test.ts` and include it in `tooling/testing/vitest.stage-9.config.ts`.
- Documents/candidate: update the product/domain/data/security/permission docs; add Stage 9 extension v3 without modifying v1/v2; add an additive Stage 9 successor-baseline verifier for the approved Phase 0 document delta; update Stage 9 candidate metadata, artifact inventory and source-snapshot allowlist/tests.

This remains one plan: persistence, auth, API and UI are not independent deliverables because the security invariant is end-to-end atomic acceptance followed by mandatory MFA.

### Task 0: Reconcile the active Gen10 baseline before candidate work

**Files:** Create `.superpowers/sdd/2026-11-02-stage9-staff-invitation-implementation-plan/task-0-verify.py` as a local-only evidence checker. Read only: verified Gen10 and Stage 8 receipts/artifacts, `.hermes/state` candidate evidence, `tooling/ci/stage-9/constants.mjs`, `deploy/contracts/stage-9-extension.v2.json`, and the live Kanban task. Do not edit old receipts, accepted contracts, or contact CT200.

**Interfaces:** The implementation uses the confirmed active Gen10 artifact as the immediate deployment predecessor, current database head `0015_stage9_trip_workspace_writes`, and the already-consumed Gen10 CI result. Current worktree metadata still names gen05; do not silently treat that as current.

- [x] Reconcile runtime state from the approved post-apply evidence and the active task state; treat pre-migration readbacks as historical, not current. Defer a fresh CT200 read-only probe until immediately before migration in Task 7, preserve its exact output/receipt there, and confirm the Gen10 release/digest, runtime services, unchanged Caddy and migration head `0015_stage9_trip_workspace_writes`. Do not probe CT200 in Task 0.
- [x] Reconcile the confirmed Gen10 ID `travelos-stage9-gen10-724605fc` and source snapshot SHA `724605fc26bf54f8c666d53c8a5f072a16fc25753e1509cc4d9e1e1b6fb2b29495` against the real release and CI receipts; verify the already-consumed CI is 35/35 PASS without rerunning it.
- [x] Reconcile the local gen05 constants, v2 contract and stale resume record against those receipts and the live task board. Keep v1/v2, old receipts and stale resume evidence immutable; if the release, digest, migration head, predecessor or CI evidence differs, stop and resolve it from preserved evidence before changing candidate metadata.
- [x] Keep `stage9-gen10-ct200-deployment-readiness` and `stage9-gen10-live-browser-acceptance-access` pending; account creation and authenticated browser QA are still outstanding.

**Verification:** Run `python3 .superpowers/sdd/2026-11-02-stage9-staff-invitation-implementation-plan/task-0-verify.py`; expect `PASS_LOCAL_EVIDENCE_RECONCILIATION`. It verifies exact source/artifact/predecessor/build/CI bytes, 35/35 PASS with one consumed Gen10 invocation, 0015 target head, stale gen05 metadata, and the live board versus stale resume record. The current task list states Gen10 is deployed with services active and Caddy unchanged; that is not a fresh CT readback. Defer the mandatory current read to Task 7 immediately before migration. No CT200 access or mutation occurs in Task 0.

### Task 1: Define strict contracts, the fixed role, and invitation operations

**Files:**
- Create: `packages/contracts/src/admin/staff/invitation-v1.ts`, `packages/contracts/src/admin/staff/index.ts`, `packages/contracts/test/admin-staff-invitation-v1.test.ts`.
- Modify: `packages/contracts/src/admin/index.ts`, `packages/contracts/src/admin/auth/session-context.ts`, `packages/backend-core/src/staff-access/permission-registry.ts`, `packages/backend-core/src/index.ts`.
- Modify: `packages/backend-core/src/agency-organization/agency-bootstrap.ts`, `packages/backend-core/test/agency-organization/agency-bootstrap.test.ts`.
- Create: `packages/backend-core/src/modules/staff-access/domain/staff-invitation.ts`, `packages/backend-core/src/modules/staff-access/application/staff-invitation-operations.ts`, `packages/backend-core/test/staff-access/staff-invitation-operations.test.ts`.

**Interfaces:**
- Export `TRIP_OPERATIONS_ROLE_TEMPLATE_KEY = "trip-operations-v1"` and `TRIP_OPERATIONS_ROLE_PERMISSION_IDS` with exactly the eight permission IDs in Global Constraints from `staff-access/permission-registry.ts`; define/export the typed `TRIP_OPERATIONS_ROLE_TEMPLATE` in `agency-organization/agency-bootstrap.ts`, parallel to the existing Owner template.
- Export strict Zod schemas for issue (`{ targetEmail }`), list (`limit` 1–50, default 25, optional UUID cursor), accept (`{ token, name, password }`), safe invitation metadata, bounded cursor page and one-time issue/reissue response. Accept must not accept email, Agency, actor, role ID or permissions.
- `StaffInvitationOperations` exports `list(cookieHeader, query)`, `issue(cookieHeader, { targetEmail })`, `reissue(cookieHeader, invitationId)`, `revoke(cookieHeader, invitationId)`, and unauthenticated-token `accept({ token, name, password })`. `StaffInvitationOperationsDependencies` injects the Staff session resolver, authorization snapshot repository, `StaffInvitationRepository`, token factory, identity-enrollment port and `nowEpochMs`.
- `StaffIdentityEnrollmentPort.enroll(context: TransactionContext, input: { email: string; name: string; password: string }): Promise<{ staffPrincipalId: string }>` is the only way the application asks an adapter to create a Staff identity. `StaffInvitationRepository.accept(input, enrollment)` owns the transaction and calls that port with its active `TransactionContext`.
- `StaffInvitationTokenFactory` exposes `create(): { token: string; digest: string }` and `digest(token: string): string`; raw tokens never enter repository inputs. `StaffInvitationRepository` exposes atomic `listAndExpireDue`, `issue`, `reissue`, `revoke` and `accept` operations; the first four receive a `StaffAuthorizationOperationProof`, and `accept` receives only `{ tokenDigest, name, password, nowEpochMs }` plus the enrollment port. Repository records contain a digest but no raw token; application outputs are explicit safe-metadata allowlists.
- Add optional `canInviteStaff: boolean` to the Admin session-context contract during this task so the contract remains backward-compatible until Task 4 composes the server-derived value; it is only a UI hint and never replaces endpoint authorization.
- All list/issue/reissue/revoke operations derive actor and Agency exclusively from the Staff session and authorize `staff.invite` at Agency scope with `recentMfaMaximumAgeMs: 300_000`. The acceptance path derives email/template only from the locked invitation row.

- [x] **RED contracts:** Add tests asserting exact schema keys, strict rejection of unknown Agency/actor/role/permission fields, list pagination bounds, token length/format, bounded metadata and absence of raw tokens from list projections. Run `pnpm exec vitest run --config tooling/testing/vitest.config.ts packages/contracts/test/admin-staff-invitation-v1.test.ts` and confirm the missing exports fail.
- [x] **GREEN contracts:** Implement and export the schemas; rerun the same command and confirm PASS.
- [x] **RED application:** Add named tests `issue_requires_staff_invite_and_recent_mfa`, `list_derives_agency_and_actor_from_session`, `reissue_rotates_token_and_never_returns_old_token`, `revoke_requires_recent_mfa`, `accept_uses_locked_invitation_email_and_fixed_template`, and `invalid_token_fails_without_enrollment`. Assert the exact eight-role positive set and absence of Owner/admin/sensitive capabilities. Confirm failure before implementation.
- [x] **GREEN application:** Implement the domain state/validation and `createStaffInvitationOperations(dependencies)` using existing `authorizeStaffRequest`; raw tokens are returned only by issue/reissue and never passed to the repository. Expiry is `nowEpochMs + 3_600_000`; list lazily materializes due `PENDING -> EXPIRED` transitions in a transaction so each expiry audit event is written once. Rerun focused tests.
- [x] **Regression:** Run the focused permission-registry, Agency bootstrap, session-context contract and existing Staff authorization tests. Keep permission IDs/scope definitions unchanged; preserve `PERMISSION_REGISTRY_VERSION = 6` unless inspection of its enforced semantics requires an aligned version change. Do not weaken the existing bootstrap compatibility guard.

### Task 2: Add migration 0016 and transactional PostgreSQL persistence

**Files:**
- Create: `migrations/0016_stage9_staff_invitations.cjs`, `packages/database/src/staff-access/staff-invitation-repository.ts`, `tests/integration/stage-9-staff-invitations-postgresql.test.ts`.
- Modify: `migrations/checksums.json`, `packages/database/src/staff-access/staff-access-repository.ts`, `packages/database/src/index.ts`, `tooling/testing/vitest.stage-9.config.ts`.
- Update: `docs/DATA_MODEL.md` with StaffInvitation/audit owner, classification, Portal eligibility, retention, audit and access pattern.

**Interfaces:** `createPostgresStaffInvitationRepository(persistence)` implements the Task 1 repository port. It stores only the 64-character lowercase SHA-256 digest; locks rows during reissue/revoke/accept; enforces same-Agency role/membership references; and writes state changes with immutable audit events in the same transaction. Use an existing canonical Staff security audit sink only if inspection proves it is appropriate and append-only; otherwise create `audit.staff_invitation_event`, matching the existing domain-event pattern. Seed the current root Agency's `trip-operations-v1` system role and exactly eight Agency/ALL permissions; make `ensureRootAgency` idempotently ensure the same code-owned role. Grant only the required Admin runtime operations; Portal runtime gets no `SELECT` or write access.

- [x] **RED repository/integration:** Add PostgreSQL assertions for fresh migration and `0015 -> 0016`, role seed exactness, Admin-vs-Portal role privileges, same-Agency foreign keys, append-only audit, issue/list/reissue/revoke/expiry/consume, duplicate identity rollback, and two concurrent accepts where exactly one commits. Confirm the new tests fail before implementation.
- [ ] **GREEN migration:** Create only migration `0016_stage9_staff_invitations.cjs`, forward-only. Use migration-owner/session checks, explicit lock/statement timeouts, constraints, indexes, exact grants, append-only audit protection and idempotent root-role seeding. Do not edit migrations 0001–0015. Append the computed SHA-256 to `migrations/checksums.json`; run `pnpm db:migrations:verify`.
- [ ] **GREEN repository:** Implement cursor-bounded mapping and parameterized SQL. In `accept`, lock a pending, unexpired invitation by digest; call identity enrollment inside the same `TransactionContext`; insert membership and Agency-scoped assignment; consume invitation; append audit; rollback everything on any failure. Reissue atomically invalidates the previous pending invitation and uses a new digest.
- [ ] **GREEN fixture suite:** Include the new integration file in `vitest.stage-9.config.ts`; run `TRAVELOS_STAGE9_EVIDENCE_DIR=.hermes/state/stage9-staff-invitation-postgres-<unique-run> pnpm test:stage9:postgres` with the Stage 8 artifact root taken from its verified receipt, never guessed. Confirm PostgreSQL 18.6 stops and all disposable roots are cleaned. Preserve the resulting real `execution.json` and logs; never overwrite an existing evidence directory.
- [ ] **Regression:** Run focused repository tests, migration checksum verification, architecture checks and the Stage 9 disposable suite; verify the Portal DB role still cannot read workspace or invitation data.

### Task 3: Implement the narrow token and Better Auth enrollment adapters

**Files:**
- Create: `packages/auth-adapters/src/staff-invitation-token.ts`, `packages/auth-adapters/test/staff-invitation-token.test.ts`.
- Modify: `packages/auth-adapters/src/realm.ts`, `packages/auth-adapters/src/index.ts`.
- Integration coverage: `tests/integration/stage-9-staff-invitations-postgresql.test.ts`.

**Interfaces:** Export `createStaffInvitationToken(): { token: string; digest: string }`, `digestStaffInvitationToken(token: string): string`, and `createStaffInvitationEnrollmentService(configuration): { enroll(input: { email: string; name: string; password: string }): Promise<{ staffPrincipalId: string }>`. Generate 32 bytes with `node:crypto`, encode as base64url, and SHA-256 only the raw token. The enrollment service is constructed with the transaction-backed Kysely database and uses a private `allowStaffInvitationEnrollment` mode; it never returns `AuthRealm`, `.handle`, cookies or sessions and is not mounted at `/api/auth/staff`.

- [ ] **RED token:** Test token length/charset, uniqueness across calls, digest format, digest recomputation and that callers can persist only the digest. Confirm the new factory is absent.
- [ ] **GREEN token:** Implement the focused crypto adapter and rerun its tests.
- [ ] **RED enrollment:** In the Stage 9 real-PostgreSQL test, assert Better Auth sign-up and verification complete inside the invitation transaction; raw invite token/password are not persisted; a forced membership/audit failure rolls back Better Auth user/account/verification rows; ordinary `/api/auth/staff/sign-up/email` remains disabled; no session cookie is issued.
- [ ] **GREEN enrollment:** Add the private invitation-only Better Auth flow in `realm.ts`, keep public `createStaffAuthRealm` signup disabled, set `autoSignIn: false`, capture the Better Auth verification token only in memory and call Better Auth's internal `auth.api.verifyEmail({ query: { token } })` directly—never construct a URL or dispatch `AuthRealm.handle`. Do not call `createLocalOperatorStaffEnrollmentRealm` or `createLocalOperatorPortalEnrollmentService`.
- [ ] **Regression:** Rerun auth adapter tests, `pnpm auth:schema:verify`, the Stage 9 PostgreSQL suite and dependency/architecture checks. Assert auth realm schemas and Portal realm remain unchanged.

### Task 4: Wire strict Admin API routes, session capability and abuse controls

**Files:**
- Create: `apps/admin-api/src/staff-invitation-routes.ts`, `apps/admin-api/src/staff-invitation-rate-limit.ts`, `apps/admin-api/test/staff-invitation-routes.test.ts`, `apps/admin-api/test/staff-invitation-rate-limit.test.ts`.
- Modify: `apps/admin-api/src/main.ts`, `apps/admin-api/src/auth-bridge.ts`, `apps/admin-api/src/m1-routes.ts`, `apps/admin-api/test/auth-bridge.test.ts`, `apps/admin-api/test/m1-routes.test.ts`, `apps/admin-api/test/composed-m1-body-parser.test.ts`.

**Interfaces:** Register `GET /api/admin/staff/invitations`, `POST /api/admin/staff/invitations`, `POST /api/admin/staff/invitations/:invitationId/reissue`, `POST /api/admin/staff/invitations/:invitationId/revoke`, and `POST /api/staff/invitations/accept`. The invitation routes accept only Task 1 contracts and cookie-derived Staff sessions. Add server-derived `canInviteStaff` to `/api/staff/session-context` by evaluating the live `staff.invite` Agency permission and five-minute MFA condition; it is UI convenience only. Every API operation independently authorizes.

- [x] **RED routes:** Test strict bodies/queries, no caller-controlled Agency/actor/role, 401/403/404 enumeration-safe denials, no-store headers, host/origin rejection, duplicate acceptance and no-store on success/failure. Confirm route absence fails.
- [x] **GREEN routes/composition:** Register the dedicated route module in the existing Admin composition root; resolve `StaffIdentityEnrollmentPort` by calling `persistence.withTransactionContext(context, ...)` and constructing the auth adapter with that exact Kysely transaction. Do not mount an enrollment realm on the generic auth bridge. Use existing global Host/Origin/cache middleware.
- [x] **RED/GREEN rate limit:** Add a bounded per-client sliding-window limiter for unauthenticated acceptance POST attempts; Alex's implementation default is 10 invalid attempts per 15 minutes per trusted client key, with at most 4,096 tracked keys. Derive the key only after verifying the current Caddy→loopback API trust path; never trust arbitrary forwarded headers and do not change Caddy. Add no unauthenticated invitation-inspection endpoint. Test the limit, expiry, bounded memory and spoofed-header resistance.
- [x] **Regression:** Run `pnpm exec vitest run --config tooling/testing/vitest.config.ts apps/admin-api/test/staff-invitation-routes.test.ts apps/admin-api/test/staff-invitation-rate-limit.test.ts apps/admin-api/test/auth-bridge.test.ts apps/admin-api/test/m1-routes.test.ts apps/admin-api/test/composed-m1-body-parser.test.ts`; ensure logs, errors and response bodies never include token/password/verification-token values.

### Task 5: Build the Admin invitation, acceptance and first-time MFA UI

**Files:**
- Create: `apps/admin-web/src/staff-invitations-view.tsx`, `apps/admin-web/src/staff-invitation-api.ts`, `apps/admin-web/src/staff-invitations.css`, `apps/admin-web/src/vite-env.d.ts`, `apps/admin-web/test/staff-invitations-view.test.tsx`.
- Create: `tooling/testing/playwright/stage9-staff-invitations.spec.ts` under the existing Playwright `testDir`, for built-artifact browser/accessibility and no-JavaScript acceptance.
- Modify: `apps/admin-web/src/auth-client.ts`, `apps/admin-web/src/auth-view.tsx`, `apps/admin-web/src/app.tsx`, `apps/admin-web/src/api.ts`, `apps/admin-web/src/workspace-view.tsx`, `apps/admin-web/test/app.test.tsx`, `apps/admin-web/test/no-js-entry.test.ts`, `tooling/architecture/verify-dependency-universe.mjs`, `tooling/architecture/check.mjs`.

**Interfaces:** Add the `/staff/invitations` surface only when server context says `canInviteStaff`; the server remains the authority. Add the generic `/staff/invitations/accept` route. Issued/reissued raw tokens exist only in component memory and one response; list results never contain them. The acceptance form uses `method="post"`, `autocomplete="new-password"`, and sends token/name/password only in a JSON POST body. Use Better Auth's `getSession`, `twoFactor.enable`, `twoFactor.verifyTotp` and recovery-code support; no custom MFA crypto.

- [x] **RED component/API tests:** Test pending/empty/loading/error states, list pagination, issue/reissue/revoke lifecycle, one-time token display, no token after re-fetch/navigation, anonymous acceptance, strict invalid input and no role selector. Confirm missing view/API methods fail.
- [x] **GREEN invitation UI:** Implement the Portuguese (Portugal), light-mode-first, keyboard-accessible, narrow-screen invitation and acceptance views using real API results only. Show safe metadata; provide an explicit one-time token handoff view and never auto-copy or persist it.
- [x] **CSS side-effect typing:** Add the Admin-local Vite CSS module declaration so the root strict typecheck recognizes the scoped stylesheet without pulling unrelated Vite browser globals; verify with `pnpm run typecheck`.
- [x] **RED/GREEN MFA tests:** Test successful password sign-in without MFA enters setup; setup re-prompts password for Better Auth TOTP enablement; recovery codes appear once after enablement and explicit saved-confirmation precedes TOTP verification; invalid code does not unlock; confirmation clears recovery codes from React state; missing/stale session context never renders Admin data.
- [x] **GREEN MFA UI:** Add the first-time setup state to the existing auth flow. Confirm recovery codes are saved before verifying TOTP, then require successful TOTP verification before fetching usable Staff context. Keep passwords, TOTP URI/seed, codes and recovery codes out of browser storage, URLs, logs and screenshots.
- [x] **No-JavaScript/security check:** Preserve the existing static Staff login form as POST (never GET); verify no credentials enter URLs, and every component credential form declares POST. Use only synthetic test fixtures.
- [x] **Browser/accessibility:** Run Admin component tests and `corepack pnpm exec playwright test --config playwright.config.ts` against the built Admin artifact. Cover desktop and narrow-mobile invite/accept/MFA journeys, keyboard/focus, axe, no-JS credential POST, overflow, and network/console assertions using synthetic credentials/API responses only; do not capture secret-bearing screenshots.

### Task 6: Update authoritative docs and successor artifact contracts without rewriting history

**Files:**
- Modify: `docs/PRODUCT_BLUEPRINT.md`, `docs/DOMAIN_MODEL.md`, `docs/DATA_MODEL.md`, `docs/SECURITY_MODEL.md`, `docs/PERMISSIONS.md`, and the approved design's status line.
- Create: `docs/reviews/phase-1-m1/STAGE_9_SUCCESSOR_BASELINE_GEN11.json`, `deploy/contracts/stage-9-extension.v3.json`, `tooling/ci/stage-9-successor-baseline.mjs`, `tooling/ci/write-stage9-successor-baseline.mjs`, `tooling/ci/test-stage9-successor-baseline.mjs`.
- Modify: `package.json`, `tooling/ci/stage-9/constants.mjs`, `source-snapshot.mjs`, `test-source-snapshot.mjs`, `build-artifact.mjs`, `artifact-integrity.mjs`, `test-artifact.mjs`, `test-build-artifact.mjs`, `test-canonical-ci.mjs`; `tooling/deployment/verify-stage9-deployment-contract.mjs`, `test-stage9-deployment-contract.mjs`, `stage9-development-apply.mjs`, `test-stage9-development-apply.mjs`.

**Interfaces:** The new v3 deployment contract supersedes v2 by its computed SHA-256, keeps the same Stage 8 lineage and exact Caddy hash/hosts/listeners, records verified Gen10 as the expected active artifact at `0015_stage9_trip_workspace_writes`, and records candidate head `0016_stage9_staff_invitations`. Keep v1/v2 bytes immutable. Add `STAGE9_V3_CONTRACT_PATH` and a v3 hash; the artifact builder/integrity verifier/apply helper must consume v3, verify v1/v2 lineage and include the successor-baseline manifest. The additive successor-baseline verifier must preserve the Phase 0 manifest and original checker, prove the original 40/40 baseline from a clean exact `a5cac93bbaa0214456739f7b571795ca8080bfb6` archive, allow only the five approved product/domain/data/security/permissions document deltas, and verify their exact hashes plus the approved design semantics. Wire it into `protected-baseline:check`, formatting, and the canonical pre/post baseline gates. Source snapshot selection must include this approved spec, this implementation plan, and the successor-baseline manifest so they are hashed into the candidate.

- [ ] Update product/domain/data/security/permission documentation to describe the fixed lower-privilege role, StaffInvitation and append-only audit, token/email/MFA boundaries, retention/access classification, and no-public-signup rule. Update only the approved design status line; do not change approved semantics.
- [ ] **RED successor baseline:** Add tests for the exact predecessor pass, one changed Phase 0 protected file rejection, approved five-file-only delta, design-document drift, manifest hash/aggregate tampering, and immutable Phase 0 manifest bytes. Run the tests and observe the missing verifier/expected failures before implementation.
- [ ] **GREEN successor baseline:** Verify the exact Phase 0 predecessor archive using its original `tooling/ci/verify-protected-baseline.mjs`; compare all 40 protected paths and permit only the exact five approved document deltas. Generate the manifest without clobbering existing evidence, bind it to the approved spec and fixed semantic limits, and wire the additive verifier into `protected-baseline:check`, `format`, `format:check`, and canonical CI pre/post gates. Keep the Phase 0 manifest and original verifier unchanged.
- [ ] **RED contract tests:** Extend deployment-contract and artifact tests to require v3, its supersedes hash, the verified Gen10 predecessor, migration 0015→0016, the successor-baseline hash, same host allowlist/Caddy hash, no Caddy changes, and `stage10Actions: 0`; assert v1/v2 files remain byte-identical.
- [ ] **GREEN contract/artifact:** Add v3 and update constants, builder, integrity verifier and development apply helper to consume v3. Update current-release constants only from the verified Task 0 receipts; use the next unused candidate generation only after preserved receipts confirm it. Set migration path/head/hash from the actual 0016 file/checksum.
- [ ] **RED/GREEN source snapshot:** Extend `selectedPath` and `test-source-snapshot.mjs` to include `docs/superpowers/specs/2026-11-02-stage9-staff-invitation-design.md`, this implementation plan and the successor-baseline manifest; prove drift changes the snapshot and unrelated docs remain excluded.
- [ ] Run `pnpm run format:check`, `pnpm stage9:successor-baseline:verify`, `pnpm stage9:deployment-contract:verify`, `pnpm test:stage9:artifact`, `pnpm db:migrations:verify`, the Stage 9 security scan, and `pnpm architecture:check`.
- [ ] Verify the v3 contract contains no Caddy/DNS/firewall/host/port changes, no credentials, and no Stage 10 action. Do not mutate CT200 in this task.

### Task 7: Qualify, deploy and issue the QA invitation only after all gates

**Files:** Candidate/evidence under unique `.hermes/state/stage9-gen11-*` paths only if Gen10 is confirmed as the immediate predecessor; no production data or code changes outside Tasks 1–6.

**Interfaces:** Build once locally with `node tooling/ci/stage-9/build-artifact.mjs <unique-gen11-archive-path> gen11`; validate that exact artifact and v3 contract; invoke the existing canonical runner with explicit artifact/archive/extracted-root/build-receipt/preflight/Stage8 artifact arguments. The canonical runner verifies candidate inputs before consuming its one run. Use the repository's approved CT200 DEVELOPMENT apply procedure only after all preconditions pass.

- [ ] Run local focused contracts/application/API/UI tests, `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, `pnpm run architecture:check`, `pnpm run test:unit`, `pnpm run auth:schema:verify`, `pnpm run db:migrations:verify`, and the pinned PostgreSQL 18.6 Stage 9 integration suite.
- [ ] Build and extract the candidate locally; verify its exact artifact digest, source snapshot, v3 deployment contract, migration checksum, no-secret scan and Stage 8 predecessor. Never compile on CT200.
- [ ] Produce and preserve the real candidate-linked preflight and exactly ten hash-linked qualification receipts. Run the current `verifyStage9CandidateInputs` path before the new canonical CI. Stop on missing/duplicate receipts, source/artifact/predecessor mismatch, failed backup/restore proof, changed migration head/release, disk shortfall or unresolved output; do not fabricate evidence.
- [ ] Run the successor's canonical CI exactly once. Preserve full log/receipt and verify PASS for every gate; if a gate fails, do not rerun the consumed candidate—fix source and create a fresh successor with new evidence.
- [ ] Immediately before remote migration, repeat the read-only live preflight and approved isolated backup/restore proof without overwriting the preserved recovery backup. Confirm Gen10 is still active at head 0015 and Caddy/listeners unchanged; stop on any divergence.
- [ ] Apply the exact qualified artifact and migration to CT200 DEVELOPMENT only through `tooling/deployment/stage9-development-apply.mjs` and the approved operator procedure. Do not alter Caddy, DNS, firewall or ports; restart only the contract-authorized Admin/Portal APIs, not Worker/Caddy. Read back exact release digest, migration head 0016, active services and `stage10Actions: 0`.
- [ ] Immediately before invitation issue, ask Rui for the target email. Issue/revoke/reissue only through the Staff UI/API using authorized Owner + recent MFA; never use SQL or first-Owner bootstrap. The user selects the QA password in the browser's Bitwarden prompt; the raw invite token is handed off only through the approved secure vault channel. If the required Owner session/secure channel is unavailable, stop rather than bypass it or ask for credentials in chat.
- [ ] Accept the invitation through the generic POST flow; verify lower-privilege Staff membership, exact `trip-operations-v1` permissions, TOTP enabled, no usable Admin context before MFA, no Owner capability, and no public signup.
- [ ] Keep the two user-tracked tasks pending until the dedicated login exists and Rui's manual QA is complete. Rui's authenticated Admin→Publish→Portal v1/v2 and no-grant denial remain manual QA; Hermes live-browser acceptance stays separate and pending unless the existing approved route is reachable without network changes. Do not send credentials by Telegram.

**Verification:** One successor candidate, one new canonical CI receipt, exact deployment readback, database head 0016, no Stage 10 actions, dedicated invitation-created Staff identity with exact least-privilege role, and no credential in chat/evidence. If any acceptance criterion is unavailable, report the precise blocker and leave both tracked tasks pending.
