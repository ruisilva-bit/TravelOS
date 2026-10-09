# TravelOS Phase 1 M1 — Stage 5 FINAL-14 candidate validation

- **Candidate:** FINAL-14, authorized sequential successor to the immutable FINAL-13 independent-review NO-GO.
- **Author validation:** PASS; eligible for deterministic freeze and independent read-only review only. This is **not** Stage 5 closure or GO.
- **Stage 6 actions:** `0`.

## Baseline and candidate-generation order

All FINAL-14 package scripts, runner references, candidate tooling, and configuration were finalized before baseline capture. The Phase 1 security-extension baseline was then generated and verified against the final candidate bytes; no protected input was changed afterward. Baseline verification checks all ten protected paths, exact hashes, prior Phase 1 and Phase 0 lineage/history, the FINAL-14 package and runner pins, and missing, unexpected, duplicate, or unauthorized deltas.

- Active baseline: `docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json`
- FINAL-14 baseline SHA-256: `a93a9b37ffa6923b7e06a66411551b3ce4f81cbefbb6ec5e37454a03327497d8` (11,474 bytes; 10 protected paths).
- Baseline-generation receipt: `docs/evidence/phase-1-m1/stage-5-final-14/baseline-generation.json`; PASS; SHA-256 `def1584432514d3e952d2449911ae21006709c3905b7c61fa43e3d479fadaadc`.
- Previous Phase 1 baseline: FINAL-13, SHA-256 `2fb65b6fa0d14875f9c756496f75b2b9fed3a446409295f5bdff46e5deae70cb`; its exact copy remains indexed in FINAL-14 evidence.
- Intentional protected deltas: `package.json` and `docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md` only.
- FINAL-14 `package.json` SHA-256: `2fb980804df0328c69fe7641d76c50daf7f460e7feb9121baee26c13123da595`.
- FINAL-14 authoritative runner SHA-256: `37aba1f952e7f20230126c35e1e595a3668419c43635ede31117ca25db40686c`.
- Historical Phase 0 baseline remains unchanged; predecessor baseline and FINAL-13 evidence/review records are preserved and independently pinned by the candidate lineage checks.

## Readiness and authoritative CI

FINAL-14 readiness preflight returned PASS before CI and recorded no invocation at that point. The runner verified the pinned toolchain, consumed exactly one authorization, and captured the working-tree state, baseline, runner, package, migration head, and command in a new FINAL-14 guard. No FINAL-10 through FINAL-13 authorization or receipt was reused.

|| Evidence | Result / identity |
||---|---|
|| Invocation guard | `.hermes/state/stage5-final14-ci-verify-invocation.json`; SHA-256 `e968c7d20df89a807cf489d36cdb998d6e04dc425cdee3b3367a80db38b0bfed`; state `CONSUMED`; invocation count `1` |
|| Exact command | `corepack pnpm ci:verify` |
|| Toolchain | Node `v24.19.0`; Corepack `0.35.0`; pnpm `11.21.0` |
|| CI interval | `2026-10-06T16:12:42.923Z`–`2026-10-06T16:15:26.290Z` |
|| CI execution receipt | `docs/evidence/phase-1-m1/stage-5-final-14/ci-verify-execution.json`; SHA-256 `176a08deff1e4caeca9a7563bca7664f4430b99444a4814a74788196e48d2a9d`; PASS; exit code `0`; one invocation |
|| Complete CI log | `docs/evidence/phase-1-m1/stage-5-final-14/ci-verify.log`; 343,286 bytes; SHA-256 `c5bb877222dbfdc5b2a2f46350b116c8f5e1244f181368880c20e36188ccd64a`; all 27 emitted CI gate labels passed |
|| FINAL evidence index | `docs/evidence/phase-1-m1/stage-5-final-14/EVIDENCE_INDEX.json`; 81 artifacts; independently reconciled; SHA-256 `4c82b8f68547c3ec3b00673a9afcfd265b06013f51c01c78145fbe586add6478`; aggregate SHA-256 `d2844bee5121021b9b5a9e4a03331f2005e202429515f17b731e1805b7e71a0c` |

