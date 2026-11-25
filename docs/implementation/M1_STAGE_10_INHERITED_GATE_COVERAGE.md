# Stage 10 inherited gate coverage — mapping, not qualification

## Current coding handoff — task `t_9fbc40f6`

The implementation below is mutable and unqualified. This section supersedes stale dispatch counts in the historical narrative, not prior review verdicts. All 60 gate statuses remain unchanged.

- All **17 inherited candidate-adapter routes** now finish with exact archive/payload qualification followed by `verifyInputs` last. Real temporary bytes and module-hook probe/claim substitutes exercise stability, archive drift during work and input drift during the final artifact probe (51 unit cases). These mocks do not prove a real candidate build or artifact qualification.
- `stage6-baseline` now validates the exact Stage 6 accepted manifest against accepted Git blobs, exact GO tag, Stage 5 lineage/delta, and Stage 9 ancestry, separately from current Stage 10 source scope. Historical validators and fixtures remain byte-identical.
- `stage6-baseline-tests` executes the unchanged nine-assertion/eight-negative-control historical fixture report. `stage6-bootstrap` executes the unchanged six-scenario/five-negative-fixture report in addition to current packaged migrator checks. Both reports are bounded and their required fields/counts are checked. `stage6-migrator` uses current packaged resolver/checksum/CLI assertions. These are wired implementations, not current candidate execution/independent qualification.
- `stage6-contract-tests` now selects the same candidate-bound historical/current contract regression as `stage6-contract`, instead of falling through to a direct inherited package script.
- `stage6-postgres`, `stage7-postgres`, `stage8-postgres`, `stage9-postgres-browser` have a recovered, now regression-tested candidate dispatch to the full Stage 10 extracted-artifact PostgreSQL/browser runner, never historical package-script fallback. The explicit `postgres-assertions.json` catalog lists 95 named test cases (3 publication + 46 access/workspace/browser + 34 worker, including 23 privilege inverses + 12 invitations). Label mappings retain cumulative obligations 3/49/83/95; every label nevertheless requires the full 95-case superset. `postgres-successor-coverage.mjs` pins all four unchanged accepted suites, both inherited adapters/config and current harness/catalog bytes. Actual Vitest JSON must supply every exact case as passed, with no missing/duplicate/renamed/skipped/todo cases; only suite/title/status are projected into the receipt. Shared successful receipt reuse is exact-bound and non-repairing, not authorization or independent provenance. **Current-artifact execution, cleanup and independent qualification remain OPEN.** See `docs/reviews/phase-1-m1/stage-10/CODING_POSTGRES_MAPPING_RUN13.md`; the earlier handoff's blanket dispatch-rejection description is superseded, not historical evidence rewritten.
- The Stage 10 PostgreSQL runner's existing-receipt guard previously swallowed its own refusal, overwriting regular/symlink-target receipts on input failure and leaking scratch roots for directory refusal. A real CLI inverse reproduced all three failures. The guard now rejects every occupied leaf before scratch allocation; final receipt/log writes are exclusive. This does not claim adversarial same-UID isolation, durable external custody or full concurrent execution exclusion.

See `docs/reviews/phase-1-m1/stage-10/CODING_QUALIFICATION_HANDOFF.md` and its JSON companion for actual commands, retained failures, verified results, changed-byte inventory and open blockers. The original dispatch review and its correction review are preserved; global NO_GO is not overturned by this implementation report.

## Historical mapping and diagnostics (preserved below)

This document maps all 60 labels in `tooling/ci/stage-10/gates.mjs` to the Stage 9 canonical runner (`tooling/ci/stage-9/run-canonical-ci.mjs:49–86`) and records the local compatibility diagnostics. A same-script mapping is intended inherited coverage, not proof of equivalence. All 50 inherited labels are `EXISTING_REQUIRES_STAGE10_COMPATIBILITY_QUALIFICATION`; all 10 Stage 10 labels remain `PENDING_IMPLEMENTATION_AND_REVIEW`. The canonical runner's readiness check blocks before claiming because definitions are not `IMPLEMENTED_AND_REVIEWED` and integrations are pending. There is no Stage 10 canonical CI pass.

The table below preserves the initial package-script dispatch and diagnostic attempt. The current narrow exception is `stage7-migrator`: it now dispatches the candidate-bound successor adapter described below. Five new Stage 10 labels also have candidate dispatch code; the other five cannot dispatch. No gate status is upgraded merely by wiring. Results in the table come only from `.hermes/state/stage10-compatibility-qualification-Sd8eGF/results.json`; `not run` means absent from that attempt. Pre/post labels are distinct executions. Stage 9 matches use the identical script; additional checks have no same-script Stage 9 canonical label.

