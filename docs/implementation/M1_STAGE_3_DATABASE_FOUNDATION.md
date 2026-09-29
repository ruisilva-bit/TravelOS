# Phase 1 M1 — Stage 3 database foundation

Status: implementation and disposable-qualification contract. This document does not close Stage 3 and does not authorize Stage 4.

## Scope

Stage 3 establishes one PostgreSQL 18 database per TravelOS instance, one TravelOS-owned migration chain, database role and schema boundaries, Kysely/`pg` connection and transaction foundations, and disposable integration evidence. It creates no authentication tables, Better Auth runtime wiring, Trip/Customer/Traveller/Reservation/Itinerary/Publishing tables, business APIs, or UI behavior.

## Authoritative migration policy

- Authority: TravelOS `migrations/` through `node-pg-migrate` 9.0.0.
- Metadata: `travelos_meta.schema_migrations`.
- Direction: `up` only. Migration `down` functions are disabled. Recovery is a compatible artifact rollback, verified restore, or forward fix—not a blind destructive down migration.
- Ordering: filename order checked.
- Checksums: every production migration byte is pinned in `migrations/checksums.json` before connection or DDL.
- Transaction: all pending migrations in one explicit transaction.
- Concurrency: the explicit node-pg-migrate advisory lock is enabled with fail-fast behavior and its fixed lock value.
- Failure: a failed transactional migration is rolled back and is not entered in the ledger. Migration metadata schema/table creation may precede the migration transaction, as required by node-pg-migrate.
- Execution role: `travelos_migrator` connects, is checked as non-superuser/non-CREATEDB/non-CREATEROLE, then explicitly `SET ROLE travelos_owner`. Application startup does not run migrations.
- Search path: `pg_catalog`; all migration object references are schema-qualified.
- Diagnostics: run ID, bounded sanitized target identity, version, duration, result, ledger and migration names. Passwords and credential-bearing URLs are never logged.

## Schema topology

Application objects are not placed in `public`. `travelos_meta` is reserved for migration metadata. Stage 3 creates the accepted capability schema names without pulling later business tables forward:

- `organization`
- `staff_access` — physically separate Staff identity realm; no Better Auth tables yet
- `portal_access` — physically separate Portal identity realm; no Better Auth tables yet
- `crm`
- `sales`
- `trip_ops` — mutable internal workspace boundary
- `presentation` — customer-safe immutable read/presentation boundary
- `finance`
- `documents`
- `work_service`
- `communications`
- `activity`
- `audit`
- `integration`
- `job_runtime`

All are owned by the NOLOGIN `travelos_owner` role. `PUBLIC` receives no schema privilege. Default table, sequence, function and type privileges are explicitly revoked from `PUBLIC` for objects later created by `travelos_owner`.

## Role topology

| Role | LOGIN | Purpose | Membership / SET ROLE |
|---|---:|---|---|
| `travelos_owner` | no | database and schema ownership | no runtime use |
| `travelos_migrator` | yes | migration identity | may `SET ROLE travelos_owner`; does not inherit it |
| `travelos_admin_runtime` | no | Admin capability group | owns nothing |
| `travelos_portal_runtime` | no | Portal capability group | owns nothing |
| `travelos_worker_runtime` | no | Worker capability group | owns nothing |
| `travelos_admin_api` | yes | Admin runtime identity | inherits Admin group; cannot `SET ROLE` it |
| `travelos_portal_api` | yes | Portal runtime identity | inherits Portal group; cannot `SET ROLE` it |
| `travelos_worker` | yes | Worker runtime identity | inherits Worker group; cannot `SET ROLE` it |

Every TravelOS role is NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION and NOBYPASSRLS. Runtime identities receive CONNECT but not TEMPORARY. Runtime search paths are `pg_catalog`.

Stage 3 grants schema USAGE only as currently necessary:

- Admin: `staff_access`, `trip_ops`
- Portal: `portal_access`, `presentation`
- Worker: `integration`, `job_runtime`

USAGE is not object access and no runtime group receives schema CREATE. Later migrations must explicitly grant each new object capability; no future broad access is pre-granted.

## Disposable privilege-test scaffolding

The qualification suite creates clearly named `stage3_*_probe` tables/functions only after the production migration chain has completed. They are absent from `migrations/` and exist only in the disposable cluster. They prove real allowed/denied SQL as the login roles, including Portal customer-safe SELECT, workspace denials, DDL denial, TEMP denial, default function EXECUTE denial, and privileged-role `SET ROLE` denial.

## Runtime configuration

The strict development instance manifest declares loopback host, port, database name, loopback-only TLS policy, and exact process identities: Admin uses `travelos_admin_api`, Portal uses `travelos_portal_api`, and Worker uses `travelos_worker`. Their opaque credential references must be pairwise distinct. Passwords and connection strings are forbidden from manifests. The development contract permits disabled TLS only for `127.0.0.1`; remote production TLS policy is later deployment scope.

## Transaction boundary

`@travelos/backend-core` defines only `TransactionPort`, opaque `TransactionContext`, and explicit nesting policy. It imports no database vendor. `@travelos/database` implements the port with Kysely 0.29.5 and `pg` 8.23.0. A successful callback commits; an exception rolls back. Nested calls on the same port are rejected with `NESTED_TRANSACTION_NOT_SUPPORTED`. Integration tests use a single-connection pool to prove reuse after rollback and resource cleanup.

## Backup/restore qualification scope

The disposable smoke uses PostgreSQL 18 `pg_dump` custom format and `pg_restore --single-transaction`. PostgreSQL roles are cluster-global, so role/database bootstrap runs before restoring database-local schema/data/ACL state. This proves Stage 3 logical recoverability only; it is not the final production backup, PBS, object-storage, PITR, retention, or privacy-reconciliation strategy.
