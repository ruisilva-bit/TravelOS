import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BRANCH, PREDECESSOR, STAGE } from "./constants.mjs";
import { regularBytes, sha256 } from "./io.mjs";
import { verifyInheritedBaseline } from "./predecessor-baseline-adapter.mjs";

const originalPath = "tooling/deployment/verify-stage9-deployment-contract.mjs";
export function adaptStage9ContractSource(source, root) {
  const branch = "assert.equal(branch, STAGE9_BRANCH);";
  assert.equal(source.split(branch).length, 2, "Historical branch assertion anchor drift");
  let adapted = source.replace(branch, `assert.equal(branch, ${JSON.stringify(BRANCH)});`);
  for (const [from, to] of [
    ["../ci/stage-9/constants.mjs", "tooling/ci/stage-9/constants.mjs"],
    ["../ci/stage-9-successor-baseline.mjs", "tooling/ci/stage-9-successor-baseline.mjs"],
  ]) {
    const quoted = JSON.stringify(from);
    assert.equal(adapted.split(quoted).length, 2, "Historical import anchor drift");
    adapted = adapted.replace(quoted, JSON.stringify(pathToFileURL(path.join(root, to)).href));
  }
  assert.equal(
    adapted.split("import.meta.url").length,
    3,
    "Historical module-location anchor drift",
  );
  return adapted.replaceAll(
    "import.meta.url",
    JSON.stringify(pathToFileURL(path.join(root, originalPath)).href),
  );
}

// Contract assertions only. This grants no installation/restart/activation authority.
export async function verifyStage9ContractReference({ root }) {
  await verifyInheritedBaseline(root);
  const original = await regularBytes(path.join(root, originalPath));
  const accepted = execFileSync("git", ["show", `${PREDECESSOR.commit}:${originalPath}`], {
    cwd: root,
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  assert.deepEqual(original, accepted, "Historical deployment verifier changed");
  const adapted = adaptStage9ContractSource(original.toString("utf8"), root);
  const temporary = await mkdtemp("/home/hermes/.hermes/cache/scratch/stage10-stage9-contract-");
  try {
    const modulePath = path.join(temporary, "reference-contract.mjs");
    await writeFile(modulePath, adapted, { flag: "wx", mode: 0o600 });
    const module = await import(pathToFileURL(modulePath).href);
    const reference = await module.verifyStage9DeploymentContract({ root });
    assert.equal(reference.result, "PASS");
    assert.equal(reference.migrationHead, "0016_stage9_staff_invitations");
    return {
      result: "PASS",
      stage: STAGE,
      reference,
      originalVerifierSha256: sha256(original),
      metadataAdaptation: "BRANCH_BOUND_TO_STAGE10_ONLY",
      scope:
        "HISTORICAL_CONTRACT_ASSERTIONS_WITH_CURRENT_SUCCESSOR_BRANCH_NOT_OPERATIONAL_AUTHORITY",
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
