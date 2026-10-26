# M1 Stage 8 — Worker, Activity, Audit and Observability

Status: authorized implementation; not closure evidence. Owner: Alex. Target: CT200 DEVELOPMENT only.

## Authority and scope

Rui authorizes Stage 8 end-to-end, including non-destructive CT200 backup/restore probe, canonical pending migrations, artifact promotion, controlled TravelOS restarts, synthetic acceptance, independent review and Git seal. Baseline is annotated tag `travelos-phase-1-m1-stage-7-gen15-go`, resolved to closure commit `a57789b6662f0e0c0da5948c20eef6eb1e6bf4ec` (qualified code `5609bcb44edb9baa2d10ff43e7e69c356de6ca35`). Governing contracts: Architecture §§9/11/15, Data Model §10, ADR-006/009/012 and AGENTS.md. Stage 7 is immutable accepted history.

Stage 8 consumes the existing publication and TripAccessGrant outboxes. Its only production consumer is `ACTIVITY_V1`. No provider integration, notification delivery, generic event bus, scheduler UI, document feature or Stage 9 UI is added. Stage 9 actions = 0.

## Runtime and consistency

- Preserve immutable source outboxes and synchronous Audit writes in their existing business transactions. Add transactionally written, identifier-only correlation context. Preview remains a pure read and creates none of these records.
- A bounded dispatcher discovers committed source messages through an independently allowlisted internal event view. It creates one delivery per `(agencyId, messageId, consumer)` and one durable job in the same transaction. Retrying discovery is harmless.
- PostgreSQL owns time, claims and leases. Claims use `FOR UPDATE SKIP LOCKED`, explicit per-task concurrency, attempt counters and ownership/version CAS. Heartbeat cannot exceed the hard execution deadline. Expired safe transactional work is recoverable; an unknown outcome is quarantined, never blindly retried.
- Activity insertion, success delivery state and job completion commit atomically. A unique source/consumer key prevents duplicate effects, including crash/replay. Stale workers cannot insert Activity or complete another owner's lease.
- Temporary failures use bounded exponential backoff/jitter; permanent or exhausted work becomes `DEAD_LETTER`; ambiguous effects become `UNKNOWN_OUTCOME`. No external effect is enabled in this milestone. Deterministic fake outcomes exercise the policy through test-only adapters, never a public failure-injection API.
- Graceful shutdown stops claims and drains bounded work; process death is recovered by durable lease expiry. Startup performs readiness checks, never migrations.

## Activity versus Audit

Activity is an eventual internal product projection with curated event codes/text and explicit Agency, Trip, Staff and optional publication references. Audit remains synchronous, insert-only accountability; it is not generated from Activity and Activity failure cannot erase it or roll back an already committed publication. Worker receives no authentication credentials, mutable Trip payload or publication snapshot. Portal receives neither Activity nor Audit privileges/contracts.

## Observability and access

Correlation IDs and valid W3C trace context are propagated from HTTP to durable event context and worker outcome. Structured logs construct an allowlist; raw errors, URLs/query strings, headers, cookies, payloads, names and emails are excluded. Metrics use fixed low-cardinality names, never principal/customer/Trip IDs. Worker liveness reflects process-loop health; readiness verifies DB identity/schema/privileges independently of backlog. Essential metrics: pending/oldest backlog, running, retries, dead letters, unknown outcomes and expired leases. The worker atomically refreshes Prometheus text exposition at `${RUNTIME_DIRECTORY}/metrics.prom` with mode `0600` inside the existing mode-`0700` systemd runtime directory. This is a private, operator-only scrape surface; it adds no network listener or public exposure.

## Data extension / retention

Migration `0014_stage8_worker_activity` is additive and leaves migrations 0001–0013 unchanged. Existing immutable event rows are not rewritten. New fields are internal-only, never Portal eligible:

| Owner / record | Typed fields and access | Classification / retention / audit |
| --- | --- | --- |
| Integration / event context | Agency/message ID, correlation UUID and optional bounded W3C traceparent; same business transaction | Internal identifiers, outbox retention; immutable, no full request |
| Integration / delivery | Source message reference, fixed consumer, dispatch/completion state/times | Internal operational, delivered +90 days; unresolved until resolution +90 days |
| Job Runtime / job and attempt | IDs, state, attempt/bounds, run/lease/deadline timestamps, owner/version, typed safe error | Internal operational, same queue retention; transitions and attempts recorded |
| Activity / entry | Agency/Trip/Staff/publication/source IDs, event code, schema version, occurred/projected timestamps | Confidential internal history; retain with source business history; append-only corrections, never Audit replacement |

All Agency-owned references are composite same-Agency; Trip/publication references additionally prove the same Trip. No JSON aggregate dumps. Runtime roles cannot change schema or immutable history. Queries and dispatcher batches are bounded. Any future purge is a separate privileged retention operation, not part of this stage.

## Qualification and closure

Iterate on mutable source until focused/adversarial tests, pinned PostgreSQL18.6 migration/privilege/concurrency tests, extracted-artifact execution, actual systemd command/path contract, existing credential references, realistic rehearsal, security scan and full inventory/provenance are GREEN. Run Stage 7 artifact and deployment regressions plus the legacy Stage 4 source scan from a disposable checkout of the exact accepted Stage 7 ref; never run historical migration-head assertions or fixed predecessor scanner allowlists against successor Stage 8 files. The Stage 8 exact path/rule/line scanner governs current source. The Stage 8 canonical runner lists accepted repository gates explicitly instead of invoking inherited `ci:verify`, whose raw Stage 6 PostgreSQL harness expects the Stage 5 chain to end at 0010; Stage 8's disposable PostgreSQL suite applies existing Stage 6/7 regression tests through the successor adapter without changing historical tests. Freeze no candidate before integration. Canonical CI runs once per fully qualified immutable candidate; local failures do not create generations.

After canonical CI PASS, promote that exact digest to CT200 using the approved access/helpers and no target compilation. Verify backup/restore parity, migration/no-op, runtime outcomes, restart/concurrent claiming, authenticated Admin/Portal Preview/Publish/grant regressions and synthetic fixture cleanup. Produce sanitized indexed evidence, deterministic freeze, final scan, independent non-author GO, adjudication, closure commit and annotated tag. Verify the tracked tree is clean. No push or merge.
