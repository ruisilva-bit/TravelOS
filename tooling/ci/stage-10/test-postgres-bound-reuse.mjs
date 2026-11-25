// Synthetic bound receipts and module-hook package/claim probes: no database,
// process invocation, candidate freeze or build/CI claim occurs in these tests.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { registerHooks } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { buildPaths } from "./build-artifact.mjs";
import { digest, jsonBytes, sha256 } from "./io.mjs";
import {
  postgresCoverage,
  validatePostgresCoverage,
  isPostgresGate,
} from "./postgres-successor-coverage.mjs";

const coverage = await postgresCoverage(fileURLToPath(new URL("../../..", import.meta.url)));
const gateUrl = new URL("./stage10-candidate-gate.mjs", import.meta.url).href;
const modules = {
  "./candidate.mjs":
    "export const verifyInputs=(...a)=>globalThis.__postgresReuse.verifyInputs(...a); export const corepackInvocation=()=>{throw Error('Unexpected process invocation')};",
  "./one-shot.mjs":
    "export const inspectClaim=(...a)=>globalThis.__postgresReuse.inspectClaim(...a);",
  "./qualify-artifact.mjs":
    "export const qualifyExtractedArtifact=(...a)=>globalThis.__postgresReuse.qualify(...a);",
  "./postgres-successor-coverage.mjs":
    "export const INHERITED_POSTGRES_GATES=['stage6-postgres','stage7-postgres','stage8-postgres','stage9-postgres-browser']; export const isPostgresGate=(...a)=>globalThis.__postgresReuse.isPostgresGate(...a); export const postgresCoverage=async()=>globalThis.__postgresReuse.coverage; export const validatePostgresCoverage=(...a)=>globalThis.__postgresReuse.validatePostgresCoverage(...a);",
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
  delete globalThis.__postgresReuse;
});

for (const gate of coverage.gates) {
  for (const attack of [
    "none",
    "absent-receipt",
    "binding",
    "cleanup",
    "mapping",
    "missing-assertion",
    "skipped-assertion",
    "log-digest",
    "archive-during-final-probe",
    "source-during-final-probe",
  ]) {
    test(`${gate}: bound reuse ${attack}`, async (t) => {
      const root = await mkdtemp(path.join(process.env.TMPDIR, "postgres-bound-reuse-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      const candidate = "gen37",
        paths = buildPaths(root, candidate);
      // Derive the state prefix from the owned constants, not an ambient candidate.
      const { STATE } = await import("./constants.mjs");
      const evidence = path.join(root, STATE, "ci-evidence", candidate, "postgres-browser");
      await mkdir(evidence, { recursive: true });
      await mkdir(paths.extracted, { recursive: true });
      await mkdir(path.join(root, STATE, "candidates", candidate), { recursive: true });
      const inputsBytes = jsonBytes({ fixture: "non-consuming" });
      await writeFile(path.join(root, STATE, "candidates", candidate, "inputs.json"), inputsBytes);
      await writeFile(
        path.join(paths.extracted, "release.json"),
        jsonBytes({ artifactId: "synthetic", candidate }),
      );
      const marker = path.join(root, "source-marker");
      await writeFile(marker, "original");
      await writeFile(paths.archive, "original archive");
      const archiveSha256 = sha256(await readFile(paths.archive));
      const receipt = { fixture: true, archiveSha256 },
        receiptBytes = jsonBytes(receipt);
      const checksBytes = jsonBytes({ result: "PACKAGE_CHECKS_PASSED_NOT_RELEASE_QUALIFIED" });
      await writeFile(paths.receipt, receiptBytes);
      await writeFile(paths.qualification, checksBytes);
      const log = Buffer.from(
        `${coverage.suiteFiles.join("\n")}\n Test Files  4 passed (4)\n Tests  95 passed (95)\n`,
      );
      const execution = {
        schemaVersion: 1,
        stage: "PHASE_1_M1_STAGE_10",
        result: "PASS",
        testExitCode: 0,
        failure: null,
        stage11Actions: 0,
        postgresVersion: "18.6",
        serverVersionNumber: 180006,
        bindScope: "127.0.0.1 only",
        dataChecksums: true,
        globalPackageInstallation: false,
        artifactBinding: {
          artifactId: "synthetic",
          candidate,
          inputDigest: "a".repeat(64),
          archiveSha256,
          receiptSha256: sha256(receiptBytes),
          inputsSha256: sha256(inputsBytes),
          browserAcceptance: true,
        },
        testLogSha256: sha256(log),
        cleanup: { clusterStartAttempted: true, clusterStopped: true, disposableRootsAbsent: true },
        assertionCoverage: globalThis.structuredClone(coverage),
        assertionResults: coverage.assertions.map((row) => ({ ...row, status: "passed" })),
      };
      if (attack === "binding") execution.artifactBinding.candidate = "gen38";
      if (attack === "cleanup") execution.cleanup.clusterStopped = false;
      if (attack === "mapping") execution.assertionCoverage.expectedTests = 94;
      if (attack === "missing-assertion") execution.assertionResults.pop();
      if (attack === "skipped-assertion") execution.assertionResults[0].status = "skipped";
      if (attack === "log-digest") execution.testLogSha256 = "b".repeat(64);
      await writeFile(path.join(evidence, "integration-tests.log"), log);
      if (attack !== "absent-receipt")
        await writeFile(path.join(evidence, "execution.json"), jsonBytes(execution));
      let calls = 0;
      globalThis.__postgresReuse = {
        coverage,
        isPostgresGate,
        validatePostgresCoverage,
        verifyInputs: async () => ({
          inputDigest: "a".repeat(64),
          runtimeNodeSha256: sha256(await readFile(process.execPath)),
          source: sha256(await readFile(marker)),
        }),
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
        qualify: async () => {
          calls++;
          if (calls === 2 && attack === "archive-during-final-probe")
            await writeFile(paths.archive, "changed archive");
          assert.equal(sha256(await readFile(paths.archive)), archiveSha256);
          if (calls === 2 && attack === "source-during-final-probe")
            await writeFile(marker, "changed");
        },
      };
      const execute = () => runCandidateGate({ root, candidate, gate });
      if (attack === "none") {
        assert.equal((await execute()).result, "PASS");
        assert.equal(calls, 2);
      } else await assert.rejects(execute());
      // Reuse never repairs or overwrites an occupied attempt's receipt/log.
      assert.deepEqual(await readFile(path.join(evidence, "integration-tests.log")), log);
      if (attack !== "absent-receipt")
        assert.deepEqual(
          await readFile(path.join(evidence, "execution.json")),
          jsonBytes(execution),
        );
    });
  }
}
