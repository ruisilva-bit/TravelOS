# ADR-011: Document Storage and Explicit Access Grants

> Superseded in part by ADR-016 (Portal document grants only).

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

Traveller documents can include passports, insurance and other restricted data. Trip/family membership is insufficient authority, and files must not be publicly addressable.

## Decision

Document metadata/version/classification lives in PostgreSQL; immutable private bytes live behind a `StorageProvider` using opaque object IDs. `PrivateFilesystemProvider` is acceptable initially if it is outside static roots, root-confined, immutable, encrypted at rest, coherently backed up and consistent with metadata. Domain/application contracts expose only provider capabilities and opaque IDs—never paths, file descriptors or filesystem APIs—so S3/MinIO or another provider can replace it without changing Document, grant or publication semantics.

Uploads stream to provider quarantine, validate size/detected type/checksum, pass MalwareScanProvider and become AVAILABLE only after durable private storage/metadata completion. The selected provider/storage layer and off-instance backups use encryption at rest with access-separated key/secret management. Portal access requires active TripAccessGrant where relevant plus an explicit active DocumentGrant for principal/document/version. Every list/download reauthorizes. Confidential/Restricted Portal bytes are streamed/proxied only through the Portal API; V1 issues no direct storage or reusable bearer download URL.

Document-sensitive actions are audited. Content, secret URLs and raw bytes never enter logs/publication/job payloads.

Active privacy deletion is an idempotent document state machine, not a database-only flag:

1. verify permission, legal basis and legal hold; revoke grants and mark the version `DELETING` so all reads fail closed;
2. request deletion through the `StorageProvider` by opaque object ID; the provider contract makes repeated delete/head calls safe;
3. confirm the provider no longer returns the active object, then mark metadata `DELETED` and retain only lawful non-sensitive evidence/checksum;
4. a crash resumes from the recorded state; it never restores grants or marks completion before provider confirmation.

This removes the active object but does not claim that pre-deletion encrypted backups have already expired. Restore reconciliation and the residual window follow ADR-014.

## Consequences

- Correct least privilege and provider portability.
- More grant/scanning/storage lifecycle complexity.
- Database and object backups need a coherent restore-point protocol.
- Active deletion does not immediately remove pre-deletion copies from retained encrypted backups; ADR-014 governs that explicit residual window.

## Rejected

- Public/static filesystem paths.
- Blob storage in PostgreSQL for all files.
- Automatic sharing with all Trip/Customer/group members.
- Embedding long-lived signed URLs in publications.
- Direct/signed Portal URLs for Confidential or Restricted documents, even when nominally short-lived: they leave an unavoidable residual revocation window.
- MinIO/S3 process per CT before needed.

## Revisit trigger

HA, scale, object-lock, CDN or storage-contract requirements justify S3-compatible/external storage. Legal/threat evidence may separately justify provider-native deletion or granular crypto-erasure. Grant/authorization and domain semantics remain unchanged.
