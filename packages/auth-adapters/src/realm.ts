import { kyselyAdapter } from "@better-auth/kysely-adapter";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { sql, type Kysely } from "kysely";

export const STAFF_AUTH_BASE_PATH = "/api/auth/staff" as const;
export const PORTAL_AUTH_BASE_PATH = "/api/auth/portal" as const;

export type RealmEnvironment = "DEVELOPMENT" | "PRODUCTION";
export type AuthenticationRealm = "STAFF" | "PORTAL";

export interface RealmSession {
  readonly realm: AuthenticationRealm;
  readonly sessionId: string;
  readonly principalId: string;
  readonly expiresAtEpochMs: number;
  /** Current Agency context; null when a Staff membership or Portal context is unavailable. */
  readonly agencyId: string | null;
  readonly authorizationEpoch: bigint | null;
  readonly recentMfaVerifiedAtEpochMs: number | null;
}

export interface AuthRealm {
  readonly kind: AuthenticationRealm;
  readonly basePath: string;
  readonly cookieName: string;
  readonly secureTransportRequired: boolean;
  handle(request: Request): Promise<Response>;
  getServerSession(request: Request): Promise<RealmSession | null>;
}

export interface AuthRealmConfiguration {
  readonly database: Kysely<Record<string, never>>;
  readonly canonicalOrigin: string;
  readonly realmKeyMaterial: string;
  readonly environment: RealmEnvironment;
}

export type PortalAuthRealmConfiguration = AuthRealmConfiguration;

export interface PortalAuthRealm extends AuthRealm {
  readonly kind: "PORTAL";
  readonly basePath: typeof PORTAL_AUTH_BASE_PATH;
}

const assertRealmConfiguration = ({
  canonicalOrigin,
  realmKeyMaterial,
  environment,
}: AuthRealmConfiguration): void => {
  const origin = new URL(canonicalOrigin);
  if (origin.pathname !== "/" || origin.search !== "" || origin.hash !== "") {
    throw new Error("Realm canonical origin must not include a path, query, or hash");
  }
  if (realmKeyMaterial.length < 32) {
    throw new Error("Realm key material must satisfy Better Auth minimum length");
  }
  if (environment === "PRODUCTION" && origin.protocol !== "https:") {
    throw new Error("Production authentication realm requires an HTTPS canonical origin");
  }
  if (environment === "DEVELOPMENT" && origin.protocol !== "http:") {
    throw new Error("Development authentication realm uses explicit loopback HTTP only");
  }
};

const cookieNameFor = (realm: AuthenticationRealm, environment: RealmEnvironment): string => {
  if (environment === "PRODUCTION") {
    return realm === "STAFF" ? "__Host-travelos-staff" : "__Host-travelos-portal";
  }
  return realm === "STAFF" ? "travelos-dev-staff-session" : "travelos-dev-portal-session";
};

type StaffSessionContextRow = {
  readonly agencyId: string;
  readonly authorizationEpoch: string;
  readonly recentMfaVerifiedAt: Date | null;
};

type PortalSessionContextRow = {
  readonly agencyId: string;
  readonly authorizationEpoch: string;
};

type SetCookieHeaders = Headers & { readonly getSetCookie?: () => string[] };

const cookieHeaderFor = (headers: Headers, cookieName: string): string | null => {
  const setCookieHeaders = headers as SetCookieHeaders;
  const values =
    setCookieHeaders.getSetCookie?.() ??
    [headers.get("set-cookie")].flatMap((value) => (value === null ? [] : [value]));
  const cookiePrefix = `${cookieName}=`;
  for (const value of values) {
    const cookie = value.split(";", 1)[0];
    if (cookie?.startsWith(cookiePrefix)) return cookie;
  }
  return null;
};

const staffSessionContextFor = async (
  database: Kysely<Record<string, never>>,
  sessionId: string,
): Promise<StaffSessionContextRow | null> => {
  const row = (
    await sql<StaffSessionContextRow>`
      SELECT "agencyId", "authorizationEpoch"::text AS "authorizationEpoch", "recentMfaVerifiedAt"
        FROM "staff_access"."staff_session_context" AS context
        JOIN "staff_access"."staff_user" AS principal
          ON principal."id" = context."staffPrincipalId"
       WHERE context."sessionId" = ${sessionId}
         AND principal."twoFactorEnabled"
    `.execute(database)
  ).rows[0];
  return row ?? null;
};

