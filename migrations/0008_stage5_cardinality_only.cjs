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

    ALTER TABLE "trip_ops"."itinerary_item"
      DROP CONSTRAINT "itinerary_item_trip_family_unique";

    ALTER TABLE "trip_ops"."reservation"
      DROP CONSTRAINT "reservation_trip_singleton";
  `);
};

exports.down = false;
