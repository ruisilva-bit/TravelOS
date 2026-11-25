# Stage 10 C — CT200 Lane Execution Handoff (attempt-4d11458a01)

**Outcome: FAIL_PRESERVE.** The mapped 95-case PostgreSQL lane and the
authenticated browser lane did **not** execute. The runner failed closed during
pre-test artifact qualification, before any PostgreSQL cluster start
(`clusterStartAttempted: false`). **0 of 95 assertions ran.** This is a
truthful scoped failure report — not a Stage GO, not a canonical claim, and no
test was waived.

## Scope and authority

- Bounded Stage 10 C execution task only: exercise the parent
  `HARNESS_HANDOFF.md` inputs on the existing CT200 DEVELOPMENT machine.
- Existing Stage 1–9 artifacts and the parent-delivered
  `t_16e14434-harness-v9` / `t_16e14434-bundle-v1` / runtime/browser
  transports were **not modified** (operator correction applied: the
  handoff's reproduction `rm -rf` commands at lines 147/156 were **not** run).
- No commit, push, merge, signing, custody/privilege cutover, release
  activation, Stage 11 action, or new CT instance.
- QA task `t_fe5a74c8` remains the independent final validation.

## Input verification (this session, independent re-verification)

- Bundle `.hermes/state/t_16e14434-bundle-v1/`: all **13 manifest entries
  rehashed, zero mismatches**; `manifest.json` SHA-256
  `8768ef0efb80a08121cb2202a407c4278ddac404f2f705570816a2a675c1f9a3`.
- Tar/receipt chain re-confirmed: `harness.tar`
  `fa778ea7b22723be9dae3b09159d665aee14140c26b0c18248959ead43734ecf` (26,982
  entries), `runtime.tar`
  `081613698c89640a842e925b692f6e9aa402d505015d01a4f0df9d9fe935b5c7` (31,567
  entries), `browser.tar`
  `6c22c60a791cfb125771544ed2f268da6d0062a331a9a251bec2d79735e35eaf` (292
  entries) — each matches its transport receipt `sha256` and the manifest.
- Source-script hashes equal the handoff table:
  `stage10-qualification-remote.py` `f4ef4c01…bd0665`,
  `stage10-qualification-transport.py` `fc16c2b2…5f553`,
  `stage10-qualification-resource.py` `817d1eec…7f04e6`,
  harness-pinned `tooling/database/run-stage-10-postgres-disposable.mjs`
  `d30de7be…888c7`; `predecessor.tar.gz` `8b74c305…b6d125` matches the
  runner's `PREDECESSOR_SHA`.
- Fresh read-only preflight on CT200 (`stage10-qualification-transport.py
  --preflight`): PASS — uid 1000, PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2)
  tools all present/executable, all 18 browser native libraries present,
  glibc 2.41, `homeFreeBytes` 11,944,697,856 (~11.1 GiB) — sufficient for
  the ~2.6 GB attempt footprint. No dependency installs were required.

## CT200 reconciliation before the run (never replay blindly)

- `travelos-dev` (192.168.1.33, kernel 7.0.14-22-pve, uid 1000 hermes).
- Attempt parent `/home/hermes/.local/share/travelos-stage10-qualification/`
  existed and was **empty**: no surviving attempts, no unknown outcomes, no
  leftover receipts.
- No `travelos-s10-*` user units loaded; no failed user units; no browser
  processes; no `/tmp/travelos-*` leftovers.
- The system PostgreSQL cluster (uid 102, `18/main`, service of the CT200
  development instance) was running before, during and after — **untouched**;
  the attempt lane never started its own disposable cluster, and the system
  cluster was never a target of any attempt-owned command.

## Execution (attempt `attempt-4d11458a01`)

- Attempt directory created fresh at
  `/home/hermes/.local/share/travelos-stage10-qualification/attempt-4d11458a01`
  (mode 0700, owner hermes) — no predecessor attempt existed to reconcile.
- All 14 input files (13 `FILES` + `manifest.json`) transferred by tar over
  pinned SSH (`travelos_ct200_ed25519`, pinned known-hosts, BatchMode) in
  45 s; **readback verification: 14/14 files hash-identical to the local
  manifest; attempt dir 0700/hermes; exactly 14 entries.**
