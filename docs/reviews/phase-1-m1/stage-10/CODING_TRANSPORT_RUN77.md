# Stage 10 — transport preparation and CT200 dependency checkpoint (run77)

**NOT_READY / NO_GO. Implementation remains incomplete. No QA dependency release, canonical claim, deployment or Stage GO.** This is an author report; hashes below establish consistency, not independent provenance or privacy acceptance.

## Recovery and changes

Recovered run33's untracked `stage10-qualification-transport.py`, its tests and `stage10-qualification-preflight.py`. Its saved eight-test PASS was not a result for the later eleven-test source. Fresh execution found `test_archive_members_cannot_live_below_a_symlink` failing: a tar member could have a symlink as its parent. Fixed verification to require every non-root ancestor to be an explicit directory. Original run33 outputs remain untouched.

Changed in this run:

- `tooling/deployment/stage10-qualification-transport.py`: ancestor validation and local `unpack` for a verified harness only. Exclusive private destination; regular files streamed with bounded expected length, checked hashes/modes; links installed last; extracted inventory and archive rechecked. Partial destinations are retained on failure. No executor/transfer CLI added.
- `tooling/deployment/test-stage10-qualification-transport.py`: real local extraction/byte/mode/link roundtrip, occupied file/directory/dangling-link preservation, corrupt-archive rejection before allocation.
- This report and its companion JSON manifest; `.hermes/state/stage-10-resume.md` checkpoint.

The extractor assumes a trusted parent and no concurrent same-UID writer. It is not a privileged extractor, hostile-input sandbox, crash-durability receipt publisher or application artifact verifier. Application runtime still requires the existing `qualifyExtractedArtifact` contract, not this test-harness inventory.

## Executed evidence

Exact retained output paths are in the companion manifest.

| Command / operation | Actual result |
|---|---|
| `python3 tooling/deployment/test-stage10-qualification-transport.py -v` before correction | 11 tests, one FAIL: symlink-parent acceptance |
| Same after ancestor correction | 11 PASS |
| Same after adding unpack tests, before implementation | 14 tests, missing `unpack` errors (including subtests), exit 1 |
| Final same command | 14 PASS, exit 0 |
| `python3 tooling/deployment/test-stage10-process-boundary.py -v` | 5 PASS, exit 0 |
| `python3 tooling/deployment/test-stage10-ct200-db-inspection.py -v` | 7 PASS, exit 0; local tests, no database inspection |
| Real local `pack` → `unpack` → inventory comparison of installed `playwright-core@1.62.1` | 136 entries; 13547520-byte archive, SHA256 `70e9feb45c7f8f12bc7ff656e44e11b503e91cd3273115002667214837d8b4cb`; equal extracted inventory; temporary tree removed. No package code executed. This is a dependency-subset rehearsal, not the full harness. |
| Pinned Node `readToolchain(process.cwd())` | Node24.19.0 / Corepack0.35.0 / pnpm11.21.0 |
| Pinned Node `verifyBaseline(process.cwd())` | PASS, 2662 predecessor files, no allowed existing-file deltas |
| `python3 tooling/deployment/stage10-qualification-transport.py --preflight` | exit0; read-only metadata, UID1000; qualification NOT_RUN |

Pinned Node is `/home/hermes/.local/share/travelos-stage5-toolchain/node_modules/node/bin/node`. Actual `python3 --version` was 3.13.5. No changed application TypeScript/package scripts; global application/build suites were not repeated in this bounded Python slice. Earlier suite results remain historical, not new qualification. No PostgreSQL server or browser was launched locally or remotely.

## Fresh CT200 read-only findings

Fixed SSH destination/identity/public host-key pin were used, with no ambient config/agent, forwarding, sudo or credentials in payload/output. Only metadata scripts were sent through stdin; no harness/archive or files were transferred to remote storage.

- UID1000, x86_64, glibc2.41. All six inspected native PG tools are executable root-owned0755, report PostgreSQL18.6, and have hashes in `run77-preflight.json`. Version execution is not PostgreSQL startup, ABI qualification of an archive or database access.
- No browser executable found in the two inspected Playwright caches. This is not a claim about every location on the machine.
- Pinned Playwright metadata requires Chromium/headless-shell revision1234, version151.0.7922.34. Build host has full Chromium1234; the inspected default headless-shell caches do not have revision1234. Existing browser launch calls use default `chromium.launch({headless:true})`; an old shell must not be silently substituted.
- `readelf -d` on build-host Chromium1234 (SHA256 `0b20b130e7edd9dd51873be867761295fe0cfad490c2b9a64f95bd3cfc08fa71`) supplied its actual NEEDED names. Remote read-only file checks in `/usr/lib/x86_64-linux-gnu`, `/lib/x86_64-linux-gnu`, `/usr/lib`, `/lib` found these required SONAMEs absent: `libglib-2.0.so.0`, `libgobject-2.0.so.0`, `libgio-2.0.so.0`, `libatk-1.0.so.0`, `libatk-bridge-2.0.so.0`, `libcups.so.2`, `libxcb.so.1`, `libxkbcommon.so.0`, `libasound.so.2`, `libgbm.so.1`, `libX11.so.6`, `libXext.so.6`, `libcairo.so.2`, `libpango-1.0.so.0`, `libXcomposite.so.1`, `libXdamage.so.1`, `libXfixes.so.3`, `libXrandr.so.2`, `libatspi.so.0`. ldconfig-cache observations corroborate the overlapping entries. No dynamic loader/browser was executed remotely; transitive ABI closure remains unqualified.
- Current SSH cgroup controls are not writable, **but that is not evidence that non-root resource isolation is impossible**. A separate read-only `systemctl --user show` succeeds (systemd257.8). `/user.slice/user-1000.slice/user@1000.service` is writable by UID1000 and has `cpu memory pids` delegated/enabled in `cgroup.subtree_control`. Parent limits are `max`. A bounded transient user unit is a plausible route; setting/readback/enforcement and cleanup have NOT been tested. No unit was created or modified.

