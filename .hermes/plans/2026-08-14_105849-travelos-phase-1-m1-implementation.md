# TravelOS Phase 1 M1 — Secure Published Trip Walking Skeleton Implementation Plan

> **For Alex/Hermes:** Execute this plan directly, one gated stage at a time. Keep exactly one execution task in progress. Delegation or parallel worktrees require Rui's explicit authorization. Stop for a superseding ADR if implementation contradicts an Accepted decision.

**Goal:** Deliver the smallest reproducible DEVELOPMENT-only vertical slice that proves separate Staff/Portal identity realms, structured Flight and Accommodation data, pure Preview, concurrency-safe immutable Publish v1/v2, a Portal restricted to the active published read model, retained publication history, and the required security/data/deployment foundations.

**Architecture:** One TypeScript modular monolith and one ordered migration chain produce five deployables from one release: Admin SPA, Portal SPA, Admin API, Portal API, and Worker. Source dependencies remain `domain <- application <- adapters <- composition root`; the Portal package graph and PostgreSQL role are both unable to read mutable workspace state. Preview and Publish share one pure allowlist projection assembler, while only Publish writes an immutable snapshot, advances the current pointer, and emits Audit/domain/outbox facts in one serializable transaction.

**Tech stack:** Pinned active Node.js LTS; pnpm workspaces; React + Vite; NestJS; PostgreSQL; Kysely/`pg`; `node-pg-migrate`; two isolated Better Auth instances; Zod; exact `bigint` Money plus `decimal.js`; Vitest; Playwright; Tailwind and owned accessible components; TravelOS-owned PostgreSQL outbox/job executor; Caddy + systemd. **No exact version is guessed in this plan:** Stage 1 selects and validates every pin from official sources and a compatibility probe.

---

## 0. Authority, present state, and non-actions

### Authoritative inputs, read in constitution order

1. `IDEA.md`
2. `docs/PRODUCT_BLUEPRINT.md`
3. `docs/DOMAIN_MODEL.md`
4. `docs/ARCHITECTURE.md`
5. `docs/DEPLOYMENT_MODEL.md`
6. `docs/DATA_MODEL.md`
7. `docs/PUBLISHING_MODEL.md`
8. `docs/PERMISSIONS.md`
9. `docs/SECURITY_MODEL.md`
10. `docs/DESIGN_SYSTEM.md`
11. Accepted ADR-001 through ADR-014 in `docs/adr/`
12. `AGENTS.md`
13. `docs/reviews/PHASE_0_ACCEPTED_BASELINE.md`, `PHASE_0_FINAL_GATE.md`, and the carried review gates

The Accepted baseline authorizes **Phase 1 M1 only**. It does not authorize production, public exposure, real customer/protected data, or divergence from an Accepted ADR.

### Repository state observed while planning

- The repository is documentation-only: no `package.json`, lockfile, TypeScript source, workspace, migration, CI workflow, or deployable exists.
- The current directory has no Git metadata (`git status` reports “Not a git repository”). Repository initialization/remote ownership is therefore an explicit Stage 1 decision input, not an assumption.
- CT 200 is documented as `travelos-dev`, `192.168.1.200`, DEVELOPMENT. It was not inspected or changed in this planning turn.

### Actions explicitly not performed in this turn

- No `web_search` retry.
- No CT 200 access or modification.
- No package installation or version pin.
- No PostgreSQL creation, migration, database role, or credential change.
- No application scaffold, source code, Git initialization, CI workflow, build, or deployment.
- The only repository write is this plan under `.hermes/plans/`.

## 1. Fixed M1 scope

### Required product flow

```text
Agency
→ invited/authenticated Staff Principal
→ minimal Person + Customer + Trip Traveller continuity
→ Trip
→ Flight OPO → PMI + Accommodation Hotel A
→ separate Reservation linked to both items
→ Preview candidate
→ Publish v1
→ explicitly granted Portal Principal reads v1
→ Staff changes customer-visible Accommodation to Hotel B
→ Portal still reads v1
→ Preview v2
→ stale candidate is rejected
→ Publish v2
→ Portal reads v2
→ staff can inspect immutable v1 and v2 history
```

The minimal Person, Customer, TripTraveller, Reservation, and ReservationItemLink records are included because `docs/PRODUCT_BLUEPRINT.md` §6 defines them in the Accepted M1. This is not authorization for a CRM product surface, lead funnel, quotation engine, or broad customer-management UI.

### M1 data families

- Implement: Flight and Accommodation only.
- Implement the common typed Itinerary Item envelope and an extensible family discriminator without creating unused family tables/UI for the remaining families.
- Implement Reservation as a separate aggregate and prove same-Agency/same-Trip many-to-many links.
- Capture at least one restricted `INTERNAL_ONLY` value. The planned sentinel is a supplier cost represented as exact Money plus an internal note; neither has a Portal source or contract member.

### Explicit exclusions

CRM breadth, Leads, Travel Requests, Opportunities, Quote/Sale breadth, payments, supplier integrations, email, WhatsApp, AI, automation builder, Control Plane, fleet provisioning, production, real customer data, extra itinerary families, documents, elaborate dashboards, final visual design, SSR/Next.js, Prisma, Turborepo, Graphile Worker, Redis, broker/cache, and customer-specific code/schema/builds.

Documents are not added merely to pass a security test. M1 proves that no document surface or implicit document authority exists. Protected-document reauthorization remains a named blocking gate for the first document milestone; it is **not** marked passed by M1.

## 2. Execution rules for every stage

1. **Serial gate by default.** Complete evidence and independent review before promoting the next stage.
2. **TDD for behavior.** Add the lowest-level failing test, observe the intended failure, implement the minimum behavior, then run focused and stage-wide suites.
3. **Small, reviewable commits.** Commit only after a gate is green; never push without separate authorization. If Git initialization is not approved, preserve equivalent staged diffs/evidence until resolved.
4. **One migration chain.** Reserve monotonically ordered filenames; review final SQL before applying. Once applied anywhere durable, never edit that migration.
5. **Real boundaries require real evidence.** PostgreSQL constraints/roles use the pinned real major; browser/security boundaries use Playwright and direct API/DB abuse probes, not mocks.
6. **Synthetic disposable fixtures only.** Use `example.invalid`, deterministic IDs/clocks where appropriate, and guaranteed cleanup.
7. **No secret-bearing evidence.** Logs, screenshots, reports, commands, and fixtures contain no credentials, tokens, cookies, raw auth URLs, or unnecessary PII.
8. **No production claim.** Every Stage 10/11 report says DEVELOPMENT and identifies the exact artifact digest and environment.
9. **Stop conditions.** Baseline hash drift, an Accepted ADR contradiction, Portal workspace access, mutable publication payload, auth-realm crossover, float Money, unmanaged dependency migration, customer-specific branch, or an unresolved BLOCKER/HIGH causes NO-GO.

## 3. Dependency graph and parallelism

```text
S1 Baseline/version gate
  → S2 Monorepo/config/architecture scaffold
    → S3 PostgreSQL/migrations/roles/transactional foundations
      → S4 Agency/auth/authz bootstrap
      → S5 M1 domain/data slice
        → S6 Projection/Preview/Publish/history
          → S7 Portal restricted read path/grants
      → S8 Worker/Audit/Activity/observability (integration waits for S6/S7)
        → S9 Admin + Portal UI (contracts must be frozen by S7)
          → S10 CI/artifact/CT 200 deployment
            → S11 executable acceptance and M1 closure
```

### Technically parallelizable, but not the default

- After S3, S4 auth and S5 domain implementation can be isolated if migration numbers and shared contracts are reserved first.
- S8 job-executor internals can be developed after S3 while S5/S6 proceed, but publish/outbox integration cannot close before S6.
- After S7 contract freeze and design-system primitives, Admin Web and Portal Web can be built independently.
- CI checks are expanded continuously alongside each stage.

