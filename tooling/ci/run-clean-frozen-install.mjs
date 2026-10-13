import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { evaluateInstallLifecycleReport } from "./install-lifecycle-policy.mjs";

const root = process.cwd();
const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const run = (command, args, options = {}) =>
  spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
const version = (command) => {
  const result = run(command, ["--version"]);
  if (result.status !== 0) throw new Error(`${command} --version failed`);
  return result.stdout.trim();
};
const toolVersions = {
  node: process.version.slice(1),
  corepack: version("corepack"),
  pnpm: version("pnpm"),
};
if (
  toolVersions.node !== "24.19.0" ||
  toolVersions.corepack !== "0.35.0" ||
  toolVersions.pnpm !== "11.21.0"
) {
  throw new Error(`Unexpected toolchain: ${JSON.stringify(toolVersions)}`);
}

const lockBefore = await readFile(path.join(root, "pnpm-lock.yaml"));
const removed = [];
const removeGenerated = async (relativePath) => {
  await rm(path.join(root, relativePath), { recursive: true, force: true });
  removed.push(relativePath);
};
await removeGenerated("node_modules");
for (const parent of ["apps", "packages"]) {
  for (const entry of await readdir(path.join(root, parent), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    await removeGenerated(path.posix.join(parent, entry.name, "node_modules"));
    await removeGenerated(path.posix.join(parent, entry.name, "dist"));
    await removeGenerated(path.posix.join(parent, entry.name, ".vite"));
  }
}

const install = run("bash", ["tooling/ci/install.sh", "--reporter=append-only"]);
const installOutput = `${install.stdout ?? ""}\n${install.stderr ?? ""}`;
if (install.status !== 0) {
  throw new Error(`Clean frozen install failed:\n${installOutput.slice(-4_000)}`);
}
const lockAfter = await readFile(path.join(root, "pnpm-lock.yaml"));
const workspaceMatch = installOutput.match(/Scope:\s+all\s+(\d+)\s+workspace projects/);
const packageMatch = installOutput.match(/Packages:\s+\+(\d+)/);
const progressMatches = [
  ...installOutput.matchAll(
    /Progress:\s+resolved\s+(\d+),\s+reused\s+(\d+),\s+downloaded\s+(\d+),\s+added\s+(\d+)(?:,\s+done)?/g,
  ),
];
const finalProgress = progressMatches.at(-1);
const installScriptsObserved = [];
for (const line of installOutput.split(/\r?\n/)) {
  const match = line.match(
    /node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\s+(preinstall|install|postinstall)\$\s+(.+)$/,
  );
  if (match) installScriptsObserved.push(`${match[1]} ${match[2]}$ ${match[3]}`);
}

const ignored = run("pnpm", ["ignored-builds"]);
if (ignored.status !== 0) throw new Error(`pnpm ignored-builds failed: ${ignored.stderr}`);
const ignoredNone = /Automatically ignored builds during installation:\s+None\s*$/m.test(
  ignored.stdout,
);

const pins = run("node", ["tooling/ci/verify-pins.mjs"]);
if (pins.status !== 0) throw new Error(`Exact-pin verification failed: ${pins.stderr}`);
let exactPinVerification;
for (
  let index = pins.stdout.lastIndexOf("{");
  index >= 0;
  index = pins.stdout.lastIndexOf("{", index - 1)
) {
  try {
    exactPinVerification = JSON.parse(pins.stdout.slice(index).trim());
    break;
  } catch {
    // Continue to the start of the final complete JSON object.
  }
}
if (exactPinVerification?.result !== "PASS") {
  throw new Error("Exact-pin verifier did not return a PASS report");
}

const report = {
  schemaVersion: 2,
  generator: "tooling/ci/run-clean-frozen-install.mjs",
  timestamp: new Date().toISOString(),
  result: "PASS",
  command: "bash tooling/ci/install.sh --reporter=append-only",
  effectiveRequiredFlags: ["--frozen-lockfile", "--strict-peer-dependencies"],
  exitCode: install.status,
  toolVersions,
  workspaceProjectCount: Number(workspaceMatch?.[1]),
  installedPackageCount: Number(packageMatch?.[1]),
  repositoryLocalStateRemoved: removed.sort(),
  sharedContentAddressableStoreRetained: true,
  lockfile: {
    sha256Before: sha256(lockBefore),
    sha256After: sha256(lockAfter),
    unchanged: Buffer.compare(lockBefore, lockAfter) === 0,
  },
  installScriptsObserved: [...new Set(installScriptsObserved)],
  cacheReuse: {
    sharedCacheRetained: true,
    packagesResolved: Number(finalProgress?.[1]),
    packagesReused: Number(finalProgress?.[2]),
    packagesDownloaded: Number(finalProgress?.[3]),
    packagesAdded: Number(finalProgress?.[4]),
  },
  ignoredBuilds: {
    none: ignoredNone,
    outputBytes: Buffer.byteLength(ignored.stdout),
    outputSha256: sha256(ignored.stdout),
  },
  exactPinVerification,
  installOutput: {
    bytes: Buffer.byteLength(installOutput),
    sha256: sha256(installOutput),
    retainedRawOutput: false,
  },
  redaction:
    "Bounded install metadata only; environment values, cache contents, package contents and raw logs are not retained.",
};
const lifecycle = evaluateInstallLifecycleReport(report);
if (
  report.workspaceProjectCount !== 16 ||
  report.installedPackageCount !== 561 ||
  report.lockfile.unchanged !== true ||
  ignoredNone !== true ||
  lifecycle.result !== "PASS"
) {
  throw new Error(
    `Clean-install evidence contract failed: ${JSON.stringify({ report, lifecycle })}`,
  );
}
report.lifecyclePolicy = lifecycle;
console.log(JSON.stringify(report, null, 2));
