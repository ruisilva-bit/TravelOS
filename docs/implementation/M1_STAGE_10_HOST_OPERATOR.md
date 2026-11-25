# Stage 10 constrained host operator — mutable local implementation

**Local integration PASS; NOT installed, NOT CT200-ready, NOT finding closure or Stage 10 GO.**

This slice adds the missing version-controlled privilege entry and provision validation around the existing guarded activation CLI. It does not replace the remaining operational qualification, signing custody, independent policy provisioning or removal of existing host bypasses. No CT200 connection or mutation was performed by this slice. Known broad sudo and the unsigned legacy helper remain unresolved; adding a constrained grant cannot subtract them.

## Implementation and threat boundary

- `tooling/deployment/stage10-host-entry.c`: static Linux ELF64 native executable, proposed path `/usr/local/sbin/travelos-stage10-operator`. It accepts exactly one literal action: `validate` or `activate`. No caller file paths, command strings, policy flags, environment preservation, arbitrary interpreters or extra arguments are supported. It is **not setuid**; a separately reviewed sudo rule grants the exact two command lines only.
- Before any interpreter starts, it clears the complete environment and supplies only fixed PATH/HOME/LANG, disables core dumps, sets dumpability to zero and umask 0077, changes cwd to `/`, closes every fd above stderr, and checks root ownership/non-writability/type/single-link properties of the installed entry, protected Python script and resolved host Python executable. Every ancestor, including `/`, must be root-owned, not a symlink and not group/world-writable. A canonical trusted base-OS `/usr/bin/python3` symlink is resolved, but its resolved file and ancestor chain must be protected. Other protected script/entry ancestors may not be aliases.
- It executes only the protected host Python with `-I` and the fixed script `/usr/local/libexec/travelos-stage10/operator.py`. **Static linkage is mandatory:** a dynamic loader could consume LD_PRELOAD before `main` can clear it. A constrained sudoers digest, off-host build inspection and independently protected installation are the bootstrap trust; runtime self-validation cannot make an already malicious executable safe.
- `tooling/deployment/stage10-host-operator.py`: validates the complete installed file hash set, three individually pinned trust documents, their exact schemas and cross-bindings, canonical protected baseline, fixed incoming archive/bundle, public key and Cosign bytes. It rejects duplicate JSON keys, unknown fields and missing fields. All protected files are root-owned single-link regular files, have no setuid/setgid/sticky or group/world-write bits, and have protected root-owned ancestors. Reads use O_NOFOLLOW/O_NONBLOCK and bounds. The script separately verifies its entry has ELF64 little-endian format and no PT_INTERP. Target architecture is Linux x86-64 here; another ABI requires explicit qualification, not fallback.
- The fixed installed host Node, Cosign and the two existing `.mjs` modules are outside both `current` and candidate trees. Activation invokes that pinned host Node with `--no-addons`, fixed argv and a newly constructed environment. No package manager, candidate runtime, shell, migration, service restart, chmod-to-arbitrary-path, rollback or generic command is exposed by this entry. Base-OS Python/stdlib, native loader/shared libraries, `/usr/bin/chmod` used by the existing guard and host root remain trusted platform dependencies; this is not a sandbox against malicious root or a compromised OS.
- Existing `stage10-signature.mjs` and `stage10-activation.mjs` are **unchanged**. Their real signature verification, sealed archive consumption, guarded extraction, fsync and pointer replacement remain mandatory. The new operator cannot override those checks. The new mechanism has no migration capability: attempted `migrate` and `restart` verbs reject before extraction or pointer changes. A separately qualified non-root migration/restart/health chain is still required; do not use a legacy unsigned route to fill that gap.

There is deliberately no privileged installer or trust-update verb. Neither an archive nor its submitting operator can choose or modify installed trust, executors or the approved action. Input admission/provisioning is a separately authorized root-controlled operation. This avoids turning an otherwise restricted activation command into a file-write or trust-pinning oracle.

## Installed provision contract

Additional fixed document: `/etc/travelos/stage10-host-policy.json`, bounded to 16 KiB:

| Field | Exact requirement |
| --- | --- |
| `schemaVersion` | integer `1` |
| `environment` | `DEVELOPMENT` |
| `files` | object mapping **exactly** the seven paths below to lowercase exact-byte SHA-256 |
| `trustDocuments` | object mapping **exactly** the three document basenames below to lowercase exact-byte SHA-256 |

Seven `files` paths:

