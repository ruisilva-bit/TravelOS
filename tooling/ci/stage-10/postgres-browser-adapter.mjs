// Local, non-consuming subset only; never an aggregate qualification receipt.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { PREDECESSOR } from "./constants.mjs";
import { assertDigest, regularBytes, safeAncestors, sha256 } from "./io.mjs";
import { qualifyExtractedArtifact } from "./qualify-artifact.mjs";
import { checkNoScriptForms } from "./stage10-runtime-browser-shell.mjs";
import { stopPostgres } from "./stage10-runtime-api-postgres.mjs";
import { runRuntimeLanes } from "./stage10-runtime-lanes.mjs";

const allowed = [
  "profile",
  "payload",
  "archive",
  "receipt",
  "inputs",
  "predecessor-archive",
  "pg-root",
  "receipt-sha256",
  "inputs-sha256",
  "node-sha256",
];
let args;
try {
  args = new Map();
  for (const arg of process.argv.slice(2)) {
    const match = /^--([a-z0-9-]+)=(.+)$/u.exec(arg);
    assert.ok(match && allowed.includes(match[1]) && !args.has(match[1]));
    args.set(match[1], match[2]);
  }
  assert.equal(args.size, allowed.length);
  assert.equal(args.get("profile"), "local");
  for (const key of ["payload", "archive", "receipt", "inputs", "predecessor-archive", "pg-root"]) {
    const value = args.get(key);
    assert.ok(path.isAbsolute(value) && path.normalize(value) === value);
  }
  for (const key of ["receipt-sha256", "inputs-sha256", "node-sha256"]) assertDigest(args.get(key));
} catch {
  process.stderr.write('{"result":"FAIL","code":"STAGE10_ADAPTER_INPUT_INVALID"}\n');
  process.exit(1);
}
try {
  const inputsBytes = await regularBytes(args.get("inputs"));
  const receiptBytes = await regularBytes(args.get("receipt"));
  const inputs = JSON.parse(inputsBytes);
  assert.equal(sha256(inputsBytes), args.get("inputs-sha256"));
  assert.equal(sha256(receiptBytes), args.get("receipt-sha256"));
  assert.equal(
    sha256(await regularBytes(args.get("predecessor-archive"))),
    PREDECESSOR.archiveSha256,
  );
  assert.equal(inputs.runtimeNodeSha256, args.get("node-sha256"));
  assert.equal(sha256(await regularBytes(process.execPath)), inputs.runtimeNodeSha256);
  await qualifyExtractedArtifact({
    payload: args.get("payload"),
    archive: args.get("archive"),
    receipt: JSON.parse(receiptBytes),
    expectedReceiptSha256: args.get("receipt-sha256"),
    inputs,
    expectedNodeSha256: args.get("node-sha256"),
  });
} catch {
  process.stderr.write('{"result":"FAIL","code":"STAGE10_ARTIFACT_VALIDATION_FAILED"}\n');
  process.exit(1);
}
try {
  const browser = await checkNoScriptForms(args.get("payload"));
  process.stdout.write(
    `${JSON.stringify({ lane: "NO_SCRIPT_SHELL_ONLY", result: "PASS", ...browser })}\n`,
  );
} catch {
  process.stderr.write('{"result":"FAIL","code":"STAGE10_NO_SCRIPT_SHELL_FAILED"}\n');
  process.exit(1);
}

// Hash locked Debian packages, then execute only a fresh private extraction;
// the caller's already-extracted tree is never treated as authenticated.
const packages = [
  ["postgresql-18.deb", "bf4062a44757c3f7a207a1b9e20c2bf93f9847257516c2ce0befc1257d3dcf8e"],
  ["postgresql-client-18.deb", "9af40c99f7074f8ff3798155af2f07f1a4e1e3bd4edce44ef928c1e03aea620e"],
  ["libpq5.deb", "c6cc459bb499db4697686533e50bf5943f7e7d6929c04ef55eec184d5436859b"],
  ["liburing2.deb", "4b589c00c7a51172aace2cb2fb3d3ff32daf86c644023126dcfcaa840cc941ea"],
];
let work,
  cleanupOk = true,
  aggregate;
try {
  assert.ok(
    typeof process.getuid === "function" && process.getuid() !== 0,
    "non-root local execution required",
  );
  await safeAncestors(args.get("pg-root"), true);
  work = await mkdtemp(path.join(os.tmpdir(), "stage10-adapter-"));
  const pg = path.join(work, "pg"),
    tmp = path.join(work, "tmp");
  await mkdir(pg);
  await mkdir(tmp);
  for (const [name, expected] of packages) {
    const bytes = await regularBytes(path.join(args.get("pg-root"), name));
    assert.equal(sha256(bytes), expected);
    const copy = path.join(work, name);
    await writeFile(copy, bytes, { mode: 0o600 });
    const extracted = spawnSync("/usr/bin/dpkg-deb", ["-x", copy, pg], {
      env: { PATH: "/usr/bin:/bin" },
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    assert.equal(extracted.status, 0);
    assert.ok(!extracted.error);
  }
  const env = {
    PATH: "/usr/bin:/bin",
    HOME: process.env.HOME,
    TMPDIR: tmp,
    TRAVELOS_STAGE10_EXTRACTED_ROOT: args.get("payload"),
    TRAVELOS_STAGE10_PG_ROOT: pg,
    TRAVELOS_STAGE9_ACCEPTED_ARCHIVE: args.get("predecessor-archive"),
  };
  const scripts = [
    "stage10-runtime-api-postgres.mjs",
    "stage10-runtime-cumulative-postgres.mjs",
  ].map((name) => fileURLToPath(new URL(name, import.meta.url)));
  aggregate = await runRuntimeLanes({ node: process.execPath, scripts, env });
  aggregate.execution = {
    uid: process.getuid(),
    trust: "LOCAL_CALLER_UID_NOT_AUTHENTICATED",
    postgresPackages: "LOCKED_HASH_PRIVATE_EXTRACTION",
  };
  // On abnormal termination, lane finally blocks may not run. Attempt to stop
  // every discoverable disposable server; preserve work if cleanup is uncertain.
  if (aggregate.result === "FAIL") {
    const pgEnv = {
      ...env,
      LD_LIBRARY_PATH: [
        path.join(pg, "usr/lib/x86_64-linux-gnu"),
        path.join(pg, "usr/lib/postgresql/18/lib"),
      ].join(":"),
    };
    for (const entry of await readdir(tmp, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^stage10-(api|cumulative)-pg-/u.test(entry.name)) continue;
      const data = path.join(tmp, entry.name, "data");
      if (
        !stopPostgres({
          pgCtl: path.join(pg, "usr/lib/postgresql/18/bin/pg_ctl"),
          data,
          env: pgEnv,
        })
      )
        cleanupOk = false;
    }
    aggregate.cleanupAfterAbnormalExit = cleanupOk ? "STOP_ATTEMPTED" : "UNVERIFIED";
  }
} catch {
  aggregate = { result: "FAIL", code: "STAGE10_RUNTIME_PREPARATION_FAILED" };
} finally {
  if (work && cleanupOk) await rm(work, { recursive: true, force: true });
  if (!cleanupOk) aggregate.cleanupWorkPreserved = work;
}
process.stdout.write(`${JSON.stringify(aggregate)}\n`);
process.exitCode = 1;
