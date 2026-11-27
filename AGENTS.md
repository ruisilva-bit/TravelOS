# AGENTS.md — TravelOS working rules

## What TravelOS is

TravelOS is an INTERNAL tool for ONE travel agency (the owner's). It is not a SaaS product and has
no fleet of customer instances. There is no audit or legal obligation driving the design, and
customers have no login. Later, customers will get a revocable, read-only share
link to a frozen snapshot of their trip (see `docs/adr/ADR-016-internal-single-agency-tool.md`).

## Stack

- pnpm monorepo (`apps/`, `packages/`, `tests/`, `migrations/`, `tooling/`, `deploy/`)
- React + Vite SPA (`admin-web`), NestJS `admin-api`, a background `worker`
- PostgreSQL, Kysely, node-pg-migrate (one ordered, checksummed migration chain)
- Better Auth for staff login only
- TypeScript, Zod, Vitest; Node and pnpm versions are pinned (`pnpm verify:pins`)

## Business rules that stay

- Money is `bigint` minor units plus a currency code. Never floats. In JSON, money is a string.
- INTERNAL_ONLY fields (supplier cost, margin, internal notes, supplier) must never reach
  anything customer-facing: share links, snapshots, customer DTOs, logs sent outside, fixtures.
  Customer-facing contracts are explicit allowlists, never "everything minus some fields".
- Permissions are checked server-side in every command/query. Hiding things in the UI is not
  enforcement. Business code checks permission IDs, not role names.
- No secrets, tokens, credentials or real customer data in the repository, fixtures or logs.
- Never claim a test passed without actually running it.
- Applied migrations are never edited; add a new one. Application startup never runs migrations.
- Migrations were squashed into 0001_baseline on 2026-11-27 (no real data existed). From now on applied migrations are never edited; add a new one.

## Working rules

- Run `pnpm check` before saying a change is done. It is the only gate (format, lint, unit
  tests, build, typecheck, architecture boundaries, security scan, PostgreSQL integration tests,
  smoke test). It prints a JSON result ending in `"result": "PASS"` or `"FAIL"`.
- Report failures honestly, with the failing gate. Do not skip, disable or weaken tests to get green.
- Write tests for new behaviour, including the failure and permission-denied paths.
- Ask the owner before: deleting real data, exposing anything to the internet, touching
  DNS/TLS/firewall, or handling credentials.
- CT200 is the agency's own server. Treat it with care; do not hand-edit it, use the deploy
  script.
- Accepted ADRs in `docs/adr/` record decisions. To change one, add a new ADR that supersedes it.

## Keep it simple

No stage gates, frozen verifiers, evidence folders or signing. No new microservice, broker,
cache or control plane without a measured need. Prefer deleting code over adding process.
Toolchain setup: `bash tooling/ci/bootstrap-toolchain.sh`, then `bash tooling/ci/install.sh`.
