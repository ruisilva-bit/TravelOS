# TravelOS Stage 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce that a Portal principal can read only an explicitly granted Trip's active immutable `PortalTripSnapshotV1`, with no routine Portal access to mutable workspace or internal data.

**Architecture:** Keep Staff grant commands in `backend-core` with `@travelos/database` as the Admin-side adapter. Keep the Portal read use case in `portal-safe-core`; implement its narrowly scoped read-only Kysely adapter inside the Portal API composition root, using the existing Portal DB connection and runtime role rather than importing the broad Admin database package. Extend the Staff permission registry and auth adapter only through a Stage 7-owned successor baseline; preserve Stage 6 records and its verifier unchanged.

**Tech Stack:** TypeScript / Node 24.19.0 / pnpm 11.21.0, NestJS, Kysely + PostgreSQL 18, Zod, Vitest, node-pg-migrate.

**Spec:** `/home/hermes/.hermes/attachments/Pasted content (27.7 KB)`; governing grant semantics: `docs/PERMISSIONS.md` §5 and §7; immutable publication: `docs/implementation/M1_STAGE_6_PREVIEW_PUBLISH.md` and ADR-004.

## Global Constraints

- Stage 7 starts at `6242e023953ccb8fe883bff97a0d62e64af8b66a`, tag `travelos-phase-1-m1-stage-6-gen07-revision-04-go`; never rewrite Stage 6 evidence or migration 0011.
- No mutable workspace reads from Portal; no Portal dependency on `@travelos/database` or `@travelos/backend-core`.
- Staff and Portal realms, cookies, auth tables, keys, and database identities remain separate; email equality grants nothing.
- Use strict allowlisted `PortalTripSnapshotV1Schema`; no ORM/domain serialization, spreading, denylist, or unknown-field pass-through.
- Migration 0012 is the sole schema change; use the canonical `travelos_migrator` → `SET ROLE travelos_owner` runner; no Better Auth runtime migrations.
- PostgreSQL remains loopback-only; CT200 is runtime-only; never compile or install dependencies on CT200.
- Portal SQL is read-only and restricted to TripAccessGrant, Portal session/epoch context, and required columns from immutable publication tables; PUBLIC and mutable/internal table access remain denied.
- Portal sees one public denial for both missing grant and missing active publication; no existence leak, internal error, log, or sentinel.
- Keep Stage 8 actions at 0; do not add Portal UI or worker/outbox processing.
- Canonical Stage 7 CI is authorized once per immutable candidate generation, after focused validation.

## Review Focus

- Revocation racing a Portal read: the request must validate session epoch and grant in the same read statement; the next request after commit is denied.
- Expired-but-not-revoked grants: expiry must deny access using database time; a grant cannot be renewed by silently overwriting history.
- Wrong-realm or same-email session: Portal accepts only its own realm and Staff APIs accept only Staff sessions.
- Snapshot payload with unknown/internal fields or corrupted schema version: fail closed without exposing the value in response, logs, or public errors.
- Guessed Trip ID or a Trip with no active pointer: identical non-leaking response; never fall back to mutable data.

---

### Task 1: Stage 7 authority extension and successor baseline

**Files:**
- Create: `docs/implementation/M1_STAGE_7_PORTAL_ISOLATION.md`
- Create: Stage 7-owned authorized-path allowlist, successor-baseline generator/verifier, and negative tests under `docs/reviews/phase-1-m1/stage-7/` and `tooling/ci/`
- Modify: `package.json` with Stage 7-owned verification/test scripts only

**Interfaces:**
- The extension binds the immutable Stage 6 GO commit/tag, exact grant semantics, permission ID `trip.access.manage`, current-snapshot-only Portal contract, migration `0012`, least-privilege roles, and Stage 8 actions = 0.
- The verifier first validates the exact predecessor using the Stage 6 baseline at its accepted ref, then validates the Stage 7 extension and authorized path set. It must fail closed on unlisted deltas and never change the Stage 6 verifier or manifest. The immutable candidate hash manifest is generated only after Stage 7 source bytes are complete.

- [ ] Record the approved delta and enumerate the protected predecessor and Stage 7 source paths.
- [ ] Add verifier tests for predecessor drift, extension-document tampering, unlisted source paths, and manifest hash/count mismatch; each negative fixture must fail.
- [ ] Verify the untouched predecessor from the detached exact Stage 6 worktree; establish and test the Stage 7 path allowlist before changing product code. Generate/verify the final source-hash manifest only after the candidate bytes are complete.

### Task 2: Staff capability and TripAccessGrant application boundary

**Files:**
- Modify: `packages/backend-core/src/staff-access/permission-registry.ts`, `packages/backend-core/src/index.ts`
- Modify: `packages/backend-core/test/agency-organization/agency-bootstrap.test.ts` (registry-version expectation)
- Create: `packages/backend-core/src/modules/portal-access/**`
- Create: `packages/backend-core/test/portal-access/**`
- Create/modify: strict Admin grant DTO/schema under `packages/contracts/src/admin/**` and its exports/tests