```text
/usr/local/sbin/travelos-stage10-operator
/usr/local/libexec/travelos-stage10/operator.py
/usr/local/lib/travelos-stage10/node
/usr/local/lib/travelos-stage10/cosign
/usr/local/lib/travelos-stage10/stage10-activation.mjs
/usr/local/lib/travelos-stage10/stage10-signature.mjs
<canonical resolved /usr/bin/python3 path, e.g. /usr/bin/python3.13>
```

Three trust basenames, whose existing schemas are specified in `M1_STAGE_10_SIGNING_ACTIVATION_BOUNDARY.md`:

```text
stage10-development-policy.json
stage10-activation-authorization.json
stage10-qualification-receipt.json
```

The protected public key is fixed at `/etc/travelos/stage10-development.pub`. Inputs are fixed at `/var/lib/travelos-stage10/incoming/<artifactSha256>.tar.gz` and `<artifactSha256>.sigstore.json`. Incoming directory and `/opt/travelos/.stage10-private` must be mode 0700. Baseline must be an existing protected direct release child and exactly match the root-owned `current` symlink. The archive may be at most 1 GiB; bundle 4 MiB; key 64 KiB; installed executable/module hash reads 256 MiB each. These are safety ceilings, not capacity approval.

Host pins and the receipt pin must be obtained from the independently reviewed source/build/trust inventory, not generated by comparing the submitted candidate to itself. The root-protected host document protects *already provisioned* decisions; filesystem ownership does not prove who approved them or that CI, backup, migration or recovery claims are true. Provisioning must independently retain the exact host-policy digest, source/compiled-entry identities, signing-key fingerprint, authorization and qualification-receipt digests and their review provenance. These checks require actual separately controlled evidence. A synthetically populated receipt is never suitable for CT200.

`validate` returns `HOST_PROVISION_STRUCTURE_VALIDATED`, explicitly `signatureVerification: NOT_PERFORMED`, `independentPinProvenance: REQUIRES_EXTERNAL_REVIEW`, `sudoBypassRemoval: NOT_ASSESSED`, and `runtimeAcceptance: NOT_PERFORMED`. It is **not** approval to activate. `activate` calls the existing real signature-enforcing guard and forwards its success receipt. Rejections emit only `STAGE10_HOST_REJECTED` or the guard's existing `STAGE10_ACTIVATION_REJECTED`, exit 1. No raw error, input path, key, bundle or candidate payload is logged.

## Proposed sudo template, not installed

`tooling/deployment/stage10-operator.sudoers.in` grants only the two exact native command lines, using a binary SHA-256 digest and `NOSETENV`. There are no argument wildcards and no shell/Node/Python grants. Render `@OPERATOR@` and `@ENTRY_SHA256@` from reviewed inventory, then validate the **rendered** file with `visudo -cf`. This validation does not inspect actual CT200 policy or remove old grants. The template is not an installation authorization and must not be copied with placeholder tokens.

## Real local tests and exact extracted release

`tooling/deployment/test-stage10-host-operator.py` always constructs new user/mount namespaces; no caller child-mode, inherited attestation or environment switch can bypass construction. It first mounts fresh `/etc`, `/opt`, `/var` and `/usr`, then creates a fresh tmpfs chroot with root-owned `/`, preserving trusted base-OS libraries through namespace-only read bindings. The synthetic root can therefore meet the real ownership checks without relaxing them. Every mount/subprocess failure is fatal. All fixtures and ephemeral synthetic keys are removed when the process/namespace exits; nothing is installed in real `/etc`, `/opt`, `/usr` or `/var`. The test's saved host-library mounts are not a claim of CT200 host-root qualification.

One sequential integration scenario exercises the actual statically compiled native entry, installed dispatcher and unchanged real Cosign/activation implementation:

- Full poisoned NODE_OPTIONS/NODE_PATH/PYTHONPATH/PYTHONSTARTUP/LD_PRELOAD/LD_LIBRARY_PATH/PATH/HOME environment; no injection marker and no dynamic-loader warning.
- Root-installed native-boundary probe proves Python isolated mode, clean allowlisted environment, cwd `/`, zero core limit and closure of inherited fd 234. This is a disposable replacement probe under the test's root control, not a production script mode.
- A genuinely wrong-owner host Python inode with **identical pinned bytes** is bind-mounted temporarily; the entry rejects it. This exercises actual kernel ownership, not a mock.
- Group-writable ancestors/files, symlink script/Node/host policy/archive, hash-drifted script, unknown host policy field, wrong key, missing/invalid signature bytes and unsupported action/extra-argument attempts all reject with sanitized output and unchanged baseline/no extracted target. A real inotify observer, checked with a positive-control write before each invocation, proves no release target was even created/moved transiently on these rejection paths; this is stronger than an after-the-fact cleanup assertion.
- The test reprovisions synthetic pins to match a tampered archive while preserving the original signature: actual Cosign still rejects. It also pins an invalid bundle/receipt consistently: Cosign still rejects before extraction. Pins alone cannot substitute for authentication.
- Successful real guard invocation selects a digest tree; every tar regular member's bytes are compared to extraction. Replay rejects. Existing independent signature tests additionally cover malicious archive members, sealed-input writer attacks and fsync failure windows.

