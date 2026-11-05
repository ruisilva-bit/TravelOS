const tripOperationsRoleTemplateKey = "trip-operations-v1";
const tripOperationsPermissions = [
  "agency.view",
  "customer.edit",
  "traveller.edit",
  "trip.view",
  "trip.edit",
  "trip.preview",
  "trip.publish",
  "trip.access.manage",
];

const createUuidV7 = () => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  let timestamp = BigInt(Date.now());
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hexadecimal = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hexadecimal.slice(0, 8)}-${hexadecimal.slice(8, 12)}-${hexadecimal.slice(12, 16)}-${hexadecimal.slice(16, 20)}-${hexadecimal.slice(20)}`;
};

exports.up = (pgm) => {
  const tripOperationsRoleId = createUuidV7();
  const expectedPermissionValues = tripOperationsPermissions
    .map((permissionId) => `('${permissionId}', 'AGENCY', 'ALL')`)
    .join(",\n          ");

  pgm.sql(`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '60s';

    DO $migration_context$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
      IF (SELECT count(*) FROM "organization"."agency" WHERE "isRoot") <> 1 THEN
        RAISE EXCEPTION 'Stage 9 Staff invitations require exactly one established root Agency';
      END IF;
    END
    $migration_context$;

    INSERT INTO "staff_access"."role"
      ("id", "agencyId", "templateKey", "displayName", "isSystemTemplate")
    SELECT '${tripOperationsRoleId}'::uuid,
           agency."id",
           '${tripOperationsRoleTemplateKey}',
           'Trip Operations',
           true
      FROM "organization"."agency" AS agency
     WHERE agency."isRoot"
    ON CONFLICT ("agencyId", "templateKey") WHERE "templateKey" IS NOT NULL DO NOTHING;

    DO $trip_operations_role$
    DECLARE
      root_agency_id uuid;
      trip_operations_role_id uuid;
      expected_display_name text;
      expected_system_template boolean;
    BEGIN
      SELECT agency."id"
        INTO STRICT root_agency_id
        FROM "organization"."agency" AS agency
       WHERE agency."isRoot";

      SELECT role."id", role."displayName", role."isSystemTemplate"
        INTO STRICT trip_operations_role_id, expected_display_name, expected_system_template
        FROM "staff_access"."role" AS role
       WHERE role."agencyId" = root_agency_id
         AND role."templateKey" = '${tripOperationsRoleTemplateKey}'
       FOR UPDATE;

      IF expected_display_name <> 'Trip Operations' OR NOT expected_system_template THEN
        RAISE EXCEPTION 'The code-owned Trip Operations role has an unexpected shape';
      END IF;

      INSERT INTO "staff_access"."role_permission"
        ("roleId", "permissionId", "scopeKind", "accessLevel")
      SELECT trip_operations_role_id, expected."permissionId", expected."scopeKind", expected."accessLevel"
        FROM (VALUES
          ${expectedPermissionValues}
        ) AS expected("permissionId", "scopeKind", "accessLevel")
      ON CONFLICT DO NOTHING;

      IF EXISTS (
        SELECT "permissionId", "scopeKind", "accessLevel"
          FROM (VALUES
            ${expectedPermissionValues}
          ) AS expected("permissionId", "scopeKind", "accessLevel")
        EXCEPT
        SELECT permission."permissionId", permission."scopeKind", permission."accessLevel"
          FROM "staff_access"."role_permission" AS permission
         WHERE permission."roleId" = trip_operations_role_id
      ) OR EXISTS (
        SELECT permission."permissionId", permission."scopeKind", permission."accessLevel"
          FROM "staff_access"."role_permission" AS permission
         WHERE permission."roleId" = trip_operations_role_id
        EXCEPT
        SELECT "permissionId", "scopeKind", "accessLevel"
          FROM (VALUES
            ${expectedPermissionValues}
          ) AS expected("permissionId", "scopeKind", "accessLevel")
      ) THEN
        RAISE EXCEPTION 'The code-owned Trip Operations role permissions differ from the exact Stage 9 allowlist';
      END IF;
    END
    $trip_operations_role$;

    CREATE TABLE "staff_access"."staff_invitation" (
      "id" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "targetEmail" text NOT NULL CHECK (
        length("targetEmail") BETWEEN 3 AND 320 AND
        "targetEmail" = btrim("targetEmail") AND
        "targetEmail" = lower("targetEmail")
      ),
      "roleId" uuid NOT NULL,
      "tokenDigest" text NOT NULL UNIQUE CHECK ("tokenDigest" ~ '^[0-9a-f]{64}$'),
      "status" text NOT NULL CHECK ("status" IN ('PENDING', 'CONSUMED', 'REVOKED', 'EXPIRED')),
      "createdByStaffPrincipalId" text NOT NULL,
      "createdAt" timestamptz NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      "consumedStaffPrincipalId" text,
      "consumedAt" timestamptz,
      "revokedAt" timestamptz,
      CONSTRAINT "staff_invitation_id_agency_unique" UNIQUE ("agencyId", "id"),
      CONSTRAINT "staff_invitation_expiry_after_creation" CHECK ("expiresAt" > "createdAt"),
      CONSTRAINT "staff_invitation_lifecycle_shape" CHECK (
        ("status" IN ('PENDING', 'EXPIRED') AND "consumedStaffPrincipalId" IS NULL AND
         "consumedAt" IS NULL AND "revokedAt" IS NULL) OR
        ("status" = 'CONSUMED' AND "consumedStaffPrincipalId" IS NOT NULL AND
         "consumedAt" IS NOT NULL AND "revokedAt" IS NULL) OR
        ("status" = 'REVOKED' AND "consumedStaffPrincipalId" IS NULL AND
         "consumedAt" IS NULL AND "revokedAt" IS NOT NULL)
      ),
      CONSTRAINT "staff_invitation_agency_fk"
        FOREIGN KEY ("agencyId")
        REFERENCES "organization"."agency" ("id") ON DELETE RESTRICT,
      CONSTRAINT "staff_invitation_role_agency_fk"
        FOREIGN KEY ("roleId", "agencyId")
        REFERENCES "staff_access"."role" ("id", "agencyId") ON DELETE RESTRICT,
      CONSTRAINT "staff_invitation_creator_agency_fk"
        FOREIGN KEY ("agencyId", "createdByStaffPrincipalId")
        REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId") ON DELETE RESTRICT,
      CONSTRAINT "staff_invitation_consumer_agency_fk"
        FOREIGN KEY ("agencyId", "consumedStaffPrincipalId")
        REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId") ON DELETE RESTRICT
    );
    CREATE INDEX "staff_invitation_page_idx"
      ON "staff_access"."staff_invitation" ("agencyId", "id" DESC);
    CREATE INDEX "staff_invitation_due_idx"
      ON "staff_access"."staff_invitation" ("agencyId", "expiresAt", "id")
      WHERE "status" = 'PENDING';

    CREATE TABLE "audit"."staff_invitation_event" (
      "id" uuid PRIMARY KEY,
      "agencyId" uuid NOT NULL,
      "invitationId" uuid NOT NULL,
      "relatedInvitationId" uuid,
      "actorStaffPrincipalId" text NOT NULL,
      "eventType" text NOT NULL CHECK (
        "eventType" IN ('ISSUED', 'REISSUED', 'REVOKED', 'EXPIRED', 'CONSUMED')
      ),
      "occurredAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "staff_invitation_event_invitation_agency_fk"
        FOREIGN KEY ("agencyId", "invitationId")
        REFERENCES "staff_access"."staff_invitation" ("agencyId", "id") ON DELETE RESTRICT,
      CONSTRAINT "staff_invitation_event_related_invitation_agency_fk"
        FOREIGN KEY ("agencyId", "relatedInvitationId")
        REFERENCES "staff_access"."staff_invitation" ("agencyId", "id") ON DELETE RESTRICT,
      CONSTRAINT "staff_invitation_event_actor_agency_fk"
        FOREIGN KEY ("agencyId", "actorStaffPrincipalId")
        REFERENCES "staff_access"."staff_membership" ("agencyId", "staffPrincipalId") ON DELETE RESTRICT,
      CONSTRAINT "staff_invitation_event_shape" CHECK (
        ("eventType" = 'REISSUED' AND "relatedInvitationId" IS NOT NULL AND
         "relatedInvitationId" <> "invitationId") OR
        ("eventType" <> 'REISSUED' AND "relatedInvitationId" IS NULL)
      )
    );
    CREATE INDEX "staff_invitation_event_by_invitation_idx"
      ON "audit"."staff_invitation_event" ("agencyId", "invitationId", "occurredAt", "id");

    CREATE OR REPLACE FUNCTION "audit"."reject_staff_invitation_event_mutation"()
    RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $staff_invitation_event_immutable$
    BEGIN
      RAISE EXCEPTION 'Staff invitation audit events are append-only'
        USING ERRCODE = '55000', CONSTRAINT = 'staff_invitation_event_immutable';
    END
    $staff_invitation_event_immutable$;
    REVOKE ALL ON FUNCTION "audit"."reject_staff_invitation_event_mutation"()
      FROM PUBLIC, "travelos_admin_api", "travelos_portal_api", "travelos_worker",
           "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    CREATE TRIGGER "staff_invitation_event_immutable_trigger"
      BEFORE UPDATE OR DELETE ON "audit"."staff_invitation_event"
      FOR EACH ROW EXECUTE FUNCTION "audit"."reject_staff_invitation_event_mutation"();
    CREATE TRIGGER "staff_invitation_event_no_truncate_trigger"
      BEFORE TRUNCATE ON "audit"."staff_invitation_event"
      FOR EACH STATEMENT EXECUTE FUNCTION "audit"."reject_staff_invitation_event_mutation"();

    REVOKE ALL ON TABLE "staff_access"."staff_invitation"
      FROM PUBLIC, "travelos_admin_api", "travelos_portal_api", "travelos_worker",
           "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    REVOKE ALL ON TABLE "audit"."staff_invitation_event"
      FROM PUBLIC, "travelos_admin_api", "travelos_portal_api", "travelos_worker",
           "travelos_admin_runtime", "travelos_portal_runtime", "travelos_worker_runtime";
    GRANT USAGE ON SCHEMA "staff_access", "audit" TO "travelos_admin_runtime";
    GRANT SELECT, INSERT, UPDATE ON TABLE "staff_access"."staff_invitation"
      TO "travelos_admin_runtime";
    GRANT SELECT, INSERT ON TABLE "audit"."staff_invitation_event"
      TO "travelos_admin_runtime";
  `);
};

exports.down = false;
