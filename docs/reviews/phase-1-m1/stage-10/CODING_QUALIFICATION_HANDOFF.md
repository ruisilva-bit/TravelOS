# Stage 10 — coding qualification handoff (task t_9fbc40f6)

**Author implementation report, NOT independent review. Stage 10 remains NOT READY / NO_GO for closure.** This handoff releases the separate QA dependency; it does not close Stage 10 or assert that every technical route is implemented. No build/canonical candidate consumption, deployment, host privilege change or Git seal was performed by this task.

## Authority and recovery of this run

Read the Stage 10 master and CT200-only Product Owner attachments, IDEA/Product Blueprint/Domain Model, deployment model, governing ADRs and AGENTS, operational adjudication and current checkpoints. The task's narrower no-host-change/no-new-credential/no-restart/no-commit bounds were retained. Earlier proposal-only roles were not converted into mandatory appointments or invented approvals.

The first execution crashed in Hermes worker ownership handling. On resumption, the retained global-check process was still active; it was not duplicated or killed. It subsequently finished and its persisted result/log digests were checked. The interrupted package-fixture run is retained as interrupted, never promoted to PASS. Existing unknown/consumed state was not retried.

## Implementation delivered

1. **Inherited post-operation binding:** every one of the 17 implemented inherited adapter routes now requalifies the exact archive/extraction, then checks frozen inputs last. No early successful route can bypass this common tail. New unit mutation tests cover stable operation, archive mutation during work and source mutation during the final probe for all 17 routes. Probe/claim dependencies are mocked; these are not real candidate execution receipts.
2. **Stage 6 successor routes:** current source-scope checks remain separate from exact accepted Stage 6 historical manifest/blob/tag/delta/ancestry verification. Unchanged historical baseline fixtures require 9 assertions/8 negative controls. Bootstrap fixtures require 6 scenarios/5 negative fixtures. Migrator routes use current packaged resolver/checksum/CLI checks. Stage 6 contract test dispatch now goes through the candidate-bound successor route. No Stage 1–9 implementation or historical review file was edited.
3. **Unqualified PostgreSQL fallback stopped:** four inherited PostgreSQL labels explicitly reject before historical package-script dispatch. This prevents misleading historical execution under Stage 10. It is a safety correction, **not completed coverage**. No mapping to the separate Stage 10 PostgreSQL/browser lane is assumed.
4. **Qualification receipt preservation:** the real Stage 10 PostgreSQL CLI previously caught its own overwrite-refusal error. With missing artifact inputs it overwrote an existing regular receipt or symlink target; directory refusal also left preallocated scratch roots. Three new CLI tests reproduced those defects (RED). The corrected guard uses `lstat`, propagates every non-ENOENT error and runs before scratch allocation. Receipt/log publication uses exclusive creation. Four GREEN cases include dangling symlinks. This is not concurrent-execution exclusion, canonical custody or hostile same-UID isolation.
5. **Documentation:** refreshed the mutable CT200 checklist to remove obsolete implementation claims; added a current section to the inherited coverage matrix while preserving historical diagnostics and original NO_GO reviews.

The exact changed/new file list and SHA-256 values are in `CODING_QUALIFICATION_HANDOFF.json`, measured relative to the task's retained start snapshot. That JSON excludes itself to avoid self-reference. All existing untracked input paths were preserved; accepted tracked bytes/modes remain unchanged.

## Actual execution evidence

Pinned Node executable used: `/home/hermes/.local/share/travelos-stage5-toolchain/node_modules/node/bin/node`. The runtime/toolchain checks also executed the fixed Corepack/pnpm implementation path, not merely PATH version shims.