## Fail-closed successor preflight

`tooling/ci/stage-10/inherited-compatibility-adapter.mjs` verifies frozen candidate inputs, accepted predecessor bytes/archive, all 16 migration file hashes and their exact accepted manifest and bytes, consumed build claim, and the extracted candidate artifact. Eleven labels still explicitly fail with their unresolved assertion group. `stage7-migrator` instead executes `qualifyPackagedMigrator` against that verified extracted candidate, then rechecks candidate inputs for drift. No historical assertions are modified. Canonical execution and independent qualification of this route remain pending.

### Packaged migrator successor assertions

**Dispatch update:** `stage8-artifact` is now the second inherited successor route alongside `stage7-migrator`. Ten of the original twelve failed labels still have no implemented replacement. Earlier diagnostic results and the initial dispatch descriptions below remain historical, not current qualification.

The Stage 8 successor regression ran all 16 obligations on rebuilt mutable artifact `travelos-stage10-gen12-c11e3dd7`: 16 PASS, zero skipped/cancelled. Fourteen assertions remain unchanged and hash-bound to accepted historical test bytes; two package-format checks use Stage 10 artifact qualification and the real packaged installer import. The corrected verifier is import-safe and accepts only structured verification inputs with required independent pins; the legacy root-string installation call remains rejected. Candidate dispatch now executes this regression only after frozen-input/build-claim/artifact verification and checks candidate drift afterward. Current-candidate canonical execution and independent review remain pending; no gate status or readiness control is waived.

`packaged-migrator-regression.mjs` preserves the Stage 7 migrator test's package identity/type/start entrypoint, exact `node-pg-migrate` and `pg` version families, runner/resolver/CLI presence, module-relative migration-directory resolution, complete checksum verification and deployment-link containment. The historical Stage 7 head is superseded by the entire accepted Stage 9 16-migration chain, not merely a replacement head string. It executes the actual packaged resolver and migration verifier without database mutation. The caller authenticates and qualifies the artifact before importing those modules.

The extracted mutable `travelos-stage10-gen12-2641c43e` package passed this regression after full archive/payload qualification. Five inverse probes reject truncated chains, changed manifest hashes, wrong heads, wrong dependency versions and changed migration bytes. These are implementation and mutable-artifact results, not a current canonical-candidate PASS. All gate statuses and the global readiness brake remain unchanged.

## All 12 compatibility failures

### Post-operation binding correction after technical NO_GO

The immutable `LATEST_SUCCESSOR_DISPATCH_REVIEW.md` returned technical NO_GO and identified missing final input/artifact checks in three candidate routes. All seven candidate routes now share final archive/payload requalification followed by `verifyInputs` **after** those probes. The PostgreSQL/browser branch uses that common artifact check instead of duplicating it internally. The review's second finding—unqualified coverage beyond the twelve measured compatibility labels—remains open; no all-60 readiness or authorization is inferred.

The new `test-candidate-gate-drift.mjs` exercises the public candidate runner for baseline/build-receipt/exact-artifact with scoped module-hook mocks for package probes and claim inspection, and real private temporary input/archive bytes. Stable execution and source/archive changes during work or final qualification are tested. The focused combined run passed **19 tests with zero failures, cancellations or skips**, followed by full repository lint and whitespace checks. These are unit mutation inverses, not actual canonical build/CI receipts. Independent `POST_GATE_BINDING_CORRECTION_REVIEW.md` returned `CORRECTION_VERIFIED`; the parent independently checked both reviewed code hashes and the unchanged predecessor-review hash. The separate unqualified-label finding and global NO_GO remain open; the original review is preserved. A separate read-only process observation found no `postgres`, `pg_ctl`, `unshare` or `cosign` processes left running; no process was terminated.

### Exact-archive activation evidence

The actual private-namespace host-operator rehearsal on `travelos-stage10-gen12-c11e3dd7` initially failed at its final Stage 9-only artifact verifier. That failure remains in `.hermes/state/stage10-exact-host-operator-cvw36kj4/execution.json`; it is not reclassified as PASS.

The Stage 10-owned harness now uses `qualify-stage10-host-rehearsal.mjs` to perform complete package checks as the **unprivileged parent**, requiring caller-supplied archive, receipt, frozen-input and Node pins before compiling or entering the root namespace. The privileged namespace verifies the signed archive and compares extracted member bytes without executing artifact-owned runtime/code. A caller-supplied parent PASS envelope is discarded. The historical Stage 9 route is unchanged.

