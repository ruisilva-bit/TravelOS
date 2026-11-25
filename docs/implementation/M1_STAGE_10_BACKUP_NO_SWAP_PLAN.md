# Stage 10 CT200 backup: scoped no-swap containment candidate

**Design for independent review; no installation, privileged probe, backup or Stage 10 GO.** Existing source is unchanged. The current producer still rejects enabled swap and must not be run by bypassing that rejection. Governing documents: AGENTS.md, DEPLOYMENT_MODEL.md §8, ADR-002/003/012/013/014 and M1_STAGE_10_BACKUP_RECOVERY_CONTRACT.md.

## Observed facts and decision

A fresh pinned, read-only SSH metadata query during this analysis returned:

- kernel `7.0.14-22-pve`; systemd `257 (257.8-1~deb13u2)`;
- memlock soft/hard `(8388608, 8388608)` bytes;
- one `/proc/swaps` data entry;
- cgroup v2 login path `/user.slice/user-1000.slice/session-c2247.scope`;
- visible controllers `cpuset cpu io memory hugetlb pids rdma misc dmem`;
- visible root `memory.swap.max` = `max`; normal `hermes` cannot write the cgroup root.

The pinned query used SSH `-F /dev/null`, `/home/hermes/.ssh/travelos_ct200_ed25519`, `BatchMode=yes`, `StrictHostKeyChecking=yes`, repository `tooling/deployment/stage10-ct200-known-hosts`, and `hermes@192.168.1.33`, launched through Python `subprocess.run(argv)` rather than shell SSH rewriting. The address is the established pinned endpoint, not a correction of the older product-document address. No sudo/root command was executed.

**Preferred conditional design:** a fixed system-manager service with `MemorySwapMax=0` from process birth, plus a fresh private `tmpfs` mounted with `noswap`. This is a narrow local service change, not disabling host/CT swap. Kernel version and controller visibility alone do not prove the LXC permits the mount or systemd can enforce the service's limit. Install/run remains **NO-GO until the exact root boundary and mount are actually verified**.

## Why both controls are mandatory

1. `tmpfs` alone is swappable. `noswap` protects only that filesystem's pages, not Python/native heap, stack, anonymous mappings or buffers in compression/encryption subprocesses.
2. Kernel cgroup-v2 documentation specifies `memory.swap.max` for anonymous memory. Do **not** treat it as a filesystem-wide guarantee for tmpfs/shared shmem, including data charged elsewhere or inherited from outside the service. A fresh `noswap` superblock independently protects staging files, regardless of which allowed process touches them.
3. Ordinary `memfd_create` uses internal shmem, not this staging mount. Its seals prevent mutation, not swapping. Do not claim `noswap` on `/run/...` protects ordinary memfds. Existing certificate/tool memfds contain public bytes; preserve that restriction. If plaintext needs an fd, use an opened/unlinked regular file on the verified `noswap` filesystem (or separately qualify a real locking design), **not** an ordinary memfd. Ban plaintext POSIX/SysV shared memory and externally supplied writable shared mappings in this operator path.
4. `mlockall` is not a shortcut here: the observed limit is below the existing 128 MiB archive bound, locking/exec/fork semantics require separate proof, and partial locking must fail closed. `MemoryLow`, `MemoryMin`, `MemoryHigh`, `MemorySwappiness`, zero observed `VmSwap`, and zero observed swap activity do not substitute for the two controls.
5. A new service must be started with the limit already applied. Moving a running plaintext process or lowering a limit afterwards cannot undo earlier swaps; existing swapped pages can remain when a limit is lowered.

This containment covers **new backup-pipeline copies**, not the already-running PostgreSQL server's memory, host snapshots/hibernation, privileged host memory inspection, existing disk/database encryption or malicious root. Extending the guarantee to source-server memory would require a different, explicitly approved scope.

## Fixed service and privilege design (not an installed unit)

