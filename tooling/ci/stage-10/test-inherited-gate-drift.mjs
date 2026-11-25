// Unit-only drift injection. Claim/package probes are mocked because exercising
// this contract must not consume a real build/CI claim. Migration checks use Git
// and the actual accepted 16-file chain; no historical source is changed.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { registerHooks } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { digest, jsonBytes, sha256 } from "./io.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const target = new URL("./inherited-compatibility-adapter.mjs", import.meta.url).href;
const replacements = {
  "./candidate.mjs": "export const verifyInputs=(...a)=>globalThis.__inheritedDrift.inputs(...a);",
  "./build-artifact.mjs": "export const buildPaths=()=>globalThis.__inheritedDrift.paths;",
  "./one-shot.mjs": "export const inspectClaim=()=>globalThis.__inheritedDrift.claim;",
  "./predecessor-baseline-adapter.mjs": "export const verifyInheritedBaseline=async()=>{};",
  "./qualify-artifact.mjs":
    "export const qualifyExtractedArtifact=(...a)=>globalThis.__inheritedDrift.qualify(...a);",
  "./packaged-migrator-regression.mjs":
    "export const qualifyPackagedMigrator=async()=>({result:'PASS'});",
  "./io.mjs": `export * from ${JSON.stringify(new URL("./io.mjs", import.meta.url).href)}; export const privateDirectory=async()=>{};`,
  "./successor-baseline.mjs":
    "export const verifySuccessorBaseline=async()=>({result:'PASS'}); export const verifyAcceptedStage6Baseline=async()=>({result:'PASS'});",
  "./source-scope.mjs": "export const verifyCurrentSourceScope=async()=>({result:'PASS'});",
  ...Object.fromEntries(
    [
      ["stage6-fixture-regression", "runStage6FixtureRegression"],
      ["baseline-inverse-regression", "runBaselineInverseRegression"],
      ["stage6-contract-regression", "runStage6ContractRegression"],
      ["stage7-contract-regression", "runStage7ContractRegression"],
      ["stage9-contract-regression", "verifyStage9ContractReference"],
      ["stage7-artifact-regression", "runStage7ArtifactRegression"],
      ["stage8-artifact-regression", "runStage8ArtifactRegression"],
      ["stage9-artifact-regression", "runStage9ArtifactRegression"],
    ].map(([file, name]) => [`./${file}.mjs`, `export const ${name}=async()=>({result:'PASS'});`]),
  ),
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === target && Object.hasOwn(replacements, specifier))
      return {
        url: `data:text/javascript,${encodeURIComponent(replacements[specifier])}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { runInheritedCompatibility } = await import(target);
after(() => {
  hooks.deregister();
  delete globalThis.__inheritedDrift;
});

for (const gate of [
  "stage6-baseline",
  "stage6-baseline-tests",
  "stage6-migrator",
  "stage6-bootstrap",
  "stage6-contract",
  "stage6-contract-tests",
  "stage7-baseline",
  "stage7-predecessor",
  "stage7-baseline-tests",
  "stage7-source-scope",
  "stage7-migrator",
  "stage7-contract",
  "stage7-contract-tests",
  "stage7-artifact",
  "stage8-artifact",
  "stage9-contract",
  "stage9-artifact",
]) {
  for (const attack of ["none", "archive-during-work", "source-during-final-probe"]) {
    test(`${gate} rejects post-operation drift: ${attack}`, async () => {
      const scratch = await mkdtemp(path.join(process.env.TMPDIR, "inherited-drift-"));
      try {
        const candidate = "gen12";
        const paths = Object.fromEntries(
          ["receipt", "qualification", "archive", "extracted", "ledger"].map((key) => [
            key,
            path.join(scratch, key),
          ]),
        );
        await mkdir(paths.extracted);
        const marker = path.join(scratch, "source-marker");
        await writeFile(marker, "original");
        await writeFile(paths.archive, "synthetic archive, not an artifact");
        const archiveHash = sha256(await readFile(paths.archive));
        const receipt = { synthetic: true, archiveSha256: archiveHash };
        const checks = jsonBytes({ result: "PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED" });
        await writeFile(paths.receipt, jsonBytes(receipt));
        await writeFile(paths.qualification, checks);
        let calls = 0;
        globalThis.__inheritedDrift = {
          paths,
          inputs: async () => ({
            inputDigest: "a".repeat(64),
            runtimeNodeSha256: sha256(await readFile(process.execPath)),
            source: sha256(await readFile(marker)),
          }),
          claim: {
            state: "PASSED_CONSUMED",
            claim: { record: { operation: "PRODUCTION_BUILD_ONCE", candidate } },
            outcome: {
              receipt: { buildReceiptSha256: digest(receipt), packageChecksSha256: sha256(checks) },
            },
          },
          qualify: async (options) => {
            assert.equal(options.archive, paths.archive);
            assert.equal(options.expectedReceiptSha256, digest(receipt));
            assert.equal(
              sha256(await readFile(paths.archive)),
              archiveHash,
              "Archive drift rejected",
            );
            calls++;
            if (calls === 1 && attack === "archive-during-work")
              await writeFile(paths.archive, "changed");
            if (calls === 2 && attack === "source-during-final-probe")
              await writeFile(marker, "changed");
          },
        };
        const execute = () => runInheritedCompatibility({ root, candidate, gate });
        if (attack === "none") {
          assert.equal((await execute()).result, "PASS");
          assert.equal(calls, 2, "Initial and final artifact qualification required");
        } else
          await assert.rejects(
            execute(),
            attack === "archive-during-work"
              ? /Archive drift rejected/u
              : /Inputs changed during inherited gate/u,
          );
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    });
  }
}
