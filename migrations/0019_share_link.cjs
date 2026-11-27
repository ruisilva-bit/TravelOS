// ADR-017: customers never log in. A staff member shares a frozen publication snapshot through a
// revocable, expiring, unguessable read-only link. Only the SHA-256 of the 32-byte token is stored;
// the raw token exists only in the creation response. The public page reads through one
// SECURITY DEFINER function so the public route needs no table privilege. Forward-only.
exports.up = (pgm) => {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '60s';

    DO $migration_context$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
    END
    $migration_context$;

    CREATE TABLE "trip_ops"."share_link" (
      "shareLinkId" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "tripId" uuid NOT NULL,
      "publicationId" uuid NOT NULL,
      "tokenHash" bytea NOT NULL UNIQUE CHECK (octet_length("tokenHash") = 32),
      "createdByStaffPrincipalId" text NOT NULL,
      "idempotencyKey" text NOT NULL CHECK (length("idempotencyKey") BETWEEN 1 AND 128),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "expiresAt" timestamptz NOT NULL,
      "revokedAt" timestamptz NULL,
      CONSTRAINT "share_link_expiry_check" CHECK (
        "expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '366 days'
      ),
      CONSTRAINT "share_link_trip_fk"
        FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "share_link_publication_fk"
        FOREIGN KEY ("publicationId", "agencyId", "tripId")
        REFERENCES "trip_ops"."publication_version" ("publicationId", "agencyId", "tripId")
        ON DELETE RESTRICT,
      CONSTRAINT "share_link_idempotency_unique"
        UNIQUE ("agencyId", "createdByStaffPrincipalId", "idempotencyKey")
    );
    CREATE INDEX "share_link_trip_idx" ON "trip_ops"."share_link" ("agencyId", "tripId", "createdAt" DESC);

    -- Append-only: the only permitted change is revokedAt NULL -> value; no DELETE, no TRUNCATE.
    CREATE FUNCTION "trip_ops"."guard_share_link_mutation"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
    AS $guard_share_link$
    BEGIN
      IF TG_OP = 'UPDATE'
         AND OLD."revokedAt" IS NULL AND NEW."revokedAt" IS NOT NULL
         AND (pg_catalog.to_jsonb(NEW) - 'revokedAt') = (pg_catalog.to_jsonb(OLD) - 'revokedAt') THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Share links are append-only; only revocation is permitted'
        USING ERRCODE = '55000', CONSTRAINT = 'share_link_immutable';
    END
    $guard_share_link$;
    REVOKE ALL ON FUNCTION "trip_ops"."guard_share_link_mutation"() FROM PUBLIC,
      "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "share_link_row_guard_trigger"
      BEFORE UPDATE OR DELETE ON "trip_ops"."share_link"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."guard_share_link_mutation"();
    CREATE TRIGGER "share_link_truncate_guard_trigger"
      BEFORE TRUNCATE ON "trip_ops"."share_link"
      FOR EACH STATEMENT EXECUTE FUNCTION "trip_ops"."guard_share_link_mutation"();

    REVOKE ALL PRIVILEGES ON TABLE "trip_ops"."share_link"
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    GRANT SELECT, INSERT ON TABLE "trip_ops"."share_link" TO "travelos_admin_runtime";
    GRANT UPDATE ("revokedAt") ON TABLE "trip_ops"."share_link" TO "travelos_admin_runtime";

    -- The single public read path: unknown, revoked and expired links all return zero rows.
    CREATE FUNCTION "trip_ops"."read_share_snapshot"(p_token_hash bytea)
    RETURNS TABLE ("canonicalPayload" text, "expiresAt" timestamptz)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
    AS $read_share_snapshot$
      SELECT snapshot."canonicalPayload", link."expiresAt"
        FROM "trip_ops"."share_link" AS link
        JOIN "trip_ops"."publication_snapshot" AS snapshot
          ON snapshot."publicationId" = link."publicationId"
         AND snapshot."agencyId" = link."agencyId"
         AND snapshot."tripId" = link."tripId"
       WHERE link."tokenHash" = p_token_hash
         AND link."revokedAt" IS NULL
         AND link."expiresAt" > pg_catalog.now()
    $read_share_snapshot$;
    REVOKE ALL ON FUNCTION "trip_ops"."read_share_snapshot"(bytea) FROM PUBLIC,
      "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    GRANT EXECUTE ON FUNCTION "trip_ops"."read_share_snapshot"(bytea) TO "travelos_admin_runtime";

    COMMENT ON TABLE "trip_ops"."share_link" IS 'Revocable, expiring read-only customer links. Stores SHA-256 of the token only; never the token.';
  `);
};

exports.down = () => {
  throw new Error("0019_share_link is forward-only");
};
