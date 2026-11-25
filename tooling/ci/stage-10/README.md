# Stage 10 candidate/pipeline foundations — mutable, NOT qualified

## Current mutable package extension

The fixed production recipe, provenance writer and extracted-package checker now
exist and have been exercised with real offline workspace dependencies. This does
not make the consuming builder or canonical CI ready: their independent readiness
brakes remain in place. Earlier foundation-only statements below describe that
slice, not completed runtime or Stage 10 acceptance.

Corepack execution now uses the fixed DEVELOPMENT build-host Node and Corepack
implementation paths with content pins, not inherited PATH version claims. The
nested pnpm launcher is pinned too. The build UID and its primary group remain
trusted; these checks are not hostile same-UID isolation or external provenance.

Manifest dependency closure, versions, lock membership and exact artifact bytes
remain checked. `declared-entry-checks.mjs` checks selected declared files and
explicitly reports non-runtime/custom conditions, wildcard/directory exports and
packages without declared entries as unqualified. It does **not** invent root
JavaScript APIs for binary-only packages or claim executable import-graph proof.
`bootstrap-preflight.mjs` executes the three fixed application entrypoints without
a manifest or credential environment and requires their exact source-owned
missing-manifest failure. This exercises their initial imports and fail-closed
path without starting a service or accessing a database. It is not a sandbox,
authentication test, dynamic-branch proof or CT200 runtime acceptance.

The actual Better Auth optional peer variant currently brings Vitest/Vite/esbuild
into the production deployment graph. That graph remains inventoried, not hidden
by skipping optional peers. Packaging hygiene, actual consumer-specifier/runtime
qualification, CT200 operational gates and independently controlled evidence
acceptance remain open. A declared-file package PASS cannot promote an artifact
or mark any pending canonical runtime gate complete.

## Status and limits

This directory implements local foundational primitives and fail-closed entry
brakes. **It is not a completed Stage 10 compiler, release packager or canonical
CI executor.** No candidate, preflight, canonical CI, release signature, deployment
or Stage 10 acceptance evidence was produced while developing this slice.

`run-canonical-ci.mjs` and `build-artifact.mjs` deliberately refuse **before any
claim**. They must not be presented as working production runners. Removing a
pending flag is not implementation: the production recipe, execution loop,
Stage 10 adapters, trusted preflight and independent review remain required.

No existing repository file is changed by this slice. All 2,662 files in the
accepted Stage 9 Git tree were compared read-only against their exact blobs and
executable modes: PASS, zero existing-file deltas. This is a predecessor source
baseline check, not a rerun of its historical freeze verifier or CI.

## Implemented behavior

- `constants.mjs` pins the exact accepted Stage 9 **gen11** commit/tag, archive
  digest and artifact ID. It does not inherit the older gen10 current-artifact
  constants from Stage 9. Migration head remains `0016_stage9_staff_invitations`.
- `candidate.mjs` compares protected predecessor bytes/modes at the exact tag,
  requires that exact commit as an ancestor for input collection, checks the
  accepted archive digest, and measures Node/Corepack/pnpm. Source discovery
  includes tracked and nonignored untracked files, including operational docs,
  and excludes local `.hermes/` only. Missing tracked files, leaf symlinks and
  symlink directory ancestors fail. Modes, byte counts, paths and SHA-256 bind
  the source. Ignored generated output/dependencies are not source inputs;
  ignored handwritten source must be unignored before freezing.
- Input collection is deterministic JSON (UTF-8, two spaces, final LF), includes
  migration rows, predecessor, toolchain and gate-definition digest, and is
  collected twice before exclusive freeze publication. **Candidate labels and
  wall-clock times are not part of input identity.** Freeze paths are exclusive;
  no freeze was created in the actual worktree during this task.
