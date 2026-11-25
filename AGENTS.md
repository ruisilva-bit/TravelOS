# AGENTS.md — TravelOS Engineering Constitution

This constitution is mirrored in `docs/reviews/AGENTS_CANDIDATE.md` for Phase 0 review traceability. That mirror records the accepted Phase 0 text; later amendments made through an ADR (currently ADR-015 in §9) appear only here.

This file governs all future human, Hermes and Codex work in this repository.

## 1. Authority and phase control

Read, in order, before changing TravelOS:

1. `IDEA.md`
2. `docs/PRODUCT_BLUEPRINT.md`
3. `docs/DOMAIN_MODEL.md`
4. the canonical document for the area under change
5. governing accepted ADRs in `docs/adr/`
6. this constitution

Accepted ADRs are immutable records. Change architecture by adding a superseding ADR and updating every dependent document/test—not by silently diverging in code.

Phase 0 documentation does not authorize application scaffolding or infrastructure. Phase 1 scope starts only after the recorded GO gate and is limited to the accepted milestone. Never claim a build, test, migration, deployment or runtime result without executing and verifying it.

## 2. Non-negotiable product invariants

- One root Agency normally has one dedicated instance, CT and independent PostgreSQL database.
- All instances run one signed versioned code artifact and one ordered migration chain.
- Customer-specific code, schema, migrations, patches and builds are forbidden.
- TravelOS is a modular monolith. Do not create a microservice/broker/cache/control plane without an accepted ADR and measured need.
- Portal Trip presentation never reads mutable workspace state.
- Preview is a pure read with zero publication/audit/activity/outbox/job writes.
- Publish creates an immutable allowlisted snapshot using expected workspace revision + projection hash + idempotency key.
- Portal contracts are independently authored allowlists. Never use ORM/domain types, object spread, `Omit`, denylist serialization or unknown-field passthrough.
- `INTERNAL_ONLY` fields have no Portal contract/source field and no override.
- StaffPrincipal, PortalPrincipal, Person, Customer and Traveller are different concepts. Email equality grants nothing.
- Portal Trip access is explicit; document access always requires a separate active DocumentGrant.
- Reservation and Itinerary Item remain separate, many-to-many through an explicit same-Agency/same-Trip link.
- Money uses `bigint` minor units + currency; rates use exact Decimal. JavaScript/SQL float and implicit numeric coercion are forbidden.
- `HALF_UP` is only the ordinary V1 commercial-pricing default. Tax/fiscal, FX, payment, supplier and accounting contexts select and record explicit policies; unknown required policy fails closed.
- Activity, Audit, domain events, outbox, jobs and application logs are separate systems.
- Domain/application modules import no vendor SDK, NestJS, Kysely, HTTP or database row type.
- AI is optional and outside the core; deterministic automation comes first.

## 3. Architecture and source boundaries

Approved stack:

- TypeScript, pinned active Node.js LTS
- React + Vite static SPAs for Admin and Portal
- NestJS Admin API and separately composed Portal API
- PostgreSQL, Kysely/`pg`, `node-pg-migrate`
- two isolated Better Auth realms
- transactional outbox + TravelOS-owned PostgreSQL job executor
- pnpm workspaces only; no Turborepo until its ADR trigger
- Tailwind and owned accessible design-system source
- Zod, Vitest, Playwright
- Caddy + systemd native CT deployment

Dependency direction is:

```text
domain <- application <- adapters <- composition root
```

Use capability-oriented modules and explicit mappers. Keep the shared kernel tiny. Do not create `common`, `shared`, `utils`, generic repository or pass-through abstractions as dumping grounds. Package/module dependencies must be cycle-free and CI-enforced.

The Portal API/package graph may depend only on Portal Access, Customer Presentation and grant-safe Documents contracts. It uses a restricted PostgreSQL role with no workspace `SELECT` privilege. No synchronous Admin API ↔ Portal API dependency.

## 4. Domain and data rules

- Every Agency-owned row carries `agency_id`; cross-record references use composite same-Agency constraints even in a dedicated database.
- Trip-owned Reservation–Item links additionally prove the same `trip_id`.
- Mutable aggregate updates use optimistic `lock_version`; stale writes return typed conflict, never last-write-wins.
- Publication-relevant mutations increment Trip `workspace_revision` in the same transaction.
- Core/queryable data is relational/typed. JSONB is limited to named, versioned bounded payloads documented in `DATA_MODEL.md`.
- Do not blanket soft-delete. Use domain states, explicit archive/correction or policy hard deletion.
- Travel local times retain local date/time + IANA zone + derived instant where possible.
- Every new field declares owner, classification, Portal eligibility, retention, audit and access patterns.
- ORM/database entities never become API/domain contracts.

## 5. Security rules

