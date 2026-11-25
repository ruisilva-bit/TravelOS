import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runGate, _runBoundedProcess } from "./gate-process.mjs";

const base = process.env.TMPDIR;
async function fixture(t) {
  const dir = await mkdtemp(path.join(base, "gate-process-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
test("rejects pending, unknown and missing scripts before execution", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ packageManager: "pnpm@11.21.0", scripts: {} }),
  );
  for (const label of ["stage10-baseline", "unknown", "pins"])
    await assert.rejects(runGate({ root, outputDirectory: path.join(root, label), label }));
});
test("runs fixed gate script and writes independent logs and receipt", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      packageManager: "pnpm@11.21.0",
      scripts: {
        "verify:pins": `${process.execPath} -e "console.log('fixture'); console.error('error-stream')"`,
      },
    }),
  );
  const outputDirectory = path.join(root, "out");
  const result = await runGate({ root, outputDirectory, label: "pins", candidate: "gen01" });
  assert.equal(result.status, "PASS");
  assert.match(await readFile(path.join(outputDirectory, "pins.stdout"), "utf8"), /fixture/);
  assert.match(await readFile(path.join(outputDirectory, "pins.stderr"), "utf8"), /error-stream/);
  assert.deepEqual(JSON.parse(await readFile(path.join(outputDirectory, "pins.json"))), result);
  await assert.rejects(runGate({ root, outputDirectory, label: "pins" }));
});
test("bounded process records failure, timeout and output limit without PASS", async (t) => {
  const dir = await fixture(t);
  for (const [label, code, timeout, cap, reason] of [
    ["failure", "process.exit(7)", 3000, 1024, "exit"],
    ["timeout", "setInterval(()=>{},1000)", 150, 1024, "timeout"],
    ["cap", 'process.stdout.write("x".repeat(100000))', 3000, 64, "output-limit"],
    ["stderr-cap", 'process.stderr.write("x".repeat(100000))', 3000, 64, "output-limit"],
    [
      "descendant",
      `const {spawn}=require('child_process'); spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}).unref()`,
      3000,
      1024,
      "incomplete-tree",
    ],
  ]) {
    const out = path.join(dir, label);
    await mkdir(out);
    const result = await _runBoundedProcess({
      command: process.execPath,
      args: ["-e", code],
      root: dir,
      outputDirectory: out,
      label,
      environment: { PATH: "/usr/bin:/bin" },
      timeout,
      outputLimit: cap,
    });
    assert.equal(result.status, "FAIL");
    assert.equal(result.reason, reason);
    assert.ok((await readFile(path.join(out, `${label}.stdout`))).length <= cap);
  }
});
