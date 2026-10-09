import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  assertStage5CandidateCoherenceInputs,
  assertStage5CandidateManifest,
} from "./stage-5-candidate-coherence.mjs";
const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const manifest = assertStage5CandidateManifest(
  JSON.parse(readFileSync(path.join(root, "tooling/ci/stage-5-current-candidate.json"), "utf8")),
);
const packageManifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

const validSources = Object.entries(manifest.paths)
  .filter(([component]) => component !== "manifest")
  .map(([component, relativePath]) => ({
    component,
    path: relativePath,
    text: readFileSync(path.join(root, relativePath), "utf8"),
  }));
for (const exception of manifest.historicalReferenceExceptions) {
  if (!validSources.some(({ path: sourcePath }) => sourcePath === exception.path)) {
    validSources.push({
      component: "historicalReferenceException",
      path: exception.path,
      text: readFileSync(path.join(root, exception.path), "utf8"),
    });
  }
}
assert.equal(
  assertStage5CandidateCoherenceInputs({ manifest, activeSources: validSources, packageManifest })
    .candidate,
  manifest.candidate,
);
const staleReference = {
  component: "regression-fixture",
  path: "fixture.mjs",
  text: `run candidate ${manifest.predecessor}`,
};
assert.throws(
  () =>
    assertStage5CandidateCoherenceInputs({
      manifest,
      packageManifest,
      activeSources: [...validSources, staleReference],
    }),
  /hard-coded predecessor candidate reference/u,
  "readiness coherence must reject an injected stale predecessor before CI",
);
const stalePackageManifest = JSON.parse(JSON.stringify(packageManifest));
stalePackageManifest.scripts["evidence:stage5:guard"] =
  `node ${manifest.paths.invocationGuardGenerator} ${manifest.predecessor}`;
assert.throws(
  () =>
    assertStage5CandidateCoherenceInputs({
      manifest,
      activeSources: validSources,
      packageManifest: stalePackageManifest,
    }),
  /hard-coded predecessor candidate reference|derive every candidate identifier/u,
  "readiness coherence must reject a stale predecessor in active package scripts before CI",
);
process.stdout.write(
  `${JSON.stringify({ result: "PASS", staleSourceFixture: "REJECTED_BY_READINESS_COHERENCE", stalePackageScriptFixture: "REJECTED_BY_READINESS_COHERENCE", candidate: manifest.candidate, ciVerifyInvocations: 0, stage6Actions: 0 }, null, 2)}\n`,
);
