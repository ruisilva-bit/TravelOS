import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  STAGE_4_EVIDENCE_DIRECTORY,
  STAGE_4_EVIDENCE_INDEX,
  STAGE_4_EXPECTED_EVIDENCE_ARTIFACT_NAMES,
  verifyStage4EvidenceIndex,
} from "./stage-4-evidence-contract.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDirectory = path.join(repositoryRoot, STAGE_4_EVIDENCE_DIRECTORY);
const indexPath = path.join(repositoryRoot, STAGE_4_EVIDENCE_INDEX);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

await mkdir(evidenceDirectory, { recursive: true });
const artifacts = [];
for (const name of STAGE_4_EXPECTED_EVIDENCE_ARTIFACT_NAMES) {
  const bytes = await readFile(path.join(evidenceDirectory, name));
  artifacts.push({
    path: `${STAGE_4_EVIDENCE_DIRECTORY}/${name}`,
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
}
const aggregateSerialization = artifacts
  .map((artifact) => `${artifact.path}\0${artifact.bytes}\0${artifact.sha256}\n`)
  .join("");
await writeFile(
  indexPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      phase: "Phase 1 M1",
      stage: 4,
      scope:
        "authentication realms, Staff authorization foundation, disposable qualification, controlled DEVELOPMENT CT 200 migration and cleanup",
      result: "PASS",
      artifactCount: artifacts.length,
      aggregateAlgorithm: "sha256(path\\0bytes\\0sha256\\n ordered by path)",
      aggregateSha256: sha256(aggregateSerialization),
      artifacts,
    },
    null,
    2,
  )}\n`,
);
const verification = await verifyStage4EvidenceIndex({ root: repositoryRoot });
if (verification.result !== "PASS") {
  throw new Error(
    `Written Stage 4 evidence index failed verification: ${JSON.stringify(verification)}`,
  );
}
console.log(JSON.stringify(verification, null, 2));
