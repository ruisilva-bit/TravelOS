import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkNoScriptForms } from "./stage10-runtime-browser-shell.mjs";
import { runRuntimeLanes } from "./stage10-runtime-lanes.mjs";

const script = fileURLToPath(new URL("./postgres-browser-adapter.mjs", import.meta.url));
const invoke = (args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

test("runtime subprocess failure and incomplete cumulative report fail closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stage10-lanes-test-"));
  try {
    const api = path.join(root, "api.mjs");
    const cumulative = path.join(root, "cumulative.mjs");
    await writeFile(api, 'console.log(JSON.stringify({result:"PASS", cleanup:"PASS"}));');
    await writeFile(
      cumulative,
      'console.log(JSON.stringify({result:"SUBSET_PASS", remaining:["pending"], postgresStopped:true}));',
    );
    const options = {
      node: process.execPath,
      scripts: [api, cumulative],
      env: process.env,
      timeout: 10000,
    };
    const partial = await runRuntimeLanes(options);
    assert.equal(partial.result, "PARTIAL");
    assert.deepEqual(partial.lanes.cumulative.report.remaining, ["pending"]);
    await writeFile(
      api,
      'console.error(JSON.stringify({result:"FAIL",code:"fixture"})); process.exit(2);',
    );
    const failed = await runRuntimeLanes(options);
    assert.equal(failed.result, "FAIL");
    assert.equal(failed.lanes.api.status, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser checks both no-script POST forms and rejects GET", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stage10-shell-test-"));
  try {
    for (const realm of ["admin", "portal"]) {
      await mkdir(path.join(root, `${realm}-web`));
      const auth = realm === "admin" ? "staff" : "portal";
      await writeFile(
        path.join(root, `${realm}-web/index.html`),
        `<form method="post" action="/api/auth/${auth}/sign-in/email"><input name="email" type="email"><input name="password" type="password"><button>Submit</button></form>`,
      );
    }
    assert.deepEqual(await checkNoScriptForms(root), { forms: 2, submissions: 2 });
    await writeFile(path.join(root, "admin-web/index.html"), '<form method="get"></form>');
    await assert.rejects(checkNoScriptForms(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing qualification inputs fail without a PASS", () => {
  const result = invoke([]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /STAGE10_ADAPTER_INPUT_INVALID/u);
  assert.doesNotMatch(result.stdout, /PASS/u);
});

test("unknown and duplicated arguments fail closed", () => {
  for (const args of [["--unknown=x"], ["--profile=local", "--profile=local"]]) {
    const result = invoke(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /STAGE10_ADAPTER_INPUT_INVALID/u);
  }
});

test("wrong profile, relative paths and malformed digest fail before file access", () => {
  const base = [
    "--profile=local",
    "--payload=/missing",
    "--archive=/missing",
    "--receipt=/missing",
    "--inputs=/missing",
    "--predecessor-archive=/missing",
    "--pg-root=/missing",
    `--receipt-sha256=${"a".repeat(64)}`,
    `--inputs-sha256=${"b".repeat(64)}`,
    `--node-sha256=${"c".repeat(64)}`,
  ];
  for (const replacement of [
    "--profile=canonical",
    "--payload=relative",
    "--pg-root=relative",
    "--node-sha256=bogus",
  ]) {
    const key = replacement.split("=")[0];
    const result = invoke(base.map((arg) => (arg.startsWith(`${key}=`) ? replacement : arg)));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /STAGE10_ADAPTER_INPUT_INVALID/u);
  }
});
