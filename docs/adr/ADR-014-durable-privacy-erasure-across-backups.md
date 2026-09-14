# ADR-014: Privacy Deletion, Retention and Backup Residual Risk

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

TravelOS may hold passports, medical/accessibility data, customer documents and published trip data. Deleting or redacting the active record does not immediately remove copies already captured in immutable encrypted backups. Per-object crypto-erasure with an external key provider and independent erasure ledger could narrow that window, but it adds a critical runtime/recovery dependency whose legal or threat-model need has not yet been demonstrated for V1.

The architecture must neither ignore deletion obligations nor claim old-backup unrecoverability it does not provide.

## Decision

Granular crypto-erasure, a dedicated `ErasureKeyProvider` and an independent erasure ledger are **not V1 baseline dependencies or production GO requirements**.

V1 uses this explicit policy:

1. collect/minimize protected data by classification and declared purpose;
2. encrypt database, private storage and off-instance backups at rest, with recovery keys/secrets managed separately from backup data and access-controlled;
3. apply an approved retention schedule with automatic, verifiable backup expiry; retained immutable archives are not selectively rewritten;
4. implement idempotent, authorized and audited deletion/redaction workflows in the active system, respecting legal holds and retaining only lawful non-sensitive evidence;
5. after active deletion, all normal Admin/Portal/API/search/export paths return no deleted payload;
6. acknowledge that a retained backup created before deletion may still contain recoverable protected data until that backup expires;
7. restore only into an isolated, network-closed environment; recover to the latest safe point and establish explicit coverage for the interval from the backup cutoff to the recovery decision using approved deletion-request, Audit and operational evidence—absence of a row in the restored database is never proof that no later deletion occurred;
8. apply every identified post-backup deletion/redaction before opening, run privacy/authorization checks and require explicit operator approval. If interval coverage cannot be established, the affected protected payload classes remain unavailable (or are bulk-deleted/redacted) and the public service remains closed until a later safe recovery point or verified remediation exists. A privacy owner may accept the bounded encrypted-backup retention risk; they may not waive a known or potentially resurrected active payload back into service.

Before first production use with real customer data, a Portugal/EU legal/privacy review and a concrete threat-model review must define, per data class:

- purpose/legal basis and minimum collection;
- active-system deletion/redaction semantics;
- legal hold and commercial retention constraints;
- maximum backup retention and residual deletion window;
- restore reconciliation evidence and how recovery-interval completeness is established without inferring it from the restored database;
- whether the residual backup window is acceptable.

If that review, a customer contract or a concrete threat scenario requires deleted bytes to become unrecoverable before backup expiry, production for the affected data class is blocked until a superseding ADR selects and qualifies per-object crypto-erasure, provider-native deletion guarantees or an equivalent independently verified control.

## Consequences

- V1 avoids an unproven key/ledger runtime and recovery dependency.
- “Deleted” means absent from the active service; it does **not** mean immediately unrecoverable from every retained encrypted backup.
- Backup encryption, access separation, short justified retention, expiry verification and quarantined restore become essential controls.
- Recovery procedures must explicitly establish interval coverage and reconcile privacy deletions before network opening; unknown coverage fails closed for affected payloads.
- Legal/threat analysis, not architectural enthusiasm, determines whether granular crypto-erasure is later mandatory.

## Rejected for V1 baseline

- Claiming that active-row deletion removes data from historical backups.
- Unencrypted backups or backup keys stored alongside backup data.
- Indefinite backup retention “just in case.”
- Making per-object crypto-erasure/key/ledger infrastructure mandatory without a concrete legal or threat-model requirement.
- Selectively rewriting every immutable backup archive as the default deletion mechanism.

## Revisit trigger

Any of the following requires a superseding ADR before the affected production use:

- legal/privacy advice rejects the documented residual backup window;
- a customer contract requires faster backup-side deletion;
- the threat model includes direct backup compromise where encryption/access controls are insufficient;
- provider-native object deletion/key destruction offers a simpler verifiable guarantee;
- restore drills cannot reliably reconcile active deletions after recovery.
