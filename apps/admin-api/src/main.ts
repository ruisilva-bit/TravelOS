import "reflect-metadata";

import {
  createStaffAuthRealm,
  createStaffInvitationEnrollmentService,
  createStaffInvitationToken,
  digestStaffInvitationToken,
} from "@travelos/auth-adapters";
import { createStaffInvitationOperations } from "@travelos/backend-core";
import {
  loadDevelopmentInstanceManifest,
  readSystemdCredentialText,
  type DevelopmentInstanceManifest,
} from "@travelos/config";
import {
  createPostgresStaffTripPublicationOperations,
  createPostgresStaffLeadOperations,
  createPostgresStaffTripOperations,
  createPostgresStaffTripWorkspaceOperations,
  createPostgresStaffTripWorkspaceWriteOperations,
  createPostgresPersistence,
  createStaffAccessRepository,
  createPostgresStaffInvitationRepository,
} from "@travelos/database";
import { AdminTripPublicationPreviewV1Schema } from "@travelos/contracts/admin";

import { createAdminApi, type CreateAdminApiOptions } from "./app.js";
import { createAdminStaffSessionResolver } from "./staff-session-resolver.js";
import { createStaffInvitationRateLimiter } from "./staff-invitation-rate-limit.js";

const readRequiredArgument = (name: string): string => {
  const prefix = `${name}=`;
  const inlineValue = process.argv.find((argument) => argument.startsWith(prefix));
  if (inlineValue !== undefined) {
    return inlineValue.slice(prefix.length);
  }

  const argumentIndex = process.argv.indexOf(name);
  const followingValue = process.argv[argumentIndex + 1];
  if (argumentIndex !== -1 && followingValue !== undefined) {
    return followingValue;
  }

  throw new Error(`Required argument is missing: ${name}`);
};

const createAdminAuthOptions = async (
  manifest: DevelopmentInstanceManifest,
): Promise<{
  readonly options: Omit<CreateAdminApiOptions, "expectedHost">;
  readonly destroy: () => Promise<void>;
}> => {
  const databaseCredential = await readSystemdCredentialText(
    manifest.database.runtimeRoles.adminApi.credentialReference,
  );
  const realmKeyMaterial = await readSystemdCredentialText(
    manifest.authentication.staffRealmCredentialReference,
  );
  const persistence = createPostgresPersistence<Record<string, never>>({
    host: manifest.database.host,
    port: manifest.database.port,
    database: manifest.database.name,
    user: manifest.database.runtimeRoles.adminApi.roleName,
    password: databaseCredential,
    tls: { mode: manifest.database.tlsPolicy },
    applicationName: "travelos-admin-api",
    maxConnections: 10,
  });
  try {
    const realm = await persistence.withConnection(async (database) =>
      createStaffAuthRealm({
        database,
        canonicalOrigin: `http://${manifest.hosts.admin}`,
        realmKeyMaterial,
        environment: manifest.environment,
      }),
    );
    const policy = {
      canonicalOrigin: `http://${manifest.hosts.admin}`,
      expectedHost: manifest.hosts.admin,
    };
    const staffAccessRepository = createStaffAccessRepository(persistence);
    const sessionResolver = createAdminStaffSessionResolver(realm, policy);
    const tripOperations = createPostgresStaffTripOperations(persistence, sessionResolver);
    const workspaceOperations = createPostgresStaffTripWorkspaceOperations(
      persistence,
      sessionResolver,
    );
    const workspaceWriteOperations = createPostgresStaffTripWorkspaceWriteOperations(
      persistence,
      sessionResolver,
    );
    const publicationOperations = createPostgresStaffTripPublicationOperations(
      persistence,
      sessionResolver,
      {
        validate: (value) => void AdminTripPublicationPreviewV1Schema.shape.projection.parse(value),
      },
    );
    const leadOperations = createPostgresStaffLeadOperations(persistence, sessionResolver);
    const staffInvitationOperations = createStaffInvitationOperations({
      repository: createPostgresStaffInvitationRepository(persistence),
      authorizationRepository: staffAccessRepository,
      sessionResolver,
      tokenFactory: {
        create: createStaffInvitationToken,
        digest: digestStaffInvitationToken,
      },
      identityEnrollment: {
        enroll: (context, input) =>
          persistence.withTransactionContext(context, async (database) =>
            createStaffInvitationEnrollmentService({
              database,
              canonicalOrigin: policy.canonicalOrigin,
              realmKeyMaterial,
              environment: manifest.environment,
            }).enroll(input),
          ),
      },
      nowEpochMs: Date.now,
    });
    const staffInvitationRateLimiter = createStaffInvitationRateLimiter();
    return {
      options: {
        auth: {
          realm,
          policy,
          environment: manifest.environment,
          staffAccessRepository,
          tripOperations,
          workspaceOperations,
          workspaceWriteOperations,
          publicationOperations,
          leadOperations,
          staffInvitationOperations,
          staffInvitationRateLimiter,
        },
      },
      destroy: () => persistence.destroy(),
    };
  } catch (error) {
    await persistence.destroy();
    throw error;
  }
};

