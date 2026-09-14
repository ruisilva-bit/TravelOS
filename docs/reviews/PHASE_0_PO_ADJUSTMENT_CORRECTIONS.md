# TravelOS Phase 0 Post-PO Adjustment Correction Matrix

- **Product Owner decision:** `docs/reviews/PHASE_0_PRODUCT_OWNER_DECISIONS.md`
- **First-pass review:** `docs/reviews/PHASE_0_ARCHITECTURE_REVIEW.md`
- **Pre-PO correction matrix:** `docs/reviews/PHASE_0_REVIEW_CORRECTIONS.md`
- **Pre-PO closure:** `docs/reviews/PHASE_0_PRE_PO_CLOSURE_REVIEW.md`
- **Status:** Closed by `PHASE_0_POST_PO_CLOSURE_REVIEW.md`; retained as the post-PO correction record

The pre-PO closure remains valid evidence about freeze `d30c414d057bc33bc72cde30a91454ef1f651ca0a10a7e9cfa19b4d18a2fcc8a`, not about this later candidate. Rui's decisions deliberately changed the privacy architecture and rounding/storage constraints after that freeze. This matrix records the new candidate without rewriting the historical review.

## Product Owner adjustments

| Adjustment | Accepted decision | Documents aligned | Later evidence/gate |
|---|---|---|---|
| PO-001 Rounding | `HALF_UP` is only the V1 ordinary commercial-pricing default. Tax/fiscal, FX, payment/allocation, supplier and accounting contexts select explicit versioned policies and fail when a required policy is unknown. | `PRODUCT_BLUEPRINT.md`, `DOMAIN_MODEL.md`, `DATA_MODEL.md`, ADR-010, `AGENTS_CANDIDATE.md` | Finance-slice policy tests: every specialist operation names/records policy ID, version and boundary; no implicit fallback; exact conservation where allocation applies. |
| PO-002 Storage | `PrivateFilesystemProvider` may be the first M1 adapter. Domain/application code uses only `StorageProvider` capabilities and opaque IDs; paths, filesystem APIs and SDK types stay in the adapter. S3/MinIO can replace it without changing Document, grants or publishing. | `PRODUCT_BLUEPRINT.md`, `DOMAIN_MODEL.md`, `DATA_MODEL.md`, `SECURITY_MODEL.md`, ADR-011, `AGENTS_CANDIDATE.md` | M1 architecture/import tests and provider contract tests. Before production documents: private/non-static root, encryption at rest, authorization, quarantine/scanning, coherent encrypted backup/restore and recovery drill. |
| PO-003 Privacy deletion/backups | Granular crypto-erasure, a key provider and an independent erasure ledger are not V1 baseline requirements without concrete legal/threat justification. V1 promises active deletion/redaction, encrypted access-separated backups, bounded verified retention and isolated restore reconciliation. It explicitly does not promise immediate deletion from retained backups. | `PRODUCT_BLUEPRINT.md`, `DOMAIN_MODEL.md`, `DATA_MODEL.md`, `PUBLISHING_MODEL.md`, `SECURITY_MODEL.md`, `DEPLOYMENT_MODEL.md`, ADR-004, ADR-011, rewritten ADR-014, `AGENTS_CANDIDATE.md` | Before protected production data: legal/privacy + threat-model owners approve per-class retention/residual windows; encrypted oldest-point restore proves reconciliation before network opening and records expiry. Rejection triggers a superseding stronger-control ADR and blocks only the affected production class. |
| PO-004 Recovery target clarification | RPO ≤1h and RTO ≤4h are V1 engineering targets, not contractual guarantees. | `PRODUCT_BLUEPRINT.md`, `DEPLOYMENT_MODEL.md`, PO record | Isolated restore rehearsal must measure and either validate or revise them before production. |

## Original findings after Product Owner adjustments

| Finding | Post-PO status before closure | Rationale |
|---|---|---|
| TOS-AR-001 Host boundary | Correction retained | Exact manifest host allowlist, edge overwrite and independent API validation are unchanged. |
| TOS-AR-002 Document revocation | Correction retained | Protected direct/bearer URLs remain forbidden; every request reauthorizes. |
| TOS-AR-003 Ambiguous provider outcomes | Correction retained | Stable operation key, provider idempotency/reconciliation and `UNKNOWN_OUTCOME` quarantine are unchanged. |
| TOS-AR-004 Backup/privacy semantics | **Reopened for focused closure** | The first reviewer explicitly allowed either durable crypto-erasure **or narrowing the meaning of erasure before production**. The post-PO candidate uses the second path: it consistently says active deletion does not imply old-backup unrecoverability, sets bounded encrypted retention/expiry, and gates production on legal/threat acceptance plus isolated restore reconciliation. A new reviewer must confirm this resolves the semantic defect without disguising the residual risk. |
| TOS-AR-005 Root constitution | Correction retained; rehash required | Root `AGENTS.md` must be recopied from the final candidate and included in the new freeze. |
| TOS-INT-001 Job runtime | Correction retained | Graphile remains rejected; TravelOS owns the minimal PostgreSQL job schema/lease protocol in the one migration chain. |
| TOS-INT-002 Better Auth migrations | Correction retained | Generated SQL remains review input only; TravelOS owns both realm schemas in the one migration chain and runtime migration remains forbidden. |

## Active deletion semantics

### Publications

- Immutable publication metadata and the retained payload are separate one-to-one records.
- Routine roles cannot update/delete either.
- A narrowly privileged idempotent command verifies authorization/legal hold, clears an active pointer, deletes only the payload and appends `PRIVACY_PAYLOAD_DELETED` plus safe Audit evidence in one transaction.
- Active Portal/Staff/search/export paths return a typed deleted-payload state.
- Pre-deletion encrypted backups may retain a copy until approved expiry.

### Documents

- Revoke grants and mark `DELETING` before provider deletion so reads fail closed.
- Call `StorageProvider.delete(opaqueObjectId)` idempotently and confirm absence with the provider contract.
- Mark `DELETED` only after confirmation; crashes resume the state machine and never restore authority.
- Pre-deletion encrypted backups follow ADR-014 retention and restore reconciliation.

### Restore

- Restore target begins with public ingress disabled.
- Determine the recovery cutoff and establish explicit coverage of the interval to the recovery decision from approved deletion-request, Audit and operational evidence; absence in the restored database proves nothing about later deletions.
- Reconcile deletion/redaction before public-facing processes start.
- If interval coverage is incomplete, keep affected payload classes unavailable (or bulk-delete/redact them) and abort public opening until a later safe point or verified remediation; privacy approval cannot waive potential active resurrection.
- Record retained historical copies and expiry; never claim they are already erased.

## Closure result

The independent reviewer verified all 37 final-freeze hashes, found no missing/mismatch, closed TOS-AR-004 under the narrowed active-deletion promise, retained legal/threat review as a pre-production gate, found no new BLOCKER/HIGH and recommended `CLOSURE CONFIRMED WITH MEDIUM/LOW IMPLEMENTATION GATES`. See `PHASE_0_POST_PO_CLOSURE_REVIEW.md`. The architecture owner did not self-certify closure.
