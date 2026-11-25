# TravelOS Architecture Decision Records

All Phase 0 ADRs became **Accepted** after Product Owner acceptance, verified post-PO freeze and independent closure. Decision dates/content were not changed during status promotion; future changes supersede rather than rewrite history.

| ADR | Decision | Status |
|---|---|---|
| [ADR-001](ADR-001-modular-monolith.md) | Modular monolith with separate delivery composition roots | Accepted |
| [ADR-002](ADR-002-dedicated-single-tenant-deployment.md) | Dedicated single-tenant deployment | Accepted |
| [ADR-003](ADR-003-independent-database-per-instance.md) | Independent PostgreSQL database per instance | Accepted |
| [ADR-004](ADR-004-immutable-publishing-snapshots.md) | Immutable allowlisted publishing snapshots | Accepted |
| [ADR-005](ADR-005-structured-itinerary-model.md) | Structured itinerary and separate Reservations | Accepted |
| [ADR-006](ADR-006-provider-based-integration-architecture.md) | Provider ports and anti-corruption adapters | Accepted |
| [ADR-007](ADR-007-separate-staff-and-portal-identity-realms.md) | Separate Staff and Portal identity realms | Accepted |
| [ADR-008](ADR-008-rbac-with-explicit-resource-scopes.md) | Default-deny RBAC plus explicit Portal grants | Accepted |
| [ADR-009](ADR-009-transactional-outbox-and-postgresql-jobs.md) | Transactional outbox and PostgreSQL jobs | Accepted |
| [ADR-010](ADR-010-exact-money-and-currency-representation.md) | Integer-minor-unit Money and explicit rounding | Accepted |
| [ADR-011](ADR-011-document-storage-and-explicit-access-grants.md) | Private provider storage and explicit document grants | Accepted |
| [ADR-012](ADR-012-persistence-boundary-and-fleet-safe-migrations.md) | Kysely, node-pg-migrate and one fleet migration chain | Accepted |
| [ADR-013](ADR-013-monorepo-web-runtime-and-build-orchestration.md) | React/Vite, Nest roots and pnpm-only monorepo | Accepted |
| [ADR-014](ADR-014-durable-privacy-erasure-across-backups.md) | Privacy deletion, bounded backup retention and explicit residual risk | Accepted |
| [ADR-015](ADR-015-steady-state-delivery-pipeline.md) | Stage-free current-tree CI gates; stage-frozen verifiers become historical | Accepted (2026-11-25, PO decision) |

## ADR rule

Accepted ADRs are immutable records. To change a decision, add a new ADR with `Supersedes`, update this index and all dependent documents, and rerun relevant review/test gates.
