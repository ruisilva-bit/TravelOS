// Copied to deployment/verify-artifact.mjs. Authenticate the archive and
// verifier before executing it; a payload-written pin is not independent trust.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { PREDECESSOR } from "../provenance/source/tooling/ci/stage-10/constants.mjs";
import {
  assertDigest,
  regularBytes,
  sha256,
} from "../provenance/source/tooling/ci/stage-10/io.mjs";
import { qualifyExtractedArtifact } from "../provenance/source/tooling/ci/stage-10/qualify-artifact.mjs";

const allowed = [
  "archive",
  "receipt",
  "receipt-sha256",
  "inputs",
  "inputs-sha256",
  "node-sha256",
  "predecessor-archive",
];

export function parseVerifierArguments(argv) {
  const args = new Map();
  for (const arg of argv) {
    const match = /^--([a-z0-9-]+)=(.+)$/u.exec(arg);
    assert.ok(
      match && allowed.includes(match[1]) && !args.has(match[1]),
      "Unknown/duplicate verifier argument",
    );
    args.set(match[1], match[2]);
  }
  return Object.fromEntries(args);
}

// Structured, read-only API. The legacy installer passes a root string and is
// deliberately rejected: it cannot infer or bypass the independent input pins.
export async function verifyArtifact(options) {
  assert.ok(
    options !== null && typeof options === "object" && !Array.isArray(options),
    "Structured verifier inputs required",
  );
  assert.ok(
    Object.keys(options).every((key) => allowed.includes(key)),
    "Unknown verifier option",
  );
  const args = new Map(Object.entries(options));
  assert.equal(
    args.size,
    allowed.length,
    "Require archive, receipt, inputs, independent SHA-256 pins and predecessor archive",
  );
  for (const key of ["receipt-sha256", "inputs-sha256", "node-sha256"]) assertDigest(args.get(key));
  for (const key of ["archive", "receipt", "inputs", "predecessor-archive"])
    assert.ok(path.isAbsolute(args.get(key)), "Verifier input paths must be absolute");
  const inputsBytes = await regularBytes(args.get("inputs"));
  assert.equal(
    sha256(inputsBytes),
    args.get("inputs-sha256"),
    "Independent frozen input digest mismatch",
  );
  const receiptBytes = await regularBytes(args.get("receipt"));
  assert.equal(
    sha256(receiptBytes),
    args.get("receipt-sha256"),
    "Independent receipt digest mismatch",
  );
  assert.equal(
    sha256(await regularBytes(args.get("predecessor-archive"))),
    PREDECESSOR.archiveSha256,
    "Predecessor archive must be accepted gen11",
  );
  const result = await qualifyExtractedArtifact({
    payload: path.resolve(fileURLToPath(new URL("..", import.meta.url))),
    archive: args.get("archive"),
    receipt: JSON.parse(receiptBytes),
    expectedReceiptSha256: args.get("receipt-sha256"),
    inputs: JSON.parse(inputsBytes),
    expectedNodeSha256: args.get("node-sha256"),
  });
  return result;
}

const direct =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (direct) {
  try {
    const result = await verifyArtifact(parseVerifierArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ result: "FAIL", code: "STAGE10_PACKAGE_CHECKS_FAILED", message: error.message })}\n`,
    );
    process.exitCode = 1;
  }
}
