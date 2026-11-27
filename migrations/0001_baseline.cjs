// TravelOS baseline schema (squashed on 2026-11-27; no real data existed).
//
// This single migration replaces the former 0001..0019 chain and produces, in ONE pass and with no
// root Agency required, exactly the schema the application uses. The root Agency, the Owner and
// Trip Operations role templates and every Staff login are created afterwards by the normal
// bootstrap tool (`pnpm auth:bootstrap-first-owner`). Role-graph, database and role bootstrap live
// in deploy/database/bootstrap-database-and-roles.sql; this file only creates schema objects as
// travelos_owner and grants the two runtime roles an explicit allowlist.
//
// Applied migrations are never edited: from now on add a new numbered migration.
exports.up = (pgm) => {
  // Fail closed unless this runs as the migrator login with the owner role assumed (the runner does
  // both), and unless nothing but the runner's own travelos_meta ledger exists yet.
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '120s';

    DO $migration_context$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
      IF to_regclass('travelos_meta.schema_migrations') IS NULL THEN
        RAISE EXCEPTION 'travelos_meta ledger is missing';
      END IF;
      IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace
         WHERE nspname !~ '^pg_' AND nspname NOT IN ('information_schema', 'public', 'travelos_meta')
      ) THEN
        RAISE EXCEPTION 'The baseline must be applied to an empty TravelOS database';
      END IF;
    END
    $migration_context$;

    -- travelos_meta and public are locked down; nothing is reachable through PUBLIC by default.
    ALTER SCHEMA travelos_meta OWNER TO travelos_owner;
    ALTER TABLE travelos_meta.schema_migrations OWNER TO travelos_owner;
    REVOKE ALL PRIVILEGES ON SCHEMA travelos_meta FROM PUBLIC;
    REVOKE ALL PRIVILEGES ON TABLE travelos_meta.schema_migrations FROM PUBLIC;
    REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

    -- Everything the owner creates from here on is born without PUBLIC access.
    ALTER DEFAULT PRIVILEGES FOR ROLE travelos_owner REVOKE ALL ON FUNCTIONS FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE travelos_owner REVOKE ALL ON TYPES FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE travelos_owner REVOKE ALL ON TABLES FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE travelos_owner REVOKE ALL ON SEQUENCES FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE travelos_owner REVOKE ALL ON SCHEMAS FROM PUBLIC;
  `);

  // Schemas
  pgm.sql(String.raw`
-- Application schemas: one capability boundary per schema, owned by travelos_owner.
CREATE SCHEMA activity AUTHORIZATION travelos_owner;
CREATE SCHEMA audit AUTHORIZATION travelos_owner;
CREATE SCHEMA communications AUTHORIZATION travelos_owner;
CREATE SCHEMA crm AUTHORIZATION travelos_owner;
CREATE SCHEMA documents AUTHORIZATION travelos_owner;
CREATE SCHEMA finance AUTHORIZATION travelos_owner;
CREATE SCHEMA integration AUTHORIZATION travelos_owner;
CREATE SCHEMA job_runtime AUTHORIZATION travelos_owner;
CREATE SCHEMA organization AUTHORIZATION travelos_owner;
CREATE SCHEMA presentation AUTHORIZATION travelos_owner;
CREATE SCHEMA sales AUTHORIZATION travelos_owner;
CREATE SCHEMA staff_access AUTHORIZATION travelos_owner;
CREATE SCHEMA trip_ops AUTHORIZATION travelos_owner;
CREATE SCHEMA work_service AUTHORIZATION travelos_owner;

COMMENT ON SCHEMA activity IS 'Customer-visible operational activity boundary';
COMMENT ON SCHEMA audit IS 'Security and compliance audit boundary';
COMMENT ON SCHEMA communications IS 'Communications capability boundary';
COMMENT ON SCHEMA crm IS 'Customer relationship capability boundary';
COMMENT ON SCHEMA documents IS 'Private document metadata and grant-safe capability boundary';
COMMENT ON SCHEMA finance IS 'Finance capability boundary';
COMMENT ON SCHEMA integration IS 'Transactional integration and outbox boundary';
COMMENT ON SCHEMA job_runtime IS 'PostgreSQL-backed job-runtime boundary';
COMMENT ON SCHEMA organization IS 'Root-Agency and organization capability boundary';
COMMENT ON SCHEMA presentation IS 'Customer-safe immutable presentation/read-model boundary';
COMMENT ON SCHEMA sales IS 'Commercial sales capability boundary';
COMMENT ON SCHEMA staff_access IS 'Physically separate Staff identity and access realm';
COMMENT ON SCHEMA trip_ops IS 'Mutable internal trip-workspace capability boundary';
COMMENT ON SCHEMA work_service IS 'Internal work-service capability boundary';
  `);

  // Better Auth Staff realm (generated independently, reviewed here). The schema-drift verifier
  // `pnpm auth:schema:verify` compares exactly these statements with Better Auth's generated schema.
  pgm.sql(String.raw`
CREATE TABLE "staff_access"."staff_user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  "image" text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "twoFactorEnabled" boolean NOT NULL DEFAULT false
)
  `);
  pgm.sql(String.raw`
CREATE TABLE "staff_access"."staff_session" (
  "id" text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "staff_access"."staff_user" ("id") ON DELETE CASCADE,
  CONSTRAINT "staff_session_id_user_id_unique" UNIQUE ("id", "userId")
)
  `);
  pgm.sql(String.raw`
