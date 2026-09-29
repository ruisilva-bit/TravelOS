const INTERNAL_ONLY = "INTERNAL_ONLY";

// The migration and the Node application share this contract under the pinned
// Node 24.19.0 toolchain: UTC plus the ICU canonical IANA names exposed by
// Intl.supportedValuesOf, minus the explicit timezone spellings absent from
// PostgreSQL 18.6 pg_timezone_names. Aliases are rejected before AT TIME ZONE.
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
    DO $migration_context$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
    END
    $migration_context$;

    CREATE TABLE "finance"."currency_registry" (
      "currencyCode" varchar(3) PRIMARY KEY,
      "scale" smallint NOT NULL CHECK ("scale" BETWEEN 0 AND 4),
      "isActive" boolean NOT NULL DEFAULT true,
      CONSTRAINT "currency_registry_code_scale_unique" UNIQUE ("currencyCode", "scale")
    );
    INSERT INTO "finance"."currency_registry" ("currencyCode", "scale") VALUES
      ('EUR', 2), ('USD', 2), ('GBP', 2), ('JPY', 0);

    CREATE TABLE "crm"."person" (
      "id" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "givenName" text NOT NULL CHECK (length(btrim("givenName")) > 0),
      "familyName" text NOT NULL CHECK (length(btrim("familyName")) > 0),
      "email" text,
      "lockVersion" integer NOT NULL DEFAULT 1 CHECK ("lockVersion" > 0),
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "person_id_agency_unique" UNIQUE ("id", "agencyId")
    );
    CREATE INDEX "person_agency_name_idx" ON "crm"."person" ("agencyId", "familyName", "givenName", "id");

    CREATE TABLE "crm"."customer" (
      "id" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "displayName" text NOT NULL CHECK (length(btrim("displayName")) > 0),
      "lockVersion" integer NOT NULL DEFAULT 1 CHECK ("lockVersion" > 0),
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "customer_id_agency_unique" UNIQUE ("id", "agencyId")
    );
    CREATE INDEX "customer_agency_name_idx" ON "crm"."customer" ("agencyId", "displayName", "id");

    CREATE TABLE "crm"."customer_person" (
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "customerId" uuid NOT NULL,
      "personId" uuid NOT NULL,
      "role" text NOT NULL CHECK ("role" IN ('PRIMARY_CONTACT', 'TRAVELLER', 'PAYER', 'GUARDIAN')),
      "isPrimary" boolean NOT NULL DEFAULT false,
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY ("agencyId", "customerId", "personId", "role"),
      CONSTRAINT "customer_person_customer_agency_fk"
        FOREIGN KEY ("customerId", "agencyId")
        REFERENCES "crm"."customer" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "customer_person_person_agency_fk"
        FOREIGN KEY ("personId", "agencyId")
        REFERENCES "crm"."person" ("id", "agencyId") ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX "customer_primary_person_idx"
      ON "crm"."customer_person" ("agencyId", "customerId") WHERE "isPrimary";
    CREATE UNIQUE INDEX "customer_primary_customer_per_person_idx"
      ON "crm"."customer_person" ("agencyId", "personId") WHERE "isPrimary";

    CREATE TABLE "trip_ops"."trip" (
      "id" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "title" text NOT NULL CHECK (length(btrim("title")) > 0),
      "startDate" date NOT NULL,
      "endDate" date NOT NULL,
      "state" text NOT NULL CHECK ("state" IN ('DRAFT', 'CONFIRMED', 'IN_OPERATION', 'COMPLETED', 'CANCELLED')),
      "workspaceRevision" bigint NOT NULL DEFAULT 0 CHECK ("workspaceRevision" >= 0),
      "lockVersion" integer NOT NULL DEFAULT 1 CHECK ("lockVersion" > 0),
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "trip_date_order" CHECK ("startDate" <= "endDate"),
      CONSTRAINT "trip_id_agency_unique" UNIQUE ("id", "agencyId")
    );
    CREATE INDEX "trip_agency_updated_idx" ON "trip_ops"."trip" ("agencyId", "updatedAt", "id");

    CREATE TABLE "trip_ops"."trip_traveller" (
      "id" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "tripId" uuid NOT NULL,
      "personId" uuid NOT NULL,
      "role" text NOT NULL CHECK ("role" IN ('PRIMARY_TRAVELLER', 'TRAVELLER', 'PAYER')),
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "trip_traveller_trip_agency_fk"
        FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT "trip_traveller_person_agency_fk"
        FOREIGN KEY ("personId", "agencyId")
        REFERENCES "crm"."person" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "trip_traveller_unique_person" UNIQUE ("agencyId", "tripId", "personId")
    );
    CREATE UNIQUE INDEX "trip_primary_traveller_idx"
      ON "trip_ops"."trip_traveller" ("agencyId", "tripId")
      WHERE "role" = 'PRIMARY_TRAVELLER';
    CREATE INDEX "trip_traveller_trip_idx" ON "trip_ops"."trip_traveller" ("agencyId", "tripId", "id");

    CREATE TABLE "trip_ops"."itinerary_item" (
      "id" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "tripId" uuid NOT NULL,
      "family" text NOT NULL CHECK ("family" IN ('FLIGHT', 'ACCOMMODATION')),
      "state" text NOT NULL CHECK ("state" IN ('DRAFT', 'CONFIRMED', 'CANCELLED')),
      "sortOrder" integer NOT NULL CHECK ("sortOrder" > 0),
      "customerTitle" text NOT NULL CHECK (length(btrim("customerTitle")) > 0),
      "customerDescription" text NOT NULL CHECK (length(btrim("customerDescription")) > 0),
      "customerBookingReference" text,
      "lockVersion" integer NOT NULL DEFAULT 1 CHECK ("lockVersion" > 0),
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "itinerary_item_trip_agency_fk"
        FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "itinerary_item_id_trip_agency_unique" UNIQUE ("id", "tripId", "agencyId"),
      CONSTRAINT "itinerary_item_trip_family_unique" UNIQUE ("agencyId", "tripId", "family")
    );
    CREATE INDEX "itinerary_item_trip_order_idx"
      ON "trip_ops"."itinerary_item" ("agencyId", "tripId", "sortOrder", "id");

    CREATE TABLE "trip_ops"."flight_item_detail" (
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "tripId" uuid NOT NULL,
      "itemId" uuid NOT NULL,
      "carrier" text NOT NULL CHECK (length(btrim("carrier")) > 0),
      "flightNumber" text NOT NULL CHECK (length(btrim("flightNumber")) > 0),
      "departureAirport" varchar(3) NOT NULL CHECK (length(btrim("departureAirport")) = 3),
      "arrivalAirport" varchar(3) NOT NULL CHECK (length(btrim("arrivalAirport")) = 3),
      "departureDate" date NOT NULL,
      "departureTime" time NOT NULL,
      "departureTimezone" text NOT NULL,
      "departureInstant" timestamptz NOT NULL,
      "arrivalDate" date NOT NULL,
      "arrivalTime" time NOT NULL,
      "arrivalTimezone" text NOT NULL,
      "arrivalInstant" timestamptz NOT NULL,
      "terminal" text,
      "cabin" text,
      "baggage" text,
      "seat" text,
      "operationalStatus" text NOT NULL DEFAULT 'SCHEDULED'
        CHECK ("operationalStatus" IN ('SCHEDULED', 'CONFIRMED', 'CANCELLED')),
      PRIMARY KEY ("agencyId", "tripId", "itemId"),
      CONSTRAINT "flight_item_agency_trip_fk"
        FOREIGN KEY ("itemId", "tripId", "agencyId")
        REFERENCES "trip_ops"."itinerary_item" ("id", "tripId", "agencyId") ON DELETE CASCADE,
      CONSTRAINT "flight_airports_differ" CHECK (upper("departureAirport") <> upper("arrivalAirport")),
      CONSTRAINT "flight_time_order" CHECK ("departureInstant" < "arrivalInstant"),
      CONSTRAINT "flight_local_time_policy" CHECK (
        "departureTime" < TIME '24:00:00' AND "arrivalTime" < TIME '24:00:00'
        AND "departureTime" = date_trunc('second', "departureTime")
        AND "arrivalTime" = date_trunc('second', "arrivalTime")
      ),
      CONSTRAINT "flight_local_date_policy" CHECK (
        "departureDate" BETWEEN DATE '1000-01-01' AND DATE '9999-12-31'
        AND "arrivalDate" BETWEEN DATE '1000-01-01' AND DATE '9999-12-31'
      ),
      CONSTRAINT "flight_instant_precision_policy" CHECK (
        "departureInstant" = date_trunc('milliseconds', "departureInstant")
        AND "arrivalInstant" = date_trunc('milliseconds', "arrivalInstant")
      )
    );

    CREATE TABLE "trip_ops"."accommodation_item_detail" (
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "tripId" uuid NOT NULL,
      "itemId" uuid NOT NULL,
      "propertyName" text NOT NULL CHECK (length(btrim("propertyName")) > 0),
      "checkInDate" date NOT NULL,
      "checkInTime" time NOT NULL,
      "checkInTimezone" text NOT NULL,
      "checkInInstant" timestamptz NOT NULL,
      "checkOutDate" date NOT NULL,
      "checkOutTime" time NOT NULL,
      "checkOutTimezone" text NOT NULL,
      "checkOutInstant" timestamptz NOT NULL,
      "roomDescription" text,
      "boardType" text,
      PRIMARY KEY ("agencyId", "tripId", "itemId"),
      CONSTRAINT "accommodation_item_agency_trip_fk"
        FOREIGN KEY ("itemId", "tripId", "agencyId")
        REFERENCES "trip_ops"."itinerary_item" ("id", "tripId", "agencyId") ON DELETE CASCADE,
      CONSTRAINT "accommodation_time_order" CHECK ("checkInInstant" < "checkOutInstant"),
      CONSTRAINT "accommodation_local_time_policy" CHECK (
        "checkInTime" < TIME '24:00:00' AND "checkOutTime" < TIME '24:00:00'
        AND "checkInTime" = date_trunc('second', "checkInTime")
        AND "checkOutTime" = date_trunc('second', "checkOutTime")
      ),
      CONSTRAINT "accommodation_local_date_policy" CHECK (
        "checkInDate" BETWEEN DATE '1000-01-01' AND DATE '9999-12-31'
        AND "checkOutDate" BETWEEN DATE '1000-01-01' AND DATE '9999-12-31'
      ),
      CONSTRAINT "accommodation_instant_precision_policy" CHECK (
        "checkInInstant" = date_trunc('milliseconds', "checkInInstant")
        AND "checkOutInstant" = date_trunc('milliseconds', "checkOutInstant")
      )
    );

    CREATE TABLE "trip_ops"."reservation" (
      "id" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "tripId" uuid NOT NULL,
      "supplierName" text NOT NULL CHECK (length(btrim("supplierName")) > 0),
      "supplierReference" text NOT NULL CHECK (length(btrim("supplierReference")) > 0),
      "customerBookingReference" text,
      "state" text NOT NULL CHECK ("state" IN ('PROVISIONAL', 'HELD', 'CONFIRMED', 'USED', 'CANCELLED', 'FAILED')),
      "lockVersion" integer NOT NULL DEFAULT 1 CHECK ("lockVersion" > 0),
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "reservation_trip_agency_fk"
        FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "reservation_id_trip_agency_unique" UNIQUE ("id", "tripId", "agencyId"),
      CONSTRAINT "reservation_trip_singleton" UNIQUE ("agencyId", "tripId"),
      CONSTRAINT "reservation_supplier_reference_unique" UNIQUE ("agencyId", "supplierName", "supplierReference")
    );
    CREATE INDEX "reservation_trip_idx" ON "trip_ops"."reservation" ("agencyId", "tripId", "id");

    CREATE TABLE "trip_ops"."reservation_item_link" (
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "tripId" uuid NOT NULL,
      "reservationId" uuid NOT NULL,
      "itineraryItemId" uuid NOT NULL,
      "linkRole" text NOT NULL CHECK ("linkRole" IN ('PRIMARY', 'SECONDARY')),
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY ("agencyId", "tripId", "reservationId", "itineraryItemId"),
      CONSTRAINT "reservation_link_reservation_trip_fk"
        FOREIGN KEY ("reservationId", "tripId", "agencyId")
        REFERENCES "trip_ops"."reservation" ("id", "tripId", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "reservation_link_item_trip_fk"
        FOREIGN KEY ("itineraryItemId", "tripId", "agencyId")
        REFERENCES "trip_ops"."itinerary_item" ("id", "tripId", "agencyId") ON DELETE RESTRICT
    );

    CREATE TABLE "finance"."supplier_cost_line" (
      "id" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "tripId" uuid NOT NULL,
      "reservationId" uuid NOT NULL,
      "amountMinor" bigint NOT NULL,
      "currencyCode" varchar(3) NOT NULL,
      "currencyScale" smallint NOT NULL,
      "internalNote" text NOT NULL CHECK (length(btrim("internalNote")) > 0),
      "classification" text NOT NULL CHECK ("classification" = '${INTERNAL_ONLY}'),
      "lockVersion" integer NOT NULL DEFAULT 1 CHECK ("lockVersion" > 0),
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "supplier_cost_trip_agency_fk"
        FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "supplier_cost_reservation_trip_fk"
        FOREIGN KEY ("reservationId", "tripId", "agencyId")
        REFERENCES "trip_ops"."reservation" ("id", "tripId", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "supplier_cost_currency_fk"
        FOREIGN KEY ("currencyCode", "currencyScale")
        REFERENCES "finance"."currency_registry" ("currencyCode", "scale"),
      CONSTRAINT "supplier_cost_amount_currency_shape" CHECK (
        ("currencyCode" IS NOT NULL AND "currencyScale" IS NOT NULL)
      ),
      CONSTRAINT "supplier_cost_id_trip_unique" UNIQUE ("id", "tripId", "agencyId"),
      CONSTRAINT "supplier_cost_reservation_singleton" UNIQUE ("agencyId", "tripId", "reservationId")
    );
    CREATE INDEX "supplier_cost_trip_idx" ON "finance"."supplier_cost_line" ("agencyId", "tripId", "id");

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

    CREATE OR REPLACE FUNCTION "trip_ops"."assert_flight_temporal_policy"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $flight_temporal_policy$
    BEGIN
      PERFORM "trip_ops"."assert_scheduled_temporal_tuple"(
        NEW."departureDate", NEW."departureTime", NEW."departureTimezone", NEW."departureInstant", 'flight departure'
      );
      PERFORM "trip_ops"."assert_scheduled_temporal_tuple"(
        NEW."arrivalDate", NEW."arrivalTime", NEW."arrivalTimezone", NEW."arrivalInstant", 'flight arrival'
      );
      RETURN NEW;
    END
    $flight_temporal_policy$;

    CREATE OR REPLACE FUNCTION "trip_ops"."assert_accommodation_temporal_policy"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $accommodation_temporal_policy$
    BEGIN
      PERFORM "trip_ops"."assert_scheduled_temporal_tuple"(
        NEW."checkInDate", NEW."checkInTime", NEW."checkInTimezone", NEW."checkInInstant", 'accommodation check-in'
      );
      PERFORM "trip_ops"."assert_scheduled_temporal_tuple"(
        NEW."checkOutDate", NEW."checkOutTime", NEW."checkOutTimezone", NEW."checkOutInstant", 'accommodation check-out'
      );
      RETURN NEW;
    END
    $accommodation_temporal_policy$;

    CREATE TRIGGER "flight_temporal_policy_trigger"
      BEFORE INSERT OR UPDATE ON "trip_ops"."flight_item_detail"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."assert_flight_temporal_policy"();
    CREATE TRIGGER "accommodation_temporal_policy_trigger"
      BEFORE INSERT OR UPDATE ON "trip_ops"."accommodation_item_detail"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."assert_accommodation_temporal_policy"();

    CREATE OR REPLACE FUNCTION "trip_ops"."touch_workspace_revision"(
      p_agency_id uuid,
      p_trip_id uuid
    )
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $touch_workspace_revision$
    DECLARE
      setting_name text;
      transaction_id text;
    BEGIN
      IF p_agency_id IS NULL OR p_trip_id IS NULL THEN RETURN; END IF;
      setting_name := 'travelos.revision_touch_' || md5(p_agency_id::text || ':' || p_trip_id::text);
      transaction_id := pg_catalog.txid_current()::text;
      IF pg_catalog.current_setting(setting_name, true) IS DISTINCT FROM transaction_id THEN
        UPDATE "trip_ops"."trip"
           SET "workspaceRevision" = "workspaceRevision" + 1,
               "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = p_trip_id AND "agencyId" = p_agency_id;
        IF FOUND THEN
          PERFORM pg_catalog.set_config(setting_name, transaction_id, true);
        END IF;
      END IF;
    END
    $touch_workspace_revision$;

    CREATE OR REPLACE FUNCTION "trip_ops"."touch_workspace_revision_for_person"(
      p_agency_id uuid,
      p_person_id uuid
    )
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $touch_workspace_revision_for_person$
    DECLARE
      trip_row record;
    BEGIN
      IF p_agency_id IS NULL OR p_person_id IS NULL THEN RETURN; END IF;
      FOR trip_row IN
        SELECT DISTINCT traveller."agencyId" AS agency_id, traveller."tripId" AS trip_id
          FROM "trip_ops"."trip_traveller" AS traveller
         WHERE traveller."agencyId" = p_agency_id
           AND traveller."personId" = p_person_id
         ORDER BY agency_id, trip_id
      LOOP
        PERFORM "trip_ops"."touch_workspace_revision"(trip_row.agency_id, trip_row.trip_id);
      END LOOP;
    END
    $touch_workspace_revision_for_person$;

    CREATE OR REPLACE FUNCTION "trip_ops"."touch_workspace_revision_for_customer"(
      p_agency_id uuid,
      p_customer_id uuid
    )
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $touch_workspace_revision_for_customer$
    DECLARE
      trip_row record;
    BEGIN
      IF p_agency_id IS NULL OR p_customer_id IS NULL THEN RETURN; END IF;
      FOR trip_row IN
        SELECT DISTINCT traveller."agencyId" AS agency_id, traveller."tripId" AS trip_id
          FROM "trip_ops"."trip_traveller" AS traveller
          JOIN "crm"."customer_person" AS relationship
            ON relationship."agencyId" = traveller."agencyId"
           AND relationship."personId" = traveller."personId"
         WHERE relationship."agencyId" = p_agency_id
           AND relationship."customerId" = p_customer_id
         ORDER BY agency_id, trip_id
      LOOP
        PERFORM "trip_ops"."touch_workspace_revision"(trip_row.agency_id, trip_row.trip_id);
      END LOOP;
    END
    $touch_workspace_revision_for_customer$;

    CREATE OR REPLACE FUNCTION "trip_ops"."bump_person_projection_revision"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $person_projection_revision$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        PERFORM "trip_ops"."touch_workspace_revision_for_person"(OLD."agencyId", OLD."id");
        RETURN OLD;
      END IF;
      PERFORM "trip_ops"."touch_workspace_revision_for_person"(NEW."agencyId", NEW."id");
      RETURN NEW;
    END
    $person_projection_revision$;

    CREATE OR REPLACE FUNCTION "trip_ops"."bump_customer_projection_revision"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $customer_projection_revision$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        PERFORM "trip_ops"."touch_workspace_revision_for_customer"(OLD."agencyId", OLD."id");
        RETURN OLD;
      END IF;
      PERFORM "trip_ops"."touch_workspace_revision_for_customer"(NEW."agencyId", NEW."id");
      RETURN NEW;
    END
    $customer_projection_revision$;

    CREATE OR REPLACE FUNCTION "trip_ops"."bump_customer_person_projection_revision"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $customer_person_projection_revision$
    DECLARE
      trip_row record;
    BEGIN
      FOR trip_row IN
        SELECT DISTINCT traveller."agencyId" AS agency_id, traveller."tripId" AS trip_id
          FROM "trip_ops"."trip_traveller" AS traveller
         WHERE (traveller."agencyId", traveller."personId") IN (
           (CASE WHEN TG_OP = 'INSERT' THEN NEW."agencyId" ELSE OLD."agencyId" END,
            CASE WHEN TG_OP = 'INSERT' THEN NEW."personId" ELSE OLD."personId" END),
           (CASE WHEN TG_OP = 'DELETE' THEN OLD."agencyId" ELSE NEW."agencyId" END,
            CASE WHEN TG_OP = 'DELETE' THEN OLD."personId" ELSE NEW."personId" END)
         )
         ORDER BY agency_id, trip_id
      LOOP
        PERFORM "trip_ops"."touch_workspace_revision"(trip_row.agency_id, trip_row.trip_id);
      END LOOP;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END
    $customer_person_projection_revision$;

    CREATE OR REPLACE FUNCTION "trip_ops"."touch_workspace_revision_pair"(
      p_old_agency_id uuid,
      p_old_trip_id uuid,
      p_new_agency_id uuid,
      p_new_trip_id uuid
    )
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $touch_workspace_revision_pair$
    BEGIN
      IF p_old_agency_id IS NULL OR p_old_trip_id IS NULL THEN
        PERFORM "trip_ops"."touch_workspace_revision"(p_new_agency_id, p_new_trip_id);
      ELSIF p_new_agency_id IS NULL OR p_new_trip_id IS NULL THEN
        PERFORM "trip_ops"."touch_workspace_revision"(p_old_agency_id, p_old_trip_id);
      ELSIF (p_old_agency_id, p_old_trip_id) <= (p_new_agency_id, p_new_trip_id) THEN
        PERFORM "trip_ops"."touch_workspace_revision"(p_old_agency_id, p_old_trip_id);
        PERFORM "trip_ops"."touch_workspace_revision"(p_new_agency_id, p_new_trip_id);
      ELSE
        PERFORM "trip_ops"."touch_workspace_revision"(p_new_agency_id, p_new_trip_id);
        PERFORM "trip_ops"."touch_workspace_revision"(p_old_agency_id, p_old_trip_id);
      END IF;
    END
    $touch_workspace_revision_pair$;

    CREATE OR REPLACE FUNCTION "trip_ops"."lock_person_continuity"(
      p_agency_id uuid,
      p_person_id uuid
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $lock_person_continuity$
    DECLARE
      locked_person_id uuid;
    BEGIN
      IF p_agency_id IS NULL OR p_person_id IS NULL THEN RETURN; END IF;
      SELECT "id" INTO locked_person_id
        FROM "crm"."person"
       WHERE "agencyId" = p_agency_id AND "id" = p_person_id
       FOR UPDATE;
      IF locked_person_id IS NOT NULL THEN
        -- A real tuple write makes the lock conflict serializable under
        -- REPEATABLE READ; updatedAt is deliberately not publication-relevant.
        UPDATE "crm"."person"
           SET "updatedAt" = "updatedAt"
         WHERE "agencyId" = p_agency_id AND "id" = p_person_id;
      END IF;
    END
    $lock_person_continuity$;

    CREATE OR REPLACE FUNCTION "trip_ops"."lock_person_continuity_pair"(
      p_old_agency_id uuid,
      p_old_person_id uuid,
      p_new_agency_id uuid,
      p_new_person_id uuid
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $lock_person_continuity_pair$
    BEGIN
      IF p_old_agency_id IS NULL OR p_old_person_id IS NULL THEN
        PERFORM "trip_ops"."lock_person_continuity"(p_new_agency_id, p_new_person_id);
      ELSIF p_new_agency_id IS NULL OR p_new_person_id IS NULL THEN
        PERFORM "trip_ops"."lock_person_continuity"(p_old_agency_id, p_old_person_id);
      ELSIF (p_old_agency_id, p_old_person_id) <= (p_new_agency_id, p_new_person_id) THEN
        PERFORM "trip_ops"."lock_person_continuity"(p_old_agency_id, p_old_person_id);
        PERFORM "trip_ops"."lock_person_continuity"(p_new_agency_id, p_new_person_id);
      ELSE
        PERFORM "trip_ops"."lock_person_continuity"(p_new_agency_id, p_new_person_id);
        PERFORM "trip_ops"."lock_person_continuity"(p_old_agency_id, p_old_person_id);
      END IF;
    END
    $lock_person_continuity_pair$;

    CREATE OR REPLACE FUNCTION "trip_ops"."lock_primary_traveller_customer_continuity"()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $lock_primary_traveller_customer_continuity$
    BEGIN
      IF TG_TABLE_NAME = 'customer_person' THEN
        IF TG_OP = 'DELETE' THEN
          PERFORM "trip_ops"."lock_person_continuity"(OLD."agencyId", OLD."personId");
        ELSIF TG_OP = 'UPDATE' THEN
          PERFORM "trip_ops"."lock_person_continuity_pair"(
            OLD."agencyId", OLD."personId", NEW."agencyId", NEW."personId"
          );
        ELSE
          PERFORM "trip_ops"."lock_person_continuity"(NEW."agencyId", NEW."personId");
        END IF;
      ELSIF TG_OP = 'DELETE' THEN
        PERFORM "trip_ops"."lock_person_continuity"(OLD."agencyId", OLD."personId");
      ELSIF TG_OP = 'UPDATE' THEN
        PERFORM "trip_ops"."lock_person_continuity_pair"(
          OLD."agencyId", OLD."personId", NEW."agencyId", NEW."personId"
        );
      ELSE
        PERFORM "trip_ops"."lock_person_continuity"(NEW."agencyId", NEW."personId");
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END
    $lock_primary_traveller_customer_continuity$;

    CREATE OR REPLACE FUNCTION "trip_ops"."bump_workspace_revision"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $workspace_revision$
    BEGIN
      IF TG_TABLE_NAME = 'trip' THEN
        IF TG_OP = 'DELETE' THEN
          PERFORM "trip_ops"."touch_workspace_revision"(OLD."agencyId", OLD."id");
        ELSIF TG_OP = 'UPDATE' THEN
          PERFORM "trip_ops"."touch_workspace_revision_pair"(OLD."agencyId", OLD."id", NEW."agencyId", NEW."id");
        ELSE
          PERFORM "trip_ops"."touch_workspace_revision"(NEW."agencyId", NEW."id");
        END IF;
      ELSIF TG_OP = 'DELETE' THEN
        PERFORM "trip_ops"."touch_workspace_revision"(OLD."agencyId", OLD."tripId");
      ELSIF TG_OP = 'UPDATE' THEN
        PERFORM "trip_ops"."touch_workspace_revision_pair"(OLD."agencyId", OLD."tripId", NEW."agencyId", NEW."tripId");
      ELSE
        PERFORM "trip_ops"."touch_workspace_revision"(NEW."agencyId", NEW."tripId");
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END
    $workspace_revision$;

    CREATE OR REPLACE FUNCTION "trip_ops"."assert_exactly_one_primary_traveller_for_trip"(
      p_agency_id uuid,
      p_trip_id uuid
    )
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $exact_primary_traveller_for_trip$
    DECLARE
      trip_exists boolean;
      primary_count integer;
    BEGIN
      IF p_agency_id IS NULL OR p_trip_id IS NULL THEN RETURN; END IF;
      SELECT true INTO trip_exists
        FROM "trip_ops"."trip"
       WHERE "id" = p_trip_id AND "agencyId" = p_agency_id
       FOR UPDATE;
      IF NOT COALESCE(trip_exists, false) THEN RETURN; END IF;
      SELECT count(*) INTO primary_count
        FROM "trip_ops"."trip_traveller"
       WHERE "agencyId" = p_agency_id
         AND "tripId" = p_trip_id
         AND "role" = 'PRIMARY_TRAVELLER';
      IF primary_count <> 1 THEN
        RAISE EXCEPTION 'Trip must have exactly one PRIMARY_TRAVELLER'
          USING ERRCODE = '23514', CONSTRAINT = 'trip_primary_traveller_exactly_one';
      END IF;
    END
    $exact_primary_traveller_for_trip$;

    CREATE OR REPLACE FUNCTION "trip_ops"."assert_exactly_one_primary_traveller_pair"(
      p_old_agency_id uuid,
      p_old_trip_id uuid,
      p_new_agency_id uuid,
      p_new_trip_id uuid
    )
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $exact_primary_traveller_pair$
    BEGIN
      IF p_old_agency_id IS NULL OR p_old_trip_id IS NULL THEN
        PERFORM "trip_ops"."assert_exactly_one_primary_traveller_for_trip"(p_new_agency_id, p_new_trip_id);
      ELSIF p_new_agency_id IS NULL OR p_new_trip_id IS NULL THEN
        PERFORM "trip_ops"."assert_exactly_one_primary_traveller_for_trip"(p_old_agency_id, p_old_trip_id);
      ELSIF (p_old_agency_id, p_old_trip_id) IS NOT DISTINCT FROM (p_new_agency_id, p_new_trip_id) THEN
        PERFORM "trip_ops"."assert_exactly_one_primary_traveller_for_trip"(p_old_agency_id, p_old_trip_id);
      ELSIF (p_old_agency_id, p_old_trip_id) < (p_new_agency_id, p_new_trip_id) THEN
        PERFORM "trip_ops"."assert_exactly_one_primary_traveller_for_trip"(p_old_agency_id, p_old_trip_id);
        PERFORM "trip_ops"."assert_exactly_one_primary_traveller_for_trip"(p_new_agency_id, p_new_trip_id);
      ELSE
        PERFORM "trip_ops"."assert_exactly_one_primary_traveller_for_trip"(p_new_agency_id, p_new_trip_id);
        PERFORM "trip_ops"."assert_exactly_one_primary_traveller_for_trip"(p_old_agency_id, p_old_trip_id);
      END IF;
    END
    $exact_primary_traveller_pair$;

    CREATE OR REPLACE FUNCTION "trip_ops"."assert_exactly_one_primary_traveller"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $exact_primary_traveller$
    BEGIN
      IF TG_TABLE_NAME = 'trip' THEN
        IF TG_OP <> 'DELETE' THEN
          PERFORM "trip_ops"."assert_exactly_one_primary_traveller_for_trip"(NEW."agencyId", NEW."id");
        END IF;
      ELSIF TG_OP = 'DELETE' THEN
        PERFORM "trip_ops"."assert_exactly_one_primary_traveller_for_trip"(OLD."agencyId", OLD."tripId");
      ELSIF TG_OP = 'UPDATE' THEN
        PERFORM "trip_ops"."assert_exactly_one_primary_traveller_pair"(
          OLD."agencyId", OLD."tripId", NEW."agencyId", NEW."tripId"
        );
      ELSE
        PERFORM "trip_ops"."assert_exactly_one_primary_traveller_for_trip"(NEW."agencyId", NEW."tripId");
      END IF;
      RETURN NULL;
    END
    $exact_primary_traveller$;

    CREATE OR REPLACE FUNCTION "trip_ops"."assert_primary_traveller_customer_continuity_for_person"(
      p_agency_id uuid,
      p_person_id uuid
    )
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $primary_traveller_customer_continuity_for_person$
    DECLARE
      primary_traveller_count integer;
    BEGIN
      IF p_agency_id IS NULL OR p_person_id IS NULL THEN RETURN; END IF;
      SELECT count(*) INTO primary_traveller_count
        FROM "trip_ops"."trip_traveller"
       WHERE "agencyId" = p_agency_id
         AND "personId" = p_person_id
         AND "role" = 'PRIMARY_TRAVELLER';
      IF primary_traveller_count > 0 AND NOT EXISTS (
        SELECT 1
          FROM "crm"."customer_person"
         WHERE "agencyId" = p_agency_id
           AND "personId" = p_person_id
           AND "isPrimary" = true
      ) THEN
        RAISE EXCEPTION 'PRIMARY_TRAVELLER requires one primary CustomerPerson relationship'
          USING ERRCODE = '23514', CONSTRAINT = 'trip_primary_traveller_customer_continuity';
      END IF;
    END
    $primary_traveller_customer_continuity_for_person$;

    CREATE OR REPLACE FUNCTION "trip_ops"."assert_primary_traveller_customer_continuity_for_trip"(
      p_agency_id uuid,
      p_trip_id uuid
    )
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $primary_traveller_customer_continuity_for_trip$
    DECLARE
      primary_person_id uuid;
    BEGIN
      IF p_agency_id IS NULL OR p_trip_id IS NULL THEN RETURN; END IF;
      SELECT "personId" INTO primary_person_id
        FROM "trip_ops"."trip_traveller"
       WHERE "agencyId" = p_agency_id
         AND "tripId" = p_trip_id
         AND "role" = 'PRIMARY_TRAVELLER'
       ORDER BY "id"
       LIMIT 1;
      IF primary_person_id IS NOT NULL THEN
        PERFORM "trip_ops"."assert_primary_traveller_customer_continuity_for_person"(
          p_agency_id, primary_person_id
        );
      END IF;
    END
    $primary_traveller_customer_continuity_for_trip$;

    CREATE OR REPLACE FUNCTION "trip_ops"."assert_primary_traveller_customer_continuity"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $primary_traveller_customer_continuity$
    BEGIN
      IF TG_TABLE_NAME = 'customer_person' THEN
        IF TG_OP = 'DELETE' THEN
          PERFORM "trip_ops"."lock_person_continuity"(OLD."agencyId", OLD."personId");
        ELSIF TG_OP = 'UPDATE' THEN
          PERFORM "trip_ops"."lock_person_continuity_pair"(
            OLD."agencyId", OLD."personId", NEW."agencyId", NEW."personId"
          );
        ELSE
          PERFORM "trip_ops"."lock_person_continuity"(NEW."agencyId", NEW."personId");
        END IF;
      ELSIF TG_OP = 'DELETE' THEN
        PERFORM "trip_ops"."lock_person_continuity"(OLD."agencyId", OLD."personId");
      ELSIF TG_OP = 'UPDATE' THEN
        PERFORM "trip_ops"."lock_person_continuity_pair"(
          OLD."agencyId", OLD."personId", NEW."agencyId", NEW."personId"
        );
      ELSE
        PERFORM "trip_ops"."lock_person_continuity"(NEW."agencyId", NEW."personId");
      END IF;
      IF TG_TABLE_NAME = 'customer_person' THEN
        IF TG_OP = 'DELETE' THEN
          PERFORM "trip_ops"."assert_primary_traveller_customer_continuity_for_person"(
            OLD."agencyId", OLD."personId"
          );
        ELSE
          PERFORM "trip_ops"."assert_primary_traveller_customer_continuity_for_person"(
            NEW."agencyId", NEW."personId"
          );
          IF TG_OP = 'UPDATE' AND (
            OLD."agencyId" IS DISTINCT FROM NEW."agencyId" OR
            OLD."personId" IS DISTINCT FROM NEW."personId"
          ) THEN
            PERFORM "trip_ops"."assert_primary_traveller_customer_continuity_for_person"(
              OLD."agencyId", OLD."personId"
            );
          END IF;
        END IF;
      ELSIF TG_OP = 'DELETE' THEN
        PERFORM "trip_ops"."assert_primary_traveller_customer_continuity_for_person"(
          OLD."agencyId", OLD."personId"
        );
      ELSE
        PERFORM "trip_ops"."assert_primary_traveller_customer_continuity_for_person"(
          NEW."agencyId", NEW."personId"
        );
        IF TG_OP = 'UPDATE' AND (
          OLD."agencyId" IS DISTINCT FROM NEW."agencyId" OR
          OLD."personId" IS DISTINCT FROM NEW."personId"
        ) THEN
          PERFORM "trip_ops"."assert_primary_traveller_customer_continuity_for_person"(
            OLD."agencyId", OLD."personId"
          );
        END IF;
      END IF;
      RETURN NULL;
    END
    $primary_traveller_customer_continuity$;

    CREATE OR REPLACE FUNCTION "trip_ops"."assert_one_family_detail_tuple"(
      p_agency_id uuid,
      p_trip_id uuid,
      p_item_id uuid
    )
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $family_detail_tuple$
    DECLARE
      item_family text;
      detail_count integer;
    BEGIN
      SELECT "family" INTO item_family
        FROM "trip_ops"."itinerary_item"
       WHERE "id" = p_item_id
         AND "tripId" = p_trip_id
         AND "agencyId" = p_agency_id;
      IF item_family IS NULL THEN RETURN; END IF;
      IF item_family = 'FLIGHT' THEN
        SELECT count(*) INTO detail_count
          FROM "trip_ops"."flight_item_detail"
         WHERE "itemId" = p_item_id AND "tripId" = p_trip_id AND "agencyId" = p_agency_id;
      ELSE
        SELECT count(*) INTO detail_count
          FROM "trip_ops"."accommodation_item_detail"
         WHERE "itemId" = p_item_id AND "tripId" = p_trip_id AND "agencyId" = p_agency_id;
      END IF;
      IF detail_count <> 1 THEN
        RAISE EXCEPTION 'Itinerary item must have exactly one matching family detail' USING ERRCODE = 'P0001';
      END IF;
      IF item_family = 'FLIGHT' AND EXISTS (
        SELECT 1 FROM "trip_ops"."accommodation_item_detail"
         WHERE "itemId" = p_item_id AND "tripId" = p_trip_id AND "agencyId" = p_agency_id
      ) THEN
        RAISE EXCEPTION 'Flight item cannot have accommodation detail' USING ERRCODE = 'P0001';
      END IF;
      IF item_family = 'ACCOMMODATION' AND EXISTS (
        SELECT 1 FROM "trip_ops"."flight_item_detail"
         WHERE "itemId" = p_item_id AND "tripId" = p_trip_id AND "agencyId" = p_agency_id
      ) THEN
        RAISE EXCEPTION 'Accommodation item cannot have flight detail' USING ERRCODE = 'P0001';
      END IF;
    END
    $family_detail_tuple$;

    CREATE OR REPLACE FUNCTION "trip_ops"."assert_one_family_detail"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $family_detail$
    BEGIN
      IF TG_TABLE_NAME = 'itinerary_item' THEN
        IF TG_OP = 'DELETE' THEN
          PERFORM "trip_ops"."assert_one_family_detail_tuple"(OLD."agencyId", OLD."tripId", OLD."id");
        ELSIF TG_OP = 'UPDATE' THEN
          PERFORM "trip_ops"."assert_one_family_detail_tuple"(OLD."agencyId", OLD."tripId", OLD."id");
          PERFORM "trip_ops"."assert_one_family_detail_tuple"(NEW."agencyId", NEW."tripId", NEW."id");
        ELSE
          PERFORM "trip_ops"."assert_one_family_detail_tuple"(NEW."agencyId", NEW."tripId", NEW."id");
        END IF;
      ELSIF TG_OP = 'DELETE' THEN
        PERFORM "trip_ops"."assert_one_family_detail_tuple"(OLD."agencyId", OLD."tripId", OLD."itemId");
      ELSIF TG_OP = 'UPDATE' THEN
        PERFORM "trip_ops"."assert_one_family_detail_tuple"(OLD."agencyId", OLD."tripId", OLD."itemId");
        PERFORM "trip_ops"."assert_one_family_detail_tuple"(NEW."agencyId", NEW."tripId", NEW."itemId");
      ELSE
        PERFORM "trip_ops"."assert_one_family_detail_tuple"(NEW."agencyId", NEW."tripId", NEW."itemId");
      END IF;
      RETURN NULL;
    END
    $family_detail$;

    CREATE TRIGGER "person_projection_revision_trigger"
      AFTER UPDATE OF "givenName", "familyName", "email" OR DELETE ON "crm"."person"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."bump_person_projection_revision"();
    CREATE TRIGGER "customer_projection_revision_trigger"
      AFTER UPDATE OF "displayName" OR DELETE ON "crm"."customer"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."bump_customer_projection_revision"();
    CREATE TRIGGER "customer_person_projection_revision_trigger"
      AFTER INSERT OR UPDATE OR DELETE ON "crm"."customer_person"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."bump_customer_person_projection_revision"();

    CREATE TRIGGER "customer_person_continuity_lock_trigger"
      BEFORE INSERT OR UPDATE OR DELETE ON "crm"."customer_person"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."lock_primary_traveller_customer_continuity"();
    CREATE TRIGGER "trip_traveller_continuity_lock_trigger"
      BEFORE INSERT OR UPDATE OR DELETE ON "trip_ops"."trip_traveller"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."lock_primary_traveller_customer_continuity"();
    CREATE CONSTRAINT TRIGGER "trip_workspace_revision_trigger"
      AFTER INSERT OR UPDATE OF "title", "startDate", "endDate", "state"
      ON "trip_ops"."trip" DEFERRABLE INITIALLY IMMEDIATE
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."bump_workspace_revision"();
    CREATE TRIGGER "trip_traveller_workspace_revision_trigger"
      AFTER INSERT OR UPDATE OR DELETE ON "trip_ops"."trip_traveller"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."bump_workspace_revision"();
    CREATE CONSTRAINT TRIGGER "trip_primary_traveller_exactly_one_on_trip_trigger"
      AFTER INSERT OR UPDATE OF "agencyId", "title", "startDate", "endDate", "state"
      ON "trip_ops"."trip"
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION "trip_ops"."assert_exactly_one_primary_traveller"();
    CREATE CONSTRAINT TRIGGER "trip_primary_traveller_exactly_one_on_traveller_trigger"
      AFTER INSERT OR UPDATE OR DELETE ON "trip_ops"."trip_traveller"
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION "trip_ops"."assert_exactly_one_primary_traveller"();
    CREATE CONSTRAINT TRIGGER "trip_primary_traveller_customer_continuity_on_traveller_trigger"
      AFTER INSERT OR UPDATE OR DELETE ON "trip_ops"."trip_traveller"
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION "trip_ops"."assert_primary_traveller_customer_continuity"();
    CREATE CONSTRAINT TRIGGER "trip_primary_traveller_customer_continuity_on_customer_person_trigger"
      AFTER INSERT OR UPDATE OR DELETE ON "crm"."customer_person"
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION "trip_ops"."assert_primary_traveller_customer_continuity"();
    CREATE TRIGGER "itinerary_workspace_revision_trigger"
      AFTER INSERT OR UPDATE OF "family", "state", "sortOrder", "customerTitle", "customerDescription", "customerBookingReference"
      ON "trip_ops"."itinerary_item"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."bump_workspace_revision"();
    CREATE TRIGGER "flight_workspace_revision_trigger"
      AFTER INSERT OR UPDATE OR DELETE ON "trip_ops"."flight_item_detail"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."bump_workspace_revision"();
    CREATE TRIGGER "accommodation_workspace_revision_trigger"
      AFTER INSERT OR UPDATE OR DELETE ON "trip_ops"."accommodation_item_detail"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."bump_workspace_revision"();
    CREATE TRIGGER "reservation_workspace_revision_trigger"
      AFTER INSERT OR UPDATE OR DELETE
      ON "trip_ops"."reservation"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."bump_workspace_revision"();
    CREATE TRIGGER "reservation_link_workspace_revision_trigger"
      AFTER INSERT OR UPDATE OR DELETE ON "trip_ops"."reservation_item_link"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."bump_workspace_revision"();

    CREATE CONSTRAINT TRIGGER "itinerary_item_family_on_item_trigger"
      AFTER INSERT OR UPDATE OR DELETE ON "trip_ops"."itinerary_item"
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION "trip_ops"."assert_one_family_detail"();
    CREATE CONSTRAINT TRIGGER "flight_item_family_trigger"
      AFTER INSERT OR UPDATE OR DELETE ON "trip_ops"."flight_item_detail"
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION "trip_ops"."assert_one_family_detail"();
    CREATE CONSTRAINT TRIGGER "accommodation_item_family_trigger"
      AFTER INSERT OR UPDATE OR DELETE ON "trip_ops"."accommodation_item_detail"
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION "trip_ops"."assert_one_family_detail"();

    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "crm", "trip_ops", "finance"
      FROM PUBLIC, "travelos_portal_runtime", "travelos_worker_runtime";
    REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA "trip_ops"
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    GRANT USAGE ON SCHEMA "crm", "finance" TO "travelos_admin_runtime";
    GRANT USAGE ON SCHEMA "trip_ops" TO "travelos_admin_runtime";
    GRANT SELECT, INSERT, UPDATE ON TABLE
      "crm"."person", "crm"."customer", "crm"."customer_person",
      "trip_ops"."trip_traveller", "trip_ops"."itinerary_item",
      "trip_ops"."flight_item_detail", "trip_ops"."accommodation_item_detail",
      "trip_ops"."reservation", "trip_ops"."reservation_item_link",
      "finance"."supplier_cost_line"
      TO "travelos_admin_runtime";
    GRANT SELECT ON TABLE "trip_ops"."trip" TO "travelos_admin_runtime";
    GRANT INSERT ("id", "agencyId", "title", "startDate", "endDate", "state")
      ON TABLE "trip_ops"."trip" TO "travelos_admin_runtime";
    GRANT UPDATE ("title", "startDate", "endDate", "state")
      ON TABLE "trip_ops"."trip" TO "travelos_admin_runtime";
    GRANT SELECT ON TABLE "finance"."currency_registry" TO "travelos_admin_runtime";

    COMMENT ON TABLE "crm"."person" IS 'CRM natural person; no Staff or Portal identity authority';
    COMMENT ON TABLE "crm"."customer" IS 'Commercial Agency relationship, distinct from Person and PortalPrincipal';
    COMMENT ON TABLE "trip_ops"."trip" IS 'Mutable M1 workspace aggregate with monotonic publication-relevant revision';
    COMMENT ON TABLE "trip_ops"."itinerary_item" IS 'Typed structured presentation item; Reservation remains separate';
    COMMENT ON TABLE "trip_ops"."reservation_item_link" IS 'Explicit same-Agency/same-Trip many-to-many association';
    COMMENT ON TABLE "finance"."supplier_cost_line" IS 'Restricted INTERNAL_ONLY exact Money sentinel; no Portal contract/source';
  `);
};

exports.down = false;
