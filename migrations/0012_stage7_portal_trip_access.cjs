exports.up = (pgm) => {
  pgm.sql(`
    DO $migration_context$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
      IF (SELECT count(*) FROM "organization"."agency" WHERE "isRoot") <> 1 THEN
        RAISE EXCEPTION 'Stage 7 requires exactly one established root Agency';
      END IF;
    END
    $migration_context$;

    CREATE TABLE "portal_access"."runtime_agency_context" (
      "contextKey" text PRIMARY KEY CHECK ("contextKey" = 'PRIMARY'),
      "agencyId" uuid NOT NULL UNIQUE REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT
    );
    INSERT INTO "portal_access"."runtime_agency_context" ("contextKey", "agencyId")
    SELECT 'PRIMARY', "id" FROM "organization"."agency" WHERE "isRoot";

    CREATE TABLE "portal_access"."portal_principal_context" (
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "portalPrincipalId" text NOT NULL REFERENCES "portal_access"."portal_user" ("id") ON DELETE RESTRICT,
      "authorizationEpoch" bigint NOT NULL DEFAULT 1 CHECK ("authorizationEpoch" > 0),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY ("agencyId", "portalPrincipalId"),
      CONSTRAINT "portal_principal_context_single_agency" UNIQUE ("portalPrincipalId")
    );

    INSERT INTO "portal_access"."portal_principal_context" ("agencyId", "portalPrincipalId")
    SELECT root."agencyId", principal."id"
      FROM "portal_access"."runtime_agency_context" AS root
      CROSS JOIN "portal_access"."portal_user" AS principal;

    CREATE TABLE "portal_access"."portal_session_context" (
      "sessionId" text PRIMARY KEY,
      "portalPrincipalId" text NOT NULL,
      "agencyId" uuid NOT NULL,
      "authorizationEpoch" bigint NOT NULL CHECK ("authorizationEpoch" > 0),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "portal_session_context_session_principal_fk"
        FOREIGN KEY ("sessionId", "portalPrincipalId")
        REFERENCES "portal_access"."portal_session" ("id", "userId") ON DELETE CASCADE,
      CONSTRAINT "portal_session_context_principal_agency_fk"
        FOREIGN KEY ("agencyId", "portalPrincipalId")
        REFERENCES "portal_access"."portal_principal_context" ("agencyId", "portalPrincipalId") ON DELETE RESTRICT
    );

    INSERT INTO "portal_access"."portal_session_context"
      ("sessionId", "portalPrincipalId", "agencyId", "authorizationEpoch")
    SELECT session."id", principal."portalPrincipalId", principal."agencyId", principal."authorizationEpoch"
      FROM "portal_access"."portal_session" AS session
      JOIN "portal_access"."portal_principal_context" AS principal
        ON principal."portalPrincipalId" = session."userId";

    CREATE OR REPLACE FUNCTION "portal_access"."create_portal_principal_context"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $portal_principal_context$
    DECLARE
      root_agency_id uuid;
    BEGIN
      SELECT "agencyId" INTO root_agency_id
        FROM "portal_access"."runtime_agency_context"
       WHERE "contextKey" = 'PRIMARY';
      IF root_agency_id IS NULL THEN
        RAISE EXCEPTION 'Portal principal has no runtime Agency context'
          USING ERRCODE = '23503', CONSTRAINT = 'portal_principal_runtime_agency_fk';
      END IF;
      INSERT INTO "portal_access"."portal_principal_context"
        ("agencyId", "portalPrincipalId", "authorizationEpoch")
      VALUES (root_agency_id, NEW."id", 1);
      RETURN NEW;
    END
    $portal_principal_context$;
    REVOKE ALL ON FUNCTION "portal_access"."create_portal_principal_context"()
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "portal_user_context_after_insert"
      AFTER INSERT ON "portal_access"."portal_user"
      FOR EACH ROW EXECUTE FUNCTION "portal_access"."create_portal_principal_context"();

    CREATE OR REPLACE FUNCTION "portal_access"."create_portal_session_context"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $portal_session_context$
    DECLARE
      context_row_count integer := 0;
    BEGIN
      INSERT INTO "portal_access"."portal_session_context"
        ("sessionId", "portalPrincipalId", "agencyId", "authorizationEpoch")
      SELECT NEW."id", principal."portalPrincipalId", principal."agencyId", principal."authorizationEpoch"
        FROM "portal_access"."portal_principal_context" AS principal
       WHERE principal."portalPrincipalId" = NEW."userId";
      GET DIAGNOSTICS context_row_count = ROW_COUNT;
      IF context_row_count = 0 THEN
        RAISE EXCEPTION 'Portal session has no principal context'
          USING ERRCODE = '23503', CONSTRAINT = 'portal_session_principal_context_fk';
      END IF;
      RETURN NEW;
    END
    $portal_session_context$;
    REVOKE ALL ON FUNCTION "portal_access"."create_portal_session_context"()
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "portal_session_context_after_insert"
      AFTER INSERT ON "portal_access"."portal_session"
      FOR EACH ROW EXECUTE FUNCTION "portal_access"."create_portal_session_context"();

    CREATE TABLE "portal_access"."trip_access_grant" (
      "grantId" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "portalPrincipalId" text NOT NULL,
      "tripId" uuid NOT NULL,
      "capabilities" text[] NOT NULL CHECK (
        cardinality("capabilities") = 1 AND "capabilities"[1] = 'trip.view_current'
      ),
      "issuedByStaffPrincipalId" text NOT NULL REFERENCES "staff_access"."staff_user" ("id") ON DELETE RESTRICT,
      "issuedAt" timestamptz NOT NULL DEFAULT date_trunc('milliseconds', statement_timestamp()),
      "expiresAt" timestamptz,
      "relationshipLabel" text,
      "grantState" text NOT NULL DEFAULT 'ACTIVE' CHECK (
        "grantState" IN ('ACTIVE', 'REVOKED', 'EXPIRED')
      ),
      "revokedByStaffPrincipalId" text REFERENCES "staff_access"."staff_user" ("id") ON DELETE RESTRICT,
      "revokedAt" timestamptz,
      "expiredAt" timestamptz,
      CONSTRAINT "trip_access_grant_expiry_after_issue" CHECK (
        "expiresAt" IS NULL OR "expiresAt" > "issuedAt"
      ),
      CONSTRAINT "trip_access_grant_relationship_label_shape" CHECK (
        "relationshipLabel" IS NULL OR
        (length(btrim("relationshipLabel")) BETWEEN 1 AND 200 AND
         "relationshipLabel" !~ '[[:cntrl:]]')
      ),
      CONSTRAINT "trip_access_grant_terminal_state_shape" CHECK (
        ("grantState" = 'ACTIVE' AND "revokedByStaffPrincipalId" IS NULL AND
         "revokedAt" IS NULL AND "expiredAt" IS NULL) OR
        ("grantState" = 'REVOKED' AND "revokedByStaffPrincipalId" IS NOT NULL AND
         "revokedAt" IS NOT NULL AND "expiredAt" IS NULL) OR
        ("grantState" = 'EXPIRED' AND "revokedByStaffPrincipalId" IS NULL AND
         "revokedAt" IS NULL AND "expiredAt" IS NOT NULL AND "expiresAt" IS NOT NULL)
      ),
      CONSTRAINT "trip_access_grant_scope_trip_fk"
        FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "trip_access_grant_scope_principal_fk"
        FOREIGN KEY ("agencyId", "portalPrincipalId")
        REFERENCES "portal_access"."portal_principal_context" ("agencyId", "portalPrincipalId") ON DELETE RESTRICT,
      CONSTRAINT "trip_access_grant_id_agency_unique" UNIQUE ("grantId", "agencyId")
    );
    CREATE UNIQUE INDEX "trip_access_grant_one_active_scope_idx"
      ON "portal_access"."trip_access_grant" ("agencyId", "portalPrincipalId", "tripId")
      WHERE "grantState" = 'ACTIVE';

    CREATE TABLE "portal_access"."trip_access_idempotency" (
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "staffPrincipalId" text NOT NULL REFERENCES "staff_access"."staff_user" ("id") ON DELETE RESTRICT,
      "command" text NOT NULL CHECK ("command" IN ('trip.access.issue', 'trip.access.revoke')),
      "idempotencyKey" text NOT NULL CHECK (
        length("idempotencyKey") BETWEEN 1 AND 128 AND "idempotencyKey" !~ '[[:cntrl:]]'
      ),
      "requestHash" char(64) NOT NULL CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
      "grantId" uuid NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY ("agencyId", "staffPrincipalId", "command", "idempotencyKey"),
      CONSTRAINT "trip_access_idempotency_grant_fk"
        FOREIGN KEY ("grantId", "agencyId")
        REFERENCES "portal_access"."trip_access_grant" ("grantId", "agencyId") ON DELETE RESTRICT
    );

    CREATE TABLE "audit"."trip_access_grant_event" (
      "eventId" uuid PRIMARY KEY,
      "grantId" uuid NOT NULL,
      "agencyId" uuid NOT NULL,
      "portalPrincipalId" text NOT NULL,
      "tripId" uuid NOT NULL,
      "eventType" text NOT NULL CHECK (
        "eventType" IN ('TRIP_ACCESS_GRANT_ISSUED', 'TRIP_ACCESS_GRANT_REVOKED', 'TRIP_ACCESS_GRANT_EXPIRED')
      ),
      "actorStaffPrincipalId" text REFERENCES "staff_access"."staff_user" ("id") ON DELETE RESTRICT,
      "occurredAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "trip_access_grant_event_scope_fk"
        FOREIGN KEY ("grantId", "agencyId")
        REFERENCES "portal_access"."trip_access_grant" ("grantId", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "trip_access_grant_event_principal_fk"
        FOREIGN KEY ("agencyId", "portalPrincipalId")
        REFERENCES "portal_access"."portal_principal_context" ("agencyId", "portalPrincipalId") ON DELETE RESTRICT,
      CONSTRAINT "trip_access_grant_event_trip_fk"
        FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "trip_access_grant_event_actor_shape" CHECK (
        ("eventType" = 'TRIP_ACCESS_GRANT_EXPIRED' AND "actorStaffPrincipalId" IS NULL) OR
        ("eventType" <> 'TRIP_ACCESS_GRANT_EXPIRED' AND "actorStaffPrincipalId" IS NOT NULL)
      )
    );

    CREATE TABLE "integration"."trip_access_grant_outbox" (
      "messageId" uuid PRIMARY KEY,
      "eventId" uuid NOT NULL UNIQUE REFERENCES "audit"."trip_access_grant_event" ("eventId") ON DELETE RESTRICT,
      "agencyId" uuid NOT NULL,
      "grantId" uuid NOT NULL,
      "eventType" text NOT NULL CHECK (
        "eventType" IN ('TRIP_ACCESS_GRANT_ISSUED', 'TRIP_ACCESS_GRANT_REVOKED', 'TRIP_ACCESS_GRANT_EXPIRED')
      ),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "trip_access_grant_outbox_scope_fk"
        FOREIGN KEY ("grantId", "agencyId")
        REFERENCES "portal_access"."trip_access_grant" ("grantId", "agencyId") ON DELETE RESTRICT
    );

    CREATE OR REPLACE FUNCTION "portal_access"."reject_trip_access_history_mutation"()
    RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $trip_access_history$
    BEGIN
      RAISE EXCEPTION 'Trip access history is immutable'
        USING ERRCODE = '55000', CONSTRAINT = 'trip_access_history_immutable';
    END
    $trip_access_history$;
    REVOKE ALL ON FUNCTION "portal_access"."reject_trip_access_history_mutation"()
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "trip_access_grant_event_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "audit"."trip_access_grant_event"
      FOR EACH ROW EXECUTE FUNCTION "portal_access"."reject_trip_access_history_mutation"();
    CREATE TRIGGER "trip_access_grant_outbox_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "integration"."trip_access_grant_outbox"
      FOR EACH ROW EXECUTE FUNCTION "portal_access"."reject_trip_access_history_mutation"();

    CREATE OR REPLACE FUNCTION "portal_access"."enforce_trip_access_grant_transition"()
    RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $trip_access_grant_transition$
    BEGIN
      IF TG_OP = 'DELETE' OR
         NEW."grantId" IS DISTINCT FROM OLD."grantId" OR
         NEW."agencyId" IS DISTINCT FROM OLD."agencyId" OR
         NEW."portalPrincipalId" IS DISTINCT FROM OLD."portalPrincipalId" OR
         NEW."tripId" IS DISTINCT FROM OLD."tripId" OR
         NEW."capabilities" IS DISTINCT FROM OLD."capabilities" OR
         NEW."issuedByStaffPrincipalId" IS DISTINCT FROM OLD."issuedByStaffPrincipalId" OR
         NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt" OR
         NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" OR
         NEW."relationshipLabel" IS DISTINCT FROM OLD."relationshipLabel" OR
         OLD."grantState" <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Trip access grant history is immutable'
          USING ERRCODE = '55000', CONSTRAINT = 'trip_access_grant_immutable';
      END IF;
      IF NOT (
        (NEW."grantState" = 'REVOKED' AND NEW."revokedByStaffPrincipalId" IS NOT NULL AND
         NEW."revokedAt" IS NOT NULL AND NEW."expiredAt" IS NULL) OR
        (NEW."grantState" = 'EXPIRED' AND NEW."revokedByStaffPrincipalId" IS NULL AND
         NEW."revokedAt" IS NULL AND NEW."expiredAt" IS NOT NULL AND NEW."expiresAt" IS NOT NULL)
      ) THEN
        RAISE EXCEPTION 'Trip access grant transition is invalid'
          USING ERRCODE = '23514', CONSTRAINT = 'trip_access_grant_terminal_state_shape';
      END IF;
      RETURN NEW;
    END
    $trip_access_grant_transition$;
    REVOKE ALL ON FUNCTION "portal_access"."enforce_trip_access_grant_transition"()
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "trip_access_grant_transition_trigger"
      BEFORE UPDATE OR DELETE ON "portal_access"."trip_access_grant"
      FOR EACH ROW EXECUTE FUNCTION "portal_access"."enforce_trip_access_grant_transition"();

    REVOKE ALL PRIVILEGES ON TABLE
      "portal_access"."runtime_agency_context",
      "portal_access"."portal_principal_context",
      "portal_access"."portal_session_context",
      "portal_access"."trip_access_grant",
      "portal_access"."trip_access_idempotency",
      "audit"."trip_access_grant_event",
      "integration"."trip_access_grant_outbox"
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";

    GRANT USAGE ON SCHEMA "portal_access" TO "travelos_admin_runtime", "travelos_portal_runtime";
    GRANT USAGE ON SCHEMA "trip_ops" TO "travelos_portal_runtime";
    GRANT USAGE ON SCHEMA "audit", "integration" TO "travelos_admin_runtime";

    GRANT SELECT ("agencyId", "portalPrincipalId", "authorizationEpoch")
      ON TABLE "portal_access"."portal_principal_context" TO "travelos_portal_runtime";
    GRANT SELECT ("sessionId", "portalPrincipalId", "agencyId", "authorizationEpoch")
      ON TABLE "portal_access"."portal_session_context" TO "travelos_portal_runtime";
    GRANT SELECT ("grantId", "agencyId", "portalPrincipalId", "tripId", "capabilities", "expiresAt", "revokedAt", "grantState")
      ON TABLE "portal_access"."trip_access_grant" TO "travelos_portal_runtime";
    GRANT SELECT ("agencyId", "tripId", "activePublicationId")
      ON TABLE "trip_ops"."publication_pointer" TO "travelos_portal_runtime";
    GRANT SELECT ("publicationId", "agencyId", "tripId", "version", "schemaVersion", "projectionHash")
      ON TABLE "trip_ops"."publication_version" TO "travelos_portal_runtime";
    GRANT SELECT ("publicationId", "agencyId", "tripId", "canonicalPayload")
      ON TABLE "trip_ops"."publication_snapshot" TO "travelos_portal_runtime";

    GRANT SELECT ("agencyId", "portalPrincipalId", "authorizationEpoch"),
          UPDATE ("authorizationEpoch", "updatedAt")
      ON TABLE "portal_access"."portal_principal_context" TO "travelos_admin_runtime";
    GRANT SELECT ON TABLE "portal_access"."trip_access_grant" TO "travelos_admin_runtime";
    GRANT INSERT ("grantId", "agencyId", "portalPrincipalId", "tripId", "capabilities",
                  "issuedByStaffPrincipalId", "expiresAt", "relationshipLabel")
      ON TABLE "portal_access"."trip_access_grant" TO "travelos_admin_runtime";
    GRANT UPDATE ("grantState", "revokedByStaffPrincipalId", "revokedAt", "expiredAt")
      ON TABLE "portal_access"."trip_access_grant" TO "travelos_admin_runtime";
    GRANT SELECT, INSERT ON TABLE "portal_access"."trip_access_idempotency"
      TO "travelos_admin_runtime";
    GRANT INSERT ON TABLE "audit"."trip_access_grant_event" TO "travelos_admin_runtime";
    GRANT INSERT ON TABLE "integration"."trip_access_grant_outbox" TO "travelos_admin_runtime";

    INSERT INTO "staff_access"."role_permission" ("roleId", "permissionId", "scopeKind", "accessLevel")
    SELECT role."id", 'trip.access.manage', 'AGENCY', 'ALL'
      FROM "staff_access"."role" AS role
     WHERE role."templateKey" = 'agency-owner-v1' AND role."isSystemTemplate"
    ON CONFLICT DO NOTHING;

    COMMENT ON TABLE "portal_access"."trip_access_grant" IS
      'Explicit same-Agency Portal principal and Trip capability; Portal reads only the current immutable publication.';
    COMMENT ON TABLE "portal_access"."portal_principal_context" IS
      'Portal principal authorization epoch; Staff revocation increments this value transactionally.';
    COMMENT ON TABLE "portal_access"."portal_session_context" IS
      'Immutable Portal session epoch snapshot; stale sessions fail closed after grant revocation.';
    COMMENT ON TABLE "audit"."trip_access_grant_event" IS
      'Append-only Staff-issued Trip access grant history.';
    COMMENT ON TABLE "integration"."trip_access_grant_outbox" IS
      'Transactional Stage 7 Trip access grant event; delivery is deferred to the accepted worker stage.';
  `);
};

exports.down = false;
