# Deploying TravelOS on CT200

One agency, one server: a Debian 13 LXC (CT200) with PostgreSQL 18 (apt, cluster `18/main`, 127.0.0.1:5432),
the pinned Node 24.19.0 (from `tooling/ci/bootstrap-toolchain.sh`), two systemd services
(`travelos-api`, `travelos-worker`) and Caddy for the LAN. See ADR-016. Layout:

| What | Where |
| --- | --- |
| Code checkout (user `travelos`) | `/srv/travelos` |
| Node/pnpm toolchain | `/srv/travelos-toolchain` |
| Manifest (no secrets) | `/etc/travelos/travelos.json` |
| Secrets, one file each | `/etc/travelos/credentials/{admin-api-db,worker-db,staff-auth-realm,migrator-db}` |
| Backups | `/var/backups/travelos` |

The admin app and API are reachable on the LAN only. Nothing is public.

## First-time install (as root unless noted)

1. `useradd --system --create-home --home-dir /home/travelos --shell /bin/bash travelos`;
   `install -d -o travelos -g travelos /srv/travelos /srv/travelos-toolchain /var/backups/travelos`.
2. `apt install git curl rsync caddy postgresql-18`; clone the repo: `sudo -u travelos git clone <repo-url> /srv/travelos`.
   (If the source is a checkout in someone's home directory, `travelos` cannot read it, and `deploy.sh` runs `git fetch origin`:
   make a readable stand-in first, `git clone --bare <path> /srv/travelos-origin.git && chown -R travelos: /srv/travelos-origin.git`,
   clone from that, and later `git remote set-url origin <real-url>`.)
3. Create the database and roles: `sudo -u postgres psql -v database_name=travelos_prod -f /srv/travelos/deploy/database/bootstrap-database-and-roles.sql`.
   Then set a password for each login role (`ALTER ROLE travelos_admin_api PASSWORD '...'`, same for
   `travelos_worker` and `travelos_migrator`) and add a backup login:
   `CREATE ROLE travelos_backup LOGIN PASSWORD '...'; GRANT pg_read_all_data TO travelos_backup; GRANT CONNECT ON DATABASE travelos_prod TO travelos_backup;`
   (the bootstrap revokes `PUBLIC`, so the explicit `CONNECT` is required; if the role exists from an older install,
   `ALTER ROLE travelos_backup LOGIN NOREPLICATION INHERIT` instead of `CREATE ROLE`). Avoid `/ + =` in passwords
   (`openssl rand -base64 32 | tr -d '\n=/+'`).
4. Secrets: `install -d -m 750 -o root -g travelos /etc/travelos /etc/travelos/credentials`. Write each password
   (one line, no extra text) into `admin-api-db`, `worker-db`, `migrator-db`; put a long random string
   (`openssl rand -base64 48`) into `staff-auth-realm`. Then `chmod 640` and `chgrp travelos` every file.
5. Manifest: `cp /srv/travelos/deploy/manifests/travelos.example.json /etc/travelos/travelos.json` and adjust the host
   name (it must match the Caddyfile site address).
6. Config files for the scripts, both `root:travelos 640`:
   `/etc/travelos/migrate.env` with `TRAVELOS_DB_HOST=127.0.0.1`, `TRAVELOS_DB_PORT=5432`, `TRAVELOS_DB_NAME=travelos_prod`,
   `TRAVELOS_DB_MIGRATOR_ROLE=travelos_migrator`, `TRAVELOS_DB_OWNER_ROLE=travelos_owner`,
   `TRAVELOS_DB_PASSWORD_FILE=/etc/travelos/credentials/migrator-db`;
   `/etc/travelos/backup.env` with `PGDATABASE=travelos_prod`, `PGUSER=travelos_backup`, `PGHOST=127.0.0.1`,
   `PGSSLMODE=disable` (loopback; the unit has no home directory for client certificates),
   `PGPASSFILE=/etc/travelos/pgpass` (a `127.0.0.1:5432:travelos_prod:travelos_backup:<password>` line, owned by `travelos`, mode **600**:
   libpq ignores a pgpass file with group access),
   and optionally `TRAVELOS_BACKUP_COPY_TO=user@nas:/path/`.
