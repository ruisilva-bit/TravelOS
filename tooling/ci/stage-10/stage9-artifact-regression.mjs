import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { qualifyExtractedArtifact } from "./qualify-artifact.mjs";
import { captureSource, corepackInvocation } from "./candidate.mjs";
import { verifyInheritedBaseline } from "./predecessor-baseline-adapter.mjs";
import { adaptStage9ContractSource } from "./stage9-contract-regression.mjs";
import { BRANCH, PREDECESSOR } from "./constants.mjs";

const historical = [
  "tooling/ci/stage-9/test-artifact.mjs",
  "tooling/ci/stage-9/test-build-artifact.mjs",
  "tooling/ci/stage-9/test-source-snapshot.mjs",
  "tooling/ci/stage-9/test-source-security-scan.mjs",
  "tooling/ci/stage-9/test-static-runtime-acceptance.mjs",
  "tooling/ci/stage-9/test-postgres-regression-adapter.mjs",
  "tooling/ci/stage-9/test-canonical-ci.mjs",
  "tooling/deployment/test-stage9-deployment-contract.mjs",
  "tooling/deployment/test-stage9-development-apply.mjs",
  "tooling/ci/stage-9/test-browser-host.mjs",
  "tooling/ci/stage-9/source-snapshot.mjs",
  "tooling/deployment/verify-stage9-deployment-contract.mjs",
];
const url = (root, file) => pathToFileURL(path.join(root, file)).href;
export function replaceExactly(source, anchor, replacement) {
  assert.equal(source.split(anchor).length, 2, `Historical anchor drift: ${anchor}`);
  return source.replace(anchor, replacement);
}

