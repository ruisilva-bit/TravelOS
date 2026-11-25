# Stage 10 signing and activation boundary — mutable local implementation

**Status: locally exercised component, NOT CT200 qualification, NOT finding closure, NOT Stage 10 GO.** This document records author implementation/validation; it is not independent review. The original signing decision, Stage 9 bytes, early reviews and adjudications are unchanged.

## Files and guarantees

- `tooling/deployment/stage10-signature.mjs`: fixed protected trust documents; bounded private input copies; Linux sealed memfd snapshots for archive, signature bundle, verification key and pinned Cosign executable. Cosign verifies the sealed descriptors, and consumption uses that same sealed archive descriptor. `F_SEAL_WRITE`, `F_SEAL_GROW`, `F_SEAL_SHRINK` and `F_SEAL_SEAL` prevent subsequent byte mutation. A separate same-UID process attempts overwrite, shrink and growth and must receive `EPERM`. This is stronger than pre/post hashing a writable snapshot. Caller-controlled FIFOs are opened nonblocking and rejected as non-regular files instead of blocking the privileged process.
- `tooling/deployment/stage10-activation.mjs`: actual DEVELOPMENT pointer activation, with mandatory signature verification, not an injectable activation callback. It requires independently protected authorization and qualification receipt, extracts only the sealed verified archive to a fresh digest-named tree, rejects unsafe archive paths/links/special entries/duplicates, restricts expanded size/member counts, validates signed release identity, removes write bits and atomically replaces `/opt/travelos/current`. It checks baseline and protected document hashes again before switching. It never calls the historical unsigned activation helper, runs candidate code as root, installs dependencies, migrates, restarts services or silently rolls back.
- `tooling/deployment/run-stage10-signature-tests.py`: no sudo, caller-reachable child mode, isolation assertions, inherited attestation descriptors or unsafe fallback. Every execution constructs fresh user/mount namespaces, makes propagation private, then mounts **new tmpfs** on `/etc` and `/opt` before executing Node. Legacy isolation claims and interpreter-injection environment are discarded. Any namespace/mount failure stops before fixture execution. Namespace teardown removes both private mounts. Temporary synthetic keys are created only under the configured scratch directory and removed; no durable signing key is created.
- `tooling/deployment/test-stage10-signature.mjs`: its fixture function is private and never called by the file module. The module either emits the function as program **data** or invokes the constructor above, including raw `node --test` invocation and imports. Only the Python child executes that emitted program, after constructing both mounts. This eliminates the env-controlled “already isolated” branch rather than trying to authenticate caller-supplied claims. Deliberately copying/evaluating fixture source or modifying the test/runner is not a supported entry point or a hostile-root security boundary. One sequential integration scenario covers real Cosign verification, sealed-snapshot attacks, policy/input abuse, guarded extraction, actual pointer replacement, all installed file/directory fsync barriers, failures at each barrier, and CLI rejection. Both success and inverse paths inspect actual files and symlink state. Its receipts are explicitly synthetic fixtures, not evidence that CI/backup/migration gates ran on those fixtures.
- `tooling/deployment/test-stage10-signature-launcher.py`: adversarial calls run only inside a separate sacrificial namespace with fresh `/etc` and `/opt` mounts. Forged environment/descriptor claims cannot select the old child path or let raw Node skip construction; outer sentinel readbacks prove the runner's mounts are fresh and do not alter the sacrificial outer mounts. Real inherited seccomp filters return kernel `EPERM` for namespace/mount syscalls to prove fail-closed behavior without fallback. `libseccomp.so.2` is a local test prerequisite, not a production activation dependency.

The callback archive path/descriptor is valid **only inside** `withVerifiedDevelopmentArchive`; returning its pathname is not a reusable verification capability. The production activation consumer extracts while the descriptor remains open.

## Trust contract — provisioning not performed

All three JSON documents live at fixed paths under `/etc/travelos`. Directories and files must be root-owned and not group/world-writable; files must be single-link regular files, not symlinks, and bounded to 8192 bytes. Unknown/missing schema fields fail closed. No caller-provided trust document is accepted.

