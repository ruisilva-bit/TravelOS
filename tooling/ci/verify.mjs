import { spawnSync } from "node:child_process";

const gates = [
  ["protected-baseline:pre", "protected-baseline:check"],
  ["verify:pins", "verify:pins"],
  ["test:lifecycle-policy", "test:lifecycle-policy"],
  ["format:check", "format:check"],
  ["lint", "lint"],
  ["typecheck", "typecheck"],
  ["architecture:check", "architecture:check"],
  ["test:unit", "test:unit"],
  ["config:schema:check", "config:schema:check"],
  ["test:freeze-inputs", "test:freeze-inputs"],
  ["test:security-scanner", "test:security-scanner"],
  ["test:rejected-technologies", "test:rejected-technologies"],
  ["verify:rejected-technologies", "verify:rejected-technologies"],
  ["security:scan:source", "security:scan:source"],
  ["build", "build"],
  ["test:smoke", "test:smoke"],
  ["security:scan:bundles", "security:scan:bundles"],
  ["protected-baseline:post", "protected-baseline:check"],
];
const completed = [];
for (const [label, script] of gates) {
  console.log(`\n=== TravelOS CI gate: ${label} ===`);
  const result = spawnSync("pnpm", ["run", script], { cwd: process.cwd(), stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  completed.push(label);
}
console.log(JSON.stringify({ schemaVersion: 1, result: "PASS", completed }, null, 2));