On the same immutable mutable-rehearsal archive SHA-256 `62dcb0944c3cf8933df1e8a8da8dfdc5e5b2fde04482c8542198bf7b3c642890`, the repaired run exited zero, compared **13,217 regular members**, passed **34 rejection cases** and rejected replay. Nine parser/pin/CLI controls and focused lint passed. The actual successful receipt is `.hermes/state/stage10-exact-host-operator-z8e8myt0/execution.json`. Signing keys were disposable synthetic fixtures; trust/privacy remain PENDING. This proves the exact-archive mechanism in its private namespace, **not CT200 installation, separately controlled custody, authenticated runtime acceptance, canonical CI or Stage 10 GO**. The artifact predates the newly authored harness; no sealed artifact was patched.

### Clean-install/source-security integration evidence

The dedicated `stage10-clean-install` route now runs a fresh private source copy with pinned offline/frozen/no-lifecycle-script dependency installation, unchanged lockfile/manifest checks and source-drift rejection. Its actual mutable run passed on 2,847 copied files with no compilation; both its positive and pre-install drift-rejection controls passed. Logs are retained under `.hermes/state/stage10-clean-install-4x9RSA/`. `stage10-source-security` now uses the same complete exact-review text/archive/image screen as the final source gate, retaining privacy-pending semantics. After wiring, full repository lint and five candidate/dispatch/executor tests passed; the refreshed full source screen passed with zero unresolved text/archive findings and zero unsupported inputs. The operational-preflight, signature/activation and retention/privacy routes remain non-dispatchable. Gate status and global readiness are not upgraded merely by these integrations.

### Stage 9 artifact dispatch update — all twelve measured routes implemented

`stage9-artifact` now dispatches the qualified successor regression with post-execution candidate-input comparison. It retains the original Stage 9 tests except explicit hash/anchor-checked branch metadata translations and the final whole-source scan, which uses the broader actual Stage 10 text/archive/image gate. All 49 inherited obligations and both browser-host tests passed with zero skipped/cancelled/failed cases; wrong binding and transformation-anchor controls also passed. Full repository lint and five executor/dispatch/guard tests passed after wiring. All twelve labels from the recorded failing compatibility batch now have implementation/dispatch, but none receives automatic current-candidate qualification or operational authority. Other pending Stage 10 integrations and historical gates outside this measured batch remain governed by their own requirements; the canonical readiness brake is unchanged.

### Stage 7 artifact dispatch update

`stage7-artifact` now runs `runStage7ArtifactRegression` after exact candidate/build/artifact verification and compares candidate inputs afterward. All five unchanged historical suites execute against their own fixtures in an isolated checkout of exact accepted Stage 7 commit `a57789b6662f0e0c0da5948c20eef6eb1e6bf4ec`; source bytes are checked against both accepted Stage 7 and Stage 9. Their 67 cases passed with zero skips, and wrong artifact binding was rejected. The actual Stage 10 full 16-migration artifact is qualified separately, not substituted with a historical fixture. Pinned offline dependencies are required; failure evidence is preserved. Five focused dispatch/executor/guard tests and targeted lint passed after wiring. Eleven original labels now have implementation/dispatch; only `stage9-artifact` remains unimplemented. Independent qualification and all remaining operational/canonical gates are still open.

### Stage 6 contract dispatch update

`stage6-contract` now qualifies the actual Stage 10 artifact/contract and executes the unchanged, byte-verified accepted Stage 6 contract verifier against all its original fixtures. Eight historical assertions and all six negative fixtures passed; a wrong Stage 10 artifact binding was separately rejected. The positive mutable run used `travelos-stage10-gen12-c11e3dd7`, with retained logs under `.hermes/state/stage10-stage6-contract-YkuK2g/`. Candidate execution verifies the build/inputs/artifact first, retains fixture-execution logs, and rechecks inputs afterward. This preserves historical behavior without pretending the old Stage 6 CLI accepts the new layout, and grants no host installation authority. Five focused executor/dispatch/guard tests and targeted lint passed after integration. Ten original compatibility labels now have implementation/dispatch; only `stage7-artifact` and `stage9-artifact` remain unimplemented. Independent qualification and the operational/canonical gates remain open.

### Stage 9 contract dispatch update