The CI execution receipt records commit `27184b598ae2be2eaf35616d4a9b6c2e623ccd42` and the exact FINAL-14 working-tree snapshot. The evidence index independently verifies every indexed path's byte count and SHA-256, exact directory membership, aggregate serialization, predecessor bytes, and finding lineage.

## Candidate-specific PostgreSQL qualification

FINAL-14's candidate-specific disposable PostgreSQL qualification passed against checksum-verified PostgreSQL `18.6`, bound to loopback only. The suite ran 27 integration tests; cleanup passed with the disposable cluster stopped, its root absent, zero retained data directories or package archives, and `ct200Actions: 0`.

- Qualification receipt: `docs/evidence/phase-1-m1/stage-5-final-14/postgresql-qualification.json` (PASS; SHA-256 `344d66c71c24470570eac00337b10a4482e925a6361f6b1c311ecb2f9eb2e6a8`).
- Cleanup receipt: `docs/evidence/phase-1-m1/stage-5-final-14/postgresql-disposable-cleanup.json` (PASS; SHA-256 `fcb09fce5b5e324eae0be6544eb0cf5cb88c60afeab4eb79a8e877bf01702efe`).
- The real PostgreSQL/HTTP suite includes forged Admin revision-marker probes, bigint lock-version compare-and-swap beyond JavaScript's safe integer, deadlock SQLSTATE `40P01` mapping through repository and HTTP, stale supplier-cost compare-and-swap through the registered Admin route, and opposing child-move concurrency.
- Qualification log: `postgresql-integration-tests.log`; execution used `node tooling/database/run-stage-5-disposable.mjs`; temporary database/package resources were removed and verified.

## Final-evidence scan and finding lineage

After the FINAL evidence index was written, the FINAL_EVIDENCE source scan passed across 731 files with 0 findings. The scan receipt binds the exact FINAL index (`4c82b8f...`, 81 artifacts) and current finding-lineage verification.

- Scan receipt: `docs/evidence/phase-1-m1/final14-scan-reports/STAGE_5_FINAL_14_PREVALIDATION.json`.
- Receipt SHA-256: `42c53b7d20240aeea8bebcfca4702280e306c8af9df4641e6a0194b2d02b6865` (179,520 bytes).
- Phase: `FINAL_EVIDENCE`; result `PASS`; 731 files scanned; 0 findings.
- `docs/reviews/phase-1-m1/STAGE_5_FINAL_14_CORRECTION_MATRIX.json` carries all 49 findings with corrected FINAL-14 evidence references; none are author-closed. Each remains pending independent adjudication.
- After both documents were written, the read-only `FINAL_CANDIDATE` scan passed over 735 files with 0 findings and no missing candidate inputs. Its separate receipt is `docs/evidence/phase-1-m1/final14-scan-reports/STAGE_5_FINAL_14_POST_FREEZE.json`; the receipt is outside the indexed evidence directory and is produced after the scan to avoid self-reference.

## Historical lineage and candidate decision

FINAL-10 remains `REJECTED / CI CONSUMED / PRE-GATE FAILURE`; its package/baseline generation-order mismatch is preserved as a baseline consistency failure, not corruption. FINAL-11 and FINAL-12 retain their single consumed failing CI records. FINAL-13 retains its PASS CI, immutable freeze, archive, and independent-review NO-GO. FINAL-14 preserves its own corrected baseline, PostgreSQL qualification, green preflight, single CI receipt, FINAL evidence index, and current scan provenance. No historical candidate record is rewritten.

FINAL-14 is ready for deterministic freeze and a fresh independent read-only review. It is not yet independent GO, Stage 5 closure, deployment authorization, or Stage 6 start. **Stage 6 actions: `0`.**
