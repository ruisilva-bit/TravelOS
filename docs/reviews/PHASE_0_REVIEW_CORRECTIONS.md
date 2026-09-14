# TravelOS Phase 0 Review Correction Matrix

- **First-pass review:** `docs/reviews/PHASE_0_ARCHITECTURE_REVIEW.md`
- **Reviewed freeze:** `docs/reviews/PHASE_0_CANDIDATE_FREEZE.md`
- **First-pass recommendation:** GO AFTER CORRECTIONS
- **Correction owner:** Alex
- **Status:** Corrected candidate awaiting independent closure review

The original freeze and review remain immutable evidence. This document maps every finding to a concrete architecture decision and separates documentary closure from implementation/operational proof. Phase 0 does not claim tests that require software, databases, infrastructure or real data.

## Reviewer findings

| Finding | Severity | Disposition | Phase 0 correction | Required later evidence |
|---|---:|---|---|---|
| TOS-AR-001 Host-based Portal selection | MEDIUM | Accepted | `DEPLOYMENT_MODEL.md` now declares an exact normalized FQDN→surface map in the instance manifest; Host never selects an Agency. Caddy rejects unknown hosts through a fixed default vhost and overwrites forwarded headers. Each API independently validates one canonical effective host before branding/auth/data lookup. `SECURITY_MODEL.md`, `DESIGN_SYSTEM.md` and ADR-002 carry the same rule. | M1 edge/API negative tests for malformed, duplicate, unknown and crafted `Host`/`X-Forwarded-Host`; body/status/cache and bounded timing must not reveal Agency/domain existence. Custom domain verification is required before activation. |
| TOS-AR-002 Signed capability revocation window | MEDIUM | Accepted | Confidential/Restricted Portal documents are always streamed/proxied through Portal API. V1 issues no reusable/direct storage bearer URL. Every request rechecks session, authorization epoch, TripAccessGrant and DocumentGrant. The docs explicitly avoid claiming that already delivered bytes can be revoked. `PERMISSIONS.md`, `SECURITY_MODEL.md`, ADR-011 and `AGENTS_CANDIDATE.md` agree. | When the document slice is implemented: obtain endpoint, revoke session/Trip/Document grant, retry endpoint and prove uniform denial with no metadata leak. Any future protected direct-download mechanism requires a superseding ADR and per-request revocation proof. |
| TOS-AR-003 Ambiguous provider outcome replay | MEDIUM | Accepted | Every effectful call now persists a stable TravelOS operation ID/business key and request hash before first dispatch. Provider-enforced idempotency or read-after-write reconciliation is mandatory. `UNKNOWN_OUTCOME` reconciles before retry; unsupported effects remain manual/disabled. Job reaping sends unsafe outcomes to quarantine. `ARCHITECTURE.md`, `SECURITY_MODEL.md`, ADR-006 and ADR-009 agree. | Provider conformance/chaos tests crash after external success and before local completion; replay must return/reconcile the same consequence. No automated provider is enabled for an effect until this passes. |
| TOS-AR-004 Erasure not durable across backups | HIGH | Accepted | New ADR-014 makes protected erasable payloads per-object ciphertext before routine DB/object backup. Usable key material is outside those backups. Erasure is an idempotent state machine: persist intent, append the external signed deny tombstone, fail reads closed, destroy/revoke the object key, then prove decryption failure. It is not falsely described as a distributed transaction; after tombstoning it can only resume toward completion. Restore fails closed without a sufficiently new ledger checkpoint and replays tombstones before key recovery/network opening. Publishing, data, deployment, security, domain and constitution docs were aligned. | M1 uses synthetic fake-provider contract tests only. Before any real customer data/production: qualify key/ledger providers and restore the oldest retained backup; every tombstoned handle must fail decryption before service opens. This proof is a production BLOCKER, not fabricated Phase 0 evidence. |
| TOS-AR-005 Root constitution missing | LOW | Accepted | Root `AGENTS.md` is created from the corrected reviewed constitution before Phase 1. The review copy remains for traceability. | Corrected freeze must include identical constitutional rules and root file hash. |

## Additional critical consistency corrections found by the architecture owner

These were not reviewer findings but affect migration/fleet integrity and therefore were corrected before closure review.

| ID | Risk | Correction | Evidence/gate |
|---|---|---|---|
| TOS-INT-001 | Graphile Worker startup invokes its internal migrator, while the candidate prohibited startup migrations; OSS stale-lock recovery uses a fixed four-hour threshold rather than the documented per-task lease/heartbeat semantics. | Graphile Worker was removed from the selected stack. ADR-009 now selects a deliberately small TravelOS-owned PostgreSQL job executor with schema in the single migration chain, database-time claims, per-task lease/deadline, renewable heartbeat and CAS ownership. Official source references are recorded in `ARCHITECTURE.md`. | M1 PostgreSQL integration/property/chaos tests cover concurrent claim, lease loss, stale completion, heartbeat, crash and quarantine. Queue scope must remain small; scope growth triggers a queue/broker ADR. |
| TOS-INT-002 | Better Auth could create a second unmanaged schema-migration path. | Better Auth may generate candidate SQL for each isolated realm into temporary review output; engineers inspect/adapt it into the ordinary TravelOS migration chain. Direct `auth migrate`, programmatic migration and runtime schema synchronization are forbidden. CI checks declared Staff/Portal auth schema conformance. | M1 empty/prior migration matrix and auth schema drift test. Any dependency upgrade that changes generated schema requires a reviewed TravelOS migration and compatibility record. |

## Cross-cutting decisions introduced

1. **ADR-014** is required because TOS-AR-004 changes the persistence/security/deployment model rather than merely adding a restore checklist.
2. **Graphile Worker is no longer approved.** PostgreSQL remains the only asynchronous persistence dependency, but TravelOS owns the minimal job schema/state machine.
3. **Protected Portal download capabilities are removed from V1.** Public, non-personal assets may still use ordinary static delivery; that does not apply to traveller documents.
4. **Host is a surface routing input, never a tenant identity.** One deployment still contains one root Agency.
5. **Phase 0 documentary closure does not waive runtime gates.** Architecture tests belong to M1; real-data crypto-erasure/restore evidence belongs before production.

## Closure request

The independent closure reviewer must verify the corrected freeze, then for each `TOS-AR-*` finding return exactly one of:

- **CLOSED** — the corrected architecture resolves the defect and later evidence is placed at the right gate;
- **OPEN** — a concrete contradiction or missing decision remains;
- **DOWNGRADED/DEFERRED** — only if the residual is legitimately an implementation or pre-production verification gate, with no unresolved architecture semantics.

Any open BLOCKER or valid HIGH keeps Phase 0 at NO-GO. The architecture owner does not self-certify closure.
