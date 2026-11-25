# Stage 10 — recovered package qualification, run 32

**NOT_READY / NO_GO. Implementation card `t_9fbc40f6` remains incomplete; no QA dependency is released.** This is an author execution checkpoint, not independent acceptance, canonical CI, a candidate freeze or deployment permission.

## Recovery and root cause

Recovered the existing branch `phase-1/stage-10` without deleting untracked work. No old qualification Node process remained at inspection. The run31 fixture log has now finished: `t_9fbc40f6-run31-package-fixtures-green.log` records 24 passed, zero failed/cancelled/skipped, `PRIMARY_EXIT=0`. Earlier reports of only 19 completed cases described an earlier observation, not the final bytes.

The real run31 package attempt remains FAIL, preserved under `.hermes/state/run31-mutable-package-LLxtzD`. Its diagnosis identifies the rehearsal metadata label `gen00`, rejected by the existing generation grammar. The retained corrected rehearsal uses `gen01` solely as an UNQUALIFIED package label, not a ledger generation. No contract was weakened, original receipt rewritten, occupied claim retried or candidate renamed to bypass one-shot rules.

Run32 executed that already-corrected script in a new private directory. The directory prefix still says run31 because it is part of the retained script; the execution belongs to run32. No production-code change was necessary to resolve this diagnostic failure.

## Fresh executed results

Pinned Node executable for commands below: `/home/hermes/.local/share/travelos-stage5-toolchain/node_modules/node/bin/node`.

| Command / retained evidence | Observed result |
|---|---|
| `readToolchain(process.cwd())` from `candidate.mjs` | Node 24.19.0 / Corepack 0.35.0 / pnpm 11.21.0 |
| `node .hermes/state/t_9fbc40f6-run31-mutable-package-corrected.mjs` | exit 0, final PASS, `PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED` |
| `node --test tooling/ci/stage-10/test-postgres-cleanup-exit.mjs tooling/ci/stage-10/test-postgres-receipt-preservation.mjs` | 7/7 PASS, zero skips/cancellations, exit 0; synthetic lifecycle/CLI fixtures, no PostgreSQL started |
| `verifyBaseline(process.cwd())` from `candidate.mjs` | 2662 protected predecessor files verified; exit 0 |
| `python3 .hermes/state/t_9fbc40f6-run32-verify.py` | archive digest, seven command receipts and 14 stdout/stderr sizes/digests verified; all 2874 captured source bytes/modes matched before this report/checklist update |
| `git diff --exit-code` and `git diff --cached --exit-code` | both exit 0; Stage 10 remains untracked/unsealed |
| Fixed pinned-host SSH metadata probe, existing identity, non-root Python only | exit 0, UID1000; detailed observations below |

The seven recipe commands were offline frozen install, production build, four runtime deployments to the **local package** (Admin API, Portal API, Worker, migrator), and offline workspace dependency restoration. “Deploy” in those command labels means `pnpm deploy` packaging, not CT200 deployment.

### Exact mutable artifact

- Directory: `.hermes/state/run31-mutable-package-U5ev4M`
- Archive: `artifact.tar.gz`, 185865096 bytes
- SHA-256: `5bc3f19488473c6f6e9beb0e0e2c80973b768e5d26acaa2a4519ecf04d8e7ab9`
- Input digest: `edff3b03e2adc89c3f44293be40481d5727ba7d92724d4a73104de9ddc682a32`
- Artifact metadata ID: `travelos-stage10-gen01-edff3b03`
- Source files: 2874; migration head declared in package: `0016_stage9_staff_invitations`
- Scope: `MUTABLE_PACKAGE_ONLY_NOT_CANONICAL_OR_CT200_ACCEPTANCE`

Package qualification includes archive/source/migration/dependency correspondence, bundled Node, declared entry checks, packaged verifier and credential-free startup-failure checks. It does not establish all executable runtime branches, authenticated browser behavior, PostgreSQL correctness, signing trust, privacy approval or installed systemd behavior. Same-control hashes prove consistency, not independent origin.

This report, its companion manifest and the subsequent checklist correction are **not in that archive**. Do not re-label it as a final source snapshot or use it to claim readiness after later changes. The verification helper deliberately refuses overwriting its saved readback and is not a resumable candidate mechanism.

## Recovered implementation from run31

Comparison against `.hermes/state/t_9fbc40f6-run31-start.json` found changes to exactly these previously snapshotted source files, with no missing path in that snapshot:

