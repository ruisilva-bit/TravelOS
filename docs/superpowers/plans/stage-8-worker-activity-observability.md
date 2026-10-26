# Stage 8 Worker / Activity / Observability Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; the PO explicitly authorizes autonomous execution without routine approval prompts. The durable ledger is `.hermes/state/stage-8-resume.md` (user-required location).

**Goal:** Execute the accepted M1 outboxes durably, project internal Activity, preserve synchronous Audit, expose safe operational diagnostics and close Stage 8 on CT200 with real evidence.

**Architecture:** Small PostgreSQL-backed worker in the existing modular monolith. Pure job policy/ports in backend-core, SQL adapters in database, composition in apps/worker, allowlisted telemetry in observability. Existing publication/grant commands remain the only event producers.

**Tech Stack:** Existing pinned Node24.19.0, pnpm11.21.0, TypeScript, Kysely/pg, PostgreSQL18.6, Vitest, native systemd. No new runtime service or provider.

**Spec:** `docs/implementation/M1_STAGE_8_WORKER_ACTIVITY_OBSERVABILITY.md`; PO master-execution attachment identified in resume.

## Global constraints
- Branch starts at `a57789b6662f0e0c0da5948c20eef6eb1e6bf4ec`, not the stale main workspace HEAD.
- Stage 7 evidence/accepted ADRs and migrations 0001–0013 stay byte-identical.
- Mutable qualification before immutable candidate, then one canonical CI per candidate. No early freeze.
- CT200 DEVELOPMENT only; no target compilation, public exposure, real data or effects, push or merge.
- Stage 9 actions = 0. No UI/API breadth beyond required operational contracts.

## Review focus
1. Stale owners after lease expiry must not write Activity or finalize a reclaimed job.
2. A lost response after commit/restart must not duplicate Activity or publication.
3. Concurrent dispatch/claim must honor per-consumer uniqueness and task concurrency.
4. Malicious correlation/error data must not reach logs or Portal; privileges must fail closed.
5. Packaged dependencies and exact symlinked systemd invocation must work before CI/deployment.

## Task 1: Durable delivery and Activity
**Files:** new `packages/backend-core/src/modules/job-runtime/worker.ts`, `packages/database/src/job-runtime/worker-repository.ts`, `migrations/0014_stage8_worker_activity.cjs`; minimal exports and checksum update; tests in `packages/backend-core/test/job-runtime/worker.test.ts`, `tests/integration/stage-8-postgresql.test.ts` and Stage 8 disposable runner/config.
**Interfaces:** `WorkerRepository` for dispatch/claim/heartbeat/complete/fail/recover/inspect; `runWorkerCycle` consumes this port and an Activity handler, returning typed safe outcomes. SQL returns explicit DTOs, no row leakage into the core.
- [ ] Write and observe RED policy/state tests, then implement bounded retry, terminal/quarantine and lease-loss semantics.
- [ ] Write and observe RED real-PostgreSQL tests for schema, dispatch and transactional Activity, then implement additive migration and adapter.
- [ ] Prove empty/prior/no-op migration, exact same-scope references, denied Portal and runtime mutation privileges, duplicate/concurrent claims, expiry/CAS, rollback and retry/dead-letter.
- [ ] Run focused tests, typecheck/lint and real PostgreSQL; expected all PASS with cleanup receipt.

## Task 2: Correlation, logs and process lifecycle
**Files:** `packages/observability/src/`, its tests; existing Admin/Portal composition and producer repositories; `apps/worker/src/`, worker tests; package/architecture manifests only where dependencies require them.
**Interfaces:** safe correlation context and explicit JSON logger; `bootstrapWorkerProcess` consumes runtime/repository, stops claiming and drains; private health/readiness/metrics without a public listener.
- [ ] RED tests for unsafe/unknown log fields, concurrent request context isolation, trace validation, no secrets and health/shutdown.
- [ ] Implement safe telemetry and transactional event context; preserve Preview zero writes and synchronous Audit.
- [ ] Implement actual Worker main credential loading, DB readiness, polling/recovery and graceful shutdown; smoke mode remains explicit and effect-free.
- [ ] Run whole unit suite, boundaries, build and smoke; expected PASS.

## Task 3: Mutable integration and artifact qualification
**Files:** Stage 8 packaging/verifier/CI/rehearsal under `tooling/ci/stage-8/`; versioned deployment inputs under `deploy/`; applicable regression configs.
**Interfaces:** artifact inventory/provenance binds exact source snapshot, migration chain, runtime dependencies, operator entrypoints and service units. Candidate record binds preflight receipts and one-shot CI.
- [ ] Reuse proven primitives rather than copying historical generation machinery; preserve predecessor verifier on its exact accepted ref.
- [ ] Qualify production build, actual extracted Worker, dependency paths, all advertised packaged commands and exact systemd working-directory/current-symlink contract.
- [ ] Inspect approved CT200 helpers and credential references, prove runtime/migrator identity without exposing values; rehearse acceptance with synthetic failures and restart/concurrent workers.
- [ ] Run full relevant Stage 6/7 regressions, checksums, formatting/lint/typecheck, architecture, scanner, inventory/hashes/provenance. Correct freely until GREEN.
- [ ] Only then seal candidate inputs and run canonical CI once. Preserve any failed consumed run, qualify successor instead of rerunning it.

## Task 4: CT200 acceptance
**Files:** Stage 8 operator scripts and sanitized evidence.
- [ ] Backup/isolated restore probe with explicit ledger/catalog parity and cleanup, verify artifact before migrations.
- [ ] Promote exact CI-qualified bytes; run canonical migration/no-op and controlled affected-service activation.
- [ ] Use legitimate authenticated application flow for outbox creation; verify Worker completion, replay idempotency, transient retry, persistent dead-letter, restart recovery, concurrency, Activity/Audit linkage and diagnostic output.
- [ ] Rerun authenticated Admin/Portal Preview/Publish/grant isolation and clean only registered synthetic fixtures. Expected all PASS; no external effects.

## Task 5: Formal closure
**Files:** Stage 8 evidence/index/freeze, independent review and closure records.
- [ ] Independently recompute all inventory bytes/hashes and deterministic freeze; final scanner PASS.
- [ ] Dispatch genuine non-author read-only review of exact frozen bytes and runtime receipts. Correct legitimate findings and requalify/review as required.
- [ ] Record GO only when all gates agree, then explicit-path commit and annotated Stage 8 tag; verify tag/HEAD, clean tracked tree and no push/merge.
- [ ] Return all PO-requested identifiers/results, open findings and `Stage 9 actions = 0`.

## Execution rulings
- The user's requested resume file replaces a separate temporary SDD ledger, avoiding duplicate state. The approved master brief overrides routine plan-review prompts; no product/architecture decision is being changed.
- No intermediate commit is required during mutable integration; source identity is sealed only after qualification and final closure follows independent GO. Candidate source/provenance must account for any pre-closure Git sealing that packaging requires.
- Preflight interface check: Tasks 1→2 share only WorkerRepository and safe result types; Tasks 1/2→3 consume built package exports and migration manifest; Tasks 3→4 share immutable artifact layout; Task 5 consumes exact immutable receipts. No unresolved product interface conflict.
