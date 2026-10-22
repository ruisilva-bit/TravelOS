# Product Owner decision adjustment — Stage 7 runtime-acceptance cleanup (gen12 rollover)

- **Decision owner:** Rui, Product Owner
- **Original product decision recorded:** 2026-10-20
- **Additional generation authorization recorded:** 2026-10-21
- **Status:** Existing product semantics carried forward; one gen12 canonical-CI invocation authorized
- **Successor:** gen12, branch `stage7/runtime-acceptance-cleanup-successor`

Candidate rollover only; no product-scope expansion.

## Decision carried forward

Rui approved the narrow DEVELOPMENT cleanup route on the existing Admin API listener.

The only authorized HTTP route is `POST /api/admin/runtime-acceptance-fixtures/:fixtureRunId/cleanup`. It is DEVELOPMENT-only, uses the exact DEVELOPMENT manifest host allowlist, and is composed into the existing Admin API; it adds no listener, port, public signup path, or general-purpose privileged execution interface.

The route accepts only the registered fixture-run identifier in the path and a strict idempotency key in the body. It does not accept caller-supplied Trip, grant, Portal Principal, or session identifiers. Every operation resolves the fixture run from the authenticated Staff Principal's exact Agency and creator scope, checks active membership and the required permission IDs, and requires recent MFA (300 seconds).

Cleanup is logical retirement of the registered synthetic resources: revoke their TripAccessGrants, withdraw the active publication pointer, cancel the registered Trips, invalidate Portal authorization through principal retirement/epoch checks, and mark the fixture run `CLEANED` only when all effects have been verified. Failed or interrupted effects remain retryable as `CLEANUP_PENDING`.

Immutable publication snapshots and audit/outbox history remain retained. Trip workspace and minimum principal/audit history are retained; this is not physical deletion and does not alter Better Auth user or session rows directly.

## Candidate-generation rollover record

The gen10 candidate's canonical CI was invoked once and consumed with **FAIL** at `stage6-predecessor:security-scan`; its receipt and log remain immutable historical evidence. The gen11 canonical CI was invoked once but was interrupted by the terminal runtime ceiling after 40 of 42 gate sections, with no final result marker and no execution receipt. Gen11 remains `INTERRUPTED`; its partial log, claim, guard, artifact, and baseline are preserved, and its CI must not be rerun.

Rui explicitly authorized one additional successor, gen12, and exactly one monitored canonical-CI invocation after that gen11 interruption. This is a generation authorization only: it does not authorize gen13 or any repeat of gen11, gen10, or gen09 CI. Gen09's 42/42 PASS and artifact remain immutable.

Gen12 therefore carries the same product behavior and approval but owns a distinct source baseline, artifact, and one-shot canonical CI. CT200 remains at migration head 0012 and must remain untouched until gen12's canonical CI is verified PASS.

Its source contract is `deploy/contracts/stage-7-extension.v2-gen12.json`; this preserves the gen10 and gen11 source-contract bytes. The candidate artifact still packages the unchanged v2 schema at `deployment/stage-7-extension.v2.json`.

## Limits and evidence

- Permission IDs: `runtime_acceptance.fixture.manage`, `trip.access.manage`, `trip.edit`, and `trip.withdraw_publication`.
- Scope: at most two Trips and one synthetic Portal Principal in one registered run, same Agency and creator.
- The one-shot acceptance runner must attempt cleanup before sign-out on success and failure; failed cleanup returns non-zero and remains recoverable.
- Credentials remain in the existing one-shot `CREDENTIALS_DIRECTORY` contract; TOTP is fresh for each MFA challenge and no secret value is emitted or persisted.
- The v2 contract binds migration `0013_stage7_runtime_acceptance_cleanup.cjs` through the checksum manifest and successor source baseline.
- Stage 7 actions = 1.
- Stage 8 actions = 0.

This carry-forward does not authorize production deployment, destructive database operations, direct authentication-table edits, MFA bypass, new network exposure, push, or Stage 8 work.