| Execution | Observed result | Evidence / limit |
|---|---|---|
| Resumed focused suite, five files below | 71 passed, zero failed/cancelled/skipped | `.hermes/state/t_9fbc40f6-resumed-focused.log`; includes 51 inherited drift cases and 12 candidate drift cases |
| Resumed safety suite, eight files below | 28 passed, zero failed/cancelled/skipped | `.hermes/state/t_9fbc40f6-resumed-safety.log`; includes receipt preservation, readiness brakes and dispatch |
| New receipt regression before correction | 0 passed, 3 failed | `t_9fbc40f6-receipt-red.log`; real CLI reproduction on synthetic disposable receipts |
| Receipt preservation plus cleanup tests | 5 passed, 1 skipped | `t_9fbc40f6-receipt-green.log`; **real PostgreSQL escalation case skipped** because explicit PG root was not supplied; no real cleanup drill claimed |
| Earlier retained focused suite | 95 passed, zero failed/cancelled/skipped | `t_9fbc40f6-focused.log`; not a separate aggregate to add to the overlapping resumed suites |
| Retained global checks from first execution | 16 gate processes PASS / exit 0 | `t_9fbc40f6-checks/results.json`; stdout/stderr hashes rechecked against receipts |
| Fresh post-correction pins/format/lint/typecheck/unit | all five gate processes PASS / exit 0 | `t_9fbc40f6-resumed-checks/results.json`; full application unit suite 65 files / 369 tests |
| Explicit Stage 10 directory ESLint and Prettier check | exit 0 | `node node_modules/eslint/bin/eslint.js tooling/ci/stage-10/*.mjs tooling/database/run-stage-10-postgres-disposable.mjs`; corresponding Prettier `--check` |
| Predecessor bytes/archive verifier | PASS, 2662 accepted files | `t_9fbc40f6-resumed-predecessor.log`; not historical CI rerun |
| Source/binary screening | PASS before report creation; final expanded scan retained separately | `t_9fbc40f6-source-screen.json` and `t_9fbc40f6-final-source-screen.json`; heuristic exact-review screening only, privacy pending |
| Package fixture attempt interrupted by prior worker loss | incomplete, NOT PASS | `t_9fbc40f6-package-fixtures.log`: nine completed cases before interruption; no complete suite total or current real-package qualification inferred |

Focused command (prefix with pinned Node):

```sh
node --test --test-concurrency=1 \
  tooling/ci/stage-10/test-inherited-gate-drift.mjs \
  tooling/ci/stage-10/test-candidate-gate-drift.mjs \
  tooling/ci/stage-10/test-stage6-successor-baseline.mjs \
  tooling/ci/stage-10/test-stage6-fixture-regression.mjs \
  tooling/ci/stage-10/test-stage10-canonical-dispatch.mjs
```

Safety command:

```sh
node --test --test-concurrency=1 \
  tooling/ci/stage-10/test-pipeline.mjs \
  tooling/ci/stage-10/test-receipt.mjs \
  tooling/ci/stage-10/test-gate-process.mjs \
  tooling/ci/stage-10/test-inherited-compatibility-adapter.mjs \
  tooling/ci/stage-10/test-stage6-contract-dispatch.mjs \
  tooling/ci/stage-10/test-stage10-candidate-gate.mjs \
  tooling/ci/stage-10/test-canonical-executor.mjs \
  tooling/ci/stage-10/test-postgres-receipt-preservation.mjs
```

Global checks use `runGate({root, outputDirectory, label})`, without a candidate, for exactly the labels recorded in the JSON companion. Those non-consuming gate processes invoke the corresponding existing `package.json` scripts under the owned fixed toolchain. No full 60-gate qualification is claimed. The interrupted package suite and skipped real cleanup test remain unqualified.

## Remaining blockers and owners

The `S10-READY-*` identifiers below are **local handoff tracking IDs**, not invented independent-review finding IDs. The original review did not assign IDs to its two dispatch findings.

