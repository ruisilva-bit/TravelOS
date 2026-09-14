# TravelOS Phase 1 M1 — Stage 1 Independent Review

## Reviewer independence, scope, and non-modification

- Independent non-authoring reviewer for TravelOS Phase 1 Stage 1.
- I did **not** modify any frozen file, `AGENTS.md`, baseline, plan, ADR, architecture, or implementation-decision document.
- I did **not** perform installs, runtime probes, browser probes, or network lookups.
- I created only this report file: `docs/reviews/phase-1-m1/STAGE_1_INDEPENDENT_REVIEW.md`.

## Freeze verification

### Summary

| metric | result |
|---|---:|
| declared rows | 6 |
| parsed rows | 6 |
| matched rows | 6 |
| missing rows | 0 |
| mismatch rows | 0 |
| extra rows | 0 |
| recomputed manifest SHA-256 | `1b6302ae14bec1733ae693d948191464c1672b03f9aa39b2eee11f9ccee6f31a` |

### Row-by-row recomputation

| path | declared SHA-256 | recomputed SHA-256 | status |
|---|---|---|---|
| `AGENTS.md` | `224d6f1da3c389b97002fadc9b9ee1c60f14c8c3d20df6334f91e0a34df6a340` | `224d6f1da3c389b97002fadc9b9ee1c60f14c8c3d20df6334f91e0a34df6a340` | MATCH |
| `docs/reviews/PHASE_0_ACCEPTED_BASELINE.md` | `bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb` | `bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb` | MATCH |
| `.hermes/plans/2026-08-14_105849-travelos-phase-1-m1-implementation.md` | `210ab56b4d104b9ba8c5f825bd370c3c9056be172f8a2f6db00704ca91a58f71` | `210ab56b4d104b9ba8c5f825bd370c3c9056be172f8a2f6db00704ca91a58f71` | MATCH |
| `docs/implementation/M1_STAGE_1_CT200_BASELINE.md` | `b605ae5dbe2082e7a1976f90f517c6cceecebedaffdc9305bc07f9b9f202afbc` | `b605ae5dbe2082e7a1976f90f517c6cceecebedaffdc9305bc07f9b9f202afbc` | MATCH |
| `docs/implementation/M1_VERSION_COMPATIBILITY_MATRIX.md` | `9ab1b68ce435033f2d5c6cf3e9cc15c27b0ea12867d0473b4af2053442ca1792` | `9ab1b68ce435033f2d5c6cf3e9cc15c27b0ea12867d0473b4af2053442ca1792` | MATCH |
| `docs/implementation/M1_BOOTSTRAP_DECISIONS.md` | `d342becbde4737d72ef3fb07cb5b0aa09b2e509701eae8bb68ed6651c8610158` | `d342becbde4737d72ef3fb07cb5b0aa09b2e509701eae8bb68ed6651c8610158` | MATCH |

## Baseline 40-row result

| metric | result |
|---|---:|
| declared rows | 40 |
| parsed rows | 40 |
| matched rows | 40 |
| missing rows | 0 |
| mismatch rows | 0 |
| extra rows | 0 |
| recomputed manifest SHA-256 | `bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb` |

All 40 Accepted baseline rows were recomputed locally and matched exactly, including the root `AGENTS.md` equality check through the shared SHA-256.

## Method / source ledger

### Local evidence used

- Read and hashed:
  - `AGENTS.md`
  - `docs/reviews/PHASE_0_ACCEPTED_BASELINE.md`
  - `docs/reviews/AGENTS_CANDIDATE.md`
  - `docs/reviews/phase-1-m1/STAGE_1_CANDIDATE_FREEZE.md`
  - `docs/implementation/M1_STAGE_1_CT200_BASELINE.md`
  - `docs/implementation/M1_VERSION_COMPATIBILITY_MATRIX.md`
  - `docs/implementation/M1_BOOTSTRAP_DECISIONS.md`
  - `.hermes/plans/2026-08-14_105849-travelos-phase-1-m1-implementation.md`
