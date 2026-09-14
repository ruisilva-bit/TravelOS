# TravelOS Phase 0 Independent Architecture Review — First Pass

- **Review type:** independent adversarial architecture review
- **Reviewed bundle:** `docs/reviews/PHASE_0_CANDIDATE_FREEZE.md`
- **Freeze timestamp:** 2026-08-13T16:50:10+01:00
- **Freeze bundle SHA-256:** `06bf41b770f830d6a110422f21c8fb23ef54b30884e91d3c474b370c7638d3e4`
- **Reviewer:** independent delegated agent; not the architecture author
- **Result:** GO AFTER CORRECTIONS

## Freeze verification

All 26 SHA-256 entries in `docs/reviews/PHASE_0_CANDIDATE_FREEZE.md` matched the workspace files exactly. The reviewer assessed only the frozen bundle and modified no project file.

## Findings

### TOS-AR-001 — MEDIUM — Host-based Portal selection is under-specified

**Affected docs:** `docs/DEPLOYMENT_MODEL.md` §§2, 4, 10; `docs/SECURITY_MODEL.md` §§2, 8; `docs/DESIGN_SYSTEM.md` §11

**Evidence / failure scenario:** The deployment model says Caddy selects the static bundle and API upstream by host/path, and that Portal branding is fetched from an allowlisted published Agency profile by `Host`. The security model also allows custom Portal domains and host-only cookies. However, the architecture does not explicitly require a canonical host allowlist, unknown-host rejection, or normalization of `Host` / `X-Forwarded-Host` before any tenant lookup. A crafted host header or probe of candidate domains can therefore become a tenant-discovery oracle or steer the request into the wrong Portal surface if proxy rules drift.

**Consequence:** Portal URL enumeration, host-header confusion, and brittle custom-domain/cookie boundaries.

**Recommended correction:** Define the exact host allowlist in the instance manifest, reject unknown `Host` and `X-Forwarded-Host` at both the edge and app layers, and make unknown-host responses body/timing indistinguishable from a dead tenant. Add explicit tests for host probing and host-header tampering.

### TOS-AR-002 — MEDIUM — Grant revocation is not immediate for already-issued signed download capabilities

**Affected docs:** `docs/PERMISSIONS.md` §§5–7; `docs/SECURITY_MODEL.md` §7; `docs/adr/ADR-011-document-storage-and-explicit-access-grants.md`

**Evidence / failure scenario:** The security model permits signed Portal capabilities with a bounded lifetime of up to five minutes, and revocation is described as taking effect on new requests immediately. That still leaves a residual window in which an already-issued signed download URL remains usable after the grant or session has been revoked. For restricted documents, that is a real access window, not just a UX delay.

**Consequence:** A revoked Portal document or trip grant can continue to work long enough to download passports, medical documents, or other restricted files after revocation.

**Recommended correction:** Either eliminate signed download capabilities for restricted documents entirely, or bind every download to a revocation epoch checked server-side on each request. If signed URLs remain, restrict them to low-sensitivity content only and document that explicitly.

### TOS-AR-003 — MEDIUM — Outbox/job replay still depends on provider-side discipline after ambiguous outcomes

**Affected docs:** `docs/ARCHITECTURE.md` §9; `docs/adr/ADR-009-transactional-outbox-and-postgresql-jobs.md`; `docs/SECURITY_MODEL.md` §10

**Evidence / failure scenario:** The design correctly chooses at-least-once delivery, bounded leases, and idempotent handlers. But the provider contract is still under-specified for the most dangerous case: the worker crashes after an external side effect succeeds, before local completion is persisted. The docs mention provider idempotency keys and persisted responses as one of several mechanisms, but they do not require a reconciliation/read-after-write path for every non-idempotent provider. If the provider cannot prove outcome identity, replay can duplicate the side effect.

**Consequence:** Duplicate bookings, duplicate notifications, duplicate payments, or contradictory provider state after crash/retry.

**Recommended correction:** Make durable business-key reconciliation mandatory for every non-idempotent adapter. If a provider cannot support that contract, keep the integration manual or block it entirely. Add chaos tests that crash after the external effect and verify no duplicate consequence.

### TOS-AR-004 — HIGH — Privacy erasure is not durable across immutable backups

**Affected docs:** `docs/PRODUCT_BLUEPRINT.md` §9; `docs/DEPLOYMENT_MODEL.md` §8; `docs/PUBLISHING_MODEL.md` §10; `docs/DATA_MODEL.md` §11; `docs/SECURITY_MODEL.md` §12

**Evidence / failure scenario:** The backup model says backups are immutable and not selectively mutated, and restoration re-applies the erasure ledger before service opens. But the architecture does not specify an independently retained erasure ledger or any backup-side crypto-shredding / key-revocation mechanism. That means an older retained backup can still contain the raw bytes of a document or publication payload that the live system considers erased. If the restore path is incomplete, or if an operator accesses backup media directly, erased content can reappear.

**Consequence:** The architecture cannot prove that privacy erasure survives the backup lifecycle. For passports, medical data, and publication payloads, that is a serious compliance and trust failure.

**Recommended correction:** Store erasure instructions in an independently retained append-only ledger outside the mutable data set, require crypto-erasure or equivalent key shredding for erased payload classes, and prove in restore drills that erased payloads remain unrecoverable from every retained backup. If that cannot be guaranteed, narrow the meaning of “erasure” before production.

### TOS-AR-005 — LOW — The root constitution is missing from the repository root

**Affected docs:** `docs/reviews/AGENTS_CANDIDATE.md`; `docs/README.md`; freeze manifest

**Evidence / failure scenario:** The freeze manifest explicitly says the root `AGENTS.md` is absent because protected write approval did not complete, and the only constitution copy is the review file. Future implementation work can therefore proceed with no root-level canonical constitution, even though the architecture docs reference one.

**Consequence:** Governance/process drift, not a runtime architecture defect.

**Recommended correction:** Create the root `AGENTS.md` before implementation starts, or formally declare the candidate copy the frozen authority for Phase 0 and carry that decision into the acceptance gate.

## Strengths and non-findings

- The candidate is unusually disciplined about separate Staff and Portal realms, explicit grants, immutable publication snapshots, exact money and fleet-safe migrations.
- The reviewer found no structural contradiction in concurrent preview/publish, edit-after-preview stale rejection, same-trip document access, webhook replay handling, migration-wave rollback, restore to an older compatible schema/app or historical snapshot rendering after schema evolution.
- Reservation and Itinerary Item are correctly modeled as separate concepts with an explicit many-to-many relationship.
- The publication model is materially stronger than a denylist-based or live-join Portal design.

## Independent recommendation

**GO AFTER CORRECTIONS**

The architecture is close, but the host-selection boundary, document revocation semantics, provider replay story and especially privacy erasure across backups require explicit closure evidence.

## Closure evidence required

1. Exact host allowlist plus negative tests for unknown/crafted `Host` and `X-Forwarded-Host` values.
2. Revocation drill proving a revoked document grant cannot use a previously issued download URL; explicit signed-URL class policy if any remain.
3. Crash-after-external-success chaos tests and adapter conformance proving reconciliation/idempotency.
4. Restore drills proving erased payloads do not reappear, backed by an independent durable erasure ledger or crypto-shredding mechanism.
5. Root `AGENTS.md` created or explicit formal substitution.

This is a first-pass report. It does not claim that any finding is closed.