1. `stage10-development-policy.json` retains the existing fields: `environment` must be `DEVELOPMENT`; `artifactSha256`, `publicKeySha256` and `cosignSha256` are lowercase SHA-256 hex pins. The public-key identifier is the SHA-256 of exact verification-key file bytes, **not** an OIDC identity or a claim of production provenance.
2. `stage10-activation-authorization.json` has exactly `schemaVersion` (1), `environment` (`DEVELOPMENT`), `artifactId`, `artifactSha256`, `expectedCurrentTarget` (a canonical direct child of `/opt/travelos/releases`) and `qualificationReceiptSha256`. This last pin must come from an independently controlled review/provisioning source, never from the submitted artifact or its operator's self-comparison.
3. `stage10-qualification-receipt.json` has exactly `schemaVersion`, `environment`, `artifactId`, `artifactSha256`, `publicKeySha256`, `bundleSha256`, `expectedCurrentTarget`, `migrationHead`, `offlineTransparencyAccepted` (true), and `checks`. `checks` must contain exactly `canonicalCi`, `deploymentContract`, `exactArtifactRehearsal`, `migrationCompatibility`, and `restorePoint`, each `PASS`. Its exact bytes must match the independently provisioned receipt pin. Receipt claims must be backed by actual current evidence. These assertions do not themselves query the live database, prove current migration state or recreate a restore point.

Required host directories are `/opt/travelos/releases` and root-private mode-0700 `/opt/travelos/.stage10-private`, with protected ancestors. The guard uses an exclusive `/opt/travelos/.stage10-activation-lock`. Existing locks are never guessed stale or automatically removed. A fresh target is `/opt/travelos/releases/sha256-<archive digest>`; an existing target is rejected, not trusted, reused or overwritten. The baseline must be a root-owned symlink with exactly the authorized target. Expected baseline plus exclusive locking prevents cooperative deployment races; it is not a claim of resistance to a malicious host root.

Proposed installed invocation (documentation only, **not executed on CT200**):

```text
<independently installed pinned host Node> <root-owned installed stage10-activation.mjs> <absolute archive> <absolute bundle> <absolute public key> <absolute Cosign>
```

The privilege entry point must pin the host interpreter, executor/module paths and code installation independently of the candidate; clear interpreter-injection environment such as `NODE_OPTIONS`; and allow only this constrained action. **Do not grant generic Node/Python/shell sudo.** Do not use `/opt/travelos/current` or candidate binaries as the privileged interpreter. Do not expose this path until the broad sudo/old helper bypass is removed through the parent's separately approved continuity procedure. No sudoers, wrapper installation or policy provisioning is performed by this slice.

Linux memfd seals, `/proc` descriptor access, a protected host `/usr/bin/python3` with `os.memfd_create`, sealing support and tarfile `data` filtering are prerequisites. Only local Python 3.13.5 was exercised; CT200 Python/sealing/memory/headroom compatibility remains unqualified. Input limits are archive 1 GiB, bundle 4 MiB, public key 64 KiB and Cosign 256 MiB; extraction permits at most 150000 members, 1 GiB/member and 4 GiB expanded bytes. These are bounds, not a capacity qualification.

## Result and recovery semantics

Success JSON says `ACTIVATED_DEVELOPMENT_POINTER` and includes archive/key/bundle hashes, protected authorization/qualification receipt hashes, prior/current targets, the explicit transparency limitation and `runtimeAcceptance: NOT_PERFORMED`. Retain that actual stdout receipt, exact signature bundle and trust provenance through the separately reviewed evidence-retention path. This slice does not durably publish/index them automatically.

No new code claims that read-only extracted modes defeat host root. Seals protect the authenticated input bytes; trusted host-root DAC protects the installed release and pointer. A namespace-root test is not evidence of CT200 host-root identity or independent provisioning.

After extraction and final mode changes, activation fsyncs each regular file and every directory bottom-up (including the release root), then `/opt/travelos/releases`, **before** the pointer rename. The sync walk does not follow symlinks; containing-directory fsync persists their entries. Opens use `O_NOFOLLOW`, and directory opens also use `O_DIRECTORY`. Failed or unsupported fsync is fatal, not waived. The policy/authorization/receipt and baseline are rechecked after these barriers. The atomic replacement is followed by pointer readback and `/opt/travelos` fsync before any success receipt is returned. This corrects the durable-pointer/nondurable-content ordering defect; it is not merely a documentation deferral.

