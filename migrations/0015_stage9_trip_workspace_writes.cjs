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

    CREATE OR REPLACE FUNCTION "trip_ops"."lock_trip_for_workspace_write"(
      p_agency_id uuid,
      p_trip_id uuid,
      p_expected_workspace_revision bigint
    )
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $lock_trip_for_workspace_write$
    DECLARE
      current_workspace_revision bigint;
    BEGIN
      IF session_user <> 'travelos_admin_api' OR
         NOT pg_catalog.pg_has_role(session_user, 'travelos_admin_runtime', 'USAGE') THEN
        RAISE EXCEPTION 'Trip workspace writes are restricted to the Admin runtime'
          USING ERRCODE = '42501', CONSTRAINT = 'trip_workspace_write_role';
      END IF;
      IF p_agency_id IS NULL OR p_trip_id IS NULL OR
         p_expected_workspace_revision IS NULL OR p_expected_workspace_revision < 0 THEN
        RAISE EXCEPTION 'Trip workspace write lock inputs are invalid'
          USING ERRCODE = '22023', CONSTRAINT = 'trip_workspace_write_lock_input';
      END IF;

      SELECT trip."workspaceRevision"
        INTO current_workspace_revision
        FROM "trip_ops"."trip" AS trip
       WHERE trip."agencyId" = p_agency_id
         AND trip."id" = p_trip_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RETURN 'NOT_FOUND';
      END IF;
      IF current_workspace_revision <> p_expected_workspace_revision THEN
        RETURN 'STALE';
      END IF;
      RETURN 'LOCKED';
    END
    $lock_trip_for_workspace_write$;

    CREATE OR REPLACE FUNCTION "trip_ops"."cas_update_workspace_trip"(
      p_agency_id uuid,
      p_trip_id uuid,
      p_expected_workspace_revision bigint,
      p_expected_lock_version bigint,
      p_title text,
      p_start_date date,
      p_end_date date
    )
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $cas_update_workspace_trip$
    DECLARE
      lock_outcome text;
    BEGIN
      IF p_expected_lock_version IS NULL OR p_expected_lock_version < 0 OR
         p_title IS NULL OR length(btrim(p_title)) = 0 OR
         p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
        RAISE EXCEPTION 'Trip workspace update inputs are invalid'
          USING ERRCODE = '22023', CONSTRAINT = 'trip_workspace_update_input';
      END IF;

      lock_outcome := "trip_ops"."lock_trip_for_workspace_write"(
        p_agency_id, p_trip_id, p_expected_workspace_revision
      );
      IF lock_outcome <> 'LOCKED' THEN
        RETURN lock_outcome;
      END IF;

      UPDATE "trip_ops"."trip" AS trip
         SET "title" = p_title,
             "startDate" = p_start_date,
             "endDate" = p_end_date,
             "lockVersion" = trip."lockVersion" + 1,
             "updatedAt" = date_trunc('milliseconds', clock_timestamp())
       WHERE trip."agencyId" = p_agency_id
         AND trip."id" = p_trip_id
         AND trip."workspaceRevision" = p_expected_workspace_revision
         AND trip."lockVersion" = p_expected_lock_version;
      IF NOT FOUND THEN
        RETURN 'STALE';
      END IF;
      RETURN 'UPDATED';
    END
    $cas_update_workspace_trip$;

    CREATE OR REPLACE FUNCTION "trip_ops"."cas_update_workspace_flight"(
      p_agency_id uuid,
      p_trip_id uuid,
      p_item_id uuid,
      p_expected_workspace_revision bigint,
      p_expected_lock_version bigint,
      p_title text,
      p_description text,
      p_customer_booking_reference text,
      p_carrier text,
      p_flight_number text,
      p_departure_airport text,
      p_arrival_airport text,
      p_departure_date date,
      p_departure_time time,
      p_departure_timezone text,
      p_departure_instant timestamptz,
      p_arrival_date date,
      p_arrival_time time,
      p_arrival_timezone text,
      p_arrival_instant timestamptz,
      p_terminal text,
      p_cabin text,
      p_baggage text,
      p_seat text
    )
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $cas_update_workspace_flight$
    DECLARE
      lock_outcome text;
    BEGIN
      IF p_item_id IS NULL OR p_expected_lock_version IS NULL OR p_expected_lock_version < 0 OR
         p_title IS NULL OR length(btrim(p_title)) = 0 OR
         p_description IS NULL OR length(btrim(p_description)) = 0 OR
         p_carrier IS NULL OR length(btrim(p_carrier)) = 0 OR
         p_flight_number IS NULL OR length(btrim(p_flight_number)) = 0 THEN
        RAISE EXCEPTION 'Flight workspace update inputs are invalid'
          USING ERRCODE = '22023', CONSTRAINT = 'flight_workspace_update_input';
      END IF;

      lock_outcome := "trip_ops"."lock_trip_for_workspace_write"(
        p_agency_id, p_trip_id, p_expected_workspace_revision
      );
      IF lock_outcome <> 'LOCKED' THEN
        RETURN lock_outcome;
      END IF;

      UPDATE "trip_ops"."itinerary_item" AS item
         SET "customerTitle" = p_title,
             "customerDescription" = p_description,
             "customerBookingReference" = p_customer_booking_reference,
             "lockVersion" = item."lockVersion" + 1,
             "updatedAt" = date_trunc('milliseconds', clock_timestamp())
       WHERE item."agencyId" = p_agency_id
         AND item."tripId" = p_trip_id
         AND item."id" = p_item_id
         AND item."family" = 'FLIGHT'
         AND item."lockVersion" = p_expected_lock_version;
      IF NOT FOUND THEN
        IF EXISTS (
          SELECT 1
            FROM "trip_ops"."itinerary_item" AS item
           WHERE item."agencyId" = p_agency_id
             AND item."tripId" = p_trip_id
             AND item."id" = p_item_id
             AND item."family" = 'FLIGHT'
        ) THEN
          RETURN 'STALE';
        END IF;
        RETURN 'NOT_FOUND';
      END IF;

      UPDATE "trip_ops"."flight_item_detail" AS detail
         SET "carrier" = p_carrier,
             "flightNumber" = p_flight_number,
             "departureAirport" = p_departure_airport,
             "arrivalAirport" = p_arrival_airport,
             "departureDate" = p_departure_date,
             "departureTime" = p_departure_time,
             "departureTimezone" = p_departure_timezone,
             "departureInstant" = p_departure_instant,
             "arrivalDate" = p_arrival_date,
             "arrivalTime" = p_arrival_time,
             "arrivalTimezone" = p_arrival_timezone,
             "arrivalInstant" = p_arrival_instant,
             "terminal" = p_terminal,
             "cabin" = p_cabin,
             "baggage" = p_baggage,
             "seat" = p_seat
       WHERE detail."agencyId" = p_agency_id
         AND detail."tripId" = p_trip_id
         AND detail."itemId" = p_item_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Flight itinerary item is missing its detail row'
          USING ERRCODE = '55000', CONSTRAINT = 'flight_workspace_detail_missing';
      END IF;
      RETURN 'UPDATED';
    END
    $cas_update_workspace_flight$;

    CREATE OR REPLACE FUNCTION "trip_ops"."cas_update_workspace_accommodation"(
      p_agency_id uuid,
      p_trip_id uuid,
      p_item_id uuid,
      p_expected_workspace_revision bigint,
      p_expected_lock_version bigint,
      p_title text,
      p_description text,
      p_customer_booking_reference text,
      p_property_name text,
      p_check_in_date date,
      p_check_in_time time,
      p_check_in_timezone text,
      p_check_in_instant timestamptz,
      p_check_out_date date,
      p_check_out_time time,
      p_check_out_timezone text,
      p_check_out_instant timestamptz,
      p_room_description text,
      p_board_type text
    )
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $cas_update_workspace_accommodation$
    DECLARE
      lock_outcome text;
    BEGIN
      IF p_item_id IS NULL OR p_expected_lock_version IS NULL OR p_expected_lock_version < 0 OR
         p_title IS NULL OR length(btrim(p_title)) = 0 OR
         p_description IS NULL OR length(btrim(p_description)) = 0 OR
         p_property_name IS NULL OR length(btrim(p_property_name)) = 0 THEN
        RAISE EXCEPTION 'Accommodation workspace update inputs are invalid'
          USING ERRCODE = '22023', CONSTRAINT = 'accommodation_workspace_update_input';
      END IF;

      lock_outcome := "trip_ops"."lock_trip_for_workspace_write"(
        p_agency_id, p_trip_id, p_expected_workspace_revision
      );
      IF lock_outcome <> 'LOCKED' THEN
        RETURN lock_outcome;
      END IF;

      UPDATE "trip_ops"."itinerary_item" AS item
         SET "customerTitle" = p_title,
             "customerDescription" = p_description,
             "customerBookingReference" = p_customer_booking_reference,
             "lockVersion" = item."lockVersion" + 1,
             "updatedAt" = date_trunc('milliseconds', clock_timestamp())
       WHERE item."agencyId" = p_agency_id
         AND item."tripId" = p_trip_id
         AND item."id" = p_item_id
         AND item."family" = 'ACCOMMODATION'
         AND item."lockVersion" = p_expected_lock_version;
      IF NOT FOUND THEN
        IF EXISTS (
          SELECT 1
            FROM "trip_ops"."itinerary_item" AS item
           WHERE item."agencyId" = p_agency_id
             AND item."tripId" = p_trip_id
             AND item."id" = p_item_id
             AND item."family" = 'ACCOMMODATION'
        ) THEN
          RETURN 'STALE';
        END IF;
        RETURN 'NOT_FOUND';
      END IF;

      UPDATE "trip_ops"."accommodation_item_detail" AS detail
         SET "propertyName" = p_property_name,
             "checkInDate" = p_check_in_date,
             "checkInTime" = p_check_in_time,
             "checkInTimezone" = p_check_in_timezone,
             "checkInInstant" = p_check_in_instant,
             "checkOutDate" = p_check_out_date,
             "checkOutTime" = p_check_out_time,
             "checkOutTimezone" = p_check_out_timezone,
             "checkOutInstant" = p_check_out_instant,
             "roomDescription" = p_room_description,
             "boardType" = p_board_type
       WHERE detail."agencyId" = p_agency_id
         AND detail."tripId" = p_trip_id
         AND detail."itemId" = p_item_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Accommodation itinerary item is missing its detail row'
          USING ERRCODE = '55000', CONSTRAINT = 'accommodation_workspace_detail_missing';
      END IF;
      RETURN 'UPDATED';
    END
    $cas_update_workspace_accommodation$;

    REVOKE ALL ON FUNCTION
      "trip_ops"."lock_trip_for_workspace_write"(uuid, uuid, bigint),
      "trip_ops"."cas_update_workspace_trip"(uuid, uuid, bigint, bigint, text, date, date),
      "trip_ops"."cas_update_workspace_flight"(
        uuid, uuid, uuid, bigint, bigint, text, text, text, text, text, text, text,
        date, time, text, timestamptz, date, time, text, timestamptz, text, text, text, text
      ),
      "trip_ops"."cas_update_workspace_accommodation"(
        uuid, uuid, uuid, bigint, bigint, text, text, text, text, date, time, text,
        timestamptz, date, time, text, timestamptz, text, text
      )
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    GRANT EXECUTE ON FUNCTION
      "trip_ops"."lock_trip_for_workspace_write"(uuid, uuid, bigint),
      "trip_ops"."cas_update_workspace_trip"(uuid, uuid, bigint, bigint, text, date, date),
      "trip_ops"."cas_update_workspace_flight"(
        uuid, uuid, uuid, bigint, bigint, text, text, text, text, text, text, text,
        date, time, text, timestamptz, date, time, text, timestamptz, text, text, text, text
      ),
      "trip_ops"."cas_update_workspace_accommodation"(
        uuid, uuid, uuid, bigint, bigint, text, text, text, text, date, time, text,
        timestamptz, date, time, text, timestamptz, text, text
      )
      TO "travelos_admin_runtime";
  `);
};

exports.down = false;
