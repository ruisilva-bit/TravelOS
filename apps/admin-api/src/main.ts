import "reflect-metadata";

import { createStaffAuthRealm } from "@travelos/auth-adapters";
import {
  loadDevelopmentInstanceManifest,
  readSystemdCredentialText,
  type DevelopmentInstanceManifest,
} from "@travelos/config";
import {
  createM1OperationalSliceRepository,
  createPostgresPersistence,
  createStaffAccessRepository,
} from "@travelos/database";

import { createAdminApi, type CreateAdminApiOptions } from "./app.js";

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
  readonly options: CreateAdminApiOptions;
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
    return {
      options: {
        auth: {
          realm,
          policy: {
            canonicalOrigin: `http://${manifest.hosts.admin}`,
            expectedHost: manifest.hosts.admin,
          },
          staffAccessRepository: createStaffAccessRepository(persistence),
          m1Repository: createM1OperationalSliceRepository(persistence),
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
  const runtime = smoke ? null : await createAdminAuthOptions(manifest);
  const application = await createAdminApi(runtime?.options ?? {}).catch(async (error: unknown) => {
    await runtime?.destroy();
    throw error;
  });

  if (smoke) {
    await application.listen(0, listener.host);
    const applicationUrl = new URL(await application.getUrl());
    const boundPort = Number.parseInt(applicationUrl.port, 10);
    if (applicationUrl.hostname !== listener.host || !Number.isInteger(boundPort)) {
      await application.close();
      throw new Error("Admin API smoke did not bind an ephemeral IPv4 loopback listener");
    }
    const healthPath = "/health/live";
    const healthResult = await (async () => {
      try {
        const response = await fetch(new URL(healthPath, applicationUrl));
        const body: unknown = await response.json();
        if (response.status !== 200) {
          throw new Error(`Admin API liveness smoke returned HTTP ${response.status}`);
        }
        return { status: response.status, body };
      } finally {
        await application.close();
      }
    })();
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
        healthRequest: { method: "GET", path: healthPath },
        healthStatus: healthResult.status,
        healthResponse: healthResult.body,
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
