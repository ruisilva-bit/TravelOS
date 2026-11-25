import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import test from "node:test";
import { rehearseServicePaths } from "./service-path-rehearsal.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(process.env.TMPDIR, "stage10-service-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of [
    "runtime/node/bin/node",
    "apps/admin-api/dist/main.js",
    "apps/portal-api/dist/main.js",
    "apps/worker/dist/main.js",
  ]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), "synthetic");
  }
  return root;
}
const service = (name) => ({
  unit: `travelos-${name}.service`,
  workingDirectory: `/opt/travelos/current/apps/${name}`,
  execStart: [
    "/opt/travelos/current/runtime/node/bin/node",
    `/opt/travelos/current/apps/${name}/dist/main.js`,
    "--manifest",
    "/etc/travelos/instances/development.json",
  ],
});
const services = () => ["admin-api", "portal-api", "worker"].map(service);

test("resolves exact declared service paths within extracted payload without starting services", async (t) => {
  const root = await fixture(t);
  const result = await rehearseServicePaths({
    payload: root,
    profile: "CT200_DEVELOPMENT_ONLY",
    services: services(),
  });
  assert.equal(result.result, "PATHS_ONLY_NOT_RUNTIME_OR_DEPLOYMENT_ACCEPTANCE");
  assert.deepEqual(
    result.services.map((x) => x.unit),
    services().map((x) => x.unit),
  );
});

test("rehearses extracted synthetic archive paths against the actual historical service definitions", async (t) => {
  const source = await fixture(t);
  const workspace = await mkdtemp(path.join(process.env.TMPDIR, "stage10-extracted-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const archive = path.join(workspace, "synthetic.tar");
  const extracted = path.join(workspace, "extracted");
  await mkdir(extracted);
  execFileSync("tar", ["-cf", archive, "-C", source, "."]);
  execFileSync("tar", ["-xf", archive, "-C", extracted, "--no-same-owner"]);
  const contract = JSON.parse(
    await readFile(
      fileURLToPath(
        new URL("../../../deploy/contracts/deployment-contract.v1.json", import.meta.url),
      ),
    ),
  );
  const result = await rehearseServicePaths({
    payload: extracted,
    profile: "CT200_DEVELOPMENT_ONLY",
    services: contract.services,
  });
  assert.equal(result.services.length, 3);
});

test("rejects wrong profile, entrypoint, manifest and duplicate services", async (t) => {
  const payload = await fixture(t);
  for (const options of [
    { payload, profile: "PRODUCTION", services: services() },
    {
      payload,
      profile: "CT200_DEVELOPMENT_ONLY",
      services: services().map((s, i) =>
        i
          ? s
          : {
              ...s,
              execStart: [
                s.execStart[0],
                "/opt/travelos/current/apps/worker/dist/main.js",
                ...s.execStart.slice(2),
              ],
            },
      ),
    },
    {
      payload,
      profile: "CT200_DEVELOPMENT_ONLY",
      services: services().map((s, i) =>
        i ? s : { ...s, execStart: [...s.execStart.slice(0, 3), "/tmp/manifest"] },
      ),
    },
    {
      payload,
      profile: "CT200_DEVELOPMENT_ONLY",
      services: [services()[0], services()[0], services()[2]],
    },
  ])
    await assert.rejects(rehearseServicePaths(options));
});

test("rejects missing entrypoint and symlink escaping extracted payload", async (t) => {
  const payload = await fixture(t);
  const options = { payload, profile: "CT200_DEVELOPMENT_ONLY", services: services() };
  await rm(path.join(payload, "apps/admin-api/dist/main.js"));
  await assert.rejects(rehearseServicePaths(options));
  await symlink("/etc/passwd", path.join(payload, "apps/admin-api/dist/main.js"));
  await assert.rejects(rehearseServicePaths(options));
});
