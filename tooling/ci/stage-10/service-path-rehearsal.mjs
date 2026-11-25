import assert from "node:assert/strict";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

// Structural rehearsal only. Never execute an unverified artifact or start a unit.
export async function rehearseServicePaths({ payload, profile, services }) {
  assert.equal(profile, "CT200_DEVELOPMENT_ONLY", "Unsupported deployment profile");
  assert.ok(path.isAbsolute(payload), "Payload must be absolute");
  const root = await realpath(payload);
  assert.equal(root, payload, "Payload path must be canonical");
  assert.equal(services.length, 3, "Expected exactly three runtime services");
  const expected = ["admin-api", "portal-api", "worker"];
  const results = [];
  const check = async (relative, directory) => {
    const target = path.join(root, relative);
    const actual = await realpath(target);
    assert.ok(actual.startsWith(`${root}${path.sep}`), "Resolved path escapes payload");
    const stat = await lstat(actual);
    assert.ok(directory ? stat.isDirectory() : stat.isFile(), "Wrong runtime path type");
  };
  for (const name of expected) {
    const matches = services.filter((s) => s.unit === `travelos-${name}.service`);
    assert.equal(matches.length, 1, "Missing or duplicate service");
    const service = matches[0];
    assert.equal(
      service.workingDirectory,
      `/opt/travelos/current/apps/${name}`,
      "Unexpected working directory",
    );
    assert.deepEqual(
      service.execStart,
      [
        "/opt/travelos/current/runtime/node/bin/node",
        `/opt/travelos/current/apps/${name}/dist/main.js`,
        "--manifest",
        "/etc/travelos/instances/development.json",
      ],
      "Unexpected service command",
    );
    await check(`apps/${name}`, true);
    await check(`apps/${name}/dist/main.js`, false);
    await check("runtime/node/bin/node", false);
    results.push({
      unit: service.unit,
      workingDirectory: service.workingDirectory,
      entrypoint: service.execStart[1],
    });
  }
  return { result: "PATHS_ONLY_NOT_RUNTIME_OR_DEPLOYMENT_ACCEPTANCE", services: results };
}