- Root-controlled fixed launcher starts exactly one fixed system service, never a caller-selected command/unit/property/path. No broad `systemd-run`, Python, shell, `systemctl` or mount sudo grant. Do not expose the diagnostic command below as an operational sudo interface.
- Use system manager, not `--user`, login scope or `--scope`. `MemoryAccounting=yes`, `MemorySwapMax=0`, `Delegate=no`, `LimitCORE=0`, `UMask=0077`, `KillMode=control-group`, finite runtime/stop limits and `OOMPolicy=kill`. Retain all native-tool, source, identity and recipient pins. Configure an independently reviewed `MemoryMax`/`TasksMax`; numeric production limits require measured peak-copy/native verifier/compressor headroom and live CT headroom, not just the 128 MiB archive bound.
- Fresh `TemporaryFileSystem=/run/travelos-stage10-backup:rw,nosuid,nodev,noexec,noswap,size=160M,mode=0700` is a concrete initial mount candidate. It creates a service-private mount namespace implicitly; **that namespace is a new operational capability requiring explicit approval**, even though no new CT/VM/container runtime is proposed. The existing backup contract says no new namespace: do not silently waive that wording. If that constraint is retained, request separate approval for an exact dedicated non-private mount with equivalent ownership/lifetime controls instead; do not remount existing `/run` or shared mounts. 160 MiB is a bounded staging candidate, not a RAM reservation or demonstrated sufficient peak capacity.
- Start the fixed integrity/identity preflight as root **inside the protected service**, before any secret or database payload read. Root sets staging owner to the verified `travelos_backup` UID/GID and mode 0700, then irreversibly clears supplementary groups and drops all real/effective/saved UIDs/GIDs and capabilities; retain `no_new_privs`. Root setup itself uses no backup plaintext. Recheck containment after dropping identity, before opening replication/source data. No plaintext fd/mapping or archive comes from the SSH caller or an earlier process.
- All native tools/compression/OpenSSL and their children are direct descendants inside the same protected subtree. Do not delegate work through another service, broker, `sudo`, `su` or external helper daemon. Prevent cgroup writes/migration by the backup UID and grant no capabilities. Cgroup membership is not a sandbox against hostile root, which remains trusted.
- Existing constrained pipe/fd process controls remain necessary. Production stdout is ciphertext-only on the reviewed transport, **not journald or a terminal**. Diagnostics are bounded sanitized markers only. A diagnostic transient service using `--pipe` is not an already-qualified production ciphertext transport; systemd-run control text must never contaminate a backup stream.
- Automatic service/mount teardown on exit/kill removes staging; verify descendant death and disappearance of only the exact staging mount. No lazy unmount, global swapoff, persistent unit enablement, PostgreSQL restart, migration or old-backup deletion is part of this proposal.

## Fail-closed validator required before changing existing producer

Implement and review as a separately pinned module first; do not simply remove `/proc/swaps` from `validate_staging`.

1. Validate real cgroup2/proc mounts and resolve `/proc/self/cgroup` against the cgroup mount's root (CT namespaces can hide ancestors). Reject ambiguous paths, deleted membership, non-domain cgroups, missing/unreadable controller files and symlink/writable ancestry. Require the fixed service leaf, exact `memory.swap.max == 0`, `memory.swap.current == 0`, active memory controller, and membership in the expected subtree. Root installation is trusted; an environment variable or JSON receipt is not attestation.
2. Inspect every visible ancestor's controller/limits and record effective memory/pids headroom. A parent `memory.swap.max=max` **cannot relax a child's zero limit**; a tighter parent does not permit swapping either. Parent memory pressure may throttle/kill the service or affect availability, not authorize swap fallback. Hidden Proxmox ancestors require separate platform inventory for capacity; visible free RAM alone proves no reservation. Stop if the service controller is unavailable, a limit is ignored, or capacity cannot be established.
3. Open staging using no-follow directory-fd ancestry, enforce exact owner/mode, `fstatfs == TMPFS_MAGIC`, and use `/proc/self/fdinfo/<fd>` `mnt_id` to match **the same opened mount** in `/proc/self/mountinfo`. Require tmpfs and `noswap` in superblock options, plus private safe mount identity and required flags. A basename match, `/run` prefix or `findmnt` report of some other mount is insufficient. No unknown child mounts. Require the existing minimum 144 MiB available and finite size/inode bounds; do not create plaintext while discovering these facts.
4. Repeat checks after UID drop and at native-process launch. Constrain concurrent invocations to prevent shared staging and peak-memory overlap. No process migration escape or inherited plaintext buffers. Verify descendants use the same protected cgroup in the integration fixture; protected-root mutation during a run is out of scope, not silently race-proofed by a one-time read.
5. Disable dumpability/core dumps before source reads and after credential transitions as needed. No plaintext tempfiles outside the opened noswap mount, no archive/debug logging, no generic tempfile fallback. Route library scratch paths explicitly and reject unsupported facilities rather than hoping TMPDIR controls everything.
6. Leave the existing global-swap rejection in force until this alternative has independent source review and real privileged integration evidence. Keep absence of a complete restore point explicit.

