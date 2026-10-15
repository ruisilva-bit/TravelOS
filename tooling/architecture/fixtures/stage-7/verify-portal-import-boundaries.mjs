import { readFile } from "node:fs/promises";
import path from "node:path";

import { analyzeSourceText, architecturePolicy } from "../../package-boundary-policy.mjs";

const root = path.resolve(import.meta.dirname, "../../../..");
const portalApiPolicy = architecturePolicy.units.find(
  ({ packageName }) => packageName === "@travelos/portal-api",
);
if (portalApiPolicy === undefined) throw new Error("Portal API architecture policy is missing");

const [fixtureDocument, manifestDocument, authAdaptersManifestDocument] = await Promise.all([
  readFile(path.join(import.meta.dirname, "portal-import-boundaries.json"), "utf8"),
  readFile(path.join(root, "apps/portal-api/package.json"), "utf8"),
  readFile(path.join(root, "packages/auth-adapters/package.json"), "utf8"),
]);
const fixtureSet = JSON.parse(fixtureDocument);
const manifest = JSON.parse(manifestDocument);
const authAdaptersManifest = JSON.parse(authAdaptersManifestDocument);
const fixtureFilePath = "apps/portal-api/src/__portal_architecture_fixture__.ts";
const cases = fixtureSet.fixtures.map((fixture) => {
  const analysis = analyzeSourceText({
    sourceText: fixture.sourceText,
    filePath: fixtureFilePath,
    unitPolicy: portalApiPolicy,
    manifest,
    root,
  });
  const observedRules = analysis.violations.map(({ rule }) => rule);
  const expectedRules = fixture.expectedRules;
  const passed =
    expectedRules.length === 0
      ? observedRules.length === 0
      : expectedRules.every((rule) => observedRules.includes(rule));
  return {
    name: fixture.name,
    expectedRules,
    observedRules,
    passed,
  };
});
const portalExportExists = Object.hasOwn(authAdaptersManifest.exports ?? {}, "./portal");
cases.push({
  name: "portal-only-auth-adapter-export-exists",
  expectedRules: ["package-export:./portal"],
  observedRules: portalExportExists ? ["package-export:./portal"] : [],
  passed: portalExportExists,
});
const report = {
  schemaVersion: 1,
  result: cases.every(({ passed }) => passed) ? "PASS" : "FAIL",
  caseCount: cases.length,
  failedCaseCount: cases.filter(({ passed }) => !passed).length,
  cases,
};
process.stdout.write(`${JSON.stringify(report)}\n`);
if (report.result !== "PASS") process.exitCode = 1;
