# Stage 10 — PostgreSQL assertion mapping, run 13

**Author checkpoint, not independent QA. NOT_READY / NO_GO remains. Task `t_9fbc40f6` is not complete; QA dependencies are not released.** No further routing card was created. This record supersedes the earlier handoff's statement that all four PG labels simply reject dispatch; it does not rewrite the prior reports, evidence or verdicts.

## Recovery and bounded implementation

The start-of-run inspection found retained, not yet reported drafts already routing the four inherited PG labels to `stage10-candidate-gate.mjs`, sharing the full Stage 10 PostgreSQL/browser lane and checking a suite/source coverage envelope. They were not attributed to this run as new work. The recovered routing/source tests ran: 8/8 PASS. No existing qualification process was active, and no interrupted/unknown/consumed attempt was retried.

Implemented beyond those drafts:

- An explicit 95-case catalog, checked against the accepted sources using TypeScript syntax traversal and enumeration of the 23 Worker privilege inverses. These are named test-case obligations, not a claim that every individual `expect` expression has its own separate receipt.
- Cumulative label mappings: Stage 6 publication 3; Stage 7 successor scope 49; Stage 8 successor scope 83; Stage 9/10 superset 95. These successor scopes include later inherited additions where applicable; they are not falsely represented as the original historical test counts. Every dispatched label requires the **whole** 95-case run, not a partial slice.
- Exact accepted bytes for four integration suites, Stage 9 configuration and Stage 8/9 adapters, plus hashes of six current harness/catalog files (13 source rows total). The four suites remain byte-identical to Stage 9 GO.
- Actual pinned Vitest JSON reporter consumption: require all 95 exact suite/title identities to be passed, without duplicates, substitutions, skips/todos, failed suites or failure messages. Only suite/title/status are retained in the execution receipt. Raw reporter JSON stays in the disposable work root and follows existing cleanup. This projection is not a privacy decision or authenticated origin.
- Source/harness coverage is compared again after integration execution. Candidate dispatch validates the retained named results before common final archive/payload qualification and input checks. Old receipts without this evidence fail closed; no occupied attempt is repaired or replayed.
- Non-consuming tests exercise every PG label's successful synthetic receipt reuse and nine refusal/drift cases each. Package/claim probes are explicitly mocked; no actual build/CI claim or PostgreSQL process is started by those tests.

## Preserved and superseded assertions

| Area | Preserved | Explicit Stage 10 substitution |
|---|---|---|
| Stage 6 | read-only preview; immutable v1/v2; stale/idempotent/atomic publish; unauthorized direct invocation | current packaged migrator selected instead of building the historical migrator; supported Stage 5 prefix setup retained; expected successor head 0016 |
| Stage 7 | grants/epoch/realm isolation, fixture atomicity/cleanup, SQL permissions, workspace CAS/rollback/scope, built browser journey | cumulative migration counts/head, Stage 10 packaged acceptance harness with explicit verifier pins, Stage 10 artifact identity and zero Stage 11 actions |
| Stage 8 | concurrency/CAS/leases, bounded retry/dead-letter, UNKNOWN_OUTCOME, activity/outbox/audit rollback, role denial, real packaged worker/restart; all 23 missing-privilege controls | additive-chain head expected at accepted 0016; worker uses extracted candidate path |
| Stage 9 | all 12 Staff invitation persistence/atomicity/audit/role cases | none in suite source |

The real Stage 10 Vitest transform was exercised without database hooks for all four suite files. Changed Stage 6/7 source hashes reject. No predecessor test or accepted ADR was edited.

## Executed evidence

Pinned executable for commands below:

```text
/home/hermes/.local/share/travelos-stage5-toolchain/node_modules/node/bin/node
```

| Command / evidence under `.hermes/state/` | Observed result |
|---|---|
| `node --test tooling/ci/stage-10/test-postgres-assertion-mapping.mjs` — `t_9fbc40f6-run13-mapping-red.log` | RED: 2 failures: absent named mapping; suite-name-only validation wrongly accepted missing results |
| Four mapping/routing/reuse test files — `t_9fbc40f6-run13-mapping-green.log` | initial GREEN 57/57; overlaps final regression, do not add totals |
| Final affected regression command below — `t_9fbc40f6-run13-regression.log` | 97 PASS, 0 fail/cancelled/skipped/todo |
| `node --import tsx --test tooling/ci/stage-10/test-postgres-successor-transforms.mjs` — `t_9fbc40f6-run13-transform.log` | 4 PASS, 0 fail/cancelled/skipped/todo |
| ESLint `tooling/ci/stage-10/*.mjs tooling/database/run-stage-10-postgres-disposable.mjs` — `t_9fbc40f6-run13-final-lint.log` | exit 0; earlier lint failed two bare `structuredClone` references, corrected to `globalThis.structuredClone` |
| Prettier check of changed implementation/mapping tests — `t_9fbc40f6-run13-format.log` | exit 0; final expanded check recorded separately |
| `tsc -p tooling/ci/tsconfig.typecheck.json --noEmit` and `tsc -p tooling/ci/tsconfig.owned-declarations.json --noEmit` — `t_9fbc40f6-run13-typecheck.log` | both exit 0 |
| `node node_modules/vitest/vitest.mjs run --config tooling/testing/vitest.config.ts` — `t_9fbc40f6-run13-unit.log` | 65 files / 369 tests PASS |
| Actual Vitest dual verbose/JSON reporter probe on `packages/backend-core/test/m1/shared-kernel.test.ts` — `t_9fbc40f6-run13-reporter-probe.*` | 5 real unit cases PASS; CLI output option and JSON shape verified; **not PG qualification** |
| `verifyInheritedBaseline(process.cwd())` — `t_9fbc40f6-run13-predecessor.log` | 2662 accepted files and exact archive verified PASS; not historical CI rerun |
| `git diff --exit-code`, branch inspection | exit 0 for tracked bytes; branch `phase-1/stage-10`; mutable Stage 10 files remain untracked, not sealed |