## Exact next approval: synthetic root-only capability probe

Request approval for **one root-created transient diagnostic service in CT200**, with a private 16 MiB noswap tmpfs and 64 MiB cgroup memory cap, running only the literal metadata checker below. This creates a transient service/cgroup and private mount namespace; it is therefore a mutation and **was not executed**. No key, database, backup or live application file is opened. It does not authorize installing the producer or changing sudo policy. Existing root-console recovery must remain available. Root credentials must not be supplied in chat.

Run through the independently approved administrator route (not a new generic sudo grant):

```sh
/usr/bin/systemd-run --unit=travelos-stage10-noswap-probe --wait --pipe --collect \
  -p MemoryAccounting=yes -p MemorySwapMax=0 -p MemoryMax=64M \
  -p TasksMax=8 -p Delegate=no -p LimitCORE=0 -p UMask=0077 \
  -p KillMode=control-group -p RuntimeMaxSec=30 -p TimeoutStopSec=5 \
  -p OOMPolicy=kill -p NoNewPrivileges=yes \
  -p 'TemporaryFileSystem=/run/travelos-stage10-noswap-probe:rw,nosuid,nodev,noexec,noswap,size=16M,mode=0700' \
  /usr/bin/python3 -I -c '
import os, pathlib, pwd, resource
P = pathlib.Path
assert os.geteuid() == 0
assert resource.getrlimit(resource.RLIMIT_CORE) == (0, 0)
lines = P("/proc/self/cgroup").read_text().splitlines()
assert len(lines) == 1 and lines[0].startswith("0::/")
rel = lines[0][3:]
assert rel == "/system.slice/travelos-stage10-noswap-probe.service"
mountinfo = P("/proc/self/mountinfo").read_text().splitlines()
cgm = [x for x in mountinfo if x.split(" - ")[1].split()[0] == "cgroup2"]
assert len(cgm) == 1
cgfields = cgm[0].split(" - ")[0].split()
# This strict diagnostic only supports the observed canonical root layout.
# Other mount-root offsets require reviewed resolution, never guessed joining.
assert cgfields[3] == "/" and cgfields[4] == "/sys/fs/cgroup"
cg = P(cgfields[4]) / rel.lstrip("/")
assert os.stat("/proc/self/ns/mnt").st_ino != os.stat("/proc/1/ns/mnt").st_ino
def check():
    assert P("/proc/self/cgroup").read_text().splitlines() == lines
    assert (cg / "cgroup.type").read_text().strip() == "domain"
    assert (cg / "memory.swap.max").read_text().strip() == "0"
    assert (cg / "memory.swap.current").read_text().strip() == "0"
    assert (cg / "memory.max").read_text().strip() == "67108864"
check()
path = "/run/travelos-stage10-noswap-probe"
fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    mid = next(x.split()[1] for x in P("/proc/self/fdinfo/" + str(fd)).read_text().splitlines() if x.startswith("mnt_id:"))
    mounts = [x for x in P("/proc/self/mountinfo").read_text().splitlines() if x.split()[0] == mid]
    assert len(mounts) == 1
    left, right = mounts[0].split(" - ")
    assert left.split()[4] == path and right.split()[0] == "tmpfs"
    # A slave mount may receive host events but must not propagate back.
    assert not any(x.startswith("shared:") for x in left.split()[6:])
    assert "noswap" in right.split()[2].split(",")
    assert {"nosuid", "nodev", "noexec"} <= set(left.split()[5].split(","))
    user = pwd.getpwnam("nobody")
    assert user.pw_uid != 0 and user.pw_gid != 0
    os.fchown(fd, user.pw_uid, user.pw_gid)
    os.fchmod(fd, 0o700)
    os.setgroups([]); os.setresgid(user.pw_gid, user.pw_gid, user.pw_gid)
    os.setresuid(user.pw_uid, user.pw_uid, user.pw_uid)
    assert os.getresuid() == (user.pw_uid,) * 3 and not os.getgroups()
    check()
    assert not os.access(cg / "cgroup.procs", os.W_OK)
    assert not os.access(cg / "memory.swap.max", os.W_OK)
    data = bytearray(4096)
    child = os.fork()
    if child == 0:
        check()
        os._exit(0)
    assert os.waitpid(child, 0)[1] == 0
    print("SYNTHETIC_NOSWAP_CAPABILITY_PASS; NOT_BACKUP_QUALIFICATION")
finally:
    os.close(fd)
'
```