Failures **before** the atomic pointer rename preserve the old pointer and clean only this operation's unpublished tree. CLI errors are sanitized as `{"result":"FAIL","code":"STAGE10_ACTIVATION_REJECTED"}`. If failure/crash occurs at or after rename, do not assume the old pointer remains selected: read back actual current target and preserve the selected tree. A final root-directory fsync failure returns failure but preserves the selected complete release; it does not roll back or delete it. In a power-loss window, old/new pointer selection depends on rename durability, but the new tree and its parent entry have already completed their barriers. This relies on a previously durable provisioned baseline and a filesystem/storage stack honoring Linux fsync/atomic rename semantics. Actual CT200 storage/power-cut qualification is still unperformed; the real local calls were on private tmpfs and do not emulate physical media loss. A stale lock (including one reappearing after crash), ambiguous outcome or orphaned digest tree requires explicit inspected recovery; no automatic deletion/reuse, destructive database rollback, or unsigned fallback is authorized. Signature validity does not establish schema compatibility, service health or rollback safety.

## Real local validation

Working directory for commands: `/home/hermes/.hermes/worktrees/travelos-stage10`.

Pinned Node used for final validation:

```sh
export PATH=/home/hermes/.local/share/travelos-stage5-toolchain/node_modules/node/bin:$PATH
node --version
# v24.19.0
node /home/hermes/.local/share/travelos-stage5-toolchain/node_modules/corepack/dist/pnpm.js --version
# 11.21.0
```

Cosign file `/home/hermes/.hermes/cache/scratch/travelos-stage10-cosign-3.1.3` matched independently recorded SHA-256 `4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71` via `sha256sum`. No transparency upload is performed.

Test-first failures observed before their fixes:

- Separate writer changed the old writable snapshot: `snapshot must reject a separate same-UID writer with EPERM`, actual exit **7**, expected **0**. After sealed memfd implementation, overwrite/shrink/growth attacks reject with `EPERM` and exact bytes remain readable.
- Guarded activation entry point was missing: expected function, actual `undefined`. Implemented and exercised the actual new CLI, extraction and pointer switch rather than only a mocked operation.
- Protected policy identity was absent: expected protected policy digest, actual `undefined`. Verification now returns the exact policy snapshot digest, and activation rechecks it before switching.
- Caller FIFO blocked the privileged CLI until a five-second test timeout: expected normal rejection status **1**, actual **null** (killed by timeout). Nonblocking regular-file opening fixes this; the same scenario subsequently passes.
- A signed late-link fixture initially produced `Missing expected rejection`. Investigation reproduced that Python's `data` filter rewrites `alias/../outside` to `outside`, so this was accepted safe normalization, not a demonstrated host escape. The stricter guard now rejects ambiguous named-component/parent link targets instead of silently changing their raw semantics, and also checks final resolved symlinks after every member has been extracted. The fixture is now rejected; ordinary internal file/directory symlinks still work in the successful CLI test.

Historical safety checks before the independent review: direct Node invocation rejected missing claims with `PRIVATE_TEST_LAUNCHER_REQUIRED`; this was **not sufficient**, because the claims could be forged (S10-TEST-001). The descriptor-based mechanism and caller-reachable child mode are now removed. Current raw Node invocation constructs new private mounts instead of trusting claims; current validation is recorded below. The earlier private-namespace fixture-parent correction to 0755 remains; production protection was not relaxed for group-writable directories.

Final focused command:

```sh
TRAVELOS_NODE=/home/hermes/.local/share/travelos-stage5-toolchain/node_modules/node/bin/node \
TRAVELOS_COSIGN=/home/hermes/.hermes/cache/scratch/travelos-stage10-cosign-3.1.3 \
python3 tooling/deployment/run-stage10-signature-tests.py
```

Output: `signatures, sealed snapshots and guarded activation reject unsafe inputs` **PASS**; `tests 1`, `pass 1`, `fail 0`, `skipped 0`, exit **0**. The synthetic valid CLI actually selected the digest directory; the test read back the symlink, exact payload and 0444/0555 modes. Signed traversal, absolute-link, ambiguous late-link, device and duplicate-member archives were rejected; signed wrong release identity was rejected; baseline and existing attacker-marked destination were preserved in rejection cases.