Final affected regression:

```sh
node --test --test-concurrency=1 \
 tooling/ci/stage-10/test-postgres-assertion-mapping.mjs \
 tooling/ci/stage-10/test-postgres-successor-coverage.mjs \
 tooling/ci/stage-10/test-postgres-successor-routing.mjs \
 tooling/ci/stage-10/test-postgres-bound-reuse.mjs \
 tooling/ci/stage-10/test-pipeline.mjs \
 tooling/ci/stage-10/test-stage10-canonical-dispatch.mjs \
 tooling/ci/stage-10/test-stage10-candidate-gate.mjs \
 tooling/ci/stage-10/test-gate-process.mjs \
 tooling/ci/stage-10/test-candidate-gate-drift.mjs \
 tooling/ci/stage-10/test-canonical-executor.mjs \
 tooling/ci/stage-10/test-postgres-receipt-preservation.mjs
```

Exact run-relative file changes and evidence digests are in `CODING_POSTGRES_MAPPING_RUN13.json`; original snapshot is `.hermes/state/t_9fbc40f6-run13-start.json`. The JSON excludes itself and records readback verification separately. Formatting-only changes to retained routing drafts are identified there.

## Remaining blockers and precise continuation

- **S10-READY-PG / dispatch finding 2: OPEN.** Named mapping and non-consuming orchestration are implemented/tested, but no real current-artifact 95-case PostgreSQL/browser execution or cleanup proof exists from this run. Review the substitutions and shared-receipt policy independently. The local disposable runner is a mechanism, not permission to qualify runtime outside the Product Owner's CT200-only policy.
- **S10-READY-REGRESSION: OPEN.** Interrupted package-fixture attempt remains incomplete. Full mutable packaging and expanded inherited qualification still required after current changes; no old archive is relabelled as containing these changes.
- **S10-READY-OPS, S10-READY-SIGN, S10-READY-RECOVERY: OPEN.** Actual fixed migration/restart/health integration, least-privilege cutover, protected signing/trust/custody/recovery, full business/ACL restore sampling and ADR-014 interval reconciliation are not supplied by these tests.
- **S10-RET-002/004/005: OPEN.** Mapping/results digests do not supply independent receipt origin, exact-byte privacy acceptance or producer isolation.
- **S10-READY-CANONICAL: BLOCKED.** All 60 declarations retain their unqualified/pending status. No readiness control was changed or one-shot claim consumed. No final evidence freeze or Stage GO.

**Next concrete technical action on this same open implementation card:** finish the non-consuming mutable package regression, then reconcile the fresh extracted-artifact inputs with the CT200-only execution route and its controlled synthetic database/cleanup boundaries. Coordinate any privileged runtime need with Alex under the existing operational graph; do not independently install packages, create credentials, restart services or run the build-host disposable PG lane as purported CT200 acceptance. Preserve failed/incomplete evidence and do not retry an occupied candidate attempt. Technical work remains; it is not all recast as a human approval blocker.

## Independent review criteria

1. Compare run-relative hashes and accepted predecessor bytes. Confirm no original path was deleted and no gate status changed.
2. Reproduce RED/GREEN distinction and inspect the catalog against all four suites, including all 23 capability cases. Check exact adapter substitutions, not only names/counts.
3. Exercise missing/duplicate/renamed/non-passing results, changed source envelopes, wrong candidate binding, cleanup failure, log mismatch and final artifact/input drift. Confirm occupied receipts/logs remain byte-identical and no process fallback starts.
4. Inspect actual reporter projection and disposable raw-output handling. The unit fixture PASS records are explicitly synthetic, not forged execution evidence.
5. Require actual exact-artifact CT200 integration, cleanup and independent acceptance before qualifying the inherited PG labels or closing dispatch finding 2. Do not release QA by falsely marking this task complete.

No CT200 operation, new credential, privileged host change, restart, candidate/build/canonical claim, commit/tag/push/merge, production or Stage 11 action was performed in this run.
