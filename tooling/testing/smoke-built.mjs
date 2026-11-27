import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { createInterface } from "node:readline";

const root = process.cwd();
const manifest = "deploy/manifests/development.example.json";
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sha256 = (content) => createHash("sha256").update(content).digest("hex");

const runProcessSmoke = (service) => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, `apps/${service}/dist/main.js`), `--manifest=${manifest}`, "--smoke"],
    { cwd: root, encoding: "utf8", timeout: 15_000 },
  );
  assert(result.status === 0, `${service} smoke failed: ${result.stderr}`);
  const events = result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { service, exitCode: result.status, events };
};

const requestApiHealth = ({ service, host, port, expectedHost }) =>
  new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: host,
        port,
        path: "/health/live",
        method: "GET",
        headers: { host: expectedHost },
      },
      (response) => {
        let bodyText = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          bodyText += chunk;
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              body: JSON.parse(bodyText),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.setTimeout(5_000, () =>
      request.destroy(new Error(`${service} health smoke timed out`)),
    );
    request.on("error", reject);
    request.end();
  });

const runApiListenerSmoke = async ({ service, hostKey }) => {
  const developmentManifest = JSON.parse(await readFile(path.join(root, manifest), "utf8"));
  const expectedHost = developmentManifest.hosts?.[hostKey];
  assert(typeof expectedHost === "string", `Development manifest ${service} host is missing`);

  const child = spawn(
    process.execPath,
    [path.join(root, `apps/${service}/dist/main.js`), `--manifest=${manifest}`, "--smoke-listener"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  const events = [];
  let stderr = "";
  let readyEvent = null;
  let closed = false;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const lines = createInterface({ input: child.stdout });
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let resolveExit;
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });

  lines.on("line", (line) => {
    try {
      const event = JSON.parse(line);
      events.push(event);
      if (readyEvent === null && event.event === "process_smoke_listening") {
        readyEvent = event;
        resolveReady(event);
      }
    } catch (error) {
      rejectReady(new Error(`${service} smoke emitted invalid JSON: ${error.message}`));
    }
  });
  child.once("error", rejectReady);
  child.once("close", (code, signal) => {
    closed = true;
    const result = { code, signal };
    if (readyEvent === null) {
      rejectReady(
        new Error(
          `${service} smoke listener exited before readiness (${JSON.stringify(result)}): ${stderr}`,
        ),
      );
    }
    resolveExit(result);
  });

  const startupTimeout = setTimeout(
    () => rejectReady(new Error(`${service} smoke listener startup timed out: ${stderr}`)),
    15_000,
  );
  try {
    const listening = await readyPromise;
    clearTimeout(startupTimeout);
    assert(
      listening.binding?.boundAddress === "127.0.0.1" &&
        Number.isInteger(listening.binding?.boundPort) &&
        listening.binding.boundPort > 0,
      `${service} smoke listener did not bind an ephemeral IPv4 loopback address`,
    );

    const health = await requestApiHealth({
      service,
      host: listening.binding.boundAddress,
      port: listening.binding.boundPort,
      expectedHost,
    });
    assert(health.status === 200, `${service} health smoke returned HTTP ${health.status}`);
    child.kill("SIGTERM");
    const exit = await exitPromise;
    assert(
      exit.code === 0 && exit.signal === null,
      `${service} smoke did not exit cleanly: ${JSON.stringify(exit)}`,
    );
    const shutdown = events.find((event) => event.event === "process_smoke_shutdown");
    assert(
      shutdown?.state === "STOPPED" && shutdown.cleanShutdown === true,
      `${service} smoke did not report clean shutdown`,
    );

    return {
      service,
      exitCode: exit.code,
      events: [
        ...events,
        {
          event: "process_smoke",
          service,
          environment: listening.environment,
          initialized: listening.initialized,
          listening: listening.listening,
          binding: listening.binding,
          healthRequest: { method: "GET", path: "/health/live" },
          healthStatus: health.status,
          healthResponse: health.body,
          cleanShutdown: shutdown.cleanShutdown,
        },
      ],
    };
  } finally {
    clearTimeout(startupTimeout);
    lines.close();
    if (!closed && child.pid !== undefined) {
      child.kill("SIGKILL");
      await exitPromise;
    }
  }
};

const collectFiles = async (directory) => {
  const files = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else files.push(absolute);
    }
  };
  await walk(directory);
  return files.sort();
};

const webBuild = async (app, requiredText) => {
  const directory = path.join(root, `apps/${app}/dist`);
  assert((await stat(path.join(directory, "index.html"))).isFile(), `${app} index.html is missing`);
  const files = await collectFiles(directory);
  const contents = await Promise.all(files.map((file) => readFile(file)));
  const aggregate = Buffer.concat(contents).toString("utf8");
  assert(
    aggregate.includes(requiredText),
    `${app} bundle does not contain its own application title`,
  );
  return {
    app,
    markerChecks: {
      ownMarker: requiredText,
      ownMarkerPresent: true,
    },
    fileCount: files.length,
    aggregateSha256: sha256(Buffer.concat(contents)),
    files: await Promise.all(
      files.map(async (file) => ({
        path: path.relative(root, file),
        bytes: (await stat(file)).size,
        sha256: sha256(await readFile(file)),
      })),
    ),
  };
};

const adminWeb = await webBuild("admin-web", "TravelOS");
const processSmokes = [
  await runApiListenerSmoke({ service: "admin-api", hostKey: "admin" }),
  runProcessSmoke("worker"),
];
assert(
  processSmokes[0].events.some(
    (event) =>
      event.event === "process_smoke" &&
      event.initialized === true &&
      event.listening === true &&
      event.binding?.requestedPort === 0 &&
      event.binding?.boundAddress === "127.0.0.1" &&
      Number.isInteger(event.binding?.boundPort) &&
      event.binding.boundPort > 0 &&
      event.binding?.ephemeralPortRequested === true &&
      event.healthRequest?.method === "GET" &&
      event.healthRequest?.path === "/health/live" &&
      event.healthStatus === 200 &&
      event.cleanShutdown === true,
  ),
  "Admin API did not initialize",
);
assert(
  processSmokes[1].events.some(
    (event) => event.event === "process_bootstrap" && event.state === "RUNNING",
  ),
  "Worker did not enter RUNNING state",
);
assert(
  processSmokes[1].events.some(
    (event) => event.event === "process_shutdown" && event.state === "STOPPED",
  ),
  "Worker did not shut down",
);

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      result: "PASS",
      deployablesBuilt: 3,
      webBuilds: [adminWeb],
      processSmokes,
    },
    null,
    2,
  ),
);
