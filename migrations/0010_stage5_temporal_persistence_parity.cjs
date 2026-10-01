const postgresqlTimezoneExclusions = new Set([
  "Africa/Asmera",
  "America/Buenos_Aires",
  "America/Catamarca",
  "America/Cordoba",
  "America/Godthab",
  "America/Indianapolis",
  "America/Jujuy",
  "America/Louisville",
  "America/Mendoza",
  "Asia/Calcutta",
  "Asia/Katmandu",
  "Asia/Rangoon",
  "Asia/Saigon",
  "Atlantic/Faeroe",
  "Europe/Kiev",
  "Pacific/Enderbury",
  "Pacific/Ponape",
  "Pacific/Truk",
]);
const canonicalTimezoneNames = ["UTC", ...Intl.supportedValuesOf("timeZone")]
  .filter((timezoneName, index, values) => values.indexOf(timezoneName) === index)
  .filter((timezoneName) => {
    try {
      return (
        new Intl.DateTimeFormat("en-US", { timeZone: timezoneName }).resolvedOptions().timeZone ===
          timezoneName && !postgresqlTimezoneExclusions.has(timezoneName)
      );
    } catch {
      return false;
    }
  });
const canonicalTimezoneSql = canonicalTimezoneNames
  .map((timezoneName) => `'${timezoneName.replaceAll("'", "''")}'`)
  .join(", ");

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

    ALTER TABLE "trip_ops"."trip"
      ADD CONSTRAINT "trip_date_policy"
      CHECK (
        "startDate" BETWEEN DATE '1000-01-01' AND DATE '9999-12-31'
        AND "endDate" BETWEEN DATE '1000-01-01' AND DATE '9999-12-31'
      ) NOT VALID;
    ALTER TABLE "trip_ops"."trip" VALIDATE CONSTRAINT "trip_date_policy";

    ALTER TABLE "trip_ops"."flight_item_detail"
      ADD CONSTRAINT "flight_departure_instant_calendar_policy"
      CHECK (
        "departureInstant" >= TIMESTAMPTZ '1000-01-01 00:00:00+00'
        AND "departureInstant" < TIMESTAMPTZ '10000-01-01 00:00:00+00'
      ) NOT VALID;
    ALTER TABLE "trip_ops"."flight_item_detail"
      ADD CONSTRAINT "flight_arrival_instant_calendar_policy"
      CHECK (
        "arrivalInstant" >= TIMESTAMPTZ '1000-01-01 00:00:00+00'
        AND "arrivalInstant" < TIMESTAMPTZ '10000-01-01 00:00:00+00'
      ) NOT VALID;
    ALTER TABLE "trip_ops"."flight_item_detail"
      VALIDATE CONSTRAINT "flight_departure_instant_calendar_policy";
    ALTER TABLE "trip_ops"."flight_item_detail"
      VALIDATE CONSTRAINT "flight_arrival_instant_calendar_policy";

    ALTER TABLE "trip_ops"."accommodation_item_detail"
      ADD CONSTRAINT "accommodation_check_instant_calendar_policy"
      CHECK (
        "checkInInstant" >= TIMESTAMPTZ '1000-01-01 00:00:00+00'
        AND "checkInInstant" < TIMESTAMPTZ '10000-01-01 00:00:00+00'
      ) NOT VALID;
    ALTER TABLE "trip_ops"."accommodation_item_detail"
      ADD CONSTRAINT "accommodation_check_out_instant_calendar_policy"
      CHECK (
        "checkOutInstant" >= TIMESTAMPTZ '1000-01-01 00:00:00+00'
        AND "checkOutInstant" < TIMESTAMPTZ '10000-01-01 00:00:00+00'
      ) NOT VALID;
    ALTER TABLE "trip_ops"."accommodation_item_detail"
      VALIDATE CONSTRAINT "accommodation_check_instant_calendar_policy";
    ALTER TABLE "trip_ops"."accommodation_item_detail"
      VALIDATE CONSTRAINT "accommodation_check_out_instant_calendar_policy";

    CREATE OR REPLACE FUNCTION "trip_ops"."assert_scheduled_temporal_tuple"(
      p_local_date date,
      p_local_time time,
      p_timezone text,
      p_instant timestamptz,
      p_label text
    )
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $scheduled_temporal_tuple$
    DECLARE
      projected_local timestamp;
    BEGIN
      IF p_timezone IS NULL OR NOT (
        p_timezone = ANY(ARRAY[${canonicalTimezoneSql}]::text[])
      ) THEN
        RAISE EXCEPTION 'Scheduled % has invalid IANA timezone', p_label
          USING ERRCODE = '23514', CONSTRAINT = 'scheduled_timezone_policy';
      END IF;
      IF p_instant IS NULL
         OR p_instant < TIMESTAMPTZ '1000-01-01 00:00:00+00'
         OR p_instant >= TIMESTAMPTZ '10000-01-01 00:00:00+00' THEN
        RAISE EXCEPTION 'Scheduled % instant is outside the supported UTC calendar years', p_label
          USING ERRCODE = '23514', CONSTRAINT = 'scheduled_instant_calendar_policy';
      END IF;
      IF p_local_time >= TIME '24:00:00' THEN RETURN; END IF;
      BEGIN
        projected_local := p_instant AT TIME ZONE p_timezone;
      EXCEPTION WHEN invalid_parameter_value THEN
        RAISE EXCEPTION 'Scheduled % has invalid IANA timezone', p_label
          USING ERRCODE = '23514', CONSTRAINT = 'scheduled_timezone_policy';
      END;
      IF date_trunc('second', p_local_date::timestamp + p_local_time) <>
         date_trunc('second', projected_local) THEN
        RAISE EXCEPTION 'Scheduled % local tuple does not match its instant', p_label
          USING ERRCODE = '23514', CONSTRAINT = 'scheduled_local_tuple_policy';
      END IF;
    END
    $scheduled_temporal_tuple$;
  `);
};

exports.down = false;
