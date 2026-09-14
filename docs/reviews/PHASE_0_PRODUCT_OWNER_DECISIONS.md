# TravelOS Phase 0 Product Owner Decisions

- **Product Owner:** Rui
- **Decision date:** 2026-08-13
- **Status:** Accepted with the adjustments below
- **Scope:** Phase 0 V1 foundation and M1 boundary

Rui accepts the Phase 0 V1 package subject to these authoritative adjustments. The architecture and closure review must reflect them before ADRs become Accepted.

## Accepted baseline

- one root Agency per dedicated deployment;
- M1 is the Secure Published Trip Walking Skeleton;
- 99.5% is an engineering service objective, not a contractual HA promise;
- RPO ≤ 1 hour and RTO ≤ 4 hours are engineering targets, subject to backup/restore rehearsal before production;
- Portal customers see only the current active publication by default;
- Staff MFA is mandatory in production; Portal MFA is optional in V1;
- GitHub Actions is the initial CI target while the pipeline remains provider-neutral;
- capacity limits are planning assumptions to validate, not customer commitments;
- retention/GDPR rules require legal validation before production;
- the exact PostgreSQL major is selected and pinned during M1 bootstrap after compatibility validation.

## Adjustment PO-001 — Rounding

`HALF_UP` is the V1 **commercial default**, not a universal financial rule. Tax/fiscal, foreign-exchange, payment, supplier and accounting contexts may—and where required must—select explicit different rounding policies. Every material calculation records the applicable policy/version; no context silently inherits the commercial default when a legal, provider or accounting rule applies.

## Adjustment PO-002 — Storage provider

`PrivateFilesystemProvider` is accepted as the first `StorageProvider` and may be used in M1. The Document domain and application use only the provider port and opaque object identifiers; they must not import filesystem paths/APIs. S3/MinIO or another provider can be added later without changing domain, grant or publication semantics.

Before production document use, the selected provider must prove private/non-static storage, authorization, encryption at rest, malware/quarantine policy, coherent encrypted backup/restore and recovery testing.

## Adjustment PO-003 — Privacy deletion and backups

Granular crypto-erasure plus a dedicated key provider and independent erasure ledger is **not accepted as a mandatory production GO requirement at this stage**. That complexity first needs a concrete legal requirement or threat-model justification.

Production still requires:

- encryption at rest;
- secure key/secret management;
- explicit document grants and per-request authorization;
- deletion, retention and legal-hold workflows;
- encrypted, access-separated backups with bounded retention;
- auditability;
- tested isolated restore and privacy-deletion reconciliation.

The architecture must state honestly that active deletion does not immediately remove data from retained historical backups. A legal/privacy and threat-model review before production must accept the residual backup window per data class or trigger a superseding ADR for crypto-erasure or an equivalent control.

## Acceptance effect

With these adjustments implemented and independently closed, Rui accepts the remaining V1 Phase 0 package. This decision does not itself authorize Phase 1, alter CT 200 or waive the final technical consistency/closure gate.
