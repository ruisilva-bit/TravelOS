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

    CREATE TABLE "sales"."lead" (
      "id" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "source" text NOT NULL,
      "contactGivenName" text NOT NULL,
      "contactFamilyName" text NOT NULL,
      "contactEmail" text,
      "contactPhone" text,
      "internalNote" text,
      "state" text NOT NULL,
      "qualifiedCustomerId" uuid,
      "disqualificationReason" text,
      "lockVersion" bigint NOT NULL DEFAULT 1,
      "createdAt" timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
      "updatedAt" timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
      "closedAt" timestamptz,
      CONSTRAINT "lead_id_agency_unique" UNIQUE ("id", "agencyId"),
      CONSTRAINT "lead_source_domain" CHECK (
        "source" IN ('WEBSITE', 'PHONE', 'EMAIL', 'REFERRAL', 'WALK_IN', 'OTHER')
      ),
      CONSTRAINT "lead_contact_given_name_shape" CHECK (
        length(btrim("contactGivenName")) BETWEEN 1 AND 200
      ),
      CONSTRAINT "lead_contact_family_name_shape" CHECK (
        length(btrim("contactFamilyName")) BETWEEN 1 AND 200
      ),
      CONSTRAINT "lead_contact_email_shape" CHECK (
        "contactEmail" IS NULL OR (
          length("contactEmail") <= 320 AND
          "contactEmail" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
        )
      ),
      CONSTRAINT "lead_contact_phone_shape" CHECK (
        "contactPhone" IS NULL OR (
          length("contactPhone") BETWEEN 1 AND 40 AND
          "contactPhone" ~ '^[0-9 +()-]+$' AND
          length(btrim("contactPhone")) > 0
        )
      ),
      CONSTRAINT "lead_internal_note_shape" CHECK (
        "internalNote" IS NULL OR (
          length("internalNote") <= 4000 AND length(btrim("internalNote")) > 0
        )
      ),
      CONSTRAINT "lead_state_domain" CHECK ("state" IN ('OPEN', 'QUALIFIED', 'DISQUALIFIED')),
      CONSTRAINT "lead_disqualification_reason_domain" CHECK (
        "disqualificationReason" IS NULL OR
        "disqualificationReason" IN
          ('NO_RESPONSE', 'NOT_INTERESTED', 'NOT_SERVICEABLE', 'DUPLICATE', 'OTHER')
      ),
      CONSTRAINT "lead_qualified_iff_customer" CHECK (
        ("state" = 'QUALIFIED') = ("qualifiedCustomerId" IS NOT NULL)
      ),
      CONSTRAINT "lead_disqualified_iff_reason" CHECK (
        ("state" = 'DISQUALIFIED') = ("disqualificationReason" IS NOT NULL)
      ),
      CONSTRAINT "lead_open_iff_not_closed" CHECK (("state" = 'OPEN') = ("closedAt" IS NULL)),
      CONSTRAINT "lead_lock_version_positive" CHECK ("lockVersion" >= 1),
      CONSTRAINT "lead_updated_not_before_created" CHECK ("updatedAt" >= "createdAt"),
      CONSTRAINT "lead_qualified_customer_agency_fk"
        FOREIGN KEY ("qualifiedCustomerId", "agencyId")
        REFERENCES "crm"."customer" ("id", "agencyId") ON DELETE RESTRICT
    );
    CREATE INDEX "lead_agency_state_created_idx"
      ON "sales"."lead" ("agencyId", "state", "createdAt" DESC, "id" DESC);

    CREATE FUNCTION "sales"."enforce_lead_transition"()
    RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $enforce_lead_transition$
    BEGIN
      IF NEW."id" <> OLD."id" OR NEW."agencyId" <> OLD."agencyId" OR
         NEW."createdAt" <> OLD."createdAt" THEN
        RAISE EXCEPTION 'Lead identity and creation time are immutable'
          USING ERRCODE = '55000', CONSTRAINT = 'lead_identity_immutable';
      END IF;
      IF OLD."state" <> 'OPEN' THEN
        RAISE EXCEPTION 'A Lead that left OPEN is immutable'
          USING ERRCODE = '55000', CONSTRAINT = 'lead_terminal_immutable';
      END IF;
      IF NEW."lockVersion" <> OLD."lockVersion" + 1 THEN
        RAISE EXCEPTION 'Lead lock version must advance by exactly one'
          USING ERRCODE = '55000', CONSTRAINT = 'lead_lock_version_monotonic';
      END IF;
      RETURN NEW;
    END
    $enforce_lead_transition$;
    CREATE TRIGGER "lead_transition_trigger"
      BEFORE UPDATE ON "sales"."lead"
      FOR EACH ROW EXECUTE FUNCTION "sales"."enforce_lead_transition"();

    CREATE FUNCTION "sales"."reject_lead_history_mutation"()
    RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $reject_lead_history_mutation$
    BEGIN
      RAISE EXCEPTION 'Lead history records are append-only'
        USING ERRCODE = '55000', CONSTRAINT = 'lead_history_immutable';
    END
    $reject_lead_history_mutation$;

    CREATE TABLE "sales"."lead_idempotency" (
      "agencyId" uuid NOT NULL,
      "staffPrincipalId" text NOT NULL,
      "command" text NOT NULL CHECK ("command" IN ('lead.create', 'lead.qualify', 'lead.disqualify')),
      "idempotencyKey" text NOT NULL CHECK (length("idempotencyKey") BETWEEN 1 AND 128),
      "leadId" uuid NOT NULL,
      "requestHash" char(64) NOT NULL CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
      "createdAt" timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
      PRIMARY KEY ("agencyId", "staffPrincipalId", "command", "idempotencyKey"),
      CONSTRAINT "lead_idempotency_actor_agency_fk"
        FOREIGN KEY ("agencyId", "staffPrincipalId")
        REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId") ON DELETE RESTRICT,
      CONSTRAINT "lead_idempotency_lead_agency_fk"
        FOREIGN KEY ("leadId", "agencyId")
        REFERENCES "sales"."lead" ("id", "agencyId") ON DELETE RESTRICT
    );

    CREATE TABLE "audit"."lead_event" (
      "auditId" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "leadId" uuid NOT NULL,
      "actorStaffPrincipalId" text NOT NULL,
      "action" text NOT NULL CHECK ("action" IN ('LEAD_QUALIFIED', 'LEAD_DISQUALIFIED')),
      "previousLockVersion" bigint NOT NULL CHECK ("previousLockVersion" >= 1),
      "currentLockVersion" bigint NOT NULL,
      "customerId" uuid,
      "disqualificationReason" text CHECK (
        "disqualificationReason" IS NULL OR
        "disqualificationReason" IN
          ('NO_RESPONSE', 'NOT_INTERESTED', 'NOT_SERVICEABLE', 'DUPLICATE', 'OTHER')
      ),
      "occurredAt" timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
      CONSTRAINT "lead_event_version_step" CHECK ("currentLockVersion" = "previousLockVersion" + 1),
      CONSTRAINT "lead_event_action_shape" CHECK (
        ("action" = 'LEAD_QUALIFIED' AND "customerId" IS NOT NULL AND
         "disqualificationReason" IS NULL) OR
        ("action" = 'LEAD_DISQUALIFIED' AND "customerId" IS NULL AND
         "disqualificationReason" IS NOT NULL)
      ),
      CONSTRAINT "lead_event_unique_action_per_lead" UNIQUE ("agencyId", "leadId"),
      CONSTRAINT "lead_event_auditid_agency_unique" UNIQUE ("auditId", "agencyId"),
      CONSTRAINT "lead_event_lead_agency_fk"
        FOREIGN KEY ("leadId", "agencyId")
        REFERENCES "sales"."lead" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "lead_event_actor_agency_fk"
        FOREIGN KEY ("agencyId", "actorStaffPrincipalId")
        REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId") ON DELETE RESTRICT,
      CONSTRAINT "lead_event_customer_agency_fk"
        FOREIGN KEY ("customerId", "agencyId")
        REFERENCES "crm"."customer" ("id", "agencyId") ON DELETE RESTRICT
    );

    CREATE TABLE "activity"."lead_entry" (
      "entryId" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "leadId" uuid NOT NULL,
      "auditId" uuid NOT NULL,
      "actorStaffPrincipalId" text NOT NULL,
      "entryType" text NOT NULL CHECK ("entryType" IN ('LEAD_QUALIFIED', 'LEAD_DISQUALIFIED')),
      "schemaVersion" smallint NOT NULL DEFAULT 1 CHECK ("schemaVersion" = 1),
      "occurredAt" timestamptz NOT NULL,
      CONSTRAINT "lead_entry_audit_unique" UNIQUE ("auditId"),
      CONSTRAINT "lead_entry_audit_agency_fk"
        FOREIGN KEY ("auditId", "agencyId")
        REFERENCES "audit"."lead_event" ("auditId", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "lead_entry_lead_agency_fk"
        FOREIGN KEY ("leadId", "agencyId")
        REFERENCES "sales"."lead" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "lead_entry_actor_agency_fk"
        FOREIGN KEY ("agencyId", "actorStaffPrincipalId")
        REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId") ON DELETE RESTRICT
    );
    CREATE INDEX "lead_entry_by_lead_idx"
      ON "activity"."lead_entry" ("agencyId", "leadId", "occurredAt", "entryId");

    CREATE TABLE "integration"."lead_outbox" (
      "messageId" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "leadId" uuid NOT NULL,
      "auditId" uuid NOT NULL,
      "messageType" text NOT NULL CHECK ("messageType" IN ('LeadQualified', 'LeadDisqualified')),
      "schemaVersion" smallint NOT NULL DEFAULT 1 CHECK ("schemaVersion" = 1),
      "leadLockVersion" bigint NOT NULL CHECK ("leadLockVersion" >= 2),
      "createdAt" timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
      CONSTRAINT "lead_outbox_audit_unique" UNIQUE ("auditId"),
      CONSTRAINT "lead_outbox_audit_agency_fk"
        FOREIGN KEY ("auditId", "agencyId")
        REFERENCES "audit"."lead_event" ("auditId", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "lead_outbox_lead_agency_fk"
        FOREIGN KEY ("leadId", "agencyId")
        REFERENCES "sales"."lead" ("id", "agencyId") ON DELETE RESTRICT
    );

    CREATE TRIGGER "lead_idempotency_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "sales"."lead_idempotency"
      FOR EACH ROW EXECUTE FUNCTION "sales"."reject_lead_history_mutation"();
    CREATE TRIGGER "lead_event_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "audit"."lead_event"
      FOR EACH ROW EXECUTE FUNCTION "sales"."reject_lead_history_mutation"();
    CREATE TRIGGER "lead_entry_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "activity"."lead_entry"
      FOR EACH ROW EXECUTE FUNCTION "sales"."reject_lead_history_mutation"();
    CREATE TRIGGER "lead_outbox_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "integration"."lead_outbox"
      FOR EACH ROW EXECUTE FUNCTION "sales"."reject_lead_history_mutation"();
    CREATE TRIGGER "lead_event_no_truncate_trigger"
      BEFORE TRUNCATE ON "audit"."lead_event"
      FOR EACH STATEMENT EXECUTE FUNCTION "sales"."reject_lead_history_mutation"();
    CREATE TRIGGER "lead_entry_no_truncate_trigger"
      BEFORE TRUNCATE ON "activity"."lead_entry"
      FOR EACH STATEMENT EXECUTE FUNCTION "sales"."reject_lead_history_mutation"();
    CREATE TRIGGER "lead_outbox_no_truncate_trigger"
      BEFORE TRUNCATE ON "integration"."lead_outbox"
      FOR EACH STATEMENT EXECUTE FUNCTION "sales"."reject_lead_history_mutation"();

    REVOKE ALL ON FUNCTION "sales"."enforce_lead_transition"(), "sales"."reject_lead_history_mutation"()
      FROM PUBLIC, "travelos_admin_api", "travelos_portal_api", "travelos_worker",
           "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    REVOKE ALL ON TABLE "sales"."lead", "sales"."lead_idempotency", "audit"."lead_event",
      "activity"."lead_entry", "integration"."lead_outbox"
      FROM PUBLIC, "travelos_admin_api", "travelos_portal_api", "travelos_worker",
           "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    GRANT USAGE ON SCHEMA "sales", "audit", "activity", "integration"
      TO "travelos_admin_runtime";
    GRANT SELECT, INSERT, UPDATE ON TABLE "sales"."lead" TO "travelos_admin_runtime";
    GRANT SELECT, INSERT ON TABLE "sales"."lead_idempotency" TO "travelos_admin_runtime";
    GRANT SELECT, INSERT ON TABLE "audit"."lead_event" TO "travelos_admin_runtime";
    GRANT SELECT, INSERT ON TABLE "activity"."lead_entry" TO "travelos_admin_runtime";
    GRANT SELECT, INSERT ON TABLE "integration"."lead_outbox" TO "travelos_admin_runtime";

    INSERT INTO "staff_access"."role_permission" ("roleId", "permissionId", "scopeKind", "accessLevel")
    SELECT role."id", permission."permissionId", 'AGENCY', 'ALL'
      FROM "staff_access"."role" AS role
      CROSS JOIN (VALUES ('sales.view'), ('sales.edit')) AS permission("permissionId")
     WHERE role."templateKey" = 'agency-owner-v1' AND role."isSystemTemplate"
    ON CONFLICT DO NOTHING;

    COMMENT ON TABLE "sales"."lead" IS
      'M2 Lead: unqualified commercial interest retained after qualification. Contact fields are CONFIDENTIAL_PERSONAL; internalNote is INTERNAL_ONLY. No Portal privilege or contract.';
    COMMENT ON COLUMN "sales"."lead"."contactEmail" IS
      'CONFIDENTIAL_PERSONAL contact snapshot; never used to auto-link Persons or Customers.';
    COMMENT ON COLUMN "sales"."lead"."internalNote" IS
      'INTERNAL_ONLY free text; no Portal contract, source field or override exists.';
    COMMENT ON TABLE "sales"."lead_idempotency" IS
      'Immutable Agency- and Staff-scoped idempotency keys for retryable Lead commands.';
    COMMENT ON TABLE "audit"."lead_event" IS
      'Append-only Lead qualification/disqualification evidence; identifiers, versions and a categorical reason only, never contact data.';
    COMMENT ON TABLE "activity"."lead_entry" IS
      'Append-only operational timeline entry for Lead qualification/disqualification; identifiers only.';
    COMMENT ON TABLE "integration"."lead_outbox" IS
      'Transactional outbox for LeadQualified/LeadDisqualified; carries only identifiers and versions. Delivery is deferred.';
  `);
};

exports.down = false;
