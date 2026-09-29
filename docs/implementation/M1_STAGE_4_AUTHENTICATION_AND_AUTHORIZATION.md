# Phase 1 M1 — Stage 4 authentication and Staff authorization

Status: implementation and qualification contract. Stage 4 is not closed until its evidence index, candidate freeze and independent review agree on the exact bytes. It does not authorize application deployment, public exposure, production credentials, customer data, Stage 5 domain schema or Portal grants.

## Scope

Stage 4 adds the reviewed authentication and authorization foundation that Stage 1 assigned to this milestone:

- independent Staff and Portal Better Auth realms at the adapter boundary;
- one TravelOS-owned, checksummed migration chain for both realm tables;
- Staff-only root Agency bootstrap, first Owner invitation/enrolment mechanics and authorization state;
- default-deny Staff authorization snapshots with Agency proof, permission/scope evaluation, authorization epoch and recent-MFA inputs;
- SQL least privilege that lets Admin runtime use Staff mechanics while Portal and Worker runtime identities cannot read them, and lets Portal runtime use Portal mechanics while Admin and Worker cannot read them;
- a protected local-only Owner bootstrap CLI for DEVELOPMENT, with sensitive values entered through a TTY rather than command arguments.

No Staff or Portal identity, root Agency, Owner invitation or customer data is created by the migration itself. The controlled CT 200 validation leaves all of those counts at zero. First Owner issue/enrolment remains an explicit local operator ceremony and was not performed against CT 200.

## Governing boundaries

`PERMISSIONS.md`, `SECURITY_MODEL.md`, `DATA_MODEL.md`, ADR-007 and ADR-012 remain authoritative. In particular:

- StaffPrincipal and PortalPrincipal remain separate concepts; normalized-email equality is not an authorization bridge.
- Better Auth is used only in `@travelos/auth-adapters` and delivery adapters. Domain/application modules depend on TravelOS ports and data structures, not Better Auth types.
- Browser bearer-token storage, custom password hashing, custom MFA cryptography, runtime Better Auth schema synchronization and `auth migrate` are forbidden.
- Portal authorization remains grant-based and is later scope. Stage 4 establishes only Portal identity mechanics, not TripAccessGrant, DocumentGrant, published-trip access or mutable-workspace access.
- Production authentication controls (TLS, host enforcement at Caddy and API, hardened systemd services, rate limiting, session lifecycle operations, no-JavaScript browser tests and production MFA operation) remain later release/security gates.

## Realm schema and migration authority

`migrations/0004_authentication_realms.cjs`, `migrations/0005_root_agency_staff_authorization.cjs` and the corrective `0006_stage4_authorization_hardening.cjs` extend the immutable chain to schema version 6. `migrations/checksums.json` pins every migration before the runner connects. The migration runner verifies the non-superuser `travelos_migrator` session, explicitly assumes NOLOGIN `travelos_owner`, uses `pg_catalog` search path, applies all pending migrations in one transaction under the advisory lock, and reports bounded redacted diagnostics.

Migration `0004` creates separate tables:

| Realm | Tables |
|---|---|
| Staff | `staff_user`, `staff_session`, `staff_account`, `staff_verification`, `staff_two_factor` |
| Portal | `portal_user`, `portal_session`, `portal_account`, `portal_verification` |

The Staff and Portal table sets are physically disjoint. The Staff realm includes library-managed TOTP/recovery-code support; the Portal realm does not inherit Staff MFA state. `tooling/auth/verify-better-auth-schema-drift.ts` compares the pinned Better Auth declarations with this migration-owned layout and fails closed on drift.

Migration `0005` creates the Stage 4 TravelOS-owned authorization records:

- `organization.agency` and `organization.agency_bootstrap_audit` enforce one root Agency and retain safe bootstrap events;
- `staff_access.staff_membership` and `staff_session_context` bind a StaffPrincipal to an active Agency and server-side authorization epoch/recent-MFA context;
- `role`, `role_permission` and `role_assignment` model explicit Agency or future OrganizationUnit scope; code evaluates permission identifiers, never role names;
- `operator_bootstrap_invitation` stores only the SHA-256 digest of a short-lived first-Owner token, with a safe audit trail.

