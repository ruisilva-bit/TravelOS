# Stage 10 — Independent DEVELOPMENT signing policy review

**Scope:** exact proposed policy only; not implementation acceptance or Stage 10 GO.
**Reviewer:** independent non-author `sa-0-a487509b`, delegation `deleg_6d65e3aa`.
**Candidate:** `docs/implementation/M1_STAGE_10_DEVELOPMENT_SIGNING_DECISION.md`.
**Verified SHA-256:** `00375bfc355a8b6d1ee9c0e9370cd466242074693a0809958abb7da3381975a5`.
**Recommendation:** GO — policy design only. The reviewer did not accept the exception; author adjudication remains separate.

## Independent findings

- `S10-POL-001` INFO: historical keyless/no-long-lived-private-key conflict is identified and scoped to CT200 DEVELOPMENT; production GitHub OIDC remains unchanged. Candidate lines 7–9, 20–22; predecessor `docs/implementation/M1_BOOTSTRAP_DECISIONS_CORRECTED.md:51–64`.
- `S10-POL-002` INFO: exact artifact bytes, independently pinned development key, profile isolation, fail-closed verification and no GitHub OIDC provenance claim are specified. Candidate lines 13–18.
- `S10-POL-003` INFO: key custody, protection, access, recovery and no secret disclosure are requirements requiring proof, not proven capabilities. Candidate lines 15–16.
- `S10-POL-004` INFO: revocation, key recovery and safe rollback are policy requirements; operational adequacy remains unverified. Candidate lines 15, 26–28.
- `S10-POL-005` INFO: checked deployment architecture and accepted ADR index; no accepted ADR was found that prohibits the narrowly scoped exception; the predecessor signing decision is explicitly preserved and the conflict identified. Candidate lines 7–9; `docs/DEPLOYMENT_MODEL.md:18–20,47–70,89–97,122–155`.

No policy-text correction was required for the scoped recommendation. Before implementation acceptance, independent verification must cover real protected custody and credential handling, independent pinned-key distribution, exact-byte Cosign verification, absent signature/wrong key/wrong profile/tampered artifact negatives, the real fail-closed activation path, revocation/recovery, receipts and exact extracted-artifact execution. The review does not assert that any of these exist or pass.
