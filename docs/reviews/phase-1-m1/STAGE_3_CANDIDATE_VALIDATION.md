# TravelOS Phase 1 M1 — Stage 3 Candidate Validation

- **Status:** Author validation complete; independent non-authoring review required
- **Candidate scope:** PostgreSQL 18 foundation, migration authority, least-privilege runtime roles, transaction adapter, disposable qualification, and controlled DEVELOPMENT CT 200 installation
- **Excluded scope:** Stage 4 authentication, authorization, Agency/domain records, business APIs, application deployment, and UI behavior
- **Stage 4 actions:** **0**

## 1. Final repository regression

The final mutable repository bytes were checked with the qualified toolchain: Node `24.19.0`, Corepack `0.35.0`, and pnpm `11.21.0`.

| Gate | Final result |
|---|---|
| Mutable formatting | PASS — 167 files; protected overlap 0 |
| `format:check` | PASS — 167 files |
| `lint` | PASS |
| `typecheck` | PASS |
| Node syntax | PASS — 47 `.mjs`/`.cjs` files |
| Shell syntax | PASS — 2 `.sh` files |
| `pnpm run ci:verify` | PASS — exit 0; 19/19 gates completed; final completion marker present |
| Phase 0 protected baseline, pre/post | PASS — 40/40 matched; missing 0; mismatches 0 |

The complete final CI log is `docs/evidence/phase-1-m1/stage-3/stage-2-regression.log`: 116230 bytes, SHA-256 `4a7a30b8ff2ba5e0d3cfe8985f94f6f3726ba468563f4267c1812af8911d0788`.

## 2. Stage 3 scope and Stage 4 boundary

The candidate implements the database foundation described by `docs/implementation/M1_STAGE_3_DATABASE_FOUNDATION.md`:

- one PostgreSQL database for the DEVELOPMENT instance;
- one TravelOS-owned `node-pg-migrate` chain;
- foundation schemas and role boundaries;
- Kysely/`pg` persistence and transaction adapter behind the vendor-neutral backend-core transaction port;
- disposable real-PostgreSQL qualification and controlled CT 200 operational qualification.

The final CT inventory records no Better Auth tables/runtime, Staff or Portal authentication, application RBAC, Customer, Traveller, Trip, Reservation, Itinerary, Publishing, Portal grant, business API, UI, or application deployment. Foundation relation count is 2 (`travelos_meta.schema_migrations` and its sequence); Stage 4 object count is 0. **Stage 4 actions = 0.**

This author validation records the implemented evidence and does not self-adjudicate semantic conformance with every accepted Stage 3 planning requirement. That remains an explicit responsibility of the independent reviewer.

## 3. PostgreSQL version and package provenance

- PostgreSQL server/client/tool version: `18.6` / package `18.6-1.pgdg13+2`.
- `server_version_num`: `180006`.
- Platform: Debian 13 (`trixie`), `amd64`.
- Source lock: `tooling/database/postgresql-18-packages.lock.json`.
- Package SHA-256 values were verified before both disposable extraction and CT installation.

| Package | Version | SHA-256 |
|---|---|---|
| `postgresql-18` | `18.6-1.pgdg13+2` | `bf4062a44757c3f7a207a1b9e20c2bf93f9847257516c2ce0befc1257d3dcf8e` |
| `postgresql-client-18` | `18.6-1.pgdg13+2` | `9af40c99f7074f8ff3798155af2f07f1a4e1e3bd4edce44ef928c1e03aea620e` |
| `libpq5` | `18.6-1.pgdg13+2` | `c6cc459bb499db4697686533e50bf5943f7e7d6929c04ef55eec184d5436859b` |
| `liburing2` | `2.9-1` | `4b589c00c7a51172aace2cb2fb3d3ff32daf86c644023126dcfcaa840cc941ea` |

Disposable qualification extracted checksum-verified packages into disposable storage and did not install them globally. The controlled CT installation used the same locked package identities.

## 4. CT management method and persistent mutations

Target: Proxmox node `pxmx2`, CT `200`, hostname `travelos-dev`, DEVELOPMENT only.

Management used the Proxmox HTTPS API plus LXC termproxy/VNC. Direct Proxmox SSH was unavailable, and the REST LXC exec endpoint returned HTTP 501. A temporary SSH key was introduced only after console bootstrap and was removed and negatively re-tested during cleanup. No credential values were captured in evidence.

Persistent Stage 3 CT mutations were limited to:

- installation of the four checksum-locked PostgreSQL/runtime packages;
- PostgreSQL `18/main` cluster and loopback-only configuration;
- the synthetic `travelos_development` database;
- eight TravelOS roles and four intended memberships;
- 16 foundation schemas plus the three-entry migration ledger;
- four systemd encrypted runtime credential files retained for DEVELOPMENT operation.

No firewall change, CT reboot, primary database drop, application deployment, Stage 4 action, real customer data, commit, or push occurred.

## 5. PostgreSQL listener and authentication state

