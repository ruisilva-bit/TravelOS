// Steady-state repository verification . Every gate evaluates the current tree only; `pnpm check` is the only gate.
import { spawnSync } from "node:child_process";

const gates = [
  ["verify:pins", "verify:pins"],
  ["db:migrations:verify", "db:migrations:verify"],
  ["auth:schema:verify", "auth:schema:verify"],
  ["config:schema:check", "config:schema:check"],
  ["format:check", "format:check"],
  ["lint", "lint"],
  ["test", "test"],
  ["build", "build"],
  ["typecheck", "typecheck"],
  ["architecture:check", "architecture:check"],
  ["test:security", "test:security"],
  ["security:scan", "security:scan"],
  ["test:db", "test:db"],
  ["test:smoke", "test:smoke"],
];

const completed = [];
for (const [label, script] of gates) {
  console.log(`\n=== TravelOS CI gate: ${label} ===`);
  const result = spawnSync("pnpm", ["run", script], {
    cwd: process.cwd(),
    env: { ...process.env, CI: "true", NODE_ENV: "development" },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: 2, result: "FAIL", failedGate: label, completed }, null, 2)}\n`,
    );
    process.exit(result.status ?? 1);
  }
  completed.push(label);
}
process.stdout.write(
  `${JSON.stringify({ schemaVersion: 2, result: "PASS", completed }, null, 2)}\n`,
);
