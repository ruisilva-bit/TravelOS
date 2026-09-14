import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { architecturePolicy, packageRoot } from "../architecture/package-boundary-policy.mjs";
import {
  collectNormalizedSourceDependencies,
  dependencyUniverseSummary,
  discoverProductionDependencyUniverse,
} from "../architecture/dependency-universe.mjs";
import { discoverRepositoryPolicySourceFiles } from "../architecture/production-source-discovery.mjs";
const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const exactTechnologyPackages = new Map([
  ["next", "next"],
  ["prisma", "prisma"],
  ["@prisma/client", "prisma"],
  ["turbo", "turborepo"],
  ["turborepo", "turborepo"],
  ["turbo-ignore", "turborepo"],
  ["vite-tsconfig-paths", "vite-tsconfig-paths"],
  ["redis", "redis-client"],
  ["ioredis", "redis-client"],
  ["handy-redis", "redis-client"],
  ["redis-om", "redis-client"],
  ["bull", "message-queue-client"],
  ["bullmq", "message-queue-client"],
  ["amqplib", "message-queue-client"],
  ["rabbitmq-client", "message-queue-client"],
  ["kafkajs", "message-queue-client"],
  ["nats", "message-queue-client"],
  ["mqtt", "message-queue-client"],
  ["rhea", "message-queue-client"],
  ["@aws-sdk/client-sqs", "message-queue-client"],
  ["@azure/service-bus", "message-queue-client"],
  ["@google-cloud/pubsub", "message-queue-client"],
  ["@nestjs/microservices", "message-queue-client"],
  ["graphile-worker", "graphile-worker"],
]);

const classifyPackage = (specifier) => {
  const root = packageRoot(specifier);
  const exactCategory = exactTechnologyPackages.get(root);
  if (exactCategory !== undefined) return { category: exactCategory, packageName: root };
  if (root.startsWith("@turbo/")) return { category: "turborepo", packageName: root };
  if (root.startsWith("@redis/")) return { category: "redis-client", packageName: root };
  return null;
};

const parseNpmAliasTarget = (dependencySpecification) => {
  if (typeof dependencySpecification !== "string" || !dependencySpecification.startsWith("npm:")) {
    return null;
  }
  const target = dependencySpecification.slice("npm:".length);
  if (target.startsWith("@")) {
    const packageSeparator = target.indexOf("/", 1);
    if (packageSeparator === -1) return null;
    const versionSeparator = target.indexOf("@", packageSeparator + 1);
    return versionSeparator === -1 ? target : target.slice(0, versionSeparator);
  }
  const versionSeparator = target.indexOf("@");
  return versionSeparator === -1 ? target : target.slice(0, versionSeparator);
};

export const analyzeRejectedTechnologyManifest = ({ manifest, manifestPath }) => {
  const findings = [];
  for (const section of dependencySections) {
    const dependencies = manifest[section];
    if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies)) {
      continue;
    }
    for (const [declaredName, specification] of Object.entries(dependencies)) {
      const direct = classifyPackage(declaredName);
      if (direct !== null) {
        findings.push({
          manifest: manifestPath,
          section,
          declaredName,
          adoptedPackage: direct.packageName,
          category: direct.category,
          adoption: "direct-dependency-name",
        });
      }
      const aliasTarget = parseNpmAliasTarget(specification);
      const alias = aliasTarget === null ? null : classifyPackage(aliasTarget);
      if (alias !== null) {
        findings.push({
          manifest: manifestPath,
          section,
          declaredName,
          adoptedPackage: alias.packageName,
          category: alias.category,
          adoption: "npm-alias-target",
        });
      }
    }
  }
  return findings;
};

export const analyzeRejectedTechnologyDependencies = (dependencies) =>
  dependencies.flatMap((request) => {
    if (request.specifier === null) return [];
    const rejected = classifyPackage(request.specifier);
    if (rejected === null) return [];
    return [
      {
        file: request.file,
        line: request.line,
        column: request.column,
        requestKind: request.kind,
        specifier: request.specifier,
        packageName: rejected.packageName,
        category: rejected.category,
        authority: "normalized-semantic-dependency-universe",
      },
    ];
  });

export const analyzeRejectedTechnologySource = ({ sourceText, filePath }) =>
  analyzeRejectedTechnologyDependencies(
    collectNormalizedSourceDependencies({ sourceText, fileName: filePath }).dependencies,
  );

