import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, watch } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  retainDeploymentEvidence as retain,
  verifyRetainedDeploymentEvidence as verify,
} from "./stage10-evidence-retention.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("retains exactly verified and scanned deployment logs without overwriting", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "travelos-stage10-evidence-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "source");
  const outputRoot = path.join(root, "output");
  await mkdir(sourceRoot);
  await mkdir(outputRoot, { mode: 0o700 });
  const out = Buffer.from("synthetic safe receipt\n");
  const err = Buffer.from("");
  await writeFile(path.join(sourceRoot, "stdout.log"), out);
  await writeFile(path.join(sourceRoot, "stderr.log"), err);
  const receipt = {
    schemaVersion: 1,
    result: "PASS",
    candidate: "gen01",
    artifactSha256: "a".repeat(64),
    commands: [
      {
        phase: "runtime-check",
        exitCode: 0,
        logs: {
          stdout: { path: "stdout.log", bytes: out.length, sha256: sha256(out) },
          stderr: { path: "stderr.log", bytes: err.length, sha256: sha256(err) },
        },
      },
    ],
  };
  const receiptPath = path.join(sourceRoot, "deployment.json");
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt)}\n`);
  await writeFile(receiptPath, receiptBytes);
  const args = {
    sourceRoot,
    receiptPath,
    outputRoot,
    bundleName: "attempt-01",
    expectedReceiptSha256: sha256(receiptBytes),
  };
  await assert.rejects(retain({ ...args, expectedReceiptSha256: undefined }));
  await assert.rejects(retain({ ...args, expectedReceiptSha256: "0".repeat(64) }));
  await symlink(outputRoot, path.join(root, "output-link"));
  await assert.rejects(
    retain({ ...args, outputRoot: path.join(root, "output-link"), bundleName: "linked-output" }),
  );
  const result = await retain(args);
  assert.equal(result.logCount, 2);
  const quarantineRoot = path.join(outputRoot, "quarantine");
  const bundle = path.join(quarantineRoot, "attempt-01");
  assert.deepEqual((await readdir(bundle)).sort(), ["index.json", "logs", "source-receipt.json"]);
  const index = JSON.parse(await readFile(path.join(bundle, "index.json"), "utf8"));
  assert.equal(index.logs.length, 2);
  assert.equal(
    (await readFile(path.join(bundle, "logs/runtime-check.stdout.log"))).toString(),
    out.toString(),
  );
  assert.equal(
    (await verify({ bundleRoot: bundle, expectedReceiptSha256: sha256(receiptBytes) })).logCount,
    2,
  );
  await writeFile(path.join(bundle, "logs/runtime-check.stdout.log"), "changed\n");
  await assert.rejects(verify({ bundleRoot: bundle, expectedReceiptSha256: sha256(receiptBytes) }));
  await writeFile(path.join(bundle, "logs/runtime-check.stdout.log"), out);
  await assert.rejects(verify({ bundleRoot: bundle, expectedReceiptSha256: "0".repeat(64) }));
  await writeFile(path.join(bundle, "unexpected.log"), "unexpected\n");
  await assert.rejects(verify({ bundleRoot: bundle, expectedReceiptSha256: sha256(receiptBytes) }));
  await rm(path.join(bundle, "unexpected.log"));
  const indexed = await readFile(path.join(bundle, "index.json"));
  await writeFile(path.join(bundle, "index.json"), JSON.stringify({ ...index, unknown: true }));
  await assert.rejects(verify({ bundleRoot: bundle, expectedReceiptSha256: sha256(receiptBytes) }));
  await writeFile(path.join(bundle, "index.json"), indexed);
  await assert.rejects(retain(args));
  const racedDestination = path.join(quarantineRoot, "raced");
  let planted = false;
  const watcher = watch(quarantineRoot, (_event, name) => {
    if (!planted && String(name).startsWith(".raced.staging-")) {
      mkdirSync(racedDestination);
      planted = true;
    }
  });
  try {
    await assert.rejects(retain({ ...args, bundleName: "raced" }));
    assert.equal(planted, true);
    assert.deepEqual(await readdir(racedDestination), []);
  } finally {
    watcher.close();
  }
  await rm(racedDestination, { recursive: true });
  await writeFile(path.join(sourceRoot, "stdout.log"), "tampered\n");
  await assert.rejects(retain({ ...args, bundleName: "tampered" }));
  await writeFile(path.join(sourceRoot, "stdout.log"), out);
  const secret = Buffer.from("person@example.invalid\n");
  await writeFile(path.join(sourceRoot, "stdout.log"), secret);
  receipt.commands[0].logs.stdout = {
    path: "stdout.log",
    bytes: secret.length,
    sha256: sha256(secret),
  };
  await writeFile(receiptPath, JSON.stringify(receipt));
  await assert.rejects(
    retain({
      ...args,
      bundleName: "sensitive",
      expectedReceiptSha256: sha256(Buffer.from(JSON.stringify(receipt))),
    }),
  );
  receipt.commands[0].logs.stdout = {
    path: "../outside.log",
    bytes: out.length,
    sha256: sha256(out),
  };
  await writeFile(receiptPath, JSON.stringify(receipt));
  await assert.rejects(
    retain({
      ...args,
      bundleName: "traversal",
      expectedReceiptSha256: sha256(Buffer.from(JSON.stringify(receipt))),
    }),
  );
  await symlink(path.join(sourceRoot, "stderr.log"), path.join(sourceRoot, "link.log"));
  receipt.commands[0].logs.stdout = { path: "link.log", bytes: 0, sha256: sha256(err) };
  await writeFile(receiptPath, JSON.stringify(receipt));
  await assert.rejects(
    retain({
      ...args,
      bundleName: "symlink",
      expectedReceiptSha256: sha256(Buffer.from(JSON.stringify(receipt))),
    }),
  );
  assert.deepEqual(await readdir(outputRoot), ["quarantine"]);
  assert.deepEqual(
    (await readdir(quarantineRoot)).filter((name) => !name.startsWith(".")),
    ["attempt-01"],
  );
});
