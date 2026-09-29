const ownerTemplateKey = "agency-owner-v1";
const ownerLockSeed = 603963866289541011n;

exports.up = (pgm) => {
  pgm.sql(`
    DO $migration_context$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
    END
    $migration_context$;

    CREATE OR REPLACE FUNCTION "staff_access"."protect_last_active_owner_assignment"()
    RETURNS trigger LANGUAGE plpgsql AS $last_owner_assignment$
    DECLARE
      owner_count integer;
      old_is_active_owner boolean;
      new_is_active_owner boolean := false;
    BEGIN
      SELECT OLD."active"
         AND EXISTS (
           SELECT 1 FROM "staff_access"."role"
            WHERE "id" = OLD."roleId" AND "templateKey" = '${ownerTemplateKey}'
         )
         AND EXISTS (
           SELECT 1 FROM "staff_access"."staff_membership"
            WHERE "id" = OLD."membershipId" AND "state" = 'ACTIVE'
         )
        INTO old_is_active_owner;
      IF NOT old_is_active_owner THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;

      IF TG_OP = 'UPDATE' THEN
        SELECT NEW."active"
           AND EXISTS (
             SELECT 1 FROM "staff_access"."role"
              WHERE "id" = NEW."roleId" AND "templateKey" = '${ownerTemplateKey}'
           )
           AND EXISTS (
             SELECT 1 FROM "staff_access"."staff_membership"
              WHERE "id" = NEW."membershipId" AND "state" = 'ACTIVE'
           )
          INTO new_is_active_owner;
        IF new_is_active_owner THEN RETURN NEW; END IF;
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(OLD."agencyId"::text, ${ownerLockSeed}::bigint)
      );
      SELECT count(*) INTO owner_count
        FROM "staff_access"."role_assignment" AS assignment
        JOIN "staff_access"."staff_membership" AS membership ON membership."id" = assignment."membershipId"
        JOIN "staff_access"."role" AS role ON role."id" = assignment."roleId"
       WHERE assignment."agencyId" = OLD."agencyId"
         AND assignment."active"
         AND membership."state" = 'ACTIVE'
         AND role."templateKey" = '${ownerTemplateKey}';
      IF owner_count <= 1 THEN
        RAISE EXCEPTION 'Last active Owner assignment cannot be removed' USING ERRCODE = 'P0001';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END
    $last_owner_assignment$;

    CREATE OR REPLACE FUNCTION "staff_access"."protect_last_active_owner_membership"()
    RETURNS trigger LANGUAGE plpgsql AS $last_owner_membership$
    DECLARE
      owner_count integer;
    BEGIN
      IF OLD."state" <> 'ACTIVE' OR NEW."state" = 'ACTIVE' THEN
        RETURN NEW;
      END IF;
      IF NOT EXISTS (
        SELECT 1
          FROM "staff_access"."role_assignment" AS assignment
          JOIN "staff_access"."role" AS role ON role."id" = assignment."roleId"
         WHERE assignment."membershipId" = OLD."id"
           AND assignment."active"
           AND role."templateKey" = '${ownerTemplateKey}'
      ) THEN
        RETURN NEW;
      END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(OLD."agencyId"::text, ${ownerLockSeed}::bigint)
      );
      SELECT count(*) INTO owner_count
        FROM "staff_access"."role_assignment" AS assignment
        JOIN "staff_access"."staff_membership" AS membership ON membership."id" = assignment."membershipId"
        JOIN "staff_access"."role" AS role ON role."id" = assignment."roleId"
       WHERE assignment."agencyId" = OLD."agencyId"
         AND assignment."active"
         AND membership."state" = 'ACTIVE'
         AND role."templateKey" = '${ownerTemplateKey}';
      IF owner_count <= 1 THEN
        RAISE EXCEPTION 'Last active Owner membership cannot be deactivated' USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END
    $last_owner_membership$;

    REVOKE UPDATE, DELETE ON TABLE
      "organization"."agency_bootstrap_audit",
      "staff_access"."operator_bootstrap_audit"
      FROM "travelos_admin_runtime";
  `);
};

exports.down = false;
