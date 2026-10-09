import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureStage5WorkingTreeSnapshot } from "./stage-5-working-tree-snapshot.mjs";

const scratch = process.env.TMPDIR ?? os.tmpdir();
const root = await mkdtemp(path.join(scratch, "travelos-stage5-snapshot-"));
const git = (args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
const excluded = ".hermes/state/stage5-final19-pre-ci-freeze-guard.json";
try {
  git(["init", "--quiet"]);
  git(["config", "user.email", "stage5-snapshot-test"]);
  git(["config", "user.name", "Stage 5 Snapshot Test"]);
  await writeFile(path.join(root, "tracked.txt"), "base\n");
  git(["add", "tracked.txt"]);
  git(["commit", "--quiet", "-m", "snapshot fixture"]);
  const initial = await captureStage5WorkingTreeSnapshot({ root, excludedPaths: [excluded] });
  await mkdir(path.dirname(path.join(root, excluded)), { recursive: true });
  await writeFile(path.join(root, excluded), "guard\n");
  assert.deepEqual(
    await captureStage5WorkingTreeSnapshot({ root, excludedPaths: [excluded] }),
    initial,
    "creating the exact local guard must not change the candidate snapshot",
  );
  await writeFile(path.join(root, "unrelated.txt"), "unexpected\n");
  const withUnrelated = await captureStage5WorkingTreeSnapshot({ root, excludedPaths: [excluded] });
  assert.notDeepEqual(withUnrelated, initial, "unrelated untracked drift must change the snapshot");
  await rm(path.join(root, "unrelated.txt"));
  await writeFile(path.join(root, "tracked.txt"), "changed\n");
  const withTrackedEdit = await captureStage5WorkingTreeSnapshot({
    root,
    excludedPaths: [excluded],
  });
  assert.notDeepEqual(withTrackedEdit, initial, "tracked source drift must change the snapshot");
  assert.equal(await readFile(path.join(root, excluded), "utf8"), "guard\n");
  process.stdout.write(
    `${JSON.stringify({ result: "PASS", candidate: "FINAL-19", excludedGuardStable: true, unrelatedUntrackedDetected: true, trackedEditDetected: true, stage6Actions: 0 }, null, 2)}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
