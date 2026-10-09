# TravelOS Phase 1 M1 — Stage 5 FINAL-11 candidate freeze

- **Record type:** retrospective, archive-scoped freeze of the preserved consumed-candidate snapshot; it is not a validated/GO source freeze.
- **Candidate:** FINAL-11; rejected after the sole CI invocation failed at `format:check`.
- **Source:** `/home/hermes/.hermes/cache/scratch/travelos-final11-consumed-snapshot.tar`, content SHA-256 `7da6175c438754c1eb296c70e041aed3f1dcd254801fb8405c7f33b15cbd2912`.
- **Snapshot base commit:** `27184b598ae2be2eaf35616d4a9b6c2e623ccd42`.
- **Snapshot members:** `tracked-diff-from-head.patch`, `snapshot-manifest.json`, and 37 manifest-pinned untracked files; every untracked byte count and SHA-256 was reverified against the archived bytes.
- **Archive member rows:** 39; all unique and matched.
- **Deterministic archive-member aggregate:** `f17bbaaf15075cc2a78555fb1bd4c34673f4efaac0462ca826425e065eef788d`.
- **Aggregate serialization:** newline-terminated `archive-member-path<TAB>bytes<TAB>sha256` records sorted by path.
- **Scope limitation:** this manifest freezes the preserved snapshot archive members only. It does not claim that FINAL-11 passed CI, received a complete candidate freeze at the time, underwent independent GO review, or closed Stage 5.
- **Historical CI evidence:** `docs/evidence/phase-1-m1/stage-5-final-11/ci-verify.log` and `ci-verify-execution.json` remain the authoritative, unchanged failed run.
- **Stage 6 actions:** `0`.

