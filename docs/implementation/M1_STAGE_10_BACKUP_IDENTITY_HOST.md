# Stage 10 CT200 Backup Identity Host Adapter

## Architecture and Boundaries

`tooling/deployment/stage10-backup-identity-host.py` implements the privileged root adapter for the backup-identity orchestration protocol defined in `stage10-backup-identity.py`.

### Core Invariants
- **Fixed Identity:** Single system account `travelos_backup` and matching PostgreSQL replication/login role `travelos_backup`.
- **Fixed HBA Rules:** Prepend exactly `local replication travelos_backup peer` and `local postgres travelos_backup peer`. Zero trust auth, zero password auth.
- **HBA conflict detection, not CAS:** Checks expected bytes/inode/device before atomic replacement and directory sync. POSIX replacement is not conditional on the destination inode. Publication and restore require an exclusive maintenance window with other trusted root/PostgreSQL HBA writers quiesced; that prerequisite is not yet established or enforced. Installation remains unqualified.
- **Authenticated Snapshot:** Pre-change `pg_hba.conf` encrypted using OpenSSL CMS AES-256-GCM via sealed memfd to pinned public recipient cert (`b7e09a9f...`). Private key is strictly off-instance.
- **Rollback limitation:** OS-account deletion is deliberately disabled: even a matching UID/GID check cannot make name-targeted `userdel` safe under concurrent administration. Compensation preserves the locked account and requires identity-reviewed reconciliation. HBA restoration has the maintenance-window prerequisite above. Database-role deletion now holds a `SHARE ROW EXCLUSIVE` lock on `pg_catalog.pg_authid` through OID verification and DROP in one transaction. Parent and independent reviewer `deleg_b7c67f30` executed the local PostgreSQL 18.6 two-session test: competing ALTER/DROP blocked and a replacement role survived the mismatched OID guard. This qualifies the local locking mechanism only, not installation or execution on CT200.
- **Process Loss:** Ambiguous outcomes raise `PublicationUncertain`, writing `reconciliation_required` journal marker and refusing blind rollback or automated retry.
