exports.up = (pgm) => {
  pgm.sql(`
    GRANT USAGE ON SCHEMA "presentation", "audit", "integration" TO "travelos_admin_runtime";

    CREATE TABLE "presentation"."agency_publication_visibility" (
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "fieldKey" text NOT NULL CHECK ("fieldKey" IN (
        'flight.description', 'flight.terminal', 'flight.cabin', 'flight.baggage', 'flight.seat',
        'flight.customerBookingReference', 'accommodation.description',
        'accommodation.roomDescription', 'accommodation.boardType',
        'accommodation.customerBookingReference'
      )),
      "visibilityChoice" text NOT NULL CHECK ("visibilityChoice" IN ('INHERIT', 'SHOW', 'HIDE')),
      "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY ("agencyId", "fieldKey")
    );

    CREATE TABLE "presentation"."item_publication_visibility" (
      "agencyId" uuid NOT NULL,
      "tripId" uuid NOT NULL,
      "itemId" uuid NOT NULL,
      "fieldKey" text NOT NULL CHECK ("fieldKey" IN (
        'flight.description', 'flight.terminal', 'flight.cabin', 'flight.baggage', 'flight.seat',
        'flight.customerBookingReference', 'accommodation.description',
        'accommodation.roomDescription', 'accommodation.boardType',
        'accommodation.customerBookingReference'
      )),
      "visibilityChoice" text NOT NULL CHECK ("visibilityChoice" IN ('INHERIT', 'SHOW', 'HIDE')),
      "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY ("agencyId", "tripId", "itemId", "fieldKey"),
      CONSTRAINT "item_publication_visibility_item_fk"
        FOREIGN KEY ("itemId", "tripId", "agencyId")
        REFERENCES "trip_ops"."itinerary_item" ("id", "tripId", "agencyId") ON DELETE CASCADE
    );

    CREATE OR REPLACE FUNCTION "presentation"."assert_visibility_field_family"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $visibility_family$
    DECLARE
      item_family text;
    BEGIN
      SELECT item."family" INTO item_family
        FROM "trip_ops"."itinerary_item" AS item
       WHERE item."id" = NEW."itemId" AND item."tripId" = NEW."tripId"
         AND item."agencyId" = NEW."agencyId";
      IF item_family IS NULL OR
         (item_family = 'FLIGHT' AND NEW."fieldKey" NOT LIKE 'flight.%') OR
         (item_family = 'ACCOMMODATION' AND NEW."fieldKey" NOT LIKE 'accommodation.%') THEN
        RAISE EXCEPTION 'Visibility field does not match itinerary family'
          USING ERRCODE = '23514', CONSTRAINT = 'visibility_field_family';
      END IF;
      RETURN NEW;
    END
    $visibility_family$;
    REVOKE ALL ON FUNCTION "presentation"."assert_visibility_field_family"() FROM PUBLIC,
      "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "item_visibility_family_trigger"
      BEFORE INSERT OR UPDATE ON "presentation"."item_publication_visibility"
      FOR EACH ROW EXECUTE FUNCTION "presentation"."assert_visibility_field_family"();

    CREATE TABLE "trip_ops"."publication_version" (
      "publicationId" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "tripId" uuid NOT NULL,
      "version" integer NOT NULL CHECK ("version" > 0),
      "workspaceRevision" bigint NOT NULL CHECK ("workspaceRevision" >= 0),
      "schemaVersion" smallint NOT NULL CHECK ("schemaVersion" = 1),
      "projectionHash" char(64) NOT NULL CHECK ("projectionHash" ~ '^[0-9a-f]{64}$'),
      "publisherStaffPrincipalId" text NOT NULL,
      "assuranceVerifiedAt" timestamptz NOT NULL,
      "publishedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "publication_version_trip_fk"
        FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "publication_version_unique_trip_version" UNIQUE ("agencyId", "tripId", "version"),
      CONSTRAINT "publication_version_id_agency_trip_unique" UNIQUE ("publicationId", "agencyId", "tripId"),
      CONSTRAINT "publication_version_pointer_fk" UNIQUE ("publicationId", "agencyId", "tripId", "version")
    );

    CREATE TABLE "trip_ops"."publication_snapshot" (
      "publicationId" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "tripId" uuid NOT NULL,
      "canonicalPayload" text NOT NULL CHECK (jsonb_typeof("canonicalPayload"::jsonb) = 'object'),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY ("publicationId", "agencyId", "tripId")
        REFERENCES "trip_ops"."publication_version" ("publicationId", "agencyId", "tripId") ON DELETE RESTRICT
    );

    CREATE TABLE "trip_ops"."publication_pointer" (
      "agencyId" uuid NOT NULL,
      "tripId" uuid NOT NULL,
      "activePublicationId" uuid NOT NULL,
      "activeVersion" integer NOT NULL,
      "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY ("agencyId", "tripId"),
      CONSTRAINT "publication_pointer_trip_fk"
        FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "publication_pointer_target_fk"
        FOREIGN KEY ("activePublicationId", "agencyId", "tripId", "activeVersion")
        REFERENCES "trip_ops"."publication_version" ("publicationId", "agencyId", "tripId", "version")
        DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT "publication_pointer_version_positive" CHECK ("activeVersion" > 0)
    );

    CREATE TABLE "trip_ops"."publication_idempotency" (
      "agencyId" uuid NOT NULL,
      "staffPrincipalId" text NOT NULL,
      "command" text NOT NULL CHECK ("command" = 'trip.publish'),
      "idempotencyKey" text NOT NULL CHECK (length("idempotencyKey") BETWEEN 1 AND 128),
      "tripId" uuid NOT NULL,
      "workspaceRevision" bigint NOT NULL CHECK ("workspaceRevision" >= 0),
      "projectionHash" char(64) NOT NULL CHECK ("projectionHash" ~ '^[0-9a-f]{64}$'),
      "requestHash" char(64) NOT NULL CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
      "publicationId" uuid NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY ("agencyId", "staffPrincipalId", "command", "idempotencyKey"),
      CONSTRAINT "publication_idempotency_trip_fk"
        FOREIGN KEY ("tripId", "agencyId") REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "publication_idempotency_publication_fk"
        FOREIGN KEY ("publicationId", "agencyId", "tripId")
        REFERENCES "trip_ops"."publication_version" ("publicationId", "agencyId", "tripId") ON DELETE RESTRICT
    );

    CREATE TABLE "trip_ops"."publication_event" (
      "eventId" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "tripId" uuid NOT NULL,
      "publicationId" uuid NOT NULL,
      "version" integer NOT NULL,
      "eventType" text NOT NULL CHECK ("eventType" = 'TRIP_PUBLICATION_PUBLISHED'),
      "actorStaffPrincipalId" text NOT NULL,
      "occurredAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY ("publicationId", "agencyId", "tripId", "version")
        REFERENCES "trip_ops"."publication_version" ("publicationId", "agencyId", "tripId", "version") ON DELETE RESTRICT
    );

    CREATE TABLE "trip_ops"."publication_lock" (
      "agencyId" uuid NOT NULL,
      "tripId" uuid NOT NULL,
      "generation" bigint NOT NULL DEFAULT 0 CHECK ("generation" >= 0),
      PRIMARY KEY ("agencyId", "tripId"),
      FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE CASCADE
    );
    INSERT INTO "trip_ops"."publication_lock" ("agencyId", "tripId")
      SELECT "agencyId", "id" FROM "trip_ops"."trip";

    CREATE OR REPLACE FUNCTION "trip_ops"."ensure_publication_lock"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $ensure_publication_lock$
    BEGIN
      INSERT INTO "trip_ops"."publication_lock" ("agencyId", "tripId")
      VALUES (NEW."agencyId", NEW."id")
      ON CONFLICT ("agencyId", "tripId") DO NOTHING;
      RETURN NEW;
    END
    $ensure_publication_lock$;
    REVOKE ALL ON FUNCTION "trip_ops"."ensure_publication_lock"() FROM PUBLIC,
      "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "trip_publication_lock_trigger"
      AFTER INSERT ON "trip_ops"."trip"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."ensure_publication_lock"();

    CREATE OR REPLACE FUNCTION "trip_ops"."lock_trip_for_publication"(
      p_agency_id uuid,
      p_trip_id uuid
    )
    RETURNS TABLE ("workspaceRevision" bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $lock_trip_for_publication$
    BEGIN
      UPDATE "trip_ops"."publication_lock"
         SET "generation" = "generation" + 1
       WHERE "agencyId" = p_agency_id AND "tripId" = p_trip_id;
      IF NOT FOUND THEN
        RETURN;
      END IF;
      RETURN QUERY
      SELECT trip."workspaceRevision"
        FROM "trip_ops"."trip" AS trip
       WHERE trip."agencyId" = p_agency_id AND trip."id" = p_trip_id
       FOR UPDATE;
    END
    $lock_trip_for_publication$;
    REVOKE ALL ON FUNCTION "trip_ops"."lock_trip_for_publication"(uuid, uuid) FROM PUBLIC,
      "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    GRANT EXECUTE ON FUNCTION "trip_ops"."lock_trip_for_publication"(uuid, uuid)
      TO "travelos_admin_runtime";

    CREATE TABLE "audit"."trip_publication_event" (
      "auditId" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "tripId" uuid NOT NULL,
      "publicationId" uuid NOT NULL,
      "actorStaffPrincipalId" text NOT NULL,
      "action" text NOT NULL CHECK ("action" = 'TRIP_PUBLISHED'),
      "schemaVersion" smallint NOT NULL CHECK ("schemaVersion" = 1),
      "projectionHash" char(64) NOT NULL CHECK ("projectionHash" ~ '^[0-9a-f]{64}$'),
      "occurredAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY ("publicationId", "agencyId", "tripId")
        REFERENCES "trip_ops"."publication_version" ("publicationId", "agencyId", "tripId") ON DELETE RESTRICT
    );

    CREATE TABLE "integration"."trip_publication_outbox" (
      "messageId" uuid PRIMARY KEY,
      "eventId" uuid NOT NULL UNIQUE REFERENCES "trip_ops"."publication_event" ("eventId") ON DELETE RESTRICT,
      "agencyId" uuid NOT NULL,
      "tripId" uuid NOT NULL,
      "publicationId" uuid NOT NULL,
      "version" integer NOT NULL,
      "eventType" text NOT NULL CHECK ("eventType" = 'TRIP_PUBLICATION_PUBLISHED'),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY ("publicationId", "agencyId", "tripId", "version")
        REFERENCES "trip_ops"."publication_version" ("publicationId", "agencyId", "tripId", "version") ON DELETE RESTRICT
    );

    CREATE OR REPLACE FUNCTION "trip_ops"."reject_publication_mutation"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $immutable_publication$
    BEGIN
      RAISE EXCEPTION 'Committed publication records are immutable'
        USING ERRCODE = '55000', CONSTRAINT = 'publication_immutable';
    END
    $immutable_publication$;
    REVOKE ALL ON FUNCTION "trip_ops"."reject_publication_mutation"() FROM PUBLIC,
      "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "publication_version_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "trip_ops"."publication_version"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."reject_publication_mutation"();
    CREATE TRIGGER "publication_snapshot_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "trip_ops"."publication_snapshot"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."reject_publication_mutation"();
    CREATE TRIGGER "publication_event_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "trip_ops"."publication_event"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."reject_publication_mutation"();
    CREATE TRIGGER "publication_audit_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "audit"."trip_publication_event"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."reject_publication_mutation"();
    CREATE TRIGGER "publication_outbox_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "integration"."trip_publication_outbox"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."reject_publication_mutation"();

    CREATE OR REPLACE FUNCTION "trip_ops"."enforce_publication_pointer_monotonicity"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $publication_pointer_monotonic$
    BEGIN
      IF (TG_OP = 'INSERT' AND NEW."activeVersion" <> 1) OR
         (TG_OP = 'UPDATE' AND NEW."activeVersion" <> OLD."activeVersion" + 1) THEN
        RAISE EXCEPTION 'Active publication version must advance exactly once'
          USING ERRCODE = '23514', CONSTRAINT = 'publication_pointer_monotonic';
      END IF;
      NEW."updatedAt" := clock_timestamp();
      RETURN NEW;
    END
    $publication_pointer_monotonic$;
    REVOKE ALL ON FUNCTION "trip_ops"."enforce_publication_pointer_monotonicity"() FROM PUBLIC,
      "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "publication_pointer_monotonic_trigger"
      BEFORE INSERT OR UPDATE ON "trip_ops"."publication_pointer"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."enforce_publication_pointer_monotonicity"();

    CREATE OR REPLACE FUNCTION "presentation"."touch_item_publication_visibility_revision"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $item_visibility_revision$
    BEGIN
      IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM "trip_ops"."touch_workspace_revision"(OLD."agencyId", OLD."tripId");
      END IF;
      IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM "trip_ops"."touch_workspace_revision"(NEW."agencyId", NEW."tripId");
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END
    $item_visibility_revision$;
    REVOKE ALL ON FUNCTION "presentation"."touch_item_publication_visibility_revision"() FROM PUBLIC,
      "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "item_visibility_workspace_revision_trigger"
      AFTER INSERT OR UPDATE OR DELETE ON "presentation"."item_publication_visibility"
      FOR EACH ROW EXECUTE FUNCTION "presentation"."touch_item_publication_visibility_revision"();

    CREATE OR REPLACE FUNCTION "presentation"."touch_agency_publication_visibility_revision"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $agency_visibility_revision$
    BEGIN
      IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM "trip_ops"."touch_workspace_revision"(trip."agencyId", trip."id")
          FROM "trip_ops"."trip" AS trip
         WHERE trip."agencyId" = OLD."agencyId"
           AND EXISTS (
             SELECT 1 FROM "trip_ops"."itinerary_item" AS item
              WHERE item."agencyId" = trip."agencyId" AND item."tripId" = trip."id"
                AND item."state" <> 'CANCELLED'
                AND ((item."family" = 'FLIGHT' AND OLD."fieldKey" LIKE 'flight.%') OR
                     (item."family" = 'ACCOMMODATION' AND OLD."fieldKey" LIKE 'accommodation.%'))
           );
      END IF;
      IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM "trip_ops"."touch_workspace_revision"(trip."agencyId", trip."id")
          FROM "trip_ops"."trip" AS trip
         WHERE trip."agencyId" = NEW."agencyId"
           AND EXISTS (
             SELECT 1 FROM "trip_ops"."itinerary_item" AS item
              WHERE item."agencyId" = trip."agencyId" AND item."tripId" = trip."id"
                AND item."state" <> 'CANCELLED'
                AND ((item."family" = 'FLIGHT' AND NEW."fieldKey" LIKE 'flight.%') OR
                     (item."family" = 'ACCOMMODATION' AND NEW."fieldKey" LIKE 'accommodation.%'))
           );
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END
    $agency_visibility_revision$;
    REVOKE ALL ON FUNCTION "presentation"."touch_agency_publication_visibility_revision"() FROM PUBLIC,
      "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "agency_visibility_workspace_revision_trigger"
      AFTER INSERT OR UPDATE OR DELETE ON "presentation"."agency_publication_visibility"
      FOR EACH ROW EXECUTE FUNCTION "presentation"."touch_agency_publication_visibility_revision"();

    REVOKE ALL PRIVILEGES ON TABLE
      "presentation"."agency_publication_visibility",
      "presentation"."item_publication_visibility",
      "trip_ops"."publication_lock", "trip_ops"."publication_version",
      "trip_ops"."publication_snapshot", "trip_ops"."publication_pointer",
      "trip_ops"."publication_idempotency", "trip_ops"."publication_event",
      "audit"."trip_publication_event", "integration"."trip_publication_outbox"
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      "presentation"."agency_publication_visibility",
      "presentation"."item_publication_visibility"
      TO "travelos_admin_runtime";
    GRANT SELECT, INSERT ON TABLE "trip_ops"."publication_version" TO "travelos_admin_runtime";
    GRANT SELECT, INSERT ON TABLE "trip_ops"."publication_snapshot" TO "travelos_admin_runtime";
    GRANT SELECT, INSERT, UPDATE ON TABLE "trip_ops"."publication_pointer" TO "travelos_admin_runtime";
    GRANT SELECT, INSERT ON TABLE "trip_ops"."publication_idempotency" TO "travelos_admin_runtime";
    GRANT INSERT ON TABLE "trip_ops"."publication_event" TO "travelos_admin_runtime";
    GRANT INSERT ON TABLE "audit"."trip_publication_event" TO "travelos_admin_runtime";
    GRANT INSERT ON TABLE "integration"."trip_publication_outbox" TO "travelos_admin_runtime";

    INSERT INTO "staff_access"."role_permission" ("roleId", "permissionId", "scopeKind", "accessLevel")
    SELECT role."id", capability."permissionId", 'AGENCY', 'ALL'
      FROM "staff_access"."role" AS role
      CROSS JOIN (VALUES ('trip.preview'), ('trip.publish')) AS capability("permissionId")
     WHERE role."templateKey" = 'agency-owner-v1' AND role."isSystemTemplate"
    ON CONFLICT DO NOTHING;

    COMMENT ON TABLE "trip_ops"."publication_version" IS 'Append-only customer-safe immutable Trip snapshots; current selection is held separately.';
    COMMENT ON TABLE "trip_ops"."publication_pointer" IS 'Mutable active publication selector; never contains snapshot content.';
    COMMENT ON TABLE "integration"."trip_publication_outbox" IS 'Transactional Stage 6 publication signal; delivery is deferred to the accepted worker stage.';
  `);
};

exports.down = false;