| ID | Current state / concrete closure requirement | Next owner |
|---|---|---|
| Latest dispatch finding 1 (candidate post-binding) | Already corrected before this task and independently scoped as `CORRECTION_VERIFIED` in `POST_GATE_BINDING_CORRECTION_REVIEW.md`; preserved, not re-presented as a new fix | QA verifies unchanged correction and new inherited tail |
| Latest dispatch finding 2 / `S10-READY-PG` | **OPEN.** Four inherited PostgreSQL routes have no approved complete successor assertion mapping/current-artifact execution/cleanup proof. Explicit rejection is not implementation completeness. Stage 10's separate full runner is not enough by implication | Alex coordinates approved CT200 execution; coding work remains if mapping exposes gaps |
| `S10-READY-REGRESSION` | **OPEN.** No full current mutable package/expanded inherited regression execution after these source changes. The interrupted package-fixture run is not green, and local checks do not cover all 60 declarations | QA assesses exact coverage; Alex sequences remaining technical qualification |
| `S10-READY-OPS` | **OPEN.** Candidate operational-preflight producer/route, actual fixed migration/restart/health integration and least-privilege cutover are incomplete/unqualified. Last recorded checkpoint found broad sudo and missing protected activation paths. Real permitted/denied-principal and independent recovery/rollback evidence required | Alex, not this no-host-change coding run |
| `S10-READY-SIGN` | **OPEN.** Actual separately protected signing/trust/custody/recovery and pre-activation enforcement not qualified. Existing key checkpoint is not current candidate acceptance or host-loss proof | Alex plus independent security review |
| `S10-READY-RECOVERY` | **OPEN.** Partial actual backup/recovery exists; complete restored head, business/ACL sampling, coordinated recovery and ADR-014 interval reconciliation are still missing | Alex plus operational/security review |
| `S10-RET-002` | **OPEN.** Independently authenticated receipt provenance bound to candidate/artifact | Alex / independent adjudication |
| `S10-RET-004` | **OPEN.** Independently authenticated exact-byte privacy decision, not scanner output | Independent accepted mechanism/adjudication |
| `S10-RET-005` | **OPEN.** Producer write authority removed from protected staging/policy/canonical evidence and real-principal isolation proven | Alex / operational and security review |
| `S10-READY-CANONICAL` | **BLOCKED by above.** All 60 statuses and six pending integration brakes remain; no candidate build/canonical CI, final accepted evidence, freeze or final independent Stage GO | Alex after prerequisites, QA independently validates |

## Concrete QA criteria

1. Compare changed-byte hashes to the JSON companion and accepted predecessor bytes/modes/tag/archive. Preserve original reviews and untracked work.
2. Rerun focused/safety commands under the pinned executable without one-shot builds/CI, host writes or hidden filters. Inspect the test counts; module-hook drift tests prove orchestration, not real artifact qualification.
3. Inspect all 17 inherited routes for final artifact qualification then input check, and ensure no branch returns before that common tail. Verify Stage 6 exact accepted history/current-source separation and fixture report counts.
4. Verify all four inherited PG labels reject before fallback, but explicitly keep dispatch finding 2 OPEN. Assess complete assertion equivalence before any real CT200 lane is scheduled.
5. Exercise existing receipt refusal for regular/symlink/dangling/directory cases through the real CLI, with unchanged sentinel targets and zero scratch allocation. Review exclusive output semantics; do not infer concurrency/custody guarantees that are not implemented.
6. Require actual current-artifact PostgreSQL/browser, package and cleanup evidence before qualifying those lanes. The skipped real escalation test and interrupted package attempt cannot be waived by this handoff.
7. Confirm no statuses/readiness controls or protected predecessor files were weakened. Return scoped GO/NO_GO with findings; author green checks alone cannot close Stage 10.

## Excluded actions and live-state limits

No CT200 operation was executed by this task: no privileged installation, restart, migration, backup, activation, DNS/firewall/router change, new credential or production action. No new CT/VM, consuming candidate/build/canonical claim, commit/tag/push/merge. Stage 11 actions = 0.

The last recorded active release/head remain historical observations in the current CT200 checkpoint, not fresh live measurements by this handoff. No claim is made that Rui's authenticated browser access was newly verified. The branch remains `phase-1/stage-10` with Stage 10 work untracked; it is not a sealed/clean release.