// This is a successor reference regression, not historical CI or a GO decision.
export async function runStage9ArtifactRegression({
  root,
  payload,
  archive,
  receipt,
  expectedReceiptSha256,
  inputs,
  expectedNodeSha256,
}) {
  root = path.resolve(root);
  await qualifyExtractedArtifact({
    payload,
    archive,
    receipt,
    expectedReceiptSha256,
    inputs,
    expectedNodeSha256,
  });
  await verifyInheritedBaseline(root);
  const invocation = corepackInvocation();
  const sources = new Map();
  for (const file of historical) {
    const current = await readFile(path.join(root, file));
    const accepted = execFileSync("git", ["show", `${PREDECESSOR.commit}:${file}`], {
      cwd: root,
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.deepEqual(current, accepted, `Historical source differs: ${file}`);
    sources.set(file, current.toString("utf8"));
  }
  const before = await captureSource(root);
  const temp = await mkdtemp("/home/hermes/.hermes/cache/scratch/stage10-stage9-artifact-");
  let failure;
  try {
    const snapshotFile = historical[10];
    let snapshot = sources.get(snapshotFile);
    snapshot = replaceExactly(
      snapshot,
      "assert.equal(branch, STAGE9_BRANCH);",
      `assert.equal(branch, ${JSON.stringify(BRANCH)});`,
    );
    for (const name of ["artifact-integrity.mjs", "constants.mjs"])
      snapshot = replaceExactly(
        snapshot,
        JSON.stringify(`./${name}`),
        JSON.stringify(url(root, `tooling/ci/stage-9/${name}`)),
      );
    snapshot = replaceExactly(snapshot, "import.meta.url", JSON.stringify(url(root, snapshotFile)));
    const snapshotCopy = path.join(temp, "source-snapshot.mjs");
    await writeFile(snapshotCopy, snapshot, { mode: 0o600 });
    let snapshotTest = sources.get(historical[2]);
    snapshotTest = replaceExactly(
      snapshotTest,
      '"./constants.mjs"',
      JSON.stringify(url(root, "tooling/ci/stage-9/constants.mjs")),
    );
    snapshotTest = replaceExactly(
      snapshotTest,
      '"./source-snapshot.mjs"',
      JSON.stringify(pathToFileURL(snapshotCopy).href),
    );
    snapshotTest = replaceExactly(
      snapshotTest,
      "import.meta.url",
      JSON.stringify(url(root, historical[2])),
    );
    snapshotTest = replaceExactly(
      snapshotTest,
      "assert.equal(snapshot.branch, STAGE9_BRANCH);",
      `assert.equal(snapshot.branch, ${JSON.stringify(BRANCH)});`,
    );
    const snapshotTestPath = path.join(temp, "test-source-snapshot.mjs");
    await writeFile(snapshotTestPath, snapshotTest, { mode: 0o600 });
    let scan = sources.get(historical[3]);
    scan = replaceExactly(
      scan,
      '"./source-security-scan.mjs"',
      JSON.stringify(url(root, "tooling/ci/stage-9/source-security-scan.mjs")),
    );
    const start =
      'test("the complete Stage 9 candidate source has no unreviewed sensitive findings", async () => {';
    assert.equal(scan.split(start).length, 2, "Scanner final test anchor drift");
    const index = scan.indexOf(start);
    assert.match(scan.slice(index), /^test\([\s\S]*\}\);\s*$/u);
    scan =
      scan.slice(0, index) +
      `test("the complete Stage 9 candidate source has no unreviewed sensitive findings", async () => {\n  const root = ${JSON.stringify(root)};\n  const { captureSource } = await import(${JSON.stringify(url(root, "tooling/ci/stage-10/candidate.mjs"))});\n  const { screenFinalSource } = await import(${JSON.stringify(url(root, "tooling/ci/stage-10/source-final-gate.mjs"))});\n  const source = await captureSource(root);\n  const report = await screenFinalSource({ root, source });\n  assert.equal(report.result, "PASS", JSON.stringify(report.unresolvedTextFindings));\n  assert.deepEqual(report.unresolvedTextFindings, []);\n  assert.deepEqual(report.unresolvedArchiveFindings, []);\n  assert.equal(report.unsupportedBinaryInputs, 0);\n  assert.ok(report.reviewedTextFindings > 0);\n});\n`;
    const scanPath = path.join(temp, "test-source-security-scan.mjs");
    await writeFile(scanPath, scan, { mode: 0o600 });
    const contractPath = path.join(temp, "contract.mjs");
    await writeFile(contractPath, adaptStage9ContractSource(sources.get(historical[11]), root), {
      mode: 0o600,
    });
    let contractTest = sources.get(historical[7]);
    contractTest = replaceExactly(
      contractTest,
      '"./verify-stage9-deployment-contract.mjs"',
      JSON.stringify(pathToFileURL(contractPath).href),
    );
    contractTest = replaceExactly(
      contractTest,
      "import.meta.url",
      JSON.stringify(url(root, historical[7])),
    );
    const contractTestPath = path.join(temp, "test-deployment-contract.mjs");
    await writeFile(contractTestPath, contractTest, { mode: 0o600 });
    const env = {
      PATH: invocation.path,
      HOME: "/home/hermes",
      TMPDIR: process.env.TMPDIR,
      COREPACK_ENABLE_NETWORK: "0",
      LANG: "C.UTF-8",
      TZ: "UTC",
    };
    const testFiles = historical
      .slice(0, 9)
      .map((file, index) =>
        index === 2
          ? snapshotTestPath
          : index === 3
            ? scanPath
            : index === 7
              ? contractTestPath
              : path.join(root, file),
      );
    const execute = (args) => {
      const child = spawnSync(invocation.command, args, {
        cwd: root,
        env,
        encoding: "utf8",
        timeout: 300000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const evidence = `status=${child.status} signal=${child.signal} error=${child.error?.message ?? "none"}\nstdout:\n${child.stdout ?? ""}\nstderr:\n${child.stderr ?? ""}`;
      assert.equal(child.error, undefined, evidence);
      assert.equal(child.status, 0, evidence);
      for (const [key, value] of [
        ["fail", 0],
        ["skipped", 0],
        ["cancelled", 0],
        ["todo", 0],
      ])
        assert.match(child.stdout, new RegExp(`^# ${key} ${value}$`, "m"), evidence);
      return child.stdout;
    };
    const main = execute(["--test", "--test-reporter=tap", ...testFiles]);
    assert.match(main, /^# tests 49$/m, main);
    assert.match(main, /^# pass 49$/m, main);
    const browser = execute([
      "--import",
      "tsx",
      "--test",
      "--test-reporter=tap",
      path.join(root, historical[9]),
    ]);
    assert.match(browser, /^# tests 2$/m, browser);
    assert.match(browser, /^# pass 2$/m, browser);
    assert.match(browser, /production browser host selects extracted candidate assets/);
    assert.match(browser, /browser harness serves the compiled SPA/);
    assert.deepEqual(await captureSource(root), before, "Source drift during regression");
    return {
      result: "PASS",
      obligations: 51,
      skipped: 0,
      scope: "SUCCESSOR_REFERENCE_NOT_CANONICAL_CI",
      stdout: main + browser,
    };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await rm(temp, { recursive: true, force: true });
    const remains = await access(temp).then(
      () => true,
      (error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (remains) {
      if (failure) failure.message += `\nTemporary cleanup failed: ${temp}`;
      else await Promise.reject(new Error(`Temporary cleanup failed: ${temp}`));
    }
  }
}
