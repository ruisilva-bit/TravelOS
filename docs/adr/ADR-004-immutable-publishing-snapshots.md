# ADR-004: Immutable Publishing Snapshots

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

Agency staff edit mutable operational data. Customers must continue seeing the last explicitly released version until another publication. Preview cannot publish, and internal fields must be structurally impossible to expose.

## Decision

Create customer projections through family-specific allowlist source ports into a separately authored, versioned Portal snapshot schema. `INTERNAL_ONLY` fields have no source/target contract member and cannot be configured visible.

Preview is a pure read that returns projection, workspace revision and canonical hash with zero writes. Publish requires the expected revision/hash and idempotency key; in one serializable transaction it rebuilds/verifies the projection, inserts immutable metadata plus a separate immutable validated payload and atomically advances the current pointer. No external network call occurs inside that transaction. Routine runtime roles cannot update/delete metadata or payload. Portal reads only the active presentation payload through a restricted database role and a narrow authorized adapter.

Historical schema versions retain the canonical payload plus renderer/upcaster support while policy permits retention. Corrections create new versions; withdrawal is an append-only event/pointer operation. A narrowly privileged privacy-deletion command may remove only the separate payload and preserve lawful metadata/evidence under ADR-014. Encrypted backups may retain an older copy until approved expiry; the product does not call that copy erased.

## Consequences

- Strong safety, reproducibility and auditability.
- Storage duplicates presentation data and schema renderers must be retained.
- Portal rendering depends only on the restricted presentation read path; payloads are never static assets or generic caches.
- Publication-relevant mutations must consistently increment Trip workspace revision.
- Notifications are eventual consequences and cannot determine publish success.

## Rejected

- Portal live joins to workspace: violates the core product promise.
- Denylist serialization: unknown/new internal fields can leak.
- Preview token/version row: violates zero-side-effect requirement.
- Mutable snapshots: destroys history and race semantics.
- Claiming active deletion also removed copies from retained backups: it does not.

## Revisit trigger

None for the safety principle. Storage/serialization format may change only while preserving allowlist, immutability, concurrency and historical rendering guarantees.
