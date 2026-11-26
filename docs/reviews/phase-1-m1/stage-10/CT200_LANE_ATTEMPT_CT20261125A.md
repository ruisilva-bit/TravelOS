# Stage 10 C — CT200 lane attempt `attempt-ct20261125a` (2026-11-25/26)

**Outcome: FAIL_PRESERVE.** The hard-link defect that stopped
`attempt-4d11458a01` is fixed: artifact binding now passes and the runner reached
the disposable PostgreSQL start. The cluster then refused to start because its
Unix-domain socket path exceeds PostgreSQL's 107-byte limit. **0 of 95 assertions
ran.** Not a Stage GO, not canonical, no test waived or disabled.

Scope: CT200 `travelos-dev`, DEVELOPMENT, uid 1000 `hermes`. Synthetic data only,
loopback only. No signing, custody, deployment to `/opt/travelos`, rollback,
backup/restore, DNS/TLS/firewall or Stage 11 action.

## 1. Host health (after the 2026-11-25 `pct fsck 200`)

| Check | Result |
|---|---|
| `findmnt /` | `/dev/loop0 ext4 rw,relatime,discard` (no `emergency_ro`) |
| `touch ~/rw-test && rm ~/rw-test` | OK |
| `df -h /` at start | 20G, 12G used, 7.5G free |
| `pg_lsclusters` | `18 main 5432 online` |
| `postgresql@18-main` | `active (running)`; untouched throughout |

## 2. Reconciliation

- `attempt-4d11458a01` is present and preserved, with no modifications (its 13
  manifest entries were re-hashed with zero mismatches; manifest
  `8768ef0e…f9a3`).
- No `/tmp/travelos-*` and no browser processes.
- The user manager was not running (no `/run/user/1000`, no linger). It was
  started transiently with `sudo systemctl start user@1000.service`, without
  enabling linger. After that: 0 `travelos-s10-*` units, 0 failed units, and
  cgroup delegation `cpu memory pids`.

## 3–4. Code and local qualification

- `main` @ `d9ebb2627d7104f9ff2b2c87b1def42f17c4053e`. The Debian `git`
  package was installed because it was absent.
- Toolchain: Node 24.19.0 (archive SHA-256 checked by the bootstrap), pnpm 11.21.0.
  Finding: `bootstrap-toolchain.sh` calls `corepack`, whose shebang is
  `#!/usr/bin/env node`, so the script fails with exit 127 unless the Node `bin`
  directory is already on `PATH`. It succeeds once `PATH` is set.
- `pnpm install --frozen-lockfile`: OK.
- **`pnpm ci:verify`: PASS, all 20 gates** (7m30s). This includes `test:unit`
  (69 files / 464 tests) and `test:postgres` on PostgreSQL 18.6, loopback only:
  177 passed, 0 failed. The 1 skip is the intentional Stage 9 browser-acceptance
  case, which only runs when `TRAVELOS_STAGE9_BROWSER_ACCEPTANCE=1`, i.e. inside
  the Stage 10 lane.
- Stage 10 qualification Python tests on `main`: transport 31 OK, resource 4 OK,
  remote 9 OK. **package: 1 FAIL that already exists on `main`.**
  `test_copy_preserves_source_and_rejects_occupied_or_escaping_links` expects
  `node_modules/link` to stay a symlink, but `copy_harness` deliberately copies
  `node_modules` with `symlinks=False`. Neither the test nor the code was
  changed. This needs an owner decision.

## 5. New runtime transport (derived from the sealed artifact)

`build-artifact.mjs` keeps its `assertPipelineReady` brake. The previous runtime
package came from an untracked rehearsal script on another host. So instead of
building a new artifact, the runtime was derived from the **exact sealed**
`artifact.tar.gz` (fix option 2 in `CT200_LANE_HANDOFF.md`). All bundle-v1 bytes
were kept except `runtime.tar` and the hard-link-capable
`stage10-qualification-transport.py` from `main`. Nothing under `t_16e14434-*`
or `attempt-4d11458a01` was overwritten.

