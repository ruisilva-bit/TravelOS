# TravelOS Phase 1 M1 — Stage 5 FINAL-11 rejection validation

- **Record type:** retrospective lineage note derived from preserved FINAL-11 execution and snapshot evidence; not a new CI authorization and not a closure decision.
- **Candidate:** FINAL-11, rejected after its sole authorized `corepack pnpm ci:verify` invocation.
- **Status:** `REJECTED / CI CONSUMED / FORMAT-CHECK FAILURE`.
- **Stage 6 actions:** `0`.

FINAL-11's only authoritative CI execution exited `1` at `format:check`. Its authorization was consumed; the command was not retried within FINAL-11. The failed CI log, execution receipt, evidence index, readiness, invocation guard, and consumed snapshot remain historical and unchanged.

- CI log: `docs/evidence/phase-1-m1/stage-5-final-11/ci-verify.log`; SHA-256 `6e686ec0cf07bee47a155a5fc167f8ad9e55caa9ac2bb9564b755e90745db109`.
- CI execution receipt: `docs/evidence/phase-1-m1/stage-5-final-11/ci-verify-execution.json`; SHA-256 `cfca7be8cb139bd32e4b43e6f7fb847b01b2042a217cec686b3234906a6d2cce`.
- Failed-candidate evidence index: `docs/evidence/phase-1-m1/stage-5-final-11/EVIDENCE_INDEX.json`; SHA-256 `620c4019206ffa97e8456cdb8e6fb3689d27ab1ae86720db5ccabb7e7269b46a`.
- Invocation guard: `.hermes/state/stage5-final11-ci-verify-invocation.json`; SHA-256 `15a3d5fac1a61e1b354c88a53ca870a0a22d898a06c398622f908738bdf2f473`.
- Consumed candidate snapshot archive: `/home/hermes/.hermes/cache/scratch/travelos-final11-consumed-snapshot.tar`; SHA-256 `7da6175c438754c1eb296c70e041aed3f1dcd254801fb8405c7f33b15cbd2912`.

No FINAL-11 independent-GO candidate freeze was issued at the time of rejection. The companion file `STAGE_5_FINAL_11_CANDIDATE_FREEZE.md` is explicitly a retrospective manifest of that preserved consumed-snapshot archive only; it does not upgrade FINAL-11's failed status or claim complete Stage 5 evidence, independent review, or GO.

This note is added to make the already-preserved failure and snapshot lineage explicit for the FINAL-14 read-only candidate-scope scan. It does not modify FINAL-11 execution evidence or the archive. FINAL-11's failure diagnosis remains separate from the later FINAL-14 result.
