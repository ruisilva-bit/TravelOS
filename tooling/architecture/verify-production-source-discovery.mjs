import { architecturePolicy } from "./package-boundary-policy.mjs";
import {
  discoverProductionSourceFiles,
  evaluateProductionSourceDiscoveryCoverage,
} from "./production-source-discovery.mjs";
import { runSourceDiscoveryFixtureSuite } from "./source-discovery-fixture-suite.mjs";

const repository = await discoverProductionSourceFiles({
  root: process.cwd(),
  units: architecturePolicy.units,
});
const fixtures = await runSourceDiscoveryFixtureSuite();
const failClosedGapProbe = evaluateProductionSourceDiscoveryCoverage({
  uncoveredCompilerResolvedProductionFiles: ["packages/backend-core/src/uninspected.mts"],
  unsupportedCompilerResolvedProductionFiles: [],
});
const result =
  repository.result === "PASS" &&
  repository.uncoveredProductionSourceCount === 0 &&
  repository.unsupportedCompilerResolvedProductionFiles.length === 0 &&
  fixtures.result === "PASS" &&
  fixtures.unexpectedOrUnresolvedFailures === 0 &&
  failClosedGapProbe.result === "FAIL" &&
  failClosedGapProbe.gaps.length === 1 &&
  failClosedGapProbe.gaps[0]?.kind === "COMPILER_SOURCE_NOT_INSPECTED"
    ? "PASS"
    : "FAIL";

const report = {
  schemaVersion: 1,
  result,
  repository,
  fixtures,
  failClosedGapProbe: {
    expected: "FAIL",
    ...failClosedGapProbe,
  },
};

console.log(JSON.stringify(report, null, 2));
if (result !== "PASS") process.exit(1);
