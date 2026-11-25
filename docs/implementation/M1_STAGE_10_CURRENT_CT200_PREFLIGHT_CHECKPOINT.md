# Stage 10 — current CT200 read-only checkpoint

This is a live predecessor-continuity and database observation, **not a Stage 10 candidate operational-preflight PASS or GO**.

## Verified observations

- Pinned-host SSH using the existing dedicated identity reached CT200 DEVELOPMENT as UID 1000. Ambient/default SSH identity selection had failed; the established explicit identity worked. No credential was created or disclosed.
- `/opt/travelos/current` still points to `/opt/travelos/releases/travelos-stage9-gen11-d6610462`.
- The Admin API, Portal API and worker systemd units were all active. This is service-state evidence only, not authenticated application/readiness acceptance.
- The existing fixed `stage10-ct200-db-inspection.py --inspect` executor returned `READ_ONLY_DATABASE_INSPECTION_PASS`: PostgreSQL version number 180006, exactly 16 ordered migrations, head `0016_stage9_staff_invitations`.
- Initial/session database identity was `travelos_migrator`; the documented local owner delegation yielded `travelos_owner`. All five inspected owner cluster-role privilege flags were false. The transaction was READ ONLY and rolled back.

## Protected operator provisioning observations

A further read-only probe as UID 1000 found all five expected Stage 10 protected paths absent: `/usr/local/sbin/travelos-stage10-operator`, `/usr/local/libexec/travelos-stage10/operator.py`, and the development policy, activation authorization and qualification receipt under `/etc/travelos/`. These were explicit `FileNotFoundError` results, not permission-denied results. No protected files were created.

The noninteractive sudo listing was available and contained a broad passwordless `ALL` grant. Only the boolean detection was emitted; no raw sudo listing or credential-bearing configuration was retained. This is policy metadata, not a full effective-privilege/denial qualification. It confirms that a constrained Stage 10 privilege boundary must not be claimed merely from source-level helper tests.

## Preserved operational boundaries

No services were restarted, no release activated, no migration applied, no database rows changed and no DNS/firewall/public exposure changed by these probes. Earlier real backup/recovery evidence remains separately recorded in `M1_STAGE_10_ACTUAL_RECOVERY_CHECKPOINT.md`; this inspection neither repeats nor supersedes it.

The database probe explicitly does not qualify object privileges or the executor's least privilege. Candidate-specific signing/activation enforcement, effective privilege cutover, complete recovery, independently authenticated retained evidence/privacy acceptance and final canonical qualification remain open. No Stage 11 action was taken.