Other executed final commands:

```sh
node node_modules/prettier/bin/prettier.cjs --check tooling/deployment/stage10-signature.mjs tooling/deployment/stage10-activation.mjs tooling/deployment/test-stage10-signature.mjs
node node_modules/eslint/bin/eslint.js tooling/deployment/stage10-signature.mjs tooling/deployment/stage10-activation.mjs tooling/deployment/test-stage10-signature.mjs
node node_modules/typescript/bin/tsc -p tooling/ci/tsconfig.typecheck.json --noEmit
node node_modules/typescript/bin/tsc -p tooling/ci/tsconfig.owned-declarations.json --noEmit
node --test tooling/deployment/test-stage9-development-apply.mjs
node /home/hermes/.local/share/travelos-stage5-toolchain/node_modules/corepack/dist/pnpm.js test:unit
```

Results: Prettier **all matched files use code style**; ESLint **exit 0, no diagnostics**; both typechecks **exit 0**; existing Stage 9 apply tests **8/8 pass**; full unit suite **65 files / 369 tests pass**, exit **0**. Python launcher parsed with `ast.parse`, **PASS**. Scratch was verified as `/home/hermes/.hermes/cache/scratch`.

Setup failures were not hidden: the first full unit run had **16 failed suites / 49 passed / 280 passed tests**, caused by absent built `@travelos/auth-adapters` package entries. After building that package, **5 Portal suites** still lacked `@travelos/portal-safe-core/portal-access`. An attempted direct portal/database build failed on absent `@travelos/contracts/portal`; the prerequisite package build then succeeded. Initial typecheck also lacked `packages/database/dist/index.js` and produced consequential untyped/implicit-any errors. These missing generated prerequisites were resolved without source changes using:

```sh
node /home/hermes/.local/share/travelos-stage5-toolchain/node_modules/corepack/dist/pnpm.js --filter @travelos/auth-adapters build
node /home/hermes/.local/share/travelos-stage5-toolchain/node_modules/corepack/dist/pnpm.js --filter '@travelos/portal-safe-core...' --filter '@travelos/database...' build
```

Those commands generated previously absent ignored `dist` directories for auth-adapters, contracts, backend-core, observability, portal-safe-core and database. They did not run CI, migrations or deployment. An intermediate targeted ESLint run reported one test-only `URL` undefined error; using the explicit `node:url` `fileURLToPath` import resolved it before final validation.

The initially failing suite names (all subsequently passing) were:

```text
apps/admin-api/test/auth-bridge.test.ts
apps/admin-api/test/composed-m1-body-parser.test.ts
apps/admin-api/test/correlation.test.ts
apps/admin-api/test/health-live.test.ts
apps/admin-api/test/host-auth-routing-boundary.test.ts
apps/admin-api/test/m1-routes.test.ts
apps/admin-api/test/publication-routes.test.ts
apps/admin-api/test/runtime-acceptance-cleanup-routes.test.ts
apps/admin-api/test/staff-invitation-routes.test.ts
apps/admin-api/test/static-web.test.ts
apps/admin-api/test/portal-access/trip-access-routes.test.ts
apps/portal-api/test/auth-bridge.test.ts
apps/portal-api/test/health-live.test.ts
apps/portal-api/test/host-routing-boundary.test.ts
apps/portal-api/test/static-web.test.ts
apps/portal-api/test/portal-access/trip-routes.test.ts
```

The second missing-prerequisite failure affected the five Portal suites in that list. Those setup errors are resolved locally, not waived.

Latest synthetic test logs are ephemeral scratch outputs, **not frozen or independently privacy-reviewed evidence**:

- `/home/hermes/.hermes/cache/scratch/travelos-stage10-signature-boundary-final.log`
- `/home/hermes/.hermes/cache/scratch/travelos-stage10-signature-unit-regression.log`

Historical source identities reviewed before S10-TEST-001/S10-ACT-DURABILITY-001 corrections (superseded by the exact current identities below):

