# Stage 7 Runtime Acceptance Cleanup Successor

- **Stage:** Phase 1 M1 Stage 7
- **Successor generation:** gen11
- **Branch:** `stage7/runtime-acceptance-cleanup-successor`
- **Predecessor:** immutable gen09, commit `0cf07d04e93171c1de6300629a3759ce888da6a7`
- **Contract:** source `deploy/contracts/stage-7-extension.v2-gen11.json` (schema v2; packaged at `deployment/stage-7-extension.v2.json`)

## Purpose and scope

The gen09 acceptance runner creates synthetic Trips and a Portal identity but has no supported application cleanup path. The gen11 successor carries the approved narrow, retry-safe lifecycle for only the resources registered to one runtime-acceptance fixture run. It does not change the gen09 artifact, its v1 deployment contract, its canonical baseline, or its 42/42 PASS CI evidence.

The one-shot acceptance runner uses one generated fixture-run UUID for both Trips and Portal enrollment. Application code registers resources atomically and cleanup derives all resource identifiers from that run. A fixture UUID is not a bearer capability. At most one unresolved run per Agency is allowed; the run records its creator, Agency, typed resource links, timestamps, and `OPEN`, `CLEANUP_PENDING`, or `CLEANED` state. It carries no credentials or arbitrary payload.

## Cleanup contract

The sole cleanup route is `POST /api/admin/runtime-acceptance-fixtures/:fixtureRunId/cleanup` on the **EXISTING_ADMIN_API** listener. It is **DEVELOPMENT_ONLY**, and host validation uses the **EXACT_DEVELOPMENT_MANIFEST_ALLOWLIST** before authentication or data lookup. There is no new listener, no new externally reachable port, no public signup endpoint, and no general-purpose privileged command interface.

The request is strict and contains only an idempotency key. The server derives Staff Principal and Agency from the Staff session. It requires the Staff realm, active membership, exact Agency scope, recent MFA (300 seconds), and permission IDs `runtime_acceptance.fixture.manage`, `trip.access.manage`, `trip.edit`, and `trip.withdraw_publication`. It rejects caller-supplied resource IDs, unknown fields, cross-Agency runs, and resources not linked to the registered fixture run.

Fixture Trip creation is tagged only by `X-TravelOS-Acceptance-Fixture-Run` when the signed instance manifest composes the DEVELOPMENT capability. Without that capability, the header is rejected and cannot fall through to ordinary Trip creation. An unresolved-run conflict exposes `recoveryFixtureRunId` only to its recorded creator; other callers receive the same generic conflict without a run identifier. The cleanup response is an independently authored strict allowlist containing the run ID, lifecycle state, bounded effect counts, retained publication/audit counts, and a sanitized error code; it contains no resource payloads or credentials.

Cleanup is retry-safe and proceeds through supported application operations:

1. Move the run to `CLEANUP_PENDING` with the owning audit record.
2. Revoke TripAccessGrants registered to the run.
3. Withdraw active publication pointers without altering immutable snapshot bytes or payloads.
4. Cancel only the registered synthetic Trips through normal Trip commands.
5. Retire the synthetic Portal Principal and increment its authorization epoch so existing and new sessions no longer resolve to authorized Portal context.
6. Mark the run `CLEANED` only after every registered effect and invariant is verified.

Unexpected resources fail closed and remain pending with a sanitized error code. Repeated calls reconcile the same run and do not duplicate business effects. The system preserves immutable publication snapshots, publication payloads, Trip workspace, and minimum audit/outbox history plus minimum principal history. It does not physically delete retained history, directly edit Better Auth user/session tables, or claim immediate cryptographic erasure.

## Database and migration boundary

Migration `0013_stage7_runtime_acceptance_cleanup.cjs` is append-only after migration head `0012_stage7_portal_trip_access`. It adds the bounded fixture registry, same-Agency constraints, creator/run links, lifecycle state, audit support, permission registry version 6, and least-privilege ACLs. Portal runtime receives no fixture registry `SELECT` or direct write. Any Portal association uses only the narrowly named `SECURITY DEFINER` function with fixed `search_path`, explicit ACL, same-Agency validation, and strict cardinality. Worker and `PUBLIC` receive no capability.

