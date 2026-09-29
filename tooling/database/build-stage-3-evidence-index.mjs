import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE_3_EVIDENCE_DIRECTORY,
  STAGE_3_EVIDENCE_INDEX,
  STAGE_3_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  verifyStage3EvidenceIndex,
} from "./stage-3-evidence-contract.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.join(repositoryRoot, STAGE_3_EVIDENCE_DIRECTORY);
const indexPath = path.join(repositoryRoot, STAGE_3_EVIDENCE_INDEX);
const sha256 = (content) => createHash("sha256").update(content).digest("hex");
await mkdir(evidenceDirectory, { recursive: true });

const artifacts = [];
for (const name of STAGE_3_EXPECTED_EVIDENCE_ARTIFACT_NAMES) {
  const absolutePath = path.join(evidenceDirectory, name);
  const bytes = await readFile(absolutePath);
  artifacts.push({
    path: `${STAGE_3_EVIDENCE_DIRECTORY}/${name}`,
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
}
const aggregateSerialization = artifacts
  .map((artifact) => `${artifact.path}\0${artifact.bytes}\0${artifact.sha256}\n`)
  .join("");
const index = {
  schemaVersion: 1,
  phase: "Phase 1 M1",
  stage: 3,
  scope:
    "corrected repository foundation, retained disposable and CT 200 PostgreSQL evidence, focused correction proofs, and final repository regression; Stage 4 excluded",
  result: "PASS",
  artifactCount: artifacts.length,
  aggregateAlgorithm: "sha256(path\\0bytes\\0sha256\\n ordered by path)",
  aggregateSha256: sha256(aggregateSerialization),
  artifacts,
};
await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);

const verification = await verifyStage3EvidenceIndex({ root: repositoryRoot });
if (verification.result !== "PASS") {
  throw new Error(
    `Written Stage 3 evidence index failed verification: ${JSON.stringify(verification)}`,
  );
}
console.log(JSON.stringify(verification, null, 2));
