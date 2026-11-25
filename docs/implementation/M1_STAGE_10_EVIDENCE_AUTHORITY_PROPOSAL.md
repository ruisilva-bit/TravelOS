# Stage 10 — proposed canonical evidence authority boundary

**Design only — not implemented, approved, provisioned or qualified.** Read-only investigation `sa-0-bebf4020`, `deleg_f8de897c`. S10-RET-002/004/005 remain open. The existing retention implementation is quarantine only; its scanner output is not privacy acceptance.

## Separation required

- The existing producer submits untrusted bytes and must be unable to modify the trusted policy, publisher, protected staging or canonical objects.
- A distinct fixed, least-privileged publisher identity snapshots, verifies and publishes; it has no signing or database credentials and no general command interface.
- A separately controlled administrative custodian provisions publisher and policy, with independently retained authorization and provenance.
- A receipt authority authenticates the origin and candidate/source/artifact/receipt bindings. A separate privacy reviewer approves the exact protected payload manifest and publication metadata. These are proposed roles: identities, custody and actual independence have not been established.

A native fixed systemd oneshot is a potential fit, with fixed isolated interpreter/dependencies, no network, bounded resources, no ambient capabilities, strict filesystem protections and explicit writable paths. It is not a new application control plane. Root or a compromised publisher remains outside this boundary; local DAC is not WORM or off-host durability. CT200's recorded broad sudo defeats producer separation until the independently reviewed privilege cutover and recovery path are proven.

## Authority and publication contract

1. Obtain authenticated independent receipt authority and independently reviewed privacy decision. A custodian-protected per-object pin can avoid new keys only if its acquisition and provisioning are independently authenticated and recorded; root ownership alone does not prove provenance. Do not silently reuse the DEVELOPMENT artifact signer as a receipt/privacy authority.
2. Bind authorization to environment, instance, candidate, source-input digest, artifact digest, exact receipt digest, authority identity, version, replay identity and validity. Bind privacy decision separately to the same identifiers and exact protected payload manifest, reviewer, classification, retention and access policy. Reject unknown/missing/duplicate fields, role confusion, expiry, revocation and mismatches.
3. Snapshot bounded untrusted ingress into fresh publisher-only files via anchored no-follow traversal; reject unsafe inode types, hardlinks, duplicate paths and exhaustion. Construct a deterministic sorted unique manifest, with exact sizes/hashes. Preserve any quarantine index as quarantine metadata; do not relabel scanner output.
4. Review precisely those protected bytes, including publication metadata. Redaction creates new bytes requiring a new decision. Verify independently provisioned pins before committing; caller-supplied approval flags, trust roots or clocks are not authorities.
5. Publish a complete object containing payload manifest, receipt authorization, privacy decision and a separate non-self-referential acceptance record. Sync files and directories, `renameat2(RENAME_NOREPLACE)` on the same filesystem, sync destination parent, then read back and verify exact inventory and authorizations. Failure after rename is ambiguous and must be inspected, not automatically rolled back or called success.
6. The Stage 10 final evidence index/freeze must consume an independently pinned acceptance-record digest and independently reverify the canonical object; an editable producer-owned repository copy is not the authority. Validate replay, concurrent publisher, producer-held writable descriptors, intermediate swaps, tampering, stale approvals, crash/ENOSPC and real-principal bypasses.

## Proposed implementation shape and gates

Potential source paths: `tooling/deployment/stage10-evidence-publisher.py`, corresponding namespace/adversarial tests, a tightly restricted `deploy/systemd/travelos-stage10-evidence-publisher.service`, a versioned evidence contract and Stage 10 CI readback verifier. Names are a proposal, not existing artifacts or proof of an approved architecture.

First implement/test using disposable synthetic authorities; independently review exact code. Separately establish real authorized identity, key/pin custody, privacy reviewer, host privilege cutover, controlled recovery and durability/backup before publishing actual evidence. No host privilege, credential creation, signer, production or Stage 11 action is authorized by this document.

## Independent review refinements

Reviewer `sa-0-3dc5de83` / `deleg_2b793e43` gave conditional GO to synthetic-only mechanism implementation, not actual publication or acceptance. The fixed oneshot must remain a bounded operational command, not a listener, queue, general API or management plane. RET-002/004/005 remain open.

- Before real acceptance, specify the precise authorization envelope, protected policy and clock/revocation sources, rotation/revocation procedure, and independently retained provenance for every provisioned trust pin. Fixture pins or signatures prove mechanism behavior only.
- The privacy review covers every retained or exposed byte and metadata field, including receipts, manifests and acceptance metadata. Any redaction or metadata change requires a new digest and decision.
- Define durable atomic replay semantics across concurrent invocations and restarts. An exact retry must either reject or return an independently reverified existing object; an authorization identity reused for any different binding must reject. No separate mutable ledger may silently diverge from publication.
- Fail closed on unavailable or invalid policy, clock or revocation state; unsupported filesystem semantics; exhausted storage; partial writes; and failed readback. A failure after rename remains explicitly undetermined pending controlled inspection and is never inferred as successful acceptance.
- Qualify actual real-principal separation from publisher code, dependencies, trust policy, process and destination after a reviewed privilege/custody cutover. Independent review must confirm the provisioning evidence rather than infer it from UID/mode or synthetic namespaces.
- Establish encrypted off-instance retention, independent retention of the acceptance pin and object identity, and verified restore/reconciliation under the deployment model. Local fsync, rename and readback do not prove WORM or survival of host loss; do not introduce an unapproved mandatory new service to assert those properties.
