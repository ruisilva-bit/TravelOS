import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyStage5SecurityExtensionBaseline } from "./verify-stage-5-security-extension-baseline.mjs";

export const verifyStage5Final20SecurityExtensionBaseline = async ({
  root = process.cwd(),
} = {}) => {
  const verification = await verifyStage5SecurityExtensionBaseline({
    root,
    requireCandidate: "FINAL-20",
  });
  const baseline = JSON.parse(
    await readFile(
      path.join(root, "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json"),
      "utf8",
    ),
  );
  return {
    ...verification,
    candidate: "FINAL-20",
    protectedPathCount: baseline.protectedFiles.length,
    permittedDeltaPaths: baseline.lineage.final20Generation.protectedPathDeltas.map(
      (row) => row.path,
    ),
    stage6Actions: baseline.lineage.final20Generation.stage6Actions,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyStage5Final20SecurityExtensionBaseline({ root: process.cwd() });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
