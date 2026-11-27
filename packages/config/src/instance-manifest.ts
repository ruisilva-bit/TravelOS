import { z } from "zod";

import { CredentialReferenceIdSchema } from "./credential-reference.js";

const forbiddenSecretLikeKeys = new Set([
  "apikey",
  "authorization",
  "bearertoken",
  "clientsecret",
  "connectionstring",
  "cookie",
  "databaseurl",
  "password",
  "privatekey",
  "secret",
  "sessiontoken",
  "token",
]);

const normalizeKey = (key: string): string => key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

const rejectSecretLikeKeys = (value: unknown, path: readonly string[] = []): void => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSecretLikeKeys(entry, [...path, String(index)]));
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (forbiddenSecretLikeKeys.has(normalizeKey(key))) {
      throw new Error(`Secret-like configuration field is forbidden: ${[...path, key].join(".")}`);
    }
    rejectSecretLikeKeys(nestedValue, [...path, key]);
  }
};

const FqdnSchema = z
  .string()
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    "Host must be an exact normalized lowercase hostname (FQDN or single-label LAN name) without scheme, port, wildcard, or trailing dot",
  );

const HostSurfaceSchema = z
  .object({
    host: FqdnSchema,
    surface: z.literal("ADMIN"),
  })
  .strict();

export const DEVELOPMENT_API_LISTEN_HOST_PATTERN =
  "^127(?:\\.(?:0|[1-9][0-9]?|1[0-9]{2}|2[0-4][0-9]|25[0-5])){3}$";

const DevelopmentApiListenerSchema = z
  .object({
    host: z.string().regex(new RegExp(DEVELOPMENT_API_LISTEN_HOST_PATTERN)),
    port: z.number().int().min(1_024).max(65_535),
  })
  .strict();

const databaseRuntimeRoleSchema = <RoleName extends string>(roleName: RoleName) =>
  z
    .object({
      roleName: z.literal(roleName),
      credentialReference: CredentialReferenceIdSchema,
    })
    .strict();

export const DevelopmentInstanceManifestSchema = z
  .object({
    manifestSchemaVersion: z.literal(3),
    environment: z.enum(["DEVELOPMENT", "INTERNAL"]),
    instanceId: z.string().regex(/^travelos-[a-z0-9]+(?:-[a-z0-9]+)*$/),
    compatibility: z
      .object({
        releaseVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
        releaseTarget: z.string().regex(/^development:[a-z0-9][a-z0-9.-]{2,63}$/),
        configSchemaVersion: z.literal(3),
        databaseSchema: z
          .object({
            minimum: z.literal(6),
            maximum: z.literal(6),
          })
          .strict(),
        postgresqlMajor: z.literal(18),
      })
      .strict(),
    hosts: z
      .object({
        admin: FqdnSchema,
      })
      .strict(),
    hostAllowlist: z.array(HostSurfaceSchema).length(1),
    agencyBootstrap: z
      .object({
        reference: z.string().regex(/^agency-bootstrap:[a-z0-9][a-z0-9-]{2,63}$/),
        slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,47}$/),
      })
      .strict(),
    database: z
      .object({
        host: z.literal("127.0.0.1"),
        port: z.number().int().min(1).max(65_535),
        name: z.string().regex(/^travelos_[a-z0-9_]{3,47}$/),
        tlsPolicy: z.literal("DISABLED_LOOPBACK_ONLY"),
        runtimeRoles: z
          .object({
            adminApi: databaseRuntimeRoleSchema("travelos_admin_api"),
            worker: databaseRuntimeRoleSchema("travelos_worker"),
          })
          .strict(),
      })
      .strict(),
    authentication: z
      .object({
        staffRealmCredentialReference: CredentialReferenceIdSchema,
      })
      .strict(),
    runtime: z
      .object({
        listeners: z
          .object({
            adminApi: DevelopmentApiListenerSchema,
          })
          .strict(),
        shutdownGracePeriodMs: z.number().int().min(1_000).max(30_000),
      })
      .strict(),
    features: z
      .object({
        foundationHealthEndpoints: z.literal(true),
      })
      .strict(),
    safeLimits: z
      .object({
        maxRequestBodyBytes: z.number().int().min(1_024).max(10_485_760),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const expected = new Map([["ADMIN", manifest.hosts.admin]]);
    const seenSurfaces = new Set<string>();
    const seenHosts = new Set<string>();

    manifest.hostAllowlist.forEach((entry, index) => {
      if (seenSurfaces.has(entry.surface)) {
        context.addIssue({
          code: "custom",
          path: ["hostAllowlist", index, "surface"],
          message: "Each surface must appear exactly once",
        });
      }
      if (seenHosts.has(entry.host)) {
        context.addIssue({
          code: "custom",
          path: ["hostAllowlist", index, "host"],
          message: "Each exact host must appear exactly once",
        });
      }
      if (expected.get(entry.surface) !== entry.host) {
        context.addIssue({
          code: "custom",
          path: ["hostAllowlist", index],
          message: "Host allowlist must match the declared surface host exactly",
        });
      }
      seenSurfaces.add(entry.surface);
      seenHosts.add(entry.host);
    });

    const credentialReferences = [
      ["adminApi", manifest.database.runtimeRoles.adminApi.credentialReference],
      ["worker", manifest.database.runtimeRoles.worker.credentialReference],
      ["staffRealm", manifest.authentication.staffRealmCredentialReference],
    ] as const;
    const firstProcessByCredentialReference = new Map<string, string>();
    for (const [processName, credentialReference] of credentialReferences) {
      const firstProcess = firstProcessByCredentialReference.get(credentialReference);
      if (firstProcess !== undefined) {
        context.addIssue({
          code: "custom",
          path:
            processName === "staffRealm"
              ? ["authentication", "staffRealmCredentialReference"]
              : ["database", "runtimeRoles", processName, "credentialReference"],
          message: `Credential references must be pairwise distinct; ${processName} duplicates ${firstProcess}`,
        });
      } else {
        firstProcessByCredentialReference.set(credentialReference, processName);
      }
    }
  });

export type DevelopmentInstanceManifest = z.infer<typeof DevelopmentInstanceManifestSchema>;

export const parseDevelopmentInstanceManifest = (input: unknown): DevelopmentInstanceManifest => {
  rejectSecretLikeKeys(input);
  return DevelopmentInstanceManifestSchema.parse(input);
};

export const developmentInstanceManifestJsonSchema = z.toJSONSchema(
  DevelopmentInstanceManifestSchema,
);
