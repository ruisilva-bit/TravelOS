// Non-consuming source/receipt validation only; synthetic PASS rows are not execution evidence.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import {
  postgresCoverage,
  summarizePostgresResults,
  validatePostgresCoverage,
  POSTGRES_SUITES,
} from "./postgres-successor-coverage.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
test("every inherited PostgreSQL label has explicit named assertion obligations", async () => {
  const coverage = await postgresCoverage(root);
  assert.equal(coverage.assertions?.length, 95, "Missing explicit assertion mapping");
  assert.equal(new Set(coverage.assertions.map((row) => `${row.suite}:${row.title}`)).size, 95);
  assert.deepEqual(
    coverage.labelMappings.map((row) => [row.gate, row.requiredAssertions]),
    [
      ["stage6-postgres", 3],
      ["stage7-postgres", 49],
      ["stage8-postgres", 83],
      ["stage9-postgres-browser", 95],
      ["stage10-postgres-browser", 95],
    ],
  );
});

test("suite names and a green total cannot replace named passed assertion results", async () => {
  const coverage = await postgresCoverage(root);
  const log = Buffer.from(POSTGRES_SUITES.join("\n"));
  assert.throws(() => validatePostgresCoverage(coverage, coverage, log), /assertion results/u);
});

const fixtureReport = (coverage) => ({
  success: true,
  numTotalTests: 95,
  numPassedTests: 95,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  numFailedTestSuites: 0,
  testResults: POSTGRES_SUITES.map((suite) => ({
    name: path.join(root, suite),
    status: "passed",
    message: "",
    assertionResults: coverage.assertions
      .filter((row) => row.suite === suite)
      .map((row) => ({
        title: row.title,
        status: "passed",
        failureMessages: [],
        meta: { syntheticSensitiveMarker: "never retain metadata" },
      })),
  })),
});

test("projects only exact named passing cases from the pinned Vitest JSON reporter shape", async () => {
  const coverage = await postgresCoverage(root);
  const report = fixtureReport(coverage);
  const results = summarizePostgresResults(report, coverage, root);
  assert.equal(results.length, 95);
  assert.ok(!JSON.stringify(results).includes("never retain metadata"));
  validatePostgresCoverage(coverage, coverage, Buffer.from(POSTGRES_SUITES.join("\n")), results);
  for (const mutate of [
    (r) => {
      r.success = false;
    },
    (r) => {
      r.numPendingTests = 1;
    },
    (r) => {
      r.numTodoTests = 1;
    },
    (r) => {
      r.testResults.pop();
    },
    (r) => {
      r.testResults[0].name = path.join(root, "unexpected.test.ts");
    },
    (r) => {
      r.testResults[0].status = "failed";
    },
    (r) => {
      r.testResults[0].assertionResults.pop();
    },
    (r) => {
      r.testResults[0].assertionResults[0].status = "skipped";
    },
    (r) => {
      r.testResults[0].assertionResults[0].status = "todo";
    },
    (r) => {
      r.testResults[0].assertionResults[0].title = "substituted title";
    },
    (r) => {
      r.testResults[0].assertionResults[0] = r.testResults[0].assertionResults[1];
    },
    (r) => {
      r.testResults[0].assertionResults[0].failureMessages = ["synthetic failure"];
    },
  ]) {
    const changed = globalThis.structuredClone(report);
    mutate(changed);
    assert.throws(() => summarizePostgresResults(changed, coverage, root));
  }
});

test("catalog enumerates every literal and all 23 parameterized Worker capability cases", async () => {
  const coverage = await postgresCoverage(root);
  const actual = [];
  for (const suite of POSTGRES_SUITES) {
    const code = await readFile(path.join(root, suite), "utf8");
    const ast = ts.createSourceFile(suite, code, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ["it", "browserIt"].includes(node.expression.text)
      ) {
        assert.ok(ts.isStringLiteral(node.arguments[0]));
        actual.push({ suite, title: node.arguments[0].text });
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    if (suite === POSTGRES_SUITES[2]) {
      // Accepted array has fifteen literal privileges plus eight generated
      // column privileges. Do not evaluate test code or execute database hooks.
      const source = code.slice(
        code.indexOf("const workerRequiredPrivileges = ["),
        code.indexOf("] as const;"),
      );
      const capabilities = [...source.matchAll(/capability: "([^"]+)"/gu)].map((match) => match[1]);
      const columns = [
        "state",
        "attempt",
        "version",
        '"runAt"',
        '"owner"',
        '"leaseUntil"',
        '"deadline"',
        '"errorCode"',
      ];
      capabilities.push(...columns.map((column) => `UPDATE job_runtime.job.${column}`));
      assert.equal(capabilities.length, 23);
      actual.push(
        ...capabilities.map((capability) => ({
          suite,
          title: `reports not-ready when ${capability} is missing`,
        })),
      );
    }
  }
  const keys = (rows) => rows.map((row) => JSON.stringify([row.suite, row.title])).sort();
  assert.deepEqual(keys(actual), keys(coverage.assertions));
});
