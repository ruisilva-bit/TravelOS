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
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    "Host must be an exact normalized lowercase FQDN without scheme, port, wildcard, or trailing dot",
  );

const HostSurfaceSchema = z
  .object({
    host: FqdnSchema,
    surface: z.enum(["ADMIN", "PORTAL"]),
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

export const DevelopmentInstanceManifestSchema = z
  .object({
    manifestSchemaVersion: z.literal(1),
    environment: z.literal("DEVELOPMENT"),
    instanceId: z.string().regex(/^travelos-dev-[a-z0-9][a-z0-9-]{2,47}$/),
    compatibility: z
      .object({
        releaseVersion: z.string().regex(/^0\.0\.0-stage2$/),
        releaseTarget: z.string().regex(/^development:[a-z0-9][a-z0-9.-]{2,63}$/),
        configSchemaVersion: z.literal(1),
        databaseSchema: z
          .object({
            minimum: z.literal(0),
            maximum: z.literal(0),
          })
          .strict(),
        postgresqlMajor: z.literal(18),
      })
      .strict(),
    hosts: z
      .object({
        admin: FqdnSchema,
        portal: FqdnSchema,
      })
      .strict(),
    hostAllowlist: z.array(HostSurfaceSchema).length(2),
    agencyBootstrap: z
      .object({
        reference: z.string().regex(/^agency-bootstrap:[a-z0-9][a-z0-9-]{2,63}$/),
        slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,47}$/),
      })
      .strict(),
    database: z
      .object({
        name: z.string().regex(/^travelos_[a-z0-9_]{3,47}$/),
        roleCredentialReferences: z
          .object({
            adminApi: CredentialReferenceIdSchema,
            portalApi: CredentialReferenceIdSchema,
            worker: CredentialReferenceIdSchema,
          })
          .strict(),
      })
      .strict(),
    runtime: z
      .object({
        listeners: z
          .object({
            adminApi: DevelopmentApiListenerSchema,
            portalApi: DevelopmentApiListenerSchema,
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
    const { adminApi, portalApi } = manifest.runtime.listeners;
    if (adminApi.host === portalApi.host && adminApi.port === portalApi.port) {
      context.addIssue({
        code: "custom",
        path: ["runtime", "listeners", "portalApi"],
        message: "Admin and Portal API listeners must use distinct host and port pairs",
      });
    }

    if (manifest.hosts.admin === manifest.hosts.portal) {
      context.addIssue({
        code: "custom",
        path: ["hosts", "portal"],
        message: "Admin and Portal hosts must be distinct",
      });
    }

    const expected = new Map([
      ["ADMIN", manifest.hosts.admin],
      ["PORTAL", manifest.hosts.portal],
    ]);
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
  });

export type DevelopmentInstanceManifest = z.infer<typeof DevelopmentInstanceManifestSchema>;

export const parseDevelopmentInstanceManifest = (input: unknown): DevelopmentInstanceManifest => {
  rejectSecretLikeKeys(input);
  return DevelopmentInstanceManifestSchema.parse(input);
};

export const developmentInstanceManifestJsonSchema = z.toJSONSchema(
  DevelopmentInstanceManifestSchema,
);
