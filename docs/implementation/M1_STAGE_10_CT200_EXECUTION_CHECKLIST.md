# M1 Stage 10 — CT200 execution and qualification checklist

**Current status: NOT READY / Stage 10 remains open.** This mutable checklist supersedes its earlier implementation-status descriptions, not historical approvals or receipts. The coding handoff for task `t_9fbc40f6` is `docs/reviews/phase-1-m1/stage-10/CODING_QUALIFICATION_HANDOFF.md`. Independent QA is a separate downstream gate.

## Authority and boundaries

- Approved scope: Stage 10 master `/home/hermes/.hermes/attachments/Pasted content (5.9 KB)` and latest CT200-only decision `/home/hermes/.hermes/attachments/Pasted content (4-6.1 KB)`, interpreted by `M1_STAGE_10_OPERATIONAL_AUTHORITY_ADJUDICATION.md`.
- CT200 (`travelos-dev`, `192.168.1.33`) is the existing DEVELOPMENT runtime target. No new CT, VM, Docker/Podman/QEMU environment, production or Stage 11 work. Local unit fixtures do not qualify CT200 runtime.
- This coding task explicitly excludes privileged host changes, new credentials, critical restarts, deployment, Git commit/seal, push and merge. Infrastructure execution goes back to Alex; historical broader authorization is not an override for this delegated run.
- Preserve existing access, accepted Stage 1–9 bytes, untracked Stage 10 work, rejected/interrupted receipts and every consumed/unknown one-shot state.
- Pins remain Node `24.19.0`, Corepack `0.35.0`, pnpm `11.21.0`. Expected schema head is `0016_stage9_staff_invitations`; that declaration does not establish the current live head.

## 1. Non-consuming implementation verification

- [ ] Verify accepted predecessor from its exact tag/commit/archive, never by rerunning its historical CI against successor bytes. Constants: commit `f65a64d9c3aabd446ca95a605faed92630a72963`, tag `travelos-phase-1-m1-stage-9-gen11-go`, artifact `travelos-stage9-gen11-d6610462`, archive SHA-256 `8b74c305c12eecb9339acdd777449fbdb0b3bf25c498d87a2c7d43931bb6d125`.
- [ ] Complete and independently review all inherited assertion mappings. `M1_STAGE_10_INHERITED_GATE_COVERAGE.md` retains the old diagnostics and current correction notes. Dispatch availability, fixture success and gate qualification are different states.
- [ ] Run scoped regressions plus format/lint/typecheck/architecture/unit/migration/security checks on final mutable bytes; preserve primary exit status and logs. Do not infer an aggregate PASS from selected tests or skipped lanes.
- [ ] Qualify the current extracted package, dependency/import closure, packaged verifier/migrator, actual service paths and failure cases. The production recipe and package checker exist; older mutable artifacts do not qualify later source changes.
- [ ] Complete and execute the inherited PostgreSQL/browser coverage through an approved CT200 path with current artifact/input binding and cleanup evidence. The four inherited PostgreSQL labels now route through the common candidate gate and require the complete 95-case named-result mapping (see `CODING_POSTGRES_MAPPING_RUN13.md`). Synthetic dispatch/reuse tests do not qualify these labels. The current full runner starts PostgreSQL on its executing host; it does not transport to CT200. Do not execute it on the build host as CT200 acceptance. Prepare and review the CT200 harness/runtime/cleanup route with Alex before actual execution.

The current code contains a canonical execution loop, clean-install, source-screen, package/deployment and candidate/inherited adapters. Earlier claims that no execution loop or backup implementation exists are stale. All 60 declarations nevertheless remain unqualified/pending, and `PENDING_INTEGRATIONS` deliberately retains its readiness brakes. No status may be promoted merely because code or tests exist. Root `package.json` remains unchanged; proposed Stage 10 aliases must not be advertised as installed commands.

## 2. Recovery and least privilege — Alex-owned execution