const portalSessionContextFor = async (
  database: Kysely<Record<string, never>>,
  sessionId: string,
  principalId: string,
): Promise<PortalSessionContextRow | null> => {
  const row = (
    await sql<PortalSessionContextRow>`
      SELECT context."agencyId"::text AS "agencyId",
             context."authorizationEpoch"::text AS "authorizationEpoch"
        FROM "portal_access"."portal_session_context" AS context
        JOIN "portal_access"."portal_principal_context" AS principal
          ON principal."agencyId" = context."agencyId"
         AND principal."portalPrincipalId" = context."portalPrincipalId"
         AND principal."authorizationEpoch" = context."authorizationEpoch"
       WHERE context."sessionId" = ${sessionId}
         AND context."portalPrincipalId" = ${principalId}
    `.execute(database)
  ).rows[0];
  return row ?? null;
};

type InternalRealmConfiguration = AuthRealmConfiguration & {
  readonly allowOperatorEnrollment?: boolean;
  readonly transactionManagedExternally?: boolean;
};

type VerificationTokenConsumer = (email: string, token: string) => void;

const createRealm = (
  kind: AuthenticationRealm,
  configuration: InternalRealmConfiguration,
  verificationTokenConsumer?: VerificationTokenConsumer,
): AuthRealm => {
  assertRealmConfiguration(configuration);
  const basePath = kind === "STAFF" ? STAFF_AUTH_BASE_PATH : PORTAL_AUTH_BASE_PATH;
  const cookieName = cookieNameFor(kind, configuration.environment);
  const productionCookie = configuration.environment === "PRODUCTION";
  const schema = kind === "STAFF" ? "staff_access" : "portal_access";
  const tablePrefix = kind === "STAFF" ? "staff" : "portal";
  const realmDatabase = configuration.database.withSchema(schema);
  const auth = betterAuth({
    appName: kind === "STAFF" ? "TravelOS Staff" : "TravelOS Portal",
    baseURL: configuration.canonicalOrigin,
    basePath,
    database: kyselyAdapter(realmDatabase, {
      type: "postgres",
      transaction: configuration.transactionManagedExternally !== true,
    }),
    secret: configuration.realmKeyMaterial,
    trustedOrigins: [configuration.canonicalOrigin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: configuration.allowOperatorEnrollment !== true,
      requireEmailVerification: true,
      ...(configuration.allowOperatorEnrollment === true ? { autoSignIn: false } : {}),
    },
    ...(verificationTokenConsumer === undefined
      ? {}
      : {
          emailVerification: {
            sendOnSignUp: true,
            sendVerificationEmail: async ({ user, token }) => {
              verificationTokenConsumer(user.email, token);
            },
          },
        }),
    user: { modelName: `${tablePrefix}_user` },
    session: {
      modelName: `${tablePrefix}_session`,
      ...(kind === "STAFF"
        ? {
            expiresIn: 60 * 60 * 24 * 7,
            updateAge: 60 * 60 * 8,
            cookieCache: { enabled: false },
          }
        : {
            expiresIn: 60 * 60 * 24 * 30,
            updateAge: 60 * 60 * 24,
            cookieCache: { enabled: false },
          }),
    },
    account: { modelName: `${tablePrefix}_account` },
    verification: { modelName: `${tablePrefix}_verification` },
    advanced: {
      /** Custom __Host cookie names are preserved by opting out of Better Auth's __Secure prefix. */
      useSecureCookies: false,
      cookiePrefix: kind === "STAFF" ? "travelos-staff" : "travelos-portal",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: productionCookie,
        path: "/",
      },
      cookies: {
        session_token: {
          name: cookieName,
          attributes: {
            httpOnly: true,
            sameSite: "lax",
            secure: productionCookie,
            path: "/",
          },
        },
      },
    },
    ...(kind === "STAFF"
      ? {
          plugins: [
            twoFactor({
              issuer: "TravelOS Staff",
              twoFactorTable: "staff_two_factor",
              twoFactorCookieMaxAge: 60 * 10,
              accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 60 * 15 },
            }),
          ],
        }
      : {}),
  });

  const sessionFromResponseCookies = async (response: Response) => {
    const cookie = cookieHeaderFor(response.headers, cookieName);
    if (cookie === null) return null;
    return auth.api.getSession({ headers: new Headers({ cookie }) });
  };

  const synchronizeStaffSessionContext = async (
    response: Response,
    recentMfaVerified: boolean,
  ): Promise<void> => {
    const result = await sessionFromResponseCookies(response);
    if (result === null) return;
    const membership = (
      await sql<{ agencyId: string; authorizationEpoch: string }>`
        SELECT membership."agencyId", membership."authorizationEpoch"::text AS "authorizationEpoch"
          FROM "staff_access"."staff_membership" AS membership
          JOIN "staff_access"."staff_user" AS principal
            ON principal."id" = membership."staffPrincipalId"
         WHERE membership."staffPrincipalId" = ${result.user.id}
           AND principal."twoFactorEnabled"
      `.execute(configuration.database)
    ).rows[0];
    if (membership === undefined) return;
    await sql`
      INSERT INTO "staff_access"."staff_session_context"
        ("sessionId", "staffPrincipalId", "agencyId", "authorizationEpoch", "recentMfaVerifiedAt")
      VALUES (
        ${result.session.id},
        ${result.user.id},
        ${membership.agencyId}::uuid,
        ${membership.authorizationEpoch}::bigint,
        CASE WHEN ${recentMfaVerified} THEN CURRENT_TIMESTAMP ELSE NULL END
      )
      ON CONFLICT ("sessionId") DO UPDATE
        SET "agencyId" = EXCLUDED."agencyId",
            "authorizationEpoch" = EXCLUDED."authorizationEpoch",
            "recentMfaVerifiedAt" = CASE
              WHEN ${recentMfaVerified} THEN CURRENT_TIMESTAMP
              ELSE "staff_access"."staff_session_context"."recentMfaVerifiedAt"
            END,
            "updatedAt" = CURRENT_TIMESTAMP
    `.execute(configuration.database);
  };

  const isRecentMfaVerification = (request: Request): boolean => {
    if (request.method.toUpperCase() !== "POST") return false;
    const pathname = new URL(request.url).pathname;
    return (
      pathname === `${basePath}/two-factor/verify-totp` ||
      pathname === `${basePath}/two-factor/verify-backup-code`
    );
  };

  return {
    kind,
    basePath,
    cookieName,
    secureTransportRequired: productionCookie,
    handle: async (request) => {
      const response = await auth.handler(request);
      if (kind !== "STAFF" || response.status < 200 || response.status >= 300) return response;
      try {
        await synchronizeStaffSessionContext(response, isRecentMfaVerification(request));
        return response;
      } catch {
        return new Response(null, { status: 500 });
      }
    },
    getServerSession: async (request) => {
      const result = await auth.api.getSession({ headers: request.headers });
      if (result === null) return null;
      const staffContext =
        kind === "STAFF"
          ? await staffSessionContextFor(configuration.database, result.session.id)
          : null;
      const portalContext =
        kind === "PORTAL"
          ? await portalSessionContextFor(configuration.database, result.session.id, result.user.id)
          : null;
      if (kind === "PORTAL" && portalContext === null) return null;
      const context = kind === "STAFF" ? staffContext : portalContext;
      return {
        realm: kind,
        sessionId: result.session.id,
        principalId: result.user.id,
        expiresAtEpochMs: result.session.expiresAt.getTime(),
        agencyId: context?.agencyId ?? null,
        authorizationEpoch: context === null ? null : BigInt(context.authorizationEpoch),
        recentMfaVerifiedAtEpochMs: staffContext?.recentMfaVerifiedAt?.getTime() ?? null,
      };
    },
  };
};

