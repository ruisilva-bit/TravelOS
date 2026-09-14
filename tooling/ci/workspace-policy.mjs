import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const expectedWorkspacePolicy = Object.freeze({
  packages: ["apps/*", "packages/*"],
  minimumReleaseAge: 1440,
  minimumReleaseAgeExclude: [],
  overrides: { lodash: "4.18.1" },
  allowBuilds: { esbuild: true },
  npmrc: {
    "engine-strict": "true",
    "save-exact": "true",
    "strict-peer-dependencies": "true",
  },
});

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stable(nested)]),
    );
  }
  return value;
};

const equal = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));

const parseNpmrc = (content) => {
  const result = {};
  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error(`Invalid .npmrc line ${index + 1}`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key in result) throw new Error(`Duplicate .npmrc key: ${key}`);
    result[key] = value;
  }
  return result;
};

export const readEffectiveWorkspacePolicy = async (cwd = process.cwd()) => {
  const config = spawnSync("pnpm", ["config", "list", "--json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (config.status !== 0) {
    throw new Error(`pnpm config list failed: ${config.stderr}`);
  }
  const effective = JSON.parse(config.stdout);
  return {
    packages: effective.packages,
    minimumReleaseAge: effective.minimumReleaseAge,
    minimumReleaseAgeExclude: effective.minimumReleaseAgeExclude,
    overrides: effective.overrides,
    allowBuilds: effective.allowBuilds,
    npmrc: parseNpmrc(await readFile(path.join(cwd, ".npmrc"), "utf8")),
  };
};

export const evaluateWorkspacePolicy = (actual) => {
  const checks = {
    packagesExact: equal(actual.packages, expectedWorkspacePolicy.packages),
    minimumReleaseAgeExact: actual.minimumReleaseAge === expectedWorkspacePolicy.minimumReleaseAge,
    minimumReleaseAgeExclusionsExact: equal(
      actual.minimumReleaseAgeExclude,
      expectedWorkspacePolicy.minimumReleaseAgeExclude,
    ),
    overridesExact: equal(actual.overrides, expectedWorkspacePolicy.overrides),
    approvedBuildsExact: equal(actual.allowBuilds, expectedWorkspacePolicy.allowBuilds),
    npmrcExact: equal(actual.npmrc, expectedWorkspacePolicy.npmrc),
  };
  return {
    schemaVersion: 1,
    result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
    checks,
    expected: expectedWorkspacePolicy,
    actual,
  };
};