- [ ] Establish a fresh independent administrative recovery route, protected pre-change policy snapshot, recoverable backup and rollback evidence before changing privileges. Proxmox console availability is not an executed drill.
- [ ] Review effective sudo/legacy bypasses, groups, writable privileged dependencies and installed units. The last recorded read-only checkpoint found broad passwordless `ALL` and missing protected Stage 10 activation paths. Revalidate rather than assuming this remains current.
- [ ] Provision only reviewed fixed operator capabilities; do not grant generic shell/interpreter/systemctl/database-tool sudo to fill gaps. Test allowed and denied operations as real principals while keeping recovery usable.
- [ ] Review and durably install the versioned operator/service paths only under the operational authority. Never hand-edit the server or execute artifact-owned code as root merely to verify a package.

## 3. Signing, recovery and backup

- [ ] Qualify dedicated DEVELOPMENT signing custody, independently pinned verification trust, revocation/rotation/recovery and actual pre-activation enforcement. The accepted DEVELOPMENT exception is policy GO, not implementation GO. Production keyless/OIDC policy remains unchanged.
- [ ] Reconcile `M1_STAGE_10_ACTUAL_SIGNING_KEY_CHECKPOINT.md`, `M1_STAGE_10_CURRENT_CT200_PREFLIGHT_CHECKPOINT.md` and `M1_STAGE_10_ACTUAL_RECOVERY_CHECKPOINT.md` against fresh evidence. Do not reprovision keys or repeat backup/recovery solely because this checklist changed.
- [ ] Complete actual restored ledger-head, business-data and ACL sampling, coordinated release/config/object/secret-reference recovery, and host-loss limits. Native encrypted CT200 backup and a partial real clone recovery already occurred; they are not full disaster-recovery acceptance.
- [ ] Establish ADR-014 post-backup deletion-interval coverage. Unknown coverage keeps protected payloads unavailable; absence from the restored database cannot establish coverage.
- [ ] Independently review retention/expiry execution and the final durable units. Off-instance ciphertext and separately managed recovery material must remain access-separated.

## 4. Candidate readiness and consuming operations — NOT authorized now

- [ ] Finish source/config/tests, current artifact rehearsal, all technical mappings and scoped independent reviews.
- [ ] Close concrete receipt provenance, exact-byte privacy and protected-writer findings `S10-RET-002`, `S10-RET-004`, `S10-RET-005` through an independently adjudicated mechanism. Proposed authority appointments are not mandatory product roles; hashes, root ownership, synthetic fixtures, scanner PASS or same-control AI are not independent acceptance.
- [ ] Implement/qualify operational preflight and candidate-bound signing/activation/retention routes. These three Stage 10 routes remain non-dispatchable.
- [ ] Verify all documented prerequisites and final toolchain/source/gate/migration bindings before any input capture, build or canonical claim. Preserve every failed or incomplete generation; never rename a candidate or delete state to retry.
- [ ] Build exactly once and execute canonical CI exactly once only when the real readiness predicate allows it. No consuming call was made by this coding task. Do not remove `assertPipelineReady` or edit statuses to bypass it.
- [ ] Perform actual controlled migration/activation/restart/health/authenticated browser/worker/rollback acceptance on CT200 through the reviewed fixed path and same verified artifact. Startup never migrates. Stage 10 declares no migration changes; measure live state rather than inventing a migration.
- [ ] Publish sanitized, authenticated, privacy-accepted decisive receipts through the qualified protected writer; independently recompute index, exact path set, sizes and hashes. Local quarantine is not canonical evidence.
- [ ] Scan final expanded scope, generate deterministic freeze twice, verify equality and obtain substantive independent exact-byte review/adjudication. Only supported final GO permits a separately authorized Git seal.

## Completion rule

Mark each gate only from its own current evidence. A technical correction is not independent finding closure; a local fixture is not CT200 acceptance; partial recovery is not an accepted RTO; a scanner is not privacy clearance; green selected tests are not canonical CI. This checklist itself performs no host operation, candidate claim, deployment, freeze or Stage 10 closure.
