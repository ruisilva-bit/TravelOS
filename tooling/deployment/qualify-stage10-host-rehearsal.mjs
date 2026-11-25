// Test composition only: execute package probes as the unprivileged parent,
// never in the privileged activation namespace or on CT200.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { regularBytes, sha256 } from "../ci/stage-10/io.mjs";
import { qualifyExtractedArtifact } from "../ci/stage-10/qualify-artifact.mjs";

const required = [
  "payload",
  "archive",
  "archive-sha256",
  "artifact-id",
  "receipt",
  "receipt-sha256",
  "inputs",
  "inputs-sha256",
  "node-sha256",
];
export function parseQualificationOptions(argv) {
  const options = {};
  for (const arg of argv) {
    const match = /^--([a-z0-9-]+)=(.+)$/u.exec(arg);
    assert.ok(
      match && required.includes(match[1]) && !Object.hasOwn(options, match[1]),
      "Unknown or duplicate qualification option",
    );
    options[match[1]] = match[2];
  }
  assert.equal(Object.keys(options).length, required.length, "Missing qualification option");
  for (const key of ["payload", "archive", "receipt", "inputs"])
    assert.ok(path.isAbsolute(options[key]), "Absolute qualification path required");
  for (const key of ["archive-sha256", "receipt-sha256", "inputs-sha256", "node-sha256"])
    assert.match(options[key], /^[a-f0-9]{64}$/u, "Invalid independent pin");
  assert.match(options["artifact-id"], /^travelos-stage10-[a-z0-9][a-z0-9-]{0,80}$/u);
  return options;
}

export async function qualifyHostRehearsal(options) {
  assert.ok(
    process.getuid() !== 0 && process.geteuid() !== 0,
    "Package probes must not run as root",
  );
  assert.equal(
    sha256(await regularBytes(process.execPath)),
    options["node-sha256"],
    "Parent Node pin mismatch",
  );
  const receiptBytes = await regularBytes(options.receipt);
  const inputsBytes = await regularBytes(options.inputs);
  assert.equal(sha256(receiptBytes), options["receipt-sha256"], "Independent receipt pin mismatch");
  assert.equal(
    sha256(inputsBytes),
    options["inputs-sha256"],
    "Independent frozen inputs pin mismatch",
  );
  const result = await qualifyExtractedArtifact({
    payload: options.payload,
    archive: options.archive,
    receipt: JSON.parse(receiptBytes),
    expectedReceiptSha256: options["receipt-sha256"],
    inputs: JSON.parse(inputsBytes),
    expectedNodeSha256: options["node-sha256"],
  });
  assert.equal(result.result, "PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED");
  assert.equal(result.archiveSha256, options["archive-sha256"]);
  assert.equal(result.artifactId, options["artifact-id"]);
  return {
    result: result.result,
    artifactId: result.artifactId,
    archiveSha256: result.archiveSha256,
    executionIdentity: "UNPRIVILEGED_PARENT",
    trust: "PENDING",
    privacy: "PENDING",
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.stdout.write(
      `${JSON.stringify(await qualifyHostRehearsal(parseQualificationOptions(process.argv.slice(2))))}\n`,
    );
  } catch {
    process.stderr.write(
      '{"result":"FAIL","code":"STAGE10_HOST_REHEARSAL_QUALIFICATION_FAILED"}\n',
    );
    process.exitCode = 1;
  }
}
