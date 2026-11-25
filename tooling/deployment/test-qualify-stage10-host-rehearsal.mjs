import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import {
  parseQualificationOptions,
  qualifyHostRehearsal,
} from "./qualify-stage10-host-rehearsal.mjs";

const options = {
  payload: "/fixture/payload",
  archive: "/fixture/archive.tar.gz",
  "archive-sha256": "a".repeat(64),
  "artifact-id": "travelos-stage10-gen12-example",
  receipt: "/fixture/receipt.json",
  "receipt-sha256": "b".repeat(64),
  inputs: "/fixture/inputs.json",
  "inputs-sha256": "c".repeat(64),
  "node-sha256": "0".repeat(64),
};
const args = Object.entries(options).map(([key, value]) => `--${key}=${value}`);
test("all independently supplied pins and absolute paths are required", () => {
  assert.deepEqual(parseQualificationOptions(args), options);
});
for (const [name, invalid] of [
  ["missing", args.slice(1)],
  ["duplicate", [...args, args[0]]],
  ["unknown", [...args, "--approve=true"]],
  ["relative", args.map((arg) => (arg.startsWith("--payload=") ? "--payload=relative" : arg))],
  [
    "malformed pin",
    args.map((arg) => (arg.startsWith("--node-sha256=") ? "--node-sha256=bad" : arg)),
  ],
  [
    "wrong stage",
    args.map((arg) =>
      arg.startsWith("--artifact-id=") ? "--artifact-id=travelos-stage9-example" : arg,
    ),
  ],
])
  test(`${name} qualification input is rejected`, () =>
    assert.throws(() => parseQualificationOptions(invalid)));

test("bad parent executable pin rejects before nonexistent package inputs are read", async () => {
  await assert.rejects(
    qualifyHostRehearsal(options),
    /Parent Node pin mismatch|Package probes must not run as root/u,
  );
});
test("actual invalid CLI fails with a constant sanitized error", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./qualify-stage10-host-rehearsal.mjs", import.meta.url)),
      "--approve=true",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), {
    result: "FAIL",
    code: "STAGE10_HOST_REHEARSAL_QUALIFICATION_FAILED",
  });
});
