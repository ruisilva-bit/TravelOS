# ADR-015: Steady-State Delivery Pipeline

> Superseded in part by ADR-016 (process/evidence parts).

- **Status:** Accepted
- **Date:** 2026-11-25
- **Decision owner:** Product Owner (Rui), recorded in the delivery session of 2026-11-25
- **Supersedes:** the stage-gated CI composition of Phase 1 M1 (`tooling/ci/verify-stage-6.mjs` as `ci:verify`, stage-frozen successor-baseline verifiers as required checks, and evidence committed under `docs/evidence/**`). It does **not** supersede ADR-013's runtime/monorepo decisions or any product/security invariant.

## Context

M1 Stages 1–9 were delivered with a per-stage qualification model: every stage froze a successor baseline (exact byte counts, commit IDs, branch names) and added verifiers that re-check those frozen inputs. This was useful to prove that accepted bytes were not silently changed while the architecture was being established. It does not scale as a steady-state pipeline:

- On 2026-11-25 five checks inside `pnpm ci:verify` already failed on the unmodified tree for reasons unrelated to product correctness: an unexpected branch name, a predecessor commit missing from the clone, a byte-count pin on `apps/admin-api/src/auth-bridge.ts`, a Phase 0 document hash pin, and a migrator-package fixture. `security:scan:stage6` stops at the first pin mismatch, so it no longer scans the current tree at all.
- Tooling had grown to ~96k lines versus ~37k lines of product code, and committed evidence to ~129 MB.
- Ordinary refactors (for example splitting the Admin route module) are blocked or require editing frozen baselines, which the constitution forbids.

## Decision

1. `pnpm ci:verify` runs `tooling/ci/verify-current.mjs`, a stable, stage-free list of checks that evaluate the **current tree** only:
   pins, migration checksums, Better Auth schema drift, lifecycle policy, config schema, format, lint, build, typecheck, architecture boundaries, rejected technologies, unit tests, current-source sensitive-data scan, browser bundle scan, real pinned PostgreSQL 18.6 integration (`pnpm test:postgres`), and the built-artifact smoke test.
2. The current-source sensitive-data scan (`tooling/ci/scan-current-source.mjs`) covers every tracked file in `apps`, `packages`, `migrations`, `deploy`, `tests`, `tooling`, `.github` and the repository root. A finding passes only when it matches a reviewed entry in `tooling/ci/current-source-findings.json` by exact path, rule and SHA-256 of the line bytes, with a category and rationale. Unclassified findings and stale entries fail the gate. The 2026-11-25 seed was derived from the Stage 10 inherited classification plus a manual review of the remaining entries.
3. Stage-frozen verifiers (`stage*:successor-baseline:*`, `stage*:candidate*`, `security:scan:stage4|stage6`, `evidence:stage*`, freeze collectors and per-stage disposable runners) become **historical**. Their files remain in the tree and keep working against the commits they were written for; they are not required checks and must not be edited to fit new code. The accepted M1 Stage 9 state is identified by commit `f65a64d` (tag `m1-stage9-accepted` when tags are pushed).
4. New delivery evidence is produced as CI run output/artifacts and summarized in reviews; it is not committed under `docs/evidence/**`. Existing evidence stays in place until an external archive destination is chosen; history is never rewritten.
5. All security and data-integrity gates required by `AGENTS.md` §9 remain mandatory. This ADR changes how they are composed and evidenced, not whether they run. Gates that need infrastructure absent from CI (CT200 deployment, backup/restore, signing) are run and recorded by their owning milestone, never claimed from CI.

## Consequences

- A refactor that keeps behaviour and passes the current-tree gates is mergeable without touching frozen baselines.
- Integrity of historical acceptance is preserved by immutable git history and the historical verifiers at their commits, not by pinning every later commit to old bytes.
- Reviewers must review changes to `tooling/ci/current-source-findings.json` as security-relevant: every new entry needs a category and rationale.
- Running the PostgreSQL suite requires network access to the pinned package hosts; sandboxes that need an HTTPS proxy must set `NODE_USE_ENV_PROXY=1`.

## Rejected

- Keep extending per-stage baselines: compounding cost and already-failing required checks.
- Delete historical verifiers and evidence: loses traceability of accepted M1 stages.
- Path-only or rule-only allowlists for the sensitive-data scan: would silently admit new secrets in already-allowlisted files.

## Revisit trigger

A release-qualification milestone (Stage 10/11 or later) needs a frozen, signed candidate: freeze that candidate's artifact digest and inputs for that milestone only, without making the freeze a required check for later work.