| File (`tooling/deployment/`) | SHA-256 |
| --- | --- |
| `stage10-signature.mjs` | `d29dcb5fcec8bd4ae15a579e022bca038701a8f0d5835c0a6eec65a6d421d6f1` |
| `stage10-activation.mjs` | `d90def884066b6c09e9595ec7f72a581d454211dbdc148f1f49ff43a21971585` |
| `test-stage10-signature.mjs` | `7aa89f7d30a50de80dedba02e29e412363d11137eccc4c13f9aa5eac6ea2f977` |
| `run-stage10-signature-tests.py` | `19f844a0c08d55675a4c32757b4be5dec36901c03b2716c41fcba6f45630fa74` |

## Finding disposition and residual gates

**No finding is independently closed by this author report.**

| Finding | Local correction/evidence | Still required |
| --- | --- | --- |
| S10-TEST-001 | Removed claim-based bypass and caller child mode; every supported entry point constructs fresh mounts; adversarial sentinel and kernel-denial tests pass | Fresh independent review of exact changed bytes; no author finding closure |
| S10-ACT-DURABILITY-001 | Real fsync of installed regular files, bottom-up directories and releases parent before rename; root fsync after rename; all seven fixture barriers observed and failure-injected | Fresh independent review of exact changed bytes; CT200 filesystem/storage and interruption/power-cut qualification remain open |
| S10-SIG-003 | Kernel-sealed inputs; real separate same-UID overwrite/shrink/growth rejection; verification and extraction share the sealed archive | Independent adversarial review; CT200 kernel/proc/interpreter and resource qualification |
| S10-SIG-001 | New mandatory guarded CLI performs actual isolated extraction and atomic pointer activation, with negative path readbacks | Install and qualify this exact protected executor in CT200; remove every old helper/broad sudo bypass safely; real deployment chain/restart/health/rollback acceptance |
| S10-SIG-002 | Fixed protected policy plus separately pinned protected qualification receipt/authorization; exact key/bundle/archive binding | Genuine independent custody/provisioning and host identity evidence; protected key generation/use/recovery/rotation/revocation; reviewed least-privilege invocation. Synthetic root-owned files prove none of those operational facts |
| S10-SIG-004 | Output explicitly says `OFFLINE_NO_TRANSPARENCY_PROOF`; activation requires explicit protected offline-acceptance receipt | Protected receipt retention/indexing and independent acceptance of the limitation, or verified transparency proofs. `--insecure-ignore-tlog` remains; no tlog/OIDC claim |

No durable signing key, CT200 operation, sudo/firewall/DNS change, canonical CI invocation, candidate freeze, commit, push, merge, predecessor edit or Stage 11 action was performed. Evidence-retention source, shared resume and board were not edited by this signing slice. Production keyless policy/readiness remains unchanged and unverified.

## Independent-review correction validation (current mutable bytes)

Both independent findings were reproduced before their production fixes:

- `TRAVELOS_NODE=/home/hermes/.local/share/travelos-stage5-toolchain/node_modules/node/bin/node python3 tooling/deployment/test-stage10-signature-launcher.py -v`: initial **exit 1, 3 failures**. The old `--private-child` replaced the sacrificial outer mount; forged claims allowed raw Node into the fixture (the intentionally nonexistent Cosign path was reached), and legacy claims leaked into the node probe. No attack was run against host `/etc` or `/opt`.
- With the new launcher but old activation, the focused signing command below failed **exit 1, 1 failed test**: `all installed regular files and directories require fsync; symlinks must not be followed`. Actual barriers contained only `/opt/travelos`; the three regular files, two release-tree directories and releases parent were absent.

The corrected integration test observes real `FileHandle.sync()` calls and executes them, recording fd targets and the actual selected symlink at each barrier. It requires every fixture regular file and directory exactly once, no symlink traversal, child-before-parent ordering, releases-parent sync before switching, and root sync afterward. It injects failure individually at **all seven** fixture barriers. The six pre-rename failures preserve the baseline, remove only the unpublished tree and release this invocation's lock; the post-rename root-sync failure rejects while preserving the selected release and exact payload. This is **one sequential integration test**, not seven separately counted tests. The final successful CLI is exercised separately inside that same private scenario.

Final commands (all from the working directory above):

