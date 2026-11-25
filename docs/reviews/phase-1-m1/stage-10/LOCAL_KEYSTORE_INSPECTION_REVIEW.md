# Local keystore and CT200 inspector security review

## Independent verdict: NO-GO (reviewed initial implementation)

Reviewer `sa-0-821234ba`, delegation `deleg_baa756cc`, performed a read-only code review of the initial `stage10-development-keystore.py`, `stage10-ct200-db-inspection.py` and their tests. No commands involving private material, remote operation, source edit, provisioning or canonical CI were authorized or performed by the reviewer. This verdict is local only and is not a Stage 10 acceptance decision.

### Findings

1. **HIGH — unbounded capture:** subprocess stdout/stderr were buffered completely before checking the keystore limit; inspector capture had no streaming byte limit. A timeout does not bound memory.
2. **HIGH — path/executable races:** pathname checks preceded separate pathname opens/execs, and group-writable ancestors were not explicitly handled. Directory-FD-relative no-follow operations and a verified executable snapshot or equivalent protected execution boundary were requested.
3. **MEDIUM — partial stores:** key creation/recovery wrote final directories incrementally. Failure could leave an incomplete destination that looked provisioned. Require private staging and atomic no-overwrite publication, with cleanup/quarantine on failure.
4. **MEDIUM — exposed durable creation API:** `create_store(directory, cosign)` is actual provisioning despite the return-label disclaimer. Separate authorized provisioning from reusable probe operations; do not pretend an importable function or caller boolean supplies authorization.
5. **MEDIUM — implicit SSH trust:** inherited environment/config selected identity, proxy and host-key policy. Require an explicit sanitized environment and pinned trust boundary.
6. **MEDIUM — summary ledger:** count 16 and maximum name did not prove complete ordered migration membership. Require the complete expected sequence or a trusted digest.
7. **LOW — privilege wording:** only five cluster role flags were checked, not database/object privileges. Keep the result narrow.

Useful existing controls were noted: fixed credential names; regular-file ownership/mode/link checks; sealed private-key memfd; explicit same-host-only recovery and pending host-loss/trust distribution. These did not close the findings.

## Parent verification and corrections so far (not a superseding GO)

The parent inspected the code and reproduced the relevant structure. A dedicated operational subprocess boundary was written after a missing-implementation RED. It multiplexes nonblocking input/output, enforces per-stream byte limits while reading, applies a deadline, cleans only its own new process group, and keeps the leader unreaped until cleanup to prevent a recycled PID becoming a kill target. Four tests passed, including large stdin/output without deadlock, stdout/stderr floods, timeout and nonzero exit. It is not a privileged generic command executor.

The CT200 inspector now uses that boundary with a 16 KiB per-stream budget and a sanitized environment. SSH uses no ambient configuration/agent/proxy, a fixed approved identity and target, strict Ed25519 host-key verification and a pinned public known-hosts record bootstrapped from the existing approved SSH trust. A real harmless fixed-SSH identity check succeeded before the inspector was exercised.

The ledger SQL now returns names ordered exactly like the canonical migration reader (`run_on,id`), and the parser compares all sixteen expected names. Substitution/reordering with unchanged count/head is rejected. Output explicitly distinguishes `ALL_FIVE_CHECKED_FALSE` cluster role flags from `databaseObjectPrivileges: NOT_INSPECTED`. Six tests and actual CT200 read-only execution passed after the updated valid-ledger test first failed against the old parser. A further no-SSH malformed-public-host-key regression was added and awaits the next recorded rerun.

Keystore FD/snapshot/staging corrections returned from `sa-0-b4bad9d6` / `deleg_08a83c89`. Alex read the full corrected module and independently reran `/usr/bin/python3 tooling/deployment/test-stage10-development-keystore.py -v`: **11 tests PASS**, including actual disposable-key encrypted recovery/signing, poisoned-binary snapshot, link rejection, unsafe ancestors, no-overwrite publication and injected partial-stage cleanup. This is a synthetic-probe module, not an authorized definitive-key provisioning boundary. The default `python` reported missing `fcntl.F_ADD_SEALS` in the child's run; use the exercised Linux system interpreter explicitly, not an assumed PATH interpreter. Linux memfd, `/proc/self/fd` and `renameat2` are required. No definitive key provisioned, no canonical CI, migration, database backup/restore, activation or sudoers change performed. The reviewed NO-GO remains in force until corrected source and evidence receive substantive independent re-review.

## Separate backup-provider capability observation

A real disposable build-host OpenSSL CMS AES-256-GCM / RSA3072 probe passed authenticated encrypt/decrypt and rejected a tampered authentication tag. Its private key was encrypted; its random password was supplied through a sealed memfd, not argv. All material was synthetic and temporary. This establishes build-host provider capability only, not CT200 provider qualification, protected durable recovery-key custody, native PostgreSQL backup/restore, retention or Stage 10 GO. The backup adapter implementation is independently delegated in disjoint files; no definitive key/expiry operation is authorized to that child.
