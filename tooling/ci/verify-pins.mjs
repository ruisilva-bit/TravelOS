import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { evaluateWorkspacePolicy, readEffectiveWorkspacePolicy } from "./workspace-policy.mjs";

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};
const sha256 = (content) => createHash("sha256").update(content).digest("hex");

const root = process.cwd();
const packageJson = await readJson(path.join(root, "package.json"));
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const expected = { ...packageJson.dependencies, ...packageJson.devDependencies };
for (const [name, version] of Object.entries(expected)) {
  assert(exactVersion.test(version), `${name} must be an exact version pin, found ${version}`);
}
const packageScopedExactPins = {
  "@travelos/auth-adapters": {
    "@better-auth/kysely-adapter": "1.6.27",
  },
};
assert(packageJson.packageManager === "pnpm@11.21.0", "packageManager pin mismatch");
assert(packageJson.engines?.node === "24.19.0", "Node engine pin mismatch");
assert(process.version === "v24.19.0", `Expected Node v24.19.0, received ${process.version}`);

const commandVersion = (command) => {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  assert(result.status === 0, `${command} --version failed`);
  return result.stdout.trim();
};
const corepackVersion = commandVersion("corepack");
const pnpmVersion = commandVersion("pnpm");
assert(corepackVersion === "0.35.0", `Corepack pin mismatch: ${corepackVersion}`);
assert(pnpmVersion === "11.21.0", `pnpm pin mismatch: ${pnpmVersion}`);
assert(
  (await readFile(path.join(root, ".node-version"), "utf8")).trim() === "24.19.0",
  ".node-version mismatch",
);

const workspacePolicy = evaluateWorkspacePolicy(await readEffectiveWorkspacePolicy(root));
assert(
  workspacePolicy.result === "PASS",
  `Effective pnpm workspace policy differs from the reviewed exact policy: ${JSON.stringify(
    workspacePolicy.checks,
  )}`,
);

const packageDirectories = ["apps", "packages"];
const workspaceManifests = [];
for (const directory of packageDirectories) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      workspaceManifests.push(path.join(root, directory, entry.name, "package.json"));
    }
  }
}
for (const manifestPath of workspaceManifests) {
  const manifest = await readJson(manifestPath);
  const permittedPackagePins = {
    ...expected,
    ...(packageScopedExactPins[manifest.name] ?? {}),
  };
  for (const section of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (String(version).startsWith("workspace:")) {
        assert(
          name.startsWith("@travelos/"),
          `Only TravelOS packages may use workspace protocol: ${name}`,
        );
        continue;
      }
      assert(
        permittedPackagePins[name] !== undefined,
        `${manifest.name} declares an unqualified external dependency: ${name}`,
      );
      assert(
        version === permittedPackagePins[name],
        `${manifest.name} has a non-approved pin for ${name}`,
      );
    }
  }
}

const listResult = spawnSync("pnpm", ["list", "--depth", "0", "--json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});
assert(listResult.status === 0, "pnpm list failed");
const listedRoot = JSON.parse(listResult.stdout).find((entry) => entry.path === root);
assert(listedRoot !== undefined, "pnpm list did not return the workspace root");
const resolvedDirect = { ...listedRoot.dependencies, ...listedRoot.devDependencies };
for (const [name, version] of Object.entries(expected)) {
  assert(
    resolvedDirect[name]?.version === version,
    `${name} resolved to ${resolvedDirect[name]?.version ?? "missing"}`,
  );
}

const lockContent = await readFile(path.join(root, "pnpm-lock.yaml"), "utf8");
const lodashVersions = new Set(
  [...lockContent.matchAll(/^\s{2}lodash@([^:(\s]+).*:$/gm)].map((match) => match[1]),
);
assert(
  lodashVersions.size === 1 && lodashVersions.has("4.18.1"),
  `Unexpected lodash versions: ${[...lodashVersions].join(", ")}`,
);

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      result: "PASS",
      toolchain: { node: process.version.slice(1), corepack: corepackVersion, pnpm: pnpmVersion },
      directPins: { count: Object.keys(expected).length, exactPins: true, resolvedMatch: true },
      workspace: {
        projectCount: workspaceManifests.length + 1,
        externalDeclarationsUseApprovedPins: true,
      },
      policies: {
        engineStrict: workspacePolicy.actual.npmrc["engine-strict"] === "true",
        strictPeers: workspacePolicy.actual.npmrc["strict-peer-dependencies"] === "true",
        saveExact: workspacePolicy.actual.npmrc["save-exact"] === "true",
        minimumReleaseAgeMinutes: workspacePolicy.actual.minimumReleaseAge,
        minimumReleaseAgeExclusions: workspacePolicy.actual.minimumReleaseAgeExclude,
        approvedBuildScripts: Object.keys(workspacePolicy.actual.allowBuilds).sort(),
        lodashOverride: workspacePolicy.actual.overrides.lodash,
        structuralChecks: workspacePolicy.checks,
      },
      lockfile: { sha256: sha256(lockContent), frozenCandidate: true },
    },
    null,
    2,
  ),
);
