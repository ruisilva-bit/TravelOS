# Stage 10 latest successor dispatch — independent technical review

**Verdict: NO_GO for technical dispatch completeness/integrity of the reviewed route set.** This is a scoped code/evidence verdict only. It is not privacy/custody acceptance, canonical-CI or build readiness, operational authorization, installation/activation authority, or Stage 10 GO.

## Scope and basis

Reviewed current Stage 10 candidate and inherited dispatch, baseline and clean-install adapters, six successor regression implementations, their focused tests, candidate-gate declarations/executor, the accepted product/domain documents and applicable migration/build/backup ADRs. Read the current inherited coverage matrix, the Stage 10 pipeline README, the earlier three-route review, and retained local result summaries. The reported historical artifact totals below are prior local evidence, not runs performed by this reviewer.

### Findings

- **MEDIUM — candidate binding is not uniformly rechecked after candidate-gate work.** `stage10-candidate-gate.mjs:68–97,184–191` verifies inputs, build claim/receipt, extracted archive and artifact before dispatch, but `stage10-baseline`, `stage10-build-receipt`, and `stage10-exact-artifact` return without a final `verifyInputs`/artifact-binding comparison. The clean-install and PostgreSQL/browser branches do recheck (`:113–117,171–182`); source screening also has its own `captureSource` equality at `source-final-gate.mjs:136–161`. The unguarded branches can therefore report a scoped PASS if an input changes during verification. Add one common post-operation input-and-artifact verification for every candidate-gate route, with a mutation-during-operation inverse test. The canonical sequence has a separate `verify` callback, but that does not repair the directly dispatched local candidate-gate contract.

- **MEDIUM — compatibility remains incomplete beyond the measured twelve-route batch.** `gates.mjs:4–71,73–93` still marks inherited checks as requiring Stage 10 compatibility qualification and only some labels have candidate adapters. In particular `stage6-baseline`, `stage6-baseline-tests`, `stage6-migrator`, and `stage6-postgres`, `stage7-postgres`, `stage8-postgres`, `stage9-postgres-browser` remain outside the implemented successor routes; Stage 6 bootstrap/contract test labels also still use direct inherited scripts. The 12 measured routes in the coverage document are not evidence that all 60 declarations have been covered. Keep these explicitly unqualified until each has a reviewed assertion mapping, correct Stage 10 artifact/input binding, and execution/cleanup evidence.

### Supported observations

- Historical regression replacements inspected here preserve their accepted historical sources by exact-byte checks and use constrained adaptations: Stage 6 checks unchanged verifier/test bytes and exercises the historical fixture suite separately from the Stage 10 deployment contract (`stage6-contract-regression.mjs:24–53,54–95`); Stage 7 contract binds the 16-migration Stage 9 manifest and accepted Stage 7 prefix, checks the original 359-line test bytes, and anchors its transformations (`stage7-contract-regression.mjs:21–33,55–105`); Stage 9 contract adapts the one branch assertion and import/module-location metadata (`stage9-contract-regression.mjs:10–31,35–61`). Stage 7 artifact tests run five exact accepted historical files in an isolated exact Stage 7 checkout (`stage7-artifact-regression.mjs:12–19,28–70,100–147`); Stage 8 checks the accepted historical sources and replaces two metadata/layout assertions while retaining the 16-case total (`stage8-artifact-regression.mjs:44–72,82–117`); Stage 9 checks historical source bytes and transforms the branch/layout and expanded source-screen assertion, then requires 49 + 2 browser-host cases and zero skips (`stage9-artifact-regression.mjs:54–63,68–120,148–193`). These source properties do not themselves qualify current candidate execution.
- Canonical CI remains fail-closed before a claim while any gate is unqualified or integration pending (`run-canonical-ci.mjs:14–20`). Dispatch availability does not promote gate status. The reviewed artifacts do not show a Stage 10 canonical-CI pass, CI/build claim consumption, or operational readiness.
- Prior retained summaries read (not personally rerun): baseline-inverse summary reports 10/10 with zero skips, Stage 6 contract summary reports eight historical assertions plus six negative fixtures PASS, and clean-install summary reports a 2,847-file fresh source copy with offline/frozen install and scripts disabled. Coverage text reports mutable artifact regression results (Stage 7 67, Stage 8 16, Stage 9 49 + 2 browser-host) and explicitly labels them noncanonical. These are implementation evidence only; they neither cover the unmeasured labels above nor qualify a later candidate.
- Cleanup paths are bounded/fail-closed at the dispatch layer: child output and duration limits are enforced and timeout/output-limit/cleanup anomalies become FAIL (`gate-process.mjs:93–116,129–159,173–226`); artifact regression temporary directories are removed in `finally` and checked absent (Stage 8 `:121–135`, Stage 9 `:201–217`); clean-install scratch removal is in `finally` (`clean-install.mjs:83–85`). This does not substitute for a real candidate-bound PostgreSQL/browser lane or the still-pending Stage 10 operations/privacy requirements.

