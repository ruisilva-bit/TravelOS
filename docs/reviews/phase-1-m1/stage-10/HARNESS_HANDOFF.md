# Stage 10 B — CT200 Test Harness and Bounded Runner Handoff

**Scope:** assemble and inventory an executable CT200 test harness, separately
verify the extracted application runtime, and wire the bounded remote runner and
cleanup. This is a bounded Stage 10 B deliverable only; it is **not** a full
Stage 10 GO, canonical qualification, signing/custody cutover, or production
activation. No full 95-case remote run was performed in this task; only local
fixtures, read-only CT200 preflight, and focused inverse tests were run.

## Authority and constraints

- Existing Stage 1–9 accepted artifacts remain immutable; no predecessor bytes
  changed.
- No commit, push, merge, candidate freeze, signing-key provisioning, or
  operational cutover was performed.
- TCP `127.0.0.1` synthetic PostgreSQL only, with attempt-owned port/data/socket,
  no persistent application credentials, no wildcard bind.
- Failed/unknown attempts are preserved; no blind retry.
- Browser/native CT200 dependencies and bounded user unit were reconciled from
  run78 retained evidence.

## Built harness archive (current)

| Path | Description |
|------|-------------|
| `.hermes/state/t_16e14434-harness-v9/harness.tar` | Inventoried test harness with locked pnpm v9 lockfile and dev-deps |
| `.hermes/state/t_16e14434-harness-v9/harness.receipt.json` | Transport receipt for the harness |

- **harness.tar SHA-256:** `fa778ea7b22723be9dae3b09159d665aee14140c26b0c18248959ead43734ecf`
- **harness.tar bytes:** 300093440
- **harness.tar entries:** 26982
- **Lockfile:** `pnpm-lock.yaml` version 9.0
- **Accepted predecessor blobs inside harness:** 7 files pinned under
  `harness/accepted-blobs/`, replacing any remote `git show` on CT200.

The harness contains the exact source trees required for the Stage 10 PostgreSQL
runner, the pinned accepted predecessor bytes, and the locked dependency tree
(`node_modules` via symlinks preserved by the transport packer).

## Extracted application runtime (separately verified)

| Path | Description |
|------|-------------|
| `.hermes/state/t_16e14434-runtime-transport-v1/runtime.tar` | Extracted Node/runtime + built application artifacts |
| `.hermes/state/t_16e14434-runtime-transport-v1/runtime.receipt.json` | Transport receipt |

- **runtime.tar SHA-256:** `081613698c89640a842e925b692f6e9aa402d505015d01a4f0df9d9fe935b5c7`
- **runtime.tar bytes:** 584765440
- **runtime.tar entries:** 31567
- Extracted Node binary SHA-256 prefix: `bc17c508ffeed0ec`
- The runtime was originally produced by the mutable production rehearsal and
  re-verified locally by unpacking and inventorying `runtime.tar` against its
  receipt; it is **not** a canonical release artifact.

## Browser binary (retained from run78)

| Path | Description |
|------|-------------|
| `.hermes/state/run78-browser-headless-shell-1234.tar` | Headless Chromium 151.0.7922.34 archive (292 entries) |

- **browser.tar SHA-256:** `6c22c60a791cfb125771544ed2f268da6d0062a331a9a251bec2d79735e35eaf`
- Transport receipt: `.hermes/state/run78-browser-headless-shell-1234.receipt.json`

## Full CT200 input bundle

| Path | Description |
|------|-------------|
| `.hermes/state/t_16e14434-bundle-v1/` | Complete CT200 attempt input set |

- **manifest.json SHA-256:** `8768ef0efb80a08121cb2202a407c4278ddac404f2f705570816a2a675c1f9a3`

The bundle includes:

- `harness.tar` + `harness.receipt.json`
- `runtime.tar` + `runtime.receipt.json`
- `browser.tar` + `browser.receipt.json`
- `artifact.tar.gz` + `receipt.json` + `inputs.json` (mutable rehearsal artifact)
- `predecessor.tar.gz` (Stage 9 gen11 artifact)
- `stage10-qualification-transport.py`
- `stage10-qualification-resource.py`
- `stage10-qualification-remote.py`

All manifest entries were verified against their SHA-256 hashes; the three tar
archives were each re-verified against their transport receipts.

## Remote runner / cleanup

The bounded runner is implemented in
`tooling/deployment/stage10-qualification-remote.py`:

- `--run <attempt>` packages the attempt inside a transient user-systemd unit
  (`MemoryMax=2 GiB`, `MemorySwapMax=0`, `TasksMax=128`, `CPUQuota=100%`,
  `RuntimeMaxSec=900`, `LimitCORE=0`) and executes the child.
- `--child <attempt>` verifies inputs, inventories extracted harness/runtime/
  browser, runs `tooling/database/run-stage-10-postgres-disposable.mjs` against
  an attempt-owned loopback PostgreSQL cluster, and preserves stdout/stderr plus
  the execution receipt.
- `--completed <attempt>` verifies the post-run receipt, exact cleanup flags,
  and all 95 assertion statuses before allowing removal.
- `--cleanup <attempt> <executionSha256>` removes the attempt only after
  confirming the transient unit is inactive/not-found and the external receipt
  hash matches.

Primary exits are preserved; unknown/failed attempts are never deleted or
retried.