| # | Archive member | Bytes | SHA-256 |
|---:|---|---:|---|
| 1 | `snapshot-manifest.json` | 7475 | `df3144bd8b3ec240523bed95f34f80089bebe7f23a19df6946011decefcce808` |
| 2 | `tracked-diff-from-head.patch` | 116604 | `fbcc4b5485ed0dec0710c2f8e5947120afaed8245be5115399ae06b372ee6c5e` |
| 3 | `untracked/.hermes/state/stage-4-resume.md` | 4553 | `7f527b1fcde6671cc04afba085dbdfad953153929cc10f06c9177651d607c2dc` |
| 4 | `untracked/.hermes/state/stage-5-resume.md` | 8375 | `d12e7f60d9f97684884f0607e8a9030d7af6b353f6a0e6cd270316d4ecc60527` |
| 5 | `untracked/.hermes/state/stage5-ci-verify-invocation.json` | 717 | `5ed13bc5f04656b93632266bf31a4a040ad6fe70d2986534ea082b29c6dba6c0` |
| 6 | `untracked/.hermes/state/stage5-final10-ci-verify-invocation.json` | 810 | `ca2a2b7e9c9615c90c0bf87a9b34234ec31f228214d2bc892369e2a26ab001e8` |
| 7 | `untracked/.hermes/state/stage5-final11-ci-verify-invocation.json` | 9393 | `15a3d5fac1a61e1b354c88a53ca870a0a22d898a06c398622f908738bdf2f473` |
| 8 | `untracked/.hermes/state/stage5-final11-readiness-preflight.json` | 1858 | `9a3206313b0e21b2bec90b97e52dde30b2abd149c6cee54f7da687a732ff35b6` |
| 9 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/EVIDENCE_INDEX.json` | 6055 | `620c4019206ffa97e8456cdb8e6fb3689d27ab1ae86720db5ccabb7e7269b46a` |
| 10 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/auth-bridge-tests.json` | 501 | `2295db1629d20f4b19b25455dd36e4c09cbc4bf3baed70130cc3b4c43501663e` |
| 11 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/baseline-generation.json` | 2634 | `547687fc6a9935b2ab522b78d119b71062fc444ee9cb8e3aa0e8653ee01618e2` |
| 12 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/ci-verify-execution.json` | 612 | `cfca7be8cb139bd32e4b43e6f7fb847b01b2042a217cec686b3234906a6d2cce` |
| 13 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/disposable-cleanup.json` | 311 | `fcb09fce5b5e324eae0be6544eb0cf5cb88c60afeab4eb79a8e877bf01702efe` |
| 14 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/final10-ci-verify-execution.json` | 677 | `09ee0779646e4c300c4408f1d527580d78f13e79220f6319f27c979aa9e5591b` |
| 15 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/final10-correction-matrix.json` | 58400 | `eeaba1a4b4090c3245d2934cac9036dc5b7f380a2030bfd2791ab14d93c7e778` |
| 16 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/final10-pre-ci-evidence-index.json` | 3990 | `885cc4946296eb79c056cf4e1b2ecb05ce2a948c8be139519af2f56fb4bf5b27` |
| 17 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/final10-rejected-tag.json` | 1944 | `19fb507b526f810b2e2a4501466745e4467cb563b66b90538ead552abace57b8` |
| 18 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/final10-rejection-record.md` | 3442 | `9c2c3c9e9fdd5c46cef5f04099bf804ec38f52c4133279f2a8ed26f188b659f8` |
| 19 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/final10-security-extension-baseline.json` | 3286 | `a8769309d7708174419e94407d2d5226c6bd72b982856a831f3e7df5dbb27ceb` |
| 20 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/final8-independent-review.json` | 38123 | `d343aae5ea315cb524b5e0a4afb3f4b7b452827543def934f3c4825011d316d3` |
| 21 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/final9-independent-review.md` | 5821 | `ebdbc4327e0f02f5b9efa7a730bd5e3997d9668559b5d59624806eaf2bb7cfe3` |
| 22 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/final9-rejected-tag.json` | 955 | `c5e515b86dcc5817ec827ef5f903af7a2cfb177ee0edc7aae1f977201fa8d450` |
| 23 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/focused-test-execution.json` | 1409 | `d98c8d3edf1521ced9fff98666a032875ab3ffb5d1671d55728b263c37c753e9` |
| 24 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/integration-test-execution.json` | 457 | `2a396f1c3745caf13fd949716c90fb87a77cc92d7951d9e648db5e61506c4bdb` |
| 25 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/migration-checksums.json` | 2173 | `fd2484f65e9cbe75b0732e606284dfeaccdcb858cc74975edcc8c8f99935d331` |
| 26 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/package-build.json` | 662 | `788aba21890c84cc98f50150da6cc154bf914bc09510c9b1a1b173e975118e05` |
| 27 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/postgresql-package-provenance.json` | 2177 | `e1a3c22cd25dd8ce9c2a109ccdff6fafacc6ef8eee968b2dcdc02f9511850cf0` |
| 28 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/postgresql-runtime.json` | 292 | `690483dc28f7f67dac2545f08e60b0793ee5e7b56db9ae397bd91f5947dc7aea` |
| 29 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/qualification-summary.json` | 4426 | `7dec528e9906df896da964b42faa0377f2ce365155e98caffe84b9c2d5ba54bb` |
| 30 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/readiness-preflight.json` | 8572 | `165eeb81288aa4479c63b3f2c94330f8273ff0016993a8d70d78f4e9914dc605` |
| 31 | `untracked/docs/evidence/phase-1-m1/stage-5-final-11/security-extension-baseline.json` | 2597 | `e8f601902e59cf6392d0a7cd6b017ac0e4bd0526a293575407801df0abce5f00` |
| 32 | `untracked/docs/reviews/phase-1-m1/STAGE_5_FINAL_11_CORRECTION_MATRIX.json` | 65507 | `8a3faa17cb60d31765391db8135928632cd70de74a889428ae549125d0c0b175` |
| 33 | `untracked/tooling/ci/generate-stage-5-final11-security-extension-baseline.mjs` | 23658 | `4896cd12bc133321a1dccdf71b16a89f02773e1b01f8dab84bf89dbb817c4beb` |
| 34 | `untracked/tooling/ci/prepare-stage-5-final11-evidence.mjs` | 17112 | `6892de7a47d203be637c103a6e0c3c4348c3685499aea39ff977f5e978cfa89b` |
| 35 | `untracked/tooling/ci/run-stage-5-final11-authoritative-ci.mjs` | 8559 | `0025fd09d1647c9312a8b467fe6f97400919c74d14117d385a3eb81e8d058de6` |
| 36 | `untracked/tooling/ci/stage-5-final11-finding-lineage.mjs` | 26292 | `e580c5f123f854c4ca0efe4cfe0c6a384187299a7e6be0f5020050a7be102dd6` |
| 37 | `untracked/tooling/ci/stage-5-final11-readiness-preflight.mjs` | 19902 | `f96b44211028c7ed86d6e0b4950ccf3bbc15dad70d25d7e09cbcd2aea62b90c5` |
| 38 | `untracked/tooling/ci/test-stage-5-final11-finding-lineage.mjs` | 4979 | `0977ee53b733f3307fc2c12a8c9261c98166bb31f240d825e1787ed9c93df973` |
| 39 | `untracked/tooling/ci/test-stage-5-final11-security-extension-baseline.mjs` | 5061 | `f1b464bd668ed8e1f35e2a8307906c30494f35d87d422d1ad4858bb3a0ad96b0` |
