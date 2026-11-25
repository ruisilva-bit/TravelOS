import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { qualifyExtractedArtifact } from "./qualify-artifact.mjs";

const commit = "f65a64d9c3aabd446ca95a605faed92630a72963";
const files = [
  "test-artifact.mjs",
  "test-source-security-scan.mjs",
  "test-predecessor-regression.mjs",
  "test-canonical-ci.mjs",
];
const third =
  'test("verifier executes rather than silently skipping through the active release symlink", async () => {';
const first =
  'test("artifact requires the controlled acceptance entrypoint and service contract", async () => {';

// Trusted composition only: caller supplies the same independently trusted bindings
// required by qualification. No CLI or environment-controlled artifact selection.
export async function runStage8ArtifactRegression({
  root,
  payload,
  archive,
  receipt,
  expectedReceiptSha256,
  inputs,
  expectedNodeSha256,
}) {
  root = path.resolve(root);
  const qualification = {
    payload,
    archive,
    receipt,
    expectedReceiptSha256,
    inputs,
    expectedNodeSha256,
  };
  await qualifyExtractedArtifact(qualification);
  const directory = path.join(root, "tooling/ci/stage-8");
  const sources = [];
  for (const file of files) {
    const current = await readFile(path.join(directory, file));
    const accepted = execFileSync("git", ["show", `${commit}:tooling/ci/stage-8/${file}`], {
      cwd: root,
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.deepEqual(current, accepted, `Historical test differs from accepted source: ${file}`);
    sources.push(current.toString("utf8"));
  }
  const original = sources[0];
  assert.equal((original.match(/^test\(/gm) || []).length, 5);
  assert.equal(original.split(first).length, 2);
  assert.equal(original.split(third).length, 2);
  const start = original.indexOf(first),
    end = original.indexOf(third);
  assert.ok(start > 0 && end > start);
  let prefix = original.slice(0, start);
  const importAnchor = '"./artifact-integrity.mjs"';
  assert.equal(prefix.split(importAnchor).length, 2);
  prefix = prefix.replace(
    importAnchor,
    JSON.stringify(pathToFileURL(path.join(directory, "artifact-integrity.mjs")).href),
  );
  let suffix = original.slice(end);
  assert.equal(suffix.split("import.meta.url").length, 2);
  suffix = suffix.replace(
    "import.meta.url",
    JSON.stringify(pathToFileURL(path.join(directory, files[0])).href),
  );
  const temporary = await mkdtemp(path.join(os.tmpdir(), "stage10-stage8-regression-"));
  let failure;
  try {
    const data = path.join(temporary, "binding.json");
    await writeFile(data, JSON.stringify(qualification), { mode: 0o600 });
    const qualifierUrl = pathToFileURL(
      path.join(root, "tooling/ci/stage-10/qualify-artifact.mjs"),
    ).href;
    const replacement = `const binding = JSON.parse(await (await import("node:fs/promises")).readFile(${JSON.stringify(data)}, "utf8"));\nconst qualify = (await import(${JSON.stringify(qualifierUrl)})).qualifyExtractedArtifact;\ntest("stage10 artifact requires the controlled acceptance entrypoint and service contract", async () => {\n  await qualify(binding);\n  const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(binding.payload, "stage10-payload.json"), "utf8"));\n  const paths = new Set(manifest.files.filter(row => row.type === "file").map(row => row.path));\n  assert.ok(paths.has("operator/controlled-worker.mjs"));\n  assert.ok(paths.has("deployment/travelos-stage8-controlled-acceptance.service"));\n});\ntest("stage10 packaged installer import cannot trigger installation from inherited --install arguments", async () => {\n  await qualify(binding);\n  const root = await mkdtemp(path.join(os.tmpdir(), "stage10-installer-import-"));\n  try {\n    const entry = path.join(root, "importer.mjs");\n    const moduleUrl = pathToFileURL(path.join(binding.payload, "deployment/install-runtime.mjs"));\n    await writeFile(entry, \`await import(\${JSON.stringify(moduleUrl.href)});\\n\`);\n    const child = spawnSync(process.execPath, [entry, "--install"], { encoding: "utf8", timeout: 30000, maxBuffer: 1048576 });\n    assert.ifError(child.error);\n    assert.equal(child.status, 0, child.stderr);\n    assert.equal(child.stdout, "");\n    assert.equal(child.stderr, "");\n  } finally { await rm(root, { recursive: true, force: true }); }\n});\n`;
    const generated = prefix + replacement + suffix;
    assert.equal((generated.match(/^test\(/gm) || []).length, 5);
    const entry = path.join(temporary, "test-artifact.mjs");
    await writeFile(entry, generated, { mode: 0o600 });
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(
      process.execPath,
      [
        "--test",
        "--test-reporter=tap",
        entry,
        ...files.slice(1).map((file) => path.join(directory, file)),
      ],
      { cwd: root, env, encoding: "utf8", timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
    );
    const evidence = `status=${child.status} signal=${child.signal} error=${child.error?.message ?? "none"}\nstdout:\n${child.stdout ?? ""}\nstderr:\n${child.stderr ?? ""}`;
    assert.equal(child.error, undefined, evidence);
    assert.equal(child.status, 0, evidence);
    assert.match(child.stdout, /^# tests 16$/m, evidence);
    assert.match(child.stdout, /^# pass 16$/m, evidence);
    assert.match(child.stdout, /^# fail 0$/m, evidence);
    assert.match(child.stdout, /^# skipped 0$/m, evidence);
    assert.match(child.stdout, /^# cancelled 0$/m, evidence);
    assert.match(child.stdout, /^# todo 0$/m, evidence);
    return {
      result: "PASS",
      obligations: 16,
      adapted: 2,
      unchanged: 14,
      skipped: 0,
      scope: "QUALIFIED_EXTRACTED_ARTIFACT_NOT_CANONICAL_CI",
      stdout: child.stdout,
      stderr: child.stderr,
    };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
    const remaining = await access(temporary).then(
      () => true,
      (error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (remaining) {
      const message = `Temporary cleanup failed: ${temporary}`;
      if (failure) failure.message += `\n${message}`;
      else await Promise.reject(new Error(message));
    }
  }
}
