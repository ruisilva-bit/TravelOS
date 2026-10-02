import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

import {
  PHASE0_PERMISSIONS_PATH,
  STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
  STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
  verifyStage5SecurityExtensionBaseline,
} from "./verify-stage-5-security-extension-baseline.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "travelos-stage5-security-baseline-"));
const copyFileFromRepository = async (relativePath) => {
  const destination = path.join(fixtureRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(path.join(repositoryRoot, relativePath)));
};

try {
  const control = await verifyStage5SecurityExtensionBaseline({ root: repositoryRoot });
  assert.equal(control.result, "PASS");
  assert.equal(control.phase0.manifest.entryCount, 40);
  assert.equal(control.phase1.extension.permissionId, "finance.manage_costs");
  assert.deepEqual(control.phase1.extension.allowedScopeKinds, ["AGENCY"]);
  assert.deepEqual(control.phase1.extension.allowedAccessLevels, ["ALL"]);
  assert.equal(control.phase1.extension.portalEligible, false);

  execFileSync("git", ["worktree", "add", "--detach", "--no-checkout", fixtureRoot], {
    cwd: repositoryRoot,
    stdio: "ignore",
  });
  execFileSync("git", ["reset", "--hard", "HEAD"], { cwd: fixtureRoot, stdio: "ignore" });

  const manifest = JSON.parse(
    await readFile(path.join(repositoryRoot, STAGE5_SECURITY_EXTENSION_BASELINE_PATH), "utf8"),
  );
  for (const relativePath of [
    STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
    ...manifest.protectedFiles.map((entry) => entry.path),
  ]) {
    await copyFileFromRepository(relativePath);
  }

  const fixtureControl = await verifyStage5SecurityExtensionBaseline({ root: fixtureRoot });
  assert.equal(fixtureControl.result, "PASS");

  await writeFile(
    path.join(fixtureRoot, PHASE0_PERMISSIONS_PATH),
    `${await readFile(path.join(fixtureRoot, PHASE0_PERMISSIONS_PATH), "utf8")}\nmutation\n`,
  );
  await assert.rejects(
    verifyStage5SecurityExtensionBaseline({ root: fixtureRoot }),
    /Phase 0 protected baseline hash mismatch: docs\/PERMISSIONS[.]md/u,
  );
  await copyFileFromRepository(PHASE0_PERMISSIONS_PATH);

  await writeFile(
    path.join(fixtureRoot, STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH),
    `${await readFile(path.join(fixtureRoot, STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH), "utf8")}\nmutation\n`,
  );
  await assert.rejects(
    verifyStage5SecurityExtensionBaseline({ root: fixtureRoot }),
    /Phase 1 security extension protected-file mismatch: docs\/implementation\/M1_STAGE_5_SECURITY_EXTENSION[.]md/u,
  );
  await copyFileFromRepository(STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH);

  await writeFile(
    path.join(fixtureRoot, STAGE5_SECURITY_EXTENSION_BASELINE_PATH),
    `${await readFile(path.join(fixtureRoot, STAGE5_SECURITY_EXTENSION_BASELINE_PATH), "utf8")}\n`,
  );
  await assert.rejects(
    verifyStage5SecurityExtensionBaseline({ root: fixtureRoot }),
    /does not match its pinned SHA-256/u,
  );

  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        result: "PASS",
        controlBaselineVerified: true,
        phase0PermissionMutationRejected: true,
        phase1ExtensionMutationRejected: true,
        phase1ManifestMutationRejected: true,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    execFileSync("git", ["worktree", "remove", "--force", fixtureRoot], {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
  } catch {
    // The temporary directory is removed below even if Git could not deregister it.
  }
  await rm(fixtureRoot, { recursive: true, force: true });
}
