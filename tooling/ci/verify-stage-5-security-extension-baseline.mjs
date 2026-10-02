import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PHASE0_ACCEPTED_BASELINE_PATH = "docs/reviews/PHASE_0_ACCEPTED_BASELINE.md";
export const PHASE0_ACCEPTED_BASELINE_SHA256 =
  "bcec4e4cd4b2c4b85263c09c64a5452db306fcf68414947231b35d300f59b1fb";
export const PHASE0_ACCEPTED_BASELINE_ENTRY_COUNT = 40;
export const PHASE0_ACCEPTED_BASELINE_SOURCE_COMMIT = "32b7d2f0a8b628c5c368d22983c5d631aad520fb";
export const PHASE0_PERMISSIONS_PATH = "docs/PERMISSIONS.md";
export const PHASE0_PERMISSIONS_SHA256 =
  "ad036b8647f4482bc5e59bff09e5adbf653a4d3ed3994a20cd5b201d104ea1d9";

export const STAGE5_SECURITY_EXTENSION_BASELINE_PATH =
  "docs/reviews/phase-1-m1/STAGE_5_SECURITY_EXTENSION_BASELINE.json";
export const STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH =
  "docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md";
export const STAGE5_SECURITY_EXTENSION_BASELINE_SHA256 =
  "a8769309d7708174419e94407d2d5226c6bd72b982856a831f3e7df5dbb27ceb";
export const STAGE5_SECURITY_EXTENSION_BASELINE_ID =
  "phase-1-m1-stage-5-finance-cost-permission-v1";
export const STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS = Object.freeze(
  [
    "apps/admin-api/src/m1-routes.ts",
    "apps/admin-api/test/m1-authorization-boundary.test.ts",
    "docs/PERMISSIONS.md",
    "docs/implementation/M1_STAGE_5_SECURITY_EXTENSION.md",
    "package.json",
    "packages/backend-core/src/agency-organization/agency-bootstrap.ts",
    "packages/backend-core/src/modules/trip-operations/application/m1-staff-operations.ts",
    "packages/backend-core/src/staff-access/permission-registry.ts",
    "packages/backend-core/test/agency-organization/agency-bootstrap.test.ts",
    "tooling/ci/verify.mjs",
  ].toSorted(),
);

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const AGGREGATE_SERIALIZATION =
  "newline-terminated records: relative-path<TAB>bytes<TAB>sha256, sorted by relative path";
const REQUIRED_CI_SCRIPTS = Object.freeze({
  "stage5:security-extension:verify":
    "node tooling/ci/verify-stage-5-security-extension-baseline.mjs",
  "test:stage5-security-extension-baseline":
    "node tooling/ci/test-stage-5-security-extension-baseline.mjs",
});
const REQUIRED_CI_GATES = Object.freeze([
  ["stage5-security-extension:pre", "stage5:security-extension:verify"],
  ["test:stage5-security-extension-baseline", "test:stage5-security-extension-baseline"],
  ["stage5-security-extension:post", "stage5:security-extension:verify"],
]);

const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const sameArray = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const isSafeRelativePath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !path.isAbsolute(value) &&
  !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
const serializeRows = (rows) =>
  rows.map((row) => `${row.path}\t${row.bytes}\t${row.sha256}\n`).join("");

