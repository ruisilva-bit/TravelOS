import { kyselyAdapter } from "@better-auth/kysely-adapter";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { sql, type Kysely } from "kysely";

export const STAFF_AUTH_BASE_PATH = "/api/auth/staff" as const;

export type RealmEnvironment = "DEVELOPMENT" | "INTERNAL" | "PRODUCTION";

/** DEVELOPMENT and INTERNAL are the same non-production behaviour; keep them in one place. */
const isNonProductionEnvironment = (environment: RealmEnvironment): boolean =>
  environment === "DEVELOPMENT" || environment === "INTERNAL";
export type AuthenticationRealm = "STAFF";

export interface RealmSession {
  readonly realm: AuthenticationRealm;
  readonly sessionId: string;
  readonly principalId: string;
  readonly expiresAtEpochMs: number;
  /** Current Agency context; null when no Staff membership context is available. */
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
  if (isNonProductionEnvironment(environment) && origin.protocol !== "http:") {
    throw new Error("Development authentication realm uses explicit loopback HTTP only");
  }
};

const cookieNameFor = (environment: RealmEnvironment): string => {
  if (environment === "PRODUCTION") return "__Host-travelos-staff";
  return "travelos-dev-staff-session";
};

type StaffSessionContextRow = {
  readonly agencyId: string;
  readonly authorizationEpoch: string;
  readonly recentMfaVerifiedAt: Date | null;
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

type InternalRealmConfiguration = AuthRealmConfiguration & {
  readonly allowOperatorEnrollment?: boolean;
  readonly allowStaffInvitationEnrollment?: boolean;
  readonly transactionManagedExternally?: boolean;
};

type VerificationTokenConsumer = (email: string, token: string) => void;

const createRealm = (
  configuration: InternalRealmConfiguration,
  verificationTokenConsumer?: VerificationTokenConsumer,
) => {
  assertRealmConfiguration(configuration);
  const kind = "STAFF" as const satisfies AuthenticationRealm;
  const basePath = STAFF_AUTH_BASE_PATH;
  const cookieName = cookieNameFor(configuration.environment);
  const productionCookie = configuration.environment === "PRODUCTION";
  const schema = "staff_access";
  const tablePrefix = "staff";
  const allowPrivateEnrollment =
    configuration.allowOperatorEnrollment === true ||
    configuration.allowStaffInvitationEnrollment === true;
  const realmDatabase = configuration.database.withSchema(schema);
  const auth = betterAuth({
    appName: "TravelOS Staff",
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
      disableSignUp: !allowPrivateEnrollment,
      requireEmailVerification: true,
      ...(allowPrivateEnrollment ? { autoSignIn: false } : {}),
    },
    ...(verificationTokenConsumer === undefined
      ? {}
      : {
          emailVerification: {
            sendOnSignUp: true,
            ...(configuration.allowStaffInvitationEnrollment === true
              ? { autoSignInAfterVerification: false }
              : {}),
            sendVerificationEmail: async ({ user, token }) => {
              verificationTokenConsumer(user.email, token);
            },
          },
        }),
    user: { modelName: `${tablePrefix}_user` },
    session: {
      modelName: `${tablePrefix}_session`,
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 8,
      cookieCache: { enabled: false },
    },
    account: { modelName: `${tablePrefix}_account` },
    verification: { modelName: `${tablePrefix}_verification` },
    advanced: {
      /** Custom __Host cookie names are preserved by opting out of Better Auth's __Secure prefix. */
      useSecureCookies: false,
      cookiePrefix: "travelos-staff",
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
    plugins: [
      twoFactor({
        issuer: "TravelOS Staff",
        twoFactorTable: "staff_two_factor",
        twoFactorCookieMaxAge: 60 * 10,
        accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 60 * 15 },
      }),
    ],
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

  const realm: AuthRealm = {
    kind,
    basePath,
    cookieName,
    secureTransportRequired: productionCookie,
    handle: async (request) => {
      const response = await auth.handler(request);
      if (response.status < 200 || response.status >= 300) return response;
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
      const staffContext = await staffSessionContextFor(configuration.database, result.session.id);
      return {
        realm: kind,
        sessionId: result.session.id,
        principalId: result.user.id,
        expiresAtEpochMs: result.session.expiresAt.getTime(),
        agencyId: staffContext?.agencyId ?? null,
        authorizationEpoch: staffContext === null ? null : BigInt(staffContext.authorizationEpoch),
        recentMfaVerifiedAtEpochMs: staffContext?.recentMfaVerifiedAt?.getTime() ?? null,
      };
    },
  };
  return { auth, realm };
};

export const createStaffAuthRealm = (configuration: AuthRealmConfiguration): AuthRealm =>
  createRealm({ ...configuration, allowOperatorEnrollment: false }).realm;

const assertDevelopmentOperatorEnrollment = (configuration: AuthRealmConfiguration): void => {
  if (!isNonProductionEnvironment(configuration.environment)) {
    throw new Error("Local operator enrollment is available only in DEVELOPMENT or INTERNAL");
  }
};

export interface StaffInvitationEnrollmentInput {
  readonly email: string;
  readonly name: string;
  readonly password: string;
}

export interface StaffInvitationEnrollmentResult {
  readonly staffPrincipalId: string;
}

export interface StaffInvitationEnrollmentService {
  enroll(input: StaffInvitationEnrollmentInput): Promise<StaffInvitationEnrollmentResult>;
}

/**
 * Enrolls one invitation-approved Staff identity through Better Auth's internal API only.
 * The caller must construct this service with the active invitation transaction's database.
 */
export const createStaffInvitationEnrollmentService = (
  configuration: AuthRealmConfiguration,
): StaffInvitationEnrollmentService => ({
  async enroll(input) {
    const email = input.email.trim().toLowerCase();
    const verificationToken: { value: string | undefined } = { value: undefined };
    const { auth } = createRealm(
      {
        ...configuration,
        allowStaffInvitationEnrollment: true,
        transactionManagedExternally: true,
      },
      (verificationEmail, token) => {
        if (
          verificationEmail.trim().toLowerCase() !== email ||
          verificationToken.value !== undefined
        ) {
          throw new Error("Staff invitation verification evidence is invalid");
        }
        verificationToken.value = token;
      },
    );

    try {
      const signup = await auth.api.signUpEmail({
        body: { email, name: input.name, password: input.password },
        headers: new Headers({ origin: configuration.canonicalOrigin }),
      });
      const token = verificationToken.value;
      verificationToken.value = undefined;
      if (signup.token !== null) {
        throw new Error("Staff invitation enrollment unexpectedly created a session");
      }
      if (
        signup.user.id.length === 0 ||
        signup.user.email !== email ||
        token === undefined ||
        token.length === 0
      ) {
        throw new Error("Staff invitation enrollment returned incomplete Better Auth evidence");
      }

      const verified = await auth.api.verifyEmail({
        query: { token },
        headers: new Headers({ origin: configuration.canonicalOrigin }),
      });
      if (verified === undefined || verified.status !== true) {
        throw new Error("Staff invitation identity verification did not complete");
      }

      return { staffPrincipalId: signup.user.id };
    } finally {
      verificationToken.value = undefined;
    }
  },
});

/**
 * This factory is intentionally for the local operator command only. It must never be passed to
 * an HTTP bridge because it temporarily permits account creation to enroll a verified invitation.
 */
export const createLocalOperatorStaffEnrollmentRealm = (
  configuration: AuthRealmConfiguration,
): AuthRealm => {
  assertDevelopmentOperatorEnrollment(configuration);
  return createRealm({ ...configuration, allowOperatorEnrollment: true }).realm;
};
