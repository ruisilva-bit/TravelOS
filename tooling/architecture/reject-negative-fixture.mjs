import { spawnSync } from "node:child_process";

const ruleName = "browser-fixture-cannot-import-backend-core";
const result = spawnSync(
  "pnpm",
  [
    "exec",
    "depcruise",
    "--config",
    "tooling/architecture/negative-fixture.cjs",
    "--output-type",
    "json",
    "tooling/architecture/fixtures/invalid-browser-import/browser-entry.ts",
  ],
  { cwd: process.cwd(), encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
);

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.stderr.write(result.stderr);
  process.stderr.write("Negative fixture dependency-cruiser run did not return JSON\n");
  process.exit(2);
}

const violations = Array.isArray(report?.summary?.violations) ? report.summary.violations : [];
const expected = violations.filter((violation) => violation.rule?.name === ruleName);
const unexpected = violations.filter((violation) => violation.rule?.name !== ruleName);
if (expected.length !== 1 || unexpected.length !== 0) {
  process.stderr.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        result: "FIXTURE_VALIDATION_ERROR",
        dependencyCruiserExitCode: result.status,
        expectedRule: ruleName,
        expectedCount: expected.length,
        unexpectedRules: unexpected.map((violation) => violation.rule?.name ?? null),
      },
      null,
      2,
    )}\n`,
  );
  process.exit(2);
}

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      result: "REJECTED_AS_EXPECTED",
      expectedProcessExitCode: 1,
      dependencyCruiserReporterExitCode: result.status,
      violation: {
        rule: ruleName,
        from: expected[0].from,
        to: expected[0].to,
      },
      unexpectedViolationCount: 0,
    },
    null,
    2,
  ),
);
process.exit(1);
