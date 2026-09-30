exports.up = (pgm) => {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '30s';

    DO $migration_context$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
    END
    $migration_context$;

    DO $lock_version_upgrade$
    DECLARE
      target record;
      check_row record;
      check_count integer;
    BEGIN
      FOR target IN
        SELECT * FROM (VALUES
          ('crm', 'person'),
          ('crm', 'customer'),
          ('trip_ops', 'trip'),
          ('trip_ops', 'itinerary_item'),
          ('trip_ops', 'reservation'),
          ('finance', 'supplier_cost_line')
        ) AS stage5_roots(schema_name, table_name)
      LOOP
        check_count := 0;
        FOR check_row IN
          SELECT constraint_row.conname
            FROM pg_catalog.pg_constraint AS constraint_row
           WHERE constraint_row.conrelid = pg_catalog.to_regclass(
                   pg_catalog.format('%I.%I', target.schema_name, target.table_name)
                 )
             AND constraint_row.contype = 'c'
             AND pg_catalog.strpos(
                   pg_catalog.pg_get_constraintdef(constraint_row.oid),
                   '"lockVersion"'
                 ) > 0
        LOOP
          EXECUTE pg_catalog.format(
            'ALTER TABLE %I.%I DROP CONSTRAINT %I',
            target.schema_name,
            target.table_name,
            check_row.conname
          );
          check_count := check_count + 1;
        END LOOP;
        IF check_count <> 1 THEN
          RAISE EXCEPTION 'Expected one prior lockVersion check on %.%, found %',
            target.schema_name, target.table_name, check_count;
        END IF;

        EXECUTE pg_catalog.format(
          'ALTER TABLE %I.%I ALTER COLUMN "lockVersion" DROP DEFAULT',
          target.schema_name,
          target.table_name
        );
        EXECUTE pg_catalog.format(
          'ALTER TABLE %I.%I ALTER COLUMN "lockVersion" TYPE bigint USING "lockVersion"::bigint - 1',
          target.schema_name,
          target.table_name
        );
        EXECUTE pg_catalog.format(
          'ALTER TABLE %I.%I ALTER COLUMN "lockVersion" SET DEFAULT 0',
          target.schema_name,
          target.table_name
        );
        EXECUTE pg_catalog.format(
          'ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK ("lockVersion" >= 0)',
          target.schema_name,
          target.table_name,
          target.table_name || '_lock_version_nonnegative'
        );
      END LOOP;
    END
    $lock_version_upgrade$;

    CREATE TABLE "trip_ops"."workspace_revision_touch" (
      "agencyId" uuid NOT NULL,
      "tripId" uuid NOT NULL,
      "lastTransactionId" xid8 NOT NULL,
      PRIMARY KEY ("agencyId", "tripId"),
      CONSTRAINT "workspace_revision_touch_trip_agency_fk"
        FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE CASCADE
    );
    COMMENT ON TABLE "trip_ops"."workspace_revision_touch" IS
      'Protected transaction-deduplication state for workspace revision triggers; one row per touched Trip, owned by travelos_owner';
    REVOKE ALL PRIVILEGES ON TABLE "trip_ops"."workspace_revision_touch"
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";

    CREATE OR REPLACE FUNCTION "trip_ops"."touch_workspace_revision"(
      p_agency_id uuid,
      p_trip_id uuid
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $touch_workspace_revision$
    DECLARE
      transaction_id xid8;
      revision_touched boolean := false;
    BEGIN
      IF p_agency_id IS NULL OR p_trip_id IS NULL THEN RETURN; END IF;
      transaction_id := pg_catalog.pg_current_xact_id();

      INSERT INTO "trip_ops"."workspace_revision_touch" AS current_touch
        ("agencyId", "tripId", "lastTransactionId")
      SELECT p_agency_id, p_trip_id, transaction_id
       WHERE EXISTS (
         SELECT 1
           FROM "trip_ops"."trip" AS target_trip
          WHERE target_trip."agencyId" = p_agency_id
            AND target_trip."id" = p_trip_id
       )
      ON CONFLICT ("agencyId", "tripId")
      DO UPDATE SET "lastTransactionId" = EXCLUDED."lastTransactionId"
        WHERE current_touch."lastTransactionId" IS DISTINCT FROM EXCLUDED."lastTransactionId"
      RETURNING true INTO revision_touched;

      IF COALESCE(revision_touched, false) THEN
        UPDATE "trip_ops"."trip"
           SET "workspaceRevision" = "workspaceRevision" + 1,
               "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = p_trip_id AND "agencyId" = p_agency_id;
      END IF;
    END
    $touch_workspace_revision$;

    CREATE OR REPLACE FUNCTION "trip_ops"."cas_update_accommodation_presentation"(
      p_agency_id uuid,
      p_trip_id uuid,
      p_item_id uuid,
      p_expected_lock_version bigint,
      p_title text,
      p_description text
    )
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $cas_update_accommodation_presentation$
    BEGIN
      IF p_expected_lock_version IS NULL OR p_expected_lock_version < 0 THEN
        RAISE EXCEPTION 'Expected lockVersion must be a non-negative bigint'
          USING ERRCODE = '22023';
      END IF;

      UPDATE "trip_ops"."itinerary_item"
         SET "customerTitle" = p_title,
             "customerDescription" = p_description,
             "lockVersion" = "lockVersion" + 1,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "agencyId" = p_agency_id
         AND "tripId" = p_trip_id
         AND "id" = p_item_id
         AND "family" = 'ACCOMMODATION'
         AND "lockVersion" = p_expected_lock_version;
      RETURN FOUND;
    END
    $cas_update_accommodation_presentation$;

    CREATE OR REPLACE FUNCTION "trip_ops"."cas_update_supplier_cost_internal_note"(
      p_agency_id uuid,
      p_trip_id uuid,
      p_reservation_id uuid,
      p_expected_lock_version bigint,
      p_internal_note text
    )
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $cas_update_supplier_cost_internal_note$
    BEGIN
      IF p_expected_lock_version IS NULL OR p_expected_lock_version < 0 THEN
        RAISE EXCEPTION 'Expected lockVersion must be a non-negative bigint'
          USING ERRCODE = '22023';
      END IF;

      UPDATE "finance"."supplier_cost_line"
         SET "internalNote" = p_internal_note,
             "lockVersion" = "lockVersion" + 1,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "agencyId" = p_agency_id
         AND "tripId" = p_trip_id
         AND "reservationId" = p_reservation_id
         AND "lockVersion" = p_expected_lock_version;
      RETURN FOUND;
    END
    $cas_update_supplier_cost_internal_note$;

    REVOKE ALL PRIVILEGES ON FUNCTION
      "trip_ops"."cas_update_accommodation_presentation"(uuid, uuid, uuid, bigint, text, text),
      "trip_ops"."cas_update_supplier_cost_internal_note"(uuid, uuid, uuid, bigint, text)
      FROM PUBLIC, "travelos_portal_runtime", "travelos_worker_runtime";
    REVOKE ALL PRIVILEGES ON FUNCTION
      "trip_ops"."touch_workspace_revision"(uuid, uuid)
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    GRANT EXECUTE ON FUNCTION
      "trip_ops"."cas_update_accommodation_presentation"(uuid, uuid, uuid, bigint, text, text),
      "trip_ops"."cas_update_supplier_cost_internal_note"(uuid, uuid, uuid, bigint, text)
      TO "travelos_admin_runtime";

    REVOKE INSERT, UPDATE ON TABLE
      "crm"."person", "crm"."customer", "trip_ops"."trip",
      "trip_ops"."itinerary_item", "trip_ops"."reservation",
      "finance"."supplier_cost_line"
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    REVOKE UPDATE ("title", "startDate", "endDate", "state")
      ON TABLE "trip_ops"."trip"
      FROM "travelos_admin_runtime";

    GRANT INSERT ("id", "agencyId", "title", "startDate", "endDate", "state")
      ON TABLE "trip_ops"."trip" TO "travelos_admin_runtime";
    GRANT INSERT ("id", "agencyId", "givenName", "familyName", "email")
      ON TABLE "crm"."person" TO "travelos_admin_runtime";
    GRANT INSERT ("id", "agencyId", "displayName")
      ON TABLE "crm"."customer" TO "travelos_admin_runtime";
    GRANT INSERT (
      "id", "agencyId", "tripId", "family", "state", "sortOrder",
      "customerTitle", "customerDescription", "customerBookingReference"
    ) ON TABLE "trip_ops"."itinerary_item" TO "travelos_admin_runtime";
    GRANT INSERT (
      "id", "agencyId", "tripId", "supplierName", "supplierReference",
      "customerBookingReference", "state"
    ) ON TABLE "trip_ops"."reservation" TO "travelos_admin_runtime";
    GRANT INSERT (
      "id", "agencyId", "tripId", "reservationId", "amountMinor", "currencyCode",
      "currencyScale", "internalNote", "classification"
    ) ON TABLE "finance"."supplier_cost_line" TO "travelos_admin_runtime";

    REVOKE UPDATE ON TABLE
      "trip_ops"."flight_item_detail", "trip_ops"."accommodation_item_detail"
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";

    COMMENT ON COLUMN "crm"."person"."lockVersion" IS
      'Non-negative PostgreSQL bigint optimistic-concurrency token; created at zero and updated only by a protected compare-and-swap command';
    COMMENT ON COLUMN "crm"."customer"."lockVersion" IS
      'Non-negative PostgreSQL bigint optimistic-concurrency token; created at zero and updated only by a protected compare-and-swap command';
    COMMENT ON COLUMN "trip_ops"."trip"."lockVersion" IS
      'Non-negative PostgreSQL bigint optimistic-concurrency token; created at zero and updated only by a protected compare-and-swap command';
    COMMENT ON COLUMN "trip_ops"."itinerary_item"."lockVersion" IS
      'Non-negative PostgreSQL bigint optimistic-concurrency token; created at zero and updated only by a protected compare-and-swap command';
    COMMENT ON COLUMN "trip_ops"."reservation"."lockVersion" IS
      'Non-negative PostgreSQL bigint optimistic-concurrency token; created at zero and updated only by a protected compare-and-swap command';
    COMMENT ON COLUMN "finance"."supplier_cost_line"."lockVersion" IS
      'Non-negative PostgreSQL bigint optimistic-concurrency token; created at zero and updated only by a protected compare-and-swap command';
  `);
};

exports.down = false;
