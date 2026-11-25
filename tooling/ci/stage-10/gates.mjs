import assert from "node:assert/strict";
import { digest } from "./io.mjs";
import { INHERITED_POSTGRES_GATES } from "./postgres-successor-coverage.mjs";

const scripts = [
  ["pins", "verify:pins"],
  ["protected-pre", "protected-baseline:check"],
  ["stage5-coherence-pre", "stage5:candidate-coherence:verify"],
  ["stage6-baseline", "stage6:successor-baseline:verify"],
  ["stage7-baseline", "stage7:successor-baseline:verify"],
  ["stage9-baseline-tests", "test:stage9:successor-baseline"],
  ["migrations", "db:migrations:verify"],
  ["auth-schema", "auth:schema:verify"],
  ["lifecycle", "test:lifecycle-policy"],
  ["format", "format:check"],
  ["lint", "lint"],
  ["typecheck", "typecheck"],
  ["dependency-universe", "verify:dependency-universe"],
  ["architecture", "architecture:check"],
  ["unit", "test:unit"],
  ["config-schema", "config:schema:check"],
  ["stage3-corrections", "stage3:corrections:verify"],
  ["freeze-inputs", "test:freeze-inputs"],
  ["security-scanner-tests", "test:security-scanner"],
  ["stage6-baseline-tests", "test:stage6:successor-baseline"],
  ["stage6-migrator", "test:stage6:migrator-package"],
  ["stage6-contract", "stage6:deployment-contract:verify"],
  ["stage6-contract-tests", "test:stage6:deployment-contract"],
  ["stage6-bootstrap", "test:stage6:migrator-bootstrap"],
  ["stage7-predecessor", "stage7:predecessor:verify"],
  ["stage7-source-scope", "stage7:source-scope:verify"],
  ["stage7-baseline-tests", "test:stage7:successor-baseline"],
  ["stage7-source-tests", "test:stage7:source-scope"],
  ["stage7-security-tests", "test:stage7:predecessor-security-scan"],
  ["stage7-contract", "stage7:deployment-contract:verify"],
  ["stage7-contract-tests", "test:stage7:deployment-contract"],
  ["stage7-artifact", "test:stage7:artifact"],
  ["stage7-migrator", "test:stage7:migrator-package"],
  ["stage7-ci-tests", "test:stage7:canonical-ci"],
  ["stage7-predecessor-regression", "test:stage8:stage7-predecessor"],
  ["stage8-systemd", "test:stage8:systemd-contract"],
  ["stage8-artifact", "test:stage8:artifact"],
  ["stage9-contract", "stage9:deployment-contract:verify"],
  ["stage9-artifact", "test:stage9:artifact"],
  ["stage6-postgres", "test:stage6:postgres"],
  ["stage7-postgres", "test:stage7:postgres"],
  ["stage8-postgres", "test:stage8:postgres"],
  ["stage9-postgres-browser", "test:stage9:postgres"],
  ["rejected-tests", "test:rejected-technologies"],
  ["rejected", "verify:rejected-technologies"],
  ["stage4-evidence", "evidence:stage4:verify"],
  ["smoke", "test:smoke"],
  ["browser-bundle-security", "security:scan:bundles"],
  ["stage5-coherence-post", "stage5:candidate-coherence:verify"],
  ["protected-post", "protected-baseline:check"],
].map(([label, script]) => ({
  label,
  script,
  status: "EXISTING_REQUIRES_STAGE10_COMPATIBILITY_QUALIFICATION",
}));
const pending = [
  "stage10-baseline",
  "stage10-clean-install",
  "stage10-build-receipt",
  "stage10-exact-artifact",
  "stage10-postgres-browser",
  "stage10-source-security",
  "stage10-operational-preflight",
  "stage10-signature-activation",
  "stage10-retention-privacy",
  "stage10-source-final",
].map((label) => ({ label, status: "PENDING_IMPLEMENTATION_AND_REVIEW" }));
// Dispatch availability is not a review or an operational authorization.
const candidateAdapters = new Set([
  ...INHERITED_POSTGRES_GATES,
  "stage6-baseline",
  "stage6-baseline-tests",
  "stage6-migrator",
  "stage6-bootstrap",
  "stage10-clean-install",
  "stage10-source-security",
  "stage9-artifact",
  "stage7-artifact",
  "stage6-contract",
  "stage6-contract-tests",
  "stage9-contract",
  "stage7-contract",
  "stage7-contract-tests",
  "stage7-baseline-tests",
  "stage7-baseline",
  "stage7-predecessor",
  "stage7-source-scope",
  "stage7-migrator",
  "stage8-artifact",
  "stage10-baseline",
  "stage10-build-receipt",
  "stage10-exact-artifact",
  "stage10-postgres-browser",
  "stage10-source-final",
]);
export const hasCandidateAdapter = (label) => candidateAdapters.has(label);
// A declaration of required coverage, NOT evidence these commands pass on Stage 10.
export const GATES = Object.freeze([...scripts, ...pending].map((gate) => Object.freeze(gate)));
const expectedDigest = digest(GATES);
export const validateGateCoverage = (gates) => {
  const labels = gates.map((gate) => gate.label);
  assert.equal(new Set(labels).size, labels.length, "Duplicate gate coverage");
  assert.equal(digest(gates), expectedDigest, "Missing or altered canonical gate coverage");
};
