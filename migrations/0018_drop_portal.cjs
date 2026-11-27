// ADR-016: TravelOS is an internal single-agency tool. There is no customer login, so the Portal
// identity realm, Trip access grants, runtime-acceptance fixtures and the (staff-unused) Trip
// cancellation / publication withdrawal commands are removed. Publication snapshots, the worker and
// the remaining outbox stay. Forward-only.
exports.up = (pgm) => {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '60s';

    DO $migration_context$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
    END
    $migration_context$;

    -- 1. The worker no longer projects Trip access grant events. Remove grant-sourced worker
    --    history (immutability triggers are suspended only for this deliberate cleanup).
    ALTER TABLE "job_runtime"."attempt" DISABLE TRIGGER "attempt_immutable";
    ALTER TABLE "activity"."entry" DISABLE TRIGGER "activity_immutable";
    ALTER TABLE "integration"."event_context" DISABLE TRIGGER "context_immutable";

    DELETE FROM "job_runtime"."attempt" AS attempt
     USING "integration"."outbox_delivery" AS delivery
     WHERE delivery."grantMessageId" IS NOT NULL
       AND attempt."agencyId" = delivery."agencyId" AND attempt."messageId" = delivery."messageId"
       AND attempt."consumer" = delivery."consumer";
    DELETE FROM "job_runtime"."job" AS job
     USING "integration"."outbox_delivery" AS delivery
     WHERE delivery."grantMessageId" IS NOT NULL
       AND job."agencyId" = delivery."agencyId" AND job."messageId" = delivery."messageId"
       AND job."consumer" = delivery."consumer";
    DELETE FROM "activity"."entry" AS entry
     USING "integration"."outbox_delivery" AS delivery
     WHERE delivery."grantMessageId" IS NOT NULL
       AND entry."agencyId" = delivery."agencyId" AND entry."messageId" = delivery."messageId"
       AND entry."consumer" = delivery."consumer";
    DELETE FROM "integration"."outbox_delivery" WHERE "grantMessageId" IS NOT NULL;
    DELETE FROM "integration"."event_context" WHERE "grantMessageId" IS NOT NULL;

    ALTER TABLE "job_runtime"."attempt" ENABLE TRIGGER "attempt_immutable";
    ALTER TABLE "activity"."entry" ENABLE TRIGGER "activity_immutable";
    ALTER TABLE "integration"."event_context" ENABLE TRIGGER "context_immutable";

    DROP VIEW "integration"."activity_source";
    ALTER TABLE "integration"."event_context" DROP COLUMN "grantMessageId";
    ALTER TABLE "integration"."outbox_delivery" DROP COLUMN "grantMessageId";
    DROP TABLE "integration"."trip_access_grant_outbox";
    ALTER TABLE "integration"."event_context" ALTER COLUMN "publicationMessageId" SET NOT NULL;
    ALTER TABLE "integration"."outbox_delivery" ALTER COLUMN "publicationMessageId" SET NOT NULL;
    ALTER TABLE "integration"."event_context"
      ADD CONSTRAINT "event_context_publication_message_check" CHECK ("messageId" = "publicationMessageId");
    ALTER TABLE "integration"."outbox_delivery"
      ADD CONSTRAINT "outbox_delivery_publication_message_check" CHECK ("messageId" = "publicationMessageId");

    DO $entry_event_type$
    DECLARE
      constraint_name text;
    BEGIN
      FOR constraint_name IN
        SELECT con.conname
          FROM pg_catalog.pg_constraint AS con
         WHERE con.conrelid = '"activity"."entry"'::regclass AND con.contype = 'c'
           AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%TRIP_ACCESS_GRANT%'
      LOOP
        EXECUTE format('ALTER TABLE "activity"."entry" DROP CONSTRAINT %I', constraint_name);
      END LOOP;
    END
    $entry_event_type$;
    ALTER TABLE "activity"."entry"
      ADD CONSTRAINT "entry_event_type_check" CHECK ("eventType" = 'TRIP_PUBLICATION_PUBLISHED');

    CREATE OR REPLACE FUNCTION "integration"."capture_event_context"() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $capture$
    BEGIN
      INSERT INTO "integration"."event_context" ("agencyId", "messageId", "publicationMessageId", "correlationId", "traceparent")
      VALUES (NEW."agencyId", NEW."messageId", NEW."messageId",
        coalesce(nullif(current_setting('travelos.correlation_id', true), '')::uuid, NEW."messageId"),
        nullif(current_setting('travelos.traceparent', true), ''));
      RETURN NEW;
    END
    $capture$;

    -- An independently authored internal identifier allowlist, not a workspace DTO.
    CREATE VIEW "integration"."activity_source" WITH (security_barrier = true) AS
      SELECT outbox."messageId", outbox."agencyId", event."tripId", event."publicationId",
             event."actorStaffPrincipalId", event."eventType", event."occurredAt",
             outbox."messageId" AS "publicationMessageId"
        FROM "integration"."trip_publication_outbox" AS outbox
        JOIN "trip_ops"."publication_event" AS event
          ON event."eventId" = outbox."eventId" AND event."agencyId" = outbox."agencyId"
         AND event."tripId" = outbox."tripId" AND event."publicationId" = outbox."publicationId"
         AND event."version" = outbox."version" AND event."eventType" = outbox."eventType";
    REVOKE ALL ON "integration"."activity_source"
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    GRANT SELECT ON "integration"."activity_source" TO "travelos_worker_runtime";
    COMMENT ON VIEW "integration"."activity_source" IS 'Internal identifiers only; no workspace or authentication payload. ACTIVITY_V1 only.';

    -- 2. Drop the Portal realm, Trip access grants, runtime-acceptance fixtures and the unused
    --    Trip cancellation / publication withdrawal commands.
    DROP TABLE
      "audit"."trip_access_grant_event",
      "integration"."portal_principal_retirement_outbox",
      "audit"."runtime_acceptance_fixture_event",
      "integration"."trip_cancellation_outbox",
      "trip_ops"."trip_cancellation_idempotency",
      "trip_ops"."trip_cancellation_event",
      "audit"."trip_cancellation_event",
      "integration"."publication_withdrawal_outbox",
      "trip_ops"."publication_withdrawal_idempotency",
      "trip_ops"."publication_withdrawal_event",
      "audit"."trip_publication_withdrawal_event";
    DROP FUNCTION "trip_ops"."cas_cancel_trip"(uuid, uuid, bigint);
    DROP FUNCTION "trip_ops"."reject_lifecycle_history_mutation"();
    REVOKE DELETE ON TABLE "trip_ops"."publication_pointer" FROM "travelos_admin_runtime";
    DROP SCHEMA "portal_access" CASCADE;

    -- 3. Removed permissions leave every role.
    DELETE FROM "staff_access"."role_permission"
     WHERE "permissionId" IN (
       'trip.access.manage', 'runtime_acceptance.fixture.manage', 'trip.withdraw_publication'
     );

    -- 4. The Portal runtime and login roles keep no privilege on any remaining schema.
    DO $revoke_portal$
    DECLARE
      application_schema record;
    BEGIN
      FOR application_schema IN
        SELECT nspname FROM pg_catalog.pg_namespace
         WHERE nspowner = 'travelos_owner'::regrole OR nspname = 'public'
      LOOP
        EXECUTE format(
          'REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM "travelos_portal_runtime", "travelos_portal_api"',
          application_schema.nspname);
        EXECUTE format(
          'REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM "travelos_portal_runtime", "travelos_portal_api"',
          application_schema.nspname);
        EXECUTE format(
          'REVOKE ALL ON ALL ROUTINES IN SCHEMA %I FROM "travelos_portal_runtime", "travelos_portal_api"',
          application_schema.nspname);
        EXECUTE format(
          'REVOKE ALL ON SCHEMA %I FROM "travelos_portal_runtime", "travelos_portal_api"',
          application_schema.nspname);
      END LOOP;
    END
    $revoke_portal$;
  `);
};

exports.down = () => {
  throw new Error("0018_drop_portal is forward-only");
};