`stage9-contract` now executes the accepted deployment-contract verifier through a hash/anchor-checked successor copy: the single historical branch assertion binds the actual Stage 10 branch, while all contract hashes, immutable baseline, migration bytes/ordering, Caddy digests, service descriptors and API/static-boundary assertions remain unchanged. Module-relative locations/imports still resolve to the accepted original sources; originals are never edited. Candidate/artifact verification occurs before dispatch and inputs are compared again afterward. The reference report grants no installation or activation authority. Its positive execution and anchor-drift tests passed, followed by five dispatch/executor/guard tests and targeted lint. Nine original failing labels now have implementation/dispatch; three remain unimplemented: `stage6-contract`, `stage7-artifact`, `stage9-artifact`. Independent review and current-candidate canonical qualification of these later changes remain pending.

### Stage 7 contract regression dispatch update

`stage7-contract` and `stage7-contract-tests` now dispatch `runStage7ContractRegression` after exact candidate/build/artifact verification and compare candidate inputs again afterward. The adapter preserves every assertion in the accepted 359-line contract test; only the historical successor-manifest input is selected as the exact byte-verified accepted Stage 7 13-migration prefix. It separately verifies the complete current 16-migration manifest against accepted Stage 9 and the qualified artifact. All three harness tests passed (wrong prefix, wrong binding, full original assertions); the original test reported twelve cases passed. Full lint and five focused executor/dispatch/guard tests passed after wiring. Eight original compatibility labels now have implementation/dispatch; four remain unimplemented: `stage6-contract`, `stage7-artifact`, `stage9-contract`, `stage9-artifact`. These latest routes still require independent review/current canonical qualification; historical contract authority is not promoted into Stage 10 operational installation authority.

### Baseline inverse execution update

`stage7-baseline-tests` now runs the fixed `baseline-inverse-regression.mjs` selection after candidate/build/artifact and successor-baseline verification. It launches ten actual lineage/source-scope/isolated-repository tests with a clean pinned environment, bounded timeout/output, retained logs, exact TAP counts and zero skips/cancellations; candidate inputs are rechecked afterward. The local executor run passed all ten tests (`.hermes/state/stage10-baseline-inverses-rLiSKv/`), plus five focused dispatch/executor/guard tests and full lint. Six original compatibility labels now have implementation/dispatch; the six remaining unimplemented labels are the Stage 6 contract, Stage 7 contract/contract tests/artifact and Stage 9 contract/artifact. No canonical qualification or independent approval of these latest changes is inferred.

### Baseline and predecessor dispatch update

`stage7-baseline` and `stage7-predecessor` now use `verifySuccessorBaseline` after candidate/build/artifact qualification, with post-execution input comparison. The successor verifies the exact accepted Stage 7 tag and its ancestry into accepted Stage 9, then the Stage 10 branch, entire immutable predecessor, complete source scope and unchanged capture. The historical Stage 7 branch/pre-closure HEAD is not spoofed. Five of the twelve originally failing labels now have implementations and dispatch; seven remain unimplemented, including `stage7-baseline-tests` until its real inverse suite is wired into candidate execution. Fourteen focused scope/lineage/dispatch/executor/guard tests and full lint passed. The separately executed isolated-repository inverse suite rejected changed bytes, mode, deletion, symlink, invalid archive and moved Stage 9 tag. None of these mutable results upgrades canonical readiness or supplies independent review of the new baseline routes.

### Current Stage 10 source-scope replacement

`stage7-source-scope` now dispatches the Stage 10-owned `verifyCurrentSourceScope` after candidate/build/artifact validation, and rechecks inputs afterward. This is the third implemented inherited successor route; nine labels remain unimplemented. This replaces obsolete branch/pre-closure-HEAD metadata with the Stage 10 branch, exact accepted Stage 9 ref/archive and immutable predecessor bytes, complete capture of inherited source/evidence, explicit permitted Stage 10 addition paths and no source-content drift. It does not relabel the old Stage 7 command as passing on the new candidate.

The initial current-tree execution passed: 2,659 inherited source files, 171 approved-area additions and 2,662 immutable predecessor files. Exactly three historical `.hermes` planning/source-index paths are excluded from the source capture by the existing local-state policy, but still checked byte-for-byte by the predecessor baseline. Missing other inherited paths, duplicate paths, unapproved additions, local runtime state, traversal and invalid digests fail closed. Eight scope tests and five dispatch/executor/guard tests passed with full repository lint. These are mutable implementation results, not independent review, privacy acceptance or canonical CI.

### Accepted Stage 7 history verification

