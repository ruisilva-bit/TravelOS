// Customer and Person details, CRM search indexes, protected compare-and-swap updates and
// customer creation idempotency.
//
// crm.customer_person keeps one row per (customer, person, role) with at most one isPrimary row per
// customer. Role changes therefore go through crm.set_customer_person_roles, which runs as the owner
// so the admin runtime needs no DELETE grant on the link table.
//
// Applied migrations are never edited: this file is only ever applied once, after 0002.
exports.up = (pgm) => {
  // Fail closed unless this runs as the migrator login with the owner role assumed (the runner does
  // both), and unless the baseline CRM objects and the trip workspace CAS are present.
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '120s';

    DO $migration_context$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
      IF to_regclass('travelos_meta.schema_migrations') IS NULL
        OR to_regclass('crm.customer') IS NULL
        OR to_regclass('crm.person') IS NULL
        OR to_regclass('crm.customer_person') IS NULL
        OR to_regclass('sales.lead_idempotency') IS NULL THEN
        RAISE EXCEPTION '0003 applies only to a database at the 0002 head with the CRM baseline';
      END IF;
    END
    $migration_context$;
  `);

  // 1. Person details. Phone and passport fields are CONFIDENTIAL_PERSONAL or sensitive; redaction
  //    happens in the application layer, never by a customer-facing projection.
  pgm.sql(String.raw`
    ALTER TABLE crm.person
      ADD COLUMN phone text NULL,
      ADD COLUMN "birthDate" date NULL,
      ADD COLUMN nationality char(2) NULL,
      ADD COLUMN notes text NULL,
      ADD COLUMN "passportNumber" text NULL,
      ADD COLUMN "passportExpiry" date NULL,
      ADD CONSTRAINT person_phone_check CHECK (
        phone IS NULL OR (length(phone) BETWEEN 1 AND 40 AND phone ~ '^[+0-9 ()-]+$')
      ),
      ADD CONSTRAINT person_nationality_check CHECK (nationality IS NULL OR nationality ~ '^[A-Z]{2}$'),
      ADD CONSTRAINT person_notes_check CHECK (notes IS NULL OR length(notes) <= 4000),
      ADD CONSTRAINT person_passport_number_check CHECK (
        "passportNumber" IS NULL OR length(btrim("passportNumber")) BETWEEN 1 AND 40
      ),
      ADD CONSTRAINT person_email_length_check CHECK (email IS NULL OR length(email) <= 254);
  `);

  // 2. Customer details. displayName gains the documented length ceiling.
  pgm.sql(String.raw`
    ALTER TABLE crm.customer
      ADD COLUMN notes text NULL,
      ADD COLUMN email text NULL,
      ADD COLUMN phone text NULL,
      ADD CONSTRAINT customer_displayName_length_check CHECK (length("displayName") <= 300),
      ADD CONSTRAINT customer_notes_check CHECK (notes IS NULL OR length(notes) <= 4000),
      ADD CONSTRAINT customer_email_length_check CHECK (email IS NULL OR length(email) <= 254),
      ADD CONSTRAINT customer_phone_check CHECK (
        phone IS NULL OR (length(phone) BETWEEN 1 AND 40 AND phone ~ '^[+0-9 ()-]+$')
      );
  `);

  // 3. Search indexes. Btree supports equality and prefix lookups; the admin search uses a
  //    case-insensitive contains match, so for an internal single-agency dataset it scans the
  //    Agency's rows. These indexes keep the planner's per-Agency filter cheap.
  pgm.sql(String.raw`
    CREATE INDEX customer_search_display_name_idx ON crm.customer ("agencyId", lower("displayName"));
    CREATE INDEX customer_search_email_idx ON crm.customer ("agencyId", lower(email));
    CREATE INDEX customer_search_phone_idx ON crm.customer ("agencyId", phone);
    CREATE INDEX person_search_full_name_idx ON crm.person ("agencyId", lower("givenName" || ' ' || "familyName"));
    CREATE INDEX person_search_email_idx ON crm.person ("agencyId", lower(email));
    CREATE INDEX person_search_phone_idx ON crm.person ("agencyId", phone);
  `);

  // 4. Customer creation idempotency, mirroring sales.lead_idempotency. Rows are immutable.
  pgm.sql(String.raw`
    CREATE TABLE crm.customer_idempotency (
      "agencyId" uuid NOT NULL,
      "staffPrincipalId" text NOT NULL,
      command text NOT NULL,
      "idempotencyKey" text NOT NULL,
      "customerId" uuid NOT NULL,
      "requestHash" character(64) NOT NULL,
      "createdAt" timestamp with time zone DEFAULT date_trunc('milliseconds'::text, clock_timestamp()) NOT NULL,
      CONSTRAINT customer_idempotency_pkey PRIMARY KEY ("agencyId", "staffPrincipalId", command, "idempotencyKey"),
      CONSTRAINT customer_idempotency_command_check CHECK (command = ANY (ARRAY['customer.create'::text])),
      CONSTRAINT customer_idempotency_key_check CHECK (length("idempotencyKey") BETWEEN 1 AND 128),
      CONSTRAINT customer_idempotency_request_hash_check CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
      CONSTRAINT customer_idempotency_actor_agency_fk FOREIGN KEY ("agencyId", "staffPrincipalId")
        REFERENCES staff_access.staff_membership("agencyId", "staffPrincipalId") ON DELETE RESTRICT,
      CONSTRAINT customer_idempotency_customer_agency_fk FOREIGN KEY ("customerId", "agencyId")
        REFERENCES crm.customer(id, "agencyId") ON DELETE RESTRICT
    );
  `);

  // 5. Protected compare-and-swap functions. Outcomes are 'UPDATED', 'STALE' or 'NOT_FOUND'.
  pgm.sql(String.raw`
    CREATE FUNCTION crm.update_customer(
      p_agency_id uuid, p_customer_id uuid, p_expected_lock_version bigint,
      p_display_name text, p_email text, p_phone text, p_notes text
    ) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      BEGIN
        IF p_agency_id IS NULL OR p_customer_id IS NULL OR
           p_expected_lock_version IS NULL OR p_expected_lock_version < 0 OR
           p_display_name IS NULL OR length(btrim(p_display_name)) = 0 OR length(p_display_name) > 300 THEN
          RAISE EXCEPTION 'Customer update inputs are invalid'
            USING ERRCODE = '22023', CONSTRAINT = 'crm_customer_update_input';
        END IF;
        UPDATE "crm"."customer" AS customer
           SET "displayName" = p_display_name,
               "email" = p_email,
               "phone" = p_phone,
               "notes" = p_notes,
               "lockVersion" = customer."lockVersion" + 1,
               "updatedAt" = date_trunc('milliseconds', clock_timestamp())
         WHERE customer."agencyId" = p_agency_id
           AND customer."id" = p_customer_id
           AND customer."lockVersion" = p_expected_lock_version;
        IF FOUND THEN
          RETURN 'UPDATED';
        END IF;
        IF EXISTS (
          SELECT 1 FROM "crm"."customer" AS customer
           WHERE customer."agencyId" = p_agency_id AND customer."id" = p_customer_id
        ) THEN
          RETURN 'STALE';
        END IF;
        RETURN 'NOT_FOUND';
      END
      $$;

    CREATE FUNCTION crm.update_person(
      p_agency_id uuid, p_person_id uuid, p_expected_lock_version bigint,
      p_given_name text, p_family_name text, p_email text, p_phone text, p_birth_date date,
      p_nationality text, p_notes text, p_passport_number text, p_passport_expiry date
    ) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      BEGIN
        IF p_agency_id IS NULL OR p_person_id IS NULL OR
           p_expected_lock_version IS NULL OR p_expected_lock_version < 0 OR
           p_given_name IS NULL OR length(btrim(p_given_name)) = 0 OR
           p_family_name IS NULL OR length(btrim(p_family_name)) = 0 THEN
          RAISE EXCEPTION 'Person update inputs are invalid'
            USING ERRCODE = '22023', CONSTRAINT = 'crm_person_update_input';
        END IF;
        UPDATE "crm"."person" AS person
           SET "givenName" = p_given_name,
               "familyName" = p_family_name,
               "email" = p_email,
               "phone" = p_phone,
               "birthDate" = p_birth_date,
               "nationality" = p_nationality,
               "notes" = p_notes,
               "passportNumber" = p_passport_number,
               "passportExpiry" = p_passport_expiry,
               "lockVersion" = person."lockVersion" + 1,
               "updatedAt" = date_trunc('milliseconds', clock_timestamp())
         WHERE person."agencyId" = p_agency_id
           AND person."id" = p_person_id
           AND person."lockVersion" = p_expected_lock_version;
        IF FOUND THEN
          RETURN 'UPDATED';
        END IF;
        IF EXISTS (
          SELECT 1 FROM "crm"."person" AS person
           WHERE person."agencyId" = p_agency_id AND person."id" = p_person_id
        ) THEN
          RETURN 'STALE';
        END IF;
        RETURN 'NOT_FOUND';
      END
      $$;

    CREATE FUNCTION crm.set_customer_person_roles(
      p_agency_id uuid, p_customer_id uuid, p_person_id uuid, p_roles text[], p_primary boolean
    ) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      DECLARE
        was_primary boolean;
      BEGIN
        IF p_agency_id IS NULL OR p_customer_id IS NULL OR p_person_id IS NULL OR
           p_roles IS NULL OR cardinality(p_roles) = 0 OR
           NOT (p_roles <@ ARRAY['PRIMARY_CONTACT', 'TRAVELLER', 'PAYER', 'GUARDIAN']::text[]) OR
           (SELECT count(DISTINCT role_name) FROM unnest(p_roles) AS role_name) <> cardinality(p_roles) OR
           p_primary IS NULL OR
           (p_primary AND NOT ('PRIMARY_CONTACT' = ANY (p_roles))) THEN
          RAISE EXCEPTION 'Customer person role inputs are invalid'
            USING ERRCODE = '22023', CONSTRAINT = 'crm_customer_person_roles_input';
        END IF;

        -- Serialize role changes per Customer, then confirm both parents belong to this Agency.
        PERFORM 1 FROM "crm"."customer" AS customer
         WHERE customer."agencyId" = p_agency_id AND customer."id" = p_customer_id
         FOR UPDATE;
        IF NOT FOUND OR NOT EXISTS (
          SELECT 1 FROM "crm"."person" AS person
           WHERE person."agencyId" = p_agency_id AND person."id" = p_person_id
        ) THEN
          RETURN 'NOT_FOUND';
        END IF;

        SELECT coalesce(bool_or(link."isPrimary"), false) INTO was_primary
          FROM "crm"."customer_person" AS link
         WHERE link."agencyId" = p_agency_id AND link."customerId" = p_customer_id
           AND link."personId" = p_person_id;

        IF was_primary AND NOT p_primary THEN
          RAISE EXCEPTION 'The primary contact cannot be demoted without promoting another person'
            USING ERRCODE = '22023', CONSTRAINT = 'crm_customer_primary_required';
        END IF;
        IF p_primary AND EXISTS (
          SELECT 1 FROM "crm"."customer_person" AS link
           WHERE link."agencyId" = p_agency_id AND link."personId" = p_person_id
             AND link."isPrimary" AND link."customerId" <> p_customer_id
        ) THEN
          RAISE EXCEPTION 'The person is already the primary contact of another customer'
            USING ERRCODE = '22023', CONSTRAINT = 'crm_customer_primary_elsewhere';
        END IF;

        DELETE FROM "crm"."customer_person" AS link
         WHERE link."agencyId" = p_agency_id AND link."customerId" = p_customer_id
           AND link."personId" = p_person_id
           AND NOT (link."role" = ANY (p_roles));

        IF p_primary THEN
          UPDATE "crm"."customer_person" AS link
             SET "isPrimary" = false
           WHERE link."agencyId" = p_agency_id AND link."customerId" = p_customer_id
             AND link."isPrimary" AND link."personId" <> p_person_id;
        END IF;

        INSERT INTO "crm"."customer_person" ("agencyId", "customerId", "personId", "role", "isPrimary")
        SELECT p_agency_id, p_customer_id, p_person_id, role_name, false
          FROM unnest(p_roles) AS role_name
         WHERE NOT EXISTS (
           SELECT 1 FROM "crm"."customer_person" AS existing
            WHERE existing."agencyId" = p_agency_id AND existing."customerId" = p_customer_id
              AND existing."personId" = p_person_id AND existing."role" = role_name
         );

        UPDATE "crm"."customer_person" AS link
           SET "isPrimary" = (p_primary AND link."role" = 'PRIMARY_CONTACT')
         WHERE link."agencyId" = p_agency_id AND link."customerId" = p_customer_id
           AND link."personId" = p_person_id
           AND link."isPrimary" <> (p_primary AND link."role" = 'PRIMARY_CONTACT');

        RETURN 'UPDATED';
      END
      $$;
  `);

  // 6. Column-level INSERT grants for the new columns (additive to the baseline grants), the
  //    customer idempotency table, and EXECUTE on the protected functions. No UPDATE or DELETE on
  //    crm.customer or crm.person is granted; the functions are the only update path.
  pgm.sql(String.raw`
    GRANT INSERT ("email", "notes", "phone") ON TABLE crm.customer TO travelos_admin_runtime;
    GRANT INSERT ("birthDate", "nationality", "notes", "passportExpiry", "passportNumber", "phone") ON TABLE crm.person TO travelos_admin_runtime;
    GRANT SELECT, INSERT ON TABLE crm.customer_idempotency TO travelos_admin_runtime;
    GRANT USAGE ON SCHEMA crm TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION crm.update_customer(uuid, uuid, bigint, text, text, text, text) TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION crm.update_person(uuid, uuid, bigint, text, text, text, text, date, text, text, text, date) TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION crm.set_customer_person_roles(uuid, uuid, uuid, text[], boolean) TO travelos_admin_runtime;
    COMMENT ON TABLE crm.customer_idempotency IS 'Immutable Agency- and Staff-scoped idempotency keys for Customer creation.';
    COMMENT ON COLUMN crm.person."passportNumber" IS 'SENSITIVE traveller identity data; redacted unless traveller.view_sensitive; never in customer-facing contracts or snapshots.';
    COMMENT ON COLUMN crm.person."passportExpiry" IS 'SENSITIVE traveller identity data; redacted unless traveller.view_sensitive; never in customer-facing contracts or snapshots.';
    COMMENT ON COLUMN crm.person."birthDate" IS 'SENSITIVE traveller identity data; redacted unless traveller.view_sensitive; never in customer-facing contracts or snapshots.';
  `);
};

exports.down = () => {
  throw new Error(
    "0003_crm_details is forward-only: restore a backup or roll forward with a new migration",
  );
};
