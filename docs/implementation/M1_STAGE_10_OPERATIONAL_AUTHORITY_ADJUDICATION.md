# Stage 10 operational authority clarification and adjudication

## Authority and scope

This is an explicit Stage 10 DEVELOPMENT clarification, not implementation acceptance, credential provisioning, deployment approval or Stage 10 GO. It preserves all accepted Stage 1–9 bytes and production signing requirements.

Independent read-only governance/security reviewer `sa-0-78d0a95e`, delegation `deleg_a38ce49d`, traced the master execution brief, the accepted DEVELOPMENT signing-policy review/adjudication and the open evidence-retention findings. Alex checked the cited accepted sources directly before this adjudication.

The Product Owner's latest CT200-only execution decision supersedes the old additional-CT/VM qualification proposal. Rui also confirms an independent root console is available through Proxmox. That is availability confirmation, not an executed rollback/recovery drill; existing access must remain until staged recovery and privilege tests pass.

## Required controls versus proposed implementation roles

The accepted Stage 10 master requires sanitized, integrity-verified, reproducible or durably retained, indexed, independently reviewable decisive deployment receipts. It does not appoint a separate human privacy authority or external receipt-authority service. The named appointments and their envelope scheme in `M1_STAGE_10_EVIDENCE_AUTHORITY_PROPOSAL.md` and `M1_STAGE_10_SIGNING_CUSTODY_PREPARATION.md` remain unapproved design choices, not newly discovered mandatory product requirements.

This clarification does **not** waive the actual independent findings:

- `S10-RET-002`: a caller-supplied receipt digest proves consistency, not independently trusted origin/provenance bound to the candidate and artifact.
- `S10-RET-004`: scanner output is not an independently authenticated privacy decision bound to exact retained payload and metadata.
- `S10-RET-005`: a producer must not retain write authority over protected staging, policy or canonical evidence.

Keep these findings open until a concrete corrective mechanism and its evidence receive independent adjudication. A same-control AI is not an independent human or separately controlled authority. Do not turn a synthetic appointment, code constant, author-provided pin, root-owned file or scanner PASS into an approval. Conversely, do not block ordinary authorized implementation merely because a proposed appointment format has not been adopted. If a human decision is selected to close a real gate, obtain that exact decision against the final bytes rather than inventing it.

## Signing and recovery remain mandatory

The accepted DEVELOPMENT policy requires a protected dedicated Cosign key, exact-byte signing, independently pinned verification trust, no private values in Git/artifacts/evidence/logs/arguments, fail-closed verification before activation, negative tests, revocation/recovery, receipts and extracted-artifact execution. The policy GO did not prove these mechanisms. Production GitHub Actions/OIDC/keyless policy remains unchanged and unverified.

The narrow implementation may use approved existing encrypted credential infrastructure without adopting every proposed custody role. No new durable credential may be provisioned without its applicable authorization. The user-approved DEVELOPMENT signing key is distinct from any newly proposed database-backup recovery key. A same-host encrypted-blob restore can prove only that limited recovery mechanism, not survival of host/key loss or independently distributed trust.

Accepted `docs/DEPLOYMENT_MODEL.md:162–174` still requires encrypted off-instance, access-separated backup data with separately managed recovery keys/secrets, bounded retention and verified expiry/restore evidence. Older protected dump files and local ciphertext existence are not that proof. ADR-014 restore/deletion coverage remains fail-closed; no new erasure ledger is implied.

## Adjudication

Accept the governance review's distinction between mandatory controls and unaccepted role bureaucracy. Continue the already authorized CT200 technical work. Preserve existing access and all historical evidence. Obtain substantive independent review of implemented control boundaries; do not infer Stage 10 GO from this clarification or from green local packaging tests. No production, push, merge or Stage 11 action is authorized here.