**Interfaces:**
- Add permission `trip.access.manage` at registry version 5; default Owner role receives it. No role-name checks.
- `M1StaffTripAccessOperations.issueTripAccessGrant(cookieHeader, input)` and `.revokeTripAccessGrant(cookieHeader, input)` resolve Staff identity from the Staff session, require `trip.access.manage` at Agency scope, validate strict input, and pass a server-generated Staff authorization proof to the repository port.
- V1 grant capabilities are restricted to `trip.view_current`; grant input supports only the canonical optional expiry and UX-only relationship label. No Portal self-grant API.

- [ ] Test unauthenticated, wrong Agency, missing permission, invalid/unknown DTO fields, expired expiry, and cross-scope identifiers before implementing commands.
- [ ] Implement issue/revoke as separate operations; revoke is one-way and every mutation carries an idempotency key.
- [ ] Verify the repository receives the server-generated Staff proof and maps missing/cross-scope targets to non-leaking not-found. Task 3 must re-evaluate that proof inside each database transaction before mutating state.

### Task 3: Migration 0012 and Admin persistence

**Files:**
- Create: `migrations/0012_stage7_portal_trip_access.cjs`
- Update generated: `migrations/checksums.json`
- Create: `packages/database/src/portal-access/**`
- Modify: `packages/database/src/index.ts`
- Create: `tests/integration/stage-7-postgresql.test.ts` and Stage 7 disposable runner/config

**Interfaces:**
- Persist same-Agency Trip grants with principal/Trip composite constraints, explicit capability set, issue/revoke actor+timestamps, optional expiry/label, unique active grant, idempotency, append-only audit, and transactional outbox facts. No document grants or general sharing subsystem.
- Persist a Portal principal authorization epoch. Grant revocation increments it in the same transaction; Portal sessions carry/check it so stale sessions cannot survive revocation. Do not add an independent authorization cache; if a cache is introduced later, it must be per-request or keyed to the current epoch as required by the accepted permission model.
- Portal runtime permissions apply to capability role `travelos_portal_runtime`, exercised through login role `travelos_portal_api`; grant only required columns on Portal context/grants and immutable publication tables. Do not create a broad owner-rights view or SECURITY DEFINER read path.
- Portal's publication query may read only the active pointer and the required columns of publication version/snapshot; it must not select publisher, finance, audit, outbox, or workspace columns.

- [ ] Write migration tests for empty and prior supported state; verify checksums and deterministic reruns.
- [ ] Re-evaluate the Staff authorization proof inside each issue/revoke transaction; prove stale/revoked/wrong-scope proofs cannot mutate state. Prove issue/revoke/audit/outbox/epoch commit atomically; test duplicate idempotency, expiry, revoke, wrong Agency, and immutable grant history.
- [ ] As `travelos_portal_api`, prove allowed grant/current-snapshot/session reads succeed and direct mutable Trip, Flight, Accommodation, Reservation/link, staff authorization, finance, audit, outbox/job, non-allowlisted publication-column, owner, migrator, and role-escalation reads fail with SQLSTATE `42501` or the documented denial.
- [ ] Verify PUBLIC ACLs, role membership graph, owner, session_user/current_user migration identity, loopback-only DB, and exact migration head.

### Task 4: Portal session epoch and safe read use case

**Files:**
- Modify: `packages/auth-adapters/src/realm.ts` and its focused tests
- Modify: `packages/portal-safe-core/src/portal-access/**`, `packages/portal-safe-core/src/customer-presentation/**`
- Create: focused Portal-safe-core unit tests

**Interfaces:**
- Portal auth session resolution maps only the Portal realm principal and carries/checks the Portal principal authorization epoch; each trip read queries current grant/publication state without caching authorization decisions.
- Portal-safe query input includes untrusted session/principal/Trip identifiers; output is `PortalTripSnapshotV1 | null`, never a grant row or database entity.
- The use case returns `null` for missing/expired/revoked grant, stale principal epoch, cross-Trip ID, or absent active publication; it validates the strict V1 snapshot before returning it.

- [ ] Test default deny, exact one-Trip grant, expiry, revocation + principal-epoch invalidation, no stale authorization cache, missing publication, malformed session, and strict unknown-field rejection.
- [ ] Test that a Staff session and a Portal session with the same email remain independent principals and cookies; no cross-realm adapter is accepted.
- [ ] Check the current Portal principal epoch and re-read grant/publication state on each request; preserve generic public denial mapping and do not cache stale authorization.

### Task 5: Minimal HTTP flows and application wiring

