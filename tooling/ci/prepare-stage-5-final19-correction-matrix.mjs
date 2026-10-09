import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const inputPath = path.join(
  root,
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_18_CORRECTION_MATRIX.json",
);
const failurePath = path.join(root, ".hermes/state/stage5-final18-preflight-failure-01.json");
const outputPath = path.join(
  root,
  "docs/reviews/phase-1-m1/STAGE_5_FINAL_19_CORRECTION_MATRIX.json",
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readRegular = async (file) => {
  const metadata = await lstat(file);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `${file} must be a regular file`);
  return readFile(file);
};

export const prepareStage5Final19CorrectionMatrix = async ({ write = false } = {}) => {
  const predecessor = JSON.parse((await readRegular(inputPath)).toString("utf8"));
  const failureBytes = await readRegular(failurePath);
  const failure = JSON.parse(failureBytes.toString("utf8"));
  assert.equal(predecessor.candidate, "FINAL-18");
  assert.equal(predecessor.findings.length, 49);
  assert.equal(predecessor.summary.authorClosedCount, 0);
  assert.equal(failure.candidate, "FINAL-18");
  assert.equal(failure.ciVerifyInvoked, false);
  assert.equal(failure.ciVerifyInvocationCount, 0);
  assert.equal(failure.stage6Actions, 0);

  const matrix = globalThis.structuredClone(predecessor);
  matrix.candidate = "FINAL-19";
  matrix.result = "PENDING_EXECUTION";
  matrix.predecessor = {
    candidate: "FINAL-18",
    disposition: "REJECTED / PRE-CI FINAL VERIFICATION FAILURE / CI NOT STARTED",
    failureClass: failure.failureClass,
    baselinePath: failure.evidence.baselinePath,
    baselineSha256: failure.evidence.baselineSha256,
    evidenceIndexPath: failure.evidence.evidenceIndexPath,
    evidenceIndexSha256: failure.evidence.evidenceIndexSha256,
    failureReceiptPath: ".hermes/state/stage5-final18-preflight-failure-01.json",
    failureReceiptSha256: hash(failureBytes),
    ciVerifyInvoked: false,
    ciVerifyInvocationCount: 0,
    ciAuthorizationConsumed: false,
    ciAuthorizationTransferred: false,
    stage6Actions: 0,
  };
  matrix.stage6Actions = 0;
  matrix.statusPolicy =
    "FINAL-18 is rejected before CI because readiness final verification failed on the working-tree snapshot/guard contract. Preserve its baseline, evidence index, failure receipt, and local state. No CI authorization was consumed by FINAL-18. FINAL-19 is a new sequential candidate authorized explicitly by the Product Owner; all 49 findings remain pending independent adjudication with zero author closures. Stage 6 actions remain zero.";
  for (const finding of matrix.findings) {
    finding.final19Status = "PENDING_FINAL19_INDEPENDENT_ADJUDICATION";
    finding.authorClosed = false;
    finding.currentEvidenceReferences = [
      ...new Set(finding.currentEvidenceReferences ?? []),
    ].toSorted();
  }
  matrix.successorToolingCorrection = {
    id: "FINAL18-READINESS-GUARD-SNAPSHOT-001",
    status: "PENDING_FINAL19_IMPLEMENTATION_AND_QUALIFICATION",
    failureReceipt: {
      path: ".hermes/state/stage5-final18-preflight-failure-01.json",
      sha256: hash(failureBytes),
    },
    requiredBehavior:
      "Use one canonical worktree snapshot function in readiness and authoritative runner; exclude only the documented local readiness/pre-CI guard sidecars before and after guard creation. Verify read-back with the same exclusion set; unrelated tracked or untracked drift must still fail.",
    requiredTests: [
      "guard self-exclusion is stable",
      "unrelated untracked file changes snapshot",
      "tracked source edit changes snapshot",
      "readiness and runner use identical snapshot schema",
    ],
    ciAuthorization:
      "Use only after FINAL-19 preflight returns PASS; never invoke FINAL-18 CI runner.",
  };
  matrix.summary.carriedFindingCount = 49;
  matrix.summary.totalFindingCount = 49;
  matrix.summary.authorClosedCount = 0;
  matrix.summary.independentPendingCount = 49;
  const bytes = Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`);

  if (write) {
    try {
      const existing = await readRegular(outputPath);
      assert.deepEqual(existing, bytes, "Existing FINAL-19 matrix differs; refusing to overwrite");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeFile(outputPath, bytes, { flag: "wx" });
    }
  }
  const actual = await readRegular(outputPath);
  assert.deepEqual(
    actual,
    bytes,
    "FINAL-19 matrix does not match deterministic successor projection",
  );
  const parsed = JSON.parse(actual.toString("utf8"));
  assert.equal(parsed.findings.length, 49);
  assert.equal(parsed.summary.authorClosedCount, 0);
  assert.equal(parsed.summary.independentPendingCount, 49);
  assert(parsed.findings.every((finding) => finding.authorClosed === false));
  assert(
    parsed.findings.every(
      (finding) => finding.final19Status === "PENDING_FINAL19_INDEPENDENT_ADJUDICATION",
    ),
  );
  assert.equal(parsed.stage6Actions, 0);
  return {
    result: "PASS",
    candidate: "FINAL-19",
    predecessorCandidate: "FINAL-18",
    predecessorFailureReceiptSha256: hash(failureBytes),
    findings: parsed.findings.length,
    authorClosed: parsed.summary.authorClosedCount,
    independentPending: parsed.summary.independentPendingCount,
    matrixSha256: hash(actual),
    stage6Actions: 0,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareStage5Final19CorrectionMatrix({
    write: process.argv.includes("--write"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