The existing Stage 7 successor worktree was checked at the exact accepted `travelos-phase-1-m1-stage-7-gen15-go` commit `a57789b6662f0e0c0da5948c20eef6eb1e6bf4ec`, with no tracked changes before or after. Its baseline verifier, predecessor verifier and baseline inverse-test command all passed. This verifies accepted history, not a Stage 10 current-candidate baseline; no Stage 10 gate is marked passed from these results.

Its historical source-scope command instead requires pre-closure HEAD `5609bcb44edb9baa2d10ff43e7e69c356de6ca35` and rejects the accepted closure commit. That metadata-bound command cannot be treated as a current successor source-scope verifier, even when invoked in the accepted worktree. Neither historical source nor HEAD was changed to force a pass. Logs and execution receipts are retained under `.hermes/state/stage10-accepted-stage7-baselines-rCB3hi/` as mutable noncanonical evidence.

The individual diagnostics are `.hermes/state/stage10-compatibility-qualification-Sd8eGF/<label>/<label>.{stdout,stderr,json}`. Their failure does not establish a successor adapter passes.

| Failed labels | Observation and unresolved coverage |
|---|---|
| `stage7-baseline`, `stage7-predecessor`, `stage7-source-scope`, `stage7-baseline-tests` | Expected branch `stage7/runtime-acceptance-cleanup-successor`, got `phase-1/stage-10`. The intended Stage 10 baseline adapter checks predecessor bytes/archive, not historical CI rerun or source-scope behavioral equivalence. |
| `stage6-contract` | Initial bare command lacked `--artifact-root`. Subsequent read-only CLI probing established separate-value syntax and mandatory `--unit-dir`. With the requalified Stage 10 mutable payload and `deploy/systemd`, the historical verifier rejects the absent `deployment/verify-stage6-deployment-contract.mjs`. Therefore arguments alone do not resolve compatibility; Stage 10's independently versioned deployment contract/layout needs assertion-level successor coverage, not a historical file injected into a sealed package. |
| `stage7-contract`, `stage7-contract-tests` | Migration manifest fails the accepted gen09 prefix check: actual `c322fec7822ca0cea4cb9e99d9ed0d84730c37f311827c4ee3f6712dc20fe865`, expected `dd545bf5ae7ad0947dee21780cf392a6b873261b8953d8b04ca0962db21b6b81`. A successor-aware check and equivalence remain unresolved. |
| `stage7-artifact` | The first test encounters successor migration chain `0015_stage9_trip_workspace_writes.cjs`, expected `0012_stage7_portal_trip_access.cjs`, before the expected payload-manifest rejection. Four later chained commands did not execute. Stage 10 exact-artifact equivalence remains unproven. |
| `stage7-migrator` | Migration head `0016_stage9_staff_invitations.cjs`, expected `0013_stage7_runtime_acceptance_cleanup.cjs`; successor-aware chain and package test required. |
| `stage8-artifact` | 14/16 tests passed; two require an extracted artifact and received none. Provide the bound package and rerun; partial success is not gate success. |
| `stage9-contract` | CLI reports `DEPLOYMENT_CONTRACT_FAILED` without detailed cause. The separate artifact suite shows a branch assertion in its contract test, but does not establish the precise CLI failure cause. |
| `stage9-artifact` | 45/49 Node tests passed; the scanner returned FAIL, two snapshot tests and one deployment-contract test expected `phase-1/stage-9`, got `phase-1/stage-10`. The chained browser-host test did not run. Investigate scanner failure rather than dismissing it as branch-only. |

## Intended Stage 10 replacement coverage, not yet qualified

Candidate dispatch always verifies frozen inputs, build claim/receipt and extracted artifact first, and returns scope `LOCAL_CHECK_ONLY_NOT_CANONICAL_CI_OR_INDEPENDENT_AUTHORITY`. Listed tests are exact source test targets, not claims they ran in this attempt.