## Tests personally executed

Pinned runtime: `/home/hermes/.local/share/travelos-stage5-toolchain/node_modules/node/bin/node`, v24.19.0.

- **PASS:** `node --test tooling/ci/stage-10/test-stage10-candidate-gate.mjs tooling/ci/stage-10/test-stage10-canonical-dispatch.mjs tooling/ci/stage-10/test-gate-process.mjs tooling/ci/stage-10/test-inherited-compatibility-adapter.mjs` — 7 passed, 0 failed/cancelled/skipped.
- **Interrupted/unqualified attempt and deviation:** an initial oversized `node --test` selection also included clean-install, baseline-inverse, Stage 6/7/8/9 contract/artifact regression test files. The outer command timed out (exit 124, 300 s): Node reported 11 pass, 0 fail, 9 cancelled, 0 skipped; baseline inverses passed 10/10, the clean-install and Stage 6/Stage 7 artifact test files did not complete, and remaining tests were cancelled. This was not a verified historical-suite result. I inadvertently included test harnesses that can invoke source-bound installation and historical artifact work despite the instruction not to; the Stage 7 artifact harness started but had no completed/verified total before cancellation. No standalone 67- or 49-case suite was run or reported passing, and I stopped all such reruns. This is an execution deviation, not a pass.

## Explicitly out of scope / open

No Stage 10 canonical CI, definitive build claim, CT/host operation, migration, backup, signing-key action, privacy acceptance or Stage 11 action is authorized or inferred here. The remaining historical Stage 6 baseline/migrator/PostgreSQL and other unqualified inherited labels above require their own coverage; do not infer all-60 coverage from the twelve measured compatibility routes.

## SHA-256 of reviewed files

Hashes cover the bytes read/reviewed for this verdict; paths are repository-relative except retained evidence paths.

