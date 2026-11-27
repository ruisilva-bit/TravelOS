// Drops the unused Trip publication outbox and its worker projection.
//
// Share links replaced the old "publish trip" feature. Nothing writes integration.trip_publication_outbox
// or trip_ops.publication_event any more; the only remaining readers were the worker projection into
// activity.entry (through integration.activity_source). This migration removes that dead pipeline and
// keeps publication_version, publication_snapshot, publication_lock, share links, the generic job runtime,
// activity.entry (empty) and activity.lead_entry.
//
// Applied migrations are never edited: this file is only ever applied once, after 0001_baseline.
exports.up = (pgm) => {
  // Fail closed unless this runs as the migrator login with the owner role assumed (the runner does
  // both), and unless the Trip publication outbox objects from the baseline are present.
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '120s';

    DO $migration_context$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
      IF to_regclass('travelos_meta.schema_migrations') IS NULL
        OR to_regclass('integration.trip_publication_outbox') IS NULL
        OR to_regclass('trip_ops.publication_event') IS NULL
        OR to_regclass('integration.activity_source') IS NULL THEN
        RAISE EXCEPTION '0002 applies only to a database at the 0001 baseline with the publication outbox';
      END IF;
    END
    $migration_context$;
  `);

  // 1. Remove worker history that came from the dead outbox, children first. Only the immutability
  //    guards that block these deletes are disabled, for this transaction, and re-enabled below.
  pgm.sql(String.raw`
    ALTER TABLE activity.entry DISABLE TRIGGER activity_immutable;
    ALTER TABLE integration.event_context DISABLE TRIGGER context_immutable;
    ALTER TABLE job_runtime.attempt DISABLE TRIGGER attempt_immutable;
    ALTER TABLE integration.trip_publication_outbox DISABLE TRIGGER publication_outbox_immutable_trigger;
    ALTER TABLE trip_ops.publication_event DISABLE TRIGGER publication_event_immutable_trigger;

    DELETE FROM job_runtime.attempt
      WHERE "messageId" IN (SELECT "messageId" FROM integration.trip_publication_outbox);
    DELETE FROM job_runtime.job
      WHERE "messageId" IN (SELECT "messageId" FROM integration.trip_publication_outbox);
    DELETE FROM activity.entry
      WHERE "messageId" IN (SELECT "messageId" FROM integration.trip_publication_outbox);
    DELETE FROM integration.outbox_delivery
      WHERE "messageId" IN (SELECT "messageId" FROM integration.trip_publication_outbox);
    DELETE FROM integration.event_context
      WHERE "messageId" IN (SELECT "messageId" FROM integration.trip_publication_outbox);
    DELETE FROM integration.trip_publication_outbox;
    DELETE FROM trip_ops.publication_event;

    ALTER TABLE activity.entry ENABLE TRIGGER activity_immutable;
    ALTER TABLE integration.event_context ENABLE TRIGGER context_immutable;
    ALTER TABLE job_runtime.attempt ENABLE TRIGGER attempt_immutable;
  `);

  // 2. Drop the foreign keys and columns that point at the outbox, and the activity projection guard.
  pgm.sql(String.raw`
    ALTER TABLE integration.outbox_delivery DROP CONSTRAINT "outbox_delivery_publicationMessageId_agencyId_fkey";
    ALTER TABLE integration.outbox_delivery DROP CONSTRAINT outbox_delivery_publication_message_check;
    ALTER TABLE integration.outbox_delivery DROP COLUMN "publicationMessageId";

    ALTER TABLE integration.event_context DROP CONSTRAINT "event_context_publicationMessageId_agencyId_fkey";
    ALTER TABLE integration.event_context DROP CONSTRAINT event_context_publication_message_check;
    ALTER TABLE integration.event_context DROP COLUMN "publicationMessageId";

    DROP TRIGGER activity_source_guard ON activity.entry;
    ALTER TABLE activity.entry DROP CONSTRAINT entry_event_type_check;
    DROP FUNCTION activity.validate_source();
    DROP VIEW integration.activity_source;
  `);

  // 3. Drop the outbox, its capture trigger and the publication event tables and functions only they used.
  pgm.sql(String.raw`
    DROP TABLE integration.trip_publication_outbox;
    DROP FUNCTION integration.capture_event_context();
    DROP TABLE trip_ops.publication_event;
  `);

  // 4. Worker grants that only the removed projection and dispatch used. Claim, lease, retry and
  //    dead-letter still need SELECT/UPDATE on job_runtime.job and integration.outbox_delivery.
  pgm.sql(String.raw`
    REVOKE ALL ON TABLE activity.entry FROM travelos_worker_runtime;
    REVOKE USAGE ON SCHEMA activity FROM travelos_worker_runtime;
    REVOKE INSERT ON TABLE job_runtime.job FROM travelos_worker_runtime;
    REVOKE INSERT ON TABLE integration.outbox_delivery FROM travelos_worker_runtime;
  `);

  pgm.sql(String.raw`
    COMMENT ON TABLE job_runtime.job IS 'Generic at-least-once job executor: at most two live claims, five attempts, 15s renewable lease and 60s hard deadline. No consumer is registered in the baseline.';
  `);
};

exports.down = () => {
  throw new Error(
    "0002_drop_publication_outbox is forward-only: restore a backup or roll forward with a new migration",
  );
};
