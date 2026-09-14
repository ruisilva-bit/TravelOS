# M1 Stage 1 — Bootstrap Decisions

**Status:** Frozen-candidate input for independent Stage 1 review  
**Scope:** Decisions that authorize Stage 2 scaffolding only after Stage 1 closure  
**Non-goal:** This document does not scaffold, install or deploy TravelOS

## 1. Decision summary

| Area | Stage 1 decision |
|---|---|
| Runtime | Node.js `24.19.0`, official checksum-verified Linux x64 runtime |
| Package manager | pnpm `11.21.0` through Corepack `0.35.0`; exact versions and lockfile |
| Database | PostgreSQL major `18`; first qualified minor/package `18.6` / PGDG Debian 13 |
| SQL stack | `pg@8.23.0`, `kysely@0.29.5`, `node-pg-migrate@9.0.0` |
| Authentication | Separate Better Auth runtime and CLI pins at `1.6.27` |
| Identity isolation | `staff_access` and `portal_access` PostgreSQL schemas plus distinct table names |
| Web | React `19.2.8`, Vite `8.2.1`, Tailwind `4.3.3` |
| API | NestJS `11.1.29`; explicit Zod contracts/OpenAPI generation |
| Architecture enforcement | pnpm package graph, package exports and dependency-cruiser `18.2.0` |
| Release evidence | Syft `1.51.0`, Cosign `3.1.3`, Caddy `2.11.4` qualified outside CT |

The complete exact matrix and hashes are in `M1_VERSION_COMPATIBILITY_MATRIX.md`.

## 2. Node runtime delivery

TravelOS will not rely on Debian's Node package or compile/install Node in a customer-specific deployment path.

The immutable release input is the official `node-v24.19.0-linux-x64.tar.xz` archive with SHA-256:

```text
14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647
```

CI verifies the official checksum, incorporates the runtime into the one versioned release artifact, emits SBOM/checksums, and signs the artifact. Installation only verifies and extracts the exact built artifact. pnpm, TypeScript, Vite, the Better Auth CLI and other build tooling are not production runtime requirements.

A future Node pin change requires a new Stage-equivalent compatibility run. No unattended runtime-major transition is permitted.

## 3. PostgreSQL recommendation

### Decision

Use **PostgreSQL major 18** from PGDG for the M1 candidate. The qualification server was PostgreSQL `18.6 (Debian 18.6-1.pgdg13+2)`, server number `180006`, with data checksums enabled.

### Rationale

- PostgreSQL 18 is a supported upstream major with the longest remaining support horizon among current supported candidates at qualification time.
- PGDG publishes Debian 13/amd64 packages.
- The exact candidate passed native server startup, `pg`, Kysely, owned migration up/down, custom-format dump and restore.
- pgBackRest `2.59.0` loaded successfully against the qualified environment.
- CT 200's cached Debian metapackage pointed to major 17, but cached metadata was not refreshed and no package was installed; it is not the selected compatibility contract.

### Operational policy

- Deployment manifests pin PostgreSQL major `18` and the exact package build used by each release.
- Minor updates require the migration/integration/backup/restore matrix before promotion.
- Application startup never runs migrations.
- The migration executor uses the one TravelOS-owned ordered/checksummed chain, including Better Auth realms and job-runtime tables.
- PostgreSQL binds local/private only and is never selected by a request host.
- Rollback is a compatible artifact rollback, forward fix or verified restore; never a blind destructive down migration.

No PostgreSQL installation or database was created on CT 200 in Stage 1.

## 4. Better Auth CLI and two-realm decision

### Exact tooling contract

| Purpose | Package |
|---|---|
| Application runtime | `better-auth@1.6.27` |
| Schema-authoring CLI | `auth@1.6.27` |
| Valid binary aliases | `auth`, `better-auth` |

Canonical generation form:

```text
pnpm exec auth generate --config <realm-config.ts> --output <review-output.sql> --yes
```

`auth migrate`, Better Auth runtime migration/synchronization and direct application of generated SQL are forbidden. Generation is an authoring step: review and adapt the allowlisted result into the single TravelOS migration chain.

The CLI remains development-only and requires the frozen `lodash@4.18.1` override recorded in the matrix. Better Auth runtime and CLI must remain version-aligned.

### Isolation proof

Staff generation produced:

- `staff_user`
- `staff_session`
- `staff_account`
- `staff_verification`
- `twoFactor`

Portal generation produced:

- `portal_user`
- `portal_session`
- `portal_account`
- `portal_verification`

The generated Staff SQL was applied with a fixed `staff_access` schema/search path and the Portal SQL with a fixed `portal_access` schema/search path in the disposable database. The physical table identities had an empty intersection: 5 Staff tables and 4 Portal tables.

Stage 2/4 composition must preserve:

