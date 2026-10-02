import { spawnSync } from "node:child_process";

const gates = [
  ["protected-baseline:pre", "protected-baseline:check"],
  ["stage5-security-extension:pre", "stage5:security-extension:verify"],
  ["verify:pins", "verify:pins"],
  ["db:migrations:verify", "db:migrations:verify"],
  ["auth:schema:verify", "auth:schema:verify"],
  ["test:lifecycle-policy", "test:lifecycle-policy"],
  ["format:check", "format:check"],
  ["lint", "lint"],
  ["typecheck", "typecheck"],
  ["architecture:check", "architecture:check"],
  ["test:unit", "test:unit"],
  ["config:schema:check", "config:schema:check"],
  ["stage3:corrections:verify", "stage3:corrections:verify"],
  ["test:freeze-inputs", "test:freeze-inputs"],
  ["test:security-scanner", "test:security-scanner"],
  ["test:stage5-security-extension-baseline", "test:stage5-security-extension-baseline"],
  ["test:stage5-source-scope", "test:stage5-source-scope"],
  ["test:rejected-technologies", "test:rejected-technologies"],
  ["verify:rejected-technologies", "verify:rejected-technologies"],
  ["security:scan:source", "security:scan:source"],
  ["evidence:stage4:verify", "evidence:stage4:verify"],
  // Stage 4 candidate verification remains an explicit historical command; Stage 5 owns the active bytes.
  ["security:scan:stage4", "security:scan:stage4"],
  ["build", "build"],
  ["test:smoke", "test:smoke"],
  ["security:scan:bundles", "security:scan:bundles"],
  ["stage5-security-extension:post", "stage5:security-extension:verify"],
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