- Verified absent locally: `.git`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `apps/`, `packages/`, `migrations/`, `.github/`.
- Used deterministic local filesystem/hash checks only.

### Authoritative review leads supplied in the task

- Node/registry/PostgreSQL/release-tool/OSV facts provided in the prompt.
- I treated those as evidence leads, then checked the frozen documents and local hashes against them.

## Adversarial coverage across the 18 required areas

| # | Area | Conclusion | Evidence / note |
|---:|---|---|---|
| 1 | Baseline / constitution | PASS | 40/40 baseline rows matched; `AGENTS.md` and `docs/reviews/AGENTS_CANDIDATE.md` shared the same hash. |
| 2 | CT baseline | PASS | `M1_STAGE_1_CT200_BASELINE.md` records the `.200` Proxmox node / `.33` guest correction and the read-only scope. |
| 3 | Node / Corepack / pnpm | PASS | The exact pins and install gates are recorded in the compatibility matrix and bootstrap decisions; they align with the supplied registry facts. |
| 4 | PostgreSQL | PASS | Major 18 / 18.6 choice is recorded and supported by the supplied official-support facts. |
| 5 | 46 pins / engines / peers / install policy / audits | PASS | The compatibility matrix contains 46 direct package rows in the exact direct matrix; install allowlist and zero-vulnerability audit claims are present. |
| 6 | TypeScript | PASS | `typescript@6.0.3` is paired with `typescript-eslint@8.67.0`; the `skipLibCheck` wording is a documentation nuance, not a Stage 1 blocker. |
| 7 | `vite-tsconfig-paths` | PASS | It is explicitly rejected and absent. |
| 8 | Better Auth runtime / CLI | PASS | Runtime and CLI are both pinned at `1.6.27`, generation is authoring-only, and `migrate` is forbidden. |
| 9 | Two realms / schema separation | PASS | Staff and Portal generation outputs remain separated (`staff_access` / `portal_access`), with distinct table sets. |
| 10 | Lodash override | PASS | The global override replaces the exact transitive `lodash@4.17.21` request with `4.18.1`, and the docs say generation/audits were retested. |
| 11 | Release tools | PASS | Cosign, Syft, and Caddy are qualified by checksum/executable probes and remain recommendations, not deployments. |
| 12 | Bundled Node delivery | PASS | The Node 24.19.0 tarball checksum is frozen and the runtime delivery contract is documented; no runtime-major transition is implied. |
| 13 | Repo / CI / signing | FAIL | See `TOS-S1-002`. The required Stage 1 repository-host/signing decision record is missing. |
| 14 | Hygiene / stage boundary | PASS | Stage 1 stays DEVELOPMENT-only; later deployment and production gates remain deferred. |
| 15 | ADR-001..014 | PASS | The accepted ADR set is intact and the baseline manifest includes all 14 accepted ADRs plus `docs/adr/README.md`. |
| 16 | Plan | FAIL | See `TOS-S1-002`. The plan requires Stage 1 to record repository-host and signing decisions before Stage 2 initialization. |
| 17 | Fleet traps | PASS | The `.200` Proxmox-node / `.33` guest distinction is corrected and explicitly carried forward. |
| 18 | Unsupported claims / evidence provenance | FAIL | See `TOS-S1-001`. The frozen bundle lacks a machine-readable evidence manifest or command/exit-path record sufficient to independently prove the prose PASS claims. |

## Findings summary

| ID | Severity | Category | Affected files | Short reason |
|---|---|---|---|---|
| TOS-S1-001 | HIGH | A | `docs/reviews/phase-1-m1/STAGE_1_CANDIDATE_FREEZE.md`, `docs/implementation/M1_VERSION_COMPATIBILITY_MATRIX.md`, `docs/implementation/M1_STAGE_1_CT200_BASELINE.md` | Unsupported executable/no-mutation claims are not backed by a machine-readable evidence trail. |
| TOS-S1-002 | BLOCKER | A | `.hermes/plans/2026-08-14_105849-travelos-phase-1-m1-implementation.md`, `docs/implementation/M1_BOOTSTRAP_DECISIONS.md`, `docs/reviews/phase-1-m1/STAGE_1_CANDIDATE_FREEZE.md` | The required Stage 1 repository-host / CI / signing decision record is missing, which blocks Stage 2 initialization. |