## Focused inverse tests executed

All tests below returned exit 0 in this session.

```text
python3 -B tooling/deployment/test-stage10-qualification-transport.py -v
# 21 tests PASS

python3 -B tooling/deployment/test-stage10-qualification-resource.py -v
# 4 tests PASS

python3 -B tooling/deployment/test-stage10-qualification-package.py -v
# 4 tests PASS

python3 -B tooling/deployment/test-stage10-qualification-remote.py -v
# 9 tests PASS

node --test tooling/ci/stage-10/test-postgres-cleanup-exit.mjs \
           tooling/ci/stage-10/test-postgres-receipt-preservation.mjs \
           tooling/ci/stage-10/test-postgres-browser-adapter.mjs \
           tooling/ci/stage-10/test-stage10-postgres-cleanup.mjs
# 17 pass, 1 skip, 0 fail
```

## CT200 read-only preflight

```text
python3 -B tooling/deployment/stage10-qualification-transport.py --preflight
```

Result (excerpt): `uid=1000`, PostgreSQL 18.6 tools present and executable,
browser native libraries present, `scope=READ_ONLY_METADATA_NOT_QUALIFICATION`.
No runtime was executed on CT200 in this task.

## Exact reproduction commands for the next operator

### 1. Rebuild harness from the current worktree

```bash
cd /home/hermes/.hermes/worktrees/travelos-stage10
rm -rf .hermes/state/t_16e14434-harness-v9
python3 -B tooling/deployment/stage10-qualification-package.py \
  . .hermes/state/t_16e14434-harness-v9
```

### 2. Rebuild the full CT200 input bundle

```bash
cd /home/hermes/.hermes/worktrees/travelos-stage10
rm -rf .hermes/state/t_16e14434-bundle-v1
python3 -B tooling/deployment/stage10-qualification-bundle.py \
  . .hermes/state/t_16e14434-bundle-v1 \
  .hermes/state/t_16e14434-runtime-v1 \
  .hermes/state/t_16e14434-harness-v9
```

### 3. Verify the bundle locally before transfer

```bash
cd /home/hermes/.hermes/worktrees/travelos-stage10
python3 - <<'PY'
import json, hashlib, importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('transport',
    'tooling/deployment/stage10-qualification-transport.py')
transport = importlib.util.module_from_spec(spec); spec.loader.exec_module(transport)
base = Path('.hermes/state/t_16e14434-bundle-v1')
manifest = json.loads((base / 'manifest.json').read_bytes())
for name, expected in manifest.items():
    actual = hashlib.sha256((base / name).read_bytes()).hexdigest()
    assert actual == expected, name
for prefix in ('harness', 'runtime', 'browser'):
    receipt = json.loads((base / f'{prefix}.receipt.json').read_bytes())
    transport.verify(base / f'{prefix}.tar', receipt)
print('bundle verified')
PY
```

### 4. CT200 read-only preflight

```bash
cd /home/hermes/.hermes/worktrees/travelos-stage10
python3 -B tooling/deployment/stage10-qualification-transport.py --preflight
```

### 5. Run on CT200 (next card only — do not run here)

On CT200, after copying the bundle contents into an attempt directory, e.g.
`/home/hermes/.local/share/travelos-stage10-qualification/attempt-<id>`:

```bash
/usr/bin/python3 -B -I stage10-qualification-remote.py --run /home/hermes/.local/share/travelos-stage10-qualification/attempt-<id>
```

Then, only if the run produced `PASS` and the execution receipt hash is known:

```bash
/usr/bin/python3 -B -I stage10-qualification-remote.py --cleanup /home/hermes/.local/share/travelos-stage10-qualification/attempt-<id> <executionSha256>
```

## Source script hashes

| File | SHA-256 |
|------|---------|
| `tooling/deployment/stage10-qualification-package.py` | `b3d2bc21b2a7a188ad30a585f71cd37bb9180d35f9c8637200db08466385907c` |
| `tooling/deployment/stage10-qualification-bundle.py` | `3854035f0a002ac9ccace34796f6358e224021f538fd40fa026f63cb103b09bb` |
| `tooling/deployment/stage10-qualification-remote.py` | `f4ef4c01a89a4cbf2d0b7b09a1a0a1ee8c1ee52eca68c1f60e5b0a1f1abd0665` |
| `tooling/deployment/stage10-qualification-transport.py` | `fc16c2b27550e7fd28fb173c1d94790040e5f482067e856bced48e5ac7c5f553` |
| `tooling/deployment/stage10-qualification-resource.py` | `817d1eecdd8c6fb3b245f68ac916a6bc12fac664d67ce695fd8c7869737f04e6` |
| `tooling/database/run-stage-10-postgres-disposable.mjs` | `d30de7bedc96c23e7f9127ca988ef76b01d26d17b509121ce52d754e027888c7` |

## What was intentionally not done

- No full 95-case remote CT200 run.
- No canonical candidate freeze, signing key provisioning, or operational
  cutover.
- No production deployment, migration, backup, service restart, or Stage 11
  action.
- No commit, push, or merge.

## Status

Stage 10 B harness/runner deliverable assembled; reproducible focused tests
and read-only CT200 preflight pass. The CT200 full-run gate remains for the
next card under the existing umbrella task.