- Command executed on CT200 (detached under `nohup` so the run would survive
  worker reclaim):
  `cd <attempt> && /usr/bin/python3 -B -I stage10-qualification-remote.py --run <attempt>`
- `prepare()` verified every input against the manifest and all three tars
  against their transport receipts, then extracted harness (26,982 entries),
  runtime (31,567 entries) and browser (292 entries) into the attempt
  (~2.6 GB peak) with per-file fsync.
- Transient user unit `travelos-s10-attempt-4d11458a01.service` started under
  `systemd-run --user --wait --pipe --collect` with the enforced limits
  confirmed in-child via cgroup readback
  (`stage10-qualification-resource.py inspect_child`):
  `memory.max=2147483648`, `memory.swap.max=0`, `pids.max=128`,
  `cpu.max=100000 100000`, core limits (0,0) — recorded in
  `remote-outcome.json` → `resource`.

## Result — exact failure

- Unit runtime 1 min 21.481 s, CPU 1 min 11.823 s, memory peak 967 MiB
  (swap 0 B); main process `code=exited, status=1/FAILURE`.
- `remote-outcome.json`:
  `{"result":"FAIL_PRESERVE","primaryExit":1,"executionSha256":"2ce079052bceca3363e58e236a863e43b6eb7a0629792dcf561ed31071367838","scope":"CT200_DIAGNOSTIC_NOT_CANONICAL", "resource":{…verified cgroup limits…}, "cleanup":{"clusterStartAttempted":false,"clusterStopped":true,"disposableRootsAbsent":true,"stopExitCode":null}}`
- `harness/.hermes/state/ct200-run/execution.json` (22,545 bytes, SHA-256
  `2ce079052bceca3363e58e236a863e43b6eb7a0629792dcf561ed31071367838`,
  readback-verified): `result: "FAIL"`, `testExitCode: null`,
  `artifactBinding: null`, `assertionResults: null`, `commands: []`,
  failure:
  `AssertionError [ERR_ASSERTION]: Archive does not match exact extracted payload`
  thrown from `verifyArtifactBinding` (`tooling/ci/stage-10/artifact.mjs`)
  via `qualifyExtractedArtifact` inside
  `tooling/database/run-stage-10-postgres-disposable.mjs`, before
  `initdb`/`pg_ctl start`.
- `stdout.log` (139 B): the runner's evidence line only; `stderr.log` (882 B):
  the assertion stack (attempt paths only, no secrets); `unit-stdout.log`
  (491 B) / `unit-stderr.log` (291 B): systemd unit result lines. All four
  logs are preserved inside the attempt on CT200 (owner hermes, 0644/0600).
- **95-case lane status: 0 executed, 95 not run.** The runner's PASS gate
  (95 `passed` assertionResults, `expectedTests: 95`, zero pending/todo) was
  never reached; `--completed` verification is not applicable to a FAIL
  attempt.

## Reproduced diagnosis

The failing gate is `tar --compare --gzip --file=artifact.tar.gz --directory
<payload-root>` in `verifyArtifactBinding`, which tolerates only Uid/Gid/Mod
time differences. Two facts isolate the cause:

1. The **path sets are identical** (31,567 payload paths; the only
   archive-only name is the `./` root member produced by the sealer). The
   divergence is in file bytes or mode metadata, not membership.
2. The same comparison reproduced locally against the exact handed-off
   bytes (extract `runtime.tar`, `tar --compare` against `artifact.tar.gz`)
   — see the diff block below; scratch path
   `/home/hermes/.hermes/profiles/infra/cache/scratch/repro-artifact-compare/`.

