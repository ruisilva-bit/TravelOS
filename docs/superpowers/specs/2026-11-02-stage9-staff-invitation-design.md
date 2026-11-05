# Stage 9 Secure Staff Invitation for QA — Design

**Status:** Approved by Rui for implementation on 2026-11-02. Tasks 0–5 are complete locally; Task 6 is in progress, and successor qualification, DEVELOPMENT QA and final review remain pending.

## Intent

Provide a supported, audited way for an authorized Staff member to invite a dedicated, lower-privilege Staff account for Stage 9 QA in CT200 DEVELOPMENT. The account must be able to exercise the real Admin workspace and publication/grant flows without reusing the existing Owner or gaining Owner-level administration.

Rui approved this as a Stage 9 scope extension and approved this complete design on 2026-11-02: a durable, supported Admin UI/API Staff-invitation capability, not a one-off development provisioning operation. Account creation remains gated on the successor candidate and its new canonical CI.

This closes the current gap: the first-Owner invitation has already been consumed; `createStaffAuthRealm` disables public sign-up; `createLocalOperatorStaffEnrollmentRealm` is explicitly local-operator-only; and there is no Staff invitation use case, HTTP route, or UI. The Stage 9 Admin routes already provide workspace create/read/write, preview/publish, and explicit TripAccessGrant operations. Staff session context is created only for a Staff principal with MFA enabled, but the current Admin UI has a login/challenge view and no first-time MFA enrollment view.

## Goals

1. Issue, inspect, revoke and reissue single-use Staff invitations through the Admin UI and API.
2. Require the live `staff.invite` permission at Agency scope and recent MFA (maximum age 5 minutes) for invitation administration. Authorization is server-side and permission-ID-based; never check a role name.
3. Keep public Staff sign-up disabled. Accept an account only through a valid invitation bound to its target email and fixed, code-owned role template.
4. Create the Staff identity, email-verification state, active Agency membership, role assignment, invitation consumption and audit event atomically in PostgreSQL.
5. Enable a newly invited user to finish Better Auth TOTP setup and save recovery codes before receiving any usable Admin authorization context.
6. Give the QA account only the capabilities needed for Stage 9 workspace editing, preview/publish and explicit Portal-grant management.
7. Keep raw credentials and invitation tokens out of chat, Telegram, URLs, browser storage, logs, analytics, screenshots and evidence.

## Non-goals

- Reusing or weakening the existing Owner account; first-Owner bootstrap; direct SQL provisioning.
- Public Staff registration, arbitrary role/permission selection, or an Owner-role invitation.
- Portal user enrollment, Portal API changes, implicit Portal access, or reading mutable Admin workspace data from Portal.
- Adding an email vendor/SMTP integration, password/MFA cryptography, or a new generic audit/outbox platform.
- Stage 10 work; production deployment; DNS, firewall, host allowlist, Caddy or listener changes; push or merge.

## Proposed user flow

### 1. Owner issues an invitation

- An authenticated Staff user opens a small **Convites de equipa** surface in the Admin SPA. The UI shows it only when a server-derived `canInviteStaff` capability is true; every read/write endpoint independently reauthorizes.
- The user enters the target email. The server derives Agency and actor from the Staff session, requires Agency-scoped `staff.invite` and recent MFA, and creates an invitation for the single inviteable template `trip-operations-v1`. The client cannot submit a role ID, permission list, Agency ID, issuer ID, or expiry.
- Generate a cryptographically random, high-entropy one-time token. Store only its SHA-256 digest. The raw token is returned once to the authorized issuer, shown once in the UI, and never recoverable from a later list/read. A generic enrollment page URL contains no token; the token is submitted only in a POST body. The same browser may continue enrollment using in-memory state, or the issuer may deliver the token through Rui's approved secure vault channel. No token is sent by chat or Telegram.
- Because the repository has no email sender, delivery is an explicit Owner-controlled out-of-band step. The invitation is bound to the email entered by the issuer. The acceptance service uses that Owner-approved, token-bound email as the Better Auth verification ceremony, following the existing controlled invitation pattern; it must not claim independent mailbox proof. A later email-delivery feature would need its own reviewed design.
- Invitations expire after 60 minutes. Reissue creates a new token and invalidates the previous invitation; the old raw token is never shown again. The issuer can revoke a pending invitation. The UI lists only safe metadata (target email, status, expiry and timestamps).

### 2. Invitee accepts and enrolls

- The invitee opens the generic Admin invitation route and submits the one-time token, display name and a new password. The email is recovered from the invitation only after a valid token is supplied; it cannot be changed by the caller.
- Inputs use strict allowlists. The acceptance operation validates digest, pending state, expiry, Agency, role template and target email; rejects duplicate Staff identity; and serializes concurrent acceptance so at most one request succeeds.
- A dedicated internal Staff-invitation enrollment service may invoke Better Auth's sign-up and email-verification mechanics only inside the invitation acceptance transaction. It does not expose or return a generic `AuthRealm.handle`, is never mounted on the HTTP bridge, and does not use `createLocalOperatorStaffEnrollmentRealm`.
- On success, the invitation is consumed and the new Staff identity, active membership, Agency-scoped role assignment and immutable audit event commit in the same transaction. Any failure rolls all of them back. No session is auto-issued by enrollment; the invitee signs in normally.

### 3. Invitee enables MFA before Admin use