- Service: active.
- Cluster: `18/main` online.
- Data checksums: on.
- `listen_addresses`: `127.0.0.1,::1`.
- Remote PostgreSQL listener count: 0.
- Password encryption: `scram-sha-256`.
- Runtime/remote trust authentication: disabled.
- HBA parse errors: 0.

Result: **PASS — private loopback-only DEVELOPMENT database; no unintended remote PostgreSQL exposure.**

## 6. Schema and object topology

The 16 expected schemas are `activity`, `audit`, `communications`, `crm`, `documents`, `finance`, `integration`, `job_runtime`, `organization`, `portal_access`, `presentation`, `sales`, `staff_access`, `travelos_meta`, `trip_ops`, and `work_service`.

- Expected/present: 16/16.
- Owner for every schema: `travelos_owner`.
- Final foundation relations including migration ledger sequence: 2.
- Final Stage 4 object count: 0.
- Final probe object count after cleanup: 0.

## 7. Role topology

Eight roles are present:

- NOLOGIN ownership/capability roles: `travelos_owner`, `travelos_admin_runtime`, `travelos_portal_runtime`, `travelos_worker_runtime`;
- LOGIN identities: `travelos_migrator`, `travelos_admin_api`, `travelos_portal_api`, `travelos_worker`.

All eight are NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, and NOBYPASSRLS. Runtime identities own no database/schema object. The four memberships are:

- migrator → owner: `INHERIT FALSE`, `SET TRUE`, `ADMIN FALSE`;
- Admin API → Admin capability: `INHERIT TRUE`, `SET FALSE`, `ADMIN FALSE`;
- Portal API → Portal capability: `INHERIT TRUE`, `SET FALSE`, `ADMIN FALSE`;
- Worker → Worker capability: `INHERIT TRUE`, `SET FALSE`, `ADMIN FALSE`.

Direct owner login was denied with SQLSTATE `28000`; runtime owner delegation is absent.

## 8. Runtime privilege matrices and Portal isolation

Real CT SQL attempts passed exactly:

| Runtime | Attempts | Allowed | Denied | Result |
|---|---:|---:|---:|---|
| Portal | 18 | 1 | 17 | PASS |
| Admin | 17 | 4 | 13 | PASS |
| Worker | 18 | 4 | 14 | PASS |
| **Total** | **53** | **9** | **44** | **PASS** |

Portal's only allowed probe was customer-safe presentation `SELECT`. Mutable workspace `SELECT`, `INSERT`, `UPDATE`, and `DELETE`; customer-safe writes; DDL; ungranted function execution; privileged `SET ROLE`; and public object shadowing were denied, with SQLSTATE-checked results. Portal workspace isolation is **PASS**.

Admin could perform its four expected workspace CRUD probes and was denied Portal surface access, DDL, escalation, and unrelated capabilities. Worker could perform its four expected integration/job-runtime probes and was denied workspace/presentation access, DDL, escalation, and unrelated capabilities.

## 9. PUBLIC/default privileges, search path, and escalation

- PUBLIC database grants: 0.
- PUBLIC application-function execute grants: 0.
- Runtime schema `CREATE`: denied, including `public`.
- New owner-created function execution: denied for all runtimes.
- Default PUBLIC table/function grants: 0 in the captured creator-policy checks.
- Runtime search paths: `pg_catalog` for Admin, Portal, and Worker.
- Runtime `CREATE ROLE`, `ALTER ROLE`, owner/migrator/cross-capability `SET ROLE`, and public object-shadowing probes: denied.

Result: **PASS.**

## 10. Migration chain, checksums, ledger, and failure paths

Authority is TravelOS `node-pg-migrate` `9.0.0`; direction is up-only; destructive down migrations are disabled. The runner checks filename order and SHA-256 before connection/DDL, uses one explicit transaction for pending migrations, runs as `travelos_migrator`, explicitly switches to `travelos_owner`, sets `search_path` to `pg_catalog`, and uses advisory-lock fail-fast concurrency.

| Migration | SHA-256 |
|---|---|
| `0001_foundation_schemas.cjs` | `a5cc693a28129686f83fd4f8fbaddd754348e167f1de931a296b6f22abc23482` |
| `0002_runtime_schema_boundaries.cjs` | `bc5b9f0a4439a80b2167af4722b1245a9982c6226fbc8f7cfefae10fa1fce4fd` |
| `0003_creator_default_privileges.cjs` | `7c4ecf09cdaabef7aa96d38af8d46ad4405d31c0b340cfcabd89e3c6ce5f0138` |

Disposable zero-to-head and no-op rerun passed. Deliberate migration failure rolled back transactionally, created no ledger row, released the lock, and permitted a clean deterministic recovery run.

On CT 200, the first run applied all three migrations, the rerun applied 0, final ledger count is 3, and current migration is `0003_creator_default_privileges`.

## 11. Transaction adapter

The application-facing transaction contract remains in `@travelos/backend-core` and imports no Kysely, `pg`, database row, NestJS, or HTTP type. `@travelos/database` implements it with Kysely/`pg`.