Database triggers advance the authorization epoch after membership-state, role-assignment and role-permission changes. They reject removal/deactivation or reassignment of the last active Owner under a transaction-scoped per-Agency advisory lock, and reject mutation of the reserved Owner template identity. Bootstrap audit rows are append-only to runtime identities. These are database backstops; every protected request still reauthorizes server-side.

## Runtime and adapter boundary

`@travelos/auth-adapters` exports distinct Staff, local-enrolment Staff and Portal realm constructors, fixed paths and a host/origin-filtering HTTP bridge. The Staff and Portal API bridges compose their own realms and do not share cookies, table prefixes or key material. The Staff bridge exposes an identity-only session contract to the application layer; authorization then loads a fresh Staff snapshot and compares Agency and authorization epoch before permission/scope evaluation.

The database capability groups are inherited by separate LOGIN identities:

| Login identity | Capability group | Stage 4 access |
|---|---|---|
| `travelos_admin_api` | `travelos_admin_runtime` | Staff realm and Staff authorization tables |
| `travelos_portal_api` | `travelos_portal_runtime` | Portal realm tables only |
| `travelos_worker` | `travelos_worker_runtime` | neither identity realm nor Staff authorization tables |

The controlled CT validation exercised real login credentials through a loopback-only SSH tunnel. It observed Admin→Staff and Portal→Portal reads allowed, and Admin→Portal, Portal→Staff, Worker→Staff and Worker→Portal reads denied with PostgreSQL `42501`. No runtime role receives execute privilege on the internal trigger functions.

## Local Owner bootstrap

`tooling/auth/bootstrap-first-owner.ts` accepts only `issue-first-owner` and `enroll-first-owner` through a local interactive protected TTY. It rejects password/token/invitation/secret command-line arguments. The raw one-time invitation token is shown once to the local operator; the database retains its digest only. The enrolment path validates invitation email, creates the Staff identity through the local enrolment realm, then consumes the invitation transactionally. It is intentionally not a public HTTP endpoint and does not bypass future production MFA/session/host gates.

## Qualification performed

The evidence directory `docs/evidence/phase-1-m1/stage-4/` retains only sanitized, synthetic or structural results:

1. pinned PostgreSQL 18.6 disposable qualification ran the six Stage 4 integration cases, including isolated realm SQL access, root serialization, digest-only invitation persistence, real TOTP/recovery-code flow, stale epoch rejection, last-Owner protection and wrong host/origin/cookie rejection;
2. migration checksum and Better Auth schema-drift verifiers passed;
3. DEVELOPMENT CT 200 (`travelos-dev`) received only migrations `0004` and `0005` after a restricted backup preflight and a full isolated restore probe of the pre-migration archive;
4. CT post-migration validation checked the five-entry ledger through `0005_root_agency_staff_authorization`, 18 Stage 4 tables owned by `travelos_owner`, six authorization functions/triggers, zero PUBLIC table grants, real runtime SQL isolation and rollback-only invariant probes; no synthetic identity or Agency row persisted. The corrective `0006` migration requires the same controlled preflight/restore/migration/validation sequence before Stage 4 closure;
5. all temporary CT scripts, the pre-migration dump, temporary SSH key/authorized-key entry and loopback tunnel were removed and revocation was verified.

The CT remains DEVELOPMENT, local PostgreSQL remains loopback-only, and no application process was deployed, restarted, exposed, or configured with a new credential during Stage 4.

## Deferred gates

Stage 4 does not close or imply these later requirements:

- production host/TLS/Caddy enforcement and public exposure approval;
- deployment of one signed artifact, systemd hardening and exact-artifact smoke;
- production Staff MFA policy operation, throttling, session revocation workflows and browser no-JavaScript credential-safety tests;
- Portal TripAccessGrant, DocumentGrant, presentation-only data path, IDOR and document-download abuse tests;
- complete permission registry/template seeding, OrganizationUnit persistence and business permission use cases;
- audit/outbox/activity/job systems, document security and privacy/backup-retention operations.

Any change to the pinned Better Auth version/configuration or either realm schema requires renewed generated-SQL review, checksum update, schema-drift verification, empty/prior-release migration qualification and security review. There is no customer-specific code, migration or schema path.
