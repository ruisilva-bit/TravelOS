import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadDevelopmentInstanceManifest, readSystemdCredentialText } from "@travelos/config";
import { createPostgresPersistence, createWorkerRepository } from "@travelos/database";
import { createStructuredLogger } from "@travelos/observability";

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
  const log = createStructuredLogger("worker");
  const directory = process.env["RUNTIME_DIRECTORY"];
  if (process.argv.includes("--health")) {
    if (directory === undefined || !path.isAbsolute(directory) || directory.includes(":"))
      throw new Error("Worker runtime directory is required");
    const input: unknown = JSON.parse(await readFile(path.join(directory, "health.json"), "utf8"));
    if (typeof input !== "object" || input === null) throw new Error("Invalid worker health");
    const record = input as Record<string, unknown>;
    const fresh =
      typeof record["checkedAt"] === "number" &&
      Date.now() - record["checkedAt"] >= 0 &&
      Date.now() - record["checkedAt"] < 30_000;
    const live = fresh && record["live"] === true;
    const ready = live && record["ready"] === true;
    console.log(JSON.stringify({ live, ready }));
    process.exitCode = ready ? 0 : 1;
    return;
  }
  const manifestPath = readRequiredArgument("--manifest");
  const manifest = await loadDevelopmentInstanceManifest(manifestPath);

  if (process.argv.includes("--smoke")) {
    const worker = bootstrapWorkerProcess();
    console.log(
      JSON.stringify({ event: "process_bootstrap", service: "worker", state: worker.state() }),
    );
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

  if (directory === undefined || !path.isAbsolute(directory) || directory.includes(":"))
    throw new Error("Worker runtime directory is required");
  const persistence = createPostgresPersistence<Record<string, never>>({
    host: manifest.database.host,
    port: manifest.database.port,
    database: manifest.database.name,
    user: manifest.database.runtimeRoles.worker.roleName,
    password: await readSystemdCredentialText(
      manifest.database.runtimeRoles.worker.credentialReference,
    ),
    tls: { mode: manifest.database.tlsPolicy },
    applicationName: "travelos-worker",
    maxConnections: 2,
    connectionTimeoutMs: 5000,
    statementTimeoutMs: 5000,
    idleInTransactionTimeoutMs: 5000,
  });
  const worker = bootstrapWorkerProcess({
    repository: createWorkerRepository(persistence),
    owner: randomUUID(),
    log,
  });
  let stopped = false;
  let wake: (() => void) | null = null;
  const stop = (): void => {
    stopped = true;
    wake?.();
    void worker.shutdown();
  };
  const publishHealth = async (): Promise<void> => {
    const health = worker.diagnostics();
    const temporary = path.join(directory, "health.next.json");
    await writeFile(
      temporary,
      JSON.stringify({
        checkedAt: Date.now(),
        live: health.live,
        ready: health.ready,
        stats: health.stats,
      }),
      { mode: 0o600 },
    );
    await rename(temporary, path.join(directory, "health.json"));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    log({ action: "process_bootstrap", outcome: "NOT_READY" });
    while (!stopped) {
      await worker.tick().catch(() => undefined);
      await publishHealth();
      if (!stopped)
        await new Promise<void>((resolve) => {
          const handle = setTimeout(resolve, 1000);
          wake = () => {
            clearTimeout(handle);
            resolve();
          };
        });
      wake = null;
    }
  } finally {
    await worker.shutdown();
    await publishHealth();
    await persistence.destroy();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    log({ action: "process_shutdown", outcome: "STOPPED" });
  }
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
