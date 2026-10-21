# Product Owner decision adjustment — Stage 7 runtime-acceptance cleanup (gen11 rollover)

- **Decision owner:** Rui, Product Owner
- **Original decision recorded:** 2026-10-20
- **Rollover note recorded:** 2026-10-21
- **Status:** Existing approved semantics carried forward; no new product decision
- **Successor:** gen11, branch `stage7/runtime-acceptance-cleanup-successor`

Candidate rollover only; no product-scope expansion.

## Decision carried forward

Rui approved the narrow DEVELOPMENT cleanup route on the existing Admin API listener.

The only authorized HTTP route is `POST /api/admin/runtime-acceptance-fixtures/:fixtureRunId/cleanup`. It is DEVELOPMENT-only, uses the exact DEVELOPMENT manifest host allowlist, and is composed into the existing Admin API; it adds no listener, port, public signup path, or general-purpose privileged execution interface.

The route accepts only the registered fixture-run identifier in the path and a strict idempotency key in the body. It does not accept caller-supplied Trip, grant, Portal Principal, or session identifiers. Every operation resolves the fixture run from the authenticated Staff Principal's exact Agency and creator scope, checks active membership and the required permission IDs, and requires recent MFA (300 seconds).

Cleanup is logical retirement of the registered synthetic resources: revoke their TripAccessGrants, withdraw the active publication pointer, cancel the registered Trips, invalidate Portal authorization through principal retirement/epoch checks, and mark the fixture run `CLEANED` only when all effects have been verified. Failed or interrupted effects remain retryable as `CLEANUP_PENDING`.

Immutable publication snapshots and audit/outbox history remain retained. Trip workspace and minimum principal/audit history are retained; this is not physical deletion and does not alter Better Auth user or session rows directly.

## Candidate-generation rollover record

The gen10 candidate's canonical CI was invoked once and consumed with **FAIL** at `stage6-predecessor:security-scan`; its receipt and log remain immutable historical evidence. The Stage 7 Task 8 policy permits one successor-generation rollover after that failure, provided the root cause and all local gates are resolved before freezing the successor.

Gen11 therefore carries the same product behavior and approval, but owns a distinct source baseline, artifact, and one-shot canonical CI. It does not reuse or rewrite gen10's claim, artifact, receipt, log, or failure status. CT200 remains gated on gen11's own canonical-CI PASS.

Its source contract is `deploy/contracts/stage-7-extension.v2-gen11.json`; this preserves the gen10 v2 contract bytes. The candidate artifact still packages the unchanged v2 schema at `deployment/stage-7-extension.v2.json`.

## Limits and evidence

- Permission IDs: `runtime_acceptance.fixture.manage`, `trip.access.manage`, `trip.edit`, and `trip.withdraw_publication`.
- Scope: at most two Trips and one synthetic Portal Principal in one registered run, same Agency and creator.
- The one-shot acceptance runner must attempt cleanup before sign-out on success and failure; failed cleanup returns non-zero and remains recoverable.
- Credentials remain in the existing one-shot `CREDENTIALS_DIRECTORY` contract; TOTP is fresh for each MFA challenge and no secret value is emitted or persisted.
- The v2 contract binds migration `0013_stage7_runtime_acceptance_cleanup.cjs` through the checksum manifest and successor source baseline.
- Stage 7 actions = 1.
- Stage 8 actions = 0.

This carry-forward does not authorize production deployment, destructive database operations, direct authentication-table edits, MFA bypass, new network exposure, push, or Stage 8 work.