| Step | Result |
|---|---|
| `tar --extract --gzip` of `artifact.tar.gz` (`257498ad…497e`) to a new path | 22,344 multiply-linked files preserved |
| `tar --compare` against that extraction | 0 `Not linked to`; only Uid/Gid lines |
| `qualify-stage10-host-rehearsal.mjs` with the payload Node (`bc17c508…5e12`) and independent pins (receipt `60e6af25…`, inputs `10e5f6b7…`) | `PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED` (both harness and `main` versions) |
| New `runtime.tar` | `3bce4ef9f3c907eb0e95c4d32bf1a61dc3d329c0f6f182a594a3fc1fdb3a09a5`, 438,118,400 B, 31,567 entries (4,173 dir / 13,280 file / **12,672 hardlink** / 1,442 symlink) |
| `transport.unpack` readback, then `tar --compare` | **0 `Not linked to`, 0 non-tolerated lines** (Uid/Gid/Mod time only) |
| New bundle `manifest.json` | `a7e06aa34ce6083344db85149c811e8b77de35c125f9a9055023b95fa6171bb8` |

The bundle `manifest.json` lists these hashes:

```text
artifact.tar.gz                    257498add66ddd70de11a37f69bd7e6970cd9e0b66a2f8a16b110c3fa4e6497e  (reused)
browser.tar                        6c22c60a791cfb125771544ed2f268da6d0062a331a9a251bec2d79735e35eaf  (reused)
harness.tar                        fa778ea7b22723be9dae3b09159d665aee14140c26b0c18248959ead43734ecf  (reused)
predecessor.tar.gz                 8b74c305c12eecb9339acdd777449fbdb0b3bf25c498d87a2c7d43931bb6d125  (reused, = PREDECESSOR_SHA)
runtime.tar                        3bce4ef9f3c907eb0e95c4d32bf1a61dc3d329c0f6f182a594a3fc1fdb3a09a5  (new)
stage10-qualification-transport.py fe7ad2102b276b0aba9f07a10a1821c1718ea8bece28c237628755fe1bb67497  (main)
stage10-qualification-remote.py    f4ef4c01a89a4cbf2d0b7b09a1a0a1ee8c1ee52eca68c1f60e5b0a1f1abd0665  (unchanged)
stage10-qualification-resource.py  817d1eecdd8c6fb3b245f68ac916a6bc12fac664d67ce695fd8c7869737f04e6  (unchanged)
```

The work files are kept on CT200, outside git: the sealed extraction is in
`~/.local/share/travelos-stage10-work/rt-20261125a/` and the bundle in
`bundle-v2-20261125a/`.

## 6. Lane run

`stage10-qualification-remote.py --run` on the new attempt `attempt-ct20261125a`
(14 files, `checked()` OK). The harness runner is
`run-stage-10-postgres-disposable.mjs` `d30de7be…88c7`, identical on `main`.

- `prepare()` took about 18 minutes (per-file fsync). The operator's 20-minute
  shell timeout killed the parent `--run` process while it waited. The transient
  unit is owned by the user manager, so it kept running to completion. For that
  reason `unit-stdout.log` and `unit-stderr.log` are absent, and the child
  receipt is the authority.
- `remote-outcome.json` (SHA-256 `8b4416ec…0b13`):

```json
{"cleanup": {"clusterStartAttempted": true, "clusterStopped": true, "disposableRootsAbsent": true, "stopExitCode": null},
 "executionSha256": "e46a561c1c3f467352fbecd10a358cc817cb29162e7d84a86416ddd43115461b", "primaryExit": 1,
 "resource": {"coreLimits": [0, 0], "cpuMax": "100000 100000", "memoryMaxBytes": 2147483648, "memorySwapMaxBytes": 0,
              "pidsMax": 128, "scope": "SYNTHETIC_RESOURCE_PREFLIGHT_ONLY", "uid": 1000},
 "result": "FAIL_PRESERVE", "scope": "CT200_DIAGNOSTIC_NOT_CANONICAL"}
```

