// Isolated unit fixtures: package probes/claim inspection are mocked. No build
// or CI claim is consumed; real temporary input/archive bytes model late drift.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { registerHooks } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { buildPaths } from "./build-artifact.mjs";
import { digest, jsonBytes, sha256 } from "./io.mjs";

const gateUrl = new URL("./stage10-candidate-gate.mjs", import.meta.url).href;
const modules = {
  "./candidate.mjs":
    "export const verifyInputs=(...a)=>globalThis.__stage10GateDriftFixture.verifyInputs(...a); export const corepackInvocation=()=>{throw Error('Unexpected process invocation in drift fixture')};",
  "./one-shot.mjs":
    "export const inspectClaim=(...a)=>globalThis.__stage10GateDriftFixture.inspectClaim(...a);",
  "./qualify-artifact.mjs":
    "export const qualifyExtractedArtifact=(...a)=>globalThis.__stage10GateDriftFixture.qualify(...a);",
  "./predecessor-baseline-adapter.mjs":
    "export const verifyInheritedBaseline=(...a)=>globalThis.__stage10GateDriftFixture.baseline(...a);",
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === gateUrl && Object.hasOwn(modules, specifier))
      return {
        url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { runCandidateGate } = await import(gateUrl);
after(() => {
  hooks.deregister();
  delete globalThis.__stage10GateDriftFixture;
});

for (const gate of ["stage10-baseline", "stage10-build-receipt", "stage10-exact-artifact"]) {
  for (const attack of [
    "none",
    "source-during-work",
    "archive-during-work",
    "source-during-final-probe",
  ]) {
    test(`${gate}: ${attack}`, async () => {
      const root = await mkdtemp(path.join(process.env.TMPDIR, "candidate-gate-drift-"));
      try {
        const candidate = "gen12";
        const paths = buildPaths(root, candidate);
        await mkdir(paths.directory, { recursive: true });
        const marker = path.join(root, "source-marker");
        await writeFile(marker, "original source");
        const archiveBytes = Buffer.from("synthetic archive fixture, not a release");
        await writeFile(paths.archive, archiveBytes);
        const receipt = { fixture: true, archiveSha256: sha256(archiveBytes) };
        const checksBytes = jsonBytes({ result: "PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED" });
        await writeFile(paths.receipt, jsonBytes(receipt));
        await writeFile(paths.qualification, checksBytes);
        let calls = 0;
        const verifyInputs = async () => ({
          inputDigest: "a".repeat(64),
          runtimeNodeSha256: sha256(await readFile(process.execPath)),
          source: { snapshotSha256: sha256(await readFile(marker)) },
        });
        globalThis.__stage10GateDriftFixture = {
          verifyInputs,
          inspectClaim: async () => ({
            state: "PASSED_CONSUMED",
            claim: { record: { operation: "PRODUCTION_BUILD_ONCE", candidate } },
            outcome: {
              receipt: {
                buildReceiptSha256: digest(receipt),
                packageChecksSha256: sha256(checksBytes),
              },
            },
          }),
          qualify: async (options) => {
            assert.equal(options.payload, paths.extracted);
            assert.equal(options.archive, paths.archive);
            assert.equal(options.expectedReceiptSha256, digest(receipt));
            assert.equal(
              sha256(await readFile(paths.archive)),
              receipt.archiveSha256,
              "Fixture archive drift rejected",
            );
            calls++;
            if (calls === 1 && attack === "archive-during-work")
              await writeFile(paths.archive, "changed archive");
            if (
              (calls === 1 && attack === "source-during-work") ||
              (calls === 2 && attack === "source-during-final-probe")
            )
              await writeFile(marker, "changed source");
            return { result: "MOCKED_PACKAGE_PROBE_ONLY" };
          },
          baseline: async () => {},
        };
        const execute = () => runCandidateGate({ root, candidate, gate });
        if (attack === "none") {
          assert.equal((await execute()).result, "PASS");
          assert.equal(calls, 2, "Both initial and final package checks must run");
        } else {
          await assert.rejects(
            execute(),
            attack === "archive-during-work"
              ? /Fixture archive drift rejected/u
              : /Inputs changed during candidate gate/u,
          );
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}
