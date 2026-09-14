# M1 Stage 1 — CT 200 Baseline

**Status:** Stage 1 evidence record  
**Captured:** 2026-08-14  
**Environment:** DEVELOPMENT only  
**Authority:** `IDEA.md`, Accepted Phase 0 baseline, accepted ADRs, `AGENTS.md`, and `.hermes/plans/2026-08-14_105849-travelos-phase-1-m1-implementation.md`

## 1. Scope and safety statement

This document records the read-only Stage 1 inventory of Proxmox guest CT 200. Stage 1 did not install packages, refresh APT metadata, create files/databases/users/groups, alter services/networking/firewall, initialize Git, scaffold TravelOS, or reboot the guest.

All Node.js, Better Auth, PostgreSQL, migration, dump/restore, Caddy, SBOM and signing probes ran in disposable paths on the Hermes execution host, outside CT 200 and outside the TravelOS repository.

The execution record contains no mutating CT command. This is an operational no-mutation statement, not a claim of a byte-for-byte filesystem diff.

## 2. Target identity and address correction

| Item | Observed value |
|---|---|
| Proxmox node/API target used for `pct exec 200` | `pxmx2`, `192.168.1.200` |
| Guest ID/name | `200`, `travelos-dev` |
| Guest-reported IPv4 address | `192.168.1.33/24` on `eth0` |
| Guest architecture | `x86_64` / Debian `amd64` |
| OS | Debian GNU/Linux 13 (`trixie`) |
| Kernel exposed to guest | Linux `6.17.13-3-pve` |
| Container | unprivileged LXC; 4 cores; `nesting=1`; Proxmox firewall enabled; DHCP on `vmbr0` |

`192.168.1.200` is the Proxmox node address, not the live guest address. Future operational commands must target the guest at `192.168.1.33` or use an explicit `pct exec 200` path through the Proxmox node. An address in a request or manifest must never be assumed to identify an Agency.

## 3. Capacity snapshot

| Resource | Observed value |
|---|---:|
| vCPU | 4 |
| RAM total | 7,999,586,304 bytes |
| RAM available at capture | 7,978,299,392 bytes |
| Swap total / used | 7,999,586,304 / 0 bytes |
| Root filesystem | `/dev/loop3`, ext4 |
| Root capacity | 20,957,446,144 bytes |
| Root used | 687,149,056 bytes (4%) |
| Root available | 19,179,778,048 bytes |
| Inodes used / available | 22,042 / 1,288,678 (2% used) |

`/`, `/opt`, `/etc`, `/var/lib` and `/mnt` were root-owned directories on the same root filesystem. `/var/lib/postgresql` was absent. The snapshot has sufficient development headroom for the authorized M1 bootstrap, but it is not production capacity evidence or permission to deploy.

## 4. Init, time and network baseline

- PID 1: `systemd`; system state: `running`.
- systemd: `257 (257.8-1~deb13u2)`.
- timezone: `Etc/UTC`; system clock reported synchronized.
- `systemd-timesyncd`, `chrony` and `chronyd` were inactive at capture. Continuous synchronization must be explicitly proved before deployment/recovery tests; the one-time synchronized flag is not sufficient production evidence.
- observed listeners:
  - DHCP client UDP `0.0.0.0:68`;
  - SSH TCP `*:22`;
  - Postfix loopback-only TCP `127.0.0.1:25` and `[::1]:25`.
- nftables was present (`v1.1.3`) with an `inet filter` table; UFW was absent.
- no Caddy, Nginx, Apache, PostgreSQL, Docker, Podman or containerd service collision was found.

Any future DNS, TLS, firewall, public exposure or network change still requires explicit approval under `AGENTS.md`.

## 5. Installed runtime and account baseline

The following were absent as installed packages and executable tools:

- Node.js, npm, Corepack and pnpm;
- PostgreSQL server/client/common, `psql`, `pg_dump`, `pg_restore` and pgBackRest;
- Caddy, Nginx and Apache;
- Git, Docker and Podman.

No `postgres` or `caddy` account/group existed. The standard `www-data` account/group existed. Stage 1 created no account and selected no UID/GID; provisioning remains a later authorized deployment concern.

## 6. Cached Debian metadata — informational only

Without `apt update`, the guest's cached Debian metadata showed:

| Package | Cached candidate |
|---|---:|
| `nodejs` | `20.19.2+dfsg-1` |
| `postgresql` metapackage | `17+278` |
| `pgbackrest` | `2.55.1-1` |
| `caddy` | `2.6.2-12+b3` |

These values were not installed and are not the TravelOS pins. Stage 1 deliberately selected and tested newer official artifacts outside the CT; see `M1_VERSION_COMPATIBILITY_MATRIX.md` and `M1_BOOTSTRAP_DECISIONS.md`.

## 7. Stage 2 hand-off constraints

Stage 2 may begin only after independent Stage 1 closure. Its authorization does not inherit permission to install or deploy to CT 200 unless the Stage 2 brief explicitly grants it.

The next implementation stage must preserve these conditions:

1. no production data or production credentials on CT 200;
2. no customer-specific source, schema, migration or build;
3. no runtime package compilation/install in a customer deployment path;
4. no PostgreSQL public listener;
5. explicit, separate Staff and Portal identity realms;
6. no automatic migration on application startup;
7. exact-host, firewall and public-exposure work remains separately approved;
8. CT address targeting uses the corrected node/guest distinction above.
