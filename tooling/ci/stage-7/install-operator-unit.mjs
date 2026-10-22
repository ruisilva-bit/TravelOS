import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, URL } from "node:url";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const regularBytes = async (file) => {
  const metadata = await lstat(file);
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), "Expected regular installation input");
  return readFile(file);
};

export const prepareOperatorUnitInstall = async ({
  artifactRoot,
  generation,
  expectedReleaseSha256,
  ciReceiptPath,
  expectedCiReceiptSha256,
  releaseRoot = "/opt/travelos/releases",
}) => {
  assert.match(generation ?? "", /^gen[0-9]{2,}$/u);
  assert.match(expectedReleaseSha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.match(expectedCiReceiptSha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.ok(path.isAbsolute(artifactRoot) && path.isAbsolute(ciReceiptPath));
  assert.equal(await realpath(artifactRoot), artifactRoot, "Release must be a physical directory");
  assert.equal(
    path.dirname(artifactRoot),
    await realpath(releaseRoot),
    "Release must be directly under the canonical release root",
  );
  assert.match(
    path.basename(artifactRoot),
    new RegExp(`^travelos-stage7-${generation}-[a-f0-9]{8}$`, "u"),
  );
  const releaseBytes = await regularBytes(path.join(artifactRoot, "release.json"));
  assert.equal(
    hash(releaseBytes),
    expectedReleaseSha256,
    "Release metadata does not match qualified bytes",
  );
  const release = JSON.parse(releaseBytes.toString("utf8"));
  assert.equal(release.source?.successorBaselineGeneration, generation);
  assert.match(release.source?.commit ?? "", /^[a-f0-9]{40}$/u);
  assert.equal(
    release.artifactId,
    `travelos-phase-1-m1-stage-7-${generation}-${release.source.commit.slice(0, 8)}`,
  );
  assert.equal(
    path.basename(artifactRoot),
    `travelos-stage7-${generation}-${release.source.commit.slice(0, 8)}`,
  );
  const ciBytes = await regularBytes(ciReceiptPath);
  assert.equal(
    hash(ciBytes),
    expectedCiReceiptSha256,
    "CI receipt does not match approved receipt",
  );
  const ci = JSON.parse(ciBytes.toString("utf8"));
  assert.equal(ci.candidateGeneration, generation);
  assert.equal(ci.candidateCommit, release.source.commit);
  assert.equal(ci.result, "PASS");
  assert.equal(ci.ciConsumed, "YES");
  assert.equal(ci.invocationCount, 1);
  assert.equal(ci.expectedGateCount, 42);
  assert.equal(ci.completedGateCount, 42);
  assert.equal(ci.gates?.length, 42);
  assert.ok(ci.gates.every((gate) => gate.result === "PASS" && gate.exitCode === 0));
  assert.equal(ci.stage8Actions, 0);
  const verifier = await import(
    pathToFileURL(path.join(artifactRoot, "deployment/verify-stage7-artifact.mjs")).href
  );
  const verification = await verifier.verifyStage7Artifact({
    artifactRoot,
    generation,
    releaseRoot,
  });
  assert.equal(verification.result, "PASS");
  const unitSource = path.join(artifactRoot, "operator/travelos-stage7-runtime-acceptance.service");
  const unitBytes = await regularBytes(unitSource);
  assert.equal(hash(unitBytes), release.runtimeAcceptance?.operatorUnitSha256);
  const unit = unitBytes.toString("utf8");
  for (const line of [
    "Type=oneshot",
    "DynamicUser=yes",
    "NoNewPrivileges=yes",
    "ProtectSystem=strict",
    "IPAddressDeny=any",
    "IPAddressAllow=localhost",
    "Restart=no",
    `ExecStartPre=/opt/travelos/current/runtime/node/bin/node /opt/travelos/current/deployment/verify-stage7-artifact.mjs --artifact-root=/opt/travelos/current --release-root=/opt/travelos/releases --generation=${generation}`,
  ])
    assert.ok(unit.split("\n").includes(line), "Unsafe unit directive");
  assert.ok(!unit.includes("[Install]") && !unit.includes("[Socket]"));
  return {
    result: "PASS",
    generation,
    artifactRoot,
    unitSource,
    unitSha256: hash(unitBytes),
    releaseMetadataSha256: hash(releaseBytes),
    ciReceiptSha256: hash(ciBytes),
    stage8Actions: 0,
  };
};

const runCli = async () => {
  const options = {};
  let install = false;
  const names = {
    "artifact-root": "artifactRoot",
    generation: "generation",
    "release-sha256": "expectedReleaseSha256",
    "ci-receipt": "ciReceiptPath",
    "ci-sha256": "expectedCiReceiptSha256",
  };
  for (const argument of process.argv.slice(2)) {
    if (argument === "--install") {
      assert.equal(install, false);
      install = true;
      continue;
    }
    const match = /^--([a-z0-9-]+)=(.+)$/u.exec(argument);
    assert.ok(match && Object.hasOwn(names, match[1]), "Unknown installation argument");
    const name = names[match[1]];
    assert.equal(options[name], undefined, "Duplicate installation argument");
    options[name] = match[2];
  }
  assert.equal(Object.keys(options).length, 5);
  if (install) {
    assert.equal(process.getuid(), 0, "Installation requires the authorized local root executor");
    assert.equal(path.dirname(options.artifactRoot), "/opt/travelos/releases");
    assert.equal(await realpath(options.artifactRoot), options.artifactRoot);
    for (const file of [
      options.artifactRoot,
      path.join(options.artifactRoot, "deployment"),
      path.join(options.artifactRoot, "deployment/verify-stage7-artifact.mjs"),
    ]) {
      const metadata = await lstat(file);
      assert.equal(metadata.uid, 0, "Verifier must be sealed before privileged import");
      assert.equal(metadata.mode & 0o022, 0);
      assert.equal(metadata.isSymbolicLink(), false);
    }
    const manifest = JSON.parse(
      (await regularBytes("/etc/travelos/instances/development.json")).toString("utf8"),
    );
    assert.equal(manifest.environment, "DEVELOPMENT");
  }
  const prepared = await prepareOperatorUnitInstall(options);
  if (install) {
    for (const file of [
      prepared.artifactRoot,
      prepared.unitSource,
      path.join(prepared.artifactRoot, "runtime/node/bin/node"),
      path.join(prepared.artifactRoot, "deployment/verify-stage7-artifact.mjs"),
    ]) {
      const metadata = await lstat(file);
      assert.equal(metadata.uid, 0, "Release must be sealed/root-owned");
      assert.equal(metadata.mode & 0o022, 0, "Release must not be group/world writable");
    }
    const target = "/etc/systemd/system/travelos-stage7-runtime-acceptance.service";
    execFileSync(
      "/usr/bin/install",
      ["-o", "root", "-g", "root", "-m", "0644", prepared.unitSource, target],
      { stdio: "pipe" },
    );
    assert.equal(hash(await regularBytes(target)), prepared.unitSha256);
    execFileSync("/usr/bin/systemctl", ["daemon-reload"], { stdio: "pipe" });
    const loaded = execFileSync(
      "/usr/bin/systemctl",
      ["show", "travelos-stage7-runtime-acceptance.service", "--property=LoadState", "--value"],
      { encoding: "utf8" },
    ).trim();
    assert.equal(loaded, "loaded");
  }
  process.stdout.write(
    JSON.stringify({ ...prepared, installed: install, enabled: false, started: false }) + "\n",
  );
};

if (
  process.argv[1] &&
  (await realpath(process.argv[1])) === (await realpath(new URL(import.meta.url)))
) {
  try {
    await runCli();
  } catch {
    process.stderr.write('{"result":"FAIL","code":"STAGE7_OPERATOR_INSTALL_REJECTED"}\n');
    process.exitCode = 1;
  }
}
