import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import {
  STAGE7_BASE_COMMIT,
  STAGE7_DEFAULT_GENERATION,
  verifyStage7Predecessor,
} from "../stage-7-successor-baseline.mjs";

const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

const gitWorktrees = (workspace) => {
  const records = [];
  let record = { detached: false, branch: null };
  const finish = () => {
    if (record.path !== undefined) records.push(record);
    record = { detached: false, branch: null };
  };
  const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: workspace,
    encoding: "utf8",
  });
  for (const line of output.split("\n")) {
    if (line === "") {
      finish();
    } else if (line.startsWith("worktree ")) {
      record.path = line.slice("worktree ".length);
    } else if (line.startsWith("HEAD ")) {
      record.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      record.branch = line.slice("branch ".length);
    } else if (line === "detached") {
      record.detached = true;
    }
  }
  finish();
  return records;
};

export const resolveStage6PredecessorWorktree = ({ worktrees } = {}) => {
  assert.ok(Array.isArray(worktrees), "Git worktree records are required");
  const matches = worktrees.filter(
    (worktree) =>
      worktree.detached === true &&
      worktree.branch === null &&
      worktree.head === STAGE7_BASE_COMMIT,
  );
  assert.equal(
    matches.length,
    1,
    "Exactly one detached Stage 6 predecessor worktree is required for the source scan",
  );
  assert.ok(
    typeof matches[0].path === "string" && path.isAbsolute(matches[0].path),
    "Detached Stage 6 predecessor worktree path must be absolute",
  );
  return path.resolve(matches[0].path);
};

const runStage6Scanner = ({ cwd, scriptPath }) => {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
};

export const runStage7PredecessorSecurityScan = async ({
  root: workspace = root,
  generation = STAGE7_DEFAULT_GENERATION,
  verifyPredecessor = verifyStage7Predecessor,
  readWorktrees = gitWorktrees,
  runScanner = runStage6Scanner,
} = {}) => {
  const candidateRoot = path.resolve(workspace);
  const predecessor = await verifyPredecessor({ root: candidateRoot, generation });
  assert.equal(predecessor.result, "PASS", "Stage 6 predecessor verification must pass");
  const predecessorRoot = resolveStage6PredecessorWorktree({
    worktrees: await readWorktrees(candidateRoot),
  });
  const scannerPath = path.join(predecessorRoot, "tooling/ci/scan-stage-6-current-source.mjs");
  const execution = await runScanner({ cwd: predecessorRoot, scriptPath: scannerPath });
  assert.equal(
    execution.status,
    0,
    `Stage 6 predecessor sensitive-data scan failed: ${execution.stderr || execution.stdout || execution.error?.message || "no diagnostic"}`,
  );
  const scan = JSON.parse(execution.stdout);
  assert.equal(scan.result, "PASS", "Stage 6 predecessor sensitive-data scan must pass");
  assert.equal(scan.phase, "STAGE6_CURRENT_SOURCE");
  return {
    schemaVersion: 1,
    result: "PASS",
    predecessorCommit: STAGE7_BASE_COMMIT,
    scan,
    stage8Actions: 0,
  };
};

const parseGeneration = () => {
  const args = process.argv.slice(2);
  const generationArguments = args.filter((argument) => argument.startsWith("--generation="));
  const unexpectedArguments = args.filter((argument) => !argument.startsWith("--generation="));
  assert.equal(
    unexpectedArguments.length,
    0,
    `Unexpected arguments: ${unexpectedArguments.join(" ")}`,
  );
  assert.ok(generationArguments.length <= 1, "Pass at most one --generation argument");
  return generationArguments[0]?.split("=", 2)[1] ?? STAGE7_DEFAULT_GENERATION;
};

const directEntry =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (directEntry) {
  try {
    const result = await runStage7PredecessorSecurityScan({ generation: parseGeneration() });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
