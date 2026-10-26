exports.up = (pgm) => {
  pgm.sql(`
    DO $context$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
    END
    $context$;

    CREATE UNIQUE INDEX "publication_outbox_scope_idx"
      ON "integration"."trip_publication_outbox" ("messageId", "agencyId");
    CREATE UNIQUE INDEX "grant_outbox_scope_idx"
      ON "integration"."trip_access_grant_outbox" ("messageId", "agencyId");

    -- An independently authored internal identifier allowlist, not a workspace DTO.
    CREATE VIEW "integration"."activity_source" WITH (security_barrier = true) AS
      SELECT outbox."messageId", outbox."agencyId", event."tripId", event."publicationId",
             event."actorStaffPrincipalId", event."eventType", event."occurredAt",
             outbox."messageId" AS "publicationMessageId", NULL::uuid AS "grantMessageId"
        FROM "integration"."trip_publication_outbox" AS outbox
        JOIN "trip_ops"."publication_event" AS event
          ON event."eventId" = outbox."eventId" AND event."agencyId" = outbox."agencyId"
         AND event."tripId" = outbox."tripId" AND event."publicationId" = outbox."publicationId"
         AND event."version" = outbox."version" AND event."eventType" = outbox."eventType"
      UNION ALL
      SELECT outbox."messageId", outbox."agencyId", event."tripId", NULL::uuid,
             event."actorStaffPrincipalId", event."eventType", event."occurredAt",
             NULL::uuid, outbox."messageId"
        FROM "integration"."trip_access_grant_outbox" AS outbox
        JOIN "audit"."trip_access_grant_event" AS event
          ON event."eventId" = outbox."eventId" AND event."agencyId" = outbox."agencyId"
         AND event."grantId" = outbox."grantId" AND event."eventType" = outbox."eventType";

    CREATE TABLE "integration"."event_context" (
      "messageId" uuid NOT NULL,
      "agencyId" uuid NOT NULL,
      "publicationMessageId" uuid,
      "grantMessageId" uuid,
      "correlationId" uuid NOT NULL,
      "traceparent" text CHECK (
        "traceparent" ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$' AND
        substring("traceparent", 4, 32) <> repeat('0', 32) AND
        substring("traceparent", 37, 16) <> repeat('0', 16)
      ),
      PRIMARY KEY ("agencyId", "messageId"),
      CHECK (("publicationMessageId" IS NOT NULL AND "grantMessageId" IS NULL AND "messageId" = "publicationMessageId") OR
             ("grantMessageId" IS NOT NULL AND "publicationMessageId" IS NULL AND "messageId" = "grantMessageId")),
      FOREIGN KEY ("publicationMessageId", "agencyId") REFERENCES "integration"."trip_publication_outbox" ("messageId", "agencyId"),
      FOREIGN KEY ("grantMessageId", "agencyId") REFERENCES "integration"."trip_access_grant_outbox" ("messageId", "agencyId")
    );

    CREATE FUNCTION "integration"."capture_event_context"() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $capture$
    BEGIN
      INSERT INTO "integration"."event_context" ("agencyId", "messageId", "publicationMessageId", "grantMessageId", "correlationId", "traceparent")
      VALUES (NEW."agencyId", NEW."messageId",
        CASE WHEN TG_TABLE_NAME='trip_publication_outbox' THEN NEW."messageId" END,
        CASE WHEN TG_TABLE_NAME='trip_access_grant_outbox' THEN NEW."messageId" END,
        coalesce(nullif(current_setting('travelos.correlation_id', true), '')::uuid, NEW."messageId"),
        nullif(current_setting('travelos.traceparent', true), ''));
      RETURN NEW;
    END
    $capture$;
    REVOKE ALL ON FUNCTION "integration"."capture_event_context"() FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "publication_capture_context" AFTER INSERT ON "integration"."trip_publication_outbox" FOR EACH ROW EXECUTE FUNCTION "integration"."capture_event_context"();
    CREATE TRIGGER "grant_capture_context" AFTER INSERT ON "integration"."trip_access_grant_outbox" FOR EACH ROW EXECUTE FUNCTION "integration"."capture_event_context"();

    CREATE TABLE "integration"."outbox_delivery" (
      "messageId" uuid NOT NULL,
      "agencyId" uuid NOT NULL,
      "consumer" text NOT NULL DEFAULT 'ACTIVITY_V1' CHECK ("consumer" = 'ACTIVITY_V1'),
      "publicationMessageId" uuid,
      "grantMessageId" uuid,
      "state" text NOT NULL DEFAULT 'PENDING' CHECK ("state" IN ('PENDING', 'SUCCEEDED', 'DEAD_LETTER', 'UNKNOWN_OUTCOME')),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "completedAt" timestamptz,
      PRIMARY KEY ("agencyId", "messageId", "consumer"),
      CHECK (("publicationMessageId" IS NOT NULL AND "grantMessageId" IS NULL AND "messageId" = "publicationMessageId") OR
             ("grantMessageId" IS NOT NULL AND "publicationMessageId" IS NULL AND "messageId" = "grantMessageId")),
      CHECK (("state" = 'PENDING') = ("completedAt" IS NULL)),
      FOREIGN KEY ("publicationMessageId", "agencyId") REFERENCES "integration"."trip_publication_outbox" ("messageId", "agencyId"),
      FOREIGN KEY ("grantMessageId", "agencyId") REFERENCES "integration"."trip_access_grant_outbox" ("messageId", "agencyId")
    );

    CREATE TABLE "job_runtime"."job" (
      "messageId" uuid NOT NULL,
      "agencyId" uuid NOT NULL,
      "consumer" text NOT NULL DEFAULT 'ACTIVITY_V1' CHECK ("consumer" = 'ACTIVITY_V1'),
      "state" text NOT NULL DEFAULT 'PENDING' CHECK ("state" IN ('PENDING', 'RUNNING', 'RETRY', 'SUCCEEDED', 'DEAD_LETTER', 'UNKNOWN_OUTCOME')),
      "attempt" integer NOT NULL DEFAULT 0 CHECK ("attempt" BETWEEN 0 AND 5),
      "version" bigint NOT NULL DEFAULT 0 CHECK ("version" >= 0),
      "runAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "owner" uuid,
      "leaseUntil" timestamptz,
      "deadline" timestamptz,
      "errorCode" text CHECK ("errorCode" IN ('TEMPORARY', 'PERMANENT', 'UNKNOWN_OUTCOME', 'LEASE_EXPIRED')),
      PRIMARY KEY ("agencyId", "messageId", "consumer"),
      FOREIGN KEY ("agencyId", "messageId", "consumer")
        REFERENCES "integration"."outbox_delivery" ("agencyId", "messageId", "consumer"),
      CHECK (("state" = 'RUNNING' AND "owner" IS NOT NULL AND "leaseUntil" IS NOT NULL AND "deadline" IS NOT NULL AND "attempt" > 0 AND "leaseUntil" <= "deadline") OR
             ("state" <> 'RUNNING' AND "owner" IS NULL AND "leaseUntil" IS NULL AND "deadline" IS NULL))
    );
    CREATE INDEX "job_due_idx" ON "job_runtime"."job" ("runAt", "createdAt", "messageId") WHERE "state" IN ('PENDING', 'RETRY');
    CREATE INDEX "job_expired_idx" ON "job_runtime"."job" ("leaseUntil") WHERE "state" = 'RUNNING';

    CREATE TABLE "job_runtime"."attempt" (
      "agencyId" uuid NOT NULL,
      "messageId" uuid NOT NULL,
      "consumer" text NOT NULL DEFAULT 'ACTIVITY_V1',
      "attempt" integer NOT NULL CHECK ("attempt" BETWEEN 1 AND 5),
      "owner" uuid NOT NULL,
      "outcome" text NOT NULL CHECK ("outcome" IN ('SUCCEEDED', 'RETRY', 'DEAD_LETTER', 'UNKNOWN_OUTCOME')),
      "errorCode" text CHECK ("errorCode" IN ('TEMPORARY', 'PERMANENT', 'UNKNOWN_OUTCOME', 'LEASE_EXPIRED')),
      "finishedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY ("agencyId", "messageId", "consumer", "attempt"),
      FOREIGN KEY ("agencyId", "messageId", "consumer") REFERENCES "job_runtime"."job" ("agencyId", "messageId", "consumer")
    );

    CREATE TABLE "activity"."entry" (
      "agencyId" uuid NOT NULL,
      "messageId" uuid NOT NULL,
      "consumer" text NOT NULL DEFAULT 'ACTIVITY_V1' CHECK ("consumer" = 'ACTIVITY_V1'),
      "tripId" uuid NOT NULL,
      "publicationId" uuid,
      "actorStaffPrincipalId" text,
      "eventType" text NOT NULL CHECK ("eventType" IN ('TRIP_PUBLICATION_PUBLISHED', 'TRIP_ACCESS_GRANT_ISSUED', 'TRIP_ACCESS_GRANT_REVOKED', 'TRIP_ACCESS_GRANT_EXPIRED')),
      "schemaVersion" smallint NOT NULL DEFAULT 1 CHECK ("schemaVersion" = 1),
      "occurredAt" timestamptz NOT NULL,
      "projectedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY ("agencyId", "messageId", "consumer"),
      FOREIGN KEY ("agencyId", "messageId", "consumer") REFERENCES "integration"."outbox_delivery" ("agencyId", "messageId", "consumer"),
      FOREIGN KEY ("tripId", "agencyId") REFERENCES "trip_ops"."trip" ("id", "agencyId"),
      FOREIGN KEY ("publicationId", "agencyId", "tripId") REFERENCES "trip_ops"."publication_version" ("publicationId", "agencyId", "tripId"),
      FOREIGN KEY ("agencyId", "actorStaffPrincipalId") REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId")
    );
    CREATE INDEX "activity_trip_cursor_idx" ON "activity"."entry" ("agencyId", "tripId", "occurredAt", "messageId");

    CREATE FUNCTION "activity"."validate_source"() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $source$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM "integration"."activity_source" AS source
        WHERE source."agencyId" = NEW."agencyId" AND source."messageId" = NEW."messageId"
          AND source."tripId" = NEW."tripId" AND source."publicationId" IS NOT DISTINCT FROM NEW."publicationId"
          AND source."actorStaffPrincipalId" IS NOT DISTINCT FROM NEW."actorStaffPrincipalId"
          AND source."eventType" = NEW."eventType" AND source."occurredAt" = NEW."occurredAt"
      ) THEN
        RAISE EXCEPTION 'Activity source mismatch' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $source$;
    REVOKE ALL ON FUNCTION "activity"."validate_source"() FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "activity_source_guard" BEFORE INSERT ON "activity"."entry" FOR EACH ROW EXECUTE FUNCTION "activity"."validate_source"();

    CREATE FUNCTION "job_runtime"."reject_history_mutation"() RETURNS trigger
      LANGUAGE plpgsql SET search_path = pg_catalog AS $immutable$
    BEGIN
      RAISE EXCEPTION 'Worker history is immutable' USING ERRCODE = '55000';
    END
    $immutable$;
    REVOKE ALL ON FUNCTION "job_runtime"."reject_history_mutation"() FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "activity_immutable" BEFORE UPDATE OR DELETE ON "activity"."entry" FOR EACH ROW EXECUTE FUNCTION "job_runtime"."reject_history_mutation"();
    CREATE TRIGGER "context_immutable" BEFORE UPDATE OR DELETE ON "integration"."event_context" FOR EACH ROW EXECUTE FUNCTION "job_runtime"."reject_history_mutation"();
    CREATE TRIGGER "attempt_immutable" BEFORE UPDATE OR DELETE ON "job_runtime"."attempt" FOR EACH ROW EXECUTE FUNCTION "job_runtime"."reject_history_mutation"();

    REVOKE ALL ON "integration"."activity_source", "integration"."event_context", "integration"."outbox_delivery",
      "job_runtime"."job", "job_runtime"."attempt", "activity"."entry"
      FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    GRANT USAGE ON SCHEMA "activity" TO "travelos_worker_runtime";
    GRANT SELECT ON "integration"."activity_source", "integration"."event_context",
      "integration"."outbox_delivery", "job_runtime"."job", "job_runtime"."attempt", "activity"."entry" TO "travelos_worker_runtime";

    GRANT INSERT ON "integration"."outbox_delivery", "job_runtime"."job", "job_runtime"."attempt", "activity"."entry" TO "travelos_worker_runtime";
    GRANT UPDATE ("state", "completedAt") ON "integration"."outbox_delivery" TO "travelos_worker_runtime";
    GRANT UPDATE ("state", "attempt", "version", "runAt", "owner", "leaseUntil", "deadline", "errorCode") ON "job_runtime"."job" TO "travelos_worker_runtime";
    COMMENT ON VIEW "integration"."activity_source" IS 'Internal identifiers only; no workspace or authentication payload. ACTIVITY_V1 only.';
    COMMENT ON TABLE "job_runtime"."job" IS 'At-least-once ACTIVITY_V1 executor: at most two live claims, five attempts, 15s renewable lease and 60s hard deadline.';
  `);
};
exports.down = false;