To comply with the constitution and Rui's workflow, default execution remains serial with exactly one visible in-progress task. Parallel implementation requires explicit approval, isolated worktrees, disjoint ownership, and a serial integration/review gate.

## 4. Detailed implementation stages

### S1 — Accepted baseline, read-only CT inventory, and version compatibility gate

**Objective:** Replace every runtime/package uncertainty with verified facts and exact pins without changing CT 200 or scaffolding TravelOS.

**Dependency:** Accepted Phase 0 GO only. This is the mandatory first execution stage.

**Work packets and deliverables:**

1. Recompute all 40 Accepted baseline entries from `docs/reviews/PHASE_0_ACCEPTED_BASELINE.md`; verify root `AGENTS.md` remains byte-identical to `docs/reviews/AGENTS_CANDIDATE.md`. A mismatch stops the stage.
2. Perform a sanitized, read-only CT 200 inventory: OS/release/architecture, package manager and repositories, CPU/RAM/disk/filesystems, clock/time sync, systemd, current listeners/firewall visibility, installed Node/PostgreSQL/Caddy/backup tooling if any, service collisions, available non-secret deployment users/groups, and whether `/opt`, `/etc`, `/var/lib`, and private PostgreSQL storage have sufficient headroom. Never read environment variables, credential contents, database data, private keys, or secret-bearing service definitions.
3. Verify current official support and release information during Stage 1, not now:
   - select the newest patched **active LTS** Node line that passes the complete package matrix;
   - select an exact pnpm/Corepack version and exact TypeScript/tool versions;
   - choose the highest vendor-supported PostgreSQL major that passes CT OS package availability, `pg`, Kysely, `node-pg-migrate`, backup/restore tooling, and CI/disposable-test compatibility; document why newer candidates passed or failed;
   - verify exact React/Vite/NestJS/Better Auth/Kysely/`pg`/`node-pg-migrate`/Zod/Vitest/Playwright/Tailwind/`decimal.js`/architecture-tool/OpenAPI/package-signing versions from official release metadata, engines, peer ranges, release notes, and advisories;
   - record the PostgreSQL minor-update policy separately from the pinned major.
4. Run a disposable compatibility probe outside CT 200 and outside the product tree. It may install candidate packages in a temporary directory, generate both Better Auth realm schemas into review-only output, compile minimal Nest/Vite/TypeScript probes, connect to a disposable candidate PostgreSQL major, and run a no-op `node-pg-migrate` smoke. Delete the probe after recording hashes/results.
5. Decide the Node runtime delivery method for native CT releases (versioned base-CT package versus release-bundled runtime) from inventory and reproducibility evidence; record the compatibility contract either way.
6. Record repository/CI/signing/host prerequisites and owners without creating a remote, DNS record, key, or public route.

**Files expected (Stage 1 may create documentation only):**

- `docs/implementation/M1_STAGE_1_CT200_BASELINE.md`
- `docs/implementation/M1_VERSION_COMPATIBILITY_MATRIX.md`
- `docs/implementation/M1_BOOTSTRAP_DECISIONS.md`
- `docs/reviews/phase-1-m1/STAGE_1_INDEPENDENT_REVIEW.md`

**CT/infrastructure changes:** None. Read-only SSH inspection only; no `apt update`, package cache refresh, install, file write, user/group change, service action, firewall/DNS/TLS change, or reboot.

**Migration impact:** None.

**Tests/evidence:** 40/40 hash check; constitution equality; sanitized inventory; official-source ledger; exact version/peer/engine matrix; disposable compile/build/auth-schema/PostgreSQL probe; package advisory review; Stage 2 entry preflight.

**Security gate:** No secret/PII collection; no production credentials; Better Auth schemas remain two distinct review artifacts; no dependency migration is executed against a live database.

**Completion gate:** Every exact pin and the PostgreSQL major are selected with reproducible evidence, or the stage reports NO-GO with the failing matrix row. Independent reviewer validates source provenance, hashes, and the absence of CT mutation.

**Rollback/recovery:** Delete only disposable local probe data. Documentation corrections use a new reviewed revision; CT needs no rollback.

---

### S2 — Monorepo, configuration contracts, architecture fences, and green build scaffold

**Objective:** Create the smallest compiling workspace that enforces the Accepted package/process boundaries before domain behavior is added.

**Dependency:** S1 GO and exact version matrix.

**Work packets:**

1. Initialize/version the repository only after the Stage 1 repository-host decision; do not push.
2. Pin `engines.node`, `packageManager`, direct dependency versions, lockfile integrity, and TypeScript target from S1.
3. Create pnpm workspace packages and five composition roots exactly along `docs/ARCHITECTURE.md` §12.
4. Add strict TypeScript, format/lint, Vitest, architecture/import-cycle rules, secret scanning, and one root `ci:verify` script.
5. Write a failing architecture fixture proving Portal imports from workspace modules are rejected; then make the real graph pass.
6. Create strict Zod configuration/instance-manifest schemas. Safe config contains environment, instance ID, exact Admin/Portal host-to-surface allowlist, release/schema/config compatibility, root Agency bootstrap reference, PostgreSQL major/role reference IDs, and safe limits. Secret values remain external systemd-credential references.
7. Add minimal process boot and `/health/live` skeletons without database readiness or product routes.
8. Create a vendor-neutral CI contract; add a GitHub Actions workflow only if a repository host is confirmed.

**Files/modules expected:**