- `one-shot.mjs` reserves by input digest using exclusive `mkdir`, then persists
  the immutable claim with file and directory fsync. Candidate renaming cannot
  bypass a consumed input digest. Outcomes are separate exclusive files; they
  never rewrite the claim. Failure, incomplete directory, partial claim and
  interruption remain consumed. No automatic cleanup, retry or resume is
  provided. An absent outcome means running/interrupted, never success.
- `artifact.mjs` seals existing payload bytes with a source/migration/toolchain/
  predecessor binding, inventories regular files and contained relative
  symlinks, writes a deterministic archive and produces an integrity receipt.
  `packageOnce` combines it with the immutable claim and preserves failed
  attempts/partial output. It does **not compile** or certify a TravelOS release.
  Verification requires an independently supplied receipt digest, checks archive
  length/hash, the exact extracted manifest/inventory and archive-to-tree bytes,
  and compares the supplied input binding. Fixtures proved deterministic archive
  bytes across separate roots.
- `receipt.mjs` checks pinned receipt bytes, immutable claim correspondence,
  input digest, exact gate order/count, exit codes, log digest/length and a unique
  completion marker. Its result is always **structural only**, not canonical
  acceptance or proof commands ran. Synthetic fixture records exist only in test
  memory and disposable directories, never as repository evidence.
- `gates.mjs` declares cumulative Stage 6–9 coverage, real PostgreSQL/browser,
  source/security, dependency, migration and Stage 10 operational obligations.
  Existing stage-bound scripts are explicitly **unqualified for Stage 10**;
  pending gates have no fake commands. Coverage omission fails, and every
  unqualified or pending gate keeps the production entries closed.
- Production entry options/CLI are strict: no injected gate list, callback,
  shell command, preflight object, builder, or PASS environment switch.

## Trust/durability assumptions — still pending

The ledger protects against accidental/concurrent reuse in **one private local
workspace and ledger**, not a malicious same-UID operator, deleted state,
alternate-ledger rollback or compromise of the toolchain. No global invocation
registry exists yet. Do not move a consumed candidate into another ledger or
remove claims to retry. The package-once fixture uses separate disposable ledgers
only to compare deterministic bytes; it is not an approved production bypass.

Fsync qualification assumes a local filesystem honoring file/directory fsync.
A returned claim has been synced. Power loss before the first directory fsync,
filesystem snapshots/rollback, disk corruption, same-UID writers and hostile
ancestor replacement are not independently qualified. Descriptor-safe leaf
opens and ancestor checks do not constitute a fully descriptor-anchored,
adversarially race-free trust boundary. Use a single-writer mutable workspace,
then independently review before candidate consumption.

The generic artifact checker proves correspondence to the externally pinned
receipt and supplied binding. It does not validate the full required TravelOS
release contents, package dependencies, actual bundled runtime, migration SQL,
signature policy, deployment contract or the authority of that receipt pin.
The final Stage 10 verifier must combine it with the exact accepted predecessor
verification and full source/migration/toolchain release checks; callers must
not reinterpret `INTEGRITY_ONLY_NOT_QUALIFIED` as deployment permission.

Signing trust/custody, host executor, activation, retained-receipt authority,
privacy review and canonical evidence publication remain explicitly PENDING.
No scanner PASS substitutes for privacy review. This slice does not modify those
other workers' files or claim closure of their findings.

## Focused execution and real results

Pinned toolchain was verified with this PATH prefix:

```sh
export PATH=/home/hermes/.local/share/travelos-stage5-toolchain/node_modules/.bin:/home/hermes/.local/share/travelos-stage5-toolchain/node_modules/node/bin:$PATH
node --version             # v24.19.0
corepack --version         # 0.35.0
corepack pnpm --version    # 11.21.0
```

The shell's original `corepack` resolved to 0.34.6 despite pinned Node. Do not
assume Node pinning pins Corepack. The collector rejects that mismatch.