- `execution.json`: `artifactBinding` present, which means binding **passed**
  (`receiptSha256 60e6af25…`, `inputsSha256 10e5f6b7…`, `browserAcceptance: true`).
  PostgreSQL is 18.6 (180006) with data checksums. The failure was
  `pg_ctl start failed: pg_ctl: could not start server`, and `assertionResults`
  is null.

### Root cause (reproduced)

`remote.py` sets `TMPDIR=<attempt>/scratch`. The runner then places the socket at
`<TMPDIR>/travelos-stage10-full-pg-XXXXXX/socket/.s.PGSQL.<port>`, which is
**138 bytes** for this attempt and 137 bytes for `4d11458a01`. PostgreSQL's limit
is 107 bytes. A synthetic loopback cluster with an over-long
`unix_socket_directories` reproduced the exact failure:
`Unix-domain socket path "…" is too long (maximum 107 bytes)` followed by
`FATAL: could not create any Unix-domain sockets`. `ATTEMPT_PARENT` alone is
56 bytes, so **every** valid attempt name fails. The cause is not specific to
this attempt and not an environmental fault.

### Cleanup and state

- Disposable cluster stopped and roots absent. Attempt preserved (FAIL_PRESERVE
  is never deleted or retried).
- No `travelos-s10-*` units, no leftover postgres or browser processes, no
  `/tmp/travelos-*`.
- The system cluster `18/main` is online and was untouched.
- Disk is now at 88% (2.4G free). Before the next attempt (about 2.5G), the
  operator should decide on retention of the two attempts (about 2.6G and 1.3G)
  and the work directory (about 1.8G).

## Remaining / next (not done)

1. **Blocker:** shorten the disposable socket path in
   `run-stage-10-postgres-disposable.mjs`. One option is a short
   attempt-owned `mkdtemp` (for example under `/tmp/travelos-s10-XXXXXX`) used
   only for `unix_socket_directories`, with cleanup and `disposableRootsAbsent`
   covering it. Then rebuild the harness, which requires resolving the
   `stage10-qualification-package.py` test conflict first, build a fresh
   bundle, and run a new attempt. Run `--run` detached from any short shell
   timeout.
2. Make `bootstrap-toolchain.sh` export the Node `bin` directory onto `PATH`
   before calling `corepack`.
3. After a 95/95 PASS with `expectedTests: 95`, run `--completed`, and run
   `--cleanup` only with the retained `executionSha256`.
4. Signing/custody, deploy to `/opt/travelos`, rollback and backup/restore need
   Rui's explicit approval. Stage 11 follows after that.

---

# Follow-up: `attempt-ct20261126a` (2026-11-26) — socket fix verified, CPU budget blocker

**Outcome: FAIL_PRESERVE.** The disposable PostgreSQL started and the Stage 10 Vitest lane
**executed**. One inherited test timed out. **0 of 95 assertions were recorded as passed**:
`assertionResults` is empty because the suite failed. Not a Stage GO. No test was waived.

## Fixes applied (branch `claude/stage10-ct200-20261125`)

- `tooling/database/run-stage-10-postgres-disposable.mjs`: the socket now lives in its own
  short private root, `mkdtemp("/tmp/travelos-s10-sock-")` (about 42 bytes). The 107-byte
  limit is asserted before `initdb`, and the root is included in `disposableRootsAbsent`.
  The `test-postgres-cleanup-exit.mjs` fixture now reads the real
  `unix_socket_directories` value and removes any retained root.
- `tooling/deployment/stage10-qualification-package.py`:
  - The accepted-pin regex now also matches Prettier-wrapped pairs. Since `503d701`, every
    harness build failed with `STAGE10_ACCEPTED_SET_REJECTED`.
  - `node_modules` symlinks are preserved again, matching the package test and the v9
    harness, which had 1,508 symlinks.
