# ADR-012: Persistence Boundary and Fleet-Safe Migrations

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

TravelOS needs explicit transactions, exact Money, optimistic concurrency, custom same-scope constraints/indexes, immutable records and safe upgrades across many independent databases. Persistence convenience must not dictate domain/API design.

## Decision

Use Kysely + `pg` as a typed SQL infrastructure adapter and `node-pg-migrate` for one reviewed migration chain. Repository/query adapters map explicitly between database rows and domain/contracts; no persistence type crosses inward/outward. TravelOS owns every applied schema change, including its job runtime and both Better Auth realms.

Migrations are immutable/checksummed, transactional by default and PostgreSQL-specific where needed. Better Auth's pinned CLI may generate Staff/Portal SQL into temporary review output; engineers inspect/adapt it into ordinary TravelOS migrations and CI checks schema conformance. Its direct `migrate` command is forbidden in deployment/runtime. Use expand/backfill/contract, timeouts, representative-volume tests, preflight, verified restore points, staged fleet waves and app/schema compatibility manifests. Startup never auto-migrates or invokes dependency schema synchronization. Customer-specific schema/migration paths are forbidden.

Prisma is rejected for V1: although custom migration SQL is possible, TravelOS values direct constraint/SQL ownership and fewer schema abstractions over generated ORM CRUD convenience.

## Consequences

- Precise PostgreSQL use and reviewable fleet changes.
- More explicit mapping/query code than a full ORM.
- Engineers must understand SQL and migration locking.
- Dependency upgrades require explicit generated-SQL/schema drift review rather than a vendor CLI changing live databases.

## Rejected

- Prisma as schema/migration authority.
- ORM/domain entity reuse.
- runtime schema synchronization/auto-migrate.
- dependency-owned migrations outside the release manifest/checksum chain.
- per-customer migration scripts.
- trusting destructive down migrations as rollback.

## Revisit trigger

Measured engineering cost shows the SQL-first approach harms delivery without preserving its safety advantages, and an alternative proves all constraints/migration/fleet requirements in an ADR/spike.
