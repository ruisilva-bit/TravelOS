import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  browserLeakageRules,
  scanSensitiveFiles,
  scanSensitiveText,
} from "./sensitive-data-scanner.mjs";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "travelos-sensitive-scanner-"));
const alphabeticSentinel = ["Synthetic", "Credential", "Material", "Alpha", "9472"].join("");
const tokenAssignmentKey = ["api", "Token"].join("");
const authorizationHeader = ["Author", "ization"].join("");
const bearerPrefix = ["Bear", "er"].join("");
const privateKeyHeader = ["-----BEGIN ", "PRIVATE ", "KEY-----"].join("");
const passwordKey = ["pass", "word"].join("");
const queryKey = ["access", "_token"].join("");
const fixtureEmail = ["traveller.fixture", "example.invalid"].join("@");
const fixtureCases = [
  {
    name: "api-token-assignment",
    content: `const ${tokenAssignmentKey} = "${alphabeticSentinel}";\n`,
    expectedRule: "secret-assignment",
  },
  {
    name: "authorization-bearer-material",
    content: `const headers = { ${authorizationHeader}: "${bearerPrefix} ${alphabeticSentinel}" };\n`,
    expectedRule: "authorization-bearer",
  },
  {
    name: "private-key-header",
    content: `${privateKeyHeader}\n${alphabeticSentinel}\n`,
    expectedRule: "private-key-header",
  },
  {
    name: "credential-bearing-url",
    content: `https://fixture.invalid/path?${queryKey}=${alphabeticSentinel}\n`,
    expectedRule: "credential-url-query",
  },
  {
    name: "suspicious-password-config",
    content: `${passwordKey}: "${alphabeticSentinel}"\n`,
    expectedRule: "secret-assignment",
  },
  {
    name: "unintended-pii-email",
    content: `${fixtureEmail}\n`,
    expectedRule: "email-address",
  },
];

try {
  const outcomes = [];
  for (const fixture of fixtureCases) {
    const file = `fixtures/${fixture.name}.txt`;
    const result = scanSensitiveText({ text: fixture.content, file });
    assert.ok(
      result.findings.some((finding) => finding.rule === fixture.expectedRule),
      `${fixture.name} was not rejected by ${fixture.expectedRule}`,
    );
    outcomes.push({
      fixture: fixture.name,
      intendedRule: fixture.expectedRule,
      result: "REJECTED_AS_EXPECTED",
    });
  }

  const browserFile = "apps/admin-web/dist/assets/synthetic.js";
  await mkdir(path.join(temporaryRoot, path.dirname(browserFile)), { recursive: true });
  await writeFile(
    path.join(temporaryRoot, browserFile),
    `const ${tokenAssignmentKey} = "${alphabeticSentinel}";\n`,
    "utf8",
  );
  const browserResult = await scanSensitiveFiles({
    root: temporaryRoot,
    files: [browserFile],
    additionalRules: browserLeakageRules,
  });
  assert.equal(browserResult.result, "FAIL");
  assert.ok(browserResult.findings.some((finding) => finding.rule === "secret-assignment"));

  const safeFixtureFile = "fixtures/explicitly-allowlisted-public-contact.txt";
  await mkdir(path.join(temporaryRoot, path.dirname(safeFixtureFile)), { recursive: true });
  await writeFile(path.join(temporaryRoot, safeFixtureFile), `${fixtureEmail}\n`, "utf8");
  const unapprovedSafeFixture = await scanSensitiveFiles({
    root: temporaryRoot,
    files: [safeFixtureFile],
  });
  assert.equal(unapprovedSafeFixture.result, "FAIL");
  const approvedSafeFixture = await scanSensitiveFiles({
    root: temporaryRoot,
    files: [safeFixtureFile],
    allowlist: [{ path: safeFixtureFile, rule: "email-address", line: 1 }],
  });
  assert.equal(approvedSafeFixture.result, "PASS");
  assert.equal(approvedSafeFixture.allowlistedFindingCount, 1);

  const safeCodeReference = scanSensitiveText({
    text: `${passwordKey}: runtimeCredentials.portal\n${passwordKey}: runtimeCredentials[role]\n`,
    file: "fixtures/safe-code-credential-reference.ts",
  });
  assert.equal(safeCodeReference.findings.length, 0);

  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        result: "PASS",
        syntheticSentinelFixtures: outcomes.length,
        outcomes,
        generatedBrowserAsset: "REJECTED_AS_EXPECTED",
        explicitSafeFixtureAllowlist: "PASS",
        codeCredentialReferences: "PASS",
        matchedValuesEmitted: false,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