## Findings details

### TOS-S1-001 — HIGH — Stage 1 qualification evidence is not independently reproducible

- **Category:** A
- **Affected files:** `docs/reviews/phase-1-m1/STAGE_1_CANDIDATE_FREEZE.md`, `docs/implementation/M1_VERSION_COMPATIBILITY_MATRIX.md`, `docs/implementation/M1_STAGE_1_CT200_BASELINE.md`
- **Evidence:**
  - The freeze says: `No separate Stage 1 evidence/index file is needed` and relies on prose PASS rows plus hashes of disposable artifacts.
  - The matrix contains summary PASS rows and hashes, but no command/exit-code log, machine-readable resolved graph, audit report, SQL/table inventory, DB/dump comparison, or sanitized CT command/output record.
  - The CT baseline says the execution record contains no mutating CT command and that the statement is not a byte-for-byte filesystem diff.
- **Concrete failure scenario:** a later reviewer cannot reconstruct which exact command outputs established the package graph, audits, SQL generation, or no-mutation result, so a bad audit or an unobserved CT mutation could survive as a prose PASS.
- **Consequence:** Stage 1 qualification is not independently reproducible from the frozen bundle alone; Stage 2 would inherit unproven install/build/runtime claims.
- **Required correction / gate:** add or preserve a compact machine-readable evidence manifest with command/exit-paths, resolved graph data, audit output, SQL/table inventory, DB/dump comparison, and sanitized CT command/output records; do not close Stage 1 until those claims can be replayed.

### TOS-S1-002 — BLOCKER — Stage 1 decision bytes for repository host / CI / signing are missing

- **Category:** A
- **Affected files:** `.hermes/plans/2026-08-14_105849-travelos-phase-1-m1-implementation.md`, `docs/implementation/M1_BOOTSTRAP_DECISIONS.md`, `docs/reviews/phase-1-m1/STAGE_1_CANDIDATE_FREEZE.md`
- **Evidence:**
  - The plan requires Stage 1 to `record repository/CI/signing/host prerequisites and owners` and to `record whether to initialize it here, the intended remote/organization, branch protection, and whether GitHub Actions can be activated` before repository initialization.
  - The same plan says Stage 2 repository initialization/versioning happens only after that Stage 1 repository-host decision.
  - The frozen implementation docs record tool qualification, but they do not record the repository host / remote-org / branch-protection / GitHub Actions activation decision or the signing approach / identity / key location as a Stage 1 decision byte.
- **Concrete failure scenario:** Stage 2 can begin without a recorded repo-host decision, branch-protection stance, or signing identity/key-location decision, causing the first repo/CI wiring to be made ad hoc and potentially conflicting with the accepted plan.
- **Consequence:** Stage 2 is not authorized yet; repository initialization and CI activation would be premature because the mandatory Stage 1 governance decision is absent.
- **Required correction / gate:** record the Stage 1 repository-host decision, remote/org, branch protection, GitHub Actions activation choice, signing approach, signing identity, and key location before any Stage 2 repository initialization or CI activation.

## Recommendation rationale

The freeze integrity is clean: the six frozen rows all matched, and all 40 Accepted baseline rows matched exactly. However, Stage 1 still has two documentary qualification defects that matter for closure:

1. the frozen bundle does not carry enough machine-readable evidence to independently prove the claimed install/audit/no-mutation results; and
2. the Stage 1 repository-host / CI / signing decision record required by the plan is missing, which blocks Stage 2 initialization.

Because at least one blocker remains, independent closure cannot recommend GO.

NO-GO