**Root cause (exact):** GNU `tar --create` stores content-identical files as
**hard-link members** ("linkname" pointing at the first occurrence); the pnpm
`node_modules/.pnpm` store inside the sealed artifact payload contains
thousands of such hard-linked duplicates. The Stage 10 B transport
(`stage10-qualification-transport.py` `inventory`/`pack`/`unpack`) has no
hard-link concept — it records and re-creates every path as an independent
regular file. So the extracted runtime tree has **independent copies where
the sealed archive has hard links**, and `tar --compare` reports
`<path>: Not linked to <first-occurrence>` for 12,672 members — none of which
is Uid/Gid/Mod time, so `verifyArtifactBinding` fails closed. The failure is
therefore a **Stage 10 B bundle-input defect** (runtime transport loses the
sealed payload's link structure), discovered by the harness's fail-closed
source/artifact correspondence gate — precisely the "runtime is mutable
rehearsal, not canonical source" risk the operator flagged. Content bytes are
otherwise intact (zero size/content/mode/existence diffs).

Because a fix requires rebuilding the runtime transport (a Stage 10 B bundle
input, to a **fresh exclusive path with a new receipt — never overwrite or
relabel the delivered v9/bundle-v1 bytes**), it exceeds the "small
runner-integration fix" allowance of this task: **findings returned, no code
changed, no fix applied.**

## Cleanup / ownership receipts

- Disposable cluster: `clusterStartAttempted: false`, `clusterStopped: true`,
  `disposableRootsAbsent: true`, `stopExitCode: null` (no stop was needed —
  the failure preceded cluster start; disposable roots were confirmed absent).
- Attempt `attempt-4d11458a01` is **preserved** (FAIL_PRESERVE is never
  deleted or retried by design). `--cleanup` was correctly NOT run: it is
  gated on a PASS outcome plus retained execution receipt. The attempt
  remains at
  `/home/hermes/.local/share/travelos-stage10-qualification/attempt-4d11458a01`
  for read-only reconciliation (owner hermes uid 1000 throughout; no
  credentials, no persistent application data; synthetic-only).
- Transient unit `travelos-s10-attempt-4d11458a01.service`: exited, collected
  by systemd (`--collect`); no lingering unit state.
- System PostgreSQL / CT200 development services: untouched (verified
  before and after).

## Remaining blockers / next steps

1. **Blocker — runtime transport ≠ sealed artifact payload.** Rebuild the
   runtime transport **from the sealed artifact payload itself**
   (extract `artifact.tar.gz` deterministically, or re-derive from the
   original rehearsal payload) and re-verify with
   `tar --compare` before bundling; deliver under a fresh exclusive
   `t_16e14434-runtime-transport-vN` (+ new bundle version) with new
   receipts. The exact differing files are listed below.
2. Re-run the lane with a **new attempt name** (never replay
   `attempt-4d11458a01`); then `--completed` verification, and `--cleanup`
   only after PASS plus retained receipt.
3. Preserve `attempt-4d11458a01` (or reconcile and archive its receipts)
   before any attempt-parent housekeeping.
4. QA `t_fe5a74c8` remains the independent final validation; nothing here
   authorizes a Stage 10 GO.

## Reproduction diff (local, exact handed-off bytes)

```text
$ tar -xf runtime.tar -C <payload-root>            # exact handed-off bytes
$ tar --compare --gzip --file=artifact.tar.gz --directory <payload-root>
# 39,234 difference lines total:
#   - 26,562 tolerated metadata lines ("Uid differs" / "Gid differs";
#     local scratch runs as uid 1000, the sealed archive as 0/0 — the CT200
#     attempt shows the same tolerated class)
#   - 12,672 REAL differences, every single one of the form:
#     ./apps/<api>/node_modules/.pnpm/.../<file>: Not linked to ./apps/<api>/node_modules/.pnpm/.../<first-occurrence>
#     (hard-link structure only; zero "Size differs", zero content/mode/
#      existence differences)
# compare_exit=1  →  metadataOnly=false  →  "Archive does not match exact
# extracted payload" (identical to the CT200 attempt failure)
```

Fix options for the Stage 10 B owner (not executed here — out of this task's
authority): either extend the transport to preserve hard links (inventory
schema + receipt + packer + unpacker, then rebuild runtime transport and
bundle under fresh exclusive paths with new receipts), or derive the CT200
payload directly from the sealed `artifact.tar.gz` instead of a re-packed
transport tree. Relaxing `verifyArtifactBinding` to tolerate `Not linked to`
would weaken the artifact↔payload correspondence gate and was deliberately
**not** done.