CREATE TABLE "staff_access"."staff_account" (
  "id" text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "staff_access"."staff_user" ("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL
)
  `);
  pgm.sql(String.raw`
CREATE TABLE "staff_access"."staff_verification" (
  "id" text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
)
  `);
  pgm.sql(String.raw`
CREATE INDEX "staff_session_user_id_idx" ON "staff_access"."staff_session" ("userId")
  `);
  pgm.sql(String.raw`
CREATE INDEX "staff_account_user_id_idx" ON "staff_access"."staff_account" ("userId")
  `);
  pgm.sql(String.raw`
CREATE INDEX "staff_verification_identifier_idx" ON "staff_access"."staff_verification" ("identifier")
  `);
  pgm.sql(String.raw`
CREATE TABLE "staff_access"."staff_two_factor" (
  "id" text PRIMARY KEY,
  "secret" text NOT NULL,
  "backupCodes" text NOT NULL,
  "userId" text NOT NULL UNIQUE REFERENCES "staff_access"."staff_user" ("id") ON DELETE CASCADE,
  "verified" boolean NOT NULL DEFAULT true,
  "failedVerificationCount" integer NOT NULL DEFAULT 0 CHECK ("failedVerificationCount" >= 0),
  "lockedUntil" timestamptz
)
  `);
  pgm.sql(String.raw`
CREATE INDEX "staff_two_factor_secret_idx" ON "staff_access"."staff_two_factor" ("secret")
  `);
  pgm.sql(String.raw`
CREATE INDEX "staff_two_factor_user_id_idx" ON "staff_access"."staff_two_factor" ("userId")
  `);

  // Tables
  pgm.sql(String.raw`
CREATE TABLE activity.entry (
    "agencyId" uuid NOT NULL,
    "messageId" uuid NOT NULL,
    consumer text DEFAULT 'ACTIVITY_V1'::text NOT NULL,
    "tripId" uuid NOT NULL,
    "publicationId" uuid,
    "actorStaffPrincipalId" text,
    "eventType" text NOT NULL,
    "schemaVersion" smallint DEFAULT 1 NOT NULL,
    "occurredAt" timestamp with time zone NOT NULL,
    "projectedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT entry_consumer_check CHECK ((consumer = 'ACTIVITY_V1'::text)),
    CONSTRAINT entry_event_type_check CHECK (("eventType" = 'TRIP_PUBLICATION_PUBLISHED'::text)),
    CONSTRAINT "entry_schemaVersion_check" CHECK (("schemaVersion" = 1))
);

CREATE TABLE activity.lead_entry (
    "entryId" uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "leadId" uuid NOT NULL,
    "auditId" uuid NOT NULL,
    "actorStaffPrincipalId" text NOT NULL,
    "entryType" text NOT NULL,
    "schemaVersion" smallint DEFAULT 1 NOT NULL,
    "occurredAt" timestamp with time zone NOT NULL,
    CONSTRAINT "lead_entry_entryType_check" CHECK (("entryType" = ANY (ARRAY['LEAD_QUALIFIED'::text, 'LEAD_DISQUALIFIED'::text]))),
    CONSTRAINT "lead_entry_schemaVersion_check" CHECK (("schemaVersion" = 1))
);

CREATE TABLE audit.lead_event (
    "auditId" uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "leadId" uuid NOT NULL,
    "actorStaffPrincipalId" text NOT NULL,
    action text NOT NULL,
    "previousLockVersion" bigint NOT NULL,
    "currentLockVersion" bigint NOT NULL,
    "customerId" uuid,
    "disqualificationReason" text,
    "occurredAt" timestamp with time zone DEFAULT date_trunc('milliseconds'::text, clock_timestamp()) NOT NULL,
    CONSTRAINT lead_event_action_check CHECK ((action = ANY (ARRAY['LEAD_QUALIFIED'::text, 'LEAD_DISQUALIFIED'::text]))),
    CONSTRAINT lead_event_action_shape CHECK ((((action = 'LEAD_QUALIFIED'::text) AND ("customerId" IS NOT NULL) AND ("disqualificationReason" IS NULL)) OR ((action = 'LEAD_DISQUALIFIED'::text) AND ("customerId" IS NULL) AND ("disqualificationReason" IS NOT NULL)))),
    CONSTRAINT "lead_event_disqualificationReason_check" CHECK ((("disqualificationReason" IS NULL) OR ("disqualificationReason" = ANY (ARRAY['NO_RESPONSE'::text, 'NOT_INTERESTED'::text, 'NOT_SERVICEABLE'::text, 'DUPLICATE'::text, 'OTHER'::text])))),
    CONSTRAINT "lead_event_previousLockVersion_check" CHECK (("previousLockVersion" >= 1)),
    CONSTRAINT lead_event_version_step CHECK (("currentLockVersion" = ("previousLockVersion" + 1)))
);

CREATE TABLE audit.staff_invitation_event (
    id uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "invitationId" uuid NOT NULL,
    "relatedInvitationId" uuid,
    "actorStaffPrincipalId" text NOT NULL,
    "eventType" text NOT NULL,
    "occurredAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "staff_invitation_event_eventType_check" CHECK (("eventType" = ANY (ARRAY['ISSUED'::text, 'REISSUED'::text, 'REVOKED'::text, 'EXPIRED'::text, 'CONSUMED'::text]))),
    CONSTRAINT staff_invitation_event_shape CHECK (((("eventType" = 'REISSUED'::text) AND ("relatedInvitationId" IS NOT NULL) AND ("relatedInvitationId" <> "invitationId")) OR (("eventType" <> 'REISSUED'::text) AND ("relatedInvitationId" IS NULL))))
);

CREATE TABLE crm.customer (
    id uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "displayName" text NOT NULL,
    "lockVersion" bigint DEFAULT 0 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "customer_displayName_check" CHECK ((length(btrim("displayName")) > 0)),
    CONSTRAINT customer_lock_version_nonnegative CHECK (("lockVersion" >= 0))
);

CREATE TABLE crm.customer_person (
    "agencyId" uuid NOT NULL,
    "customerId" uuid NOT NULL,
    "personId" uuid NOT NULL,
    role text NOT NULL,
    "isPrimary" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT customer_person_role_check CHECK ((role = ANY (ARRAY['PRIMARY_CONTACT'::text, 'TRAVELLER'::text, 'PAYER'::text, 'GUARDIAN'::text])))
);

CREATE TABLE crm.person (
    id uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "givenName" text NOT NULL,
    "familyName" text NOT NULL,
    email text,
    "lockVersion" bigint DEFAULT 0 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "person_familyName_check" CHECK ((length(btrim("familyName")) > 0)),
    CONSTRAINT "person_givenName_check" CHECK ((length(btrim("givenName")) > 0)),
    CONSTRAINT person_lock_version_nonnegative CHECK (("lockVersion" >= 0))
);

CREATE TABLE finance.currency_registry (
    "currencyCode" character varying(3) NOT NULL,
    scale smallint NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    CONSTRAINT currency_registry_scale_check CHECK (((scale >= 0) AND (scale <= 4)))
);

CREATE TABLE finance.supplier_cost_line (
    id uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "tripId" uuid NOT NULL,
    "reservationId" uuid NOT NULL,
    "amountMinor" bigint NOT NULL,
    "currencyCode" character varying(3) NOT NULL,
    "currencyScale" smallint NOT NULL,
    "internalNote" text NOT NULL,
    classification text NOT NULL,
    "lockVersion" bigint DEFAULT 0 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT supplier_cost_amount_currency_shape CHECK ((("currencyCode" IS NOT NULL) AND ("currencyScale" IS NOT NULL))),
    CONSTRAINT supplier_cost_line_classification_check CHECK ((classification = 'INTERNAL_ONLY'::text)),
    CONSTRAINT "supplier_cost_line_internalNote_check" CHECK ((length(btrim("internalNote")) > 0)),
    CONSTRAINT supplier_cost_line_lock_version_nonnegative CHECK (("lockVersion" >= 0))
);

CREATE TABLE integration.event_context (
    "messageId" uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "publicationMessageId" uuid NOT NULL,
    "correlationId" uuid NOT NULL,
    traceparent text,
    CONSTRAINT event_context_publication_message_check CHECK (("messageId" = "publicationMessageId")),
    CONSTRAINT event_context_traceparent_check CHECK (((traceparent ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$'::text) AND ("substring"(traceparent, 4, 32) <> repeat('0'::text, 32)) AND ("substring"(traceparent, 37, 16) <> repeat('0'::text, 16))))
);

CREATE TABLE integration.lead_outbox (
    "messageId" uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "leadId" uuid NOT NULL,
    "auditId" uuid NOT NULL,
    "messageType" text NOT NULL,
    "schemaVersion" smallint DEFAULT 1 NOT NULL,
    "leadLockVersion" bigint NOT NULL,
    "createdAt" timestamp with time zone DEFAULT date_trunc('milliseconds'::text, clock_timestamp()) NOT NULL,
    CONSTRAINT "lead_outbox_leadLockVersion_check" CHECK (("leadLockVersion" >= 2)),
    CONSTRAINT "lead_outbox_messageType_check" CHECK (("messageType" = ANY (ARRAY['LeadQualified'::text, 'LeadDisqualified'::text]))),
    CONSTRAINT "lead_outbox_schemaVersion_check" CHECK (("schemaVersion" = 1))
);

CREATE TABLE integration.outbox_delivery (
    "messageId" uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    consumer text DEFAULT 'ACTIVITY_V1'::text NOT NULL,
    "publicationMessageId" uuid NOT NULL,
    state text DEFAULT 'PENDING'::text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    "completedAt" timestamp with time zone,
    CONSTRAINT outbox_delivery_check1 CHECK (((state = 'PENDING'::text) = ("completedAt" IS NULL))),
    CONSTRAINT outbox_delivery_consumer_check CHECK ((consumer = 'ACTIVITY_V1'::text)),
    CONSTRAINT outbox_delivery_publication_message_check CHECK (("messageId" = "publicationMessageId")),
    CONSTRAINT outbox_delivery_state_check CHECK ((state = ANY (ARRAY['PENDING'::text, 'SUCCEEDED'::text, 'DEAD_LETTER'::text, 'UNKNOWN_OUTCOME'::text])))
);

CREATE TABLE integration.trip_publication_outbox (
    "messageId" uuid NOT NULL,
    "eventId" uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "tripId" uuid NOT NULL,
    "publicationId" uuid NOT NULL,
    version integer NOT NULL,
    "eventType" text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "trip_publication_outbox_eventType_check" CHECK (("eventType" = 'TRIP_PUBLICATION_PUBLISHED'::text))
);

CREATE TABLE job_runtime.attempt (
    "agencyId" uuid NOT NULL,
    "messageId" uuid NOT NULL,
    consumer text DEFAULT 'ACTIVITY_V1'::text NOT NULL,
    attempt integer NOT NULL,
    owner uuid NOT NULL,
    outcome text NOT NULL,
    "errorCode" text,
    "finishedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT attempt_attempt_check CHECK (((attempt >= 1) AND (attempt <= 5))),
    CONSTRAINT "attempt_errorCode_check" CHECK (("errorCode" = ANY (ARRAY['TEMPORARY'::text, 'PERMANENT'::text, 'UNKNOWN_OUTCOME'::text, 'LEASE_EXPIRED'::text]))),
    CONSTRAINT attempt_outcome_check CHECK ((outcome = ANY (ARRAY['SUCCEEDED'::text, 'RETRY'::text, 'DEAD_LETTER'::text, 'UNKNOWN_OUTCOME'::text])))
);

CREATE TABLE job_runtime.job (
    "messageId" uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    consumer text DEFAULT 'ACTIVITY_V1'::text NOT NULL,
    state text DEFAULT 'PENDING'::text NOT NULL,
    attempt integer DEFAULT 0 NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    "runAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    owner uuid,
    "leaseUntil" timestamp with time zone,
    deadline timestamp with time zone,
    "errorCode" text,
    CONSTRAINT job_attempt_check CHECK (((attempt >= 0) AND (attempt <= 5))),
    CONSTRAINT job_check CHECK ((((state = 'RUNNING'::text) AND (owner IS NOT NULL) AND ("leaseUntil" IS NOT NULL) AND (deadline IS NOT NULL) AND (attempt > 0) AND ("leaseUntil" <= deadline)) OR ((state <> 'RUNNING'::text) AND (owner IS NULL) AND ("leaseUntil" IS NULL) AND (deadline IS NULL)))),
    CONSTRAINT job_consumer_check CHECK ((consumer = 'ACTIVITY_V1'::text)),
    CONSTRAINT "job_errorCode_check" CHECK (("errorCode" = ANY (ARRAY['TEMPORARY'::text, 'PERMANENT'::text, 'UNKNOWN_OUTCOME'::text, 'LEASE_EXPIRED'::text]))),
    CONSTRAINT job_state_check CHECK ((state = ANY (ARRAY['PENDING'::text, 'RUNNING'::text, 'RETRY'::text, 'SUCCEEDED'::text, 'DEAD_LETTER'::text, 'UNKNOWN_OUTCOME'::text]))),
    CONSTRAINT job_version_check CHECK ((version >= 0))
);

CREATE TABLE organization.agency (
    id uuid NOT NULL,
    "bootstrapReference" text NOT NULL,
    slug text NOT NULL,
    "isRoot" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lockVersion" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "agency_isRoot_check" CHECK ("isRoot"),
    CONSTRAINT "agency_lockVersion_check" CHECK (("lockVersion" > 0))
);

CREATE TABLE organization.agency_bootstrap_audit (
    id uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "eventType" text NOT NULL,
    "operatorIdentity" text NOT NULL,
    "occurredAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "agency_bootstrap_audit_eventType_check" CHECK (("eventType" = ANY (ARRAY['ROOT_AGENCY_CREATED'::text, 'ROOT_AGENCY_RERUN'::text])))
);

CREATE TABLE presentation.agency_publication_visibility (
    "agencyId" uuid NOT NULL,
    "fieldKey" text NOT NULL,
    "visibilityChoice" text NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "agency_publication_visibility_fieldKey_check" CHECK (("fieldKey" = ANY (ARRAY['flight.description'::text, 'flight.terminal'::text, 'flight.cabin'::text, 'flight.baggage'::text, 'flight.seat'::text, 'flight.customerBookingReference'::text, 'accommodation.description'::text, 'accommodation.roomDescription'::text, 'accommodation.boardType'::text, 'accommodation.customerBookingReference'::text]))),
    CONSTRAINT "agency_publication_visibility_visibilityChoice_check" CHECK (("visibilityChoice" = ANY (ARRAY['INHERIT'::text, 'SHOW'::text, 'HIDE'::text])))
);

CREATE TABLE presentation.item_publication_visibility (
    "agencyId" uuid NOT NULL,
    "tripId" uuid NOT NULL,
    "itemId" uuid NOT NULL,
    "fieldKey" text NOT NULL,
    "visibilityChoice" text NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "item_publication_visibility_fieldKey_check" CHECK (("fieldKey" = ANY (ARRAY['flight.description'::text, 'flight.terminal'::text, 'flight.cabin'::text, 'flight.baggage'::text, 'flight.seat'::text, 'flight.customerBookingReference'::text, 'accommodation.description'::text, 'accommodation.roomDescription'::text, 'accommodation.boardType'::text, 'accommodation.customerBookingReference'::text]))),
    CONSTRAINT "item_publication_visibility_visibilityChoice_check" CHECK (("visibilityChoice" = ANY (ARRAY['INHERIT'::text, 'SHOW'::text, 'HIDE'::text])))
);

CREATE TABLE sales.lead (
    id uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    source text NOT NULL,
    "contactGivenName" text NOT NULL,
    "contactFamilyName" text NOT NULL,
    "contactEmail" text,
    "contactPhone" text,
    "internalNote" text,
    state text NOT NULL,
    "qualifiedCustomerId" uuid,
    "disqualificationReason" text,
    "lockVersion" bigint DEFAULT 1 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT date_trunc('milliseconds'::text, clock_timestamp()) NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT date_trunc('milliseconds'::text, clock_timestamp()) NOT NULL,
    "closedAt" timestamp with time zone,
    CONSTRAINT lead_contact_email_shape CHECK ((("contactEmail" IS NULL) OR ((length("contactEmail") <= 320) AND ("contactEmail" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'::text)))),
    CONSTRAINT lead_contact_family_name_shape CHECK (((length(btrim("contactFamilyName")) >= 1) AND (length(btrim("contactFamilyName")) <= 200))),
    CONSTRAINT lead_contact_given_name_shape CHECK (((length(btrim("contactGivenName")) >= 1) AND (length(btrim("contactGivenName")) <= 200))),
    CONSTRAINT lead_contact_phone_shape CHECK ((("contactPhone" IS NULL) OR (((length("contactPhone") >= 1) AND (length("contactPhone") <= 40)) AND ("contactPhone" ~ '^[0-9 +()-]+$'::text) AND (length(btrim("contactPhone")) > 0)))),
    CONSTRAINT lead_disqualification_reason_domain CHECK ((("disqualificationReason" IS NULL) OR ("disqualificationReason" = ANY (ARRAY['NO_RESPONSE'::text, 'NOT_INTERESTED'::text, 'NOT_SERVICEABLE'::text, 'DUPLICATE'::text, 'OTHER'::text])))),
    CONSTRAINT lead_disqualified_iff_reason CHECK (((state = 'DISQUALIFIED'::text) = ("disqualificationReason" IS NOT NULL))),
    CONSTRAINT lead_internal_note_shape CHECK ((("internalNote" IS NULL) OR ((length("internalNote") <= 4000) AND (length(btrim("internalNote")) > 0)))),
    CONSTRAINT lead_lock_version_positive CHECK (("lockVersion" >= 1)),
    CONSTRAINT lead_open_iff_not_closed CHECK (((state = 'OPEN'::text) = ("closedAt" IS NULL))),
    CONSTRAINT lead_qualified_iff_customer CHECK (((state = 'QUALIFIED'::text) = ("qualifiedCustomerId" IS NOT NULL))),
    CONSTRAINT lead_source_domain CHECK ((source = ANY (ARRAY['WEBSITE'::text, 'PHONE'::text, 'EMAIL'::text, 'REFERRAL'::text, 'WALK_IN'::text, 'OTHER'::text]))),
    CONSTRAINT lead_state_domain CHECK ((state = ANY (ARRAY['OPEN'::text, 'QUALIFIED'::text, 'DISQUALIFIED'::text]))),
    CONSTRAINT lead_updated_not_before_created CHECK (("updatedAt" >= "createdAt"))
);

CREATE TABLE sales.lead_idempotency (
    "agencyId" uuid NOT NULL,
    "staffPrincipalId" text NOT NULL,
    command text NOT NULL,
    "idempotencyKey" text NOT NULL,
    "leadId" uuid NOT NULL,
    "requestHash" character(64) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT date_trunc('milliseconds'::text, clock_timestamp()) NOT NULL,
    CONSTRAINT lead_idempotency_command_check CHECK ((command = ANY (ARRAY['lead.create'::text, 'lead.qualify'::text, 'lead.disqualify'::text]))),
    CONSTRAINT "lead_idempotency_idempotencyKey_check" CHECK (((length("idempotencyKey") >= 1) AND (length("idempotencyKey") <= 128))),
    CONSTRAINT "lead_idempotency_requestHash_check" CHECK (("requestHash" ~ '^[0-9a-f]{64}$'::text))
);

CREATE TABLE staff_access.operator_bootstrap_audit (
    id uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "invitationId" uuid NOT NULL,
    "eventType" text NOT NULL,
    "operatorIdentity" text NOT NULL,
    "occurredAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "operator_bootstrap_audit_eventType_check" CHECK (("eventType" = ANY (ARRAY['OWNER_INVITATION_ISSUED'::text, 'OWNER_INVITATION_REISSUED'::text, 'OWNER_INVITATION_CONSUMED'::text, 'OWNER_INVITATION_REJECTED'::text])))
);

CREATE TABLE staff_access.operator_bootstrap_invitation (
    id uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "targetEmail" text NOT NULL,
    "tokenDigest" character(64) NOT NULL,
    state text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "consumedAt" timestamp with time zone,
    "staffPrincipalId" text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT operator_bootstrap_consumed_state CHECK ((((state = 'CONSUMED'::text) AND ("consumedAt" IS NOT NULL) AND ("staffPrincipalId" IS NOT NULL)) OR ((state <> 'CONSUMED'::text) AND ("consumedAt" IS NULL) AND ("staffPrincipalId" IS NULL)))),
    CONSTRAINT operator_bootstrap_invitation_state_check CHECK ((state = ANY (ARRAY['PENDING'::text, 'CONSUMED'::text, 'EXPIRED'::text])))
);

CREATE TABLE staff_access.role (
    id uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "templateKey" text,
    "displayName" text NOT NULL,
    "isSystemTemplate" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lockVersion" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "role_lockVersion_check" CHECK (("lockVersion" > 0)),
    CONSTRAINT role_system_template_key CHECK ((("isSystemTemplate" AND ("templateKey" IS NOT NULL)) OR (NOT "isSystemTemplate")))
);

CREATE TABLE staff_access.role_assignment (
    id uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "membershipId" uuid NOT NULL,
    "roleId" uuid NOT NULL,
    "scopeKind" text NOT NULL,
    "organizationUnitId" uuid,
    active boolean DEFAULT true NOT NULL,
    "assignedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "revokedAt" timestamp with time zone,
    CONSTRAINT role_assignment_revocation_state CHECK (((active AND ("revokedAt" IS NULL)) OR ((NOT active) AND ("revokedAt" IS NOT NULL)))),
    CONSTRAINT "role_assignment_scopeKind_check" CHECK (("scopeKind" = ANY (ARRAY['AGENCY'::text, 'ORGANIZATION_UNIT'::text]))),
    CONSTRAINT role_assignment_scope_shape CHECK (((("scopeKind" = 'AGENCY'::text) AND ("organizationUnitId" IS NULL)) OR (("scopeKind" = 'ORGANIZATION_UNIT'::text) AND ("organizationUnitId" IS NOT NULL))))
);

CREATE TABLE staff_access.role_permission (
    "roleId" uuid NOT NULL,
    "permissionId" text NOT NULL,
    "scopeKind" text NOT NULL,
    "accessLevel" text NOT NULL,
    CONSTRAINT "role_permission_accessLevel_check" CHECK (("accessLevel" = ANY (ARRAY['OWN'::text, 'TEAM'::text, 'ALL'::text]))),
    CONSTRAINT "role_permission_scopeKind_check" CHECK (("scopeKind" = ANY (ARRAY['AGENCY'::text, 'ORGANIZATION_UNIT'::text])))
);

CREATE TABLE staff_access.staff_invitation (
    id uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "targetEmail" text NOT NULL,
    "roleId" uuid NOT NULL,
    "tokenDigest" text NOT NULL,
    status text NOT NULL,
    "createdByStaffPrincipalId" text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "consumedStaffPrincipalId" text,
    "consumedAt" timestamp with time zone,
    "revokedAt" timestamp with time zone,
    CONSTRAINT staff_invitation_expiry_after_creation CHECK (("expiresAt" > "createdAt")),
    CONSTRAINT staff_invitation_lifecycle_shape CHECK ((((status = ANY (ARRAY['PENDING'::text, 'EXPIRED'::text])) AND ("consumedStaffPrincipalId" IS NULL) AND ("consumedAt" IS NULL) AND ("revokedAt" IS NULL)) OR ((status = 'CONSUMED'::text) AND ("consumedStaffPrincipalId" IS NOT NULL) AND ("consumedAt" IS NOT NULL) AND ("revokedAt" IS NULL)) OR ((status = 'REVOKED'::text) AND ("consumedStaffPrincipalId" IS NULL) AND ("consumedAt" IS NULL) AND ("revokedAt" IS NOT NULL)))),
    CONSTRAINT staff_invitation_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'CONSUMED'::text, 'REVOKED'::text, 'EXPIRED'::text]))),
    CONSTRAINT "staff_invitation_targetEmail_check" CHECK ((((length("targetEmail") >= 3) AND (length("targetEmail") <= 320)) AND ("targetEmail" = btrim("targetEmail")) AND ("targetEmail" = lower("targetEmail")))),
    CONSTRAINT "staff_invitation_tokenDigest_check" CHECK (("tokenDigest" ~ '^[0-9a-f]{64}$'::text))
);

CREATE TABLE staff_access.staff_membership (
    id uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "staffPrincipalId" text NOT NULL,
    state text NOT NULL,
    "authorizationEpoch" bigint DEFAULT 1 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "revokedAt" timestamp with time zone,
    CONSTRAINT "staff_membership_authorizationEpoch_check" CHECK (("authorizationEpoch" > 0)),
    CONSTRAINT staff_membership_revocation_state CHECK ((((state = 'REVOKED'::text) AND ("revokedAt" IS NOT NULL)) OR ((state <> 'REVOKED'::text) AND ("revokedAt" IS NULL)))),
    CONSTRAINT staff_membership_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'DISABLED'::text, 'REVOKED'::text])))
);

CREATE TABLE staff_access.staff_session_context (
    "sessionId" text NOT NULL,
    "staffPrincipalId" text NOT NULL,
    "agencyId" uuid NOT NULL,
    "authorizationEpoch" bigint NOT NULL,
    "recentMfaVerifiedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "staff_session_context_authorizationEpoch_check" CHECK (("authorizationEpoch" > 0))
);

CREATE TABLE trip_ops.accommodation_item_detail (
    "agencyId" uuid NOT NULL,
    "tripId" uuid NOT NULL,
    "itemId" uuid NOT NULL,
    "propertyName" text NOT NULL,
    "checkInDate" date NOT NULL,
    "checkInTime" time without time zone NOT NULL,
    "checkInTimezone" text NOT NULL,
    "checkInInstant" timestamp with time zone NOT NULL,
    "checkOutDate" date NOT NULL,
    "checkOutTime" time without time zone NOT NULL,
    "checkOutTimezone" text NOT NULL,
    "checkOutInstant" timestamp with time zone NOT NULL,
    "roomDescription" text,
    "boardType" text,
    CONSTRAINT accommodation_check_instant_calendar_policy CHECK ((("checkInInstant" >= '1000-01-01 00:00:00+00'::timestamp with time zone) AND ("checkInInstant" < '10000-01-01 00:00:00+00'::timestamp with time zone))),
    CONSTRAINT accommodation_check_out_instant_calendar_policy CHECK ((("checkOutInstant" >= '1000-01-01 00:00:00+00'::timestamp with time zone) AND ("checkOutInstant" < '10000-01-01 00:00:00+00'::timestamp with time zone))),
    CONSTRAINT accommodation_instant_precision_policy CHECK ((("checkInInstant" = date_trunc('milliseconds'::text, "checkInInstant")) AND ("checkOutInstant" = date_trunc('milliseconds'::text, "checkOutInstant")))),
    CONSTRAINT "accommodation_item_detail_propertyName_check" CHECK ((length(btrim("propertyName")) > 0)),
    CONSTRAINT accommodation_local_date_policy CHECK (((("checkInDate" >= '1000-01-01'::date) AND ("checkInDate" <= '9999-12-31'::date)) AND (("checkOutDate" >= '1000-01-01'::date) AND ("checkOutDate" <= '9999-12-31'::date)))),
    CONSTRAINT accommodation_local_time_policy CHECK ((("checkInTime" < '24:00:00'::time without time zone) AND ("checkOutTime" < '24:00:00'::time without time zone) AND (("checkInTime")::interval = date_trunc('second'::text, ("checkInTime")::interval)) AND (("checkOutTime")::interval = date_trunc('second'::text, ("checkOutTime")::interval)))),
    CONSTRAINT accommodation_time_order CHECK (("checkInInstant" < "checkOutInstant"))
);

