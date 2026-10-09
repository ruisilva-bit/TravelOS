import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { STAGE5_FINAL14_EVIDENCE_DIRECTORY } from "./stage-5-candidate-contract.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "travelos-stage5-security-baseline-"));
const copyFileFromRepository = async (relativePath) => {
  const destination = path.join(fixtureRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(path.join(repositoryRoot, relativePath)));
};

try {
  const activeBaselineBytes = await readFile(
    path.join(repositoryRoot, STAGE5_SECURITY_EXTENSION_BASELINE_PATH),
  );
  const activeBaseline = JSON.parse(activeBaselineBytes.toString("utf8"));
  const activeBaselineSha256 = createHash("sha256").update(activeBaselineBytes).digest("hex");
  const baselineOptions = {
    expectedBaselineSha256: activeBaselineSha256,
    ...(activeBaseline.lineage.final21Generation?.candidate === "FINAL-21"
      ? { requireCandidate: "FINAL-21" }
      : activeBaseline.lineage.final20Generation?.candidate === "FINAL-20"
        ? { requireCandidate: "FINAL-20" }
        : activeBaseline.lineage.final19Generation?.candidate === "FINAL-19"
          ? { requireCandidate: "FINAL-19" }
          : activeBaseline.lineage.final18Generation?.candidate === "FINAL-18"
            ? { requireCandidate: "FINAL-18" }
            : activeBaseline.lineage.final17Generation?.candidate === "FINAL-17"
              ? { requireCandidate: "FINAL-17" }
              : activeBaseline.lineage.final16Generation?.candidate === "FINAL-16"
                ? { requireCandidate: "FINAL-16" }
                : activeBaseline.lineage.final15Generation?.candidate === "FINAL-15"
                  ? { requireCandidate: "FINAL-15" }
                  : activeBaseline.lineage.final14Generation?.candidate === "FINAL-14"
                    ? { requireCandidate: "FINAL-14" }
                    : {}),
  };
  const control = await verifyStage5SecurityExtensionBaseline({
    root: repositoryRoot,
    ...baselineOptions,
  });
  assert.equal(control.result, "PASS");
  assert.equal(control.phase0.manifest.entryCount, 40);
  assert.equal(control.phase1.extension.permissionId, "finance.manage_costs");
  assert.deepEqual(control.phase1.extension.allowedScopeKinds, ["AGENCY"]);
  assert.deepEqual(control.phase1.extension.allowedAccessLevels, ["ALL"]);
  assert.equal(control.phase1.extension.portalEligible, false);

  if (
    !["FINAL-17", "FINAL-18", "FINAL-20", "FINAL-21"].includes(baselineOptions.requireCandidate)
  ) {
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
      "tooling/ci/run-stage-5-final10-authoritative-ci.mjs",
      "tooling/ci/run-stage-5-final11-authoritative-ci.mjs",
      "tooling/ci/run-stage-5-final12-authoritative-ci.mjs",
      "tooling/ci/run-stage-5-final13-authoritative-ci.mjs",
      "tooling/ci/run-stage-5-final14-authoritative-ci.mjs",
      "docs/evidence/phase-1-m1/stage-5-final-12/final11-security-extension-baseline.json",
      "docs/evidence/phase-1-m1/stage-5-final-13/final12-security-extension-baseline.json",
    ]) {
      await copyFileFromRepository(relativePath);
    }

    if (baselineOptions.requireCandidate === "FINAL-14") {
      await copyFileFromRepository(
        `${STAGE5_FINAL14_EVIDENCE_DIRECTORY}/final13-security-extension-baseline.json`,
      );
    }
    const fixtureControl = await verifyStage5SecurityExtensionBaseline({
      root: fixtureRoot,
      ...baselineOptions,
    });
    assert.equal(fixtureControl.result, "PASS");

    await writeFile(
      path.join(fixtureRoot, PHASE0_PERMISSIONS_PATH),
      `${await readFile(path.join(fixtureRoot, PHASE0_PERMISSIONS_PATH), "utf8")}\nmutation\n`,
    );
    await assert.rejects(
      verifyStage5SecurityExtensionBaseline({ root: fixtureRoot, ...baselineOptions }),
      /Phase 0 protected baseline hash mismatch: docs\/PERMISSIONS[.]md/u,
    );
    await copyFileFromRepository(PHASE0_PERMISSIONS_PATH);

    await writeFile(
      path.join(fixtureRoot, STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH),
      `${await readFile(path.join(fixtureRoot, STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH), "utf8")}\nmutation\n`,
    );
    await assert.rejects(
      verifyStage5SecurityExtensionBaseline({ root: fixtureRoot, ...baselineOptions }),
      /Phase 1 security extension protected-file mismatch: docs\/implementation\/M1_STAGE_5_SECURITY_EXTENSION[.]md/u,
    );
    await copyFileFromRepository(STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH);

    await writeFile(
      path.join(fixtureRoot, STAGE5_SECURITY_EXTENSION_BASELINE_PATH),
      `${await readFile(path.join(fixtureRoot, STAGE5_SECURITY_EXTENSION_BASELINE_PATH), "utf8")}\n`,
    );
    await assert.rejects(
      verifyStage5SecurityExtensionBaseline({ root: fixtureRoot, ...baselineOptions }),
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
  }
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
