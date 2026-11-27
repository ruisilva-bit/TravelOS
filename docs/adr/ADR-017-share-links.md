# ADR-017: Share Links

- **Status:** Accepted
- **Date:** 2026-11-27
- **Decision owner:** Product Owner (Rui)
- **Supersedes in part:** ADR-004 (how customers reach a snapshot)

## Context

ADR-016 removed customer login. Customers still need to see their trip. The immutable, allowlisted
snapshot from ADR-004 stays; only the delivery changes.

## Decision

1. **A share link is the only customer access.** Staff with `trip.publish` click "Partilhar". In one
   transaction the system freezes a snapshot (existing projection, canonical JSON and hash) and
   creates a link `https://<host>/v/<token>`. Later edits never change an existing link; sharing
   again creates a new snapshot and a new link.
2. **Token storage.** The token is 32 random bytes, base64url without padding (43 characters). Only
   its SHA-256 (32 bytes, `trip_ops.share_link."tokenHash"`) is stored. The raw token exists only in
   the creation response and is never logged, listed or recoverable. Reusing an idempotency key
   returns a conflict, because the token cannot be shown again.
3. **Expiry and revocation.** Validity is 1 to 365 days (default 90; the database also checks
   `expiresAt <= createdAt + 366 days`). Revocation sets `revokedAt` once; the table is append-only
   (a trigger allows only `revokedAt` NULL to a value, and forbids DELETE and TRUNCATE).
4. **Allowlist.** The page renders only `TripSnapshotV1Schema` (strict, explicit fields).
   INTERNAL_ONLY values have no member in the contract; unparsable payloads yield 404.
5. **Public route hardening.** `GET /v/:token` needs no cookie but keeps the host allowlist.
   The route reads through `trip_ops.read_share_snapshot(bytea)`, a `SECURITY DEFINER` function that
   returns a row only for an unrevoked, unexpired token hash; the admin runtime role has `EXECUTE`,
   the worker role and PUBLIC have none. Malformed, unknown, expired, revoked and unparsable links
   all give the same 404 body and headers. Every response carries `Cache-Control: no-store`,
   `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, `X-Content-Type-Options: nosniff`
   and a `default-src 'none'` CSP. Requests are rate limited per client (60/min, then 429). The token
   is read from the raw path only; request telemetry logs status and duration, never the URL.
6. **Routing.** The reverse proxy must send `/v/*` to admin-api before any SPA fallback. admin-api
   answers everything under `/v` itself, so it can never fall through to a shell.

## Consequences

- Publication pointer, event, audit and outbox tables are no longer written and can be omitted when
  the migration chain is squashed. Publication versions and snapshots remain the frozen content.
- Revocation does not need recent MFA (it is a safety action); creation does.