1. separate Better Auth instances, configs, cookies, routes, secrets and session tables;
2. fixed schema qualification/search path per realm—never request-controlled;
3. no email-equality authorization bridge between Staff and Portal;
4. independently composed Portal API dependencies and its later restricted PostgreSQL role;
5. reviewed snake_case/constraint naming in TravelOS-owned migrations where generated defaults are unsuitable;
6. no generated SQL artifact treated as authoritative without migration review.

## 5. TypeScript and package graph policy

- `strict: true` applies to TravelOS-owned code.
- `skipLibCheck: true` is permitted only to avoid failing on Better Auth's optional Bun/Cloudflare/browser declarations in a Node composition root; it is not permission to weaken owned types.
- `engineStrict: true` and `--strict-peer-dependencies` are mandatory install gates.
- Only explicitly reviewed dependencies may run install/build scripts; the Stage 1 allowlist contained only `esbuild`.
- Exact dependency versions and the committed pnpm lockfile are release inputs.
- Full and production audits must be zero at freeze/promotion, or a documented, independently accepted security exception must block release.
- TypeScript remains `6.0.3` while `typescript-eslint@8.67.0` requires `<6.1.0`.

## 6. API/OpenAPI and architecture boundaries

Zod schemas are independently authored Admin and Portal boundary contracts. `@asteasolutions/zod-to-openapi@9.1.0` generates OpenAPI from those owned allowlists. ORM/database rows and domain types must not become transport contracts; unknown inputs are rejected.

Nest decorators and framework types remain in adapters/composition roots. Domain/application packages import no NestJS, Kysely, `pg`, HTTP, SDK or database-row type. Dependency-cruiser and package exports enforce the approved direction:

```text
domain <- application <- adapters <- composition root
```

The Portal composition may depend only on Portal Access, Customer Presentation and grant-safe Documents contracts. Stage 2 must add negative architecture fixtures so CI proves forbidden imports fail, not merely that the initial graph happens to be clean.

## 7. Release tooling decisions

- **Syft `1.51.0`** creates the SBOM in CI.
- **Cosign `3.1.3`** signs/verifies release artifacts and attestations in CI/deployment tooling.
- **Caddy `2.11.4`** is the qualified edge binary candidate; only Caddy may become network-exposed, under later exact-host, TLS and firewall approvals.

All three official Linux amd64 artifacts passed checksum and executable-version probes outside CT 200. Their use still requires Stage 10 implementation, credentialless/short-lived signing design, exact-artifact smoke tests, and explicit approval for exposure. No signing key or credential is stored in source or this decision record.

## 8. Explicitly rejected or deferred alternatives

- `vite-tsconfig-paths`: rejected and absent; use owned explicit aliases/package exports.
- `better-auth@1.6.28` / `auth@1.6.28`: rejected at this freeze because the minimum-release-age gate had not elapsed.
- unaligned Better Auth runtime/CLI versions: forbidden.
- `@nestjs/swagger` as an implicit domain/DTO contract source: not selected; use owned Zod allowlists.
- Debian Node `20.19.2` as the application runtime: not selected.
- Debian PostgreSQL metapackage major 17: not selected.
- npm/Yarn as the workspace package manager: not selected.
- Turborepo, Docker/Kubernetes, microservices, broker, cache or control plane: not authorized.
- application startup migrations or Better Auth `migrate`: forbidden.
- Stage 1 generated SQL/dump files as product source: forbidden and removed.

## 9. Probe result record

The corrected candidate passed:

- clean strict and frozen dependency installs;
- full engine/peer graph and zero-vulnerability audits;
- TypeScript, NestJS, React/Vite/Tailwind builds;
- ESLint, dependency-cruiser and Vitest;
- exact Better Auth CLI generation for both realms;
- physically separate Staff/Portal namespaces;
- PostgreSQL `pg` and Kysely connectivity;
- `node-pg-migrate` up/down;
- `pg_dump`/`pg_restore` table-set equivalence;
- pgBackRest, Caddy, Syft and Cosign executable compatibility.

The disposable PostgreSQL server was stopped cleanly and its loopback port returned `no response` before cleanup.

## 10. Later-stage gates that remain mandatory

These are not Stage 1 blockers but cannot be silently skipped:

1. Stage 2 must create only the approved modular-monolith workspace and negative boundary tests.
2. Stage 3 must run real pinned PostgreSQL constraint/privilege/migration tests.
3. Stage 4 must own and review both Better Auth migration realms and authorization tests.
4. Stage 10 must prove continuous time synchronization, exact CT artifact compatibility, systemd hardening, local-only PostgreSQL, exact-host rejection, backup/restore and signed-artifact installation.
5. DNS/TLS/firewall/public exposure, production credentials and destructive operations require explicit approval.
6. CT 200 remains DEVELOPMENT and must never receive production data.

This record authorizes no Stage 2 action until the independent Stage 1 review and closure artifacts return GO.
