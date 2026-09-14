import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

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

const webBuild = async (app, requiredText, forbiddenText) => {
  const directory = path.join(root, `apps/${app}/dist`);
  assert((await stat(path.join(directory, "index.html"))).isFile(), `${app} index.html is missing`);
  const files = await collectFiles(directory);
  const contents = await Promise.all(files.map((file) => readFile(file)));
  const aggregate = Buffer.concat(contents).toString("utf8");
  assert(
    aggregate.includes(requiredText),
    `${app} bundle does not contain its own application title`,
  );
  assert(
    !aggregate.includes(forbiddenText),
    `${app} bundle contains the other application's title`,
  );
  return {
    app,
    markerChecks: {
      ownMarker: requiredText,
      ownMarkerPresent: true,
      otherMarker: forbiddenText,
      otherMarkerAbsent: true,
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

const adminWeb = await webBuild("admin-web", "TravelOS", "TravelOS Portal");
const portalWeb = await webBuild("portal-web", "TravelOS Portal", 'data-routing-root="admin"');
const processSmokes = [
  runProcessSmoke("admin-api"),
  runProcessSmoke("portal-api"),
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
  "Portal API did not initialize",
);
assert(
  processSmokes[2].events.some(
    (event) => event.event === "process_bootstrap" && event.state === "RUNNING",
  ),
  "Worker did not enter RUNNING state",
);
assert(
  processSmokes[2].events.some(
    (event) => event.event === "process_shutdown" && event.state === "STOPPED",
  ),
  "Worker did not shut down",
);

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      result: "PASS",
      deployablesBuilt: 5,
      webBuilds: [adminWeb, portalWeb],
      processSmokes,
    },
    null,
    2,
  ),
);