Pinned local Node: `24.19.0`; Python `3.13.5`; Cosign `3.1.3` SHA-256 `4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71`.

From `/home/hermes/.hermes/worktrees/travelos-stage10`:

```sh
export TRAVELOS_NODE=/home/hermes/.local/share/travelos-stage5-toolchain/node_modules/node/bin/node
export TRAVELOS_COSIGN=/home/hermes/.hermes/cache/scratch/travelos-stage10-cosign-3.1.3
python3 tooling/deployment/test-stage10-host-operator.py
```

Result: **PASS**, **34 rejected cases**, replay rejection, native environment/fd probe PASS, two synthetic regular payload members compared. This is one integration scenario, not 34 separately counted tests.

Exact-artifact rehearsal (read-only predecessor source; no CI rerun, historical signing claim or archive modification):

```sh
TRAVELOS_REHEARSAL_ARCHIVE=/home/hermes/.hermes/worktrees/travelos-stage9/.hermes/state/stage9-gen11-artifact.tar.gz \
TRAVELOS_REHEARSAL_SHA256=8b74c305c12eecb9339acdd777449fbdb0b3bf25c498d87a2c7d43931bb6d125 \
TRAVELOS_REHEARSAL_ARTIFACT_ID=travelos-stage9-gen11-d6610462 \
python3 tooling/deployment/test-stage10-host-operator.py
```

The independent archive pin was read from the unchanged Stage 9 `docs/evidence/phase-1-m1/stage-9/gen11/candidate-freeze.json` and matched the actual archive. Detached signing in this rehearsal uses **only a disposable synthetic fixture key**, not the approved durable development signer and not a retroactive Stage 9 qualification. Synthetic trust receipts explicitly do not evidence real CI/backup/restore/migration gates.

Result: **PASS**, 34 rejections, native probe PASS, pointer activation read back, **10650 tar regular members byte-compared**. The trusted local `tooling/ci/stage-9/artifact-integrity.mjs` was then run against the actual protected extracted tree, reading candidate bytes/JSON only; neither candidate runtime nor candidate code was executed as root. Its result was **PASS**, `entries: 25202`, `files: 23760`, migration head `0016_stage9_staff_invitations`, source snapshot `d661046212cc291122ae126953bdedf93fcac15b3a4928bf5f9b25b0354488e9`, deployment-extension SHA-256 `b8522bc68a7bc9cffe491e5ef975ca9c8b82b2021b404c423ab9b03bcbe8a825`, both shells with two assets. Tar regular entries exclude hardlink members; the complete artifact inventory verifier covers the materialized file/link paths too. No runtime, HTTP, authentication, live systemd credential, database migration or restore acceptance is inferred.

Other executed verification:

- `cc -std=c17 -O2 -Wall -Wextra -Werror -static ...`: exit 0. `readelf -l` shows **no INTERP**. Local compiled binary `/home/hermes/.hermes/cache/scratch/travelos-stage10-host-entry`, SHA-256 `3eaa4750b345fb388fbe96c47f6ec02f53621e95b6f2cce58efa424db7868f7d` (local build identity, not a portable/reproducible-build promise).
- Rendered sudo template using a synthetic operator and that binary hash: `/sbin/visudo -cf /home/hermes/.hermes/cache/scratch/travelos-stage10-rendered-sudoers` → `parsed OK`, exit 0. No host sudoers changed.
- Existing isolated signature/activation suite: **1 pass, 0 failed, 0 skipped**, exit 0.
- Both existing TypeScript typechecks: exit 0. Python AST parses: PASS.
- Existing Stage 9 development-apply tests: **8 pass**, exit 0.
- `pnpm test:unit` using pinned Node/Corepack: **65 files / 369 tests passed**, exit 0. No canonical CI invoked.

Current scratch logs, mutable and not frozen/privacy-reviewed evidence:

```text
/home/hermes/.hermes/cache/scratch/travelos-stage10-host-operator-red.log
/home/hermes/.hermes/cache/scratch/travelos-stage10-host-schema-red.log
/home/hermes/.hermes/cache/scratch/travelos-stage10-host-operator-final.log
/home/hermes/.hermes/cache/scratch/travelos-stage10-host-exact-rehearsal.log
/home/hermes/.hermes/cache/scratch/travelos-stage10-host-signature-regression.log
/home/hermes/.hermes/cache/scratch/travelos-stage10-host-unit.log
```