const main = async (): Promise<void> => {
  const manifestPath = readRequiredArgument("--manifest");
  const manifest = await loadDevelopmentInstanceManifest(manifestPath);
  const listener = manifest.runtime.listeners.adminApi;
  const smoke = process.argv.includes("--smoke");
  const smokeListener = process.argv.includes("--smoke-listener");
  const runtime = smoke || smokeListener ? null : await createAdminAuthOptions(manifest);
  const application = await createAdminApi({
    expectedHost: manifest.hosts.admin,
    ...(runtime?.options ?? {}),
  }).catch(async (error: unknown) => {
    await runtime?.destroy();
    throw error;
  });

  if (smokeListener) {
    await application.listen(0, listener.host);
    const applicationUrl = new URL(await application.getUrl());
    const boundPort = Number.parseInt(applicationUrl.port, 10);
    if (applicationUrl.hostname !== listener.host || !Number.isInteger(boundPort)) {
      await application.close();
      throw new Error("Admin API smoke did not bind an ephemeral IPv4 loopback listener");
    }
    const healthPath = "/health/live";
    const binding = {
      requestedPort: 0,
      boundAddress: applicationUrl.hostname,
      boundPort,
      ephemeralPortRequested: true,
    };
    let shutdownStarted = false;
    const shutdownSmokeListener = (): void => {
      if (shutdownStarted) return;
      shutdownStarted = true;
      void application
        .close()
        .then(async () => {
          await runtime?.destroy();
          console.log(
            JSON.stringify({
              event: "process_smoke_shutdown",
              service: "admin-api",
              state: "STOPPED",
              cleanShutdown: true,
            }),
          );
        })
        .catch(() => {
          process.exitCode = 1;
        });
    };
    process.once("SIGINT", shutdownSmokeListener);
    process.once("SIGTERM", shutdownSmokeListener);
    console.log(
      JSON.stringify({
        event: "process_smoke_listening",
        service: "admin-api",
        environment: manifest.environment,
        initialized: true,
        listening: true,
        binding,
        healthRequest: { method: "GET", path: healthPath },
      }),
    );
    return;
  }

  if (smoke) {
    await application.listen(0, listener.host);
    const applicationUrl = new URL(await application.getUrl());
    const boundPort = Number.parseInt(applicationUrl.port, 10);
    if (applicationUrl.hostname !== listener.host || !Number.isInteger(boundPort)) {
      await application.close();
      throw new Error("Admin API smoke did not bind an ephemeral IPv4 loopback listener");
    }
    await application.close();
    console.log(
      JSON.stringify({
        event: "process_smoke",
        service: "admin-api",
        environment: manifest.environment,
        initialized: true,
        listening: true,
        binding: {
          requestedPort: 0,
          boundAddress: applicationUrl.hostname,
          boundPort,
          ephemeralPortRequested: true,
        },
        cleanShutdown: true,
      }),
    );
    return;
  }

  const shutdown = (): void => {
    void application.close().finally(() => runtime?.destroy());
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await application.listen(listener.port, listener.host);
};

void main().catch(() => {
  console.error(
    JSON.stringify({
      event: "process_bootstrap_failed",
      service: "admin-api",
    }),
  );
  process.exitCode = 1;
});
