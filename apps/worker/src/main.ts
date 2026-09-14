import { loadDevelopmentInstanceManifest } from "@travelos/config";

import { bootstrapWorkerProcess } from "./worker-process.js";

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
  const worker = bootstrapWorkerProcess();

  console.log(
    JSON.stringify({
      event: "process_bootstrap",
      service: "worker",
      environment: manifest.environment,
      state: worker.state(),
    }),
  );

  if (process.argv.includes("--smoke")) {
    await worker.shutdown();
    console.log(
      JSON.stringify({
        event: "process_shutdown",
        service: "worker",
        state: worker.state(),
      }),
    );
    return;
  }

  await new Promise<void>((resolve) => {
    const idleHandle = setInterval(() => undefined, 2_147_483_647);
    const shutdown = (): void => {
      clearInterval(idleHandle);
      void worker.shutdown().then(resolve);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
};

void main().catch(() => {
  console.error(
    JSON.stringify({
      event: "process_bootstrap_failed",
      service: "worker",
    }),
  );
  process.exitCode = 1;
});