```sh
node --test tooling/ci/stage-10/test-pipeline.mjs tooling/ci/stage-10/test-receipt.mjs
node node_modules/eslint/bin/eslint.js tooling/ci/stage-10/*.mjs
node node_modules/prettier/bin/prettier.cjs --check tooling/ci/stage-10/*.mjs
corepack pnpm --silent run test:unit
```

Initial red: 10 missing-implementation assertions failed. Additional package-once
and receipt tests were also observed red before their implementation. Focused
suite: 16 passed, 0 failed, 0 skipped, including an actual synthetic child killed
with SIGKILL after its claim was synced. Existing project unit suite: **65 test files,
369 tests passed**, exit 0. Lint passed. Initial format check found ten unformatted
new files; only this directory was formatted, then checked again. These are
focused/local unit results, **not canonical CI or PostgreSQL/browser acceptance**.

All disposable filesystem fixtures use configured `$TMPDIR` beneath Hermes
scratch and are removed by test cleanup. No tests modify host `/etc`, CT200,
protected historical files or active candidate state.

## Script wiring plan — NOT applied

After implementation and independent review, propose additive root scripts:

| Proposed script          | Command                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `test:stage10:pipeline`  | `node --test tooling/ci/stage-10/test-pipeline.mjs tooling/ci/stage-10/test-receipt.mjs` |
| `stage10:artifact:build` | `node tooling/ci/stage-10/build-artifact.mjs`                                            |
| `stage10:canonical-ci`   | `node tooling/ci/stage-10/run-canonical-ci.mjs`                                          |

The build and CI entries require `--candidate=genNN` but currently refuse. Do
not advertise the latter two scripts as usable or wire them into `ci:verify`.
Keep historical scripts immutable. The baseline currently permits **no changes**
to existing `package.json`; approve and implement a narrow successor-baseline
allowance for the exact reviewed additive script changes before wiring them.
Do not relax dependency/toolchain/migration protection to allow script changes.

## Safe next implementation order

1. Finalize Stage 10 package allowlist and deployment contract with the signing,
   host executor and retention owners. Require actual runtime Node digest,
   source snapshot bytes, full migration chain/checksums, lockfile, dependency
   universe and predecessor archive/ref checks in the extracted-artifact verifier.
2. Implement a fixed local compiler/package recipe: frozen offline installation,
   claim **before the only compile**, production build once, production packaging,
   source/pin recheck, deterministic archive, exact extraction/verification.
   Preserve every failed/interrupted attempt. Do not delegate to Stage 9's builder,
   compile on CT200, rebuild during CI or create a candidate during development.
3. Write Stage 10 adapters around cumulative real PostgreSQL/browser acceptance.
   Preserve assertions and exact anchor counts; bind execution to Stage 10's
   extracted artifact, not the currently deployed Stage 9 artifact. Rehearse
   against disposable local resources before candidate freeze.
4. Implement trusted preflight/receipt producers with real retained command output
   for functionality, adversarial paths, real PostgreSQL/browser, packaging,
   permissions, credentials, systemd paths, backup/restore and failure/recovery.
   Bind every receipt to the exact artifact/source/migration/toolchain; hash
   correspondence is necessary, never evidence of independent authority.
5. Replace the fail-closed entries with fixed reviewed execution paths. At entry,
   reject unknown options, verify all frozen inputs and independent preflight,
   verify complete gate coverage and actual child toolchain, then reserve the
   canonical CI claim by **input digest**, not label/preflight/archive name.
   Immediately treat even a partial claim as consumed.
6. Reverify input/artifact/predecessor before and after each fixed gate. Persist
   bounded stdout/stderr and primary status; stop on failure, throw, timeout,
   source drift or interruption. Sync append-only completion/outcome separately
   from the immutable claim. SIGKILL or missing completion stays consumed/unknown.
   Require all gate receipts, exact log bytes and a unique completion marker.
7. Independently review implementation and all still-pending trust/privacy gates.
   Only then perform exact-artifact rehearsal, approved deterministic candidate
   freeze and the single canonical invocation. No rerun by changing candidate ID.