- `tooling/database/run-stage-10-postgres-disposable.mjs`: cleanup-root removal failure becomes a primary failure, agreeing with the FAIL receipt and nonzero CLI exit.
- `tooling/ci/stage-10/test-production-package.mjs`: synthetic packaged-verifier fixture includes its newly required dependency.

The already-present `test-postgres-cleanup-exit.mjs` exercises successful cleanup and failed removal/stop through the real CLI with mocked external boundaries; run32 reran it with receipt-preservation tests. Run31's retained broader 62/62 regression and 24/24 packaging fixtures are **recovered historical results**, not reruns in run32 and not additive independent coverage. No application source or accepted Stage 1–9 byte was edited.

Run32 repository changes: this report, its companion `CODING_PACKAGE_RECOVERY_RUN32.json`, and the stale PostgreSQL-routing paragraph in `M1_STAGE_10_CT200_EXECUTION_CHECKLIST.md`. Local state adds logs/readback/verification helper and updates the resume checkpoint. No readiness status was promoted.

## Concrete CT200 boundary and remaining technical work

Fresh read-only metadata via the existing pinned SSH identity found:

- current pointer still `/opt/travelos/releases/travelos-stage9-gen11-d6610462`;
- current bundled Node and native PG18 `initdb`/`pg_ctl` exist and are executable by UID1000;
- `/usr/local/sbin/travelos-stage10-operator` absent;
- Stage10 Vitest configuration absent from the current release's provenance source path;
- Chromium not on the probe's PATH. This is not a claim that every possible browser cache/install is absent.

No service, PostgreSQL process, synthetic database, remote scratch directory, credential or host configuration was created/changed by this probe. It is not a fresh authenticated health or full privilege inspection.

`run-stage-10-postgres-disposable.mjs` is still a local runner: it resolves repository/dev dependencies locally, prepares PG packages, starts a local synthetic cluster and launches local Vitest/Chromium. Neither it nor a successful mapping test transports the test harness to CT200. Running it on hermesagent would not satisfy the CT200-only acceptance decision.

**Next required operational coordination with Alex:** establish the CT200 execution location/principal and bounded synthetic cluster/cleanup scope, transport the verified extracted artifact plus a separately inventoried test harness/dev dependencies (without compiling on CT200), identify/provide a compatible browser through the approved operational path, and verify runtime paths/pins before executing the 95-case lane. Existing native tools may avoid new installation; this checkpoint does not assert that root is necessary for all preparation. Any protected provisioning, privilege changes or service actions remain outside this coding task. The transport/orchestration integration is still technical work, not merely a missing signature of approval; it must be implemented/reviewed and exercised, not marked done from this report.

### Open blockers

- **S10-READY-PG:** current-artifact 95-case CT200 PostgreSQL/browser execution, transport/harness integration, cleanup and independent mapping review missing.
- **S10-READY-REGRESSION:** package-only diagnostic is resolved, but complete final inherited/runtime regression remains unqualified; all declarations retain their brakes.
- **S10-READY-OPS:** protected operator absent at observed path; actual privilege/cutover/systemd/migration/activation qualification missing.
- **S10-READY-SIGN:** protected signing, verification trust, revocation and recovery acceptance still open.
- **S10-READY-RECOVERY:** complete business/ACL/head sampling, coordinated recovery and ADR-014 interval reconciliation still open.
- **S10-RET-002 / S10-RET-004 / S10-RET-005:** independent receipt provenance, exact-byte privacy decision and protected producer/writer boundary still open. No invented authority appointments or scanner-based acceptance.
- **S10-READY-CANONICAL:** prerequisites unmet; no consuming candidate/build/CI call, canonical evidence or final freeze.

## Independent review criteria

1. Verify the companion hashes against current files and command-receipt stdout/stderr; distinguish original FAIL, recovered fixture PASS and new package-only PASS.
2. Confirm `gen01` is unqualified rehearsal metadata and no one-shot/build/canonical ledger was consumed or rewritten.
3. Review cleanup exit semantics and preserve failed/unknown receipts; reproduce the seven focused fixtures without starting PostgreSQL.
4. Confirm the 95-case mappings and CT200 harness substitution preserve all accepted assertions, use extracted runtime bytes and prove cleanup under failure. Local mock dispatch is insufficient.
5. Reconcile operator/principal/browser provisioning with Alex before real execution. Require actual non-root/privileged boundary evidence where applicable, not path presence alone.
6. Keep this package/report separate from final candidate provenance and privacy acceptance. Independently adjudicate all open findings before any GO.

No production, Stage11, credential provisioning, privileged host modification, service restart, migration, activation, Git commit/tag/seal, push or merge occurred in run32. No task completion is requested merely to release dependent QA.
