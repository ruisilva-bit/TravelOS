# TravelOS Phase 1 M1 — Stage 5 FINAL-9 candidate validation

- **Candidate:** FINAL-9, successor to the immutable rejected FINAL-8 record.
- **Status:** author qualification **PASS**; eligible for deterministic candidate freeze and a new genuine independent read-only review. This is **not** a closure or GO decision.
- **Authoritative CI:** exactly one `pnpm ci:verify` invocation, recorded as FINAL PASS (`exitCode: 0`) at `2026-10-02T10:32:32.195Z`–`2026-10-02T10:35:04.932Z`.
- **Toolchain:** Node `v24.19.0`, Corepack `0.35.0`, pnpm `11.21.0`. The CI child pin report independently recorded Node `24.19.0`, Corepack `0.35.0`, pnpm `11.21.0`.
- **Stage boundary:** Stage 4 remains closed; Stage 6 actions: `0`.

## Immutable predecessor and Phase 1 governance

- The protected Phase 0 baseline passed at CI pre- and post-gates: manifest `40/40`, including `docs/PERMISSIONS.md` at its immutable accepted SHA-256 `ad036b8647f4482bc5e59bff09e5adbf653a4d3ed3994a20cd5b201d104ea1d9`.
- The Phase 1 security-extension verifier passed before and after CI. Its current baseline is `docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json` (SHA-256 `a8769309d7708174419e94407d2d5226c6bd72b982856a831f3e7df5dbb27ceb`) and explicitly binds `finance.manage_costs` as Agency / ALL only, Staff-only, non-Portal, without payment, margin, price, or Portal grants.
- Negative controls passed for a Phase 0 permissions mutation, a Phase 1 extension mutation, and a Phase 1 manifest mutation.

## Execution and evidence

| Gate | Result | Current evidence |
|---|---|---|
| Focused M1 regression | PASS — 12 files / 58 tests | `focused-test-execution.json`, `focused-tests.log` |
| Auth bridge regression | PASS — 1 file / 4 tests | `auth-bridge-tests.json`, `auth-bridge-tests.log` |
| PostgreSQL qualification | PASS — PostgreSQL `180006` / 1 file / 26 tests; loopback-only, checksums enabled, cleanup PASS | `postgresql-*.json`, `integration-*`, `disposable-cleanup.json` |
| Migration verification | PASS — 10 ordered migrations; head `0010_stage5_temporal_persistence_parity.cjs` | `migration-checksums.json` |
| Authoritative CI | PASS — 16 indexed artifacts | `ci-verify.log`, `ci-verify-execution.json` |

The FINAL evidence index contains `16` artifacts, has aggregate SHA-256 `0e61ffbda493b5cc18cd769b5d5b3352da54713898270948617a70bb4ceabc9f`, and is stored at `docs/evidence/phase-1-m1/stage-5-final-9/EVIDENCE_INDEX.json` (SHA-256 `70118b0890d7c73fd9654c522d2d077930a6d23273f22cbb126d9a45d02284f7`). Its execution receipt records CI-log SHA-256 `1a6951279a4fc2341c58b582b805f1b33d43532745e0bf1df46cb900ccdfe658`.

## Historical finding lineage and review gate

- The exact FINAL-8 independent-review source is preserved at SHA-256 `d343aae5ea315cb524b5e0a4afb3f4b7b452827543def934f3c4825011d316d3`.
- The correction matrix carries all `45` finding IDs: `0` author-closed and `45` pending independent adjudication.
- The rejected FINAL-8 tag and its freeze/index bytes independently verify. No historical bytes were rewritten.
- A fresh reviewer must evaluate the FINAL-9 freeze itself, verify hashes before semantics, adjudicate every carried finding, and return an evidence-cited GO/NO-GO. Author work and this validation cannot close those findings.

## Candidate decision

FINAL-9 is ready for the strict candidate-freeze and independent-review gates only. It is not yet Stage 5 closure, not an independent GO, and does not authorize deployment, production exposure, or Stage 6 work.
