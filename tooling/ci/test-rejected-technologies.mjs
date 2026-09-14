import assert from "node:assert/strict";

import { runDependencyUniverseFixtureSuite } from "../architecture/dependency-universe-fixture-suite.mjs";
import { runSourceDiscoveryFixtureSuite } from "../architecture/source-discovery-fixture-suite.mjs";
import {
  analyzeRejectedTechnologyManifest,
  analyzeRejectedTechnologySource,
  collectAcceptedTransitiveDisclosures,
} from "./rejected-technology-policy.mjs";

const request = (...parts) => parts.join("");
const sourceCases = [
  {
    name: "direct-next-import",
    sourceText: `import value from "${request("ne", "xt")}";\nvoid value;\n`,
    expectedKind: "import",
    expectedCategory: "next",
  },
  {
    name: "deep-next-re-export",
    sourceText: `export { default } from "${request("ne", "xt", "/link")}";\n`,
    expectedKind: "export-from",
    expectedCategory: "next",
  },
  {
    name: "direct-prisma-import-type",
    sourceText: `type RecordShape = import("${request("@prisma", "/client")}").Record;\n`,
    expectedKind: "import-type",
    expectedCategory: "prisma",
  },
  {
    name: "direct-vite-tsconfig-paths-import-equals",
    sourceText: `import resolver = require("${request("vite-", "tsconfig-", "paths")}");\nvoid resolver;\n`,
    expectedKind: "import-equals",
    expectedCategory: "vite-tsconfig-paths",
  },
  {
    name: "redis-client-require",
    sourceText: `const client = require("${request("io", "redis")}");\nvoid client;\n`,
    expectedKind: "require",
    expectedCategory: "redis-client",
  },
  {
    name: "broker-client-require-resolve",
    sourceText: `const resolved = require.resolve("${request("amqp", "lib")}");\nvoid resolved;\n`,
    expectedKind: "require-resolve",
    expectedCategory: "message-queue-client",
  },
  {
    name: "graphile-worker-dynamic-import",
    sourceText: `void import("${request("graphile", "-worker")}");\n`,
    expectedKind: "dynamic-import",
    expectedCategory: "graphile-worker",
  },
  {
    name: "turbo-build-import",
    sourceText: `import "${request("tur", "bo")}";\n`,
    expectedKind: "import",
    expectedCategory: "turborepo",
  },
  {
    name: "broker-client-create-require",
    sourceText: [
      `import { createRequire } from "node:module";`,
      `const load = createRequire(import.meta.url);`,
      `const client = load("${request("kafka", "js")}");`,
      `void client;`,
      "",
    ].join("\n"),
    expectedKind: "create-require",
    expectedCategory: "message-queue-client",
  },
];

const sourceOutcomes = sourceCases.map((fixture) => {
  const findings = analyzeRejectedTechnologySource({
    sourceText: fixture.sourceText,
    filePath: `synthetic/${fixture.name}.ts`,
  });
  assert.equal(findings.length, 1, `${fixture.name} did not produce exactly one semantic finding`);
  assert.equal(findings[0].requestKind, fixture.expectedKind);
  assert.equal(findings[0].category, fixture.expectedCategory);
  assert.equal(findings[0].authority, "normalized-semantic-dependency-universe");
  return {
    fixture: fixture.name,
    intendedRequestKind: fixture.expectedKind,
    intendedCategory: fixture.expectedCategory,
    result: "REJECTED_AS_EXPECTED",
  };
});

for (const [name, sourceText] of [
  ["safe-ordinary-source", `import path from "node:path";\nvoid path;\n`],
  [
    "accepted-better-auth-source",
    `import { betterAuth } from "${request("better", "-auth")}";\nvoid betterAuth;\n`,
  ],
]) {
  const findings = analyzeRejectedTechnologySource({
    sourceText,
    filePath: `synthetic/${name}.ts`,
  });
  assert.deepEqual(findings, [], `${name} was incorrectly rejected`);
}

