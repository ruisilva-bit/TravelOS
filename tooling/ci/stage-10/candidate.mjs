import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { BRANCH, MIGRATION_HEAD, PREDECESSOR, STAGE, STATE, TOOLCHAIN } from "./constants.mjs";
import { GATES } from "./gates.mjs";
import {
  digest,
  exclusiveBytes,
  jsonBytes,
  parseCandidate,
  privateDirectory,
  regularBytes,
  safeAncestors,
  sha256,
} from "./io.mjs";

const git = (root, args) => execFileSync("git", args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
export const captureSource = async (root) => {
  await safeAncestors(root, true);
  const files = git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((file) => !file.startsWith(".hermes/"))
    .sort();
  assert.ok(files.length, "Source snapshot must not be empty");
  assert.equal(new Set(files).size, files.length, "Duplicate source path");
  const rows = [];
  for (const file of files) {
    assert.ok(!path.isAbsolute(file) && !file.split("/").includes(".."), "Unsafe source path");
    const absolute = path.join(root, file);
    const bytes = await regularBytes(absolute);
    const metadata = await lstat(absolute);
    assert.ok(
      metadata.isFile() && !metadata.isSymbolicLink(),
      "Source must be regular, not symlink",
    );
    rows.push({
      path: file,
      bytes: bytes.length,
      sha256: sha256(bytes),
      executable: (metadata.mode & 0o111) !== 0,
    });
  }
  return {
    schemaVersion: 1,
    stage: STAGE,
    discovery: "git tracked + nonignored untracked, excluding local .hermes/ only",
    files: rows,
  };
};
export const inputIdentity = ({
  source,
  migration,
  toolchain,
  predecessor,
  gatesSha256,
  runtimeNodeSha256,
}) => digest({ source, migration, toolchain, predecessor, gatesSha256, runtimeNodeSha256 });
// This DEVELOPMENT build-host profile deliberately has no caller override.
// Version output alone cannot authenticate a PATH-selected package manager.
const buildModules = "/home/hermes/.local/share/travelos-stage5-toolchain/node_modules";
const corepackPins = Object.freeze({
  "dist/corepack.js": "3655bc798f300951f2070fee411b337d626b0c3ae80c2d24c46ccac4595d4bf9",
  "dist/pnpm.js": "7c2a67995976b5b592b611d8b236e3b0633bd654fb49aedd96c6eb7ce04c9cbb",
  "dist/lib/corepack.cjs": "89cc83cf02dafbb768017901147933023eb43d6ce6373f9698b8b2f29210a9fd",
});
export const corepackInvocation = () => {
  const node = path.join(buildModules, "node/bin/node");
  assert.equal(realpathSync(process.execPath), node, "Stage 10 requires the fixed build-host Node");
  for (const [relative, pin] of Object.entries(corepackPins)) {
    const file = path.join(buildModules, "corepack", relative);
    assert.equal(realpathSync(file), file, "Corepack implementation must not be redirected");
    const metadata = lstatSync(file);
    assert.ok(
      metadata.isFile() &&
        !(metadata.mode & 0o002) &&
        metadata.uid === process.getuid() &&
        metadata.gid === process.getgid(),
      "Unsafe Corepack implementation",
    );
    assert.equal(sha256(readFileSync(file)), pin, "Pinned Corepack implementation mismatch");
  }
  for (const name of ["corepack", "pnpm"]) {
    assert.equal(
      realpathSync(path.join(buildModules, ".bin", name)),
      path.join(buildModules, "corepack/dist", `${name}.js`),
      "Corepack launcher redirection",
    );
  }
  return {
    command: node,
    prefix: [path.join(buildModules, "corepack/dist/corepack.js")],
    path: `${path.join(buildModules, "node/bin")}:${path.join(buildModules, ".bin")}:/usr/bin:/bin`,
  };
};
export const readToolchain = (root) => {
  const invocation = corepackInvocation();
  const version = (args) =>
    execFileSync(invocation.command, [...invocation.prefix, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      env: {
        PATH: invocation.path,
        HOME: "/home/hermes",
        TMPDIR: process.env.TMPDIR,
        COREPACK_ENABLE_NETWORK: "0",
        LANG: "C.UTF-8",
        TZ: "UTC",
      },
    }).trim();
  const toolchain = {
    node: process.version.slice(1),
    corepack: version(["--version"]),
    pnpm: version(["pnpm", "--version"]),
  };
  assert.deepEqual(toolchain, TOOLCHAIN, "Pinned Stage 10 toolchain mismatch");
  return toolchain;
};
export const verifyPredecessor = async (root, archive) => {
  assert.equal(
    git(root, ["rev-parse", `${PREDECESSOR.tag}^{commit}`])
      .toString()
      .trim(),
    PREDECESSOR.commit,
    "Exact accepted Stage 9 ref mismatch",
  );
  git(root, ["merge-base", "--is-ancestor", PREDECESSOR.commit, "HEAD"]);
  const archiveBytes = await regularBytes(archive);
  assert.equal(
    sha256(archiveBytes),
    PREDECESSOR.archiveSha256,
    "Accepted Stage 9 archive mismatch (gen11 required)",
  );
  return PREDECESSOR;
};
// No application functionality delta is authorized here. Every existing file is
// protected, including package.json. The script wiring plan needs a separately
// reviewed successor allowance before changing existing bytes.
export const verifyBaseline = async (root) => {
  assert.equal(
    git(root, ["rev-parse", `${PREDECESSOR.tag}^{commit}`])
      .toString()
      .trim(),
    PREDECESSOR.commit,
    "Exact accepted Stage 9 ref mismatch",
  );
  const tree = git(root, ["ls-tree", "-r", "-z", PREDECESSOR.commit])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  let matched = 0;
  for (const row of tree) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/su.exec(row);
    assert.ok(match, "Unsupported predecessor tree entry");
    const [, mode, object, file] = match;
    const old = git(root, ["cat-file", "blob", object]);
    const current = await regularBytes(path.join(root, file));
    // package.json additions require an independently reviewed successor policy;
    // this implementation deliberately does NOT silently permit any delta.
    assert.deepEqual(current, old, `Protected Stage 9 predecessor changed: ${file}`);
    assert.equal(
      ((await lstat(path.join(root, file))).mode & 0o111) !== 0,
      mode === "100755",
      `Predecessor mode changed: ${file}`,
    );
    matched += 1;
  }
  return {
    result: "PASS",
    predecessor: PREDECESSOR.commit,
    matched,
    allowedExistingFileDeltas: [],
  };
};
export const freezePath = (root, candidate) => {
  parseCandidate(candidate);
  return path.join(root, STATE, "candidates", candidate, "inputs.json");
};
export const collectInputs = async ({ root, predecessorArchive }) => {
  assert.equal(
    git(root, ["branch", "--show-current"]).toString().trim(),
    BRANCH,
    "Stage 10 branch mismatch",
  );
  const predecessor = await verifyPredecessor(root, predecessorArchive);
  await verifyBaseline(root);
  const source = await captureSource(root);
  const migrations = source.files.filter((row) => row.path.startsWith("migrations/"));
  assert.ok(
    migrations.some((row) => row.path === `migrations/${MIGRATION_HEAD}.cjs`),
    "Migration head missing",
  );
  const migration = { head: MIGRATION_HEAD, files: migrations };
  const toolchain = readToolchain(root);
  const gatesSha256 = digest(GATES);
  const runtimeNodeSha256 = sha256(await regularBytes(process.execPath));
  return {
    source,
    migration,
    toolchain,
    predecessor,
    gatesSha256,
    runtimeNodeSha256,
    inputDigest: inputIdentity({
      source,
      migration,
      toolchain,
      predecessor,
      gatesSha256,
      runtimeNodeSha256,
    }),
  };
};
export const freezeInputs = async ({ root, candidate, predecessorArchive }) => {
  parseCandidate(candidate);
  const first = await collectInputs({ root, predecessorArchive });
  const second = await collectInputs({ root, predecessorArchive });
  assert.deepEqual(second, first, "Nondeterministic or drifting candidate inputs");
  const record = {
    schemaVersion: 1,
    stage: STAGE,
    candidate,
    ...first,
    status: "INPUT_FREEZE_ONLY_NOT_QUALIFIED",
    trust: "PENDING",
    privacy: "PENDING",
    stage11Actions: 0,
  };
  const file = freezePath(root, candidate);
  await privateDirectory(path.dirname(file));
  await exclusiveBytes(file, jsonBytes(record));
  return record;
};
export const verifyInputs = async ({ root, candidate, predecessorArchive }) => {
  const bytes = await regularBytes(freezePath(root, candidate));
  const record = JSON.parse(bytes);
  assert.equal(record.candidate, candidate);
  assert.equal(record.stage, STAGE);
  assert.deepEqual(bytes, jsonBytes(record), "Noncanonical input freeze serialization");
  const actual = await collectInputs({ root, predecessorArchive });
  for (const key of Object.keys(actual))
    assert.deepEqual(record[key], actual[key], `Frozen input drift: ${key}`);
  return record;
};
