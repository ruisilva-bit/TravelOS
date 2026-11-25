import assert from "node:assert/strict";
import path from "node:path";
import { scanSensitiveText } from "../sensitive-data-scanner.mjs";
import { captureSource } from "./candidate.mjs";
import { digest, regularBytes, sha256, strictOptions } from "./io.mjs";

// Read-only local screening; no finding exceptions and no review authority.
// The scanner is heuristic and UTF-8 decoded binary is not full binary inspection.
export const scanFrozenSource = async (options) => {
  strictOptions(options, ["root", "source"]);
  const { root, source } = options;
  assert.deepEqual(await captureSource(root), source, "Frozen source drift before scan");
  const findings = [];
  for (const row of source.files) {
    const bytes = await regularBytes(path.join(root, row.path));
    assert.equal(bytes.length, row.bytes, `Frozen source drift: ${row.path}`);
    assert.equal(sha256(bytes), row.sha256, `Frozen source drift: ${row.path}`);
    findings.push(...scanSensitiveText({ text: bytes.toString("utf8"), file: row.path }).findings);
  }
  assert.deepEqual(await captureSource(root), source, "Frozen source drift after scan");
  return {
    schemaVersion: 1,
    result: findings.length ? "FAIL" : "PASS",
    authority: "LOCAL_SCAN_ONLY_NOT_PRIVACY_REVIEW",
    limitations: "Heuristic UTF-8 text screening; not binary inspection or privacy review",
    sourceSha256: digest(source),
    files: source.files,
    findings,
  };
};
