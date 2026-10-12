# Phase 1 M1 — Stage 6 Preview, Publish and Immutable Snapshots

**Status:** Stage 6 implementation record; not a Stage 6 closure or deployment authorization.  
**Authority:** Accepted Phase 0 baseline, ADR-004, ADR-008, ADR-009, `AGENTS.md`, and the approved Stage 6 execution brief.  
**Scope:** Staff Preview, explicit publication, immutable versioned Trip snapshots, active pointer and Staff-only history. Portal access grants, Portal consumption, worker delivery behavior and all Stage 7 work remain out of scope.

## Safety boundary

The customer presentation snapshot is independently authored as strict `PortalTripSnapshotV1`. Publication reads narrow trip, flight, accommodation and customer-safe source ports. Persistence queries enumerate publication-safe columns; supplier-cost data, internal notes, credentials, staff session data, raw provider data and unrelated integration fields are not part of the source port or projection. The shared pure projection assembler is used by both Preview and Publish.

Visibility resolves platform default → Agency default → item override. `INTERNAL_ONLY` fields are not representable in the source or snapshot allowlist and cannot be made visible by configuration. Canonical JSON is deterministic and hashed with SHA-256; collection ordering is explicit and covered by golden fixtures.

## Preview

Staff Preview checks `trip.preview`, assembles and validates the projection from one consistent read, and returns workspace revision, projection hash, schema version and projection. It creates no publication, version, pointer, idempotency, activity, audit, outbox or job records. Preview has no implicit clock, randomness, network, authorization or database-write behavior in its projection assembler.

## Publish and concurrency

`trip.publish` is enforced at the application boundary and revalidated against live membership, permission and database-time recent MFA inside one PostgreSQL `SERIALIZABLE` transaction. The command acquires the per-Trip publication coordinator through a narrowly granted `SECURITY DEFINER` function. The private coordinator generation row is updated transactionally so overlapping serializable publishes conflict rather than allocate competing versions; runtime roles have no direct table privilege. The same function locks the Trip row while publication-safe sources are re-read.

Publish verifies the expected workspace revision and projection hash, invokes the shared Preview assembler, validates the strict V1 contract, and either replays the existing successful idempotent result or creates the next immutable version. Same-key/different-request reuse fails closed. Stale revision or hash returns `STALE_PUBLICATION_CANDIDATE` without allocating a version or emitting publication records. Bounded whole-transaction retries apply only to serialization/deadlock/idempotency-race outcomes; external effects are deferred.

Version metadata, canonical snapshot payload, current pointer, publication event, Audit event, outbox message and idempotency mapping are committed atomically. The version and payload are protected by immutable database triggers and routine-role privileges. The pointer is separate and may advance exactly one version at a time. Preview/history are Staff-only; no history route is exposed by the Portal API.

## Migration and verification

Migration `0011_stage6_trip_publication.cjs` follows the Stage 5 head `0010_stage5_temporal_persistence_parity`; it is forward-only and is recorded in `migrations/checksums.json`. The disposable PostgreSQL 18.6 harness migrates from the Stage 5 schema and exercises authorization, read-only Preview, stale revision/hash rejection, v1/v2 immutability, idempotency, active history, rollback atomicity, concurrent blocking/retry, recent-MFA denial and runtime-role mutation denial. The V1 contract, canonical hash and Admin HTTP route tests remain separately executable.

Stage 6 is not closed by these implementation notes or focused test results. Full `pnpm ci:verify`, development artifact provenance, fresh CT200 backup, exact-artifact promotion, authenticated CT200 smoke, evidence indexing/freezing, independent review, formal closure and Git sealing are separate required gates. CT200 has not been authorized for mutation by this record. Stage 7 actions remain 0.
