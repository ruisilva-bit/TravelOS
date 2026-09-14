import "reflect-metadata";

import { loadDevelopmentInstanceManifest } from "@travelos/config";

import { createPortalApi } from "./app.js";

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

const main = async (): Promise<void> => {
  const manifestPath = readRequiredArgument("--manifest");
  const manifest = await loadDevelopmentInstanceManifest(manifestPath);
  const application = await createPortalApi();
  const listener = manifest.runtime.listeners.portalApi;

  if (process.argv.includes("--smoke")) {
    await application.listen(0, listener.host);
    const applicationUrl = new URL(await application.getUrl());
    const boundPort = Number.parseInt(applicationUrl.port, 10);
    if (applicationUrl.hostname !== listener.host || !Number.isInteger(boundPort)) {
      await application.close();
      throw new Error("Portal API smoke did not bind an ephemeral IPv4 loopback listener");
    }
    const healthPath = "/health/live";
    const healthResult = await (async () => {
      try {
        const response = await fetch(new URL(healthPath, applicationUrl));
        const body: unknown = await response.json();
        if (response.status !== 200) {
          throw new Error(`Portal API liveness smoke returned HTTP ${response.status}`);
        }
        return { status: response.status, body };
      } finally {
        await application.close();
      }
    })();
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
        healthRequest: { method: "GET", path: healthPath },
        healthStatus: healthResult.status,
        healthResponse: healthResult.body,
        cleanShutdown: true,
      }),
    );
    return;
  }

  application.enableShutdownHooks(["SIGINT", "SIGTERM"]);
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
