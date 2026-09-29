// Better Auth SQL was generated independently for each realm, then reviewed/adapted here.
// TravelOS's node-pg-migrate chain is the sole schema authority; Better Auth runtime sync is forbidden.
const realmTables = (schema, prefix, includeTwoFactor) => {
  const statements = [
    `
      CREATE TABLE "${schema}"."${prefix}_user" (
        "id" text PRIMARY KEY,
        "name" text NOT NULL,
        "email" text NOT NULL UNIQUE,
        "emailVerified" boolean NOT NULL DEFAULT false,
        "image" text,
        "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP${includeTwoFactor ? ',\n        "twoFactorEnabled" boolean NOT NULL DEFAULT false' : ""}
      )`,
    `
      CREATE TABLE "${schema}"."${prefix}_session" (
        "id" text PRIMARY KEY,
        "expiresAt" timestamptz NOT NULL,
        "token" text NOT NULL UNIQUE,
        "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamptz NOT NULL,
        "ipAddress" text,
        "userAgent" text,
        "userId" text NOT NULL REFERENCES "${schema}"."${prefix}_user" ("id") ON DELETE CASCADE,
        CONSTRAINT "${prefix}_session_id_user_id_unique" UNIQUE ("id", "userId")
      )`,
    `
      CREATE TABLE "${schema}"."${prefix}_account" (
        "id" text PRIMARY KEY,
        "accountId" text NOT NULL,
        "providerId" text NOT NULL,
        "userId" text NOT NULL REFERENCES "${schema}"."${prefix}_user" ("id") ON DELETE CASCADE,
        "accessToken" text,
        "refreshToken" text,
        "idToken" text,
        "accessTokenExpiresAt" timestamptz,
        "refreshTokenExpiresAt" timestamptz,
        "scope" text,
        "password" text,
        "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamptz NOT NULL
      )`,
    `
      CREATE TABLE "${schema}"."${prefix}_verification" (
        "id" text PRIMARY KEY,
        "identifier" text NOT NULL,
        "value" text NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    `CREATE INDEX "${prefix}_session_user_id_idx" ON "${schema}"."${prefix}_session" ("userId")`,
    `CREATE INDEX "${prefix}_account_user_id_idx" ON "${schema}"."${prefix}_account" ("userId")`,
    `CREATE INDEX "${prefix}_verification_identifier_idx" ON "${schema}"."${prefix}_verification" ("identifier")`,
  ];
  if (includeTwoFactor) {
    statements.push(
      `
        CREATE TABLE "${schema}"."staff_two_factor" (
          "id" text PRIMARY KEY,
          "secret" text NOT NULL,
          "backupCodes" text NOT NULL,
          "userId" text NOT NULL UNIQUE REFERENCES "${schema}"."${prefix}_user" ("id") ON DELETE CASCADE,
          "verified" boolean NOT NULL DEFAULT true,
          "failedVerificationCount" integer NOT NULL DEFAULT 0 CHECK ("failedVerificationCount" >= 0),
          "lockedUntil" timestamptz
        )`,
      `CREATE INDEX "staff_two_factor_secret_idx" ON "${schema}"."staff_two_factor" ("secret")`,
      `CREATE INDEX "staff_two_factor_user_id_idx" ON "${schema}"."staff_two_factor" ("userId")`,
    );
  }
  return statements;
};

exports.up = (pgm) => {
  pgm.sql(`
    DO $migration_context$
    BEGIN
      IF current_user <> 'travelos_owner' OR session_user <> 'travelos_migrator' THEN
        RAISE EXCEPTION 'Unexpected migration object-creation context';
      END IF;
    END
    $migration_context$;
  `);

  for (const statement of realmTables("staff_access", "staff", true)) pgm.sql(statement);
  for (const statement of realmTables("portal_access", "portal", false)) pgm.sql(statement);

  pgm.sql(`
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "staff_access" FROM PUBLIC, "travelos_portal_runtime", "travelos_worker_runtime";
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "portal_access" FROM PUBLIC, "travelos_admin_runtime", "travelos_worker_runtime";

    GRANT USAGE ON SCHEMA "staff_access" TO "travelos_admin_runtime";
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      "staff_access"."staff_user",
      "staff_access"."staff_session",
      "staff_access"."staff_account",
      "staff_access"."staff_verification",
      "staff_access"."staff_two_factor"
      TO "travelos_admin_runtime";

    GRANT USAGE ON SCHEMA "portal_access" TO "travelos_portal_runtime";
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      "portal_access"."portal_user",
      "portal_access"."portal_session",
      "portal_access"."portal_account",
      "portal_access"."portal_verification"
      TO "travelos_portal_runtime";

    COMMENT ON TABLE "staff_access"."staff_user" IS 'Better Auth Staff realm principal mechanics only';
    COMMENT ON TABLE "portal_access"."portal_user" IS 'Better Auth Portal realm principal mechanics only';
  `);
};

exports.down = false;
