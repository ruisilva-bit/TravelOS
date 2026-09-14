# M1 Stage 1 — CT 200 Baseline — Corrected Candidate

**Status:** post-review corrected-generation candidate; not closed until focused independent closure  
**Generation:** supersedes `M1_STAGE_1_CT200_BASELINE.md` only if the corrected freeze closes  
**Environment:** DEVELOPMENT only  
**Evidence:** `docs/evidence/phase-1-m1/stage-1/ct200-read-only-inventory.json` (`S1-EV-024`, `S1-EV-025`)

## 1. Scope and evidence boundary

This generation preserves only claims that the retained machine-readable evidence can support. The correction session used Proxmox HTTPS API **GET** requests only, performed no guest SSH, and retained no authentication material (`S1-EV-024`, `S1-EV-025`).

It does **not** claim a byte-for-byte guest filesystem comparison or absence of activity by other operators. A `vncproxy` task owned by `root@pam` was visible during the capture interval and is not attributed to the read-only API identity (`S1-EV-025`).

## 2. Current target identity and selected configuration

| Item | Retained observation | Evidence |
|---|---|---|
| Proxmox node/API | `pxmx2`, `192.168.1.200` | `S1-EV-024` |
| Guest | VMID `200`, `travelos-dev` | `S1-EV-024` |
| Guest IPv4 | `192.168.1.33/24` on `eth0` | `S1-EV-024` |
| Proxmox guest type | LXC, `ostype=debian`, `arch=amd64` | `S1-EV-024` |
| Isolation | unprivileged; `nesting=1`; Proxmox firewall on `net0` | `S1-EV-024` |
| Resources | 4 vCPU; 7,629 MiB memory; 7,629 MiB swap; 20 GiB root volume | `S1-EV-024` |
| Runtime state | `running` before and after | `S1-EV-024` |

`192.168.1.200` is the management node, not the guest. Future guest targeting must use `192.168.1.33` or an explicitly authorized management-plane path (`S1-EV-024`).

The earlier frozen baseline recorded additional guest-internal Debian/package/listener observations. Those bytes remain historical and unchanged; this correction does not falsely reclassify them as newly replayable evidence.

## 3. Bounded non-mutation result

The selected stable Proxmox configuration fields hashed to:

```text
1dec136d046e1f08c13f7a2de634cd3663a04210551e4b2cffadb3f7132c7d36  before
1dec136d046e1f08c13f7a2de634cd3663a04210551e4b2cffadb3f7132c7d36  after
```

The hashes match, both captures record zero mutating requests and no guest SSH, and the guest remained running (`S1-EV-025`). This proves only the stated operator/API boundary and selected configuration equality—not guest filesystem immutability.

## 4. Stage boundary

All compatibility probes ran on the Hermes execution host in disposable `/tmp` roots, never in CT 200 (`S1-EV-003`–`S1-EV-023`, `S1-EV-026`–`S1-EV-029`). No package install, database, source scaffold, Git initialization, service action, firewall/DNS/TLS change or reboot was authorized on CT 200.

Stage 2 remains forbidden until the corrected candidate receives independent closure. CT 200 remains DEVELOPMENT and may not receive production data or credentials.
