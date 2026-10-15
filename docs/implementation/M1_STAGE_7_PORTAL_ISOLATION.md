# TravelOS Phase 1 M1 Stage 7 — Portal isolation extension

**Status:** approved implementation delta for Stage 7 only

**Scope:** Portal Trip reads through explicit TripAccessGrant authorization and the immutable active Published Snapshot. This document does not reopen or alter Stage 6.

## Immutable predecessor

Stage 7 starts from the Stage 6 GO commit `6242e023953ccb8fe883bff97a0d62e64af8b66a`, annotated tag `travelos-phase-1-m1-stage-6-gen07-revision-04-go`, tag object `8d951cbf739a69695ea98e2a31b5532ee0b0d951`. Stage 6 revision 03 remains the preserved NO_GO record. Stage 6 migrations, source baseline, freeze, review, and final decision are immutable; the Stage 7 verifier binds their accepted hashes and executes the Stage 6 verifier at its exact accepted ref.

## Approved Stage 7 delta

Stage 7 adds one capability: an authenticated Portal principal may read one Trip only when an explicit, active TripAccessGrant authorizes the principal for that Trip and an active publication exists. The only Stage 7 Portal capability is `trip.view_current`; grant management is Staff/Admin-only through the permission ID `trip.access.manage`, Agency scope, permission-registry version 5, and the accepted agency Owner template.

A grant is scoped to Agency, Portal Principal, and Trip. It records its issuing and revoking actor and timestamps, may have an expiry and an optional relationship label for UX only, and is default-deny. A matching email, Customer, Person, Traveller, family/group membership, or guessed Trip identifier never creates access. Portal principals cannot issue, modify, or elevate grants. Grant issue and revocation are Staff-controlled transactional operations with their own audit events; retryable mutations use explicit idempotency. No DocumentGrant, invitation workflow, or generalized sharing subsystem is added.

Grant revocation increments that Portal principal's authorization epoch in the same transaction. Portal sessions carry and check the epoch; stale sessions and authorization results cannot survive revocation. Stage 7 introduces no separate authorization cache. This follows `docs/PERMISSIONS.md` §5 and §7.

## Portal read boundary

Portal authentication uses only the Portal identity realm. The Portal API imports the explicit `@travelos/auth-adapters/portal` package export, which exposes the Portal factory and the Portal-safe transport/connection surface; the Staff-capable root export is rejected by the Portal package-boundary policy. Staff and Portal principals, sessions, cookies, and APIs remain distinct; equal email values grant no cross-realm trust. Portal self-grant and write operations are absent.

The read path is:

1. Resolve a valid Portal-realm session and verify the current Portal principal authorization epoch.
2. Resolve the current active TripAccessGrant for the requested Agency, Portal Principal, Trip, and `trip.view_current` capability. Recheck expiry and revocation server-side.
3. Resolve the accepted active-publication pointer and immutable publication snapshot.
4. Map and validate the allowlisted `PortalTripSnapshotV1` contract before returning it.

Missing/invalid authorization or absent active publication has one generic non-leaking public denial result. Trip IDs are identifiers, never bearer capabilities. There is no fallback to mutable workspace state. A workspace edit after publication cannot change a Portal response; only a new active publication changes it, and historical snapshots remain immutable.

`INTERNAL_ONLY` values, supplier cost/margin, staff-only identifiers, provider secrets, internal notes, activity/audit/outbox/job payloads, and unknown fields are structurally excluded from Portal repository results and response contracts. Portal output is never built from broad Admin/domain entities, denylist filtering, object spread, unknown-field passthrough, or mutable Flight/Accommodation/Reservation tables.

## PostgreSQL and migration boundary

The Portal runtime login remains `travelos_portal_api` and is distinct from Admin, Worker, migrator, and owner identities. The capability role is `travelos_portal_runtime`. It receives only the narrow privileges needed to check Portal principal/session epoch, TripAccessGrant, active-publication pointer, and immutable Portal snapshot columns. It has no routine SELECT on mutable workspace or unrelated operational tables; no `PUBLIC` grants, owner/migrator inheritance, broad schema grants, `SECURITY DEFINER` shortcut, or privileged view is introduced.

The sole schema change is migration `0012_stage7_portal_trip_access.cjs`, following accepted migration `0011_stage6_trip_publication`. It is checksum-manifested, deterministic, run by `travelos_migrator` with the canonical runner's `SET ROLE travelos_owner`, and explicitly establishes least-privilege runtime grants. No Better Auth runtime migrations are used. The TravelOS migration chain remains the sole schema authority; migration 0011 and all earlier migrations are unchanged.

## Scope exclusions and qualification

Stage 7 is read-only Portal isolation, not broad UI work. It does not expand Worker/outbox processing, audit/activity UI, observability, or Stage 9 UI. Stage 8 actions = 0. PostgreSQL remains loopback-only; CT200 runs the exact immutable artifact and performs no source compilation.

Qualification must exercise realm separation, epoch invalidation, grant default-deny and Trip scope, no active publication, immutable v1/v2 publication transitions, `INTERNAL_ONLY` sentinel absence, repository/response/log/error leakage, actual `travelos_portal_api` allowed and denied SQL, and adversarial architecture-import fixtures. Runtime acceptance uses only clearly synthetic data, created through normal application flows, and retains no passwords, cookies, TOTP secrets, or decrypted credentials.

Stage 7 actions = 1

Stage 8 actions = 0