CREATE TABLE trip_ops.flight_item_detail (
    "agencyId" uuid NOT NULL,
    "tripId" uuid NOT NULL,
    "itemId" uuid NOT NULL,
    carrier text NOT NULL,
    "flightNumber" text NOT NULL,
    "departureAirport" character varying(3) NOT NULL,
    "arrivalAirport" character varying(3) NOT NULL,
    "departureDate" date NOT NULL,
    "departureTime" time without time zone NOT NULL,
    "departureTimezone" text NOT NULL,
    "departureInstant" timestamp with time zone NOT NULL,
    "arrivalDate" date NOT NULL,
    "arrivalTime" time without time zone NOT NULL,
    "arrivalTimezone" text NOT NULL,
    "arrivalInstant" timestamp with time zone NOT NULL,
    terminal text,
    cabin text,
    baggage text,
    seat text,
    "operationalStatus" text DEFAULT 'SCHEDULED'::text NOT NULL,
    CONSTRAINT flight_airports_differ CHECK ((upper(("departureAirport")::text) <> upper(("arrivalAirport")::text))),
    CONSTRAINT flight_arrival_instant_calendar_policy CHECK ((("arrivalInstant" >= '1000-01-01 00:00:00+00'::timestamp with time zone) AND ("arrivalInstant" < '10000-01-01 00:00:00+00'::timestamp with time zone))),
    CONSTRAINT flight_departure_instant_calendar_policy CHECK ((("departureInstant" >= '1000-01-01 00:00:00+00'::timestamp with time zone) AND ("departureInstant" < '10000-01-01 00:00:00+00'::timestamp with time zone))),
    CONSTRAINT flight_instant_precision_policy CHECK ((("departureInstant" = date_trunc('milliseconds'::text, "departureInstant")) AND ("arrivalInstant" = date_trunc('milliseconds'::text, "arrivalInstant")))),
    CONSTRAINT "flight_item_detail_arrivalAirport_check" CHECK ((length(btrim(("arrivalAirport")::text)) = 3)),
    CONSTRAINT flight_item_detail_carrier_check CHECK ((length(btrim(carrier)) > 0)),
    CONSTRAINT "flight_item_detail_departureAirport_check" CHECK ((length(btrim(("departureAirport")::text)) = 3)),
    CONSTRAINT "flight_item_detail_flightNumber_check" CHECK ((length(btrim("flightNumber")) > 0)),
    CONSTRAINT "flight_item_detail_operationalStatus_check" CHECK (("operationalStatus" = ANY (ARRAY['SCHEDULED'::text, 'CONFIRMED'::text, 'CANCELLED'::text]))),
    CONSTRAINT flight_local_date_policy CHECK (((("departureDate" >= '1000-01-01'::date) AND ("departureDate" <= '9999-12-31'::date)) AND (("arrivalDate" >= '1000-01-01'::date) AND ("arrivalDate" <= '9999-12-31'::date)))),
    CONSTRAINT flight_local_time_policy CHECK ((("departureTime" < '24:00:00'::time without time zone) AND ("arrivalTime" < '24:00:00'::time without time zone) AND (("departureTime")::interval = date_trunc('second'::text, ("departureTime")::interval)) AND (("arrivalTime")::interval = date_trunc('second'::text, ("arrivalTime")::interval)))),
    CONSTRAINT flight_time_order CHECK (("departureInstant" < "arrivalInstant"))
);

CREATE TABLE trip_ops.itinerary_item (
    id uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "tripId" uuid NOT NULL,
    family text NOT NULL,
    state text NOT NULL,
    "sortOrder" integer NOT NULL,
    "customerTitle" text NOT NULL,
    "customerDescription" text NOT NULL,
    "customerBookingReference" text,
    "lockVersion" bigint DEFAULT 0 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "itinerary_item_customerDescription_check" CHECK ((length(btrim("customerDescription")) > 0)),
    CONSTRAINT "itinerary_item_customerTitle_check" CHECK ((length(btrim("customerTitle")) > 0)),
    CONSTRAINT itinerary_item_family_check CHECK ((family = ANY (ARRAY['FLIGHT'::text, 'ACCOMMODATION'::text]))),
    CONSTRAINT itinerary_item_lock_version_nonnegative CHECK (("lockVersion" >= 0)),
    CONSTRAINT "itinerary_item_sortOrder_check" CHECK (("sortOrder" > 0)),
    CONSTRAINT itinerary_item_state_check CHECK ((state = ANY (ARRAY['DRAFT'::text, 'CONFIRMED'::text, 'CANCELLED'::text])))
);

CREATE TABLE trip_ops.publication_event (
    "eventId" uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "tripId" uuid NOT NULL,
    "publicationId" uuid NOT NULL,
    version integer NOT NULL,
    "eventType" text NOT NULL,
    "actorStaffPrincipalId" text NOT NULL,
    "occurredAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "publication_event_eventType_check" CHECK (("eventType" = 'TRIP_PUBLICATION_PUBLISHED'::text))
);

CREATE TABLE trip_ops.publication_lock (
    "agencyId" uuid NOT NULL,
    "tripId" uuid NOT NULL,
    generation bigint DEFAULT 0 NOT NULL,
    CONSTRAINT publication_lock_generation_check CHECK ((generation >= 0))
);

CREATE TABLE trip_ops.publication_snapshot (
    "publicationId" uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "tripId" uuid NOT NULL,
    "canonicalPayload" text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "publication_snapshot_canonicalPayload_check" CHECK ((jsonb_typeof(("canonicalPayload")::jsonb) = 'object'::text))
);

