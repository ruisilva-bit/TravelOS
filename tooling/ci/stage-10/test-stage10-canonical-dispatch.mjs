import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runGate } from "./gate-process.mjs";

const owned = [
  "stage6-baseline",
  "stage6-baseline-tests",
  "stage6-migrator",
  "stage6-bootstrap",
  "stage6-contract-tests",
  "stage10-clean-install",
  "stage10-source-security",
  "stage9-artifact",
  "stage7-artifact",
  "stage6-contract",
  "stage9-contract",
  "stage7-contract",
  "stage7-contract-tests",
  "stage7-baseline-tests",
  "stage7-baseline",
  "stage7-predecessor",
  "stage7-source-scope",
  "stage10-baseline",
  "stage10-build-receipt",
  "stage10-exact-artifact",
  "stage10-postgres-browser",
  "stage10-source-final",
  "stage7-migrator",
  "stage8-artifact",
];

test("Stage 10 routes dispatch fixed candidate adapter, not manifest scripts", async (t) => {
  const root = await mkdtemp(path.join(process.env.TMPDIR, "stage10-dispatch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const adapter = path.join(root, "tooling/ci/stage-10/stage10-candidate-gate.mjs");
  await mkdir(path.dirname(adapter), { recursive: true });
  await writeFile(adapter, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
  await writeFile(
    path.join(path.dirname(adapter), "inherited-compatibility-adapter.mjs"),
    "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n",
  );
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: {} }));
  for (const label of owned) {
    const outputDirectory = path.join(root, `out-${label}`);
    const result = await runGate({ root, outputDirectory, label, candidate: "gen37" });
    assert.equal(result.status, "PASS", label);
    const argv = JSON.parse(await readFile(path.join(outputDirectory, `${label}.stdout`), "utf8"));
    assert.deepEqual(argv, ["--candidate=gen37", `--gate=${label}`]);
  }
});

test("inherited PostgreSQL routes reject absent candidate before historical fallback", async (t) => {
  const root = await mkdtemp(path.join(process.env.TMPDIR, "stage10-dispatch-pg-deny-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const label of [
    "stage6-postgres",
    "stage7-postgres",
    "stage8-postgres",
    "stage9-postgres-browser",
  ]) {
    await assert.rejects(
      runGate({ root, outputDirectory: path.join(root, label), label }),
      /Invalid Stage 10 candidate ID/u,
    );
    await assert.rejects(readFile(path.join(root, label, `${label}.stdout`)), { code: "ENOENT" });
  }
});

test("unknown or still-pending Stage 10 routes and invalid candidates fail before dispatch", async (t) => {
  const root = await mkdtemp(path.join(process.env.TMPDIR, "stage10-dispatch-deny-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [label, candidate] of [
    ["stage10-operational-preflight", "gen37"],
    ["stage10-signature-activation", "gen37"],
    ["stage10-retention-privacy", "gen37"],
    ["stage10-unknown", "gen37"],
    ["stage10-baseline", "gen37;echo bad"],
    ["stage10-baseline", undefined],
  ]) {
    const outputDirectory = path.join(root, `out-${label}-${String(candidate)}`);
    await assert.rejects(runGate({ root, outputDirectory, label, candidate }));
    await assert.rejects(readFile(path.join(outputDirectory, `${label}.stdout`)), {
      code: "ENOENT",
    });
  }
});