| # | Label | Intended relationship and actual status |
|---:|---|---|
| 51 | `stage10-baseline` | Dispatchable: `predecessor-baseline-adapter.mjs` checks accepted Stage 9 commit/archive and predecessor bytes, not historical CI. It does not replace all Stage 7 branch-bound assertions. Focused test `tooling/ci/stage-10/test-pipeline.mjs`. |
| 52 | `stage10-clean-install` | Intended successor to `stage9-clean-install`; no dispatch. Pinned offline installation and dependency proof remain open. |
| 53 | `stage10-build-receipt` | Dispatchable receipt/claim/package-check verification, related to Stage 9 `build` but does not itself build. Focused test `tooling/ci/stage-10/test-stage10-candidate-gate.mjs`. Qualified build remains required. |
| 54 | `stage10-exact-artifact` | Intended successor to `stage9-extracted-artifact-integrity`; dispatch calls `qualifyExtractedArtifact`. Focused tests `tooling/ci/stage-10/test-stage10-candidate-gate.mjs`, `tooling/ci/stage-10/test-production-package.mjs`, `tooling/ci/stage-10/test-migrator-package.mjs`. Runtime and equivalence remain open. |
| 55 | `stage10-postgres-browser` | Intended successor to `stage9-postgresql-browser-acceptance`; dispatch runs `tooling/database/run-stage-10-postgres-disposable.mjs` and validates binding, cleanup, and 4-file/95-test log anchors. Focused tests `tooling/ci/stage-10/test-postgres-browser-adapter.mjs`, `tooling/ci/stage-10/test-stage10-runtime-api-postgres.mjs`, `tooling/ci/stage-10/test-stage10-runtime-cumulative-postgres.mjs`. No actual acceptance pass is asserted. |
| 56 | `stage10-source-security` | Intended successor to `stage9-source-security-scan`; no dispatch. Full-scope execution and independent review unresolved. Focused test `tooling/ci/stage-10/test-source-scan-adapter.mjs`. |
| 57 | `stage10-operational-preflight` | New obligation; no dispatch. Candidate-bound preflight and independent receipt authority unresolved. |
| 58 | `stage10-signature-activation` | New obligation; no dispatch. Custody, recovery and least-privilege host qualification unresolved. |
| 59 | `stage10-retention-privacy` | New obligation; no dispatch. Independent privacy/receipt review and publication unresolved. |
| 60 | `stage10-source-final` | Dispatchable final source/binary screen, related to `stage9-source-security-scan`; calls `screenFinalSource`. Focused tests `tooling/ci/stage-10/test-source-final-gate.mjs`, `tooling/ci/stage-10/test-source-scan-adapter.mjs`, `tooling/ci/stage-10/test-binary-coverage-adapter.mjs`. Scanner results are not independent privacy review. |

## Remaining coverage obligations

Stage 9 `build` has no directly dispatched Stage 10 inherited label. `stage10-build-receipt` checks a previous consumed build rather than performing one. Demonstrate the reviewed single-build recipe and binding separately. Stage 9 clean install, extracted-artifact integrity and source-security scan correspond only to the intended pending rows above. Stage 10 also adds dependency-universe and several Stage 6/7 checks beyond Stage 9's separate labels.

Do not collapse `stage6-postgres`, `stage7-postgres`, `stage8-postgres`, and `stage9-postgres-browser` into the Stage 10 adapter on the strength of code existing: prove assertion-level coverage and exact extracted-artifact binding, execute required lanes on disposable resources, and retain actual logs and cleanup evidence. Preserve immutable Stage 1–9 files. For incompatible checks, enumerate assertions preserved or superseded, supply successor-bound positive and adversarial tests, execute exact reviewed gates on the same candidate and obtain independent review. Branch mismatch, missing arguments, checksum mismatch and scanner findings are not waivers. This mapping did not run tests; the diagnostic attempt is not a complete 60-gate execution.

## Inherited labels: actual script dispatch and exact commands

