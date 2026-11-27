# ADR-016: Internal Single-Agency Tool

- **Status:** Accepted
- **Date:** 2026-11-27
- **Decision owner:** Product Owner (Rui)
- **Supersedes:** ADR-002, ADR-003, ADR-014; ADR-007 (Portal identity realm only); ADR-011 (Portal document grants only); ADR-015 (process and evidence parts only)

## Context

TravelOS was designed as a multi-agency product: dedicated instance per customer, a fleet
migration chain, separate Portal identity realm, signed release artifacts and committed
per-stage evidence. In reality it is an internal tool for one travel agency, with no audit or
legal obligation. The machinery cost far more than the product code it protected and blocked
ordinary refactors.

## Decision

1. **Single agency.** TravelOS serves one agency, deployed on that agency's own server (CT200).
   There is no fleet, no per-customer instance, no per-customer database.
2. **No customer login.** There is no Portal identity realm and no customer accounts. Customers
   receive a revocable, read-only share link to a frozen snapshot of the trip. The snapshot is
   built from an explicit field allowlist; INTERNAL_ONLY fields (supplier cost, margin,
   internal notes, supplier) have no field in the snapshot contract. Staff login stays on
   Better Auth.
3. **Simple operations.** Deploy with a simple script from a CI-built build. Back up with a
   nightly `pg_dump`. No signed artifacts, no release promotion pipeline.
4. **One gate.** `pnpm check` is the only gate, locally and in CI. No stage gates, frozen
   verifiers, evidence folders or review records are committed.
5. **Rules that stay:** money as bigint minor units plus currency; INTERNAL_ONLY isolation;
   server-side permission checks; no secrets in the repository; one checksummed migration chain.

## Consequences

- Large parts of `docs/evidence`, `docs/reviews`, stage tooling and deployment contracts are removed.
  Git history keeps them.
- Older ADRs and architecture documents that describe multi-tenant, fleet, Portal realm,
  privacy-erasure-across-backups or signed-release behaviour are historical where they conflict
  with this ADR.
- Share links are a later feature and need their own design (token storage, expiry, revocation).
- If TravelOS ever serves more than one agency, that requires a new ADR.
