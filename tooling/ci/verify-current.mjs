// Steady-state repository verification (ADR-015). Every gate evaluates the current tree only;
// M1 stage-frozen verifiers are historical and intentionally absent from this list.
import { spawnSync } from "node:child_process";

const gates = [
  ["verify:pins", "verify:pins"],
  ["db:migrations:verify", "db:migrations:verify"],
  ["auth:schema:verify", "auth:schema:verify"],
  ["verify:accepted-adrs", "verify:accepted-adrs"],
  ["test:lifecycle-policy", "test:lifecycle-policy"],
  ["config:schema:check", "config:schema:check"],
  ["format:check", "format:check"],
  ["lint", "lint"],
  ["test:unit", "test:unit"],
  // The root typecheck and architecture check include probes that read built output.
  ["build", "build"],
  ["typecheck", "typecheck"],
  ["architecture:check", "architecture:check"],
  ["test:rejected-technologies", "test:rejected-technologies"],
  ["verify:rejected-technologies", "verify:rejected-technologies"],
  ["test:security-scanner", "test:security-scanner"],
  ["test:security:current-source", "test:security:current-source"],
  ["security:scan:current-source", "security:scan:current-source"],
  ["security:scan:bundles", "security:scan:bundles"],
  ["test:postgres", "test:postgres"],
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