export const createStaffAuthRealm = (configuration: AuthRealmConfiguration): AuthRealm =>
  createRealm("STAFF", { ...configuration, allowOperatorEnrollment: false });

export const createPortalAuthRealm = (
  configuration: PortalAuthRealmConfiguration,
): PortalAuthRealm =>
  createRealm("PORTAL", { ...configuration, allowOperatorEnrollment: false }) as PortalAuthRealm;

const assertDevelopmentOperatorEnrollment = (configuration: AuthRealmConfiguration): void => {
  if (configuration.environment !== "DEVELOPMENT") {
    throw new Error("Local operator enrollment is available only in DEVELOPMENT");
  }
};

export interface LocalOperatorPortalEnrollmentInput {
  readonly email: string;
  readonly name: string;
  readonly password: string;
}

export interface LocalOperatorPortalEnrollmentResult {
  readonly portalPrincipalId: string;
}

export interface LocalOperatorPortalEnrollmentService {
  enroll(input: LocalOperatorPortalEnrollmentInput): Promise<LocalOperatorPortalEnrollmentResult>;
}

/**
 * This service is only for local DEVELOPMENT acceptance tooling. It owns the temporary
 * Better Auth handler so its enrollment capability cannot be mounted on an HTTP listener.
 */
export const createLocalOperatorPortalEnrollmentService = (
  configuration: AuthRealmConfiguration,
): LocalOperatorPortalEnrollmentService => {
  assertDevelopmentOperatorEnrollment(configuration);
  return {
    async enroll(input) {
      const email = input.email.trim().toLowerCase();
      if (!email.endsWith("@example.test")) {
        throw new Error("Local Portal enrollment requires a synthetic @example.test address");
      }
      return configuration.database.transaction().execute(async (database) => {
        const verificationToken: { value: string | undefined } = { value: undefined };
        const realm = createRealm(
          "PORTAL",
          {
            ...configuration,
            database,
            allowOperatorEnrollment: true,
            transactionManagedExternally: true,
          },
          (_email, token) => {
            verificationToken.value = token;
          },
        );
        try {
          const signup = await realm.handle(
            new Request(
              new URL(`${PORTAL_AUTH_BASE_PATH}/sign-up/email`, configuration.canonicalOrigin),
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  origin: configuration.canonicalOrigin,
                },
                body: JSON.stringify({ ...input, email }),
              },
            ),
          );
          if (!signup.ok) throw new Error("Local Portal identity enrollment failed");

          const signupBody: unknown = await signup.json();
          const signupRecord =
            signupBody !== null && typeof signupBody === "object"
              ? (signupBody as Record<string, unknown>)
              : null;
          const user =
            signupRecord?.user !== null && typeof signupRecord?.user === "object"
              ? (signupRecord.user as Record<string, unknown>)
              : null;
          const portalPrincipalId = typeof user?.id === "string" ? user.id : null;
          const token = verificationToken.value;
          verificationToken.value = undefined;
          if (portalPrincipalId === null || token === undefined) {
            throw new Error(
              "Local Portal identity enrollment returned incomplete Better Auth evidence",
            );
          }

          const verified = await realm.handle(
            new Request(
              new URL(
                `${PORTAL_AUTH_BASE_PATH}/verify-email?token=${encodeURIComponent(token)}`,
                configuration.canonicalOrigin,
              ),
              { method: "GET", headers: { origin: configuration.canonicalOrigin } },
            ),
          );
          if (!verified.ok) throw new Error("Local Portal identity verification failed");
          const verificationBody: unknown = await verified.json();
          const verificationRecord =
            verificationBody !== null && typeof verificationBody === "object"
              ? (verificationBody as Record<string, unknown>)
              : null;
          if (verificationRecord?.status !== true) {
            throw new Error("Local Portal identity verification did not complete");
          }
          return { portalPrincipalId };
        } finally {
          verificationToken.value = undefined;
        }
      });
    },
  };
};

/**
 * This factory is intentionally for the local operator command only. It must never be passed to
 * an HTTP bridge because it temporarily permits account creation to enroll a verified invitation.
 */
export const createLocalOperatorStaffEnrollmentRealm = (
  configuration: AuthRealmConfiguration,
): AuthRealm => {
  assertDevelopmentOperatorEnrollment(configuration);
  return createRealm("STAFF", { ...configuration, allowOperatorEnrollment: true });
};