Both disposable and CT evidence passed:

- commit;
- rollback and absence of the reverted row;
- typed nested rejection (`NestedTransactionNotSupportedError`, code `NESTED_TRANSACTION_NOT_SUPPORTED`);
- connection reuse after rollback/rejection;
- one-connection pool returned idle with no waiter;
- repeated/idempotent pool destruction.

## 12. Migration concurrency

The advisory lock was observed. A competing runner was rejected fail-fast with message class `ADVISORY_LOCK_HELD`; no corruption occurred; the ledger remained unchanged; and a subsequent clean rerun applied no migration. Result: **PASS** in disposable qualification and on CT 200.

## 13. Backup and restore

Disposable and actual CT logical backup/restore smokes used PostgreSQL 18 `pg_dump` custom format and `pg_restore` into separate temporary databases.

The CT restore proved:

- 16 schemas;
- three migration-ledger entries and current version `0003_creator_default_privileges`;
- invalid owner count 0;
- representative synthetic state;
- Portal customer-safe read allowed;
- Portal workspace read denied with SQLSTATE `42501`;
- Admin workspace read and Worker foundation read allowed.

The CT dump and temporary restore database were removed. This is Stage 3 logical recoverability evidence, not final production DR/PITR/PBS/object-storage certification.

## 14. Cleanup and final CT state

Cleanup evidence records:

- temporary authorized-key entry removed;
- authentication with the removed key denied;
- local temporary private/public keys removed;
- loopback SSH tunnel on port 15432 terminated;
- VNC helper artifacts removed;
- package staging and temporary `.deb` files removed;
- temporary bootstrap/probe scripts removed;
- probe objects, dump, and restore database removed.

Final CT state: PostgreSQL active; `18/main` online; loopback-only; 16 schemas; eight roles; ledger 3/current `0003_creator_default_privileges`; Stage 4 objects 0; probe objects 0; restore databases 0; temporary `.deb` files 0; real customer data absent.

## 15. systemd credential limitation

Four PostgreSQL runtime encrypted credentials intentionally remain on the DEVELOPMENT CT with mode `0600`, and runtime injection passed without capturing values.

The LXC machine-secret backing material is not stored on encrypted storage. Therefore this candidate does **not** claim strong credential encryption at rest against CT root or Proxmox-host access. The disposition proposed by the author is: acceptable for this DEVELOPMENT CT only, and not approved as the final production secret-storage solution. Independent review must adjudicate this limitation against Stage 3 acceptance.

## 16. Final evidence bundle

The final CT-inclusive evidence bundle contains exactly 26 authoritative artifacts: 19 disposable/repository artifacts plus seven sanitized CT artifacts.

- Index: `docs/evidence/phase-1-m1/stage-3/EVIDENCE_INDEX.json`.
- Index byte size: 5485.
- Index SHA-256: `3161e01ce18d8021329bc00d5f1b415784e69102709a08ce67c3cc6696e8bc32`.
- Deterministic evidence aggregate: `a966ef345e123e8ab32212e7c28af61e87668a41791db379aab9cccf39f5de84`.
- Declared/parsed/matched artifacts: 26/26/26.
- Missing, size mismatches, hash mismatches, duplicate paths, unexpected evidence files, unexpected index paths, and missing index paths: 0.

Result: **PASS.**

## 17. Sensitive-data scan

The final validation-inclusive scan covers repository source, packages/apps, migrations, deployment/database automation, database tooling, manifests/configuration, implementation documentation, Stage 3 evidence including `EVIDENCE_INDEX.json`, and this candidate validation.

- Files scanned: 302.
- Stage 3 evidence files: 27.
- Stage 3 review Markdown files: 1.
- Candidate validation included: true.
- Findings: 0.
- Allowlisted findings: 0.
- Matched sensitive values emitted: false.

Result: **PASS.**

## 18. Immutable predecessor integrity

- Stage 2 final freeze: `docs/reviews/phase-1-m1/STAGE_2_CORRECTED_CANDIDATE_FREEZE_3.md` — SHA-256 `5f2e686c397e7bf9f81b455456e1088cb3c4a897e55e43cd1c09c83fde4ea122` — PASS.
- Stage 2 closure: `docs/reviews/phase-1-m1/STAGE_2_FINAL_INDEPENDENT_CLOSURE.md` — SHA-256 `d4171545ee53a34791814d4cddf49080e06f5f0eab131954c3f8ed9baa13ef81` — PASS.
- Accepted Phase 0 baseline: 40/40 matched before and after final CI; missing 0; mismatches 0.

Neither Stage 2 predecessor was modified.

## 19. Author validation decision

All mechanical repository, evidence-integrity, CT-operation, cleanup, and Stage 4-boundary checks represented above pass. The exact candidate is ready for deterministic freeze and independent adversarial review. This author validation does not close Stage 3, resolve any independent finding, authorize production, or authorize Stage 4.
