import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import * as verifier from "./verify-artifact.mjs";

const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const fixture = await mkdtemp(path.join(process.env.TMPDIR, "stage7-verifier-isolation-"));
try {
  const artifactFixture = path.join(fixture, "packaged-artifact");
  const releaseRoot = path.join(fixture, "releases");
  const physicalRelease = path.join(releaseRoot, "travelos-stage7-gen09-0015a8e1");
  const activeRelease = path.join(releaseRoot, "travelos-stage7-gen05-88646209");
  const currentSymlink = path.join(fixture, "current");
  await mkdir(artifactFixture);
  await mkdir(physicalRelease, { recursive: true });
  await mkdir(activeRelease, { recursive: true });
  await symlink(activeRelease, currentSymlink);
  const gen08Entry = path.join(fixture, "verify-artifact-gen08.mjs");
  await writeFile(
    gen08Entry,
    execFileSync(
      "git",
      ["show", "0015a8e1be16195d3333a8c9dfe53c107f83c30b:tooling/ci/stage-7/verify-artifact.mjs"],
      { cwd: root },
    ),
  );
  const gen08SymlinkFailure = spawnSync(
    process.execPath,
    [gen08Entry, `--artifact-root=${currentSymlink}`, "--generation=gen08"],
    { cwd: artifactFixture, encoding: "utf8" },
  );
  assert.equal(gen08SymlinkFailure.status, 1);
  assert.match(gen08SymlinkFailure.stderr, /Artifact root must be a directory/u);
  const wrongIdentityRelease = path.join(releaseRoot, "travelos-stage7-gen09-deadbeef");
  const sourceCommit = `0015a8e1${"0".repeat(32)}`;
  await mkdir(wrongIdentityRelease);
  await writeFile(
    path.join(wrongIdentityRelease, "release.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      artifactId: `travelos-phase-1-m1-stage-7-gen09-${sourceCommit.slice(0, 8)}`,
      source: { branch: "phase-1/stage-7", commit: sourceCommit },
    })}\n`,
  );
  await assert.rejects(
    verifier.verifyStage7Artifact({
      artifactRoot: wrongIdentityRelease,
      releaseRoot,
      authorizedCurrentSymlinkPath: currentSymlink,
      generation: "gen09",
    }),
    /Release directory identity/u,
    "A versioned release path must bind its generation and commit to release metadata",
  );

  await assert.rejects(
    verifier.verifyStage7Artifact({
      artifactRoot: currentSymlink,
      releaseRoot,
      authorizedCurrentSymlinkPath: currentSymlink,
      generation: "gen09",
    }),
    /release\.json/u,
    "A valid current symlink must resolve before packaged payload checks begin",
  );

  assert.equal(typeof verifier.resolveArtifactRoot, "function");
  assert.equal(
    await verifier.resolveArtifactRoot({
      artifactRoot: physicalRelease,
      releaseRoot,
      authorizedCurrentSymlinkPath: currentSymlink,
    }),
    physicalRelease,
  );
  assert.equal(
    await verifier.resolveArtifactRoot({
      artifactRoot: currentSymlink,
      releaseRoot,
      authorizedCurrentSymlinkPath: currentSymlink,
    }),
    activeRelease,
  );
  assert.notEqual(physicalRelease, activeRelease);
  await rm(currentSymlink);
  await symlink(physicalRelease, currentSymlink);
  assert.equal(
    await verifier.resolveArtifactRoot({
      artifactRoot: currentSymlink,
      releaseRoot,
      authorizedCurrentSymlinkPath: currentSymlink,
    }),
    physicalRelease,
    "Post-activation current must resolve exactly to the candidate release",
  );
  await assert.rejects(
    verifier.resolveArtifactRoot({
      artifactRoot: "relative-release",
      releaseRoot,
      authorizedCurrentSymlinkPath: currentSymlink,
    }),
    /absolute path/u,
  );
  await assert.rejects(
    verifier.resolveArtifactRoot({
      artifactRoot: physicalRelease,
      releaseRoot: "relative-release-root",
      authorizedCurrentSymlinkPath: currentSymlink,
    }),
    /release root must be an absolute path/iu,
  );

  const releaseRootAlias = path.join(fixture, "releases-alias");
  await symlink(releaseRoot, releaseRootAlias);
  await assert.rejects(
    verifier.resolveArtifactRoot({
      artifactRoot: physicalRelease,
      releaseRoot: releaseRootAlias,
      authorizedCurrentSymlinkPath: currentSymlink,
    }),
    /release root must be a real directory/iu,
  );

  const outsideRelease = path.join(fixture, "outside-release");
  const externalSymlink = path.join(fixture, "external-current");
  await mkdir(outsideRelease);
  await symlink(outsideRelease, externalSymlink);
  await assert.rejects(
    verifier.resolveArtifactRoot({
      artifactRoot: externalSymlink,
      releaseRoot,
      authorizedCurrentSymlinkPath: externalSymlink,
    }),
    /inside the release root/u,
  );

  const danglingSymlink = path.join(fixture, "dangling-current");
  await symlink(path.join(releaseRoot, "missing"), danglingSymlink);
  await assert.rejects(
    verifier.resolveArtifactRoot({
      artifactRoot: danglingSymlink,
      releaseRoot,
      authorizedCurrentSymlinkPath: danglingSymlink,
    }),
    /dangling/u,
  );

  const wrongEntryPoint = path.join(fixture, "other-link");
  await symlink(physicalRelease, wrongEntryPoint);
  await assert.rejects(
    verifier.resolveArtifactRoot({
      artifactRoot: wrongEntryPoint,
      releaseRoot,
      authorizedCurrentSymlinkPath: currentSymlink,
    }),
    /authorized current symlink/u,
  );

  const aliasSymlink = path.join(fixture, "release-alias");
  const chainedCurrentSymlink = path.join(fixture, "chained-current");
  await symlink(physicalRelease, aliasSymlink);
  await symlink(aliasSymlink, chainedCurrentSymlink);
  await assert.rejects(
    verifier.resolveArtifactRoot({
      artifactRoot: chainedCurrentSymlink,
      releaseRoot,
      authorizedCurrentSymlinkPath: chainedCurrentSymlink,
    }),
    /must point directly to a real release directory/u,
  );

  await assert.rejects(
    verifier.resolveArtifactRoot({
      artifactRoot: physicalRelease,
      releaseRoot: path.join(fixture, "missing-release-root"),
      authorizedCurrentSymlinkPath: currentSymlink,
    }),
    /release root/iu,
  );
  await assert.rejects(
    verifier.resolveArtifactRoot({
      artifactRoot: path.join(releaseRoot, "travelos-stage7-gen09-missing"),
      releaseRoot,
      authorizedCurrentSymlinkPath: currentSymlink,
    }),
    /Artifact root does not exist/u,
  );

  await assert.rejects(
    verifier.resolveArtifactRoot({
      artifactRoot: outsideRelease,
      releaseRoot,
      authorizedCurrentSymlinkPath: currentSymlink,
    }),
    /inside the release root/u,
  );

  const deployment = path.join(artifactFixture, "deployment");
  await mkdir(deployment);
  const previous = execFileSync(
    "git",
    ["show", "d8ae418ff825b59845b45b7fbf8b4dfa8c141d7d:tooling/ci/stage-7/verify-artifact.mjs"],
    { cwd: root },
  );
  const entry = path.join(deployment, "verify-stage7-artifact.mjs");
  await writeFile(entry, previous);
  const args = [entry, `--artifact-root=${artifactFixture}`, "--generation=gen07"];
  const gen07 = spawnSync(process.execPath, args, { cwd: artifactFixture, encoding: "utf8" });
  assert.equal(gen07.status, 1);
  assert.match(gen07.stderr, /ERR_MODULE_NOT_FOUND/u);
  assert.match(gen07.stderr, /stage-7-successor-baseline\.mjs/u);
  await copyFile(path.join(root, "tooling/ci/stage-7/verify-artifact.mjs"), entry);
  const gen09 = spawnSync(
    process.execPath,
    [entry, `--artifact-root=${artifactFixture}`, "--generation=gen09"],
    {
      cwd: artifactFixture,
      encoding: "utf8",
    },
  );
  assert.equal(gen09.status, 1, "An incomplete artifact must fail closed");
  assert.match(gen09.stderr, /release\.json/u, "A packaged verifier must reach payload validation");
  assert.doesNotMatch(gen09.stderr, /ERR_MODULE_NOT_FOUND|stage-7-successor-baseline\.mjs/u);
  const releaseVerifier = path.join(physicalRelease, "deployment/verify-stage7-artifact.mjs");
  await mkdir(path.dirname(releaseVerifier), { recursive: true });
  await copyFile(path.join(root, "tooling/ci/stage-7/verify-artifact.mjs"), releaseVerifier);
  const currentEntry = path.join(fixture, "entry-current");
  await symlink(physicalRelease, currentEntry);
  const invokedThroughCurrent = spawnSync(
    process.execPath,
    [
      path.join(currentEntry, "deployment/verify-stage7-artifact.mjs"),
      `--artifact-root=${physicalRelease}`,
      "--generation=gen09",
    ],
    { cwd: artifactFixture, encoding: "utf8" },
  );
  assert.equal(
    invokedThroughCurrent.status,
    1,
    "A symlink-launched verifier must execute and fail closed",
  );
  assert.match(invokedThroughCurrent.stderr, /release\.json/u);
  assert.match(invokedThroughCurrent.stderr, /"result":"FAIL"/u);
  const relativeArtifactRoot = spawnSync(
    process.execPath,
    [entry, "--artifact-root=relative-release", "--generation=gen09"],
    { cwd: artifactFixture, encoding: "utf8" },
  );
  assert.equal(relativeArtifactRoot.status, 1);
  assert.match(relativeArtifactRoot.stderr, /--artifact-root must be an absolute path/u);
  const deploymentPathWithoutReleaseRoot = spawnSync(
    process.execPath,
    [entry, "--artifact-root=/opt/travelos/releases-escape/candidate", "--generation=gen09"],
    { cwd: artifactFixture, encoding: "utf8" },
  );
  assert.equal(deploymentPathWithoutReleaseRoot.status, 1);
  assert.match(
    deploymentPathWithoutReleaseRoot.stderr,
    /Deployment artifacts require --release-root=/u,
  );
  const currentWithoutReleaseRoot = spawnSync(
    process.execPath,
    [entry, "--artifact-root=/opt/travelos/current", "--generation=gen09"],
    { cwd: artifactFixture, encoding: "utf8" },
  );
  assert.equal(currentWithoutReleaseRoot.status, 1);
  assert.match(currentWithoutReleaseRoot.stderr, /Deployment artifacts require --release-root=/u);
  const wrongReleaseRoot = spawnSync(
    process.execPath,
    [entry, "--artifact-root=/opt/travelos/current", "--release-root=/tmp", "--generation=gen09"],
    { cwd: artifactFixture, encoding: "utf8" },
  );
  assert.equal(wrongReleaseRoot.status, 1);
  assert.match(wrongReleaseRoot.stderr, /--release-root must be \/opt\/travelos\/releases/u);
  const relativeReleaseRoot = spawnSync(
    process.execPath,
    [
      entry,
      "--artifact-root=/opt/travelos/current",
      "--release-root=relative-release-root",
      "--generation=gen09",
    ],
    { cwd: artifactFixture, encoding: "utf8" },
  );
  assert.equal(relativeReleaseRoot.status, 1);
  assert.match(relativeReleaseRoot.stderr, /--release-root must be an absolute path/u);
  const unauthorizedSymlink = spawnSync(
    process.execPath,
    [entry, `--artifact-root=${currentSymlink}`, "--generation=gen09"],
    { cwd: artifactFixture, encoding: "utf8" },
  );
  assert.equal(unauthorizedSymlink.status, 1);
  assert.match(unauthorizedSymlink.stderr, /Only the authorized current symlink/u);
  const missingGeneration = spawnSync(
    process.execPath,
    [entry, `--artifact-root=${artifactFixture}`],
    {
      cwd: artifactFixture,
      encoding: "utf8",
    },
  );
  assert.equal(missingGeneration.status, 1);
  assert.match(missingGeneration.stderr, /Missing required --generation/u);
  process.stdout.write(`${JSON.stringify({ result: "PASS", cases: 26 })}\n`);
} finally {
  await rm(fixture, { recursive: true, force: true });
}