- `tooling/ci/bootstrap-toolchain.sh`: the pinned Node is on `PATH` before `corepack` runs.
- Runner node tests, with `TMPDIR` set: 17 pass, 1 skip. The 1 failure is pre-existing
  on `main` and environmental (`test-postgres-browser-adapter`: no local Playwright
  Chromium under `~/.cache`). The package test now passes 4/4.

## Harness v10: why it is not built from `main`

The packager requires `tests/integration/stage-6-publication-postgresql.test.ts` and
`stage-7-postgresql.test.ts` to equal the accepted gen11 bytes. On `main` they were changed
afterwards (for example `cd7e041`). So harness v10 was built from a worktree at `2c479ee`,
whose key files equal harness v9, plus only the socket fix (`0dece07` on local branch
`claude/stage10-harness-v10-src`), after `pnpm build`.

Compared with v9: the same 26,976 paths except 6 cache entries. Content differs only in the
runner and its fixture, plus three packaging-tooling files that the lane does not use.

- `harness.tar`: `b28ebac955cb58270f50489923568c16cd6ef0ecc9828d8ae36c0a6bec118f28`
  (300,093,440 B).
- Bundle v3 `manifest.json`: `e64551d61f34d01a70283defdc89510eba04c56d2c1c81082ce0705f0273e40b`.
  Runtime `3bce4ef9…`, artifact, browser and predecessor are unchanged.

## Lane run

The run was launched detached (`setsid nohup`), so this time it completed with its unit
logs.

- Unit: 11 min 7 s wall, 5 min 20 s CPU, **memory peak 1.8G of 2G**, swap 0.
- Vitest: 4 files and 46 tests collected. The first Stage 7 test,
  `authenticates the acceptance runner against a real DEVELOPMENT Staff MFA realm`,
  **timed out at 360000 ms**, and the remaining tests in that file did not run. `testExitCode` was 1.
- `remote-outcome.json` (`7f3dd239…`):

```json
{"cleanup": {"clusterStartAttempted": true, "clusterStopped": true, "disposableRootsAbsent": true, "stopExitCode": null},
 "executionSha256": "14b68c593570883276a9bdd81d0f99cf81f92be234a51f4475d7c5a8ea28c67a", "primaryExit": 1,
 "resource": {"coreLimits": [0, 0], "cpuMax": "100000 100000", "memoryMaxBytes": 2147483648, "memorySwapMaxBytes": 0,
              "pidsMax": 128, "scope": "SYNTHETIC_RESOURCE_PREFLIGHT_ONLY", "uid": 1000},
 "result": "FAIL_PRESERVE", "scope": "CT200_DIAGNOSTIC_NOT_CANONICAL"}
```

## Diagnosis: CPU budget

The timed-out test runs `tooling/ci/stage-10/rehearse-acceptance.mjs`, which calls the
packaged `deployment/verify-artifact.mjs` **three times** (lines 106, 161 and 246). It also
starts the services, migrates and runs the MFA flow, all inside the accepted test's
**fixed 360 s timeout**. That test is pinned to the gen11 bytes and cannot be edited.

The packaged verifier alone was timed in separate diagnostic units with the same limits
(`CPUQuota=100%`, `MemoryMax=2G`, `TasksMax=128`), reading the preserved runtime without
changing it. Both runs returned `rc=0 PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED`:

| Run | Wall time | CPU time |
|---|---|---|
| 1 | 89.5 s | 64 s |
| 2 | 64.4 s | 63.8 s |

The verifier is CPU-bound, so three calls use roughly 190–270 s of the 360 s on one CPU.
CT200 has 4 CPUs.

## Decision needed (not done)

Raising the bounded unit's `CPUQuota` (for example to 300%) and checking the `MemoryMax`,
`RuntimeMaxSec` and child/parent timeouts in `stage10-qualification-remote.py` is a change
to the reviewed runner resource policy. That requires explicit approval.

Disk is at about 91% (1.8G free). A new attempt needs about 2.5G, and the preserved
FAIL attempts (`4d11458a01` about 2.6G, `ct20261125a` about 1.4G, `ct20261126a` about 2.4G)
may only be removed or archived by operator decision.
