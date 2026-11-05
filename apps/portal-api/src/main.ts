import "reflect-metadata";

import {
  createAuthRealmPostgresDatabase,
  createPortalAuthRealm,
} from "@travelos/auth-adapters/portal";
import {
  loadDevelopmentInstanceManifest,
  readSystemdCredentialText,
  type DevelopmentInstanceManifest,
} from "@travelos/config";

import { createPortalApi, type CreatePortalApiOptions } from "./app.js";
import {
  createPostgresPortalAuthorizedTripListReader,
  createPostgresPortalTripSnapshotReader,
} from "./trip-read-repository.js";

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

const createPortalAuthOptions = async (
  manifest: DevelopmentInstanceManifest,
): Promise<{
  readonly options: CreatePortalApiOptions;
  readonly destroy: () => Promise<void>;
}> => {
  const databaseCredential = await readSystemdCredentialText(
    manifest.database.runtimeRoles.portalApi.credentialReference,
  );
  const realmKeyMaterial = await readSystemdCredentialText(
    manifest.authentication.portalRealmCredentialReference,
  );
  const realmDatabase = createAuthRealmPostgresDatabase({
    host: manifest.database.host,
    port: manifest.database.port,
    database: manifest.database.name,
    user: manifest.database.runtimeRoles.portalApi.roleName,
    password: databaseCredential,
    tls: { mode: manifest.database.tlsPolicy },
    applicationName: "travelos-portal-api",
    maxConnections: 10,
  });
  try {
    const realm = createPortalAuthRealm({
      database: realmDatabase.database,
      canonicalOrigin: `http://${manifest.hosts.portal}`,
      realmKeyMaterial,
      environment: manifest.environment,
    });
    const tripSnapshotReader = createPostgresPortalTripSnapshotReader(realmDatabase.database);
    const tripListReader = createPostgresPortalAuthorizedTripListReader(realmDatabase.database);
    return {
      options: {
        expectedHost: manifest.hosts.portal,
        tripSnapshotReader,
        tripListReader,
        auth: {
          realm,
          policy: {
            canonicalOrigin: `http://${manifest.hosts.portal}`,
            expectedHost: manifest.hosts.portal,
          },
        },
      },
      destroy: () => realmDatabase.destroy(),
    };
  } catch (error) {
    await realmDatabase.destroy();
    throw error;
  }
};

const main = async (): Promise<void> => {
  const manifestPath = readRequiredArgument("--manifest");
  const manifest = await loadDevelopmentInstanceManifest(manifestPath);
  const listener = manifest.runtime.listeners.portalApi;
  const smoke = process.argv.includes("--smoke");
  const smokeListener = process.argv.includes("--smoke-listener");
  const runtime = smoke || smokeListener ? null : await createPortalAuthOptions(manifest);
  const application = await createPortalApi({
    expectedHost: manifest.hosts.portal,
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
      throw new Error("Portal API smoke did not bind an ephemeral IPv4 loopback listener");
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
              service: "portal-api",
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
        service: "portal-api",
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
      throw new Error("Portal API smoke did not bind an ephemeral IPv4 loopback listener");
    }
    await application.close();
    console.log(
      JSON.stringify({
        event: "process_smoke",
        service: "portal-api",
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
      service: "portal-api",
    }),
  );
  process.exitCode = 1;
});
