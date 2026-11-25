# Stage 10 actual backup/recovery execution checkpoint

This is partial operational evidence, **not Stage 10 GO**. No Stage 11 actions. The active application remains the accepted predecessor; no new release activation or migration is claimed.

## Versioned recovery mechanism qualification (separate synthetic execution)

`tooling/deployment/stage10-native-recovery.py` now implements bounded native manifest/WAL verification followed by a non-root private-tmpfs clone, disabled TCP/recovery/archive/preload hooks, fixed ledger/Trip/Person/Customer aggregate queries and explicit Admin/Portal workspace-SELECT privilege observations. It accepts no caller SQL. Its result deliberately remains `NATIVE_CLONE_QUERIED_NOT_QUALIFIED` and data availability stays `CLOSED_PENDING_PRIVACY_INTERVAL_RECONCILIATION`.

The parent re-executed the real synthetic PG18 backup/restore using a systemd user service with `MemorySwapMax=0` and `LimitCORE=0`. Native manifest and WAL checks passed; its one-entry ledger head was `synthetic_only`, the three business fixture counts were zero, Admin Trip SELECT was true and Portal Trip SELECT was false. The synthetic archive SHA-256 was `8b69a59a589c946c815fed347dd5585d0a50aa120ba3d6d99d2d14c1b1b30f88`. This is explicitly **not the 16-migration schema or the actual CT200 backup**.

Thirteen unit tests also passed in that execution context, including bounded fast-to-immediate stop escalation and preservation when both stops fail, the PID stays alive, start is unconfirmed, PID/socket evidence remains, or deletion fails. The failure-injection tests use mocked lifecycle callbacks; the synthetic integration exercises actual PostgreSQL startup, queries and shutdown. No real stop-failure drill or complete current-schema recovery is inferred from those mocks. The original real recovery evidence below remains separate and unchanged.

## Actual CT200 encrypted backup and partial recovery

The fixed root-owned producer on CT200 completed with exit 0 and delivered only encrypted CMS ciphertext through pinned SSH. The build-host receiver published after successful producer completion; independent on-disk readback matched:

- ID: `stage10-ce77459b3d4b6a673297cb5e2899ec37`
- Ciphertext: 4728999 bytes
- SHA256: `669a604587be35560e9d7d17a2cbc0ff3a9b3f42de0e22485dc0d4160f6f31ce`
- Off-instance store: `/home/hermes/.local/share/travelos-stage10-backups`

A systemd user service born with verified `memory.swap.max=0`, zero swap current and core dumps disabled authenticated/decrypted the real ciphertext using the separately managed recovery key. It decompressed only into anonymous process memory and streamed the recovered archive through pinned SSH. No private recovery key was sent to CT200. The service reported zero swap use.

- Native archive: 55124992 bytes
- SHA256: `6d8c7cf4d0759aa1756a8f7d6d7c06dbb8b2b9a490521fd93fdcf3969336eccb`
- 1641 archive members, 1612 manifest files

On CT200, the existing dedicated backup account independently ran native manifest and WAL verification, extracted into a generated private directory under `/run/travelos-stage10-backup`, and booted the restored PG18 cluster with a private socket, empty TCP listen address, archive mode off, no preload libraries or recovery hooks. Queries returned:

| Measurement | Live source after backup | Restored clone |
|---|---:|---:|
| Migration ledger count | 16 | 16 |
| Role count | 26 | 26 |
| Database count | 4 | 4 |
| Application/catalog table count | 69 | 69 |

Live source head: `0016_stage9_staff_invitations`. Source query used the existing credential executor and documented migrator-to-owner delegation in a READ ONLY transaction ending in ROLLBACK. These aggregate counts do not prove identical business rows, restored ledger head, ACL behavior or post-backup privacy-deletion coverage.

The restored server stopped and its generated directory was removed. A subsequent separate SSH readback found zero entries in the staging directory. Source services were not restarted. The complete decrypt/transfer/verify/clone-query/cleanup service invocation reported 3.151 seconds wall service runtime; this is a measured probe duration, not an accepted RTO or full disaster-recovery measurement.

## Retention

The new fixed-path retention runner passed six disposable tests. Its first real sweep checked one managed object and expired zero. The version-controlled user service/timer were linked and enabled; systemd readback reported timer active, service Result=success and ExecMainStatus=0. The timer checks hourly, deleting only recognized new Stage10 managed objects after the approved seven days. Historical backup roots are never scanned. These mutable worktree-linked units still require independent operational review and durable final installation as part of closure.

## Remaining gates

- Independent review of these actual operational paths and new retention runner/units.
- Source/restore data and ACL sampling, restored ledger head, and ADR-014 interval reconciliation; protected payloads have not been exposed from the clone.
- Complete coordinated release/config/object/secret-reference recovery evidence and host-loss custody qualification as required by accepted scope.
- Actual signing, exact artifact/canonical CI, least-privilege cutover, deployment/acceptance, evidence freeze and final independent GO.

Detailed mutable operator receipts remain in `.hermes/state/stage10-actual-backup-receipt.json`, `stage10-actual-backup-authentication.json`, `stage10-actual-restore-output.jsonl` and `stage10-actual-restore-catalog-parity.json`. These local-only sidecars are not a frozen canonical evidence bundle and are not a substitute for one. The source scripts used for the initial recovery probe are scratch execution inputs, not yet qualified installed recovery entrypoints.
