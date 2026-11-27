# Share links

Customers never log in. A staff member (permission `trip.publish`, recent MFA) clicks "Partilhar com
o cliente". The system freezes a customer-safe snapshot of the trip and creates a revocable,
expiring, unguessable link `https://<host>/v/<token>`. See [ADR-017](adr/ADR-017-share-links.md).

- **Snapshot.** Built from explicit allowlist ports into `TripSnapshotV1Schema` (strict). Supplier
  cost, margin, internal notes and supplier have no field. Stored immutably in
  `trip_ops.publication_snapshot`. Later edits do not change an existing link; sharing again makes a
  new snapshot and link.
- **Token.** 32 random bytes, 43-character base64url. Only the SHA-256 is stored. Shown once.
- **Validity.** 1 to 365 days, default 90. Staff can revoke at any time; revoking is idempotent.
- **Preview.** "Pré-visualizar como cliente" shows exactly what the snapshot would contain, read-only.
- **Public page.** `GET /v/:token`, no cookie, server-rendered HTML without JavaScript. Every failure
  (malformed, unknown, expired, revoked, unparsable) is the same 404. Rate limited; never cached,
  indexed or referred.
- **Staff API.** `POST /api/admin/trips/:tripId/share-links` (Idempotency-Key header),
  `GET /api/admin/trips/:tripId/share-links`, `POST /api/admin/share-links/:shareLinkId/revoke`.
- **Deploy note.** The reverse proxy must route `/v/*` to admin-api ahead of the SPA fallback.