const aliasFindings = analyzeRejectedTechnologyManifest({
  manifestPath: "synthetic/package.json",
  manifest: {
    name: "synthetic",
    dependencies: {
      "build-helper": request("npm:", "turbo", "@2.0.0"),
    },
  },
});
assert.equal(aliasFindings.length, 1);
assert.equal(aliasFindings[0].adoption, "npm-alias-target");
assert.equal(aliasFindings[0].category, "turborepo");

const acceptedManifestFindings = analyzeRejectedTechnologyManifest({
  manifestPath: "synthetic/package.json",
  manifest: {
    name: "synthetic",
    dependencies: { "better-auth": "1.6.27" },
  },
});
assert.deepEqual(acceptedManifestFindings, []);
const transitiveLock = [
  "packages:",
  `  '${request("@better-auth", "/prisma-adapter", "@1.6.27")}':`,
  "    peerDependencies:",
  `      '${request("@prisma", "/client")}': ^7.0.0`,
  "",
].join("\n");
const transitiveDisclosures = collectAcceptedTransitiveDisclosures(transitiveLock);
assert.ok(transitiveDisclosures.length >= 1);
assert.ok(transitiveDisclosures.every((disclosure) => disclosure.architecturalFailure === false));

const sourceDiscoveryFixtures = await runSourceDiscoveryFixtureSuite();
assert.equal(sourceDiscoveryFixtures.result, "PASS");
assert.equal(sourceDiscoveryFixtures.unexpectedOrUnresolvedFailures, 0);
assert.equal(sourceDiscoveryFixtures.rejectedTechnology.fixtureCount, 4);
assert.equal(sourceDiscoveryFixtures.rejectedTechnology.rejectedFixtures, 2);
assert.equal(sourceDiscoveryFixtures.rejectedTechnology.acceptedFixtures, 2);

const dependencyUniverseFixtures = await runDependencyUniverseFixtureSuite();
assert.equal(dependencyUniverseFixtures.result, "PASS");
assert.equal(dependencyUniverseFixtures.semanticRejectedTechnologyFixtures, 3);
assert.equal(dependencyUniverseFixtures.aliasFailClosedFixtures, 3);
assert.equal(dependencyUniverseFixtures.unexpectedCompilerParserOrResolutionFailures, 0);

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      result: "PASS",
      semanticSourceFixtures: sourceOutcomes.length,
      sourceOutcomes,
      npmAliasFixture: "REJECTED_AS_EXPECTED",
      safeOrdinarySource: "PASS",
      acceptedBetterAuthDirectDependency: "PASS",
      acceptedBetterAuthTransitiveDisclosure: "PASS_NOT_ARCHITECTURAL_ADOPTION",
      ordinaryStaticBypassClaim: "DISPROVED_AND_REGRESSION_COVERED",
      productionSourceDiscoveryFixtures: sourceDiscoveryFixtures.rejectedTechnology,
      compilerVsPolicySourceDiscovery:
        sourceDiscoveryFixtures.unexpectedOrUnresolvedFailures === 0 ? "PASS" : "FAIL",
      dependencyUniverseSemanticFixtures: {
        result: dependencyUniverseFixtures.result,
        fixtureCount: dependencyUniverseFixtures.fixtureCount,
        semanticRejectedTechnologyFixtures:
          dependencyUniverseFixtures.semanticRejectedTechnologyFixtures,
        aliasFailClosedFixtures: dependencyUniverseFixtures.aliasFailClosedFixtures,
        requiredProofs: dependencyUniverseFixtures.requiredProofs,
        outcomes: dependencyUniverseFixtures.outcomes.filter(
          ({ rejectedTechnologyFindingCount, unsupportedConstruct }) =>
            rejectedTechnologyFindingCount !== 0 || unsupportedConstruct !== null,
        ),
      },
    },
    null,
    2,
  ),
);