The v2 deployment contract uses evidence-binding mode `CHECKSUM_MANIFEST_AND_SUCCESSOR_SOURCE_BASELINE`: it binds the accepted gen09 checksum-manifest prefix and the exact 0013 bytes through the successor source baseline. The immutable gen09 v1 contract and migration 0012 remain untouched. Migration execution is forward-only through the approved migration runner after the successor's local and canonical CI gates pass.

## Runner and credentials

The runner attempts cleanup in `finally` before signing out, on both successful and failed acceptance. It uses the same run UUID for both Trips and local Portal enrollment, attempts cleanup by that UUID after ambiguous request outcomes, and never starts another run while an earlier creator-owned run is unresolved. Cleanup failure is non-zero and retains only sanitized assertion/error codes; it never masks the original acceptance failure.

The existing DEVELOPMENT operator one-shot and credential bindings remain unchanged: the three staff inputs and service credentials are delivered only through `CREDENTIALS_DIRECTORY` using the approved encrypted credential mechanism. No listener or endpoint is added for credential delivery. Decrypted values are not printed, logged, persisted, placed in command-line arguments, or copied into evidence. A fresh TOTP is calculated only when the actual MFA challenge occurs; a code is never assumed reusable.

## Successor data ownership, classification, and permissions

This successor supplement carries the Stage 7 schema and permission delta without modifying the byte-protected Phase 0 `docs/DATA_MODEL.md` and `docs/PERMISSIONS.md`. The exact supplement is bound by the gen11 source manifest.

| Field group | Owner | Classification | Portal eligibility | Retention |
|---|---|---|---|---|
| Agency/run IDs, state, and lifecycle timestamps | Runtime Acceptance | INTERNAL | No Portal contract/source field | Retain run rows; no automatic purge in this Stage 7 successor |
| Creating Staff Principal ID | Staff Access | CONFIDENTIAL actor reference | No Portal contract/source field | Retain as minimum provenance |
| Optional Portal Principal ID | Portal Access | CONFIDENTIAL pseudonymous identity reference | No Portal contract/source field or registry read grant | Retain for cleanup reconciliation; the association capability does not return registry data |
| Typed Trip IDs and slots 1–2 | Trip Operations / Runtime Acceptance | INTERNAL synthetic-resource references | No Portal contract/source field | Retain typed links with the run |
| Fixture event type, actor kind/ID, optional Trip/Portal Principal ID, and timestamp | Audit | CONFIDENTIAL audit metadata | No Portal contract/source field | Retain under Agency audit retention; append-only, with no runtime DELETE privilege |

`portal_access.runtime_acceptance_fixture_run` has a same-Agency creator and optional Portal Principal reference, one immutable association, a partial unique index for at most one unresolved run per Agency, and the `OPEN → CLEANUP_PENDING → CLEANED` lifecycle. `portal_access.runtime_acceptance_fixture_trip` uses explicit same-Agency/run and same-Agency/Trip foreign keys; these prove that the run and each linked Trip belong to the same Agency. Its constrained slots and unique Trip reference permit at most two distinct Trips. Completed runs and their links remain as minimal cleanup/reconciliation evidence. The Portal runtime has no fixture-table read or direct write privilege; its only fixture capability is the narrowly scoped database association function, and no fixture DTO/source field is eligible for Portal output.

Migration 0013 advances the permission registry to version 6 and adds Agency-scoped, `ALL` access-level permissions `trip.withdraw_publication` and `runtime_acceptance.fixture.manage` to the existing `agency-owner-v1` template. The fixture permission authorizes only registered runtime-acceptance lifecycle operations; separate Trip edit, Trip access-management, publication-withdrawal, Agency-scope, active-membership, and recent-MFA checks still apply.

## Evidence and phase limits

The gen11 successor baseline preserves the exact gen09 baseline, v1 extension, artifact digest, and canonical CI receipt as predecessor evidence. The consumed gen10 CI failure remains immutable historical evidence and is not reused. Gen09 canonical CI remains **42/42 PASS** and is not rerun. The gen11 candidate is not frozen until implementation, integration, and local qualification are complete; ordinary test failures are corrected in this same successor worktree.

- **Stage 7 actions = 1.**
- **Stage 8 actions = 0.**

No production deployment, destructive database operation, direct authentication-table mutation, MFA bypass, new public exposure, push, or Stage 8 action is authorized.