const readRegularFile = async (root, relativePath, label) => {
  assert(isSafeRelativePath(relativePath), `${label} path is unsafe: ${String(relativePath)}`);
  const absolutePath = path.join(root, relativePath);
  let metadata;
  try {
    metadata = await lstat(absolutePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`${label} is missing: ${relativePath}`, { cause: error });
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} is not a regular non-symlink file: ${relativePath}`);
  }
  return readFile(absolutePath);
};

const phase0RowsFrom = (manifestBytes) => {
  const rows = manifestBytes
    .toString("utf8")
    .split(/\r?\n/u)
    .flatMap((line) => {
      if (!line.startsWith("|") || !line.endsWith("|")) return [];
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/^`|`$/gu, ""));
      return cells.length === 2 && isSafeRelativePath(cells[0]) && SHA256_PATTERN.test(cells[1])
        ? [{ path: cells[0], sha256: cells[1] }]
        : [];
    });
  assert(
    rows.length === PHASE0_ACCEPTED_BASELINE_ENTRY_COUNT,
    "Phase 0 accepted baseline has an unexpected protected-entry count",
  );
  assert(
    new Set(rows.map((row) => row.path)).size === rows.length,
    "Phase 0 accepted baseline contains duplicate protected paths",
  );
  return rows;
};

export const verifyPhase0AcceptedBaselineBytes = async ({ root = process.cwd() } = {}) => {
  const manifestBytes = await readRegularFile(
    root,
    PHASE0_ACCEPTED_BASELINE_PATH,
    "Phase 0 accepted baseline manifest",
  );
  assert(
    sha256(manifestBytes) === PHASE0_ACCEPTED_BASELINE_SHA256,
    "Phase 0 accepted baseline manifest hash mismatch",
  );
  const rows = phase0RowsFrom(manifestBytes);
  const mismatches = [];
  for (const row of rows) {
    const bytes = await readRegularFile(root, row.path, "Phase 0 protected baseline file");
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== row.sha256) {
      mismatches.push({ path: row.path, expectedSha256: row.sha256, actualSha256 });
    }
  }
  assert(
    mismatches.length === 0,
    `Phase 0 protected baseline hash mismatch: ${mismatches.map((entry) => entry.path).join(", ")}`,
  );
  const permissions = await readRegularFile(
    root,
    PHASE0_PERMISSIONS_PATH,
    "Phase 0 permissions document",
  );
  assert(
    sha256(permissions) === PHASE0_PERMISSIONS_SHA256,
    "Phase 0 permissions document does not match its accepted protected hash",
  );
  return {
    result: "PASS",
    manifest: {
      path: PHASE0_ACCEPTED_BASELINE_PATH,
      sha256: sha256(manifestBytes),
      entryCount: rows.length,
    },
    permissions: { path: PHASE0_PERMISSIONS_PATH, sha256: sha256(permissions) },
  };
};

const gitText = (root, args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

export const verifyPhase0AcceptedBaselineLineage = async ({ root = process.cwd() } = {}) => {
  const bytes = await verifyPhase0AcceptedBaselineBytes({ root });
  assert(
    gitText(root, ["cat-file", "-t", PHASE0_ACCEPTED_BASELINE_SOURCE_COMMIT]) === "commit",
    "Phase 0 accepted baseline source commit is unavailable or not a commit",
  );
  const ancestry = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", PHASE0_ACCEPTED_BASELINE_SOURCE_COMMIT, "HEAD"],
    { cwd: root, stdio: "ignore" },
  );
  assert(
    ancestry.status === 0,
    "Phase 0 accepted baseline source commit is not an ancestor of the active candidate",
  );
  const sourceManifest = execFileSync(
    "git",
    ["show", `${PHASE0_ACCEPTED_BASELINE_SOURCE_COMMIT}:${PHASE0_ACCEPTED_BASELINE_PATH}`],
    { cwd: root, maxBuffer: 5 * 1024 * 1024 },
  );
  const currentManifest = await readRegularFile(
    root,
    PHASE0_ACCEPTED_BASELINE_PATH,
    "Phase 0 accepted baseline manifest",
  );
  assert(
    currentManifest.equals(sourceManifest),
    "Phase 0 accepted baseline manifest differs from its recorded source commit",
  );
  const sourcePermissions = execFileSync(
    "git",
    ["show", `${PHASE0_ACCEPTED_BASELINE_SOURCE_COMMIT}:${PHASE0_PERMISSIONS_PATH}`],
    { cwd: root, maxBuffer: 5 * 1024 * 1024 },
  );
  const currentPermissions = await readRegularFile(
    root,
    PHASE0_PERMISSIONS_PATH,
    "Phase 0 permissions document",
  );
  assert(
    currentPermissions.equals(sourcePermissions),
    "Phase 0 permissions document differs from its recorded source commit",
  );
  return {
    ...bytes,
    sourceCommit: PHASE0_ACCEPTED_BASELINE_SOURCE_COMMIT,
    sourceCommitIsAncestor: true,
    result: "PASS",
  };
};

const assertExtensionManifestShape = (baseline) => {
  assert(
    typeof baseline === "object" && baseline !== null && !Array.isArray(baseline),
    "Phase 1 extension baseline is not an object",
  );
  assert(baseline.schemaVersion === 1, "Phase 1 extension baseline schema version is invalid");
  assert(baseline.result === "PASS", "Phase 1 extension baseline result is not PASS");
  assert(
    baseline.baselineId === STAGE5_SECURITY_EXTENSION_BASELINE_ID,
    "Phase 1 extension baseline identity is invalid",
  );
  assert(baseline.stage === "PHASE_1_M1_STAGE_5", "Phase 1 extension baseline stage is invalid");
  assert(
    baseline.stage6Actions === 0,
    "Phase 1 extension baseline must not authorize Stage 6 actions",
  );

  const lineage = baseline.lineage;
  assert(
    typeof lineage === "object" && lineage !== null && !Array.isArray(lineage),
    "Phase 1 extension lineage is invalid",
  );
  assert(
    JSON.stringify(lineage.phase0AcceptedBaseline) ===
      JSON.stringify({
        path: PHASE0_ACCEPTED_BASELINE_PATH,
        sha256: PHASE0_ACCEPTED_BASELINE_SHA256,
        sourceCommit: PHASE0_ACCEPTED_BASELINE_SOURCE_COMMIT,
        entryCount: PHASE0_ACCEPTED_BASELINE_ENTRY_COUNT,
      }),
    "Phase 1 extension does not retain the exact Phase 0 baseline lineage",
  );
  assert(
    JSON.stringify(lineage.phase0Permissions) ===
      JSON.stringify({ path: PHASE0_PERMISSIONS_PATH, sha256: PHASE0_PERMISSIONS_SHA256 }),
    "Phase 1 extension does not retain the exact Phase 0 permissions lineage",
  );
  assert(
    typeof lineage.extensionDocument === "object" &&
      lineage.extensionDocument !== null &&
      lineage.extensionDocument.path === STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH &&
      SHA256_PATTERN.test(lineage.extensionDocument.sha256),
    "Phase 1 extension documentation lineage is invalid",
  );

  const extension = baseline.extension;
  assert(
    typeof extension === "object" && extension !== null && !Array.isArray(extension),
    "Phase 1 extension declaration is invalid",
  );
  assert(
    extension.permissionId === "finance.manage_costs" &&
      extension.permissionRegistryVersion === 2 &&
      sameArray(extension.allowedScopeKinds ?? [], ["AGENCY"]) &&
      sameArray(extension.allowedAccessLevels ?? [], ["ALL"]) &&
      extension.ownerRoleReceivesPermission === true &&
      extension.portalEligible === false &&
      extension.stage6Actions === 0,
    "Phase 1 finance-cost permission declaration is invalid",
  );
  assert(
    sameArray(extension.doesNotGrant ?? [], [
      "finance.manage_payments",
      "finance.view_margins",
      "finance.view_prices",
      "portal.access",
    ]),
    "Phase 1 finance-cost permission separation-of-duties declaration is invalid",
  );

  assert(Array.isArray(baseline.protectedFiles), "Phase 1 extension protected files are invalid");
  const paths = baseline.protectedFiles.map((entry) => entry?.path);
  assert(
    sameArray(paths, STAGE5_SECURITY_EXTENSION_PROTECTED_PATHS),
    "Phase 1 extension protected-file path set is invalid",
  );
  for (const entry of baseline.protectedFiles) {
    assert(
      typeof entry === "object" &&
        entry !== null &&
        isSafeRelativePath(entry.path) &&
        Number.isSafeInteger(entry.bytes) &&
        entry.bytes > 0 &&
        SHA256_PATTERN.test(entry.sha256),
      "Phase 1 extension protected-file row is invalid",
    );
  }
  assert(
    baseline.aggregateSerialization === AGGREGATE_SERIALIZATION &&
      SHA256_PATTERN.test(baseline.aggregateSha256),
    "Phase 1 extension aggregate declaration is invalid",
  );
  const extensionDocumentRow = baseline.protectedFiles.find(
    (entry) => entry.path === STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH,
  );
  assert(
    extensionDocumentRow?.sha256 === lineage.extensionDocument.sha256,
    "Phase 1 extension documentation hash is not bound to the protected-file manifest",
  );
};

const verifyExtensionSemantics = async ({ protectedBytes }) => {
  const documentation = protectedBytes
    .get(STAGE5_SECURITY_EXTENSION_DOCUMENT_PATH)
    ?.toString("utf8");
  const registry = protectedBytes
    .get("packages/backend-core/src/staff-access/permission-registry.ts")
    ?.toString("utf8")
    .replace(/\s+/gu, " ");
  const bootstrap = protectedBytes
    .get("packages/backend-core/src/agency-organization/agency-bootstrap.ts")
    ?.toString("utf8")
    .replace(/\s+/gu, " ");
  const operations = protectedBytes
    .get("packages/backend-core/src/modules/trip-operations/application/m1-staff-operations.ts")
    ?.toString("utf8")
    .replace(/\s+/gu, " ");
  const routes = protectedBytes.get("apps/admin-api/src/m1-routes.ts")?.toString("utf8");
  const packageManifest = JSON.parse(protectedBytes.get("package.json")?.toString("utf8") ?? "");
  const verifySource = protectedBytes.get("tooling/ci/verify.mjs")?.toString("utf8") ?? "";

  assert(
    documentation?.includes("`finance.manage_costs`") &&
      documentation.includes("`AGENCY`") &&
      documentation.includes("`ALL`") &&
      documentation.includes("does **not** grant price visibility") &&
      documentation.includes("`finance.view_costs`"),
    "Phase 1 extension documentation no longer states the bounded capability semantics",
  );
  assert(
    registry?.includes("export const PERMISSION_REGISTRY_VERSION = 2 as const;") &&
      /id: "finance[.]manage_costs", allowedScopeKinds: \["AGENCY"\], allowedAccessLevels: \["ALL"\]/u.test(
        registry,
      ),
    "Code-owned registry no longer defines finance.manage_costs as AGENCY/ALL in version 2",
  );
  assert(
    bootstrap?.includes("permissionIds: OWNER_ROLE_PERMISSION_IDS") &&
      registry.includes(
        "export const OWNER_ROLE_PERMISSION_IDS: readonly StaffPermissionId[] = STAGE_5_PERMISSION_REGISTRY.map",
      ),
    "Bootstrap owner template is no longer bound to the complete code-owned registry",
  );
  assert(
    operations?.includes('"finance.manage_costs"') &&
      operations.includes(
        "return dependencies.repository.createM1TripSlice(normalizedInput, authorization)",
      ) &&
      operations.includes(
        "return dependencies.repository.updateInternalSupplierNote(normalizedInput, authorization)",
      ),
    "M1 Staff operations no longer authorize restricted supplier-cost command paths",
  );
  assert(
    routes?.includes("m1Operations: M1StaffTripOperations") &&
      !routes.includes("createM1OperationalSliceRepository"),
    "Admin route boundary no longer consumes the authorization-enforcing M1 facade",
  );
  assert(
    typeof packageManifest.scripts === "object" && packageManifest.scripts !== null,
    "Package scripts are invalid",
  );
  for (const [name, command] of Object.entries(REQUIRED_CI_SCRIPTS)) {
    assert(
      packageManifest.scripts[name] === command,
      `Phase 1 extension CI script is missing or changed: ${name}`,
    );
  }
  for (const [label, script] of REQUIRED_CI_GATES) {
    assert(
      verifySource.includes(`["${label}", "${script}"]`),
      `Phase 1 extension CI gate is missing or changed: ${label}`,
    );
  }
  return {
    result: "PASS",
    ciScripts: Object.keys(REQUIRED_CI_SCRIPTS),
    ciGates: REQUIRED_CI_GATES.map(([label]) => label),
  };
};

export const verifyStage5SecurityExtensionBaseline = async ({
  root = process.cwd(),
  expectedBaselineSha256 = STAGE5_SECURITY_EXTENSION_BASELINE_SHA256,
} = {}) => {
  assert(
    SHA256_PATTERN.test(expectedBaselineSha256),
    "Phase 1 extension baseline verifier has no pinned baseline SHA-256",
  );
  const phase0 = await verifyPhase0AcceptedBaselineLineage({ root });
  const baselineBytes = await readRegularFile(
    root,
    STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
    "Phase 1 extension baseline manifest",
  );
  assert(
    sha256(baselineBytes) === expectedBaselineSha256,
    "Phase 1 extension baseline manifest does not match its pinned SHA-256",
  );
  let baseline;
  try {
    baseline = JSON.parse(baselineBytes.toString("utf8"));
  } catch {
    throw new Error("Phase 1 extension baseline manifest is not valid JSON");
  }
  assertExtensionManifestShape(baseline);

  const protectedBytes = new Map();
  const mismatches = [];
  for (const entry of baseline.protectedFiles) {
    const bytes = await readRegularFile(root, entry.path, "Phase 1 extension protected file");
    protectedBytes.set(entry.path, bytes);
    const actualSha256 = sha256(bytes);
    if (bytes.length !== entry.bytes || actualSha256 !== entry.sha256) {
      mismatches.push({
        path: entry.path,
        expectedBytes: entry.bytes,
        actualBytes: bytes.length,
        expectedSha256: entry.sha256,
        actualSha256,
      });
    }
  }
  assert(
    mismatches.length === 0,
    `Phase 1 security extension protected-file mismatch: ${mismatches.map((entry) => entry.path).join(", ")}`,
  );
  assert(
    sha256(serializeRows(baseline.protectedFiles)) === baseline.aggregateSha256,
    "Phase 1 extension protected-file aggregate hash mismatch",
  );
  const semantics = await verifyExtensionSemantics({ protectedBytes });
  return {
    schemaVersion: 1,
    result: "PASS",
    phase0,
    phase1: {
      baselinePath: STAGE5_SECURITY_EXTENSION_BASELINE_PATH,
      baselineSha256: sha256(baselineBytes),
      protectedFileCount: baseline.protectedFiles.length,
      aggregateSha256: baseline.aggregateSha256,
      extension: baseline.extension,
    },
    semantics,
  };
};

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  console.log(JSON.stringify(await verifyStage5SecurityExtensionBaseline(), null, 2));
}
