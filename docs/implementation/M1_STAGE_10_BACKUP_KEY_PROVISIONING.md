# Stage 10 DEVELOPMENT backup-key provisioning

Mutable implementation note. Not operational custody, independently authenticated recipient trust, canonical evidence or Stage 10 GO.

## Scope and authority

The authorization in `M1_STAGE_10_BACKUP_RECOVERY_CONTRACT.md:7` permits a dedicated encrypted recovery key using the existing build-host systemd encrypted credential platform. The fixed provisioner stores its purpose-specific objects under `/home/hermes/.config/travelos-stage10-credentials/backup-recovery-v1`; this is separate from Git, artifacts and backup ciphertext. Its private parent directory may be created within the existing platform. No new vault/service, production material or signing key is introduced.

`tooling/deployment/stage10-backup-key-provision.py` accepts only `provision` and `check`, under build-host user `hermes` UID/eUID 1000. There are no destination, provider, password, key, signing or decrypt-output options. The ordinary operator must already have Rui's authorization; the program does not manufacture that authorization, a human receipt or a privileged boundary. Protected file/FD/publication primitives are reused from the qualified filesystem helper; its synthetic public keystore provisioning APIs are not invoked.

## Concrete protection and verification

- Independently fixed root-owned OpenSSL and systemd-creds executable paths/content pins are snapshotted into sealed FDs. The trusted base OS, Python and library loader remain assumptions; same-UID hostile writers are not isolated by this interface.
- OpenSSL generates a dedicated RSA3072 key encrypted using a random 256-bit passphrase. Key/passphrase remain in memory or sealed descriptors; neither is in argv, inherited application environment, ordinary temporary files or output.
- The encrypted PEM and its password are separately wrapped by user-scoped systemd-creds with distinct fixed backup-purpose names. Both encrypted objects are written as 0600 files in a 0700 directory.
- A self-signed 365-day certificate is only the explicitly pinned CMS encryption recipient, not PKI/TLS identity. No automatic key deletion/rotation follows certificate expiry.
- Strict bounded inventory, duplicate/unknown-field and purpose checks precede credential recovery. Readback unwraps both credentials, encrypts/decrypts a fixed non-sensitive probe through the maintained CMS-GCM adapter and verifies the exact recipient hash. This proves same-host usable recovery material, not host-loss resilience.
- No-replace publication and both fsync phases protect initial creation. Ordinary prepublication failure removes only its positively identified private staging files. Post-rename parent-fsync uncertainty preserves the published store, returns explicit uncertainty and prohibits blind overwrite/retry.
- Public CLI core dumps are disabled; commands use a clean fixed environment, sealed FDs and bounded time/output. CLI failures expose fixed state codes, not raw errors/provider output.

## Classification, retention and access

| Object | Owner/classification | Access and retention | Operational record |
| --- | --- | --- | --- |
| Recovery key/password credentials | Rui's DEVELOPMENT operational custody / SECRET | Fixed build-host user store only; never CT200 or backup root. Retain while required to decrypt retained objects; deletion/rotation requires a separately approved procedure. | CLI emits state/purpose only, never content. |
| Recipient certificate/hash | DEVELOPMENT backup operation / non-secret integrity metadata | Private store; public certificate may later be installed only through independently pinned versioned target provisioning. | Hash-bound result; recipient trust remains pending. |
| Purpose/environment/protection/schema fields | DEVELOPMENT operational metadata / non-secret | Strict fixed schema, same private store; no Portal eligibility or application-domain field. | Readback returns exact fields, not an approval receipt. |
| Host-loss/independent-trust fields | Qualification status / non-secret | Fixed `NOT_QUALIFIED` and `PENDING`; this tool cannot promote them. | Later separately exercised and adjudicated custody records required. |

No automatic key-retention claim derives from the seven-day ciphertext expiry policy. Application Activity/Audit/outbox are untouched; source tests and sanitized operational qualification records are not fabricated domain audit events.

## Gate still open

Disposable tests exercise real key generation, encrypted credential readback, GCM recovery, no-overwrite, wrong purpose/unknown input, prepublication failure and postpublication uncertainty. Do not provision the real destination before independent review of these exact bytes. After such review, real provisioning/readback, independent public-recipient pinning and separately retained host-loss recovery are distinct gates. This helper does not establish the fixed CT200 backup OS/database identity, authenticated HBA policy, privileged operator, actual native backup/restore, timer or canonical signing/CI authority.