```sh
export PATH=/home/hermes/.local/share/travelos-stage5-toolchain/node_modules/node/bin:$PATH
export TRAVELOS_NODE=/home/hermes/.local/share/travelos-stage5-toolchain/node_modules/node/bin/node
export TRAVELOS_COSIGN=/home/hermes/.hermes/cache/scratch/travelos-stage10-cosign-3.1.3

python3 tooling/deployment/test-stage10-signature-launcher.py -v
python3 tooling/deployment/run-stage10-signature-tests.py
node --test tooling/deployment/test-stage10-signature.mjs
node --test tooling/deployment/test-stage9-development-apply.mjs
node /home/hermes/.local/share/travelos-stage5-toolchain/node_modules/corepack/dist/pnpm.js test:unit
node node_modules/prettier/bin/prettier.cjs --check tooling/deployment/stage10-signature.mjs tooling/deployment/stage10-activation.mjs tooling/deployment/test-stage10-signature.mjs
node node_modules/eslint/bin/eslint.js tooling/deployment/stage10-signature.mjs tooling/deployment/stage10-activation.mjs tooling/deployment/test-stage10-signature.mjs
node node_modules/typescript/bin/tsc -p tooling/ci/tsconfig.typecheck.json --noEmit
node node_modules/typescript/bin/tsc -p tooling/ci/tsconfig.owned-declarations.json --noEmit
python3 -c 'import ast; from pathlib import Path; [ast.parse(p.read_text()) for p in map(Path, ["tooling/deployment/run-stage10-signature-tests.py", "tooling/deployment/test-stage10-signature-launcher.py"])]; print("Python AST parse PASS")'
```

Results: launcher **5/5 pass** (including real kernel namespace/mount denial), focused constructor **1/1 pass**, raw `node --test` route **1/1 pass**, historical Stage 9 apply **8/8 pass**, full unit suite **65 files / 369 tests pass**. Each command exited **0**. Prettier, ESLint, both TypeScript configurations and both Python AST parses passed. No source prerequisite builds were needed for this correction run.

Test-harness setup issues were resolved, not waived: nested overmounts have multiple mountinfo entries, so the read-only probe identifies the visible mount through kernel fdinfo `mnt_id`; libseccomp must be loaded before hiding `/etc` (its discovery uses host loader metadata); and the real `mount` syscall denial can occur in unshare's automatic propagation setup before the explicit child mount command. The failure tests assert actual kernel rejection/no fixture execution rather than a particular utility's diagnostic wording.

Current exact source SHA-256:

| File (`tooling/deployment/`) | SHA-256 |
| --- | --- |
| `stage10-signature.mjs` (unchanged) | `d29dcb5fcec8bd4ae15a579e022bca038701a8f0d5835c0a6eec65a6d421d6f1` |
| `stage10-activation.mjs` | `bbbf03515c6e2d634fd6238a02da7b4a5c88fa7ffa8b80b61fe40c399ed41b34` |
| `test-stage10-signature.mjs` | `fb2cdbff1e86c912450dcc585a39a78a9bec173f2e71677973ecadad07ea10d7` |
| `run-stage10-signature-tests.py` | `a8852d56fab1ec76bdf9f6bf76f4ac19c2def87689da3b5a9ef6eb44a68218e7` |
| `test-stage10-signature-launcher.py` (new) | `c3cfa26ab1ef7cf58bb0ac326b944eef29ec51066e0f219b53babb3e7d8c6b0b` |

Current logs under `/home/hermes/.hermes/cache/scratch/` (ephemeral, not frozen/privacy-reviewed evidence):

- `travelos-stage10-launcher-red.log`
- `travelos-stage10-durability-red.log`
- `travelos-stage10-launcher-final.log`
- `travelos-stage10-signature-correction-final.log`
- `travelos-stage10-raw-node-final.log`
- `travelos-stage10-signature-correction-stage9.log`
- `travelos-stage10-signature-correction-unit.log`
- `travelos-stage10-signature-correction-qa.log`

These are local corrections offered for fresh independent review, **not independent closure, host integration, or Stage 10 GO**. The original NO-GO review remains untouched. No CT200 writes, production changes, canonical CI, persistent keys, commits, pushes, merges or Stage 11 work were performed.

