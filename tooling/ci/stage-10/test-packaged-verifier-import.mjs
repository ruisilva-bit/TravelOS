import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const fixture = await mkdtemp("/home/hermes/.hermes/cache/scratch/stage10-verifier-import-");
try {
  const source = path.join(fixture, "provenance/source/tooling/ci/stage-10");
  await mkdir(source, { recursive: true });
  for (const name of ["constants.mjs", "io.mjs"])
    await cp(path.join(root, "tooling/ci/stage-10", name), path.join(source, name));
  // Negative/import-only fixture: qualification must never run in these probes.
  await writeFile(
    path.join(source, "qualify-artifact.mjs"),
    'export async function qualifyExtractedArtifact() { throw new Error("UNEXPECTED_QUALIFICATION_IN_IMPORT_FIXTURE"); }\n',
  );
  const deployment = path.join(fixture, "deployment");
  await mkdir(deployment);
  const verifier = path.join(deployment, "verify-artifact.mjs");
  await cp(path.join(root, "tooling/ci/stage-10/packaged-verifier.mjs"), verifier);
  const module = await import(pathToFileURL(verifier).href);
  await assert.rejects(module.verifyArtifact(fixture), /Structured verifier inputs/);
  await assert.rejects(module.verifyArtifact({}), /Require archive/);
  await assert.rejects(
    module.verifyArtifact({ arbitrary: "not-allowed" }),
    /Unknown verifier option/,
  );
  assert.throws(() => module.parseVerifierArguments(["--archive=a", "--archive=b"]));
  assert.throws(() => module.parseVerifierArguments(["--install"]));
  const importer = path.join(fixture, "import.mjs");
  await writeFile(importer, `await import(${JSON.stringify(pathToFileURL(verifier).href)});\n`);
  const child = spawnSync(process.execPath, [importer, "--install"], {
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "");
  assert.equal(child.stderr, "");
  const cli = spawnSync(process.execPath, [verifier, "--install"], {
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(cli.status, 1);
  assert.equal(cli.stdout, "");
  assert.equal(JSON.parse(cli.stderr).code, "STAGE10_PACKAGE_CHECKS_FAILED");
  // Service paths run the verifier through the active-release symlink; it must still execute.
  const current = path.join(path.dirname(fixture), `${path.basename(fixture)}-current`);
  await symlink(fixture, current);
  try {
    const viaSymlink = spawnSync(
      process.execPath,
      [path.join(current, "deployment/verify-artifact.mjs"), "--install"],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.equal(viaSymlink.status, 1, "Symlinked CLI must not exit 0 without verifying");
    assert.equal(viaSymlink.stdout, "");
    assert.equal(JSON.parse(viaSymlink.stderr).code, "STAGE10_PACKAGE_CHECKS_FAILED");
  } finally {
    await rm(current, { force: true });
  }
  console.log(
    "PASS: import has no execution side effects; legacy installation calls and missing independent pins remain rejected; no artifact qualification inferred",
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}