export const collectRejectedTechnologyTextDefenseFindings = ({ sourceText, filePath }) => {
  const findings = [];
  const expression =
    /(?:\bfrom\s*|\bexport\b[^\r\n]*?\bfrom\s*|\bimport\s*[(]|\brequire(?:[.]resolve)?\s*[(])\s*["']([^"']+)["']/g;
  for (const match of sourceText.matchAll(expression)) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    const rejected = classifyPackage(specifier);
    if (rejected === null) continue;
    findings.push({
      file: filePath,
      line: sourceText.slice(0, match.index ?? 0).split("\n").length,
      category: rejected.category,
      rule: "rejected-technology-text-defense",
    });
  }
  return findings;
};

export const collectTravelosOwnedSourceDiscovery = async (rootOrOptions = process.cwd()) => {
  const options =
    typeof rootOrOptions === "string" ? { root: rootOrOptions } : { ...rootOrOptions };
  return discoverRepositoryPolicySourceFiles({
    root: options.root ?? process.cwd(),
    tsconfigPath: options.tsconfigPath,
    units: options.units ?? architecturePolicy.units,
    additionalDirectories: options.additionalDirectories,
    includeRootFiles: options.includeRootFiles,
  });
};

export const collectTravelosOwnedSourceFiles = async (rootOrOptions = process.cwd()) =>
  (await collectTravelosOwnedSourceDiscovery(rootOrOptions)).sourceFiles;

export const scanRejectedTechnologySourceFiles = async ({
  root,
  sourceFiles,
  dependencyUniverse,
}) => {
  const sourceFindings = [];
  const textDefenseFindings = [];
  const productionFiles = new Set(
    dependencyUniverse === undefined ? [] : Object.keys(dependencyUniverse.dependenciesByFile),
  );
  for (const filePath of sourceFiles) {
    const sourceText = await readFile(path.join(root, filePath), "utf8");
    const dependencies = productionFiles.has(filePath)
      ? dependencyUniverse.dependenciesByFile[filePath]
      : collectNormalizedSourceDependencies({ sourceText, fileName: filePath }).dependencies;
    sourceFindings.push(...analyzeRejectedTechnologyDependencies(dependencies));
    textDefenseFindings.push(
      ...collectRejectedTechnologyTextDefenseFindings({ sourceText, filePath }),
    );
  }
  return { sourceFindings, textDefenseFindings };
};

export const collectWorkspaceManifestPaths = async (root) => {
  const manifests = ["package.json"];
  for (const parent of ["apps", "packages"]) {
    const entries = await readdir(path.join(root, parent), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) manifests.push(path.posix.join(parent, entry.name, "package.json"));
    }
  }
  return manifests.sort((left, right) => left.localeCompare(right));
};

export const collectAcceptedTransitiveDisclosures = (lockContent) => {
  const disclosures = [];
  if (lockContent.includes("@better-auth/prisma-adapter@")) {
    disclosures.push({
      package: "@better-auth/prisma-adapter",
      classification: "accepted-dependency-internal-package",
      architecturalFailure: false,
      reason:
        "Better Auth's internal adapter declaration is transitive metadata; TravelOS does not directly adopt Prisma unless a source import or direct manifest specification does so.",
    });
  }
  const transitiveMarkers = [...exactTechnologyPackages.keys()].filter(
    (packageName) =>
      lockContent.includes(`${packageName}@`) || lockContent.includes(`${packageName}:`),
  );
  if (transitiveMarkers.length > 0) {
    disclosures.push({
      packages: transitiveMarkers.sort((left, right) => left.localeCompare(right)),
      classification: "transitive-lockfile-reference-not-direct-adoption",
      architecturalFailure: false,
      reason:
        "Lockfile presence alone does not establish that TravelOS-owned source or a TravelOS manifest directly adopts the technology.",
    });
  }
  return disclosures;
};

export const verifyRejectedTechnologyRepository = async (root = process.cwd()) => {
  const manifestPaths = await collectWorkspaceManifestPaths(root);
  const manifestFindings = [];
  for (const manifestPath of manifestPaths) {
    const manifest = JSON.parse(await readFile(path.join(root, manifestPath), "utf8"));
    manifestFindings.push(...analyzeRejectedTechnologyManifest({ manifest, manifestPath }));
  }

  const sourceDiscovery = await collectTravelosOwnedSourceDiscovery(root);
  const dependencyUniverse = await discoverProductionDependencyUniverse({
    root,
    sourceDiscovery: sourceDiscovery.production,
  });
  const sourceFiles = sourceDiscovery.sourceFiles;
  const { sourceFindings, textDefenseFindings } = await scanRejectedTechnologySourceFiles({
    root,
    sourceFiles,
    dependencyUniverse,
  });
  const lockContent = await readFile(path.join(root, "pnpm-lock.yaml"), "utf8");
  const acceptedTransitiveDisclosures = collectAcceptedTransitiveDisclosures(lockContent);
  const result =
    sourceDiscovery.result === "PASS" &&
    dependencyUniverse.result === "PASS" &&
    manifestFindings.length === 0 &&
    sourceFindings.length === 0 &&
    textDefenseFindings.length === 0
      ? "PASS"
      : "FAIL";
  return {
    schemaVersion: 4,
    result,
    semanticAuthority:
      "Shared compiler-cross-checked normalized dependency universe plus package-manifest dependency specifications",
    manifestsChecked: manifestPaths.length,
    sourceFilesChecked: sourceFiles.length,
    compilerResolvedProductionSourceCount:
      sourceDiscovery.production.compilerResolvedProductionSourceCount,
    policyInspectedProductionSourceCount:
      sourceDiscovery.production.policyInspectedProductionSourceCount,
    uncoveredProductionSourceCount: sourceDiscovery.production.uncoveredProductionSourceCount,
    sourceDiscovery,
    dependencyUniverse: dependencyUniverseSummary(dependencyUniverse),
    unsupportedProductionDependencyConstructs: dependencyUniverse.unsupportedDependencyConstructs,
    rejectedDirectOrResolvedPackages: manifestFindings,
    rejectedImports: sourceFindings,
    defenseInDepthTextFindings: textDefenseFindings,
    acceptedTransitiveDisclosures,
  };
};