This deliberately strict probe rejects a different cgroup layout instead of guessing it safe. Mount/namespace permission denial, missing `noswap`, controller errors, lack of the `nobody` account or read access, and any assertion failure are blockers to diagnose, never instructions to weaken controls. It allocates only one small synthetic anonymous buffer; it does not force reclaim, test tmpfs writes or prove peak backup capacity. The helper does not claim to implement the full production validator above.

Afterward the administrator must verify the named unit has no surviving processes, its exact private mount is absent from the CT's normal mount view, live services remain healthy, and no swap setting changed. Preserve sanitized exit/diagnostic metadata only. If LXC denies the mount/controller, return the actual error and request the specific platform capability decision; do not silently add container privileges, change AppArmor, mount globally or disable swap.

## Test/review gate before implementation is usable

- Unit-test cgroup/mountinfo parsers with mount-root offsets, missing controller, nonzero current/max swap, wrong service, deleted paths, false/foreign mount ID, absent noswap, writable ownership, UID-drop failure, duplicate/malformed entries and insufficient capacity. All reject before a sentinel plaintext reader is called.
- Isolated local privileged integration: positive/negative real mounts and real controller files, descendants before/after drop, zero plaintext ordinary-memfd usage, SIGTERM/SIGKILL/OOM cleanup and two concurrent launches. No production fixture escape or fake fallback PASS.
- Use bounded synthetic data to exercise actual pg_basebackup/verifier/compressor/OpenSSL under the proposed memory cap, measure peak consumption, and test oversize/compression/timeouts. Prove ciphertext-only stdout and rejection before source access on failed containment.
- Independently review installed native/root entry, clean environment and fds, module pins, service properties and transport. The fixed Python producer CLI alone is not the already-verified constrained root entry.
- Only after approved CT200 capability/readback tests, reviewed installation and appropriate operational authority may the real backup pipeline run; receiver custody, retention, native restore and privacy reconciliation are independent gates.

## Review and local validation

An independent review found two diagnostic gaps: unchecked cgroup mount-root assumptions and no runtime namespace/propagation check. The probe now requires one canonical cgroup2 mount with root `/` (other layouts fail closed), a distinct mount namespace from CT PID 1, and no `shared:` propagation on the exact opened staging mount. It permits a slave mount, not outward shared propagation. These targeted corrections have not been independently re-reviewed on CT200. Local `shlex` parsing of the literal command and `ast.parse` of the embedded Python both passed; the privileged command itself was **not executed**. No synthetic PASS marker was emitted as runtime evidence.

## Sources and evidence limits

- Linux kernel cgroup-v2 documentation, `memory.swap.max`, hierarchy and memory ownership: https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html
- Linux kernel tmpfs documentation, `noswap`, internal shared-memory mounts: https://www.kernel.org/doc/html/latest/filesystems/tmpfs.html
- Version-matched systemd 257 resource control and execution documentation: https://www.freedesktop.org/software/systemd/man/257/systemd.resource-control.html and https://www.freedesktop.org/software/systemd/man/257/systemd.exec.html

These sources were retrieved for this analysis. Latest kernel documentation is not proof of every downstream kernel behavior; the real target probe is still required. No local synthetic test or doc review can claim CT200 root enforcement without executing that boundary. This contribution changes only this mutable design document; existing operator files remain unchanged.