CREATE TABLE trip_ops.publication_version (
    "publicationId" uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "tripId" uuid NOT NULL,
    version integer NOT NULL,
    "workspaceRevision" bigint NOT NULL,
    "schemaVersion" smallint NOT NULL,
    "projectionHash" character(64) NOT NULL,
    "publisherStaffPrincipalId" text NOT NULL,
    "assuranceVerifiedAt" timestamp with time zone NOT NULL,
    "publishedAt" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "publication_version_projectionHash_check" CHECK (("projectionHash" ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT "publication_version_schemaVersion_check" CHECK (("schemaVersion" = 1)),
    CONSTRAINT publication_version_version_check CHECK ((version > 0)),
    CONSTRAINT "publication_version_workspaceRevision_check" CHECK (("workspaceRevision" >= 0))
);

CREATE TABLE trip_ops.reservation (
    id uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "tripId" uuid NOT NULL,
    "supplierName" text NOT NULL,
    "supplierReference" text NOT NULL,
    "customerBookingReference" text,
    state text NOT NULL,
    "lockVersion" bigint DEFAULT 0 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT reservation_lock_version_nonnegative CHECK (("lockVersion" >= 0)),
    CONSTRAINT reservation_state_check CHECK ((state = ANY (ARRAY['PROVISIONAL'::text, 'HELD'::text, 'CONFIRMED'::text, 'USED'::text, 'CANCELLED'::text, 'FAILED'::text]))),
    CONSTRAINT "reservation_supplierName_check" CHECK ((length(btrim("supplierName")) > 0)),
    CONSTRAINT "reservation_supplierReference_check" CHECK ((length(btrim("supplierReference")) > 0))
);

CREATE TABLE trip_ops.reservation_item_link (
    "agencyId" uuid NOT NULL,
    "tripId" uuid NOT NULL,
    "reservationId" uuid NOT NULL,
    "itineraryItemId" uuid NOT NULL,
    "linkRole" text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "reservation_item_link_linkRole_check" CHECK (("linkRole" = ANY (ARRAY['PRIMARY'::text, 'SECONDARY'::text])))
);

CREATE TABLE trip_ops.share_link (
    "shareLinkId" uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "tripId" uuid NOT NULL,
    "publicationId" uuid NOT NULL,
    "tokenHash" bytea NOT NULL,
    "createdByStaffPrincipalId" text NOT NULL,
    "idempotencyKey" text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "revokedAt" timestamp with time zone,
    CONSTRAINT share_link_expiry_check CHECK ((("expiresAt" > "createdAt") AND ("expiresAt" <= ("createdAt" + '366 days'::interval)))),
    CONSTRAINT "share_link_idempotencyKey_check" CHECK (((length("idempotencyKey") >= 1) AND (length("idempotencyKey") <= 128))),
    CONSTRAINT "share_link_tokenHash_check" CHECK ((octet_length("tokenHash") = 32))
);

CREATE TABLE trip_ops.trip (
    id uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    title text NOT NULL,
    "startDate" date NOT NULL,
    "endDate" date NOT NULL,
    state text NOT NULL,
    "workspaceRevision" bigint DEFAULT 0 NOT NULL,
    "lockVersion" bigint DEFAULT 0 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT trip_date_order CHECK (("startDate" <= "endDate")),
    CONSTRAINT trip_date_policy CHECK (((("startDate" >= '1000-01-01'::date) AND ("startDate" <= '9999-12-31'::date)) AND (("endDate" >= '1000-01-01'::date) AND ("endDate" <= '9999-12-31'::date)))),
    CONSTRAINT trip_lock_version_nonnegative CHECK (("lockVersion" >= 0)),
    CONSTRAINT trip_state_check CHECK ((state = ANY (ARRAY['DRAFT'::text, 'CONFIRMED'::text, 'IN_OPERATION'::text, 'COMPLETED'::text, 'CANCELLED'::text]))),
    CONSTRAINT trip_title_check CHECK ((length(btrim(title)) > 0)),
    CONSTRAINT "trip_workspaceRevision_check" CHECK (("workspaceRevision" >= 0))
);

CREATE TABLE trip_ops.trip_traveller (
    id uuid NOT NULL,
    "agencyId" uuid NOT NULL,
    "tripId" uuid NOT NULL,
    "personId" uuid NOT NULL,
    role text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT trip_traveller_role_check CHECK ((role = ANY (ARRAY['PRIMARY_TRAVELLER'::text, 'TRAVELLER'::text, 'PAYER'::text])))
);

CREATE TABLE trip_ops.workspace_revision_touch (
    "agencyId" uuid NOT NULL,
    "tripId" uuid NOT NULL,
    "lastTransactionId" xid8 NOT NULL
);
  `);

  // Primary keys and unique constraints
  pgm.sql(String.raw`
ALTER TABLE ONLY activity.entry
    ADD CONSTRAINT entry_pkey PRIMARY KEY ("agencyId", "messageId", consumer);

ALTER TABLE ONLY activity.lead_entry
    ADD CONSTRAINT lead_entry_audit_unique UNIQUE ("auditId");

ALTER TABLE ONLY activity.lead_entry
    ADD CONSTRAINT lead_entry_pkey PRIMARY KEY ("entryId");

ALTER TABLE ONLY audit.lead_event
    ADD CONSTRAINT lead_event_auditid_agency_unique UNIQUE ("auditId", "agencyId");

ALTER TABLE ONLY audit.lead_event
    ADD CONSTRAINT lead_event_pkey PRIMARY KEY ("auditId");

ALTER TABLE ONLY audit.lead_event
    ADD CONSTRAINT lead_event_unique_action_per_lead UNIQUE ("agencyId", "leadId");

ALTER TABLE ONLY audit.staff_invitation_event
    ADD CONSTRAINT staff_invitation_event_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.customer
    ADD CONSTRAINT customer_id_agency_unique UNIQUE (id, "agencyId");

ALTER TABLE ONLY crm.customer
    ADD CONSTRAINT customer_pkey PRIMARY KEY (id);

ALTER TABLE ONLY crm.customer_person
    ADD CONSTRAINT customer_person_pkey PRIMARY KEY ("agencyId", "customerId", "personId", role);

ALTER TABLE ONLY crm.person
    ADD CONSTRAINT person_id_agency_unique UNIQUE (id, "agencyId");

ALTER TABLE ONLY crm.person
    ADD CONSTRAINT person_pkey PRIMARY KEY (id);

ALTER TABLE ONLY finance.currency_registry
    ADD CONSTRAINT currency_registry_code_scale_unique UNIQUE ("currencyCode", scale);

ALTER TABLE ONLY finance.currency_registry
    ADD CONSTRAINT currency_registry_pkey PRIMARY KEY ("currencyCode");

ALTER TABLE ONLY finance.supplier_cost_line
    ADD CONSTRAINT supplier_cost_id_trip_unique UNIQUE (id, "tripId", "agencyId");

ALTER TABLE ONLY finance.supplier_cost_line
    ADD CONSTRAINT supplier_cost_line_pkey PRIMARY KEY (id);

ALTER TABLE ONLY finance.supplier_cost_line
    ADD CONSTRAINT supplier_cost_reservation_singleton UNIQUE ("agencyId", "tripId", "reservationId");

ALTER TABLE ONLY integration.event_context
    ADD CONSTRAINT event_context_pkey PRIMARY KEY ("agencyId", "messageId");

ALTER TABLE ONLY integration.lead_outbox
    ADD CONSTRAINT lead_outbox_audit_unique UNIQUE ("auditId");

ALTER TABLE ONLY integration.lead_outbox
    ADD CONSTRAINT lead_outbox_pkey PRIMARY KEY ("messageId");

ALTER TABLE ONLY integration.outbox_delivery
    ADD CONSTRAINT outbox_delivery_pkey PRIMARY KEY ("agencyId", "messageId", consumer);

ALTER TABLE ONLY integration.trip_publication_outbox
    ADD CONSTRAINT "trip_publication_outbox_eventId_key" UNIQUE ("eventId");

ALTER TABLE ONLY integration.trip_publication_outbox
    ADD CONSTRAINT trip_publication_outbox_pkey PRIMARY KEY ("messageId");

ALTER TABLE ONLY job_runtime.attempt
    ADD CONSTRAINT attempt_pkey PRIMARY KEY ("agencyId", "messageId", consumer, attempt);

ALTER TABLE ONLY job_runtime.job
    ADD CONSTRAINT job_pkey PRIMARY KEY ("agencyId", "messageId", consumer);

ALTER TABLE ONLY organization.agency
    ADD CONSTRAINT "agency_bootstrapReference_key" UNIQUE ("bootstrapReference");

ALTER TABLE ONLY organization.agency
    ADD CONSTRAINT agency_pkey PRIMARY KEY (id);

ALTER TABLE ONLY organization.agency
    ADD CONSTRAINT agency_slug_key UNIQUE (slug);

ALTER TABLE ONLY organization.agency_bootstrap_audit
    ADD CONSTRAINT agency_bootstrap_audit_pkey PRIMARY KEY (id);

ALTER TABLE ONLY presentation.agency_publication_visibility
    ADD CONSTRAINT agency_publication_visibility_pkey PRIMARY KEY ("agencyId", "fieldKey");

ALTER TABLE ONLY presentation.item_publication_visibility
    ADD CONSTRAINT item_publication_visibility_pkey PRIMARY KEY ("agencyId", "tripId", "itemId", "fieldKey");

ALTER TABLE ONLY sales.lead
    ADD CONSTRAINT lead_id_agency_unique UNIQUE (id, "agencyId");

ALTER TABLE ONLY sales.lead
    ADD CONSTRAINT lead_pkey PRIMARY KEY (id);

ALTER TABLE ONLY sales.lead_idempotency
    ADD CONSTRAINT lead_idempotency_pkey PRIMARY KEY ("agencyId", "staffPrincipalId", command, "idempotencyKey");

ALTER TABLE ONLY staff_access.operator_bootstrap_audit
    ADD CONSTRAINT operator_bootstrap_audit_pkey PRIMARY KEY (id);

ALTER TABLE ONLY staff_access.operator_bootstrap_invitation
    ADD CONSTRAINT "operator_bootstrap_invitation_agencyId_key" UNIQUE ("agencyId");

ALTER TABLE ONLY staff_access.operator_bootstrap_invitation
    ADD CONSTRAINT operator_bootstrap_invitation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY staff_access.operator_bootstrap_invitation
    ADD CONSTRAINT "operator_bootstrap_invitation_tokenDigest_key" UNIQUE ("tokenDigest");

ALTER TABLE ONLY staff_access.role
    ADD CONSTRAINT role_id_agency_unique UNIQUE (id, "agencyId");

ALTER TABLE ONLY staff_access.role
    ADD CONSTRAINT role_pkey PRIMARY KEY (id);

ALTER TABLE ONLY staff_access.role
    ADD CONSTRAINT role_unique_agency_display_name UNIQUE ("agencyId", "displayName");

ALTER TABLE ONLY staff_access.role_assignment
    ADD CONSTRAINT role_assignment_pkey PRIMARY KEY (id);

ALTER TABLE ONLY staff_access.role_permission
    ADD CONSTRAINT role_permission_pkey PRIMARY KEY ("roleId", "permissionId", "scopeKind", "accessLevel");

ALTER TABLE ONLY staff_access.staff_invitation
    ADD CONSTRAINT staff_invitation_id_agency_unique UNIQUE ("agencyId", id);

ALTER TABLE ONLY staff_access.staff_invitation
    ADD CONSTRAINT staff_invitation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY staff_access.staff_invitation
    ADD CONSTRAINT "staff_invitation_tokenDigest_key" UNIQUE ("tokenDigest");

ALTER TABLE ONLY staff_access.staff_membership
    ADD CONSTRAINT staff_membership_id_agency_unique UNIQUE (id, "agencyId");

ALTER TABLE ONLY staff_access.staff_membership
    ADD CONSTRAINT staff_membership_pkey PRIMARY KEY (id);

ALTER TABLE ONLY staff_access.staff_membership
    ADD CONSTRAINT staff_membership_unique_agency_principal UNIQUE ("agencyId", "staffPrincipalId");

ALTER TABLE ONLY staff_access.staff_session_context
    ADD CONSTRAINT staff_session_context_pkey PRIMARY KEY ("sessionId");

ALTER TABLE ONLY trip_ops.accommodation_item_detail
    ADD CONSTRAINT accommodation_item_detail_pkey PRIMARY KEY ("agencyId", "tripId", "itemId");

ALTER TABLE ONLY trip_ops.flight_item_detail
    ADD CONSTRAINT flight_item_detail_pkey PRIMARY KEY ("agencyId", "tripId", "itemId");

ALTER TABLE ONLY trip_ops.itinerary_item
    ADD CONSTRAINT itinerary_item_id_trip_agency_unique UNIQUE (id, "tripId", "agencyId");

ALTER TABLE ONLY trip_ops.itinerary_item
    ADD CONSTRAINT itinerary_item_pkey PRIMARY KEY (id);

ALTER TABLE ONLY trip_ops.publication_event
    ADD CONSTRAINT publication_event_pkey PRIMARY KEY ("eventId");

ALTER TABLE ONLY trip_ops.publication_lock
    ADD CONSTRAINT publication_lock_pkey PRIMARY KEY ("agencyId", "tripId");

ALTER TABLE ONLY trip_ops.publication_snapshot
    ADD CONSTRAINT publication_snapshot_pkey PRIMARY KEY ("publicationId");

ALTER TABLE ONLY trip_ops.publication_version
    ADD CONSTRAINT publication_version_id_agency_trip_unique UNIQUE ("publicationId", "agencyId", "tripId");

ALTER TABLE ONLY trip_ops.publication_version
    ADD CONSTRAINT publication_version_pkey PRIMARY KEY ("publicationId");

ALTER TABLE ONLY trip_ops.publication_version
    ADD CONSTRAINT publication_version_pointer_fk UNIQUE ("publicationId", "agencyId", "tripId", version);

ALTER TABLE ONLY trip_ops.publication_version
    ADD CONSTRAINT publication_version_unique_trip_version UNIQUE ("agencyId", "tripId", version);

ALTER TABLE ONLY trip_ops.reservation
    ADD CONSTRAINT reservation_id_trip_agency_unique UNIQUE (id, "tripId", "agencyId");

ALTER TABLE ONLY trip_ops.reservation
    ADD CONSTRAINT reservation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY trip_ops.reservation
    ADD CONSTRAINT reservation_supplier_reference_unique UNIQUE ("agencyId", "supplierName", "supplierReference");

ALTER TABLE ONLY trip_ops.reservation_item_link
    ADD CONSTRAINT reservation_item_link_pkey PRIMARY KEY ("agencyId", "tripId", "reservationId", "itineraryItemId");

ALTER TABLE ONLY trip_ops.share_link
    ADD CONSTRAINT share_link_idempotency_unique UNIQUE ("agencyId", "createdByStaffPrincipalId", "idempotencyKey");

ALTER TABLE ONLY trip_ops.share_link
    ADD CONSTRAINT share_link_pkey PRIMARY KEY ("shareLinkId");

ALTER TABLE ONLY trip_ops.share_link
    ADD CONSTRAINT "share_link_tokenHash_key" UNIQUE ("tokenHash");

ALTER TABLE ONLY trip_ops.trip
    ADD CONSTRAINT trip_id_agency_unique UNIQUE (id, "agencyId");

ALTER TABLE ONLY trip_ops.trip
    ADD CONSTRAINT trip_pkey PRIMARY KEY (id);

ALTER TABLE ONLY trip_ops.trip_traveller
    ADD CONSTRAINT trip_traveller_pkey PRIMARY KEY (id);

ALTER TABLE ONLY trip_ops.trip_traveller
    ADD CONSTRAINT trip_traveller_unique_person UNIQUE ("agencyId", "tripId", "personId");

ALTER TABLE ONLY trip_ops.workspace_revision_touch
    ADD CONSTRAINT workspace_revision_touch_pkey PRIMARY KEY ("agencyId", "tripId");
  `);

  // Indexes (unique ones are referenced by the foreign keys below)
  pgm.sql(String.raw`
CREATE INDEX activity_trip_cursor_idx ON activity.entry USING btree ("agencyId", "tripId", "occurredAt", "messageId");

CREATE INDEX lead_entry_by_lead_idx ON activity.lead_entry USING btree ("agencyId", "leadId", "occurredAt", "entryId");

CREATE INDEX staff_invitation_event_by_invitation_idx ON audit.staff_invitation_event USING btree ("agencyId", "invitationId", "occurredAt", id);

CREATE INDEX customer_agency_name_idx ON crm.customer USING btree ("agencyId", "displayName", id);

CREATE UNIQUE INDEX customer_primary_customer_per_person_idx ON crm.customer_person USING btree ("agencyId", "personId") WHERE "isPrimary";

CREATE UNIQUE INDEX customer_primary_person_idx ON crm.customer_person USING btree ("agencyId", "customerId") WHERE "isPrimary";

CREATE INDEX person_agency_name_idx ON crm.person USING btree ("agencyId", "familyName", "givenName", id);

CREATE INDEX supplier_cost_trip_idx ON finance.supplier_cost_line USING btree ("agencyId", "tripId", id);

CREATE UNIQUE INDEX publication_outbox_scope_idx ON integration.trip_publication_outbox USING btree ("messageId", "agencyId");

CREATE INDEX job_due_idx ON job_runtime.job USING btree ("runAt", "createdAt", "messageId") WHERE (state = ANY (ARRAY['PENDING'::text, 'RETRY'::text]));

CREATE INDEX job_expired_idx ON job_runtime.job USING btree ("leaseUntil") WHERE (state = 'RUNNING'::text);

CREATE UNIQUE INDEX agency_single_root_idx ON organization.agency USING btree ((true));

CREATE INDEX lead_agency_state_created_idx ON sales.lead USING btree ("agencyId", state, "createdAt" DESC, id DESC);

CREATE INDEX role_assignment_membership_active_idx ON staff_access.role_assignment USING btree ("membershipId") WHERE active;

CREATE UNIQUE INDEX role_unique_agency_template_key_idx ON staff_access.role USING btree ("agencyId", "templateKey") WHERE ("templateKey" IS NOT NULL);

CREATE INDEX staff_invitation_due_idx ON staff_access.staff_invitation USING btree ("agencyId", "expiresAt", id) WHERE (status = 'PENDING'::text);

CREATE INDEX staff_invitation_page_idx ON staff_access.staff_invitation USING btree ("agencyId", id DESC);

CREATE INDEX staff_session_context_principal_idx ON staff_access.staff_session_context USING btree ("staffPrincipalId");

CREATE INDEX itinerary_item_trip_order_idx ON trip_ops.itinerary_item USING btree ("agencyId", "tripId", "sortOrder", id);

CREATE INDEX reservation_trip_idx ON trip_ops.reservation USING btree ("agencyId", "tripId", id);

CREATE INDEX share_link_trip_idx ON trip_ops.share_link USING btree ("agencyId", "tripId", "createdAt" DESC);

CREATE INDEX trip_agency_updated_idx ON trip_ops.trip USING btree ("agencyId", "updatedAt", id);

CREATE UNIQUE INDEX trip_primary_traveller_idx ON trip_ops.trip_traveller USING btree ("agencyId", "tripId") WHERE (role = 'PRIMARY_TRAVELLER'::text);

CREATE INDEX trip_traveller_trip_idx ON trip_ops.trip_traveller USING btree ("agencyId", "tripId", id);
  `);

  // Foreign keys
  pgm.sql(String.raw`
ALTER TABLE ONLY organization.agency_bootstrap_audit
    ADD CONSTRAINT "agency_bootstrap_audit_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY staff_access.staff_membership
    ADD CONSTRAINT "staff_membership_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY staff_access.staff_membership
    ADD CONSTRAINT "staff_membership_staffPrincipalId_fkey" FOREIGN KEY ("staffPrincipalId") REFERENCES staff_access.staff_user(id) ON DELETE RESTRICT;

ALTER TABLE ONLY staff_access.staff_session_context
    ADD CONSTRAINT staff_session_context_session_principal_fk FOREIGN KEY ("sessionId", "staffPrincipalId") REFERENCES staff_access.staff_session(id, "userId") ON DELETE CASCADE;

ALTER TABLE ONLY staff_access.staff_session_context
    ADD CONSTRAINT staff_session_context_membership_fk FOREIGN KEY ("agencyId", "staffPrincipalId") REFERENCES staff_access.staff_membership("agencyId", "staffPrincipalId") ON DELETE RESTRICT;

ALTER TABLE ONLY staff_access.role
    ADD CONSTRAINT "role_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY staff_access.role_permission
    ADD CONSTRAINT "role_permission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES staff_access.role(id) ON DELETE CASCADE;

ALTER TABLE ONLY staff_access.role_assignment
    ADD CONSTRAINT "role_assignment_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY staff_access.role_assignment
    ADD CONSTRAINT role_assignment_membership_agency_fk FOREIGN KEY ("membershipId", "agencyId") REFERENCES staff_access.staff_membership(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY staff_access.role_assignment
    ADD CONSTRAINT role_assignment_role_agency_fk FOREIGN KEY ("roleId", "agencyId") REFERENCES staff_access.role(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY staff_access.operator_bootstrap_invitation
    ADD CONSTRAINT "operator_bootstrap_invitation_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY staff_access.operator_bootstrap_invitation
    ADD CONSTRAINT "operator_bootstrap_invitation_staffPrincipalId_fkey" FOREIGN KEY ("staffPrincipalId") REFERENCES staff_access.staff_user(id) ON DELETE RESTRICT;

ALTER TABLE ONLY staff_access.operator_bootstrap_audit
    ADD CONSTRAINT "operator_bootstrap_audit_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY staff_access.operator_bootstrap_audit
    ADD CONSTRAINT "operator_bootstrap_audit_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES staff_access.operator_bootstrap_invitation(id) ON DELETE RESTRICT;

ALTER TABLE ONLY crm.person
    ADD CONSTRAINT "person_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY crm.customer
    ADD CONSTRAINT "customer_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY crm.customer_person
    ADD CONSTRAINT "customer_person_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY crm.customer_person
    ADD CONSTRAINT customer_person_customer_agency_fk FOREIGN KEY ("customerId", "agencyId") REFERENCES crm.customer(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY crm.customer_person
    ADD CONSTRAINT customer_person_person_agency_fk FOREIGN KEY ("personId", "agencyId") REFERENCES crm.person(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.trip
    ADD CONSTRAINT "trip_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.trip_traveller
    ADD CONSTRAINT "trip_traveller_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.trip_traveller
    ADD CONSTRAINT trip_traveller_trip_agency_fk FOREIGN KEY ("tripId", "agencyId") REFERENCES trip_ops.trip(id, "agencyId") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY trip_ops.trip_traveller
    ADD CONSTRAINT trip_traveller_person_agency_fk FOREIGN KEY ("personId", "agencyId") REFERENCES crm.person(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.itinerary_item
    ADD CONSTRAINT "itinerary_item_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.itinerary_item
    ADD CONSTRAINT itinerary_item_trip_agency_fk FOREIGN KEY ("tripId", "agencyId") REFERENCES trip_ops.trip(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.flight_item_detail
    ADD CONSTRAINT "flight_item_detail_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.flight_item_detail
    ADD CONSTRAINT flight_item_agency_trip_fk FOREIGN KEY ("itemId", "tripId", "agencyId") REFERENCES trip_ops.itinerary_item(id, "tripId", "agencyId") ON DELETE CASCADE;

ALTER TABLE ONLY trip_ops.accommodation_item_detail
    ADD CONSTRAINT "accommodation_item_detail_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.accommodation_item_detail
    ADD CONSTRAINT accommodation_item_agency_trip_fk FOREIGN KEY ("itemId", "tripId", "agencyId") REFERENCES trip_ops.itinerary_item(id, "tripId", "agencyId") ON DELETE CASCADE;

ALTER TABLE ONLY trip_ops.reservation
    ADD CONSTRAINT "reservation_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.reservation
    ADD CONSTRAINT reservation_trip_agency_fk FOREIGN KEY ("tripId", "agencyId") REFERENCES trip_ops.trip(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.reservation_item_link
    ADD CONSTRAINT "reservation_item_link_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.reservation_item_link
    ADD CONSTRAINT reservation_link_reservation_trip_fk FOREIGN KEY ("reservationId", "tripId", "agencyId") REFERENCES trip_ops.reservation(id, "tripId", "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.reservation_item_link
    ADD CONSTRAINT reservation_link_item_trip_fk FOREIGN KEY ("itineraryItemId", "tripId", "agencyId") REFERENCES trip_ops.itinerary_item(id, "tripId", "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY finance.supplier_cost_line
    ADD CONSTRAINT "supplier_cost_line_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY finance.supplier_cost_line
    ADD CONSTRAINT supplier_cost_trip_agency_fk FOREIGN KEY ("tripId", "agencyId") REFERENCES trip_ops.trip(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY finance.supplier_cost_line
    ADD CONSTRAINT supplier_cost_reservation_trip_fk FOREIGN KEY ("reservationId", "tripId", "agencyId") REFERENCES trip_ops.reservation(id, "tripId", "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY finance.supplier_cost_line
    ADD CONSTRAINT supplier_cost_currency_fk FOREIGN KEY ("currencyCode", "currencyScale") REFERENCES finance.currency_registry("currencyCode", scale);

ALTER TABLE ONLY trip_ops.workspace_revision_touch
    ADD CONSTRAINT workspace_revision_touch_trip_agency_fk FOREIGN KEY ("tripId", "agencyId") REFERENCES trip_ops.trip(id, "agencyId") ON DELETE CASCADE;

ALTER TABLE ONLY presentation.agency_publication_visibility
    ADD CONSTRAINT "agency_publication_visibility_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY presentation.item_publication_visibility
    ADD CONSTRAINT item_publication_visibility_item_fk FOREIGN KEY ("itemId", "tripId", "agencyId") REFERENCES trip_ops.itinerary_item(id, "tripId", "agencyId") ON DELETE CASCADE;

ALTER TABLE ONLY trip_ops.publication_version
    ADD CONSTRAINT publication_version_trip_fk FOREIGN KEY ("tripId", "agencyId") REFERENCES trip_ops.trip(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.publication_snapshot
    ADD CONSTRAINT "publication_snapshot_publicationId_agencyId_tripId_fkey" FOREIGN KEY ("publicationId", "agencyId", "tripId") REFERENCES trip_ops.publication_version("publicationId", "agencyId", "tripId") ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.publication_event
    ADD CONSTRAINT "publication_event_publicationId_agencyId_tripId_version_fkey" FOREIGN KEY ("publicationId", "agencyId", "tripId", version) REFERENCES trip_ops.publication_version("publicationId", "agencyId", "tripId", version) ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.publication_lock
    ADD CONSTRAINT "publication_lock_tripId_agencyId_fkey" FOREIGN KEY ("tripId", "agencyId") REFERENCES trip_ops.trip(id, "agencyId") ON DELETE CASCADE;

ALTER TABLE ONLY integration.trip_publication_outbox
    ADD CONSTRAINT "trip_publication_outbox_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES trip_ops.publication_event("eventId") ON DELETE RESTRICT;

ALTER TABLE ONLY integration.trip_publication_outbox
    ADD CONSTRAINT "trip_publication_outbox_publicationId_agencyId_tripId_vers_fkey" FOREIGN KEY ("publicationId", "agencyId", "tripId", version) REFERENCES trip_ops.publication_version("publicationId", "agencyId", "tripId", version) ON DELETE RESTRICT;

ALTER TABLE ONLY integration.event_context
    ADD CONSTRAINT "event_context_publicationMessageId_agencyId_fkey" FOREIGN KEY ("publicationMessageId", "agencyId") REFERENCES integration.trip_publication_outbox("messageId", "agencyId");

ALTER TABLE ONLY integration.outbox_delivery
    ADD CONSTRAINT "outbox_delivery_publicationMessageId_agencyId_fkey" FOREIGN KEY ("publicationMessageId", "agencyId") REFERENCES integration.trip_publication_outbox("messageId", "agencyId");

ALTER TABLE ONLY job_runtime.job
    ADD CONSTRAINT "job_agencyId_messageId_consumer_fkey" FOREIGN KEY ("agencyId", "messageId", consumer) REFERENCES integration.outbox_delivery("agencyId", "messageId", consumer);

ALTER TABLE ONLY job_runtime.attempt
    ADD CONSTRAINT "attempt_agencyId_messageId_consumer_fkey" FOREIGN KEY ("agencyId", "messageId", consumer) REFERENCES job_runtime.job("agencyId", "messageId", consumer);

ALTER TABLE ONLY activity.entry
    ADD CONSTRAINT "entry_agencyId_messageId_consumer_fkey" FOREIGN KEY ("agencyId", "messageId", consumer) REFERENCES integration.outbox_delivery("agencyId", "messageId", consumer);

ALTER TABLE ONLY activity.entry
    ADD CONSTRAINT "entry_tripId_agencyId_fkey" FOREIGN KEY ("tripId", "agencyId") REFERENCES trip_ops.trip(id, "agencyId");

ALTER TABLE ONLY activity.entry
    ADD CONSTRAINT "entry_publicationId_agencyId_tripId_fkey" FOREIGN KEY ("publicationId", "agencyId", "tripId") REFERENCES trip_ops.publication_version("publicationId", "agencyId", "tripId");

ALTER TABLE ONLY activity.entry
    ADD CONSTRAINT "entry_agencyId_actorStaffPrincipalId_fkey" FOREIGN KEY ("agencyId", "actorStaffPrincipalId") REFERENCES staff_access.staff_membership("agencyId", "staffPrincipalId");

ALTER TABLE ONLY staff_access.staff_invitation
    ADD CONSTRAINT staff_invitation_agency_fk FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY staff_access.staff_invitation
    ADD CONSTRAINT staff_invitation_role_agency_fk FOREIGN KEY ("roleId", "agencyId") REFERENCES staff_access.role(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY staff_access.staff_invitation
    ADD CONSTRAINT staff_invitation_creator_agency_fk FOREIGN KEY ("agencyId", "createdByStaffPrincipalId") REFERENCES staff_access.staff_membership("agencyId", "staffPrincipalId") ON DELETE RESTRICT;

ALTER TABLE ONLY staff_access.staff_invitation
    ADD CONSTRAINT staff_invitation_consumer_agency_fk FOREIGN KEY ("agencyId", "consumedStaffPrincipalId") REFERENCES staff_access.staff_membership("agencyId", "staffPrincipalId") ON DELETE RESTRICT;

ALTER TABLE ONLY audit.staff_invitation_event
    ADD CONSTRAINT staff_invitation_event_invitation_agency_fk FOREIGN KEY ("agencyId", "invitationId") REFERENCES staff_access.staff_invitation("agencyId", id) ON DELETE RESTRICT;

ALTER TABLE ONLY audit.staff_invitation_event
    ADD CONSTRAINT staff_invitation_event_related_invitation_agency_fk FOREIGN KEY ("agencyId", "relatedInvitationId") REFERENCES staff_access.staff_invitation("agencyId", id) ON DELETE RESTRICT;

ALTER TABLE ONLY audit.staff_invitation_event
    ADD CONSTRAINT staff_invitation_event_actor_agency_fk FOREIGN KEY ("agencyId", "actorStaffPrincipalId") REFERENCES staff_access.staff_membership("agencyId", "staffPrincipalId") ON DELETE RESTRICT;

ALTER TABLE ONLY sales.lead
    ADD CONSTRAINT "lead_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES organization.agency(id) ON DELETE RESTRICT;

ALTER TABLE ONLY sales.lead
    ADD CONSTRAINT lead_qualified_customer_agency_fk FOREIGN KEY ("qualifiedCustomerId", "agencyId") REFERENCES crm.customer(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY sales.lead_idempotency
    ADD CONSTRAINT lead_idempotency_actor_agency_fk FOREIGN KEY ("agencyId", "staffPrincipalId") REFERENCES staff_access.staff_membership("agencyId", "staffPrincipalId") ON DELETE RESTRICT;

ALTER TABLE ONLY sales.lead_idempotency
    ADD CONSTRAINT lead_idempotency_lead_agency_fk FOREIGN KEY ("leadId", "agencyId") REFERENCES sales.lead(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY audit.lead_event
    ADD CONSTRAINT lead_event_lead_agency_fk FOREIGN KEY ("leadId", "agencyId") REFERENCES sales.lead(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY audit.lead_event
    ADD CONSTRAINT lead_event_actor_agency_fk FOREIGN KEY ("agencyId", "actorStaffPrincipalId") REFERENCES staff_access.staff_membership("agencyId", "staffPrincipalId") ON DELETE RESTRICT;

ALTER TABLE ONLY audit.lead_event
    ADD CONSTRAINT lead_event_customer_agency_fk FOREIGN KEY ("customerId", "agencyId") REFERENCES crm.customer(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY activity.lead_entry
    ADD CONSTRAINT lead_entry_audit_agency_fk FOREIGN KEY ("auditId", "agencyId") REFERENCES audit.lead_event("auditId", "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY activity.lead_entry
    ADD CONSTRAINT lead_entry_lead_agency_fk FOREIGN KEY ("leadId", "agencyId") REFERENCES sales.lead(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY activity.lead_entry
    ADD CONSTRAINT lead_entry_actor_agency_fk FOREIGN KEY ("agencyId", "actorStaffPrincipalId") REFERENCES staff_access.staff_membership("agencyId", "staffPrincipalId") ON DELETE RESTRICT;

ALTER TABLE ONLY integration.lead_outbox
    ADD CONSTRAINT lead_outbox_audit_agency_fk FOREIGN KEY ("auditId", "agencyId") REFERENCES audit.lead_event("auditId", "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY integration.lead_outbox
    ADD CONSTRAINT lead_outbox_lead_agency_fk FOREIGN KEY ("leadId", "agencyId") REFERENCES sales.lead(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.share_link
    ADD CONSTRAINT share_link_trip_fk FOREIGN KEY ("tripId", "agencyId") REFERENCES trip_ops.trip(id, "agencyId") ON DELETE RESTRICT;

ALTER TABLE ONLY trip_ops.share_link
    ADD CONSTRAINT share_link_publication_fk FOREIGN KEY ("publicationId", "agencyId", "tripId") REFERENCES trip_ops.publication_version("publicationId", "agencyId", "tripId") ON DELETE RESTRICT;
  `);

  // Views
  pgm.sql(String.raw`
CREATE VIEW integration.activity_source WITH (security_barrier='true') AS
 SELECT outbox."messageId",
    outbox."agencyId",
    event."tripId",
    event."publicationId",
    event."actorStaffPrincipalId",
    event."eventType",
    event."occurredAt",
    outbox."messageId" AS "publicationMessageId"
   FROM (integration.trip_publication_outbox outbox
     JOIN trip_ops.publication_event event ON (((event."eventId" = outbox."eventId") AND (event."agencyId" = outbox."agencyId") AND (event."tripId" = outbox."tripId") AND (event."publicationId" = outbox."publicationId") AND (event.version = outbox.version) AND (event."eventType" = outbox."eventType"))));
  `);

  // Functions
  pgm.sql(String.raw`
CREATE FUNCTION activity.validate_source() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;

CREATE FUNCTION audit.reject_staff_invitation_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
    BEGIN
      RAISE EXCEPTION 'Staff invitation audit events are append-only'
        USING ERRCODE = '55000', CONSTRAINT = 'staff_invitation_event_immutable';
    END
    $$;

CREATE FUNCTION integration.capture_event_context() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    BEGIN
      INSERT INTO "integration"."event_context" ("agencyId", "messageId", "publicationMessageId", "correlationId", "traceparent")
      VALUES (NEW."agencyId", NEW."messageId", NEW."messageId",
        coalesce(nullif(current_setting('travelos.correlation_id', true), '')::uuid, NEW."messageId"),
        nullif(current_setting('travelos.traceparent', true), ''));
      RETURN NEW;
    END
    $$;

CREATE FUNCTION job_runtime.reject_history_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
    BEGIN
      RAISE EXCEPTION 'Worker history is immutable' USING ERRCODE = '55000';
    END
    $$;

CREATE FUNCTION presentation.assert_visibility_field_family() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    DECLARE
      item_family text;
    BEGIN
      SELECT item."family" INTO item_family
        FROM "trip_ops"."itinerary_item" AS item
       WHERE item."id" = NEW."itemId" AND item."tripId" = NEW."tripId"
         AND item."agencyId" = NEW."agencyId";
      IF item_family IS NULL OR
         (item_family = 'FLIGHT' AND NEW."fieldKey" NOT LIKE 'flight.%') OR
         (item_family = 'ACCOMMODATION' AND NEW."fieldKey" NOT LIKE 'accommodation.%') THEN
        RAISE EXCEPTION 'Visibility field does not match itinerary family'
          USING ERRCODE = '23514', CONSTRAINT = 'visibility_field_family';
      END IF;
      RETURN NEW;
    END
    $$;

CREATE FUNCTION presentation.touch_agency_publication_visibility_revision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    BEGIN
      IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM "trip_ops"."touch_workspace_revision"(trip."agencyId", trip."id")
          FROM "trip_ops"."trip" AS trip
         WHERE trip."agencyId" = OLD."agencyId"
           AND EXISTS (
             SELECT 1 FROM "trip_ops"."itinerary_item" AS item
              WHERE item."agencyId" = trip."agencyId" AND item."tripId" = trip."id"
                AND item."state" <> 'CANCELLED'
                AND ((item."family" = 'FLIGHT' AND OLD."fieldKey" LIKE 'flight.%') OR
                     (item."family" = 'ACCOMMODATION' AND OLD."fieldKey" LIKE 'accommodation.%'))
           );
      END IF;
      IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM "trip_ops"."touch_workspace_revision"(trip."agencyId", trip."id")
          FROM "trip_ops"."trip" AS trip
         WHERE trip."agencyId" = NEW."agencyId"
           AND EXISTS (
             SELECT 1 FROM "trip_ops"."itinerary_item" AS item
              WHERE item."agencyId" = trip."agencyId" AND item."tripId" = trip."id"
                AND item."state" <> 'CANCELLED'
                AND ((item."family" = 'FLIGHT' AND NEW."fieldKey" LIKE 'flight.%') OR
                     (item."family" = 'ACCOMMODATION' AND NEW."fieldKey" LIKE 'accommodation.%'))
           );
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END
    $$;

CREATE FUNCTION presentation.touch_item_publication_visibility_revision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    BEGIN
      IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM "trip_ops"."touch_workspace_revision"(OLD."agencyId", OLD."tripId");
      END IF;
      IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM "trip_ops"."touch_workspace_revision"(NEW."agencyId", NEW."tripId");
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END
    $$;

CREATE FUNCTION sales.enforce_lead_transition() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;

CREATE FUNCTION sales.reject_lead_history_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
    BEGIN
      RAISE EXCEPTION 'Lead history records are append-only'
        USING ERRCODE = '55000', CONSTRAINT = 'lead_history_immutable';
    END
    $$;

CREATE FUNCTION staff_access.bump_membership_epoch_for_assignment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      UPDATE "staff_access"."staff_membership"
         SET "authorizationEpoch" = "authorizationEpoch" + 1,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."membershipId" ELSE NEW."membershipId" END;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END
    $$;

CREATE FUNCTION staff_access.bump_membership_epoch_for_role_permission() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      UPDATE "staff_access"."staff_membership" AS membership
         SET "authorizationEpoch" = membership."authorizationEpoch" + 1,
             "updatedAt" = CURRENT_TIMESTAMP
        FROM "staff_access"."role_assignment" AS assignment
       WHERE assignment."roleId" = CASE WHEN TG_OP = 'DELETE' THEN OLD."roleId" ELSE NEW."roleId" END
         AND assignment."membershipId" = membership."id"
         AND assignment."active";
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END
    $$;

CREATE FUNCTION staff_access.bump_membership_epoch_for_state() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW."state" IS DISTINCT FROM OLD."state" THEN
        NEW."authorizationEpoch" := OLD."authorizationEpoch" + 1;
        NEW."updatedAt" := CURRENT_TIMESTAMP;
      END IF;
      RETURN NEW;
    END
    $$;

CREATE FUNCTION staff_access.protect_last_active_owner_assignment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      owner_count integer;
      old_is_active_owner boolean;
      new_is_active_owner boolean := false;
    BEGIN
      SELECT OLD."active"
         AND EXISTS (
           SELECT 1 FROM "staff_access"."role"
            WHERE "id" = OLD."roleId" AND "templateKey" = 'agency-owner-v1'
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
              WHERE "id" = NEW."roleId" AND "templateKey" = 'agency-owner-v1'
           )
           AND EXISTS (
             SELECT 1 FROM "staff_access"."staff_membership"
              WHERE "id" = NEW."membershipId" AND "state" = 'ACTIVE'
           )
          INTO new_is_active_owner;
        IF new_is_active_owner THEN RETURN NEW; END IF;
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(OLD."agencyId"::text, 603963866289541011::bigint)
      );
      SELECT count(*) INTO owner_count
        FROM "staff_access"."role_assignment" AS assignment
        JOIN "staff_access"."staff_membership" AS membership ON membership."id" = assignment."membershipId"
        JOIN "staff_access"."role" AS role ON role."id" = assignment."roleId"
       WHERE assignment."agencyId" = OLD."agencyId"
         AND assignment."active"
         AND membership."state" = 'ACTIVE'
         AND role."templateKey" = 'agency-owner-v1';
      IF owner_count <= 1 THEN
        RAISE EXCEPTION 'Last active Owner assignment cannot be removed' USING ERRCODE = 'P0001';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END
    $$;

CREATE FUNCTION staff_access.protect_last_active_owner_membership() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
           AND role."templateKey" = 'agency-owner-v1'
      ) THEN
        RETURN NEW;
      END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(OLD."agencyId"::text, 603963866289541011::bigint)
      );
      SELECT count(*) INTO owner_count
        FROM "staff_access"."role_assignment" AS assignment
        JOIN "staff_access"."staff_membership" AS membership ON membership."id" = assignment."membershipId"
        JOIN "staff_access"."role" AS role ON role."id" = assignment."roleId"
       WHERE assignment."agencyId" = OLD."agencyId"
         AND assignment."active"
         AND membership."state" = 'ACTIVE'
         AND role."templateKey" = 'agency-owner-v1';
      IF owner_count <= 1 THEN
        RAISE EXCEPTION 'Last active Owner membership cannot be deactivated' USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END
    $$;

CREATE FUNCTION staff_access.protect_owner_template_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD."templateKey" = 'agency-owner-v1'
         AND NEW."templateKey" IS DISTINCT FROM OLD."templateKey" THEN
        RAISE EXCEPTION 'Owner role template identity is immutable' USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END
    $$;

CREATE FUNCTION trip_ops.assert_accommodation_temporal_policy() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    BEGIN
      PERFORM "trip_ops"."assert_scheduled_temporal_tuple"(
        NEW."checkInDate", NEW."checkInTime", NEW."checkInTimezone", NEW."checkInInstant", 'accommodation check-in'
      );
      PERFORM "trip_ops"."assert_scheduled_temporal_tuple"(
        NEW."checkOutDate", NEW."checkOutTime", NEW."checkOutTimezone", NEW."checkOutInstant", 'accommodation check-out'
      );
      RETURN NEW;
    END
    $$;

CREATE FUNCTION trip_ops.assert_exactly_one_primary_traveller() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;

CREATE FUNCTION trip_ops.assert_exactly_one_primary_traveller_for_trip(p_agency_id uuid, p_trip_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;

CREATE FUNCTION trip_ops.assert_exactly_one_primary_traveller_pair(p_old_agency_id uuid, p_old_trip_id uuid, p_new_agency_id uuid, p_new_trip_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;

CREATE FUNCTION trip_ops.assert_flight_temporal_policy() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    BEGIN
      PERFORM "trip_ops"."assert_scheduled_temporal_tuple"(
        NEW."departureDate", NEW."departureTime", NEW."departureTimezone", NEW."departureInstant", 'flight departure'
      );
      PERFORM "trip_ops"."assert_scheduled_temporal_tuple"(
        NEW."arrivalDate", NEW."arrivalTime", NEW."arrivalTimezone", NEW."arrivalInstant", 'flight arrival'
      );
      RETURN NEW;
    END
    $$;

CREATE FUNCTION trip_ops.assert_one_family_detail() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;

CREATE FUNCTION trip_ops.assert_one_family_detail_tuple(p_agency_id uuid, p_trip_id uuid, p_item_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;

CREATE FUNCTION trip_ops.assert_primary_traveller_customer_continuity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;

CREATE FUNCTION trip_ops.assert_primary_traveller_customer_continuity_for_person(p_agency_id uuid, p_person_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;

CREATE FUNCTION trip_ops.assert_scheduled_temporal_tuple(p_local_date date, p_local_time time without time zone, p_timezone text, p_instant timestamp with time zone, p_label text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    DECLARE
      projected_local timestamp;
    BEGIN
      IF p_timezone IS NULL OR NOT (
        p_timezone = ANY(ARRAY['UTC', 'Africa/Abidjan', 'Africa/Accra', 'Africa/Addis_Ababa', 'Africa/Algiers', 'Africa/Bamako', 'Africa/Bangui', 'Africa/Banjul', 'Africa/Bissau', 'Africa/Blantyre', 'Africa/Brazzaville', 'Africa/Bujumbura', 'Africa/Cairo', 'Africa/Casablanca', 'Africa/Ceuta', 'Africa/Conakry', 'Africa/Dakar', 'Africa/Dar_es_Salaam', 'Africa/Djibouti', 'Africa/Douala', 'Africa/El_Aaiun', 'Africa/Freetown', 'Africa/Gaborone', 'Africa/Harare', 'Africa/Johannesburg', 'Africa/Juba', 'Africa/Kampala', 'Africa/Khartoum', 'Africa/Kigali', 'Africa/Kinshasa', 'Africa/Lagos', 'Africa/Libreville', 'Africa/Lome', 'Africa/Luanda', 'Africa/Lubumbashi', 'Africa/Lusaka', 'Africa/Malabo', 'Africa/Maputo', 'Africa/Maseru', 'Africa/Mbabane', 'Africa/Mogadishu', 'Africa/Monrovia', 'Africa/Nairobi', 'Africa/Ndjamena', 'Africa/Niamey', 'Africa/Nouakchott', 'Africa/Ouagadougou', 'Africa/Porto-Novo', 'Africa/Sao_Tome', 'Africa/Tripoli', 'Africa/Tunis', 'Africa/Windhoek', 'America/Adak', 'America/Anchorage', 'America/Anguilla', 'America/Antigua', 'America/Araguaina', 'America/Argentina/La_Rioja', 'America/Argentina/Rio_Gallegos', 'America/Argentina/Salta', 'America/Argentina/San_Juan', 'America/Argentina/San_Luis', 'America/Argentina/Tucuman', 'America/Argentina/Ushuaia', 'America/Aruba', 'America/Asuncion', 'America/Bahia', 'America/Bahia_Banderas', 'America/Barbados', 'America/Belem', 'America/Belize', 'America/Blanc-Sablon', 'America/Boa_Vista', 'America/Bogota', 'America/Boise', 'America/Cambridge_Bay', 'America/Campo_Grande', 'America/Cancun', 'America/Caracas', 'America/Cayenne', 'America/Cayman', 'America/Chicago', 'America/Chihuahua', 'America/Ciudad_Juarez', 'America/Coral_Harbour', 'America/Costa_Rica', 'America/Coyhaique', 'America/Creston', 'America/Cuiaba', 'America/Curacao', 'America/Danmarkshavn', 'America/Dawson', 'America/Dawson_Creek', 'America/Denver', 'America/Detroit', 'America/Dominica', 'America/Edmonton', 'America/Eirunepe', 'America/El_Salvador', 'America/Fort_Nelson', 'America/Fortaleza', 'America/Glace_Bay', 'America/Goose_Bay', 'America/Grand_Turk', 'America/Grenada', 'America/Guadeloupe', 'America/Guatemala', 'America/Guayaquil', 'America/Guyana', 'America/Halifax', 'America/Havana', 'America/Hermosillo', 'America/Indiana/Knox', 'America/Indiana/Marengo', 'America/Indiana/Petersburg', 'America/Indiana/Tell_City', 'America/Indiana/Vevay', 'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Inuvik', 'America/Iqaluit', 'America/Jamaica', 'America/Juneau', 'America/Kentucky/Monticello', 'America/Kralendijk', 'America/La_Paz', 'America/Lima', 'America/Los_Angeles', 'America/Lower_Princes', 'America/Maceio', 'America/Managua', 'America/Manaus', 'America/Marigot', 'America/Martinique', 'America/Matamoros', 'America/Mazatlan', 'America/Menominee', 'America/Merida', 'America/Metlakatla', 'America/Mexico_City', 'America/Miquelon', 'America/Moncton', 'America/Monterrey', 'America/Montevideo', 'America/Montserrat', 'America/Nassau', 'America/New_York', 'America/Nome', 'America/Noronha', 'America/North_Dakota/Beulah', 'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/Ojinaga', 'America/Panama', 'America/Paramaribo', 'America/Phoenix', 'America/Port-au-Prince', 'America/Port_of_Spain', 'America/Porto_Velho', 'America/Puerto_Rico', 'America/Punta_Arenas', 'America/Rankin_Inlet', 'America/Recife', 'America/Regina', 'America/Resolute', 'America/Rio_Branco', 'America/Santarem', 'America/Santiago', 'America/Santo_Domingo', 'America/Sao_Paulo', 'America/Scoresbysund', 'America/Sitka', 'America/St_Barthelemy', 'America/St_Johns', 'America/St_Kitts', 'America/St_Lucia', 'America/St_Thomas', 'America/St_Vincent', 'America/Swift_Current', 'America/Tegucigalpa', 'America/Thule', 'America/Tijuana', 'America/Toronto', 'America/Tortola', 'America/Vancouver', 'America/Whitehorse', 'America/Winnipeg', 'America/Yakutat', 'Antarctica/Casey', 'Antarctica/Davis', 'Antarctica/DumontDUrville', 'Antarctica/Macquarie', 'Antarctica/Mawson', 'Antarctica/McMurdo', 'Antarctica/Palmer', 'Antarctica/Rothera', 'Antarctica/Syowa', 'Antarctica/Troll', 'Antarctica/Vostok', 'Arctic/Longyearbyen', 'Asia/Aden', 'Asia/Almaty', 'Asia/Amman', 'Asia/Anadyr', 'Asia/Aqtau', 'Asia/Aqtobe', 'Asia/Ashgabat', 'Asia/Atyrau', 'Asia/Baghdad', 'Asia/Bahrain', 'Asia/Baku', 'Asia/Bangkok', 'Asia/Barnaul', 'Asia/Beirut', 'Asia/Bishkek', 'Asia/Brunei', 'Asia/Chita', 'Asia/Colombo', 'Asia/Damascus', 'Asia/Dhaka', 'Asia/Dili', 'Asia/Dubai', 'Asia/Dushanbe', 'Asia/Famagusta', 'Asia/Gaza', 'Asia/Hebron', 'Asia/Hong_Kong', 'Asia/Hovd', 'Asia/Irkutsk', 'Asia/Jakarta', 'Asia/Jayapura', 'Asia/Jerusalem', 'Asia/Kabul', 'Asia/Kamchatka', 'Asia/Karachi', 'Asia/Khandyga', 'Asia/Krasnoyarsk', 'Asia/Kuala_Lumpur', 'Asia/Kuching', 'Asia/Kuwait', 'Asia/Macau', 'Asia/Magadan', 'Asia/Makassar', 'Asia/Manila', 'Asia/Muscat', 'Asia/Nicosia', 'Asia/Novokuznetsk', 'Asia/Novosibirsk', 'Asia/Omsk', 'Asia/Oral', 'Asia/Phnom_Penh', 'Asia/Pontianak', 'Asia/Pyongyang', 'Asia/Qatar', 'Asia/Qostanay', 'Asia/Qyzylorda', 'Asia/Riyadh', 'Asia/Sakhalin', 'Asia/Samarkand', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Srednekolymsk', 'Asia/Taipei', 'Asia/Tashkent', 'Asia/Tbilisi', 'Asia/Tehran', 'Asia/Thimphu', 'Asia/Tokyo', 'Asia/Tomsk', 'Asia/Ulaanbaatar', 'Asia/Urumqi', 'Asia/Ust-Nera', 'Asia/Vientiane', 'Asia/Vladivostok', 'Asia/Yakutsk', 'Asia/Yekaterinburg', 'Asia/Yerevan', 'Atlantic/Azores', 'Atlantic/Bermuda', 'Atlantic/Canary', 'Atlantic/Cape_Verde', 'Atlantic/Madeira', 'Atlantic/Reykjavik', 'Atlantic/South_Georgia', 'Atlantic/St_Helena', 'Atlantic/Stanley', 'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Broken_Hill', 'Australia/Darwin', 'Australia/Eucla', 'Australia/Hobart', 'Australia/Lindeman', 'Australia/Lord_Howe', 'Australia/Melbourne', 'Australia/Perth', 'Australia/Sydney', 'Europe/Amsterdam', 'Europe/Andorra', 'Europe/Astrakhan', 'Europe/Athens', 'Europe/Belgrade', 'Europe/Berlin', 'Europe/Bratislava', 'Europe/Brussels', 'Europe/Bucharest', 'Europe/Budapest', 'Europe/Busingen', 'Europe/Chisinau', 'Europe/Copenhagen', 'Europe/Dublin', 'Europe/Gibraltar', 'Europe/Guernsey', 'Europe/Helsinki', 'Europe/Isle_of_Man', 'Europe/Istanbul', 'Europe/Jersey', 'Europe/Kaliningrad', 'Europe/Kirov', 'Europe/Lisbon', 'Europe/Ljubljana', 'Europe/London', 'Europe/Luxembourg', 'Europe/Madrid', 'Europe/Malta', 'Europe/Mariehamn', 'Europe/Minsk', 'Europe/Monaco', 'Europe/Moscow', 'Europe/Oslo', 'Europe/Paris', 'Europe/Podgorica', 'Europe/Prague', 'Europe/Riga', 'Europe/Rome', 'Europe/Samara', 'Europe/San_Marino', 'Europe/Sarajevo', 'Europe/Saratov', 'Europe/Simferopol', 'Europe/Skopje', 'Europe/Sofia', 'Europe/Stockholm', 'Europe/Tallinn', 'Europe/Tirane', 'Europe/Ulyanovsk', 'Europe/Vaduz', 'Europe/Vatican', 'Europe/Vienna', 'Europe/Vilnius', 'Europe/Volgograd', 'Europe/Warsaw', 'Europe/Zagreb', 'Europe/Zurich', 'Indian/Antananarivo', 'Indian/Chagos', 'Indian/Christmas', 'Indian/Cocos', 'Indian/Comoro', 'Indian/Kerguelen', 'Indian/Mahe', 'Indian/Maldives', 'Indian/Mauritius', 'Indian/Mayotte', 'Indian/Reunion', 'Pacific/Apia', 'Pacific/Auckland', 'Pacific/Bougainville', 'Pacific/Chatham', 'Pacific/Easter', 'Pacific/Efate', 'Pacific/Fakaofo', 'Pacific/Fiji', 'Pacific/Funafuti', 'Pacific/Galapagos', 'Pacific/Gambier', 'Pacific/Guadalcanal', 'Pacific/Guam', 'Pacific/Honolulu', 'Pacific/Kiritimati', 'Pacific/Kosrae', 'Pacific/Kwajalein', 'Pacific/Majuro', 'Pacific/Marquesas', 'Pacific/Midway', 'Pacific/Nauru', 'Pacific/Niue', 'Pacific/Norfolk', 'Pacific/Noumea', 'Pacific/Pago_Pago', 'Pacific/Palau', 'Pacific/Pitcairn', 'Pacific/Port_Moresby', 'Pacific/Rarotonga', 'Pacific/Saipan', 'Pacific/Tahiti', 'Pacific/Tarawa', 'Pacific/Tongatapu', 'Pacific/Wake', 'Pacific/Wallis']::text[])
      ) THEN
        RAISE EXCEPTION 'Scheduled % has invalid IANA timezone', p_label
          USING ERRCODE = '23514', CONSTRAINT = 'scheduled_timezone_policy';
      END IF;
      IF p_instant IS NULL
         OR p_instant < TIMESTAMPTZ '1000-01-01 00:00:00+00'
         OR p_instant >= TIMESTAMPTZ '10000-01-01 00:00:00+00' THEN
        RAISE EXCEPTION 'Scheduled % instant is outside the supported UTC calendar years', p_label
          USING ERRCODE = '23514', CONSTRAINT = 'scheduled_instant_calendar_policy';
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
    $$;

CREATE FUNCTION trip_ops.bump_customer_person_projection_revision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;

CREATE FUNCTION trip_ops.bump_customer_projection_revision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        PERFORM "trip_ops"."touch_workspace_revision_for_customer"(OLD."agencyId", OLD."id");
        RETURN OLD;
      END IF;
      PERFORM "trip_ops"."touch_workspace_revision_for_customer"(NEW."agencyId", NEW."id");
      RETURN NEW;
    END
    $$;

CREATE FUNCTION trip_ops.bump_person_projection_revision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        PERFORM "trip_ops"."touch_workspace_revision_for_person"(OLD."agencyId", OLD."id");
        RETURN OLD;
      END IF;
      PERFORM "trip_ops"."touch_workspace_revision_for_person"(NEW."agencyId", NEW."id");
      RETURN NEW;
    END
    $$;

CREATE FUNCTION trip_ops.bump_workspace_revision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;

CREATE FUNCTION trip_ops.cas_update_accommodation_presentation(p_agency_id uuid, p_trip_id uuid, p_item_id uuid, p_expected_lock_version bigint, p_title text, p_description text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    BEGIN
      IF p_expected_lock_version IS NULL OR p_expected_lock_version < 0 THEN
        RAISE EXCEPTION 'Expected lockVersion must be a non-negative bigint'
          USING ERRCODE = '22023';
      END IF;

      UPDATE "trip_ops"."itinerary_item"
         SET "customerTitle" = p_title,
             "customerDescription" = p_description,
             "lockVersion" = "lockVersion" + 1,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "agencyId" = p_agency_id
         AND "tripId" = p_trip_id
         AND "id" = p_item_id
         AND "family" = 'ACCOMMODATION'
         AND "lockVersion" = p_expected_lock_version;
      RETURN FOUND;
    END
    $$;

CREATE FUNCTION trip_ops.cas_update_supplier_cost_internal_note(p_agency_id uuid, p_trip_id uuid, p_reservation_id uuid, p_expected_lock_version bigint, p_internal_note text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    BEGIN
      IF p_expected_lock_version IS NULL OR p_expected_lock_version < 0 THEN
        RAISE EXCEPTION 'Expected lockVersion must be a non-negative bigint'
          USING ERRCODE = '22023';
      END IF;

      UPDATE "finance"."supplier_cost_line"
         SET "internalNote" = p_internal_note,
             "lockVersion" = "lockVersion" + 1,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "agencyId" = p_agency_id
         AND "tripId" = p_trip_id
         AND "reservationId" = p_reservation_id
         AND "lockVersion" = p_expected_lock_version;
      RETURN FOUND;
    END
    $$;

CREATE FUNCTION trip_ops.cas_update_workspace_accommodation(p_agency_id uuid, p_trip_id uuid, p_item_id uuid, p_expected_workspace_revision bigint, p_expected_lock_version bigint, p_title text, p_description text, p_customer_booking_reference text, p_property_name text, p_check_in_date date, p_check_in_time time without time zone, p_check_in_timezone text, p_check_in_instant timestamp with time zone, p_check_out_date date, p_check_out_time time without time zone, p_check_out_timezone text, p_check_out_instant timestamp with time zone, p_room_description text, p_board_type text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    DECLARE
      lock_outcome text;
    BEGIN
      IF p_item_id IS NULL OR p_expected_lock_version IS NULL OR p_expected_lock_version < 0 OR
         p_title IS NULL OR length(btrim(p_title)) = 0 OR
         p_description IS NULL OR length(btrim(p_description)) = 0 OR
         p_property_name IS NULL OR length(btrim(p_property_name)) = 0 THEN
        RAISE EXCEPTION 'Accommodation workspace update inputs are invalid'
          USING ERRCODE = '22023', CONSTRAINT = 'accommodation_workspace_update_input';
      END IF;

      lock_outcome := "trip_ops"."lock_trip_for_workspace_write"(
        p_agency_id, p_trip_id, p_expected_workspace_revision
      );
      IF lock_outcome <> 'LOCKED' THEN
        RETURN lock_outcome;
      END IF;

      UPDATE "trip_ops"."itinerary_item" AS item
         SET "customerTitle" = p_title,
             "customerDescription" = p_description,
             "customerBookingReference" = p_customer_booking_reference,
             "lockVersion" = item."lockVersion" + 1,
             "updatedAt" = date_trunc('milliseconds', clock_timestamp())
       WHERE item."agencyId" = p_agency_id
         AND item."tripId" = p_trip_id
         AND item."id" = p_item_id
         AND item."family" = 'ACCOMMODATION'
         AND item."lockVersion" = p_expected_lock_version;
      IF NOT FOUND THEN
        IF EXISTS (
          SELECT 1
            FROM "trip_ops"."itinerary_item" AS item
           WHERE item."agencyId" = p_agency_id
             AND item."tripId" = p_trip_id
             AND item."id" = p_item_id
             AND item."family" = 'ACCOMMODATION'
        ) THEN
          RETURN 'STALE';
        END IF;
        RETURN 'NOT_FOUND';
      END IF;

      UPDATE "trip_ops"."accommodation_item_detail" AS detail
         SET "propertyName" = p_property_name,
             "checkInDate" = p_check_in_date,
             "checkInTime" = p_check_in_time,
             "checkInTimezone" = p_check_in_timezone,
             "checkInInstant" = p_check_in_instant,
             "checkOutDate" = p_check_out_date,
             "checkOutTime" = p_check_out_time,
             "checkOutTimezone" = p_check_out_timezone,
             "checkOutInstant" = p_check_out_instant,
             "roomDescription" = p_room_description,
             "boardType" = p_board_type
       WHERE detail."agencyId" = p_agency_id
         AND detail."tripId" = p_trip_id
         AND detail."itemId" = p_item_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Accommodation itinerary item is missing its detail row'
          USING ERRCODE = '55000', CONSTRAINT = 'accommodation_workspace_detail_missing';
      END IF;
      RETURN 'UPDATED';
    END
    $$;

CREATE FUNCTION trip_ops.cas_update_workspace_flight(p_agency_id uuid, p_trip_id uuid, p_item_id uuid, p_expected_workspace_revision bigint, p_expected_lock_version bigint, p_title text, p_description text, p_customer_booking_reference text, p_carrier text, p_flight_number text, p_departure_airport text, p_arrival_airport text, p_departure_date date, p_departure_time time without time zone, p_departure_timezone text, p_departure_instant timestamp with time zone, p_arrival_date date, p_arrival_time time without time zone, p_arrival_timezone text, p_arrival_instant timestamp with time zone, p_terminal text, p_cabin text, p_baggage text, p_seat text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    DECLARE
      lock_outcome text;
    BEGIN
      IF p_item_id IS NULL OR p_expected_lock_version IS NULL OR p_expected_lock_version < 0 OR
         p_title IS NULL OR length(btrim(p_title)) = 0 OR
         p_description IS NULL OR length(btrim(p_description)) = 0 OR
         p_carrier IS NULL OR length(btrim(p_carrier)) = 0 OR
         p_flight_number IS NULL OR length(btrim(p_flight_number)) = 0 THEN
        RAISE EXCEPTION 'Flight workspace update inputs are invalid'
          USING ERRCODE = '22023', CONSTRAINT = 'flight_workspace_update_input';
      END IF;

      lock_outcome := "trip_ops"."lock_trip_for_workspace_write"(
        p_agency_id, p_trip_id, p_expected_workspace_revision
      );
      IF lock_outcome <> 'LOCKED' THEN
        RETURN lock_outcome;
      END IF;

      UPDATE "trip_ops"."itinerary_item" AS item
         SET "customerTitle" = p_title,
             "customerDescription" = p_description,
             "customerBookingReference" = p_customer_booking_reference,
             "lockVersion" = item."lockVersion" + 1,
             "updatedAt" = date_trunc('milliseconds', clock_timestamp())
       WHERE item."agencyId" = p_agency_id
         AND item."tripId" = p_trip_id
         AND item."id" = p_item_id
         AND item."family" = 'FLIGHT'
         AND item."lockVersion" = p_expected_lock_version;
      IF NOT FOUND THEN
        IF EXISTS (
          SELECT 1
            FROM "trip_ops"."itinerary_item" AS item
           WHERE item."agencyId" = p_agency_id
             AND item."tripId" = p_trip_id
             AND item."id" = p_item_id
             AND item."family" = 'FLIGHT'
        ) THEN
          RETURN 'STALE';
        END IF;
        RETURN 'NOT_FOUND';
      END IF;

      UPDATE "trip_ops"."flight_item_detail" AS detail
         SET "carrier" = p_carrier,
             "flightNumber" = p_flight_number,
             "departureAirport" = p_departure_airport,
             "arrivalAirport" = p_arrival_airport,
             "departureDate" = p_departure_date,
             "departureTime" = p_departure_time,
             "departureTimezone" = p_departure_timezone,
             "departureInstant" = p_departure_instant,
             "arrivalDate" = p_arrival_date,
             "arrivalTime" = p_arrival_time,
             "arrivalTimezone" = p_arrival_timezone,
             "arrivalInstant" = p_arrival_instant,
             "terminal" = p_terminal,
             "cabin" = p_cabin,
             "baggage" = p_baggage,
             "seat" = p_seat
       WHERE detail."agencyId" = p_agency_id
         AND detail."tripId" = p_trip_id
         AND detail."itemId" = p_item_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Flight itinerary item is missing its detail row'
          USING ERRCODE = '55000', CONSTRAINT = 'flight_workspace_detail_missing';
      END IF;
      RETURN 'UPDATED';
    END
    $$;

CREATE FUNCTION trip_ops.cas_update_workspace_trip(p_agency_id uuid, p_trip_id uuid, p_expected_workspace_revision bigint, p_expected_lock_version bigint, p_title text, p_start_date date, p_end_date date) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    DECLARE
      lock_outcome text;
    BEGIN
      IF p_expected_lock_version IS NULL OR p_expected_lock_version < 0 OR
         p_title IS NULL OR length(btrim(p_title)) = 0 OR
         p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
        RAISE EXCEPTION 'Trip workspace update inputs are invalid'
          USING ERRCODE = '22023', CONSTRAINT = 'trip_workspace_update_input';
      END IF;

      lock_outcome := "trip_ops"."lock_trip_for_workspace_write"(
        p_agency_id, p_trip_id, p_expected_workspace_revision
      );
      IF lock_outcome <> 'LOCKED' THEN
        RETURN lock_outcome;
      END IF;

      UPDATE "trip_ops"."trip" AS trip
         SET "title" = p_title,
             "startDate" = p_start_date,
             "endDate" = p_end_date,
             "lockVersion" = trip."lockVersion" + 1,
             "updatedAt" = date_trunc('milliseconds', clock_timestamp())
       WHERE trip."agencyId" = p_agency_id
         AND trip."id" = p_trip_id
         AND trip."workspaceRevision" = p_expected_workspace_revision
         AND trip."lockVersion" = p_expected_lock_version;
      IF NOT FOUND THEN
        RETURN 'STALE';
      END IF;
      RETURN 'UPDATED';
    END
    $$;

CREATE FUNCTION trip_ops.ensure_publication_lock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    BEGIN
      INSERT INTO "trip_ops"."publication_lock" ("agencyId", "tripId")
      VALUES (NEW."agencyId", NEW."id")
      ON CONFLICT ("agencyId", "tripId") DO NOTHING;
      RETURN NEW;
    END
    $$;

CREATE FUNCTION trip_ops.guard_share_link_mutation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
    BEGIN
      IF TG_OP = 'UPDATE'
         AND OLD."revokedAt" IS NULL AND NEW."revokedAt" IS NOT NULL
         AND (pg_catalog.to_jsonb(NEW) - 'revokedAt') = (pg_catalog.to_jsonb(OLD) - 'revokedAt') THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Share links are append-only; only revocation is permitted'
        USING ERRCODE = '55000', CONSTRAINT = 'share_link_immutable';
    END
    $$;

CREATE FUNCTION trip_ops.lock_person_continuity(p_agency_id uuid, p_person_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;

CREATE FUNCTION trip_ops.lock_person_continuity_pair(p_old_agency_id uuid, p_old_person_id uuid, p_new_agency_id uuid, p_new_person_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;

CREATE FUNCTION trip_ops.lock_primary_traveller_customer_continuity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;

CREATE FUNCTION trip_ops.lock_trip_for_publication(p_agency_id uuid, p_trip_id uuid) RETURNS TABLE("workspaceRevision" bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    BEGIN
      UPDATE "trip_ops"."publication_lock"
         SET "generation" = "generation" + 1
       WHERE "agencyId" = p_agency_id AND "tripId" = p_trip_id;
      IF NOT FOUND THEN
        RETURN;
      END IF;
      RETURN QUERY
      SELECT trip."workspaceRevision"
        FROM "trip_ops"."trip" AS trip
       WHERE trip."agencyId" = p_agency_id AND trip."id" = p_trip_id
       FOR UPDATE;
    END
    $$;

CREATE FUNCTION trip_ops.lock_trip_for_workspace_write(p_agency_id uuid, p_trip_id uuid, p_expected_workspace_revision bigint) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    DECLARE
      current_workspace_revision bigint;
    BEGIN
      IF session_user <> 'travelos_admin_api' OR
         NOT pg_catalog.pg_has_role(session_user, 'travelos_admin_runtime', 'USAGE') THEN
        RAISE EXCEPTION 'Trip workspace writes are restricted to the Admin runtime'
          USING ERRCODE = '42501', CONSTRAINT = 'trip_workspace_write_role';
      END IF;
      IF p_agency_id IS NULL OR p_trip_id IS NULL OR
         p_expected_workspace_revision IS NULL OR p_expected_workspace_revision < 0 THEN
        RAISE EXCEPTION 'Trip workspace write lock inputs are invalid'
          USING ERRCODE = '22023', CONSTRAINT = 'trip_workspace_write_lock_input';
      END IF;

      SELECT trip."workspaceRevision"
        INTO current_workspace_revision
        FROM "trip_ops"."trip" AS trip
       WHERE trip."agencyId" = p_agency_id
         AND trip."id" = p_trip_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RETURN 'NOT_FOUND';
      END IF;
      IF current_workspace_revision <> p_expected_workspace_revision THEN
        RETURN 'STALE';
      END IF;
      RETURN 'LOCKED';
    END
    $$;

CREATE FUNCTION trip_ops.read_share_snapshot(p_token_hash bytea) RETURNS TABLE("canonicalPayload" text, "expiresAt" timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
      SELECT snapshot."canonicalPayload", link."expiresAt"
        FROM "trip_ops"."share_link" AS link
        JOIN "trip_ops"."publication_snapshot" AS snapshot
          ON snapshot."publicationId" = link."publicationId"
         AND snapshot."agencyId" = link."agencyId"
         AND snapshot."tripId" = link."tripId"
       WHERE link."tokenHash" = p_token_hash
         AND link."revokedAt" IS NULL
         AND link."expiresAt" > pg_catalog.now()
    $$;

CREATE FUNCTION trip_ops.reject_publication_mutation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    BEGIN
      RAISE EXCEPTION 'Committed publication records are immutable'
        USING ERRCODE = '55000', CONSTRAINT = 'publication_immutable';
    END
    $$;

CREATE FUNCTION trip_ops.touch_workspace_revision(p_agency_id uuid, p_trip_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
    DECLARE
      transaction_id xid8;
      revision_touched boolean := false;
    BEGIN
      IF p_agency_id IS NULL OR p_trip_id IS NULL THEN RETURN; END IF;
      transaction_id := pg_catalog.pg_current_xact_id();

      INSERT INTO "trip_ops"."workspace_revision_touch" AS current_touch
        ("agencyId", "tripId", "lastTransactionId")
      SELECT p_agency_id, p_trip_id, transaction_id
       WHERE EXISTS (
         SELECT 1
           FROM "trip_ops"."trip" AS target_trip
          WHERE target_trip."agencyId" = p_agency_id
            AND target_trip."id" = p_trip_id
       )
      ON CONFLICT ("agencyId", "tripId")
      DO UPDATE SET "lastTransactionId" = EXCLUDED."lastTransactionId"
        WHERE current_touch."lastTransactionId" IS DISTINCT FROM EXCLUDED."lastTransactionId"
      RETURNING true INTO revision_touched;

      IF COALESCE(revision_touched, false) THEN
        UPDATE "trip_ops"."trip"
           SET "workspaceRevision" = "workspaceRevision" + 1,
               "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = p_trip_id AND "agencyId" = p_agency_id;
      END IF;
    END
    $$;

CREATE FUNCTION trip_ops.touch_workspace_revision_for_customer(p_agency_id uuid, p_customer_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;

CREATE FUNCTION trip_ops.touch_workspace_revision_for_person(p_agency_id uuid, p_person_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;

CREATE FUNCTION trip_ops.touch_workspace_revision_pair(p_old_agency_id uuid, p_old_trip_id uuid, p_new_agency_id uuid, p_new_trip_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
    $$;



SET default_tablespace = '';

SET default_table_access_method = heap;
  `);

  // Triggers
  pgm.sql(String.raw`
CREATE TRIGGER activity_immutable BEFORE DELETE OR UPDATE ON activity.entry FOR EACH ROW EXECUTE FUNCTION job_runtime.reject_history_mutation();

CREATE TRIGGER activity_source_guard BEFORE INSERT ON activity.entry FOR EACH ROW EXECUTE FUNCTION activity.validate_source();

CREATE TRIGGER lead_entry_immutable_trigger BEFORE DELETE OR UPDATE ON activity.lead_entry FOR EACH ROW EXECUTE FUNCTION sales.reject_lead_history_mutation();

CREATE TRIGGER lead_entry_no_truncate_trigger BEFORE TRUNCATE ON activity.lead_entry FOR EACH STATEMENT EXECUTE FUNCTION sales.reject_lead_history_mutation();

CREATE TRIGGER lead_event_immutable_trigger BEFORE DELETE OR UPDATE ON audit.lead_event FOR EACH ROW EXECUTE FUNCTION sales.reject_lead_history_mutation();

CREATE TRIGGER lead_event_no_truncate_trigger BEFORE TRUNCATE ON audit.lead_event FOR EACH STATEMENT EXECUTE FUNCTION sales.reject_lead_history_mutation();

CREATE TRIGGER staff_invitation_event_immutable_trigger BEFORE DELETE OR UPDATE ON audit.staff_invitation_event FOR EACH ROW EXECUTE FUNCTION audit.reject_staff_invitation_event_mutation();

CREATE TRIGGER staff_invitation_event_no_truncate_trigger BEFORE TRUNCATE ON audit.staff_invitation_event FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_staff_invitation_event_mutation();

CREATE TRIGGER customer_projection_revision_trigger AFTER DELETE OR UPDATE OF "displayName" ON crm.customer FOR EACH ROW EXECUTE FUNCTION trip_ops.bump_customer_projection_revision();

CREATE TRIGGER customer_person_continuity_lock_trigger BEFORE INSERT OR DELETE OR UPDATE ON crm.customer_person FOR EACH ROW EXECUTE FUNCTION trip_ops.lock_primary_traveller_customer_continuity();

CREATE TRIGGER customer_person_projection_revision_trigger AFTER INSERT OR DELETE OR UPDATE ON crm.customer_person FOR EACH ROW EXECUTE FUNCTION trip_ops.bump_customer_person_projection_revision();

CREATE CONSTRAINT TRIGGER trip_primary_traveller_customer_continuity_on_customer_person_t AFTER INSERT OR DELETE OR UPDATE ON crm.customer_person DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trip_ops.assert_primary_traveller_customer_continuity();

CREATE TRIGGER person_projection_revision_trigger AFTER DELETE OR UPDATE OF "givenName", "familyName", email ON crm.person FOR EACH ROW EXECUTE FUNCTION trip_ops.bump_person_projection_revision();

CREATE TRIGGER context_immutable BEFORE DELETE OR UPDATE ON integration.event_context FOR EACH ROW EXECUTE FUNCTION job_runtime.reject_history_mutation();

CREATE TRIGGER lead_outbox_immutable_trigger BEFORE DELETE OR UPDATE ON integration.lead_outbox FOR EACH ROW EXECUTE FUNCTION sales.reject_lead_history_mutation();

CREATE TRIGGER lead_outbox_no_truncate_trigger BEFORE TRUNCATE ON integration.lead_outbox FOR EACH STATEMENT EXECUTE FUNCTION sales.reject_lead_history_mutation();

CREATE TRIGGER publication_capture_context AFTER INSERT ON integration.trip_publication_outbox FOR EACH ROW EXECUTE FUNCTION integration.capture_event_context();

CREATE TRIGGER publication_outbox_immutable_trigger BEFORE DELETE OR UPDATE ON integration.trip_publication_outbox FOR EACH ROW EXECUTE FUNCTION trip_ops.reject_publication_mutation();

CREATE TRIGGER attempt_immutable BEFORE DELETE OR UPDATE ON job_runtime.attempt FOR EACH ROW EXECUTE FUNCTION job_runtime.reject_history_mutation();

CREATE TRIGGER agency_visibility_workspace_revision_trigger AFTER INSERT OR DELETE OR UPDATE ON presentation.agency_publication_visibility FOR EACH ROW EXECUTE FUNCTION presentation.touch_agency_publication_visibility_revision();

CREATE TRIGGER item_visibility_family_trigger BEFORE INSERT OR UPDATE ON presentation.item_publication_visibility FOR EACH ROW EXECUTE FUNCTION presentation.assert_visibility_field_family();

CREATE TRIGGER item_visibility_workspace_revision_trigger AFTER INSERT OR DELETE OR UPDATE ON presentation.item_publication_visibility FOR EACH ROW EXECUTE FUNCTION presentation.touch_item_publication_visibility_revision();

CREATE TRIGGER lead_transition_trigger BEFORE UPDATE ON sales.lead FOR EACH ROW EXECUTE FUNCTION sales.enforce_lead_transition();

CREATE TRIGGER lead_idempotency_immutable_trigger BEFORE DELETE OR UPDATE ON sales.lead_idempotency FOR EACH ROW EXECUTE FUNCTION sales.reject_lead_history_mutation();

CREATE TRIGGER owner_template_identity_trigger BEFORE UPDATE OF "templateKey" ON staff_access.role FOR EACH ROW EXECUTE FUNCTION staff_access.protect_owner_template_identity();

CREATE TRIGGER last_owner_assignment_trigger BEFORE DELETE OR UPDATE ON staff_access.role_assignment FOR EACH ROW EXECUTE FUNCTION staff_access.protect_last_active_owner_assignment();

CREATE TRIGGER role_assignment_epoch_trigger AFTER INSERT OR DELETE OR UPDATE ON staff_access.role_assignment FOR EACH ROW EXECUTE FUNCTION staff_access.bump_membership_epoch_for_assignment();

CREATE TRIGGER role_permission_epoch_trigger AFTER INSERT OR DELETE OR UPDATE ON staff_access.role_permission FOR EACH ROW EXECUTE FUNCTION staff_access.bump_membership_epoch_for_role_permission();

CREATE TRIGGER last_owner_membership_trigger BEFORE UPDATE OF state ON staff_access.staff_membership FOR EACH ROW EXECUTE FUNCTION staff_access.protect_last_active_owner_membership();

CREATE TRIGGER staff_membership_epoch_trigger BEFORE UPDATE OF state ON staff_access.staff_membership FOR EACH ROW EXECUTE FUNCTION staff_access.bump_membership_epoch_for_state();

CREATE CONSTRAINT TRIGGER accommodation_item_family_trigger AFTER INSERT OR DELETE OR UPDATE ON trip_ops.accommodation_item_detail DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trip_ops.assert_one_family_detail();

CREATE TRIGGER accommodation_temporal_policy_trigger BEFORE INSERT OR UPDATE ON trip_ops.accommodation_item_detail FOR EACH ROW EXECUTE FUNCTION trip_ops.assert_accommodation_temporal_policy();

CREATE TRIGGER accommodation_workspace_revision_trigger AFTER INSERT OR DELETE OR UPDATE ON trip_ops.accommodation_item_detail FOR EACH ROW EXECUTE FUNCTION trip_ops.bump_workspace_revision();

CREATE CONSTRAINT TRIGGER flight_item_family_trigger AFTER INSERT OR DELETE OR UPDATE ON trip_ops.flight_item_detail DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trip_ops.assert_one_family_detail();

CREATE TRIGGER flight_temporal_policy_trigger BEFORE INSERT OR UPDATE ON trip_ops.flight_item_detail FOR EACH ROW EXECUTE FUNCTION trip_ops.assert_flight_temporal_policy();

CREATE TRIGGER flight_workspace_revision_trigger AFTER INSERT OR DELETE OR UPDATE ON trip_ops.flight_item_detail FOR EACH ROW EXECUTE FUNCTION trip_ops.bump_workspace_revision();

CREATE CONSTRAINT TRIGGER itinerary_item_family_on_item_trigger AFTER INSERT OR DELETE OR UPDATE ON trip_ops.itinerary_item DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trip_ops.assert_one_family_detail();

CREATE TRIGGER itinerary_workspace_revision_trigger AFTER INSERT OR UPDATE OF family, state, "sortOrder", "customerTitle", "customerDescription", "customerBookingReference" ON trip_ops.itinerary_item FOR EACH ROW EXECUTE FUNCTION trip_ops.bump_workspace_revision();

CREATE TRIGGER publication_event_immutable_trigger BEFORE DELETE OR UPDATE ON trip_ops.publication_event FOR EACH ROW EXECUTE FUNCTION trip_ops.reject_publication_mutation();

CREATE TRIGGER publication_snapshot_immutable_trigger BEFORE DELETE OR UPDATE ON trip_ops.publication_snapshot FOR EACH ROW EXECUTE FUNCTION trip_ops.reject_publication_mutation();

CREATE TRIGGER publication_version_immutable_trigger BEFORE DELETE OR UPDATE ON trip_ops.publication_version FOR EACH ROW EXECUTE FUNCTION trip_ops.reject_publication_mutation();

CREATE TRIGGER reservation_workspace_revision_trigger AFTER INSERT OR DELETE OR UPDATE ON trip_ops.reservation FOR EACH ROW EXECUTE FUNCTION trip_ops.bump_workspace_revision();

CREATE TRIGGER reservation_link_workspace_revision_trigger AFTER INSERT OR DELETE OR UPDATE ON trip_ops.reservation_item_link FOR EACH ROW EXECUTE FUNCTION trip_ops.bump_workspace_revision();

CREATE TRIGGER share_link_row_guard_trigger BEFORE DELETE OR UPDATE ON trip_ops.share_link FOR EACH ROW EXECUTE FUNCTION trip_ops.guard_share_link_mutation();

CREATE TRIGGER share_link_truncate_guard_trigger BEFORE TRUNCATE ON trip_ops.share_link FOR EACH STATEMENT EXECUTE FUNCTION trip_ops.guard_share_link_mutation();

CREATE CONSTRAINT TRIGGER trip_primary_traveller_exactly_one_on_trip_trigger AFTER INSERT OR UPDATE OF "agencyId", title, "startDate", "endDate", state ON trip_ops.trip DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trip_ops.assert_exactly_one_primary_traveller();

CREATE TRIGGER trip_publication_lock_trigger AFTER INSERT ON trip_ops.trip FOR EACH ROW EXECUTE FUNCTION trip_ops.ensure_publication_lock();

CREATE CONSTRAINT TRIGGER trip_workspace_revision_trigger AFTER INSERT OR UPDATE OF title, "startDate", "endDate", state ON trip_ops.trip DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION trip_ops.bump_workspace_revision();

CREATE CONSTRAINT TRIGGER trip_primary_traveller_customer_continuity_on_traveller_trigger AFTER INSERT OR DELETE OR UPDATE ON trip_ops.trip_traveller DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trip_ops.assert_primary_traveller_customer_continuity();

CREATE CONSTRAINT TRIGGER trip_primary_traveller_exactly_one_on_traveller_trigger AFTER INSERT OR DELETE OR UPDATE ON trip_ops.trip_traveller DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trip_ops.assert_exactly_one_primary_traveller();

CREATE TRIGGER trip_traveller_continuity_lock_trigger BEFORE INSERT OR DELETE OR UPDATE ON trip_ops.trip_traveller FOR EACH ROW EXECUTE FUNCTION trip_ops.lock_primary_traveller_customer_continuity();

CREATE TRIGGER trip_traveller_workspace_revision_trigger AFTER INSERT OR DELETE OR UPDATE ON trip_ops.trip_traveller FOR EACH ROW EXECUTE FUNCTION trip_ops.bump_workspace_revision();
  `);

  // Seed data (the only data the schema itself owns)
  pgm.sql(String.raw`
INSERT INTO finance.currency_registry ("currencyCode", scale) VALUES
  ('EUR', 2), ('USD', 2), ('GBP', 2), ('JPY', 0);
  `);

  // Runtime role grants (explicit allowlist; PUBLIC and unlisted roles hold nothing)
  pgm.sql(String.raw`
-- travelos_admin_runtime
GRANT USAGE ON SCHEMA activity, audit, crm, finance, integration, organization, presentation, sales, staff_access, trip_ops TO travelos_admin_runtime;
GRANT SELECT, INSERT ON TABLE activity.lead_entry TO travelos_admin_runtime;
GRANT SELECT, INSERT ON TABLE audit.lead_event, audit.staff_invitation_event TO travelos_admin_runtime;
GRANT SELECT ON TABLE crm.customer, crm.person TO travelos_admin_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE crm.customer_person TO travelos_admin_runtime;
GRANT SELECT ON TABLE finance.currency_registry, finance.supplier_cost_line TO travelos_admin_runtime;
GRANT INSERT ON TABLE integration.trip_publication_outbox TO travelos_admin_runtime;
GRANT SELECT, INSERT ON TABLE integration.lead_outbox TO travelos_admin_runtime;
GRANT SELECT, INSERT ON TABLE organization.agency_bootstrap_audit TO travelos_admin_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE organization.agency TO travelos_admin_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE presentation.agency_publication_visibility, presentation.item_publication_visibility TO travelos_admin_runtime;
GRANT SELECT, INSERT ON TABLE sales.lead_idempotency TO travelos_admin_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE sales.lead TO travelos_admin_runtime;
GRANT SELECT, INSERT ON TABLE staff_access.operator_bootstrap_audit TO travelos_admin_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE staff_access.operator_bootstrap_invitation, staff_access.role, staff_access.role_assignment, staff_access.role_permission, staff_access.staff_invitation, staff_access.staff_membership, staff_access.staff_session_context TO travelos_admin_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE staff_access.staff_account, staff_access.staff_session, staff_access.staff_two_factor, staff_access.staff_user, staff_access.staff_verification TO travelos_admin_runtime;
GRANT INSERT ON TABLE trip_ops.publication_event TO travelos_admin_runtime;
GRANT SELECT ON TABLE trip_ops.itinerary_item, trip_ops.reservation, trip_ops.trip TO travelos_admin_runtime;
GRANT SELECT, INSERT ON TABLE trip_ops.accommodation_item_detail, trip_ops.flight_item_detail, trip_ops.publication_snapshot, trip_ops.publication_version, trip_ops.share_link TO travelos_admin_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE trip_ops.reservation_item_link, trip_ops.trip_traveller TO travelos_admin_runtime;
GRANT INSERT ("agencyId", "displayName", "id") ON TABLE crm.customer TO travelos_admin_runtime;
GRANT INSERT ("agencyId", "email", "familyName", "givenName", "id") ON TABLE crm.person TO travelos_admin_runtime;
GRANT INSERT ("agencyId", "amountMinor", "classification", "currencyCode", "currencyScale", "id", "internalNote", "reservationId", "tripId") ON TABLE finance.supplier_cost_line TO travelos_admin_runtime;
GRANT INSERT ("agencyId", "customerBookingReference", "customerDescription", "customerTitle", "family", "id", "sortOrder", "state", "tripId") ON TABLE trip_ops.itinerary_item TO travelos_admin_runtime;
GRANT INSERT ("agencyId", "customerBookingReference", "id", "state", "supplierName", "supplierReference", "tripId") ON TABLE trip_ops.reservation TO travelos_admin_runtime;
GRANT UPDATE ("revokedAt") ON TABLE trip_ops.share_link TO travelos_admin_runtime;
GRANT INSERT ("agencyId", "endDate", "id", "startDate", "state", "title") ON TABLE trip_ops.trip TO travelos_admin_runtime;
GRANT EXECUTE ON FUNCTION trip_ops.cas_update_accommodation_presentation(uuid, uuid, uuid, bigint, text, text) TO travelos_admin_runtime;
GRANT EXECUTE ON FUNCTION trip_ops.cas_update_supplier_cost_internal_note(uuid, uuid, uuid, bigint, text) TO travelos_admin_runtime;
GRANT EXECUTE ON FUNCTION trip_ops.cas_update_workspace_accommodation(uuid, uuid, uuid, bigint, bigint, text, text, text, text, date, time without time zone, text, timestamp with time zone, date, time without time zone, text, timestamp with time zone, text, text) TO travelos_admin_runtime;
GRANT EXECUTE ON FUNCTION trip_ops.cas_update_workspace_flight(uuid, uuid, uuid, bigint, bigint, text, text, text, text, text, text, text, date, time without time zone, text, timestamp with time zone, date, time without time zone, text, timestamp with time zone, text, text, text, text) TO travelos_admin_runtime;
GRANT EXECUTE ON FUNCTION trip_ops.cas_update_workspace_trip(uuid, uuid, bigint, bigint, text, date, date) TO travelos_admin_runtime;
GRANT EXECUTE ON FUNCTION trip_ops.lock_trip_for_publication(uuid, uuid) TO travelos_admin_runtime;
GRANT EXECUTE ON FUNCTION trip_ops.lock_trip_for_workspace_write(uuid, uuid, bigint) TO travelos_admin_runtime;
GRANT EXECUTE ON FUNCTION trip_ops.read_share_snapshot(bytea) TO travelos_admin_runtime;
-- travelos_worker_runtime
GRANT USAGE ON SCHEMA activity, integration, job_runtime TO travelos_worker_runtime;
GRANT SELECT, INSERT ON TABLE activity.entry TO travelos_worker_runtime;
GRANT SELECT ON TABLE integration.activity_source, integration.event_context TO travelos_worker_runtime;
GRANT SELECT, INSERT ON TABLE integration.outbox_delivery TO travelos_worker_runtime;
GRANT SELECT, INSERT ON TABLE job_runtime.attempt, job_runtime.job TO travelos_worker_runtime;
GRANT UPDATE ("completedAt", "state") ON TABLE integration.outbox_delivery TO travelos_worker_runtime;
GRANT UPDATE ("attempt", "deadline", "errorCode", "leaseUntil", "owner", "runAt", "state", "version") ON TABLE job_runtime.job TO travelos_worker_runtime;
  `);

  // Comments
  pgm.sql(String.raw`
COMMENT ON TABLE activity.lead_entry IS 'Append-only operational timeline entry for Lead qualification/disqualification; identifiers only.';
COMMENT ON TABLE audit.lead_event IS 'Append-only Lead qualification/disqualification evidence; identifiers, versions and a categorical reason only, never contact data.';
COMMENT ON COLUMN crm.customer."lockVersion" IS 'Non-negative PostgreSQL bigint optimistic-concurrency token; created at zero and updated only by a protected compare-and-swap command';
COMMENT ON COLUMN crm.person."lockVersion" IS 'Non-negative PostgreSQL bigint optimistic-concurrency token; created at zero and updated only by a protected compare-and-swap command';
COMMENT ON TABLE crm.customer IS 'Commercial Agency relationship, distinct from Person';
COMMENT ON TABLE crm.person IS 'CRM natural person; no Staff identity authority';
COMMENT ON COLUMN finance.supplier_cost_line."lockVersion" IS 'Non-negative PostgreSQL bigint optimistic-concurrency token; created at zero and updated only by a protected compare-and-swap command';
COMMENT ON TABLE finance.supplier_cost_line IS 'Restricted INTERNAL_ONLY exact Money sentinel; no customer-facing contract/source';
COMMENT ON TABLE integration.lead_outbox IS 'Transactional outbox for LeadQualified/LeadDisqualified; carries only identifiers and versions. Delivery is deferred.';
COMMENT ON TABLE integration.trip_publication_outbox IS 'Transactional Stage 6 publication signal; delivery is deferred to the accepted worker stage.';
COMMENT ON VIEW integration.activity_source IS 'Internal identifiers only; no workspace or authentication payload. ACTIVITY_V1 only.';
COMMENT ON TABLE job_runtime.job IS 'At-least-once ACTIVITY_V1 executor: at most two live claims, five attempts, 15s renewable lease and 60s hard deadline.';
COMMENT ON TABLE organization.agency IS 'One root Agency is allowed per TravelOS deployment';
COMMENT ON COLUMN sales.lead."contactEmail" IS 'CONFIDENTIAL_PERSONAL contact snapshot; never used to auto-link Persons or Customers.';
COMMENT ON COLUMN sales.lead."internalNote" IS 'INTERNAL_ONLY free text; no customer-facing contract, source field or override exists.';
COMMENT ON TABLE sales.lead IS 'M2 Lead: unqualified commercial interest retained after qualification. Contact fields are CONFIDENTIAL_PERSONAL; internalNote is INTERNAL_ONLY. No customer-facing privilege or contract.';
COMMENT ON TABLE sales.lead_idempotency IS 'Immutable Agency- and Staff-scoped idempotency keys for retryable Lead commands.';
COMMENT ON TABLE staff_access.role_assignment IS 'Explicit agency or future organization-unit scope assignment';
COMMENT ON TABLE staff_access.staff_membership IS 'TravelOS-owned Staff authorization membership, not Better Auth identity';
COMMENT ON TABLE staff_access.staff_user IS 'Better Auth Staff realm principal mechanics only';
COMMENT ON COLUMN trip_ops.itinerary_item."lockVersion" IS 'Non-negative PostgreSQL bigint optimistic-concurrency token; created at zero and updated only by a protected compare-and-swap command';
COMMENT ON COLUMN trip_ops.reservation."lockVersion" IS 'Non-negative PostgreSQL bigint optimistic-concurrency token; created at zero and updated only by a protected compare-and-swap command';
COMMENT ON COLUMN trip_ops.trip."lockVersion" IS 'Non-negative PostgreSQL bigint optimistic-concurrency token; created at zero and updated only by a protected compare-and-swap command';
COMMENT ON TABLE trip_ops.itinerary_item IS 'Typed structured presentation item; Reservation remains separate';
COMMENT ON TABLE trip_ops.publication_version IS 'Append-only customer-safe immutable Trip snapshots; current selection is held separately.';
COMMENT ON TABLE trip_ops.reservation_item_link IS 'Explicit same-Agency/same-Trip many-to-many association';
COMMENT ON TABLE trip_ops.share_link IS 'Revocable, expiring read-only customer links. Stores SHA-256 of the token only; never the token.';
COMMENT ON TABLE trip_ops.trip IS 'Mutable M1 workspace aggregate with monotonic publication-relevant revision';
COMMENT ON TABLE trip_ops.workspace_revision_touch IS 'Protected transaction-deduplication state for workspace revision triggers; one row per touched Trip, owned by travelos_owner';
  `);
};

exports.down = () => {
  throw new Error(
    "0001_baseline is forward-only: restore a backup or roll forward with a new migration",
  );
};
