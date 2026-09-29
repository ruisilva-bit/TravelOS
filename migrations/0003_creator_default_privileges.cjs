// The runner connects as travelos_migrator, then SET ROLE travelos_owner.
// Per-schema REVOKE cannot remove PostgreSQL's global PUBLIC defaults.
exports.up = (pgm) => {
  pgm.sql(`
    DO $creator_policy$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
    END
    $creator_policy$;

    ALTER DEFAULT PRIVILEGES FOR ROLE travelos_owner REVOKE ALL ON FUNCTIONS FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE travelos_owner REVOKE ALL ON TYPES FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE travelos_owner REVOKE ALL ON TABLES FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE travelos_owner REVOKE ALL ON SEQUENCES FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE travelos_owner REVOKE ALL ON SCHEMAS FROM PUBLIC;

    -- Repair pre-existing application objects, without touching pg_catalog.
    -- Fail closed if another creator has been introduced outside the policy.
    DO $existing_objects$
    DECLARE
      application_schema record;
      application_type record;
    BEGIN
      FOR application_schema IN
        SELECT nspname, nspowner FROM pg_catalog.pg_namespace
        WHERE nspname IN (
          'public', 'travelos_meta', 'organization', 'staff_access', 'portal_access',
          'crm', 'sales', 'trip_ops', 'presentation', 'finance', 'documents',
          'work_service', 'communications', 'activity', 'audit', 'integration', 'job_runtime'
        )
      LOOP
        IF application_schema.nspname <> 'public'
           AND application_schema.nspowner <> 'travelos_owner'::regrole THEN
          RAISE EXCEPTION 'Unexpected application schema owner';
        END IF;
        IF EXISTS (
          SELECT 1 FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = application_schema.nspname
            AND p.proowner <> 'travelos_owner'::regrole
        ) THEN
          RAISE EXCEPTION 'Unexpected application function creator';
        END IF;
        EXECUTE format('REVOKE ALL ON ALL ROUTINES IN SCHEMA %I FROM PUBLIC', application_schema.nspname);
        EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC', application_schema.nspname);
        EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC', application_schema.nspname);
        FOR application_type IN
          SELECT n.nspname, t.typname FROM pg_catalog.pg_type t
          JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = application_schema.nspname
            AND t.typtype IN ('d', 'e') AND t.typowner = 'travelos_owner'::regrole
        LOOP
          EXECUTE format('REVOKE ALL ON TYPE %I.%I FROM PUBLIC', application_type.nspname, application_type.typname);
        END LOOP;
      END LOOP;
    END
    $existing_objects$;
  `);
};

exports.down = false;