| File | SHA-256 |
|---|---|
| `AGENTS.md` | `224d6f1da3c389b97002fadc9b9ee1c60f14c8c3d20df6334f91e0a34df6a340` |
| `IDEA.md` | `2c7be6b7154835a1301118670a33f2c8b9d9f8a0f178b9565515ab2484a2f524` |
| `docs/PRODUCT_BLUEPRINT.md` | `e7758291d53f0d5c0ec629664d83cbc062147d64a35cb64b6784939cf0b8e294` |
| `docs/DOMAIN_MODEL.md` | `d6783437b44a9ba4dd056143b08daeb64df4ed2c7718a691d3c1b2963de2ef54` |
| `docs/adr/ADR-012-persistence-boundary-and-fleet-safe-migrations.md` | `298dc1625a2d054490250db047131411a9e2ad34acac020ee521017dd72d93e7` |
| `docs/adr/ADR-013-monorepo-web-runtime-and-build-orchestration.md` | `d98881a785973d0f89da8c0ec372899932c310bf0acdad34d61e7fcb6538ce69` |
| `docs/adr/ADR-014-durable-privacy-erasure-across-backups.md` | `b0effe71de4f52570245d9e789ef018912a00d2bf1ba09aa16110fb75e3175c7` |
| `docs/implementation/M1_STAGE_10_INHERITED_GATE_COVERAGE.md` | `7ad733127c565a2ff5db5c19dfc52e0ad8bb037910c6b14dac42543b65cc56fc` |
| `docs/implementation/M1_STAGE_10_DEVELOPMENT_SIGNING_DECISION.md` | `00375bfc355a8b6d1ee9c0e9370cd466242074693a0809958abb7da3381975a5` |
| `docs/reviews/phase-1-m1/stage-10/INHERITED_SUCCESSOR_ROUTES_REVIEW.md` | `5de799ba50ef7d097275ab4ff7b310de4db17728392427a79b503494bf984e39` |
| `tooling/ci/stage-10/README.md` | `9f32171054d92f444dad07d26051e1b5f8df293f8e0d1e7a14e81d921eb6955d` |
| `tooling/ci/stage-10/gates.mjs` | `eb382b7b361ecefc92ac987ffc2d75acf86fe7d2ff12e89cf07b35f57ea769c4` |
| `tooling/ci/stage-10/inherited-compatibility-adapter.mjs` | `55b33f512f83dd421fa7f6f7bc83c782d81f0b35e920cec9b9c5a1294b5a6122` |
| `tooling/ci/stage-10/stage10-candidate-gate.mjs` | `5a1e88f077ad7e958a1b1cbb6c96f034e92fcf4aeb7fdde7ec6b3a203166535c` |
| `tooling/ci/stage-10/baseline-inverse-regression.mjs` | `3a04730acd195c91e5d5b95fa24439577cc99d105ab560a3180b5038c96c75e3` |
| `tooling/ci/stage-10/successor-baseline.mjs` | `679b159da30d2ed64ac8f3570989babdcc78f06428e5c587d30403af186e1d27` |
| `tooling/ci/stage-10/clean-install.mjs` | `d6bc09e8f4b2757be5577a0682d551e3d71a5e95f9d704a0dcd22144814288fe` |
| `tooling/ci/stage-10/gate-process.mjs` | `9af534e880fb71bb30abc33a55345bf3b5fd12e460c317677a94d9e453216f56` |
| `tooling/ci/stage-10/run-canonical-ci.mjs` | `e25bf81493aa4f35ee9ae643a899d6264f838486f913466882874cd4928f371c` |
| `tooling/ci/stage-10/candidate.mjs` | `598cdeae3602b31974a03b1cadfc90842fe6eae9f0b0bcce591a76e689081a6a` |
| `tooling/ci/stage-10/qualify-artifact.mjs` | `c8c9990430226bc2013fe69abdf612b055ad3aa1b2db8d0c729aafac0c2ac3c1` |
| `tooling/ci/stage-10/artifact.mjs` | `dfc4590785d0c70d36fad0b5dd4cfac9274bc7dba9947a8d28c3928c4b289413` |
| `tooling/ci/stage-10/canonical-sequence.mjs` | `3a8a465d376dee8df2c7f7bb64e20626fe28149cfba4cecb45024b4b3c4603cb` |
| `tooling/ci/stage-10/stage6-contract-regression.mjs` | `ad81379aef94c0e00105a0539bce4437d920469ba1ae259b4b86c8ca059f936c` |
| `tooling/ci/stage-10/stage7-contract-regression.mjs` | `fa4aa18d5419c69a63429063887426a6bf65b729b21ff205ab9c45a470fcc2d1` |
| `tooling/ci/stage-10/stage9-contract-regression.mjs` | `c9de4dcefa883960464eebc24964d45066480b8b171321c1d5ad8ef5e211f06c` |
| `tooling/ci/stage-10/stage7-artifact-regression.mjs` | `845920cce60398eb060c019e4148258b3842c8ecd855da774c0bf0bb403c806a` |
| `tooling/ci/stage-10/stage8-artifact-regression.mjs` | `c1c5c214ccd08e2eebb5fe235b640f8a48002f96da368a50ca670606f823ff84` |
| `tooling/ci/stage-10/stage9-artifact-regression.mjs` | `eaeb80b9692a3f67dc5a7166d461216f204f28fd34347d93285d7b229ae121f6` |
| `tooling/ci/stage-10/predecessor-baseline-adapter.mjs` | `4007fbb10b638021d3335b992171e1eceab76ab2b6fa343901f764e644d2e832` |
| `tooling/ci/stage-10/source-final-gate.mjs` | `25969a6e8b2355eff22539b0b2c99a5e8a8e80bcd880f5864bc694618c50666e` |
| `tooling/ci/stage-10/test-stage10-candidate-gate.mjs` | `2505ef5d27097f4b59ebe7ca2bd05a163d7d568c5b885ff09e148cca2f07ba18` |
| `tooling/ci/stage-10/test-stage10-canonical-dispatch.mjs` | `c8795faef550b525d4ed5ab5eac353ad4090af4751b68b3c24f9a764341ed726` |
| `tooling/ci/stage-10/test-gate-process.mjs` | `89bb82d4e54785ac7da550af89c52f32d8fc6dfd5f45f2d93f6cb17a387b375c` |
| `tooling/ci/stage-10/test-clean-install.mjs` | `05c1bfb2f195766aef9f989963dcc26322fada93f109fae23ace55bc25414a2e` |
| `tooling/ci/stage-10/test-successor-baseline.mjs` | `8def380170441d0cd2b619f16ecac76d31da3f35cfebf40ea9ae1647841beb21` |
| `tooling/ci/stage-10/test-predecessor-baseline-inverse.mjs` | `ebdc8129a5d458637dcf57ef0af7916c1fae1968ba25ff878b9da068dfb169ae` |
| `tooling/ci/stage-10/test-inherited-compatibility-adapter.mjs` | `abeb90338df615a6563441e5397db9dd69e68a9b34d2cd14c8226e1aab569a1f` |
| `tooling/ci/stage-10/test-stage6-contract-regression.mjs` | `5ffcb6277ffed3ee42f7121fc0de5cdd57e2d12fc19bfce7b9d3b52d17d891c7` |
| `tooling/ci/stage-10/test-stage7-contract-regression.mjs` | `15e3c2ca8e2c1e9e9ac46f216f4005f4afb2c0d810d433deac8a58c0a0e6255c` |
| `tooling/ci/stage-10/test-stage9-contract-regression.mjs` | `cf1295129c97f2490770647931e363518dbaf80da188a4147b3d9a36382b2e8b` |
| `tooling/ci/stage-10/test-stage7-artifact-regression.mjs` | `53f196253dfb55352eada16bc6ac58e153474326bf0a809cb07b26aafdaea08f` |
| `tooling/ci/stage-10/test-stage8-artifact-regression.mjs` | `52f3433f2787050d512b7faa3b7615e4a095ee990087c6cfb95626a9f5179d73` |
| `tooling/ci/stage-10/test-stage9-artifact-regression.mjs` | `7ac5ddd804451ef586989d49b0299bc6c7301964163056440d6efe722ece4447` |
| `.hermes/state/stage10-baseline-inverses-rLiSKv/summary.json` | `68b0199678e407a9e798086c7ad63907e5b42d07a9058a53d123faae5d4585ea` |
| `.hermes/state/stage10-stage6-contract-YkuK2g/summary.json` | `59da96c46f2084123135df42fc7fbb084f91ed52db17e7c06966396082502cc7` |
| `.hermes/state/stage10-clean-install-4x9RSA/summary.json` | `2912056916795a9b8ad35adfcbfa55d076eb6e714572a0c4435ff93ca3b8d8a7` |
| `.hermes/state/stage10-compatibility-qualification-Sd8eGF/results.json` | `6693968eb4d34ce8024955c226b50c119a5b6a15c03642edc6c9e5df3da56a6f` |
| `.hermes/state/stage10-latest-mutable-package.json` | `ce88e574fba030b94f3e325b7d2d2a1587f972646a50447d1ec27ef0aa95f6f8` |