**Files:**
- Modify: `apps/admin-api/src/m1-routes.ts`, `apps/admin-api/src/auth-bridge.ts`, `apps/admin-api/src/main.ts`
- Modify: `apps/portal-api/src/app.ts`, `apps/portal-api/src/auth-bridge.ts`, `apps/portal-api/src/main.ts`, `apps/portal-api/package.json`
- Create: `apps/portal-api/src/trip-read-repository.ts`, `apps/portal-api/src/trip-routes.ts`, and tests
- Modify: `packages/auth-adapters/src/realm.ts`, `packages/auth-adapters/package.json`, `tsconfig.base.json`
- Create: `packages/auth-adapters/src/portal.ts`
- Modify: `tooling/architecture/package-boundary-policy.mjs`, `tooling/architecture/check.mjs`, and adversarial architecture fixtures/tests

**Interfaces:**
- Admin exposes strict Staff-only issue/revoke endpoints; Portal exposes only `GET /api/portal/trips/:tripId` and session context. `portal-api` uses its existing Portal DB connection plus a narrowly scoped Kysely adapter; it must not import Admin/backend/database packages.
- Portal API imports only the explicit `@travelos/auth-adapters/portal` export; the Staff-capable root export is forbidden by the architecture policy.
- The Portal route calls only the Portal realm, checks session before DB access, passes principal/session/Trip to the safe use case, validates the response with `PortalTripSnapshotV1Schema`, and returns exact snapshot JSON with `Cache-Control: no-store, private`.
- Missing grant, guessed ID, and missing publication share one response; unexpected internal failures map to a generic non-sensitive error and are not logged with payload/exception details.

- [ ] Add API tests for unauthenticated, Staff-cookie rejection, Portal session acceptance, same-email realm separation, valid grant, cross-Trip denial, revoke, expired grant, no publication, and strict snapshot response.
- [ ] Add regression proving workspace mutation after Publish v1 does not change Portal response; Publish v2 changes current response while v1 remains unchanged.
- [ ] Add sentinel assertions for body, serialized contract, repository result, logs, and public errors.
- [ ] Add forbidden-import fixtures proving Portal cannot import `@travelos/backend-core`, `@travelos/database`, Admin internals, or Staff auth adapters; keep architecture output at zero violations.

### Task 6: Qualification, immutable candidate, CT200, evidence, review, closure

**Files:**
- Add Stage 7 test/config/runner and deployment-contract extension as required, without compiling on CT200.
- Add Stage 7 evidence index, final sensitive scan, deterministic freeze, independent review/adjudication, closure decision, and annotated GO tag under canonical Stage 7 review/evidence paths.

- [ ] Run focused tests after each task, then Stage 7 PostgreSQL qualification, auth/IDOR/architecture tests, format/lint/typecheck/build, migration verifier, successor baseline, and deployment-contract tests.
- [ ] Build immutable candidate `gen01`; record exact commit, provenance, inventory, and SHA-256. Consume the single Stage 7 canonical CI authorization only after readiness; do not rerun it for unchanged bytes.
- [ ] Before CT200 mutation, capture authoritative Stage 6/runtime/database state, create/hash a fresh custom-format backup, restore-probe and verify/drop it; locate only approved `travelos-agentctl` and `travelos-migrator-exec` mechanisms.
- [ ] Apply only migration 0012 via the canonical runner, verify role/ACL/ledger state, promote the exact artifact, verify actual units/contract, activate and check required services/host routing.
- [ ] Run authenticated synthetic Portal/Staff acceptance for grant default-deny, exact Trip scope, v1 immutability after workspace edit, v2 transition, INTERNAL_ONLY sentinel absence, revocation + epoch invalidation with no stale cache, and DB privilege matrix. Retain sanitized assertion-level output.
- [ ] Produce and independently verify evidence index, final sensitive scan, deterministic double-collected freeze, and exact candidate hashes. Obtain independent read-only review; fix and reverify findings in a new generation when required.
- [ ] Close GO only with clean tracked tree, exact candidate artifact/CI/runtime evidence, verified freeze, independent GO, and zero unresolved blocking findings; tag the exact closure commit. Confirm Stage 8 actions = 0 and do not push without a configured remote and explicit authorization.

---

## Self-review

- **Spec coverage:** All brief sections are assigned across the authority baseline, grant model, database isolation, package boundaries, minimal APIs, required auth/grant/snapshot/data-leakage/DB tests, candidate/CI, CT200 deployment/runtime acceptance, evidence, freeze, review, closure, and Stage 8 boundary.
- **Step scan:** Tasks are ordered by domain, adapter, runtime, and closure dependencies; each task has an independent validation gate. The existing Stage 6 verifier, manifest, migration 0011, evidence, artifact, and tag remain immutable.
- **Type consistency:** Admin operations accept an untrusted session cookie plus strict command DTO; persistence receives a verified Staff proof; Portal safe query consumes session/principal/Trip identity and returns only a strict `PortalTripSnapshotV1 | null`.
- **Review focus:** The five principal omitted-input/concurrency conditions are tested in the owning tasks above.
- **Proportion:** This is a concise execution map of the supplied stage brief; exact SQL constraints, route payloads, and tests will be derived from accepted code and contract conventions before each implementation slice.