- Root: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.node-version`, `tsconfig.base.json`, `eslint.config.mjs`, `prettier.config.mjs`, `vitest.workspace.ts`, `playwright.config.ts`
- Apps: `apps/{admin-web,portal-web,admin-api,portal-api,worker}/package.json`, `tsconfig.json`, and minimal `src/` composition roots
- Packages: `packages/{backend-core,portal-safe-core,contracts,database,auth-adapters,design-system,config,observability,test-support}/package.json`, `tsconfig.json`, restricted exports
- Tooling: `tooling/architecture/*`, `tooling/ci/*`, `tooling/testing/*`
- Config: `deploy/manifests/schema/instance-manifest.schema.json`, `deploy/manifests/development.example.json` containing no secrets
- CI if authorized: `.github/workflows/ci.yml`

**CT changes:** None.

**Migration impact:** None.

**Tests:** Frozen install; format/lint/typecheck; package build; dependency graph and cycle checks; Portal forbidden-import negative fixture; strict config unknown-key/secret-field rejection; static bundle secret scan; minimal liveness tests.

**Security gate:** Portal API cannot import `backend-core` workspace modules; `portal-safe-core` exports only Portal Access and Customer Presentation-safe contracts. No `.env` or browser secret channel. Unknown host/config keys fail closed.

**Completion gate:** Clean checkout + frozen install + `ci:verify` builds all five empty deployables; architecture negative fixtures fail for the intended reason and production graph passes; no rejected technology appears.

**Rollback/recovery:** Revert scaffold commits/files; no database or CT state exists.

**Independent review:** Package graph, exports, config schema, dependency pins, and forbidden technology scan.

---

### S3 — PostgreSQL bootstrap, migration chain, runtime roles, and transactional foundations

**Objective:** Establish the single controlled PostgreSQL authority and least-privilege roles before auth or domain tables depend on it.

**Dependency:** S2 GO; pinned PostgreSQL major from S1.

**Work packets:**

1. Build idempotent first-install database/role automation for migration-owner, Admin runtime, Portal runtime, Worker runtime, backup, and monitoring identities. Secrets are generated/stored outside Git and scoped by process.
2. Implement a `node-pg-migrate` runner with migration checksums, schema-head compatibility, lock/statement timeouts, and no startup auto-migration.
3. Add first migrations for logical schemas, root Agency singleton constraints, Audit, Integration outbox/delivery, Activity, and `job_runtime` tables.
4. Implement Kysely connection factories per runtime role and an application transaction-runner port; Kysely transaction/row types do not cross inward.
5. Add outbox append ports and job state records now; defer Worker dispatch/execution behavior to S8.
6. Review generated/final SQL and run it on disposable real PostgreSQL before any CT application.

**Files/modules expected:**

- `deploy/database/bootstrap-database-and-roles.sql`
- `packages/database/src/{connections,migrations,transactions,compatibility}/**`
- `migrations/000001_platform_foundation.ts`
- `migrations/000002_audit_activity_outbox_job_runtime.ts`
- `packages/backend-core/src/modules/{audit,activity,integrations}/**`
- `packages/backend-core/src/shared-kernel/{ids,clock,result,events}/**` — tiny primitives only
- `packages/test-support/src/postgres/**`

**CT changes:** None until disposable tests pass and the stage explicitly reaches its DEVELOPMENT apply checkpoint. At that checkpoint only: install the pinned PostgreSQL major through the approved Stage 1 method; create the development database/roles/credential references; keep PostgreSQL local/private; apply reviewed migrations once. No public listener.

**Migration impact:** Introduces the migration chain and schemas. Runtime roles exist before grants. Applied migrations become immutable immediately.

**Tests:** Empty database → head; every intermediate step → head; transaction rollback; checksum drift blocker; lock/statement timeout; same-Agency key patterns; runtime DDL denial; Portal workspace `SELECT` denial even before workspace tables exist; Audit UPDATE/DELETE denial; outbox business-transaction atomicity; job state/CAS database constraints.

**Security gate:** Application processes never receive owner credentials; Portal role has no default schema privileges; public schema defaults are revoked; logs/evidence redact connection strings.

**Completion gate:** Reviewed SQL and real pinned-PostgreSQL tests pass; CT application, if authorized, reports expected schema head and private listener; no application startup can migrate.

**Rollback/recovery:** Before CT apply, recreate disposable DB. After apply, never run blind down migrations; use compatible artifact, forward fix, or recreate the synthetic development database only with explicit destructive approval.

**Independent review:** Final SQL, grants/default privileges, migration checksum design, transaction boundaries, and first-install idempotency.

---

### S4 — Root Agency, Staff realm, Portal realm, and minimal authorization

**Objective:** Prove identity separation and server-side default-deny authorization before Trip APIs exist.

**Dependency:** S3 GO.

**Work packets:**

1. Generate Better Auth Staff and Portal candidate SQL separately in a disposable directory using the pinned version; inspect/adapt into ordinary TravelOS migrations. Never run Better Auth `migrate` in runtime/deployment.
2. Create two adapter configurations with distinct tables, routes, cookie names, secrets, session policies, invitation/recovery flows, and host surfaces.
3. Implement idempotent root Agency bootstrap from the instance manifest plus code-owned permission registry and Agency-owned Owner role template.
4. Implement one-time local operator bootstrap/invitation for the first Staff Principal without email delivery; raw tokens are returned once through a protected operator channel, hashed at rest, and absent from logs/evidence.
5. Implement `StaffMembership`, Role, RolePermission, RoleAssignment, authorization epoch, active/last-Owner policy, and application authorization ports.
6. Implement minimal Portal enrolment identity only; TripAccessGrant arrives in S7.
7. Implement TOTP/recovery-code and recent-MFA assurance through Better Auth adapters. Development evidence proves adapter behavior but explicitly does not claim production/TLS/MFA readiness.

**Files/modules expected:**

- `migrations/000003_staff_and_portal_auth_realms.ts`
- `migrations/000004_staff_authorization_and_bootstrap.ts`
- `packages/auth-adapters/src/{staff,portal}/**`
- `packages/backend-core/src/modules/{agency-organization,staff-access}/**`
- `packages/portal-safe-core/src/portal-access/identity/**`
- `packages/contracts/src/{admin,portal}/auth/**`
- `apps/admin-api/src/modules/{auth,staff,bootstrap}/**`
- `apps/portal-api/src/modules/auth/**`
- `tooling/auth/verify-schema-drift.ts`

**CT changes:** Apply reviewed migrations; provision separate process-scoped auth/database credential references; no email provider and no public host.

**Migration impact:** Two physically separate auth schemas/table namespaces plus Staff authorization records. Auth schema is forever owned by the TravelOS chain.

**Tests:** Invite/verify/password/session/TOTP/recovery/revocation; wrong realm cookie; cookie name/path/host/security attributes; session fixation/rotation; inactive membership; missing permission; direct API call with hidden UI irrelevant; CSRF/Origin/Host rejection; no-JavaScript POST credential safety; same email in both realms grants nothing; auth schema drift; no token in URL/log.

**Security gate:** Separate secrets/tables/routes/cookies; no custom cryptography; high-risk publish policy can later require recent MFA; default deny in every use case.

**Completion gate:** Staff can authenticate through the Staff realm and PortalPrincipal through the Portal realm independently; every cross-realm test is denied; no product route trusts role names or browser claims.

**Rollback/recovery:** Revoke synthetic sessions/invites; previous compatible artifact only. Do not delete/reshape applied auth migrations; forward-fix schema issues.

**Independent review:** Auth-abuse review of realm isolation, migrations, cookie/CSRF/Host behavior, token handling, MFA assurance, and default-deny policies.

---

### S5 — Minimal M1 domain and relational persistence slice

**Objective:** Implement exactly the operational records needed to publish one structured trip while proving scope, concurrency, time, Reservation/Item separation, and Money invariants.

**Dependency:** S3 GO; S4 authorization contracts stable before API exposure.

**Work packets:**

1. Implement UUIDv7 opaque IDs, `Money` (`bigint` minor units + currency + pinned scale), explicit commercial rounding policy registry, and JSON string adapters. Add failing float/implicit-rounding tests first.
2. Implement minimal Person, Customer, CustomerPerson, TripTraveller continuity without CRM navigation/product breadth.
3. Implement Trip aggregate with `lockVersion`, monotonic `workspaceRevision`, state, title/dates, and publication-relevant mutation policy.
4. Implement common Itinerary Item envelope plus exactly one typed Flight or Accommodation detail, local civil time + IANA zone + derived instant validation, item lock versions, and ordering.
5. Implement Reservation separately and ReservationItemLink with same-Agency/same-Trip composite constraints and many-to-many cardinality.
6. Implement minimal restricted supplier-cost `Money` line and internal note, classified `INTERNAL_ONLY`; no customer-presentation type may import them.
7. Implement explicit row/domain mappers, repositories, commands, queries, and strict Admin DTOs.
8. Ensure one transaction increments Trip `workspaceRevision` exactly once for any publication-relevant change; an internal-only-only edit does not increment it.

**Files/modules expected:**

- `migrations/000005_m1_crm_trip_itinerary_reservation_finance.ts`
- `packages/backend-core/src/shared-kernel/money/**`
- `packages/backend-core/src/modules/crm/{domain,application,adapters}/**`
- `packages/backend-core/src/modules/trip-operations/{domain,application,adapters}/**`
- `packages/backend-core/src/modules/finance-operations/{domain,application,adapters}/**` — supplier-cost slice only
- `packages/contracts/src/admin/{customers,trips,itinerary,reservations}/**`
- `apps/admin-api/src/modules/{customers,trips,itinerary,reservations}/**`

**CT changes:** Apply migration and run synthetic bootstrap/fixtures only after disposable database gate passes.

**Migration impact:** Adds scoped relational M1 tables, composite keys, checks, indexes, lock/workspace revisions, exact Money columns, and family-detail constraints. No JSONB core model.

**Tests:** Domain/property tests for Money and state; unknown specialist rounding fails closed; real PostgreSQL same-Agency/same-Trip FK denial; wrong-family/missing-detail rejection; optimistic lock conflict; workspace revision exact-once behavior; local time/DST edge cases; Reservation linked to both Flight and Accommodation; multi-reservation link capability; repository Agency scope; JSON Money uses strings; no float columns/types.

**Security gate:** Every field has owner/classification/Portal eligibility/retention/audit/access metadata. Supplier cost/internal note are Restricted/INTERNAL_ONLY and never enter customer-source SQL or DTOs.

**Completion gate:** Authorized Staff API can create the minimal synthetic continuity and Trip with Flight, Accommodation, Reservation, and exact internal cost; all inverse/scope/concurrency constraints fail correctly.

**Rollback/recovery:** Forward fix after migration application. Synthetic fixture cleanup is idempotent and Agency-scoped; no blanket soft delete.

**Independent review:** Aggregate boundaries, time/Money semantics, SQL constraints, mappers, scope enforcement, and absence of deferred product breadth.

---

### S6 — Customer allowlist projection, pure Preview, immutable Publish, and history

**Objective:** Implement the highest-risk core safety property with one shared pure assembler and transactionally immutable publications.

**Dependency:** S4 recent-MFA/permission policy and S5 domain/data slice.

**Work packets:**

1. Author `PortalTripSnapshotV1` from zero as a strict Zod allowlist. Do not derive it from Admin/domain/database shapes; forbid `Omit`, object spread from internal records, denylist serialization, and unknown passthrough through architecture/static tests.
2. Define family-specific publication-source ports and narrow SQL selections that do not contain supplier cost, margin, internal note, credentials, staff-only identifiers, or raw provider values.
3. Implement deterministic canonical JSON and SHA-256 projection hash plus immutable golden fixtures.
4. Implement one pure assembler used unchanged by Preview and Publish.
5. Implement Preview as a consistent read returning `{workspaceRevision, projectionHash, schemaVersion, projection}` and prove zero Publication/Pointer/Activity/Audit/Outbox/Job writes.
6. Implement `PublishTrip(tripId, expectedWorkspaceRevision, expectedProjectionHash, idempotencyKey)` inside one PostgreSQL `SERIALIZABLE` transaction: reauthorize/recheck recent MFA after lock, compare revision, rebuild/hash, validate, allocate version, insert immutable metadata/payload, atomically advance pointer, insert Audit/domain/outbox facts, commit.
7. Implement duplicate-idempotency replay, bounded serialization retry, typed `409 STALE_PUBLICATION_CANDIDATE`, and Staff-only publication history.
8. Deny routine Admin/Portal UPDATE/DELETE on metadata/payload and verify canonical hash on reads.

**Files/modules expected:**

- `migrations/000006_customer_presentation_publications.ts`
- `packages/contracts/src/portal/trips/portal-trip-snapshot-v1.ts`
- `packages/contracts/src/admin/publications/**`
- `packages/backend-core/src/modules/trip-operations/application/publication-sources/**`
- `packages/backend-core/src/modules/customer-presentation/{domain,application,adapters}/**`
- `packages/portal-safe-core/src/customer-presentation/**`
- `apps/admin-api/src/modules/publications/**`
- Golden fixtures under `packages/contracts/test/fixtures/portal-trip-snapshot-v1/**`

**CT changes:** Apply migration; no new external service or public exposure.

**Migration impact:** `presentation.publication`, one-to-one `publication_payload`, `current_publication`, `publication_event`, indexes/unique idempotency/version constraints, immutable role grants, and schema-version/hash metadata.

**Tests:** Allowlist/golden/adversarial unknown-field tests; INTERNAL_ONLY sentinel absent from type/source SQL/JSON/API/log; Preview same assembler as Publish; Preview table-state before/after equality; stale revision/hash 409 with no version allocation; two concurrent publishes; idempotency returns same version; immutable UPDATE/DELETE denial; v1 unchanged after v2; pointer activation; retained renderer fixtures; publication Audit/outbox atomicity.

**Security gate:** Independent publication review must prove structural absence, not hidden output. Preview network/DOM contains no internal fields. Publish requires `trip.publish`, current scope, and recent MFA.

**Completion gate:** API-level v1/v2 flow passes on real PostgreSQL, including stale conflict and immutable history, before any Portal endpoint is allowed to consume it.

**Rollback/recovery:** Never mutate/delete a business publication to roll back. Revert a compatible artifact or publish a new correction only through normal semantics. Schema fixes are forward migrations.

**Independent review:** Read-only adversarial review of contract construction, source SQL, canonicalization, transaction/lock ordering, idempotency, role privileges, and concurrency tests.

---

### S7 — Portal TripAccessGrant and structurally restricted active-publication read path

**Objective:** Prove that an authenticated Portal Principal with an explicit Trip grant can read only the current publication and cannot reach workspace/history/internal fields.

**Dependency:** S4 Portal identity and S6 publication model.

**Work packets:**

1. Implement explicit `TripAccessGrant`, capabilities, expiry/revocation, issuer, and authorization epoch; Customer/Person/Traveller/email links grant nothing.
2. Add an authorized Staff command to enrol/invite a Portal Principal and issue/revoke a Trip grant as separate audited facts.
3. Create a restrictive active-publication view/function joining current pointer to still-present payload and grant-safe identifiers.
4. Grant Portal runtime only Portal auth/session, active Trip grants, active presentation view, and safe published Agency profile access. Explicitly deny CRM/Sales/TripOps/Finance/Audit/history tables.
5. Implement Portal API `GET current trip` through `portal-safe-core`; no Admin API call and no workspace package import.
6. Verify snapshot hash/schema before returning the independently authored Portal DTO. Customers cannot enumerate historical publications.

**Files/modules expected:**

- `migrations/000007_portal_trip_grants_and_active_publication_view.ts`
- `packages/backend-core/src/modules/portal-access/application/admin-grant-commands/**`
- `packages/portal-safe-core/src/portal-access/**`
- `packages/portal-safe-core/src/customer-presentation/adapters/**`
- `packages/contracts/src/portal/trips/**`
- `apps/portal-api/src/modules/{auth,trips}/**`
- `apps/admin-api/src/modules/portal-access/**`

**CT changes:** Apply migration; configure the separate Portal database credential reference. Still no public exposure.

**Migration impact:** Portal grant/epoch tables, restrictive active view/function, explicit grants/revokes; no workspace privileges.

**Tests:** Unauthenticated/wrong-realm/no-grant/expired/revoked grant; direct guessed ID; same email without grant; Portal SQL `SELECT` denial on every workspace schema; architecture import denial; v1 remains after Hotel B workspace edit; only v2 appears after activation; history endpoint absent/denied; sentinel scan over every Portal response/error/metadata/count/timing path.

**Security gate:** Both package graph and DB role independently enforce the boundary. A controller-only check is insufficient.

**Completion gate:** Portal sees only the active allowed snapshot, and direct SQL/API/import attempts cannot access mutable or historical workspace data.

**Rollback/recovery:** Revoke synthetic grants/sessions. Never widen Portal privileges as a workaround; return to the previous compatible artifact or forward-fix the restrictive view.

**Independent review:** IDOR/cross-realm/DB privilege/import graph red-team review.

---

### S8 — Worker, outbox/job semantics, Activity/Audit, structured logging, and readiness

**Objective:** Complete crash-safe asynchronous foundations and operational evidence without adding real providers or notifications.

**Dependency:** S3 schema; publication integration waits for S6/S7.

**Work packets:**

1. Implement transactional outbox claims/deliveries with database time, bounded leases, per-consumer idempotency, and at-least-once semantics.
2. Implement the small TravelOS job state machine: scheduled/claimed/running/succeeded/retry/dead/`UNKNOWN_OUTCOME`, task-declared deadline/lease, heartbeat, CAS ownership, `FOR UPDATE SKIP LOCKED`, graceful shutdown, and bounded backoff/jitter.
3. Use an idempotent Activity projection from publication events to prove outbox consumption; keep synchronous Audit separate.
4. Add a deterministic fake effect/provider conformance harness that crashes after externally recorded success but before local completion; recovery must reconcile the same business key or quarantine, never blind-replay.
5. Implement structured JSON logging with allowlisted fields/redaction and W3C correlation propagation through HTTP/outbox/jobs.
6. Complete `/health/live`, `/health/ready`, and private `/internal/version` per process, including release/config/schema compatibility and applicable DB/outbox/job checks. Deep diagnostics remain private/authenticated.
7. Add low-cardinality metrics interfaces for auth denials, publication, outbox age, jobs, DB pool, and version mismatch.

**Files/modules expected:**

- `apps/worker/src/{main,outbox,jobs,handlers}/**`
- `packages/backend-core/src/modules/{integrations,activity,audit}/**`
- `packages/observability/src/{logging,metrics,tracing,health}/**`
- `packages/test-support/src/{fake-providers,failure-injection}/**`
- Any additive schema change in a new immutable `migrations/000008_*.ts`; never edit S3 migrations after application

**CT changes:** Add Worker service only after tests pass; configure Worker-specific database credential; bind operational endpoints privately. No real provider credential.

**Migration impact:** Prefer none beyond S3. Any discovered schema need becomes a new reviewed migration.

**Tests:** Duplicate/reordered outbox delivery; concurrent claim; heartbeat; lease loss; stale worker completion denied; crash and restart; deadline; backoff/jitter bounds; dead letter; `UNKNOWN_OUTCOME` reconciliation/quarantine; Activity idempotency; Audit immutability; canary-secret/PII log scan; liveness unaffected by DB outage; readiness fails safely on DB/schema/config mismatch.

**Security gate:** Job payloads carry IDs/version only; no snapshot/internal aggregate dump; no external call inside core transaction; no exact-once claim; logs contain no secrets/PII.

**Completion gate:** Worker failure matrix passes on real PostgreSQL and publication success remains independent from Activity/Worker failure.

**Rollback/recovery:** Stop claiming, allow bounded work to finish, then let leases expire. Preserve/reconcile `UNKNOWN_OUTCOME`; never clear/replay blindly. A compatible previous Worker may resume only if schema/event compatibility permits.

**Independent review:** Concurrency/crash-boundary and sensitive-payload review with deterministic failure injection.

---

### S9 — Owned design-system foundation and walking-skeleton Admin/Portal UIs

**Objective:** Expose only the complete M1 flow in two small, high-quality, accessible SPAs.

**Dependency:** S7 API/contract freeze; S8 health/logging contracts. Design-system primitives precede both apps.

**Work packets:**

1. Implement semantic tokens and the minimum owned accessible primitives: button, field, select/date-time, Money display/input, banner, itinerary card, dialog, inline error, status, skeleton/empty/conflict, and publication state.
2. Admin Web: Staff login/MFA; M1 Trip workspace; minimal Person/Customer/Traveller bootstrap context; Flight and Accommodation create/edit; Reservation links; internal-versus-customer field separation; Preview banner; Publish confirmation; stale preview conflict; publication history.
3. Portal Web: Portal login; mobile-first Overview and Itinerary only; current publication timestamp; Flight/Accommodation narrative; no Documents/Payments/Messages placeholders.
4. Ensure internal-only values are absent from Portal/Preview DOM and network, not hidden with CSS.
5. Implement keyboard/focus/reflow/reduced-motion and safe error/offline/stale states.

**Files/modules expected:**

- `packages/design-system/src/{tokens,components}/**`
- `apps/admin-web/src/{app,routes,features,api}/**`
- `apps/portal-web/src/{app,routes,features,api}/**`
- `apps/*/src/styles.css`
- `tests/e2e/{admin,portal,publishing,auth,accessibility}/**`

**CT changes:** None until S10 artifact deployment.

**Migration impact:** None.

**Tests:** Component/a11y tests; API contract tests; Playwright desktop and 320px/narrow mobile; keyboard/focus; reduced motion; no horizontal page overflow; no console/page/5xx errors; no-JavaScript credential POST safety; stale conflict UX; forbidden-data DOM/network scan.

**Security gate:** No bearer tokens in browser storage; same-origin APIs; no internal DTO import; CSP-compatible static bundles; no customer or secret build-time values.

**Completion gate:** Complete M1 flow is usable through UI at desktop/narrow mobile and every forbidden/negative state is enforced server-side.

**Rollback/recovery:** Static bundle rollback is safe only against a compatible API/schema manifest; otherwise roll back the complete artifact.

**Independent review:** UI/API parity, publication-state clarity, mobile/accessibility, no-JS auth, and forbidden-data review.

---

### S10 — Full CI, immutable release, and DEVELOPMENT deployment on CT 200

**Objective:** Build once, verify, package, install, and smoke the exact same artifact on CT 200 without public exposure.

**Dependency:** S2–S9 green and independently reviewed; repository/CI/signing/dev-host decisions resolved.

**Work packets:**

1. Complete CI: frozen install/provenance, format/lint/secret/architecture, type/domain tests, pinned PostgreSQL migration/privilege/security/job tests, all five builds, Playwright desktop/mobile/a11y/no-JS, dependency/license/SBOM/vulnerability checks.
2. Build one clean immutable release containing both static apps, compiled APIs/Worker + production dependencies, migrations, OpenAPI, compatibility manifest, SBOM, checksums, and signature. No customer-specific build input.
3. Verify signature/checksum and artifact contents before CT transfer.
4. Use versioned automation to provision `/opt/travelos/releases/<digest>`, `/opt/travelos/current`, non-secret `/etc/travelos/instance.json`, systemd units/credentials, private PostgreSQL, and Caddy config. Do not compile/install npm dependencies in the customer-specific install path.
5. Configure exact DEVELOPMENT Admin/Portal FQDN-to-surface mapping, fixed unbranded default vhost, forwarded-host overwrite, and independent API host validation. DNS/TLS/firewall/public exposure require a separate explicit approval; otherwise use a LAN/test-runner-only route.
6. Run migration preflight once with owner credential, start services, verify live/ready/version/schema/config/artifact digest, then atomically select the release.
7. Exercise rollback to the prior compatible release artifact in DEVELOPMENT; do not use destructive down migrations.

**Files/modules expected:**

- `tooling/release/{build,manifest,checksum,sign,verify}/**`
- `deploy/caddy/{Caddyfile.template,render-config.*}`
- `deploy/systemd/travelos-{admin-api,portal-api,worker}.service`
- `deploy/automation/{preflight,install,activate,rollback,verify}.*`
- `deploy/manifests/development.example.json`
- `docs/operations/DEVELOPMENT_DEPLOYMENT.md`
- CI workflow/scripts and `docs/reviews/phase-1-m1/STAGE_10_RELEASE_REVIEW.md`

**CT changes:** Pinned approved runtime/system packages; private PostgreSQL DB/roles; `/opt/travelos` releases/current; non-secret instance config; encrypted/process-scoped systemd credentials; systemd services; Caddy config; local logs/metrics. No public DNS/TLS/firewall/router change and no real data.

**Migration impact:** Apply the exact release migration bundle once after checksum/schema preflight.

**Tests:** Exact artifact install; service/listener ownership; health/version digest; schema checksum; Admin/Portal host allowlist at edge and API; malformed/duplicate/unknown/crafted Host and forwarded-host uniform rejection; database private listener; static bundle secret scan; restart/reboot persistence where explicitly authorized; compatible rollback smoke.

**Security gate:** Only Caddy is exposed on the approved DEVELOPMENT boundary; unknown hosts fail before branding/auth/data; processes receive only their own credentials; Portal role privilege denial is re-run on CT.

**Completion gate:** The exact signed digest built by CI is the digest running on CT 200 and passes the release smoke; reports explicitly say DEVELOPMENT, synthetic data, and no production claim.

**Rollback/recovery:** Atomically restore `/opt/travelos/current` to the previous schema-compatible digest. If schema is incompatible, keep services closed and use a verified development restore/forward fix; never blind down-migrate.

**Independent review:** Artifact provenance/content, automation, host boundary, service credentials, listener exposure, migration preflight, and rollback evidence.

---

### S11 — Executable M1 acceptance and independent closure

**Objective:** Prove the complete canonical flow against the exact CT 200 artifact and close M1 honestly.

**Dependency:** S10 exact-artifact deployment green.

**Canonical executable scenario:**

1. Bootstrap one root Agency and invited StaffPrincipal; authenticate and satisfy DEVELOPMENT recent-MFA flow.
2. Create minimal Person + Customer + TripTraveller continuity and an M1 Trip.
3. Add Flight OPO → PMI with structured local times/zones.
4. Add Accommodation Hotel A.
5. Create a separate Reservation linked to both items.
6. Store a supplier-cost Money sentinel and internal note.
7. Preview; assert “not published”, candidate revision/hash, and zero side effects.
8. Publish v1 with revision/hash/idempotency key.
9. Enrol a separate PortalPrincipal, issue explicit TripAccessGrant, and open the Trip through Portal; assert Hotel A.
10. Change customer-visible Accommodation to Hotel B; refresh Portal; assert Hotel A remains.
11. Attempt stale publish; assert typed 409 and no version/pointer side effect.
12. Preview v2; assert Hotel B.
13. Publish v2 with correct revision/hash; Portal now shows Hotel B.
14. Staff history shows v1 and v2; hashes/payloads remain immutable.
15. Direct Portal API/SQL/import/IDOR attempts cannot obtain mutable data, historical enumeration, supplier cost, margin, internal note, staff identity, or workspace metadata.
16. Repeat critical browser path at desktop and narrow mobile; assert accessibility/no console/network errors.

**Deliverables:**

- `tests/e2e/m1-secure-published-trip.spec.ts`
- `tooling/acceptance/run-m1.*`
- `docs/reviews/phase-1-m1/M1_ACCEPTANCE_EVIDENCE.md`
- `docs/reviews/phase-1-m1/M1_INDEPENDENT_CLOSURE.md`
- Machine-readable test/artifact/migration/host evidence without secrets

**CT changes:** Synthetic fixtures only, cleaned or retained under an explicit DEVELOPMENT fixture policy. No new infrastructure.

**Migration impact:** None unless a failure requires a new forward migration and re-running S10/S11.

**Security/completion gate:** Every mandatory test and carried applicable M1 gate passes, no BLOCKER/HIGH remains, exact artifact digest matches, and an independent read-only reviewer issues bounded GO/NO-GO. Document reauthorization and production restore/privacy/legal gates remain explicitly deferred, not falsely closed.

**Rollback/recovery:** Acceptance is non-mutating except disposable fixtures. A failure reopens the owning stage; it never weakens a test/invariant or changes an Accepted ADR silently.

## 5. Planned file/package boundaries

```text
apps/
  admin-web/       # Admin-only React/Vite surface
  portal-web/      # Portal-only React/Vite surface
  admin-api/       # Staff composition root; workspace + preview/publish commands
  portal-api/      # Portal composition root; active publication + explicit grants only
  worker/          # Outbox/job composition root
packages/
  backend-core/    # Organization, Staff, minimal CRM, Trip, Finance sentinel, Publishing write side, Audit/Activity/Integrations
  portal-safe-core/# Portal Access and active Customer Presentation read contracts only
  contracts/       # independently authored admin/, portal/, events/ schemas
  database/        # Kysely/pg adapters, roles, migrations, transaction runner
  auth-adapters/   # isolated Better Auth Staff and Portal adapters
  design-system/   # tokens and owned accessible source
  config/          # strict non-secret config/manifest schemas
  observability/   # logger/metrics/tracing/health ports/adapters
  test-support/    # synthetic factories, PostgreSQL harness, deterministic fakes
migrations/        # one immutable ordered chain
  000001_platform_foundation.ts
  000002_audit_activity_outbox_job_runtime.ts
  000003_staff_and_portal_auth_realms.ts
  000004_staff_authorization_and_bootstrap.ts
  000005_m1_crm_trip_itinerary_reservation_finance.ts
  000006_customer_presentation_publications.ts
  000007_portal_trip_grants_and_active_publication_view.ts
  000008_<only-if-additive-runtime-need>.ts
deploy/
  database/ caddy/ systemd/ manifests/ automation/
tooling/
  architecture/ auth/ ci/ release/ acceptance/ testing/
tests/
  integration/ security/ migrations/ jobs/ e2e/
```

Names may be refined to match package conventions established in S2, but boundaries, ownership, dependency direction, and the single migration sequence are fixed. Do not create generic `common`, `shared`, `utils`, repository, or pass-through packages.

## 6. Requirement-to-stage traceability

| Requested item | Owning stage(s) | Required proof |
|---|---|---|
| 1. CT 200 read-only inventory | S1 | Sanitized inventory; zero mutation |
| 2. Exact runtime/tool versions | S1 | Official-source and compatibility matrix |
| 3. PostgreSQL major decision/pin | S1, applied S3 | Whole-stack matrix; same major in tests/CT/manifest |
| 4–6. Scaffold/workspaces/config | S2 | Frozen build, strict config, architecture tests |
| 7–8. DB bootstrap/migrations | S3 | Real PostgreSQL empty/intermediate/checksum/role tests |
| 9. Root Agency bootstrap | S4 | Idempotent singleton + Owner bootstrap |
| 10–12. Staff auth/authz + Portal realm | S4 | Two-realm abuse matrix, MFA architecture, default deny |
| 13–15. Trip/Flight/Accommodation | S5 | Domain + real DB constraints |
| Accepted minimal Person/Customer/Traveller/Reservation | S5 | Continuity and same-Trip/Agency links without CRM breadth |
| 16–18. Projection/INTERNAL_ONLY/Preview | S6 | Independent allowlist, sentinel absence, zero writes |
| 19–21. Revision/immutable snapshot/pointer | S5–S6 | Conflict/concurrency/idempotency/privilege tests |
| 22. Portal cannot read workspace | S7 | Package graph + DB denial + API/IDOR tests |
| 23. Publication history | S6–S7 | Staff-only v1/v2; Portal current only |
| 24. Activity/Audit | S6, S8 | Synchronous immutable Audit; idempotent Activity projection |
| 25. Outbox/job foundation | S3, S8 | Atomic outbox; leases/CAS/crash/UNKNOWN_OUTCOME |
| 26–27. Logging/health | S8 | Redaction scan; live/ready/version behavior |
| 28–29. Admin/Portal UI | S9 | Small accessible desktop/mobile flows |
| 30. Automated tests | Every stage | Focused + consolidated evidence |
| 31. CI baseline | S2, completed S10 | Clean frozen pipeline and exact artifact |
| 32. CT 200 deployment | S10 | Automated private DEVELOPMENT install/smoke/rollback |
| 33. Executable M1 acceptance | S11 | Exact-artifact canonical v1/v2 test + closure |

## 7. Critical invariant evidence matrix

| Invariant | Evidence that must pass |
|---|---|
| A. Portal cannot read mutable Trip workspace | Portal package forbidden-import test; restricted role direct SQL denial; no Portal workspace endpoint; exact-artifact IDOR test |
| B. Projection is allowlist-based | Independently authored strict schema, family source ports/narrow SQL, no domain/row spreading, adversarial added-field test |
| C. `INTERNAL_ONLY` structurally absent | No source/target member or override; TypeScript/static rule; SQL selection review; serialized/DOM/log sentinel scan |
| D. Preview and Publish use same semantics | Both call the same pure assembler; golden hash equality |
| E. Preview has zero side effects | Real PostgreSQL before/after counts/hashes for Publication/Pointer/Activity/Audit/Outbox/Job and unchanged revisions |
| F–G. Expected revision/hash and stale rejection | Serializable transaction tests; semantic stale 409; no auto-rebase/version allocation |
| H. Snapshots immutable | Runtime UPDATE/DELETE privilege denial; content hash unchanged; correction creates new version |
| I. Post-publish edit does not affect Portal | API and Playwright Hotel A → edit B → Portal remains A |
| J. Portal current publication only | Restricted active view; history API absent/denied; v2 pointer test |
| K. Staff/Portal contexts separate | Distinct schemas/routes/cookies/secrets; wrong-cookie and same-email tests |
| L. Server-side default deny | Direct API negatives across unauthenticated/wrong realm/missing permission/wrong Agency/revoked grant |
| M. Staff MFA architecture | Pinned library TOTP/recovery/recent-assurance tests; DEVELOPMENT label; production proof remains separate |
| N. ADR-010 Money | TS `bigint`, PG `bigint`, JSON strings, explicit policy/version/boundary, float/static/property tests |
| O. ADR-012 migrations | One checksummed chain owns all schemas/auth/jobs; no startup/dependency migration; empty/intermediate/drift tests |
| P. No customer hacks | One artifact, strict runtime manifest, no customer branch/build/migration condition; CI scan |
| Q. No production claim | DEVELOPMENT manifest, synthetic fixtures, exact wording in evidence and final closure |

## 8. Consolidated test and evidence strategy

### Required suites

- **Domain/property:** Money, explicit rounding/fail-closed, Trip/item/reservation states, workspace revision, lock conflicts, time zones/DST, permission policies.
- **Architecture:** inward imports, cycles, restricted exports, Portal package allowlist, vendor/framework/DB types absent inward, no forbidden serialization patterns.
- **Contracts:** strict Zod Admin/Portal separation, OpenAPI, golden snapshot v1, unknown field failure, Money/bigint strings.
- **Real PostgreSQL integration:** composite constraints, transactions, serializable publication, privileges, immutable payload denial, grants, outbox/jobs.
- **Migrations:** empty → head, each intermediate → head, representative synthetic data, checksum drift, failed migration recovery, auth-schema conformance.
- **Auth/security:** sessions, CSRF/Origin/Host, wrong realm, MFA assurance, revocation epoch, default deny, IDOR, metadata/timing/error leakage, no-JS credential safety.
- **Publication:** same assembler, no-side-effect Preview, stale/concurrent/idempotent Publish, immutable history, active pointer, INTERNAL_ONLY sentinel.
- **Jobs:** duplicates, ordering, concurrent claims, heartbeat/lease loss/stale completion, crash boundary, reconciliation, dead/`UNKNOWN_OUTCOME`.
- **Browser:** canonical M1 flow at desktop and 320px/narrow mobile, keyboard/focus/reduced motion, no console/page/5xx errors, forbidden data absent from DOM/network.
- **Operations:** artifact checksum/signature/content, fresh install, version/schema/config health, exact-host rejection at Caddy/API, private DB, restart and compatible rollback.

### Evidence handling

- Record command, exit code, exact commit/release digest, schema head, PostgreSQL major, test count, and evidence file path.
- Redact or omit raw cookies, invitation/reset tokens, auth URLs, connection strings, headers containing credentials, and PII.
- A mocked result never closes a DB role, browser boundary, host edge, migration, or CT runtime gate.
- Preserve failed evidence and remediation; do not rewrite history to make closure appear cleaner.

## 9. Independent review strategy

| Checkpoint | Independent reviewer mandate | Blocks |
|---|---|---|
| S1 | Verify exact baseline bytes, official source provenance, candidate compatibility, and no CT mutation | S2 |
| S2 | Inspect package graph/exports/config and attempt forbidden Portal/workspace imports | S3 |
| S3 | Review final SQL, role/default privileges, migration runner/checksums, and restore/forward-fix notes | S4/S5 |
| S4 | Abuse both auth realms, cookies, CSRF/Host, MFA assurance, token handling, and schema drift | Product APIs |
| S5 | Review aggregate/domain vocabulary, Money/time/concurrency, and same-Agency/Trip constraints | S6 |
| S6–S7 | Adversarial publishing/Portal review: add internal fields, race publish, query workspace/history, cross realm/IDOR | S9/S10 |
| S8 | Crash/lease/CAS/ambiguous-outcome review; inspect payload/log classifications | Worker deployment |
| S9 | UI/API parity, forbidden DOM/network data, accessibility/mobile/no-JS | S10 |
| S10 | Verify exact artifact, install automation, credentials/listeners, host rejection, migration/rollback evidence | S11 |
| S11 | Re-run/inspect exact-artifact acceptance evidence and issue bounded M1 GO/NO-GO with no self-closure | M1 closure |

The reviewer is read-only, verifies the exact commit/artifact/evidence first, uses stable finding IDs/severity, and cannot close their own fixes. Any architecture contradiction is escalated to a superseding ADR rather than patched around.

---

## 1. M1 implementation stages

1. **S1 — Baseline, read-only CT inventory, and exact version compatibility gate.** No CT mutation or scaffold.
2. **S2 — Monorepo/config/architecture scaffold.** Pinned workspace, five roots, strict config, import/cycle/CI baseline.
3. **S3 — PostgreSQL/migrations/roles/transactional foundations.** One chain, least privilege, Audit/Activity/outbox/job schemas.
4. **S4 — Agency/auth/authz bootstrap.** Root Agency, invited Staff, separate Portal realm, RBAC, MFA architecture.
5. **S5 — M1 domain/data slice.** Minimal Person/Customer/TripTraveller, Trip, Flight, Accommodation, Reservation links, exact internal Money sentinel.
6. **S6 — Projection/Preview/Publish/history.** Strict allowlist, pure Preview, revision/hash/idempotent serializable Publish, immutable v1/v2.
7. **S7 — Portal isolation and grants.** Explicit TripAccessGrant, restricted role/view/package graph, current publication only.
8. **S8 — Worker/Audit/Activity/observability.** Outbox/jobs leases/CAS/`UNKNOWN_OUTCOME`, structured logs, health/readiness/version.
9. **S9 — Admin and Portal walking-skeleton UIs.** Small, polished, mobile/accessibility-safe complete flow.
10. **S10 — CI/artifact/CT 200 deployment.** One signed digest, automated private DEVELOPMENT install, host boundary, rollback.
11. **S11 — Exact-artifact M1 acceptance and independent closure.** Canonical Hotel A → Hotel B v1/v2 scenario and security negatives.

## 2. recommended Stage 1

Execute **S1 — Accepted baseline, read-only CT 200 inventory, and exact version compatibility gate** exactly as defined above. It is deliberately documentary/read-only on CT 200. It resolves Node.js LTS, pnpm, PostgreSQL major, framework/package, auth-schema, CI/signing/runtime-delivery, and host prerequisites from official sources plus a disposable off-CT compatibility probe. It does not initialize Git, scaffold TravelOS, create a database, install on CT 200, or start a service.

## 3. Stage 1 definition of done

- Accepted manifest recomputes **40/40**, with no missing/mismatch, and root `AGENTS.md` equals the canonical review copy.
- Sanitized CT 200 inventory covers OS/architecture/resources/time/systemd/packages/services/listeners/storage and records no secrets or PII.
- Exact Node active-LTS patch, pnpm, TypeScript, package/framework/tool pins are recorded with official source, support status, engines/peer compatibility, integrity, advisory review, and verification date.
- One PostgreSQL major is selected and pinned only after CT OS, `pg`, Kysely, `node-pg-migrate`, backup/restore, and disposable-test compatibility pass; minor-update policy is explicit.
- Disposable off-CT probes compile minimal Nest/Vite/TypeScript, generate distinct Staff/Portal Better Auth SQL without applying it, and connect/run a migration smoke against the selected real PostgreSQL major.
- Node runtime delivery, repository/CI host, artifact-signing approach, DEVELOPMENT host prerequisites, and unresolved owners are recorded.
- No CT mutation is observed; no application scaffold or live migration exists.
- Independent Stage 1 reviewer reports GO with no open BLOCKER/HIGH. Any failed matrix row produces Stage 1 NO-GO instead of a guessed pin.

## 4. expected CT 200 changes

**During recommended Stage 1: none.** Only sanitized read-only SSH commands are allowed. Specifically forbidden in S1: package index refresh, install/upgrade/remove, file writes, Git checkout, user/group changes, database creation, migration, credential creation, service start/stop/reload/enable, Caddy/systemd edits, firewall/DNS/TLS/network changes, and reboot.

**Expected later, only after their gates:** S3 installs/configures the pinned private PostgreSQL major and development roles/database; S4 adds process-scoped auth credential references; S8 adds Worker/private health behavior; S10 installs the verified release under `/opt/travelos/releases/<digest>`, non-secret instance config, systemd units/credentials, and Caddy exact-host rules. No public exposure or real data is part of M1.

## 5. commands expected during execution but NOT executed now

All placeholders must be replaced from the S1 matrix; they are intentionally not guessed. None of these commands was executed while writing this plan.

```bash
# S1 — local Accepted-baseline verification (read-only)
sha256sum AGENTS.md docs/reviews/AGENTS_CANDIDATE.md
# Parse docs/reviews/PHASE_0_ACCEPTED_BASELINE.md and verify every declared path/hash.

# S1 — CT 200 sanitized read-only inventory
ssh 192.168.1.200 'set -eu
  cat /etc/os-release
  uname -a
  command -v dpkg >/dev/null 2>&1 && dpkg --print-architecture || true
  getconf _NPROCESSORS_ONLN
  free -h
  df -hT
  timedatectl status
  systemd --version
  systemctl --failed --no-pager
  ss -lntup
  for c in node corepack pnpm psql postgres pg_config pgbackrest caddy; do
    command -v "$c" || true
  done'

# S1 — official package metadata/peer-engine evidence on the verification host
npm view <PACKAGE>@<CANDIDATE_VERSION> version engines peerDependencies dist.integrity --json

# S1 — disposable compatibility probe outside repo and CT 200
probe_dir="$(mktemp -d)"
trap 'rm -rf "$probe_dir"' EXIT
cd "$probe_dir"
corepack prepare "pnpm@<PINNED_PNPM_VERSION>" --activate
# Initialize only the disposable probe and install exact candidate versions.
pnpm add --save-exact <CANDIDATE_PACKAGES_FROM_MATRIX>
pnpm exec tsc --noEmit
# Generate Better Auth Staff and Portal SQL to separate review-only files; never run auth migrate.
# Start/connect to disposable PostgreSQL <PINNED_MAJOR> off CT 200 and run migration smoke.

# S2 — workspace bootstrap after S1 GO
corepack prepare "pnpm@<PINNED_PNPM_VERSION>" --activate
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm architecture:check
pnpm test:unit
pnpm build

# S3+ — migration/role gates (planned scripts, to be created before use)
pnpm --filter @travelos/database migration:sql:review
pnpm --filter @travelos/database migration:test:matrix
pnpm --filter @travelos/database migration:verify-checksums
pnpm --filter @travelos/database roles:test
pnpm --filter @travelos/database migrate:up -- --manifest <DEVELOPMENT_INSTANCE_MANIFEST>

# S4–S9 — focused and consolidated verification
pnpm test:domain
pnpm test:contracts
pnpm test:integration
pnpm test:security
pnpm test:auth-schema-drift
pnpm test:publication
pnpm test:jobs
pnpm exec playwright test --project=desktop
pnpm exec playwright test --project=mobile-320
pnpm exec playwright test --project=no-javascript-auth
pnpm test:accessibility

# S10 — complete gate and immutable artifact
pnpm install --frozen-lockfile
pnpm ci:verify
pnpm release:build
pnpm release:sbom
pnpm release:sign
pnpm release:verify -- --artifact <RELEASE_ARTIFACT>

# S10 — CT install/activation only after explicit stage approval
ssh 192.168.1.200 'sudo <STAGE1_APPROVED_OS_INSTALL_COMMAND>'
scp <VERIFIED_RELEASE_ARTIFACT> 192.168.1.200:<STAGING_PATH>/
ssh 192.168.1.200 'sudo <VERSIONED_TRAVELOS_PREFLIGHT_SCRIPT> <ARTIFACT_DIGEST>'
ssh 192.168.1.200 'sudo <VERSIONED_TRAVELOS_INSTALL_SCRIPT> <ARTIFACT_DIGEST>'
ssh 192.168.1.200 'sudo systemctl daemon-reload'
ssh 192.168.1.200 'sudo systemctl enable --now travelos-admin-api travelos-portal-api travelos-worker'
ssh 192.168.1.200 'sudo caddy validate --config <RENDERED_CADDY_CONFIG>'
ssh 192.168.1.200 'sudo <VERSIONED_TRAVELOS_ACTIVATE_SCRIPT> <ARTIFACT_DIGEST>'
ssh 192.168.1.200 'curl --fail --silent http://127.0.0.1:<PRIVATE_PORT>/health/live'
ssh 192.168.1.200 'curl --fail --silent http://127.0.0.1:<PRIVATE_PORT>/health/ready'
ssh 192.168.1.200 'curl --fail --silent http://127.0.0.1:<PRIVATE_PORT>/internal/version'

# S11 — exact-artifact acceptance
pnpm acceptance:m1 -- --target <APPROVED_DEVELOPMENT_URL> --artifact <ARTIFACT_DIGEST>
```

The final Stage 1 inventory script must be reviewed against the detected OS before use. Do not run `env`, dump service environments/configuration, inspect credential files, or print secret-bearing URLs/tokens.

## 6. unresolved implementation questions

1. **Exact versions and PostgreSQL major:** intentionally unresolved until S1 official-source and compatibility evidence; this is a Stage 1 gate, not an architecture gap.
2. **CT 200 factual baseline:** OS/package-source/resource/listener/service facts are unknown until read-only S1 inventory.
3. **Repository ownership:** the directory is not currently a Git repository. S1 must record whether to initialize it here, the intended remote/organization, branch protection, and whether GitHub Actions can be activated. No remote/push is assumed.
4. **Artifact signing/provenance:** choose the approved signing tool and non-production signing identity/secure key location during S1; no key may enter Git, a plan, logs, or evidence.
5. **DEVELOPMENT Admin/Portal hostnames and TLS:** exact FQDNs and whether LAN DNS/local trust changes are desired must be settled before S10. M1 defaults to no public DNS/firewall exposure; any network/TLS change needs explicit approval.
6. **Native Node delivery:** S1 must choose a pinned base-CT package or a release-bundled runtime based on OS support and artifact reproducibility; the running version must match the compatibility manifest.
7. **Invitation handoff without email:** before S4, confirm the operator-only one-time local bootstrap/invite channel. The planned default is a protected one-time channel with hashed-at-rest tokens and no log/evidence exposure.
8. **Document gate classification:** documents remain out of M1 by instruction. Protected-document per-request reauthorization is carried forward as a blocker for the first document slice and cannot be reported as passed in M1.
9. **Production-only gates:** encryption-at-rest/access-separated backups, expiry, oldest-point isolated restore, deletion reconciliation, legal/privacy and threat-model acceptance, and measured RPO/RTO remain NO-GO for real protected data/production; they do not block synthetic DEVELOPMENT S1.

## 7. GO / NO-GO recommendation for executing Stage 1

**GO — execute Stage 1 only**, because Phase 0 formally authorizes M1 and S1 is constrained to Accepted-baseline verification, sanitized read-only CT 200 inventory, official-source version qualification, and disposable off-CT compatibility testing.

This GO does **not** authorize S2, Git/repository initialization, TravelOS scaffolding, CT package installation, PostgreSQL creation, migrations, credentials, service/network changes, deployment, public exposure, production, or real data. S1 immediately becomes **NO-GO** if Accepted baseline bytes mismatch, CT access cannot remain read-only, no supported compatible runtime/PostgreSQL/auth matrix exists, an unresolved BLOCKER/HIGH appears, or implementation would contradict an Accepted ADR.