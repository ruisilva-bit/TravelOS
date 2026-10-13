import { spawnSync } from "node:child_process";

const gates = [
  ["protected-baseline:pre", "protected-baseline:check"],
  ["stage5-candidate-coherence:pre", "stage5:candidate-coherence:verify"],
  ["stage6-successor-baseline:pre", "stage6:successor-baseline:verify"],
  ["verify:pins", "verify:pins"],
  ["db:migrations:verify", "db:migrations:verify"],
  ["auth:schema:verify", "auth:schema:verify"],
  ["test:lifecycle-policy", "test:lifecycle-policy"],
  ["format:check", "format:check"],
  ["lint", "lint"],
  // The root typecheck includes an operational probe that imports database dist output.
  ["build", "build"],
  ["typecheck", "typecheck"],
  ["architecture:check", "architecture:check"],
  ["test:unit", "test:unit"],
  ["config:schema:check", "config:schema:check"],
  ["stage3:corrections:verify", "stage3:corrections:verify"],
  ["test:freeze-inputs", "test:freeze-inputs"],
  ["test:security-scanner", "test:security-scanner"],
  ["test:stage6-successor-baseline", "test:stage6:successor-baseline"],
  ["test:stage6-migrator-package", "test:stage6:migrator-package"],
  ["test:stage6-postgresql-18.6", "test:stage6:postgres"],
  ["test:rejected-technologies", "test:rejected-technologies"],
  ["verify:rejected-technologies", "verify:rejected-technologies"],
  ["security:scan:stage6", "security:scan:stage6"],
  ["evidence:stage4:verify", "evidence:stage4:verify"],
  ["security:scan:stage4", "security:scan:stage4"],
  ["test:smoke", "test:smoke"],
  ["security:scan:bundles", "security:scan:bundles"],
  ["stage6-successor-baseline:post", "stage6:successor-baseline:verify"],
  ["stage5-candidate-coherence:post", "stage5:candidate-coherence:verify"],
  ["protected-baseline:post", "protected-baseline:check"],
];

const completed = [];
for (const [label, script] of gates) {
  console.log(`\n=== TravelOS Stage 6 CI gate: ${label} ===`);
  const result = spawnSync("pnpm", ["run", script], {
    cwd: process.cwd(),
    env: { ...process.env, CI: "true", NODE_ENV: "development" },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  completed.push(label);
}
process.stdout.write(
  `${JSON.stringify({ schemaVersion: 1, stage: "PHASE_1_M1_STAGE_6", result: "PASS", completed }, null, 2)}\n`,
);