| # | Stage 10 label | Stage 9 label / relationship | Package script → exact command | Attempt |
|---:|---|---|---|---|
| 1 | `pins` | `stage9-pinned-toolchain` | `verify:pins` → `node tooling/ci/verify-pins.mjs` | not run |
| 2 | `protected-pre` | `protected-baseline:pre` | `protected-baseline:check` → `node tooling/ci/stage-9-successor-baseline.mjs` | PASS |
| 3 | `stage5-coherence-pre` | `stage5-candidate-coherence:pre` | `stage5:candidate-coherence:verify` → `node tooling/ci/verify-stage-5-candidate-coherence.mjs` | PASS |
| 4 | `stage6-baseline` | `additional inherited check` | `stage6:successor-baseline:verify` → `node tooling/ci/verify-stage-6-successor-baseline.mjs` | not run |
| 5 | `stage7-baseline` | `additional inherited check` | `stage7:successor-baseline:verify` → `node tooling/ci/verify-stage-7-successor-baseline.mjs` | FAIL |
| 6 | `stage9-baseline-tests` | `stage9-successor-baseline-tests` | `test:stage9:successor-baseline` → `node --test tooling/ci/test-stage9-successor-baseline.mjs` | PASS |
| 7 | `migrations` | `stage9-migration-checksums` | `db:migrations:verify` → `tsx tooling/database/verify-migration-checksums.ts` | not run |
| 8 | `auth-schema` | `auth:schema:verify` | `auth:schema:verify` → `tsx tooling/auth/verify-better-auth-schema-drift.ts` | not run |
| 9 | `lifecycle` | `test:lifecycle-policy` | `test:lifecycle-policy` → `node tooling/ci/test-lifecycle-policy.mjs` | not run |
| 10 | `format` | `format:check` | `format:check` → `node tooling/ci/format-stage-2.mjs --check && node tooling/ci/stage-9-successor-baseline.mjs` | not run |
| 11 | `lint` | `lint` | `lint` → `eslint apps packages tooling tests migrations *.ts *.mjs` | not run |
| 12 | `typecheck` | `typecheck` | `typecheck` → `tsc -p tooling/ci/tsconfig.typecheck.json --noEmit && tsc -p tooling/ci/tsconfig.owned-declarations.json --noEmit` | not run |
| 13 | `dependency-universe` | `additional inherited check` | `verify:dependency-universe` → `node tooling/architecture/verify-dependency-universe.mjs` | not run |
| 14 | `architecture` | `architecture:check` | `architecture:check` → `node tooling/architecture/check.mjs` | not run |
| 15 | `unit` | `test:unit` | `test:unit` → `vitest run --config tooling/testing/vitest.config.ts` | not run |
| 16 | `config-schema` | `config:schema:check` | `config:schema:check` → `tsx tooling/ci/write-instance-manifest-schema.ts --check` | not run |
| 17 | `stage3-corrections` | `stage3:corrections:verify` | `stage3:corrections:verify` → `tsx tooling/database/verify-stage-3-corrections.ts` | not run |
| 18 | `freeze-inputs` | `test:freeze-inputs` | `test:freeze-inputs` → `node tooling/ci/stage-9-successor-baseline.mjs --predecessor-freeze-inputs && node tooling/database/verify-stage-3-evidence-index.mjs` | not run |
| 19 | `security-scanner-tests` | `test:security-scanner` | `test:security-scanner` → `node tooling/ci/test-sensitive-data-scanner.mjs` | not run |
| 20 | `stage6-baseline-tests` | `test:stage6-successor-baseline` | `test:stage6:successor-baseline` → `node tooling/ci/test-stage-6-successor-baseline.mjs` | PASS |
| 21 | `stage6-migrator` | `additional inherited check` | `test:stage6:migrator-package` → `node tooling/ci/test-stage6-migrator-package.mjs` | not run |
| 22 | `stage6-contract` | `additional inherited check` | `stage6:deployment-contract:verify` → `node tooling/deployment/verify-stage6-deployment-contract.mjs` | FAIL |
| 23 | `stage6-contract-tests` | `test:stage6-deployment-contract` | `test:stage6:deployment-contract` → `node tooling/deployment/test-stage6-deployment-contract.mjs` | PASS |
| 24 | `stage6-bootstrap` | `test:stage6-migrator-bootstrap` | `test:stage6:migrator-bootstrap` → `node tooling/deployment/test-stage6-migrator-bootstrap.mjs` | PASS |
| 25 | `stage7-predecessor` | `additional inherited check` | `stage7:predecessor:verify` → `node tooling/ci/verify-stage-7-predecessor.mjs` | FAIL |
| 26 | `stage7-source-scope` | `additional inherited check` | `stage7:source-scope:verify` → `node tooling/ci/stage-7/verify-source-scope.mjs` | FAIL |
| 27 | `stage7-baseline-tests` | `additional inherited check` | `test:stage7:successor-baseline` → `node tooling/ci/test-stage-7-successor-baseline.mjs` | FAIL |
| 28 | `stage7-source-tests` | `additional inherited check` | `test:stage7:source-scope` → `node tooling/ci/stage-7/test-source-scope.mjs` | PASS |
| 29 | `stage7-security-tests` | `additional inherited check` | `test:stage7:predecessor-security-scan` → `node tooling/ci/stage-7/test-predecessor-security-scan.mjs` | PASS |
| 30 | `stage7-contract` | `additional inherited check` | `stage7:deployment-contract:verify` → `node tooling/ci/stage-7/verify-deployment-contract.mjs` | FAIL |
| 31 | `stage7-contract-tests` | `additional inherited check` | `test:stage7:deployment-contract` → `node tooling/ci/stage-7/test-deployment-contract.mjs` | FAIL |
| 32 | `stage7-artifact` | `additional inherited check` | `test:stage7:artifact` → `node tooling/ci/stage-7/test-artifact.mjs && node tooling/ci/stage-7/test-build-artifact.mjs && node tooling/ci/stage-7/test-packaged-verifier.mjs && node tooling/ci/stage-7/test-runtime-acceptance-runner.mjs && node tooling/ci/stage-7/test-operator-installer.mjs` | FAIL |
| 33 | `stage7-migrator` | `additional inherited check` | `test:stage7:migrator-package` → `node tooling/ci/stage-7/test-migrator-package.mjs` | FAIL |
| 34 | `stage7-ci-tests` | `additional inherited check` | `test:stage7:canonical-ci` → `node tooling/ci/stage-7/test-canonical-ci.mjs` | PASS |
| 35 | `stage7-predecessor-regression` | `stage7-predecessor-regression` | `test:stage8:stage7-predecessor` → `node tooling/ci/stage-8/predecessor-regression.mjs` | PASS |
| 36 | `stage8-systemd` | `stage8-systemd-contract` | `test:stage8:systemd-contract` → `node --test tooling/ci/stage-8/test-systemd-contract.mjs` | PASS |
| 37 | `stage8-artifact` | `stage8-artifact-tests` | `test:stage8:artifact` → `node --test tooling/ci/stage-8/test-artifact.mjs tooling/ci/stage-8/test-source-security-scan.mjs tooling/ci/stage-8/test-predecessor-regression.mjs tooling/ci/stage-8/test-canonical-ci.mjs` | FAIL |
| 38 | `stage9-contract` | `stage9-deployment-contract` | `stage9:deployment-contract:verify` → `node tooling/deployment/verify-stage9-deployment-contract.mjs` | FAIL |
| 39 | `stage9-artifact` | `stage9-artifact-tests` | `test:stage9:artifact` → `node --test tooling/ci/stage-9/test-artifact.mjs tooling/ci/stage-9/test-build-artifact.mjs tooling/ci/stage-9/test-source-snapshot.mjs tooling/ci/stage-9/test-source-security-scan.mjs tooling/ci/stage-9/test-static-runtime-acceptance.mjs tooling/ci/stage-9/test-postgres-regression-adapter.mjs tooling/ci/stage-9/test-canonical-ci.mjs tooling/deployment/test-stage9-deployment-contract.mjs tooling/deployment/test-stage9-development-apply.mjs && node --import tsx --test tooling/ci/stage-9/test-browser-host.mjs` | FAIL |
| 40 | `stage6-postgres` | `additional inherited check` | `test:stage6:postgres` → `node tooling/database/run-stage-6-disposable.mjs` | not run |
| 41 | `stage7-postgres` | `additional inherited check` | `test:stage7:postgres` → `node tooling/database/run-stage-7-disposable.mjs` | not run |
| 42 | `stage8-postgres` | `additional inherited check` | `test:stage8:postgres` → `node tooling/database/run-stage-8-disposable.mjs` | not run |
| 43 | `stage9-postgres-browser` | `stage9-postgresql-browser-acceptance` | `test:stage9:postgres` → `node tooling/database/run-stage-9-disposable.mjs` | not run |
| 44 | `rejected-tests` | `test:rejected-technologies` | `test:rejected-technologies` → `node tooling/ci/test-rejected-technologies.mjs` | not run |
| 45 | `rejected` | `verify:rejected-technologies` | `verify:rejected-technologies` → `node tooling/ci/verify-rejected-technologies.mjs` | not run |
| 46 | `stage4-evidence` | `evidence:stage4:verify` | `evidence:stage4:verify` → `node tooling/database/verify-stage-4-evidence-index.mjs` | PASS |
| 47 | `smoke` | `test:smoke` | `test:smoke` → `node tooling/testing/smoke-built.mjs` | not run |
| 48 | `browser-bundle-security` | `security:scan:bundles` | `security:scan:bundles` → `node tooling/ci/test-browser-bundle-scan.mjs && node tooling/ci/scan-browser-bundles.mjs` | not run |
| 49 | `stage5-coherence-post` | `stage5-candidate-coherence:post` | `stage5:candidate-coherence:verify` → `node tooling/ci/verify-stage-5-candidate-coherence.mjs` | not run |
| 50 | `protected-post` | `protected-baseline:post` | `protected-baseline:check` → `node tooling/ci/stage-9-successor-baseline.mjs` | not run |