7. Allow the deploy user to restart the services: `/etc/sudoers.d/travelos` containing
   `travelos ALL=(root) NOPASSWD: /usr/bin/systemctl restart travelos-api travelos-worker`.
8. Install units and Caddy: `cp /srv/travelos/deploy/systemd/* /etc/systemd/system/`;
   `cp /srv/travelos/deploy/caddy/Caddyfile /etc/caddy/Caddyfile` (edit the host name);
   `systemctl daemon-reload && systemctl enable travelos-api travelos-worker travelos-backup.timer && systemctl enable --now caddy`;
   `systemctl start travelos-backup.timer`. Let `postgres` read the dumps for the restore drill: `usermod -aG travelos postgres`.
   If Caddy was already running with another config, `systemctl restart caddy` (use `restart`, not `reload`, if the old config had `admin off`).
   The LAN name is `travelos-dev`; CT200 itself resolves it locally (add `127.0.0.1 travelos-dev` to `/etc/hosts` only if it does not).
9. First deploy, as `travelos`: `cd /srv/travelos && scripts/deploy.sh` (or `scripts/deploy.sh origin/<branch>` while `main` does not
   have the code yet). It builds, migrates, starts the services and checks health. Check through Caddy: `curl -si http://travelos-dev/`
   (admin HTML), `curl -si http://travelos-dev/v/<43 x A>` (404 share page); the API's `/health/live` is only served on
   `127.0.0.1:3101` (with `-H 'Host: travelos-dev'`), Caddy does not proxy it.
10. Create the first Owner, as `travelos`, in an interactive terminal (it needs a real TTY; two steps, each prompts):
    `cd /srv/travelos && export PATH=/srv/travelos-toolchain/node-v24.19.0-linux-x64/bin:$PATH CREDENTIALS_DIRECTORY=/etc/travelos/credentials`,
    then `pnpm auth:bootstrap-first-owner issue-first-owner --manifest /etc/travelos/travelos.json` (asks for the Owner email, prints a
    one-time token; optional `--expires-in-minutes N`) and
    `pnpm auth:bootstrap-first-owner enroll-first-owner --manifest /etc/travelos/travelos.json` (asks email, display name, the token, a password).
    The LAN name `travelos-dev` is resolved to CT200 by the router DNS, so other computers need no hosts-file entry; open `http://travelos-dev`.

## Routine deploy

As `travelos`: `cd /srv/travelos && scripts/deploy.sh` (latest `origin/main`) or `scripts/deploy.sh <tag-or-sha>`.
If it fails it prints why; check `journalctl -u travelos-api -u travelos-worker -n 100`. To roll back, deploy the
previous commit (migrations only go forward, so a bad migration needs a new fixing migration or a restore).

## Backups and the restore drill

The timer runs `scripts/backup.sh` every night at 02:30: a `pg_dump -Fc` to `/var/backups/travelos`, 14 days kept,
then an rsync to `TRAVELOS_BACKUP_COPY_TO` if set (a warning if not; a backup on the same box is not enough).
Check: `systemctl list-timers travelos-backup.timer` and `journalctl -u travelos-backup -n 20`.

Try a restore every few months, into a scratch database, never over the live one:
`cd /tmp && sudo -u postgres /srv/travelos/scripts/restore.sh /var/backups/travelos/travelos-<stamp>.dump travelos_restore_test`.
It prints row counts for `crm.customer`, `trip_ops.trip`, `staff_access.staff_membership`; compare with the live
database, then `sudo -u postgres dropdb travelos_restore_test`. To recover for real, restore into a new name, stop
the services, point the manifest at it (or rename databases), and start again.

## Optional: public share links via Cloudflare Tunnel (later)

Customers open `/v/<token>` links. If you want them reachable from the internet, run `cloudflared` on CT200 with an
ingress rule for a public hostname that forwards **only the path `/v/*`** to `http://127.0.0.1:3101`
(the Host header must be the manifest admin host; set `httpHostHeader` in the ingress rule). Never route `/`, `/api/*`
or the admin hostname through the tunnel. This exposes the system to the internet (DNS, TLS), so it needs the
owner's go-ahead first. The tunnel is not set up by anything in this repository.
