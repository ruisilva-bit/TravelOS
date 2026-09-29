const ownerTemplateKey = "agency-owner-v1";

exports.up = (pgm) => {
  pgm.sql(`
    DO $migration_context$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
    END
    $migration_context$;

    CREATE TABLE "organization"."agency" (
      "id" uuid PRIMARY KEY,
      "bootstrapReference" text NOT NULL UNIQUE,
      "slug" text NOT NULL UNIQUE,
      "isRoot" boolean NOT NULL DEFAULT true CHECK ("isRoot"),
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lockVersion" integer NOT NULL DEFAULT 1 CHECK ("lockVersion" > 0)
    );
    CREATE UNIQUE INDEX "agency_single_root_idx" ON "organization"."agency" ((true));

    CREATE TABLE "organization"."agency_bootstrap_audit" (
      "id" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "eventType" text NOT NULL CHECK ("eventType" IN ('ROOT_AGENCY_CREATED', 'ROOT_AGENCY_RERUN')),
      "operatorIdentity" text NOT NULL,
      "occurredAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE "staff_access"."staff_membership" (
      "id" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "staffPrincipalId" text NOT NULL REFERENCES "staff_access"."staff_user" ("id") ON DELETE RESTRICT,
      "state" text NOT NULL CHECK ("state" IN ('ACTIVE', 'DISABLED', 'REVOKED')),
      "authorizationEpoch" bigint NOT NULL DEFAULT 1 CHECK ("authorizationEpoch" > 0),
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "revokedAt" timestamptz,
      CONSTRAINT "staff_membership_unique_agency_principal" UNIQUE ("agencyId", "staffPrincipalId"),
      CONSTRAINT "staff_membership_id_agency_unique" UNIQUE ("id", "agencyId"),
      CONSTRAINT "staff_membership_revocation_state" CHECK (
        ("state" = 'REVOKED' AND "revokedAt" IS NOT NULL) OR
        ("state" <> 'REVOKED' AND "revokedAt" IS NULL)
      )
    );

    CREATE TABLE "staff_access"."staff_session_context" (
      "sessionId" text PRIMARY KEY,
      "staffPrincipalId" text NOT NULL,
      "agencyId" uuid NOT NULL,
      "authorizationEpoch" bigint NOT NULL CHECK ("authorizationEpoch" > 0),
      "recentMfaVerifiedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "staff_session_context_session_principal_fk"
        FOREIGN KEY ("sessionId", "staffPrincipalId")
        REFERENCES "staff_access"."staff_session" ("id", "userId") ON DELETE CASCADE,
      CONSTRAINT "staff_session_context_membership_fk"
        FOREIGN KEY ("agencyId", "staffPrincipalId")
        REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId") ON DELETE RESTRICT
    );
    CREATE INDEX "staff_session_context_principal_idx"
      ON "staff_access"."staff_session_context" ("staffPrincipalId");

    CREATE TABLE "staff_access"."role" (
      "id" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "templateKey" text,
      "displayName" text NOT NULL,
      "isSystemTemplate" boolean NOT NULL DEFAULT false,
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lockVersion" integer NOT NULL DEFAULT 1 CHECK ("lockVersion" > 0),
      CONSTRAINT "role_unique_agency_display_name" UNIQUE ("agencyId", "displayName"),
      CONSTRAINT "role_id_agency_unique" UNIQUE ("id", "agencyId"),
      CONSTRAINT "role_system_template_key" CHECK (
        ("isSystemTemplate" AND "templateKey" IS NOT NULL) OR
        (NOT "isSystemTemplate")
      )
    );
    CREATE UNIQUE INDEX "role_unique_agency_template_key_idx"
      ON "staff_access"."role" ("agencyId", "templateKey")
      WHERE "templateKey" IS NOT NULL;

    CREATE TABLE "staff_access"."role_permission" (
      "roleId" uuid NOT NULL REFERENCES "staff_access"."role" ("id") ON DELETE CASCADE,
      "permissionId" text NOT NULL,
      "scopeKind" text NOT NULL CHECK ("scopeKind" IN ('AGENCY', 'ORGANIZATION_UNIT')),
      "accessLevel" text NOT NULL CHECK ("accessLevel" IN ('OWN', 'TEAM', 'ALL')),
      PRIMARY KEY ("roleId", "permissionId", "scopeKind", "accessLevel")
    );

    CREATE TABLE "staff_access"."role_assignment" (
      "id" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "membershipId" uuid NOT NULL,
      "roleId" uuid NOT NULL,
      "scopeKind" text NOT NULL CHECK ("scopeKind" IN ('AGENCY', 'ORGANIZATION_UNIT')),
      "organizationUnitId" uuid,
      "active" boolean NOT NULL DEFAULT true,
      "assignedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "revokedAt" timestamptz,
      CONSTRAINT "role_assignment_membership_agency_fk"
        FOREIGN KEY ("membershipId", "agencyId")
        REFERENCES "staff_access"."staff_membership" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "role_assignment_role_agency_fk"
        FOREIGN KEY ("roleId", "agencyId")
        REFERENCES "staff_access"."role" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "role_assignment_scope_shape" CHECK (
        ("scopeKind" = 'AGENCY' AND "organizationUnitId" IS NULL) OR
        ("scopeKind" = 'ORGANIZATION_UNIT' AND "organizationUnitId" IS NOT NULL)
      ),
      CONSTRAINT "role_assignment_revocation_state" CHECK (
        ("active" AND "revokedAt" IS NULL) OR
        (NOT "active" AND "revokedAt" IS NOT NULL)
      )
    );
    CREATE INDEX "role_assignment_membership_active_idx"
      ON "staff_access"."role_assignment" ("membershipId") WHERE "active";

    CREATE TABLE "staff_access"."operator_bootstrap_invitation" (
      "id" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL UNIQUE REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "targetEmail" text NOT NULL,
      "tokenDigest" char(64) NOT NULL UNIQUE,
      "state" text NOT NULL CHECK ("state" IN ('PENDING', 'CONSUMED', 'EXPIRED')),
      "expiresAt" timestamptz NOT NULL,
      "consumedAt" timestamptz,
      "staffPrincipalId" text REFERENCES "staff_access"."staff_user" ("id") ON DELETE RESTRICT,
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "operator_bootstrap_consumed_state" CHECK (
        ("state" = 'CONSUMED' AND "consumedAt" IS NOT NULL AND "staffPrincipalId" IS NOT NULL) OR
        ("state" <> 'CONSUMED' AND "consumedAt" IS NULL AND "staffPrincipalId" IS NULL)
      )
    );

    CREATE TABLE "staff_access"."operator_bootstrap_audit" (
      "id" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      "invitationId" uuid NOT NULL REFERENCES "staff_access"."operator_bootstrap_invitation" ("id") ON DELETE RESTRICT,
      "eventType" text NOT NULL CHECK ("eventType" IN ('OWNER_INVITATION_ISSUED', 'OWNER_INVITATION_REISSUED', 'OWNER_INVITATION_CONSUMED', 'OWNER_INVITATION_REJECTED')),
      "operatorIdentity" text NOT NULL,
      "occurredAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE OR REPLACE FUNCTION "staff_access"."bump_membership_epoch_for_assignment"()
    RETURNS trigger LANGUAGE plpgsql AS $epoch_assignment$
    BEGIN
      UPDATE "staff_access"."staff_membership"
         SET "authorizationEpoch" = "authorizationEpoch" + 1,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."membershipId" ELSE NEW."membershipId" END;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END
    $epoch_assignment$;

    CREATE OR REPLACE FUNCTION "staff_access"."bump_membership_epoch_for_role_permission"()
    RETURNS trigger LANGUAGE plpgsql AS $epoch_role_permission$
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
    $epoch_role_permission$;

    CREATE OR REPLACE FUNCTION "staff_access"."bump_membership_epoch_for_state"()
    RETURNS trigger LANGUAGE plpgsql AS $epoch_membership_state$
    BEGIN
      IF NEW."state" IS DISTINCT FROM OLD."state" THEN
        NEW."authorizationEpoch" := OLD."authorizationEpoch" + 1;
        NEW."updatedAt" := CURRENT_TIMESTAMP;
      END IF;
      RETURN NEW;
    END
    $epoch_membership_state$;

    CREATE OR REPLACE FUNCTION "staff_access"."protect_last_active_owner_assignment"()
    RETURNS trigger LANGUAGE plpgsql AS $last_owner_assignment$
    DECLARE
      owner_count integer;
      affected_role_id uuid;
      affected_membership_id uuid;
      affected_agency_id uuid;
    BEGIN
      affected_role_id := OLD."roleId";
      affected_membership_id := OLD."membershipId";
      affected_agency_id := OLD."agencyId";
      IF NOT EXISTS (
        SELECT 1 FROM "staff_access"."role"
        WHERE "id" = affected_role_id AND "templateKey" = '${ownerTemplateKey}'
      ) THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;
      IF TG_OP = 'UPDATE' AND NEW."active" AND NEW."roleId" = OLD."roleId" THEN
        RETURN NEW;
      END IF;
      SELECT count(*) INTO owner_count
        FROM "staff_access"."role_assignment" AS assignment
        JOIN "staff_access"."staff_membership" AS membership ON membership."id" = assignment."membershipId"
        JOIN "staff_access"."role" AS role ON role."id" = assignment."roleId"
       WHERE assignment."agencyId" = affected_agency_id
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

    CREATE OR REPLACE FUNCTION "staff_access"."protect_owner_template_identity"()
    RETURNS trigger LANGUAGE plpgsql AS $owner_template_identity$
    BEGIN
      IF OLD."templateKey" = '${ownerTemplateKey}'
         AND NEW."templateKey" IS DISTINCT FROM OLD."templateKey" THEN
        RAISE EXCEPTION 'Owner role template identity is immutable' USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END
    $owner_template_identity$;

    CREATE TRIGGER "role_assignment_epoch_trigger"
      AFTER INSERT OR UPDATE OR DELETE ON "staff_access"."role_assignment"
      FOR EACH ROW EXECUTE FUNCTION "staff_access"."bump_membership_epoch_for_assignment"();
    CREATE TRIGGER "role_permission_epoch_trigger"
      AFTER INSERT OR UPDATE OR DELETE ON "staff_access"."role_permission"
      FOR EACH ROW EXECUTE FUNCTION "staff_access"."bump_membership_epoch_for_role_permission"();
    CREATE TRIGGER "staff_membership_epoch_trigger"
      BEFORE UPDATE OF "state" ON "staff_access"."staff_membership"
      FOR EACH ROW EXECUTE FUNCTION "staff_access"."bump_membership_epoch_for_state"();
    CREATE TRIGGER "last_owner_assignment_trigger"
      BEFORE UPDATE OR DELETE ON "staff_access"."role_assignment"
      FOR EACH ROW EXECUTE FUNCTION "staff_access"."protect_last_active_owner_assignment"();
    CREATE TRIGGER "last_owner_membership_trigger"
      BEFORE UPDATE OF "state" ON "staff_access"."staff_membership"
      FOR EACH ROW EXECUTE FUNCTION "staff_access"."protect_last_active_owner_membership"();
    CREATE TRIGGER "owner_template_identity_trigger"
      BEFORE UPDATE OF "templateKey" ON "staff_access"."role"
      FOR EACH ROW EXECUTE FUNCTION "staff_access"."protect_owner_template_identity"();

    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "organization" FROM PUBLIC, "travelos_portal_runtime", "travelos_worker_runtime";
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "staff_access" FROM PUBLIC, "travelos_portal_runtime", "travelos_worker_runtime";
    REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA "staff_access" FROM PUBLIC, "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";

    GRANT USAGE ON SCHEMA "organization" TO "travelos_admin_runtime";
    GRANT SELECT, INSERT, UPDATE ON TABLE
      "organization"."agency",
      "organization"."agency_bootstrap_audit"
      TO "travelos_admin_runtime";
    GRANT SELECT, INSERT, UPDATE ON TABLE
      "staff_access"."staff_membership",
      "staff_access"."staff_session_context",
      "staff_access"."role",
      "staff_access"."role_permission",
      "staff_access"."role_assignment",
      "staff_access"."operator_bootstrap_invitation",
      "staff_access"."operator_bootstrap_audit"
      TO "travelos_admin_runtime";

    COMMENT ON TABLE "organization"."agency" IS 'One root Agency is allowed per TravelOS deployment';
    COMMENT ON TABLE "staff_access"."staff_membership" IS 'TravelOS-owned Staff authorization membership, not Better Auth identity';
    COMMENT ON TABLE "staff_access"."role_assignment" IS 'Explicit agency or future organization-unit scope assignment';
  `);
};

exports.down = false;
