# Stage 10 DEVELOPMENT backup/recovery implementation contract

**Mutable technical contract; not execution evidence or Stage 10 GO.** Scope is the existing CT200 only, with the existing build host as off-instance encrypted-backup storage. No new CT, VM, container runtime, namespace, public listener or production operation.

## Authorization and retained boundaries

Rui explicitly approved a dedicated encrypted backup-recovery key in the existing build-host encrypted credential store, outside Git/artifacts/backup data, and a **7-day automatic expiry policy only for newly created Stage 10 DEVELOPMENT backups**. Existing backup files must remain untouched. The separate dedicated DEVELOPMENT Cosign signing-key authorization is not reused as a backup key or a receipt/privacy approval.

Keep source cluster `18/main` on port 5432 and the active Stage 9 release unchanged. Do not apply a migration, restart an existing service, replace sudoers or remove access as part of backup qualification. Preserve independent root-console recovery and protected pre-change configuration before later privilege cutover.

## Native physical backup, not a synthetic byte round trip

Use installed PostgreSQL 18 native `pg_basebackup` and `pg_verifybackup`, binding actual binary/version provenance. Include WAL using a supported native option and SHA-256 backup-manifest checksums. Bound transfer rate, timeout, disk use and temporary storage; preflight capacity and reject unsupported external tablespaces/symlinks or resource requirements rather than guessing their treatment. Do not copy live PGDATA files manually or mistake a logical dump for the accepted physical/WAL backup set.

A versioned, reviewed fixed operator must create private temporary backup space, execute as the appropriate PostgreSQL maintenance identity, verify the native manifest, encrypt before off-instance transfer, and retain only sanitized metadata/receipts. No generic shell/interpreter/pg_dump/psql/systemctl sudo grant or caller-selected path/command is introduced. A failed or interrupted backup remains an explicitly failed/unknown attempt; no overwrite/relabel.

## Encryption, key separation and off-instance retention

Use a maintained authenticated-encryption implementation through a fixed reviewed adapter; never implement cryptographic primitives. Store only encrypted backup bytes in a private, dedicated Stage 10 backup root on the build host. Keep private recovery material and its protection secrets in the separately managed encrypted credential store, not in that root, the backup manifest, source, artifact or evidence. CT200 runtime identities receive no recovery private key. Any backup certificate/public recipient is explicitly pinned and non-secret.

Separate key creation, protected credential readback, encryption/authentication, recovery of encrypted material, independent recipient pinning, and restored database usability as distinct evidence. Same-host systemd-creds recovery does not prove recovery after loss of the build host or its host-bound credential key; preserve that limitation until a separately retained recovery mechanism is actually demonstrated. Do not claim successful backup from ciphertext existence alone.

## Same-CT isolated recovery probe

Restore only into a fresh private recovery directory within CT200, never over the main cluster. If a temporary PostgreSQL recovery process is required, it uses a dedicated private Unix socket and **no TCP listener**, fixed safe configuration and bounded resources. No Admin/Portal process points to it; no Caddy/DNS/firewall change. Keep PostgreSQL OS/account access authenticated through the approved recovery path; do not introduce application-auth bypass, public trust authentication or copied credentials in logs.

Run native backup verification before startup, then inspect the clone using the supported maintenance identity. Compare explicit source/restore migration-ledger count/head, representative relational counts and catalog/ACL projections; no `SELECT count(*)` without a FROM. Establish and record the backup cutoff plus source changes during the interval; a mismatch is a failed comparison to diagnose, not evidence to normalize. Exercise restricted roles where applicable instead of inferring privileges from matching row counts.

Apply ADR-014: cover the interval from backup cutoff to recovery decision with approved deletion/audit/operational evidence. Unknown coverage prevents opening affected protected payloads. This probe has no application ingress regardless; do not infer deletion absence from a missing restored row or invent a new erasure ledger. Stop the probe process, verify it is gone, and clean only its positively identified private temporary paths. Never stop or delete the live cluster, active data or older backups.

## Receipt and expiry contract

Bind backup bytes, native manifest/checkpoint, source instance, migration head, compatible release digest, encryption-recipient identity, transfer checksum/readback, creation/cutoff/expiry times, restore verification and cleanup to exact receipts. Keep secrets/customer payload out of them. Sign or authenticate the decisive receipt via the reviewed independent-provenance path before canonical evidence acceptance; a self-supplied digest is not that authority.

Expiry may touch only objects created by this Stage 10 manager, in its dedicated root, after their explicit approved 7-day expiry. Require recognized metadata, exact regular-file inventory and containment; reject links, unknown objects, malformed clocks/metadata and ambiguous partial objects. Do not follow paths supplied by backup data or delete historical `/var/backups/travelos` files. Test expiry/recovery/failure behavior using synthetic objects before enabling the versioned timer. Record every deletion of managed ciphertext without exposing its contents.

## Current observed prerequisites

CT200 reports PostgreSQL `18.6 (Debian 18.6-1.pgdg13+2)` native tools and OpenSSL `3.5.1`; the build host reports OpenSSL `3.5.6`. These are discovery observations, not authenticated binary pins or adapter qualification. The fixed read-only DB inspector has verified session `travelos_migrator`, current owner `travelos_owner`, all checked cluster privileges false, 16 migrations/head `0016_stage9_staff_invitations`, server version number `180006`. No real Stage 10 backup, encryption key provisioning, restore, expiry or operator installation has been performed by this contract.
