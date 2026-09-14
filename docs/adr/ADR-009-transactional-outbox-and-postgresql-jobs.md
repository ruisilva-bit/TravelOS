# ADR-009: Transactional Outbox and PostgreSQL-Backed Jobs

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

Publications, notifications, provider calls, scans and projections need reliable post-commit work. A dedicated broker/cache in every CT is operationally expensive, and database state plus message publication cannot be atomically committed to unrelated systems.

## Decision

Insert versioned outbox messages in the same PostgreSQL transaction as business state. Dispatch at least once with leases and per-consumer delivery state. Every handler/provider effect is idempotent or reconciles a durable business key before retry; exactly-once is not claimed.

Use a deliberately small TravelOS-owned PostgreSQL job executor in a separate Worker process from the same release. Its schema is part of the one TravelOS migration chain. Claims use database time, `FOR UPDATE SKIP LOCKED`, per-task bounded leases, renewable heartbeat and compare-and-swap ownership/version on heartbeat/completion. A stale worker cannot complete a lost lease. Job payloads contain IDs, not large sensitive state. Use bounded retries/backoff/jitter, hard deadlines, task concurrency, dead-letter/`UNKNOWN_OUTCOME` quarantine and operator visibility.

Before any non-idempotent external effect, persist an operation ID/business key and request hash. Crash/timeout after an external call produces reconciliation—not immediate replay. The adapter must query by that stable key or rely on provider-enforced idempotency; otherwise the effect remains manual/disabled.

External calls never occur inside a core transaction. Publication success is independent from notification success.

## Consequences

- No Redis/Kafka/RabbitMQ dependency per CT and strong transaction coupling.
- Job load shares PostgreSQL resources and requires monitoring/limits.
- At-least-once semantics make idempotency a non-optional design cost.
- TravelOS owns a small amount of queue SQL/state-machine code and must property/integration/chaos test lease races and crash boundaries.

## Rejected

- In-memory/background promises: lost on crash.
- Direct external calls in transaction/request: partial failure and latency coupling.
- Redis/BullMQ or RabbitMQ initially: extra fleet service without demonstrated need.
- Kafka: disproportionate operational complexity.
- Graphile Worker: its startup path invokes internal schema migrations and its OSS stale-lock recovery uses a fixed four-hour threshold, conflicting with the single controlled migration chain and per-task lease policy.
- Blind replay after an ambiguous external outcome: can duplicate bookings/payments/notifications.

## Revisit trigger

Measured job throughput/contention exceeds PostgreSQL capacity, cross-instance streaming is required, or provider isolation needs a dedicated broker. Migration must preserve message contracts/idempotency.