The first RED was a clear assertion that the native entry did not exist. A second test-first RED proved that Python's `True == 1` could incorrectly let structure-only validation accept a boolean receipt `schemaVersion`; explicit integer type checking corrected it, and both final rehearsals reject that provision. Initial GREEN attempts uncovered and corrected fixture problems (unmapped host-root ancestors, inherited group-write umask, tmpfs syscall flag placement, and recursive binding of locked `/proc` submounts). Production checks were not waived; the fresh chroot makes their real requirements testable. Those setup failures were not CT200 failures.

## Exact mutable source identities

| File (`tooling/deployment/`) | SHA-256 |
| --- | --- |
| `stage10-host-entry.c` | `88f1e2fbdb8b6f455e23c4e9b9912b0a79bee50b5571d6b33efe48d7dd70032b` |
| `stage10-host-operator.py` | `207fb54e1ea7f01d3f4b241533b0d21bcd95b97a0383996e85920c8f0c4e35af` |
| `test-stage10-host-operator.py` | `494303d582f6162e21e501d33514d976797d689a5bc25934abe6e4d1717c4125` |
| `stage10-operator.sudoers.in` | `734601c76714ba4a172efa8811c4cded27377c6783a865424ea5f81538038db3` |

Existing unchanged signing module: `d29dcb5fcec8bd4ae15a579e022bca038701a8f0d5835c0a6eec65a6d421d6f1`; activation module: `bbbf03515c6e2d634fd6238a02da7b4a5c88fa7ffa8b80b61fe40c399ed41b34`. These are identities for independent review, not approval or a frozen candidate.

## Separately authorized installation and proven continuity — STILL REQUIRED

1. Obtain fresh independent review of exact new source, compiled-entry identity, host-policy provenance and the existing guard. No author closes S10-SIG-001/002 or the other independent findings. Keep production OIDC requirements unchanged.
2. Qualify actual CT200 kernel/proc/memfd seals/close_range/Python/tar filtering/Node/shared libraries/static-ELF ABI/filesystem fsync/storage/memory/headroom and installed path ownership/ACLs. Do not compile on CT200. The local namespace/chroot is not a real host privilege or power-loss qualification.
3. Establish an approved protected durable development signer, independent public-key pin distribution, recovery, rotation and revocation. This slice creates none. Use actual candidate qualification, restore-point and migration-compatibility evidence; never install fixture PASS receipts.
4. Prepare versioned off-host provisioning inputs for the exact executable/modules/trust/inputs/ownership/modes and capture independently reviewed hashes. Install them only through separately authorized root provisioning, initially without granting the operational principal access. Confirm baseline/current identity and actual service unit/credential references without exposing secrets.
5. Before policy cutover, prove an independent emergency/console administration route and ordinary automation continuity; inventory every effective sudo include, alias, supplementary group, legacy helper, polkit and writable-service/privileged-script path. An already-open root shell alone is not proof of durable recovery access. Review/validate the complete replacement policy, not just the new fragment.
6. Through the separately approved continuity window, replace broad `NOPASSWD: ALL` and every unsigned activation bypass; do not merely add this rule. Do not expose the proposed restricted operator while broad/legacy bypasses remain. Test as the real operational principal after cutover: the two approved exact native commands behave as designed; arbitrary shell/Node/Python, SETENV/injection, extra args, legacy activate, arbitrary service control and trust-file writes fail. Keep the independent recovery path available until readbacks pass. No sudo-policy modification is authorized by this document.
7. Independently qualify a constrained signed migration/service-restart/health/recovery path before any real deployment needs those operations. This entry changes only the release pointer; it does **not** restart current services. Do not claim full operator-chain continuity or sign-before-migration enforcement on CT200 while legacy paths remain.
8. With a current reviewed restore point and migration status, run exact real-signer negatives and a separately authorized activation/restart/runtime acceptance, retaining exact signed receipts through the reviewed evidence path. For ambiguous/post-rename failures inspect the actual pointer and preserve the selected tree; follow the existing no-automatic-rollback/no-destructive-down-migration recovery rules. Actual auth/routing/worker/restore acceptance remains required.

No CT200 writes, sudoers installation, service restart, persistent key/credential creation, canonical CI, frozen predecessor change, commit, push, merge, production work or Stage 11 action was performed. This document records a locally working least-privileged entry candidate, not host deployment permission.
