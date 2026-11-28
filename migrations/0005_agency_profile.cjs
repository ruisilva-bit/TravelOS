// Agency profile: the display name and contact details the customer-facing proposal shows, plus a
// protected compare-and-swap update. The root Agency row already carries lockVersion from the baseline.
//
// Applied migrations are never edited: this file is only ever applied once, after 0004.
exports.up = (pgm) => {
  // Fail closed unless this runs as the migrator login with the owner role assumed (the runner does
  // both), and unless the root Agency row and the quote head are present.
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '120s';

    DO $migration_context$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
      IF to_regclass('travelos_meta.schema_migrations') IS NULL
        OR to_regclass('organization.agency') IS NULL
        OR to_regclass('sales.quote') IS NULL THEN
        RAISE EXCEPTION '0005 applies only to a database at the 0004 head';
      END IF;
    END
    $migration_context$;
  `);

  pgm.sql(String.raw`
    ALTER TABLE organization.agency
      ADD COLUMN "displayName" text NOT NULL DEFAULT 'A sua agência de viagens',
      ADD COLUMN email text NULL,
      ADD COLUMN phone text NULL,
      ADD COLUMN website text NULL,
      ADD CONSTRAINT agency_display_name_shape CHECK (length(btrim("displayName")) BETWEEN 1 AND 120),
      ADD CONSTRAINT agency_email_shape CHECK (email IS NULL OR (length(email) BETWEEN 3 AND 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$')),
      ADD CONSTRAINT agency_phone_shape CHECK (phone IS NULL OR length(phone) BETWEEN 1 AND 40),
      ADD CONSTRAINT agency_website_shape CHECK (website IS NULL OR (website LIKE 'https://%' AND length(website) <= 300));
    COMMENT ON COLUMN organization.agency."displayName" IS 'Agency name shown to customers on quote proposals.';
  `);

  // Protected compare-and-swap. Outcomes are 'UPDATED', 'STALE' or 'NOT_FOUND'.
  pgm.sql(String.raw`
    CREATE FUNCTION organization.update_agency_profile(
      p_agency_id uuid, p_expected_lock_version integer,
      p_display_name text, p_email text, p_phone text, p_website text
    ) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'pg_catalog'
      AS $$
      BEGIN
        IF p_agency_id IS NULL OR p_expected_lock_version IS NULL OR p_expected_lock_version < 1 OR
           p_display_name IS NULL OR length(btrim(p_display_name)) = 0 OR length(p_display_name) > 120 THEN
          RAISE EXCEPTION 'Agency profile update inputs are invalid'
            USING ERRCODE = '22023', CONSTRAINT = 'agency_profile_update_input';
        END IF;
        UPDATE "organization"."agency" AS agency
           SET "displayName" = p_display_name,
               "email" = p_email,
               "phone" = p_phone,
               "website" = p_website,
               "lockVersion" = agency."lockVersion" + 1
         WHERE agency."id" = p_agency_id
           AND agency."lockVersion" = p_expected_lock_version;
        IF FOUND THEN
          RETURN 'UPDATED';
        END IF;
        IF EXISTS (SELECT 1 FROM "organization"."agency" AS agency WHERE agency."id" = p_agency_id) THEN
          RETURN 'STALE';
        END IF;
        RETURN 'NOT_FOUND';
      END
      $$;

    GRANT USAGE ON SCHEMA organization TO travelos_admin_runtime;
    GRANT SELECT ON TABLE organization.agency TO travelos_admin_runtime;
    GRANT EXECUTE ON FUNCTION organization.update_agency_profile(uuid, integer, text, text, text, text) TO travelos_admin_runtime;
  `);
};

exports.down = () => {
  throw new Error(
    "0005_agency_profile is forward-only: restore a backup or roll forward with a new migration",
  );
};
