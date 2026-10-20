exports.up = (pgm) => {
  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '60s';

    DO $migration_context$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
      IF (SELECT count(*) FROM "organization"."agency" WHERE "isRoot") <> 1 THEN
        RAISE EXCEPTION 'Stage 7 successor requires exactly one established root Agency';
      END IF;
    END
    $migration_context$;

    ALTER TABLE "portal_access"."portal_principal_context"
      ADD COLUMN "retiredAt" timestamptz;

    CREATE OR REPLACE FUNCTION "portal_access"."create_portal_session_context"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $portal_session_context$
    DECLARE
      context_row_count integer := 0;
    BEGIN
      INSERT INTO "portal_access"."portal_session_context"
        ("sessionId", "portalPrincipalId", "agencyId", "authorizationEpoch")
      SELECT NEW."id", principal."portalPrincipalId", principal."agencyId", principal."authorizationEpoch"
        FROM "portal_access"."portal_principal_context" AS principal
       WHERE principal."portalPrincipalId" = NEW."userId"
         AND principal."retiredAt" IS NULL;
      GET DIAGNOSTICS context_row_count = ROW_COUNT;
      IF context_row_count = 0 THEN
        RAISE EXCEPTION 'Portal session has no active principal context'
          USING ERRCODE = '23503', CONSTRAINT = 'portal_session_principal_context_fk';
      END IF;
      RETURN NEW;
    END
    $portal_session_context$;
    REVOKE ALL ON FUNCTION "portal_access"."create_portal_session_context"()
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";

    CREATE TABLE "portal_access"."runtime_acceptance_fixture_run" (
      "agencyId" uuid NOT NULL,
      "fixtureRunId" uuid NOT NULL,
      "createdByStaffPrincipalId" text NOT NULL,
      "portalPrincipalId" text,
      "state" text NOT NULL DEFAULT 'OPEN' CHECK (
        "state" IN ('OPEN', 'CLEANUP_PENDING', 'CLEANED')
      ),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "cleanedAt" timestamptz,
      PRIMARY KEY ("agencyId", "fixtureRunId"),
      CONSTRAINT "runtime_acceptance_fixture_run_creator_fk"
        FOREIGN KEY ("agencyId", "createdByStaffPrincipalId")
        REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId") ON DELETE RESTRICT,
      CONSTRAINT "runtime_acceptance_fixture_run_portal_principal_fk"
        FOREIGN KEY ("agencyId", "portalPrincipalId")
        REFERENCES "portal_access"."portal_principal_context" ("agencyId", "portalPrincipalId") ON DELETE RESTRICT,
      CONSTRAINT "runtime_acceptance_fixture_run_principal_unique" UNIQUE ("portalPrincipalId"),
      CONSTRAINT "runtime_acceptance_fixture_run_cleaned_at_shape" CHECK (
        ("state" = 'CLEANED' AND "cleanedAt" IS NOT NULL) OR
        ("state" <> 'CLEANED' AND "cleanedAt" IS NULL)
      )
    );
    CREATE UNIQUE INDEX "runtime_acceptance_fixture_one_unresolved_per_agency_idx"
      ON "portal_access"."runtime_acceptance_fixture_run" ("agencyId")
      WHERE "state" IN ('OPEN', 'CLEANUP_PENDING');

    CREATE TABLE "portal_access"."runtime_acceptance_fixture_trip" (
      "agencyId" uuid NOT NULL,
      "fixtureRunId" uuid NOT NULL,
      "slot" smallint NOT NULL CHECK ("slot" IN (1, 2)),
      "tripId" uuid NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY ("agencyId", "fixtureRunId", "slot"),
      CONSTRAINT "runtime_acceptance_fixture_trip_run_fk"
        FOREIGN KEY ("agencyId", "fixtureRunId")
        REFERENCES "portal_access"."runtime_acceptance_fixture_run" ("agencyId", "fixtureRunId") ON DELETE RESTRICT,
      CONSTRAINT "runtime_acceptance_fixture_trip_trip_unique" UNIQUE ("agencyId", "tripId"),
      CONSTRAINT "runtime_acceptance_fixture_trip_scope_fk"
        FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT
    );

    CREATE TABLE "audit"."runtime_acceptance_fixture_event" (
      "eventId" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "fixtureRunId" uuid NOT NULL,
      "eventType" text NOT NULL CHECK (
        "eventType" IN (
          'FIXTURE_RUN_OPENED',
          'FIXTURE_TRIP_ASSOCIATED',
          'FIXTURE_PORTAL_PRINCIPAL_ASSOCIATED',
          'FIXTURE_CLEANUP_PENDING',
          'FIXTURE_RUN_CLEANED',
          'FIXTURE_PORTAL_PRINCIPAL_RETIRED'
        )
      ),
      "actorKind" text NOT NULL CHECK ("actorKind" IN ('STAFF', 'PORTAL_OPERATOR')),
      "actorStaffPrincipalId" text,
      "tripId" uuid,
      "portalPrincipalId" text,
      "reason" text CHECK ("reason" IS NULL OR "reason" = 'RUNTIME_ACCEPTANCE_CLEANUP'),
      "occurredAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "runtime_acceptance_fixture_event_run_fk"
        FOREIGN KEY ("agencyId", "fixtureRunId")
        REFERENCES "portal_access"."runtime_acceptance_fixture_run" ("agencyId", "fixtureRunId") ON DELETE RESTRICT,
      CONSTRAINT "runtime_acceptance_fixture_event_actor_fk"
        FOREIGN KEY ("agencyId", "actorStaffPrincipalId")
        REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId") ON DELETE RESTRICT,
      CONSTRAINT "runtime_acceptance_fixture_event_trip_fk"
        FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "runtime_acceptance_fixture_event_principal_fk"
        FOREIGN KEY ("agencyId", "portalPrincipalId")
        REFERENCES "portal_access"."portal_principal_context" ("agencyId", "portalPrincipalId") ON DELETE RESTRICT,
      CONSTRAINT "runtime_acceptance_fixture_event_shape" CHECK (
        ("eventType" = 'FIXTURE_RUN_OPENED' AND "actorKind" = 'STAFF' AND
         "actorStaffPrincipalId" IS NOT NULL AND "tripId" IS NULL AND "portalPrincipalId" IS NULL) OR
        ("eventType" = 'FIXTURE_TRIP_ASSOCIATED' AND "actorKind" = 'STAFF' AND
         "actorStaffPrincipalId" IS NOT NULL AND "tripId" IS NOT NULL AND "portalPrincipalId" IS NULL) OR
        ("eventType" = 'FIXTURE_PORTAL_PRINCIPAL_ASSOCIATED' AND "actorKind" = 'PORTAL_OPERATOR' AND
         "actorStaffPrincipalId" IS NULL AND "tripId" IS NULL AND "portalPrincipalId" IS NOT NULL) OR
        ("eventType" IN ('FIXTURE_CLEANUP_PENDING', 'FIXTURE_RUN_CLEANED') AND
         "actorKind" = 'STAFF' AND "actorStaffPrincipalId" IS NOT NULL AND
         "tripId" IS NULL AND "portalPrincipalId" IS NULL AND "reason" IS NULL) OR
        ("eventType" = 'FIXTURE_PORTAL_PRINCIPAL_RETIRED' AND "actorKind" = 'STAFF' AND
         "actorStaffPrincipalId" IS NOT NULL AND "tripId" IS NULL AND
         "portalPrincipalId" IS NOT NULL AND "reason" = 'RUNTIME_ACCEPTANCE_CLEANUP')
      )
    );
    CREATE INDEX "runtime_acceptance_fixture_event_by_run_idx"
      ON "audit"."runtime_acceptance_fixture_event"
        ("agencyId", "fixtureRunId", "occurredAt", "eventId");

    CREATE TABLE "portal_access"."portal_principal_retirement_event" (
      "eventId" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "fixtureRunId" uuid NOT NULL,
      "portalPrincipalId" text NOT NULL,
      "actorStaffPrincipalId" text NOT NULL,
      "eventType" text NOT NULL CHECK ("eventType" = 'PORTAL_PRINCIPAL_RETIRED'),
      "reason" text NOT NULL CHECK ("reason" = 'RUNTIME_ACCEPTANCE_CLEANUP'),
      "occurredAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY ("agencyId", "fixtureRunId")
        REFERENCES "portal_access"."runtime_acceptance_fixture_run" ("agencyId", "fixtureRunId") ON DELETE RESTRICT,
      FOREIGN KEY ("agencyId", "portalPrincipalId")
        REFERENCES "portal_access"."portal_principal_context" ("agencyId", "portalPrincipalId") ON DELETE RESTRICT,
      FOREIGN KEY ("agencyId", "actorStaffPrincipalId")
        REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId") ON DELETE RESTRICT
    );
    CREATE TABLE "integration"."portal_principal_retirement_outbox" (
      "messageId" uuid PRIMARY KEY,
      "eventId" uuid NOT NULL UNIQUE
        REFERENCES "portal_access"."portal_principal_retirement_event" ("eventId") ON DELETE RESTRICT,
      "agencyId" uuid NOT NULL,
      "fixtureRunId" uuid NOT NULL,
      "portalPrincipalId" text NOT NULL,
      "eventType" text NOT NULL CHECK ("eventType" = 'PORTAL_PRINCIPAL_RETIRED'),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY ("agencyId", "fixtureRunId")
        REFERENCES "portal_access"."runtime_acceptance_fixture_run" ("agencyId", "fixtureRunId") ON DELETE RESTRICT,
      FOREIGN KEY ("agencyId", "portalPrincipalId")
        REFERENCES "portal_access"."portal_principal_context" ("agencyId", "portalPrincipalId") ON DELETE RESTRICT
    );

    CREATE TABLE "trip_ops"."trip_cancellation_idempotency" (
      "agencyId" uuid NOT NULL,
      "staffPrincipalId" text NOT NULL,
      "command" text NOT NULL CHECK ("command" = 'trip.cancel'),
      "idempotencyKey" text NOT NULL CHECK (length("idempotencyKey") BETWEEN 1 AND 128),
      "tripId" uuid NOT NULL,
      "requestHash" char(64) NOT NULL CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY ("agencyId", "staffPrincipalId", "command", "idempotencyKey"),
      FOREIGN KEY ("agencyId", "staffPrincipalId")
        REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId") ON DELETE RESTRICT,
      FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT
    );
    CREATE TABLE "trip_ops"."trip_cancellation_event" (
      "eventId" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "tripId" uuid NOT NULL,
      "actorStaffPrincipalId" text NOT NULL,
      "previousLockVersion" integer NOT NULL CHECK ("previousLockVersion" >= 0),
      "currentLockVersion" integer NOT NULL CHECK ("currentLockVersion" = "previousLockVersion" + 1),
      "eventType" text NOT NULL CHECK ("eventType" = 'TRIP_CANCELLED'),
      "occurredAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT,
      FOREIGN KEY ("agencyId", "actorStaffPrincipalId")
        REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId") ON DELETE RESTRICT
    );
    CREATE TABLE "audit"."trip_cancellation_event" (
      "auditId" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "tripId" uuid NOT NULL,
      "actorStaffPrincipalId" text NOT NULL,
      "action" text NOT NULL CHECK ("action" = 'TRIP_CANCELLED'),
      "previousLockVersion" integer NOT NULL CHECK ("previousLockVersion" >= 0),
      "currentLockVersion" integer NOT NULL CHECK ("currentLockVersion" = "previousLockVersion" + 1),
      "occurredAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT,
      FOREIGN KEY ("agencyId", "actorStaffPrincipalId")
        REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId") ON DELETE RESTRICT
    );
    CREATE TABLE "integration"."trip_cancellation_outbox" (
      "messageId" uuid PRIMARY KEY,
      "eventId" uuid NOT NULL UNIQUE
        REFERENCES "trip_ops"."trip_cancellation_event" ("eventId") ON DELETE RESTRICT,
      "agencyId" uuid NOT NULL,
      "tripId" uuid NOT NULL,
      "eventType" text NOT NULL CHECK ("eventType" = 'TRIP_CANCELLED'),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT
    );

    CREATE TABLE "trip_ops"."publication_withdrawal_idempotency" (
      "agencyId" uuid NOT NULL,
      "staffPrincipalId" text NOT NULL,
      "command" text NOT NULL CHECK ("command" = 'trip.withdraw_publication'),
      "idempotencyKey" text NOT NULL CHECK (length("idempotencyKey") BETWEEN 1 AND 128),
      "tripId" uuid NOT NULL,
      "requestHash" char(64) NOT NULL CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
      "outcome" text NOT NULL CHECK ("outcome" IN ('WITHDRAWN', 'ALREADY_WITHDRAWN')),
      "publicationId" uuid,
      "version" integer,
      "withdrawnAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY ("agencyId", "staffPrincipalId", "command", "idempotencyKey"),
      FOREIGN KEY ("agencyId", "staffPrincipalId")
        REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId") ON DELETE RESTRICT,
      FOREIGN KEY ("tripId", "agencyId")
        REFERENCES "trip_ops"."trip" ("id", "agencyId") ON DELETE RESTRICT,
      FOREIGN KEY ("publicationId", "agencyId", "tripId")
        REFERENCES "trip_ops"."publication_version" ("publicationId", "agencyId", "tripId") ON DELETE RESTRICT,
      CHECK (("outcome" = 'WITHDRAWN' AND "publicationId" IS NOT NULL AND "version" IS NOT NULL AND
              "version" > 0 AND "withdrawnAt" IS NOT NULL) OR
             ("outcome" = 'ALREADY_WITHDRAWN' AND "publicationId" IS NULL AND "version" IS NULL AND "withdrawnAt" IS NULL))
    );
    CREATE TABLE "trip_ops"."publication_withdrawal_event" (
      "eventId" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "tripId" uuid NOT NULL,
      "publicationId" uuid NOT NULL,
      "version" integer NOT NULL CHECK ("version" > 0),
      "actorStaffPrincipalId" text NOT NULL,
      "eventType" text NOT NULL CHECK ("eventType" = 'TRIP_PUBLICATION_WITHDRAWN'),
      "occurredAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY ("publicationId", "agencyId", "tripId", "version")
        REFERENCES "trip_ops"."publication_version" ("publicationId", "agencyId", "tripId", "version") ON DELETE RESTRICT,
      FOREIGN KEY ("agencyId", "actorStaffPrincipalId")
        REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId") ON DELETE RESTRICT
    );
    CREATE TABLE "audit"."trip_publication_withdrawal_event" (
      "auditId" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "tripId" uuid NOT NULL,
      "publicationId" uuid NOT NULL,
      "actorStaffPrincipalId" text NOT NULL,
      "action" text NOT NULL CHECK ("action" = 'TRIP_PUBLICATION_WITHDRAWN'),
      "reason" text NOT NULL CHECK (length(btrim("reason")) BETWEEN 1 AND 500),
      "occurredAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY ("publicationId", "agencyId", "tripId")
        REFERENCES "trip_ops"."publication_version" ("publicationId", "agencyId", "tripId") ON DELETE RESTRICT,
      FOREIGN KEY ("agencyId", "actorStaffPrincipalId")
        REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId") ON DELETE RESTRICT
    );
    CREATE TABLE "integration"."publication_withdrawal_outbox" (
      "messageId" uuid PRIMARY KEY,
      "eventId" uuid NOT NULL UNIQUE
        REFERENCES "trip_ops"."publication_withdrawal_event" ("eventId") ON DELETE RESTRICT,
      "agencyId" uuid NOT NULL,
      "tripId" uuid NOT NULL,
      "publicationId" uuid NOT NULL,
      "version" integer NOT NULL,
      "eventType" text NOT NULL CHECK ("eventType" = 'TRIP_PUBLICATION_WITHDRAWN'),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY ("publicationId", "agencyId", "tripId", "version")
        REFERENCES "trip_ops"."publication_version" ("publicationId", "agencyId", "tripId", "version") ON DELETE RESTRICT
    );

    CREATE OR REPLACE FUNCTION "trip_ops"."cas_cancel_trip"(
      p_agency_id uuid,
      p_trip_id uuid,
      p_expected_lock_version bigint
    )
    RETURNS TABLE ("outcome" text, "previousLockVersion" integer, "currentLockVersion" integer)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $cancel_trip$
    DECLARE
      trip_state text;
      trip_lock_version integer;
      updated_row_count integer;
    BEGIN
      IF session_user <> 'travelos_admin_api' OR
         NOT pg_catalog.pg_has_role(session_user, 'travelos_admin_runtime', 'USAGE') THEN
        RAISE EXCEPTION 'Trip cancellation is restricted to the Admin runtime'
          USING ERRCODE = '42501', CONSTRAINT = 'trip_cancellation_role';
      END IF;
      IF p_agency_id IS NULL OR p_trip_id IS NULL OR p_expected_lock_version IS NULL OR
         p_expected_lock_version < 0 THEN
        RAISE EXCEPTION 'Trip cancellation inputs are invalid'
          USING ERRCODE = '22023', CONSTRAINT = 'trip_cancellation_input';
      END IF;

      PERFORM 1 FROM "trip_ops"."lock_trip_for_publication"(p_agency_id, p_trip_id);
      IF NOT FOUND THEN
        RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::integer, NULL::integer;
        RETURN;
      END IF;
      SELECT trip."state", trip."lockVersion"
        INTO trip_state, trip_lock_version
        FROM "trip_ops"."trip" AS trip
       WHERE trip."agencyId" = p_agency_id AND trip."id" = p_trip_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::integer, NULL::integer;
        RETURN;
      END IF;
      IF trip_state = 'CANCELLED' THEN
        RETURN QUERY SELECT 'ALREADY_CANCELLED'::text, trip_lock_version, trip_lock_version;
        RETURN;
      END IF;
      IF trip_state NOT IN ('DRAFT', 'CONFIRMED', 'IN_OPERATION') THEN
        RETURN QUERY SELECT 'UNSUPPORTED_STATE'::text, trip_lock_version, trip_lock_version;
        RETURN;
      END IF;
      IF trip_lock_version::bigint <> p_expected_lock_version THEN
        RETURN QUERY SELECT 'STALE_VERSION'::text, trip_lock_version, trip_lock_version;
        RETURN;
      END IF;
      IF EXISTS (
        SELECT 1 FROM "trip_ops"."publication_pointer" AS pointer
         WHERE pointer."agencyId" = p_agency_id AND pointer."tripId" = p_trip_id
      ) THEN
        RETURN QUERY SELECT 'ACTIVE_PUBLICATION'::text, trip_lock_version, trip_lock_version;
        RETURN;
      END IF;

      UPDATE "trip_ops"."trip" AS trip
         SET "state" = 'CANCELLED',
             "lockVersion" = trip."lockVersion" + 1,
             "updatedAt" = date_trunc('milliseconds', clock_timestamp())
       WHERE trip."agencyId" = p_agency_id AND trip."id" = p_trip_id
         AND trip."lockVersion" = trip_lock_version;
      GET DIAGNOSTICS updated_row_count = ROW_COUNT;
      IF updated_row_count <> 1 THEN
        RAISE EXCEPTION 'Trip cancellation lost its optimistic lock'
          USING ERRCODE = '40001', CONSTRAINT = 'trip_cancellation_lock_version';
      END IF;
      RETURN QUERY SELECT 'CANCELLED'::text, trip_lock_version, trip_lock_version + 1;
    END
    $cancel_trip$;
    REVOKE ALL ON FUNCTION "trip_ops"."cas_cancel_trip"(uuid, uuid, bigint)
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    GRANT EXECUTE ON FUNCTION "trip_ops"."cas_cancel_trip"(uuid, uuid, bigint)
      TO "travelos_admin_runtime";

    CREATE OR REPLACE FUNCTION "portal_access"."enforce_runtime_acceptance_fixture_run_transition"()
    RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fixture_run_transition$
    BEGIN
      IF TG_OP = 'DELETE' OR
         NEW."agencyId" IS DISTINCT FROM OLD."agencyId" OR
         NEW."fixtureRunId" IS DISTINCT FROM OLD."fixtureRunId" OR
         NEW."createdByStaffPrincipalId" IS DISTINCT FROM OLD."createdByStaffPrincipalId" OR
         NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'Runtime acceptance fixture run identity is immutable'
          USING ERRCODE = '55000', CONSTRAINT = 'runtime_acceptance_fixture_run_immutable';
      END IF;
      IF OLD."state" = 'CLEANED' THEN
        RAISE EXCEPTION 'Runtime acceptance fixture run is terminal'
          USING ERRCODE = '55000', CONSTRAINT = 'runtime_acceptance_fixture_run_terminal';
      END IF;
      IF NEW."portalPrincipalId" IS DISTINCT FROM OLD."portalPrincipalId" AND
         (OLD."portalPrincipalId" IS NOT NULL OR NEW."portalPrincipalId" IS NULL OR NEW."state" <> 'OPEN') THEN
        RAISE EXCEPTION 'Runtime acceptance fixture principal may only be associated once while OPEN'
          USING ERRCODE = '55000', CONSTRAINT = 'runtime_acceptance_fixture_principal_immutable';
      END IF;
      IF NEW."state" IS DISTINCT FROM OLD."state" THEN
        IF OLD."state" = 'OPEN' AND NEW."state" = 'CLEANUP_PENDING' THEN
          NEW."cleanedAt" := NULL;
        ELSIF OLD."state" = 'CLEANUP_PENDING' AND NEW."state" = 'CLEANED' THEN
          NEW."cleanedAt" := clock_timestamp();
        ELSE
          RAISE EXCEPTION 'Runtime acceptance fixture state transition is invalid'
            USING ERRCODE = '23514', CONSTRAINT = 'runtime_acceptance_fixture_run_state_transition';
        END IF;
      ELSIF NEW."cleanedAt" IS DISTINCT FROM OLD."cleanedAt" THEN
        RAISE EXCEPTION 'Runtime acceptance fixture cleanedAt is system managed'
          USING ERRCODE = '55000', CONSTRAINT = 'runtime_acceptance_fixture_cleaned_at_immutable';
      END IF;
      NEW."updatedAt" := clock_timestamp();
      RETURN NEW;
    END
    $fixture_run_transition$;
    REVOKE ALL ON FUNCTION "portal_access"."enforce_runtime_acceptance_fixture_run_transition"()
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "runtime_acceptance_fixture_run_transition_trigger"
      BEFORE UPDATE OR DELETE ON "portal_access"."runtime_acceptance_fixture_run"
      FOR EACH ROW EXECUTE FUNCTION "portal_access"."enforce_runtime_acceptance_fixture_run_transition"();

    CREATE OR REPLACE FUNCTION "portal_access"."enforce_runtime_acceptance_fixture_trip_insert"()
    RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fixture_trip_insert$
    DECLARE
      fixture_state text;
    BEGIN
      SELECT fixture."state" INTO fixture_state
        FROM "portal_access"."runtime_acceptance_fixture_run" AS fixture
       WHERE fixture."agencyId" = NEW."agencyId"
         AND fixture."fixtureRunId" = NEW."fixtureRunId"
       FOR UPDATE;
      IF NOT FOUND THEN
        RETURN NEW;
      END IF;
      IF fixture_state <> 'OPEN' THEN
        RAISE EXCEPTION 'Trips may only be linked to an OPEN runtime acceptance fixture'
          USING ERRCODE = '23514', CONSTRAINT = 'runtime_acceptance_fixture_trip_open_run';
      END IF;
      IF NEW."slot" = 2 AND NOT EXISTS (
        SELECT 1 FROM "portal_access"."runtime_acceptance_fixture_trip" AS prior_trip
         WHERE prior_trip."agencyId" = NEW."agencyId"
           AND prior_trip."fixtureRunId" = NEW."fixtureRunId"
           AND prior_trip."slot" = 1
      ) THEN
        RAISE EXCEPTION 'Fixture Trip slot 1 must be associated before slot 2'
          USING ERRCODE = '23514', CONSTRAINT = 'runtime_acceptance_fixture_trip_slot_order';
      END IF;
      RETURN NEW;
    END
    $fixture_trip_insert$;
    REVOKE ALL ON FUNCTION "portal_access"."enforce_runtime_acceptance_fixture_trip_insert"()
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "runtime_acceptance_fixture_trip_insert_trigger"
      BEFORE INSERT ON "portal_access"."runtime_acceptance_fixture_trip"
      FOR EACH ROW EXECUTE FUNCTION "portal_access"."enforce_runtime_acceptance_fixture_trip_insert"();

    CREATE OR REPLACE FUNCTION "portal_access"."reject_runtime_acceptance_fixture_history_mutation"()
    RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fixture_history_immutable$
    BEGIN
      RAISE EXCEPTION 'Runtime acceptance fixture history is immutable'
        USING ERRCODE = '55000', CONSTRAINT = 'runtime_acceptance_fixture_history_immutable';
    END
    $fixture_history_immutable$;
    REVOKE ALL ON FUNCTION "portal_access"."reject_runtime_acceptance_fixture_history_mutation"()
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "runtime_acceptance_fixture_trip_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "portal_access"."runtime_acceptance_fixture_trip"
      FOR EACH ROW EXECUTE FUNCTION "portal_access"."reject_runtime_acceptance_fixture_history_mutation"();
    CREATE TRIGGER "runtime_acceptance_fixture_event_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "audit"."runtime_acceptance_fixture_event"
      FOR EACH ROW EXECUTE FUNCTION "portal_access"."reject_runtime_acceptance_fixture_history_mutation"();
    CREATE TRIGGER "portal_principal_retirement_event_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "portal_access"."portal_principal_retirement_event"
      FOR EACH ROW EXECUTE FUNCTION "portal_access"."reject_runtime_acceptance_fixture_history_mutation"();
    CREATE TRIGGER "portal_principal_retirement_outbox_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "integration"."portal_principal_retirement_outbox"
      FOR EACH ROW EXECUTE FUNCTION "portal_access"."reject_runtime_acceptance_fixture_history_mutation"();

    CREATE OR REPLACE FUNCTION "trip_ops"."reject_lifecycle_history_mutation"()
    RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $lifecycle_history_immutable$
    BEGIN
      RAISE EXCEPTION 'Trip lifecycle history and idempotency records are immutable'
        USING ERRCODE = '55000', CONSTRAINT = 'trip_lifecycle_history_immutable';
    END
    $lifecycle_history_immutable$;
    REVOKE ALL ON FUNCTION "trip_ops"."reject_lifecycle_history_mutation"()
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "trip_cancellation_idempotency_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "trip_ops"."trip_cancellation_idempotency"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."reject_lifecycle_history_mutation"();
    CREATE TRIGGER "trip_cancellation_event_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "trip_ops"."trip_cancellation_event"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."reject_lifecycle_history_mutation"();
    CREATE TRIGGER "trip_cancellation_audit_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "audit"."trip_cancellation_event"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."reject_lifecycle_history_mutation"();
    CREATE TRIGGER "trip_cancellation_outbox_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "integration"."trip_cancellation_outbox"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."reject_lifecycle_history_mutation"();
    CREATE TRIGGER "publication_withdrawal_idempotency_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "trip_ops"."publication_withdrawal_idempotency"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."reject_lifecycle_history_mutation"();
    CREATE TRIGGER "publication_withdrawal_event_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "trip_ops"."publication_withdrawal_event"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."reject_lifecycle_history_mutation"();
    CREATE TRIGGER "publication_withdrawal_audit_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "audit"."trip_publication_withdrawal_event"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."reject_lifecycle_history_mutation"();
    CREATE TRIGGER "publication_withdrawal_outbox_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "integration"."publication_withdrawal_outbox"
      FOR EACH ROW EXECUTE FUNCTION "trip_ops"."reject_lifecycle_history_mutation"();

    CREATE OR REPLACE FUNCTION "portal_access"."append_runtime_acceptance_fixture_audit"()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fixture_audit$
    DECLARE
      fixture_event_type text;
      fixture_actor_kind text := 'STAFF';
      fixture_actor_staff_id text;
      fixture_trip_id uuid;
      fixture_portal_principal_id text;
      fixture_reason text;
    BEGIN
      IF TG_TABLE_NAME = 'runtime_acceptance_fixture_run' THEN
        IF TG_OP = 'INSERT' THEN
          fixture_event_type := 'FIXTURE_RUN_OPENED';
          fixture_actor_staff_id := NEW."createdByStaffPrincipalId";
        ELSIF NEW."state" IS DISTINCT FROM OLD."state" THEN
          IF NEW."state" = 'CLEANUP_PENDING' THEN
            fixture_event_type := 'FIXTURE_CLEANUP_PENDING';
          ELSIF NEW."state" = 'CLEANED' THEN
            fixture_event_type := 'FIXTURE_RUN_CLEANED';
          END IF;
          fixture_actor_staff_id := NEW."createdByStaffPrincipalId";
        ELSIF NEW."portalPrincipalId" IS DISTINCT FROM OLD."portalPrincipalId" THEN
          fixture_event_type := 'FIXTURE_PORTAL_PRINCIPAL_ASSOCIATED';
          fixture_actor_kind := 'PORTAL_OPERATOR';
          fixture_portal_principal_id := NEW."portalPrincipalId";
        ELSE
          RETURN NULL;
        END IF;
        IF fixture_event_type IS NULL THEN
          RETURN NULL;
        END IF;
      ELSIF TG_TABLE_NAME = 'runtime_acceptance_fixture_trip' AND TG_OP = 'INSERT' THEN
        fixture_event_type := 'FIXTURE_TRIP_ASSOCIATED';
        fixture_actor_kind := 'STAFF';
        fixture_trip_id := NEW."tripId";
        SELECT fixture."createdByStaffPrincipalId" INTO fixture_actor_staff_id
          FROM "portal_access"."runtime_acceptance_fixture_run" AS fixture
         WHERE fixture."agencyId" = NEW."agencyId"
           AND fixture."fixtureRunId" = NEW."fixtureRunId";
        IF NOT FOUND THEN
          RETURN NULL;
        END IF;
      ELSIF TG_TABLE_NAME = 'portal_principal_retirement_event' AND TG_OP = 'INSERT' THEN
        fixture_event_type := 'FIXTURE_PORTAL_PRINCIPAL_RETIRED';
        fixture_actor_staff_id := NEW."actorStaffPrincipalId";
        fixture_portal_principal_id := NEW."portalPrincipalId";
        fixture_reason := NEW."reason";
      ELSE
        RAISE EXCEPTION 'Unexpected runtime acceptance fixture audit trigger source'
          USING ERRCODE = '55000', CONSTRAINT = 'runtime_acceptance_fixture_audit_trigger_source';
      END IF;

      INSERT INTO "audit"."runtime_acceptance_fixture_event"
        ("eventId", "agencyId", "fixtureRunId", "eventType", "actorKind",
         "actorStaffPrincipalId", "tripId", "portalPrincipalId", "reason")
      VALUES
        (pg_catalog.gen_random_uuid(), NEW."agencyId", NEW."fixtureRunId", fixture_event_type,
         fixture_actor_kind, fixture_actor_staff_id, fixture_trip_id, fixture_portal_principal_id,
         fixture_reason);
      RETURN NULL;
    END
    $fixture_audit$;
    REVOKE ALL ON FUNCTION "portal_access"."append_runtime_acceptance_fixture_audit"()
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "runtime_acceptance_fixture_run_audit_trigger"
      AFTER INSERT OR UPDATE OF "state", "portalPrincipalId"
      ON "portal_access"."runtime_acceptance_fixture_run"
      FOR EACH ROW EXECUTE FUNCTION "portal_access"."append_runtime_acceptance_fixture_audit"();
    CREATE TRIGGER "runtime_acceptance_fixture_trip_audit_trigger"
      AFTER INSERT ON "portal_access"."runtime_acceptance_fixture_trip"
      FOR EACH ROW EXECUTE FUNCTION "portal_access"."append_runtime_acceptance_fixture_audit"();
    CREATE TRIGGER "portal_principal_retirement_audit_trigger"
      AFTER INSERT ON "portal_access"."portal_principal_retirement_event"
      FOR EACH ROW EXECUTE FUNCTION "portal_access"."append_runtime_acceptance_fixture_audit"();

    CREATE OR REPLACE FUNCTION "portal_access"."associate_runtime_acceptance_fixture_portal_principal"(
      fixture_run_id uuid,
      portal_principal_id text
    )
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fixture_principal_association$
    DECLARE
      fixture_agency_id uuid;
      fixture_state text;
      existing_principal_id text;
      fixture_trip_count integer;
      principal_email text;
      principal_email_verified boolean;
      updated_row_count integer;
    BEGIN
      IF session_user <> 'travelos_portal_api' OR
         NOT pg_catalog.pg_has_role(session_user, 'travelos_portal_runtime', 'USAGE') THEN
        RAISE EXCEPTION 'Runtime fixture association is restricted to the Portal runtime'
          USING ERRCODE = '42501', CONSTRAINT = 'runtime_acceptance_fixture_association_role';
      END IF;
      IF fixture_run_id IS NULL OR portal_principal_id IS NULL OR btrim(portal_principal_id) = '' THEN
        RAISE EXCEPTION 'Runtime fixture association inputs are invalid'
          USING ERRCODE = '22023', CONSTRAINT = 'runtime_acceptance_fixture_association_input';
      END IF;

      SELECT context."agencyId" INTO fixture_agency_id
        FROM "portal_access"."runtime_agency_context" AS context
       WHERE context."contextKey" = 'PRIMARY';
      IF fixture_agency_id IS NULL THEN
        RAISE EXCEPTION 'Runtime fixture association has no Agency context'
          USING ERRCODE = '42501', CONSTRAINT = 'runtime_acceptance_fixture_association_agency';
      END IF;

      SELECT principal."email", principal."emailVerified"
        INTO principal_email, principal_email_verified
        FROM "portal_access"."portal_user" AS principal
        JOIN "portal_access"."portal_principal_context" AS context
          ON context."portalPrincipalId" = principal."id"
       WHERE context."agencyId" = fixture_agency_id
         AND context."portalPrincipalId" = portal_principal_id
         AND context."retiredAt" IS NULL;
      IF NOT FOUND OR principal_email_verified IS DISTINCT FROM true OR
         principal_email IS NULL OR lower(principal_email) !~ '^[^@]+@example[.]test$' THEN
        RAISE EXCEPTION 'Runtime fixture association requires one active verified synthetic Portal principal'
          USING ERRCODE = '42501', CONSTRAINT = 'runtime_acceptance_fixture_association_principal';
      END IF;

      SELECT fixture."state", fixture."portalPrincipalId"
        INTO fixture_state, existing_principal_id
        FROM "portal_access"."runtime_acceptance_fixture_run" AS fixture
       WHERE fixture."agencyId" = fixture_agency_id
         AND fixture."fixtureRunId" = fixture_run_id
       FOR UPDATE;
      IF NOT FOUND OR fixture_state <> 'OPEN' THEN
        RAISE EXCEPTION 'Runtime fixture association requires an OPEN same-Agency run'
          USING ERRCODE = '42501', CONSTRAINT = 'runtime_acceptance_fixture_association_run';
      END IF;
      IF existing_principal_id IS NOT NULL THEN
        IF existing_principal_id = portal_principal_id THEN
          RETURN true;
        END IF;
        RAISE EXCEPTION 'Runtime fixture run already has a Portal principal'
          USING ERRCODE = '23505', CONSTRAINT = 'runtime_acceptance_fixture_run_principal_unique';
      END IF;

      SELECT count(*) INTO fixture_trip_count
        FROM "portal_access"."runtime_acceptance_fixture_trip" AS fixture_trip
       WHERE fixture_trip."agencyId" = fixture_agency_id
         AND fixture_trip."fixtureRunId" = fixture_run_id;
      IF fixture_trip_count < 1 OR fixture_trip_count > 2 THEN
        RAISE EXCEPTION 'Runtime fixture association requires one or two registered Trips'
          USING ERRCODE = '23514', CONSTRAINT = 'runtime_acceptance_fixture_trip_cardinality';
      END IF;

      UPDATE "portal_access"."runtime_acceptance_fixture_run"
         SET "portalPrincipalId" = portal_principal_id
       WHERE "agencyId" = fixture_agency_id
         AND "fixtureRunId" = fixture_run_id;
      GET DIAGNOSTICS updated_row_count = ROW_COUNT;
      IF updated_row_count <> 1 THEN
        RAISE EXCEPTION 'Runtime fixture association lost its registered run'
          USING ERRCODE = '42501', CONSTRAINT = 'runtime_acceptance_fixture_association_run';
      END IF;
      RETURN true;
    END
    $fixture_principal_association$;
    REVOKE ALL ON FUNCTION
      "portal_access"."associate_runtime_acceptance_fixture_portal_principal"(uuid, text)
      FROM PUBLIC, "travelos_admin_runtime", "travelos_worker_runtime";
    GRANT EXECUTE ON FUNCTION
      "portal_access"."associate_runtime_acceptance_fixture_portal_principal"(uuid, text)
      TO "travelos_portal_runtime";

    REVOKE ALL PRIVILEGES ON TABLE
      "portal_access"."runtime_acceptance_fixture_run",
      "portal_access"."runtime_acceptance_fixture_trip",
      "portal_access"."portal_principal_retirement_event",
      "audit"."runtime_acceptance_fixture_event",
      "integration"."portal_principal_retirement_outbox",
      "trip_ops"."trip_cancellation_idempotency",
      "trip_ops"."trip_cancellation_event",
      "audit"."trip_cancellation_event",
      "integration"."trip_cancellation_outbox",
      "trip_ops"."publication_withdrawal_idempotency",
      "trip_ops"."publication_withdrawal_event",
      "audit"."trip_publication_withdrawal_event",
      "integration"."publication_withdrawal_outbox"
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    GRANT SELECT, INSERT ON TABLE
      "portal_access"."runtime_acceptance_fixture_run",
      "portal_access"."runtime_acceptance_fixture_trip"
      TO "travelos_admin_runtime";
    GRANT UPDATE ("state") ON TABLE
      "portal_access"."runtime_acceptance_fixture_run" TO "travelos_admin_runtime";
    GRANT SELECT ON TABLE "audit"."runtime_acceptance_fixture_event" TO "travelos_admin_runtime";
    GRANT INSERT ON TABLE
      "portal_access"."portal_principal_retirement_event",
      "integration"."portal_principal_retirement_outbox"
      TO "travelos_admin_runtime";
    GRANT SELECT, INSERT ON TABLE "trip_ops"."trip_cancellation_idempotency"
      TO "travelos_admin_runtime";
    GRANT INSERT ON TABLE
      "trip_ops"."trip_cancellation_event",
      "audit"."trip_cancellation_event",
      "integration"."trip_cancellation_outbox"
      TO "travelos_admin_runtime";
    GRANT SELECT ("agencyId", "tripId")
      ON TABLE "audit"."trip_cancellation_event" TO "travelos_admin_runtime";
    GRANT SELECT, INSERT ON TABLE "trip_ops"."publication_withdrawal_idempotency"
      TO "travelos_admin_runtime";
    GRANT INSERT ON TABLE
      "trip_ops"."publication_withdrawal_event",
      "audit"."trip_publication_withdrawal_event",
      "integration"."publication_withdrawal_outbox"
      TO "travelos_admin_runtime";
    GRANT SELECT ("agencyId", "tripId")
      ON TABLE "audit"."trip_publication_withdrawal_event" TO "travelos_admin_runtime";
    GRANT SELECT ("agencyId", "tripId", "portalPrincipalId", "eventType")
      ON TABLE "audit"."trip_access_grant_event" TO "travelos_admin_runtime";
    GRANT DELETE ON TABLE "trip_ops"."publication_pointer" TO "travelos_admin_runtime";

    GRANT SELECT ("agencyId", "portalPrincipalId", "authorizationEpoch", "retiredAt")
      ON TABLE "portal_access"."portal_principal_context" TO "travelos_portal_runtime";
    GRANT SELECT ("agencyId", "portalPrincipalId", "authorizationEpoch", "retiredAt"),
          UPDATE ("authorizationEpoch", "updatedAt", "retiredAt")
      ON TABLE "portal_access"."portal_principal_context" TO "travelos_admin_runtime";

    INSERT INTO "staff_access"."role_permission" ("roleId", "permissionId", "scopeKind", "accessLevel")
    SELECT role."id", permission."permissionId", 'AGENCY', 'ALL'
      FROM "staff_access"."role" AS role
      CROSS JOIN (VALUES
        ('trip.withdraw_publication'),
        ('runtime_acceptance.fixture.manage')
      ) AS permission("permissionId")
     WHERE role."templateKey" = 'agency-owner-v1' AND role."isSystemTemplate"
    ON CONFLICT DO NOTHING;

    COMMENT ON TABLE "portal_access"."runtime_acceptance_fixture_run" IS
      'Agency-owned synthetic runtime-acceptance fixture registry; retains creator, state, and Portal Principal association without credentials or arbitrary payloads.';
    COMMENT ON TABLE "portal_access"."runtime_acceptance_fixture_trip" IS
      'Typed same-Agency links from one runtime-acceptance fixture run to at most two Trips; retained as lifecycle evidence.';
    COMMENT ON TABLE "audit"."runtime_acceptance_fixture_event" IS
      'Append-only, minimal audit history for runtime-acceptance fixture registration, associations, and terminal cleanup transitions.';
    COMMENT ON TABLE "portal_access"."portal_principal_retirement_event" IS
      'Immutable domain event for retiring only a Portal Principal linked to a registered runtime-acceptance fixture.';
    COMMENT ON TABLE "trip_ops"."trip_cancellation_idempotency" IS
      'Immutable Agency- and Staff-scoped idempotency keys for supported Trip cancellation commands.';
    COMMENT ON TABLE "trip_ops"."publication_withdrawal_idempotency" IS
      'Immutable Agency- and Staff-scoped idempotency results for active-publication withdrawal.';
    COMMENT ON TABLE "integration"."trip_cancellation_outbox" IS
      'Transactional outbox for supported Trip cancellation events; delivery remains asynchronous.';
    COMMENT ON TABLE "integration"."publication_withdrawal_outbox" IS
      'Transactional outbox for publication-withdrawal events; immutable snapshots remain retained.';
    COMMENT ON COLUMN "portal_access"."portal_principal_context"."retiredAt" IS
      'Terminal Portal Principal retirement marker; current session resolution and new session-context creation fail closed when set.';
    COMMENT ON FUNCTION
      "portal_access"."associate_runtime_acceptance_fixture_portal_principal"(uuid, text) IS
      'Narrow local-operator Portal enrollment capability; accepts only an active verified @example.test Principal for an OPEN same-Agency fixture with one or two registered Trips.';
  `);
};

exports.down = false;