## Exact transport/scope proposal for Alex review — NOT an executor

This proposal follows Alex's task comment; the old additional-CT resource plan remains superseded. Existing CT200 only, existing UID1000 and pinned SSH; no root, services/restarts, persistent DB/credentials, namespaces or new infrastructure.

1. **Build-host preparation:** select and inventory a test-only harness containing unchanged accepted suites, Stage10 adapters/catalog/config and locked dev dependencies; prepare any test transformation on the build host. Keep the application runtime in a separate exact archive/extraction verified with existing Stage10 package receipts/inputs and pinned Node. Do not use `/opt/travelos/current` or workspace source as application runtime. Prepare browser revision1234 and its complete reviewed native dependency closure; no install/compile on CT200. Full harness/browser preparation is still NOT DONE; the real package test above is only a subset.
2. **Execution boundary:** Alex reviews the exact harness/runtime/archive/native dependency hashes, proposed scope and implementation before any harness transfer/remote execution. No CLI currently implements this transport/executor. Do not interpret this document as approval or the metadata probe as a runtime result.
3. **Private staging:** after that review only, generate a fresh short private0700 directory under the non-root home, with separate runtime/harness/browser/input/receipt/synthetic-PG paths. Require exclusive creation, bounded archive sizes and exact inventory/hash comparison before and after extraction. An occupied/partial attempt is never overwritten or retried. Recheck available disk space with a declared reserve and measured expanded sizes; current free space is observation, not a reservation.
4. **Resource boundary:** use the existing user systemd manager, not system services, with a unique unit and proposed ceilings MemoryMax2GiB, MemorySwapMax0, TasksMax128, CPUQuota100%, RuntimeMaxSec15min, LimitCORE0 and bounded output. These are proposed ceilings, not a verified capacity fit. Require actual property/cgroup readback before starting the harness; reject unavailable enforcement. No privileged fallback and no assumption that per-process rlimits bound aggregate browser/PG memory.
5. **Synthetic runtime:** initialize only a new synthetic cluster inside that directory; native PG binaries must match reviewed version/hash/ABI checks. Private Unix socket0700, `listen_addresses=''`, no replication/archive/preload/recovery hooks, bounded connections/statements. Explicit socket connection for every test/client; no ambient PG variables or access to persistent application credentials/DB. Existing local runner still uses TCP and package preparation, so it must be adapted and inverse-tested rather than simply copied to CT200. Any browser/API fixture listener must be loopback-only, newly allocated and separately inventoried; no public listener.
6. **Qualification and exit:** run the complete 95 named-case superset against the extracted application runtime; require no skips/todos/missing/duplicate cases, current pre/post artifact/input checks, bounded logs and exact command exits. A zero exit without validated receipt and confirmed cleanup is UNKNOWN_OUTCOME_PRESERVE, not PASS.
7. **Cleanup and reconciliation:** stop only attempt-owned cluster/processes/unit; verify process/socket/listener absence before removing only generated synthetic files. On SSH loss/timeouts/stop failure preserve attempt identity and receipts for read-only reconciliation; never blind replay or global PID/name deletion. Download only allowlisted sanitized evidence; raw runner metadata stays private and is not canonical privacy-approved evidence.

## Concrete operational dependency for Alex

**S10-CT200-BROWSER-DEPS:** the requested existing-native-tools route does not currently resolve the selected browser's required libraries in standard locations. Decide/arrange a reviewed dependency path before runtime work: either an existing approved nonstandard library/browser closure with exact paths/hashes/ABI evidence, or an explicitly reviewed build-host-prepared relocatable native-library closure. If native CT package provisioning is chosen instead, that belongs to Alex and is outside this task's no-install/no-privileged-change boundary. Do not install or alter host state from this card, substitute another revision, or claim absent library-cache entries prove all possible paths absent.

Non-root resource isolation is **UNVERIFIED**, not declared unavailable; the user-manager discovery removes the earlier tempting false blocker. Implement and test the bounded launcher only against the reviewed dependency/execution contract. This report does not convert unfinished orchestration into completed implementation or request a generic new environment.

## Still open and independent review criteria

- S10-READY-PG: full harness assembly, transport/orchestration, private-socket conversion, exact-artifact95-case CT200 execution and failure cleanup.
- S10-READY-REGRESSION: final inherited/current-artifact coverage unqualified.
- S10-READY-OPS / SIGN / RECOVERY / CANONICAL: unchanged; no operational/canonical prerequisites promoted.
- S10-RET-002 / S10-RET-004 / S10-RET-005: independent origin, exact-byte privacy and protected producer/writer boundary remain open.

Review must reproduce the symlink-parent inverse, corruption/overwrite/extraction cases, check the companion source/log hashes, separate run33's older test result from run77, and verify the real-package subset label. Review must reject any claim of complete transport, aggregate resource enforcement, native/browser ABI compatibility, accepted95-case runtime evidence or privacy approval from these fixtures/probes. Confirm no readiness/one-shot state changed and all protected predecessor bytes remain intact.

No production, Stage11, privileged modification, new credential, cluster startup, service restart, activation, migration, consuming build/CI claim, Git commit/tag/seal, push or merge performed. This card is not complete and dependent QA must not be released merely for this checkpoint.