- The Admin SPA distinguishes an authenticated Better Auth session without Staff authorization context from an anonymous session. If TOTP is not yet enabled, it shows a first-time MFA setup step instead of looping back to the password form.
- Use Better Auth's existing TOTP enable/verify and recovery-code functions only. Present the setup key/URI and recovery codes once to the user, require a successful TOTP verification, and do not persist them in frontend storage or logs. Do not implement MFA cryptography or expose a bypass.
- Until MFA is enabled and verified, `/api/staff/session-context` remains unavailable and every Admin business endpoint remains denied. After verification, the existing Staff session-context and MFA challenge flow applies.
- The password form must use a non-GET POST path with `autocomplete="new-password"` so the user can save it through Bitwarden's secure browser prompt. The user chooses the password and authenticator secret in the browser; neither is requested in chat.

### 4. Stage 9 QA

The invited `Trip Operations` account can use the existing Admin Stage 9 workflows to create/edit a workspace, preview and publish immutable snapshots, and manage explicit TripAccessGrants. It cannot read workspace data from the Portal API; Portal continues to read only authorized Published Snapshots and requires a separate active DocumentGrant for documents.

## Fixed lower-privilege role

Seed one Agency-owned, code-owned `trip-operations-v1` system template for the supported Stage 9 workflow. It grants exactly these Agency-scoped permissions:

- `agency.view` — existing Admin session-context gate.
- `customer.edit`, `traveller.edit`, `trip.view`, `trip.edit` — existing Stage 9 workspace-create/read/write operations.
- `trip.preview`, `trip.publish` — existing preview/publish operations.
- `trip.access.manage` — explicit Portal TripAccessGrant issue/revoke.

It grants **none** of `staff.invite`, `staff.view`, `staff.manage_roles`, `staff.suspend`, `agency.manage_settings`, finance, reservation, `trip.withdraw_publication`, or `runtime_acceptance.fixture.manage`. The API never accepts arbitrary role IDs or permissions. Tests must assert both the exact positive permission set and the absence of Owner/admin/sensitive capabilities. If a current Stage 9 route proves to require another permission, stop and re-evaluate least privilege rather than silently broadening the template.

## Data, audit and security boundaries

- Add a forward-only, checksummed migration after the current Stage 9 head. Invitation rows are Agency-owned and enforce same-Agency references. Store target email, role reference, digest, state, expiry, issuer and consumption/revocation timestamps; never store the raw token or password.
- Add an append-only `audit.staff_invitation_event` table (or use an existing equivalent if code inspection proves one is already the canonical Staff security audit sink). Record issue, reissue, revoke, consume and expiry events with Agency, invitation, actor and timestamp; never record raw tokens, passwords, MFA seeds, recovery codes or request bodies. Invitation state changes and their audit events commit together.
- State transitions are `PENDING -> CONSUMED | REVOKED | EXPIRED`; only one acceptance may consume a token. Invalid/expired/revoked tokens fail closed with enumeration-safe responses. Apply the existing Admin Host/Origin/CSRF policy and rate-limit unauthenticated inspection/acceptance; use `Cache-Control: no-store`.
- Invitation tokens and passwords appear only in POST bodies. No credential-bearing URL, query parameter, local/session storage, request logging, telemetry or screenshots. Native form submission with JavaScript disabled must never fall back to GET.
- Leave `tooling/auth/bootstrap-first-owner.ts`, existing auth realm separation, portal schema/role and Caddy/host allowlists unchanged.

## UI direction

Extend the existing Admin light-mode, Portuguese (Portugal), accessible forms rather than introducing a new design system. Add an issuer view with pending-invite lifecycle actions and a one-time token screen; add a generic acceptance form and first-time MFA setup/recovery-code screen. Use explicit loading/error/success states, keyboard/focus behavior, narrow-screen layout and password-manager autocomplete. UI hiding is convenience only; the API remains the authorization boundary.

## Delivery and acceptance evidence

- TDD for invitation validation, authorization, role allowlist, state transitions, concurrency, atomic rollback, audit, public-sign-up denial, MFA enrollment, no-JavaScript credential safety and the Admin UI lifecycle.
- Real pinned PostgreSQL integration using the Admin runtime role: migration from empty and supported prior head, same-Agency constraints, privilege checks, invitation issue/revoke/reissue/expiry, duplicate/concurrent acceptance, transaction rollback, audit immutability, session epoch/MFA gates, and exact role permissions.
- Architecture/dependency checks confirm domain/application layers import no Better Auth, NestJS, Kysely, HTTP or DB row types; the internal enrollment adapter remains isolated from the generic HTTP auth bridge.
- Local lint/typecheck/build and the candidate's new canonical CI are run once against the successor artifact. Do not rerun the already-consumed gen10 CI.
- CT200 DEVELOPMENT mutation only after candidate/source/artifact/predecessor verification, a fresh read-only preflight, approved backup/restore proof, and the repository's approved apply procedure. Compile locally, not on CT200. Preserve the pre-migration backup. No Caddy/DNS/firewall/production/push/merge/Stage 10 actions.
- After deployment, create the dedicated account through the invitation flow, using the target email supplied by Rui before issuance and a secure password-manager prompt. Rui owns manual browser QA; Hermes live-browser acceptance remains separate and pending unless the approved route is reachable without host/network changes.

## Open input

The target email is intentionally not part of this design. Ask Rui for it immediately before issuing the final invitation. The existing Owner identity is not reused for QA.
