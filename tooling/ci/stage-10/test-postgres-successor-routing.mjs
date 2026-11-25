import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { runGate } from "./gate-process.mjs";
import { hasCandidateAdapter } from "./gates.mjs";
import { parseArguments } from "./stage10-candidate-gate.mjs";

for (const gate of [
  "stage6-postgres",
  "stage7-postgres",
  "stage8-postgres",
  "stage9-postgres-browser",
]) {
  test(`${gate} routes only to the full current-artifact PostgreSQL adapter`, async (t) => {
    assert.equal(hasCandidateAdapter(gate), true);
    assert.deepEqual(parseArguments(["--candidate=gen37", `--gate=${gate}`]), {
      candidate: "gen37",
      gate,
    });
    const root = await mkdtemp(path.join(process.env.TMPDIR, "postgres-successor-routing-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const adapter = path.join(root, "tooling/ci/stage-10/stage10-candidate-gate.mjs");
    await mkdir(path.dirname(adapter), { recursive: true });
    await writeFile(adapter, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: {} }));
    const outputDirectory = path.join(root, "output");
    const result = await runGate({ root, outputDirectory, label: gate, candidate: "gen37" });
    assert.equal(result.status, "PASS");
    assert.deepEqual(JSON.parse(await readFile(path.join(outputDirectory, `${gate}.stdout`))), [
      "--candidate=gen37",
      `--gate=${gate}`,
    ]);
  });
}