- Default deny. Authorize server-side inside every command/query/repository path; UI hiding is not enforcement.
- Business code checks permission IDs and scope, never role names.
- Production Staff MFA and recent-MFA controls are mandatory as specified.
- Never implement password hashing, MFA or session cryptography manually.
- Cookies/tables/secrets/routes for Staff and Portal remain distinct; browser bearer-token storage is forbidden.
- No hidden fleet/support super-user. Support access is explicit, local, expiring and audited.
- No secrets, tokens, credentials, document content, raw provider payloads or unnecessary PII in source, config manifests, jobs, publications, logs, audit, screenshots or fixtures.
- Files are private immutable provider objects, encrypted at rest and quarantined/scanned before AVAILABLE. `PrivateFilesystemProvider` is an adapter only; domain/application contracts expose opaque IDs, never paths/filesystem APIs. User filenames are metadata, never storage paths.
- Every protected Portal file list/download rechecks session, TripAccessGrant where applicable, DocumentGrant and authorization epoch through the Portal API. V1 issues no direct/signed bearer URL for Confidential/Restricted documents.
- Exact manifest host allowlists are enforced independently at Caddy and API before branding/auth/data lookup. A request host never selects an Agency.
- Privacy deletion removes active payload access and preserves lawful evidence; it does not claim immediate removal from retained encrypted backups. Backup retention/expiry and isolated restore reconciliation are mandatory. Recovery must establish coverage of the interval after the selected backup; absence in the restored database is not proof, and unknown coverage keeps affected payloads unavailable. Stronger crypto-erasure requires a justified superseding ADR.
- Webhooks require signature/timestamp/replay verification and an idempotent inbox before domain commands.

## 6. Transactions, outbox and jobs

- Business state and immutable outbox message commit in one PostgreSQL transaction.
- Delivery is at-least-once. Every handler/provider effect must prove idempotency or durable business-key reconciliation before retry; ambiguous outcomes are never blindly replayed.
- External network calls do not occur inside core transactions.
- Job payloads carry IDs/version, not sensitive aggregate dumps.
- Use bounded timeout/retry/backoff/jitter, per-task leases/heartbeats with compare-and-swap ownership, concurrency limits and dead-letter/`UNKNOWN_OUTCOME` quarantine.
- Publication success never depends on notification delivery.

## 7. API and UI contracts

- Admin and Portal DTOs are separate. Reject unknown inputs at trust boundaries.
- REST mutations use expected versions and idempotency where retryable.
- Money/bigint values are strings in JSON.
- All collections are bounded/cursor-paginated.
- Runtime branding/config is allowlisted/published and contains no secret; do not rebuild per Agency.
- Preview UI must be unmistakably not published; stale preview cannot silently rebase.
- Forbidden data must be absent from DOM/network, not rendered and hidden.
- Meet WCAG 2.2 AA critical-path, keyboard, 320px/reflow, focus, contrast and reduced-motion criteria.

## 8. Migration and deployment rules

- One immutable/checksummed migration chain owns TravelOS, both Better Auth realms and job-runtime schema. Never edit an applied migration; dependency migrate/synchronize commands are forbidden in runtime/deployment.
- Review final SQL. Test empty + supported prior releases + representative data.
- Use expand → resumable backfill → verify/switch → later contract.
- Set lock/statement timeouts; high-risk work requires preflight, headroom and verified restore point.
- Application startup never auto-runs migrations.
- Rollback means compatible artifact rollback or verified restore/forward fix—not blind destructive down migration.
- Build once in CI and promote the same signed digest. Do not install/compile in the customer-specific deployment path.
- Do not hand-edit a customer server. Provision/configure from versioned manifests and secret references.
- CT 200 is DEVELOPMENT; never treat it as production or use real production data.
- DNS/TLS/firewall/public exposure, production credentials and destructive operations require explicit approval.

## 9. Required delivery gates

For every change, select and execute the applicable evidence:

- format/lint/typecheck and architecture boundary checks;
- domain/property tests for invariants/state/money/permissions;
- real pinned PostgreSQL integration/constraint/privilege tests;
- migration matrix and checksums;
- auth/security/IDOR/cross-realm/document-grant abuse tests;
- snapshot schema/golden/INTERNAL_ONLY sentinel tests;
- outbox/job duplicate/crash/retry/replay tests;
- Playwright desktop + narrow mobile + no-JavaScript credential safety + accessibility;
- production build and exact-artifact smoke test;
- deployment/upgrade/backup/restore tests when operational scope changes, including exact-host rejection, backup expiry and privacy-deletion reconciliation where applicable.

Use synthetic disposable fixtures and clean them. A mocked unit test cannot prove PostgreSQL privileges/constraints or a browser security boundary. Keep Kanban/status truthful and exactly one execution task in progress.

The required composition of these gates is `pnpm ci:verify` (ADR-015): stage-free current-tree checks, including the classified current-source sensitive-data scan and real PostgreSQL 18.6 integration. M1 stage-frozen verifiers are historical; never edit them to fit new code. Every new entry in `tooling/ci/current-source-findings.json` is a security-relevant change and needs a category and rationale. New evidence goes to CI output/artifacts and reviews, not `docs/evidence/**`.

## 10. Definition of done

A change is done only when:

1. it stays within the approved milestone;
2. domain terminology and authoritative docs/ADRs agree;
3. security/data/publication/migration consequences are addressed;
4. implementation and inverse/failure/concurrency paths are tested;
5. applicable CI/build/runtime/deployment evidence is real and recorded;
6. docs/ADRs/contracts are updated before or with the change;
7. no customer fork, hidden manual step, secret or unverified claim is introduced.

Stop and request a new ADR/product decision when a change would violate an invariant or an unresolved security/data-integrity question appears. Do not “temporarily” bypass the constitution to make a demo pass.
