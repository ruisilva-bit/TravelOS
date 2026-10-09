import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const CANDIDATE_PATTERN = /^FINAL-[1-9]\d*$/u;
const CANDIDATE_REFERENCE_PATTERN = /\bFINAL-?(\d+)\b/giu;
const isSafeRelativePath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !path.isAbsolute(value) &&
  !value.includes("\\") &&
  !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");

export const assertNoStaleStage5CandidateReferences = (
  candidate,
  activeSources,
  historicalReferencePaths = [],
) => {
  assert.match(candidate, CANDIDATE_PATTERN, "Current candidate must be FINAL-N");
  const references = [];
  const historicalReferences = [];
  for (const { component, path: sourcePath, text } of activeSources) {
    for (const match of text.matchAll(CANDIDATE_REFERENCE_PATTERN)) {
      const reference = `FINAL-${match[1]}`;
      if (reference !== candidate) {
        const target = historicalReferencePaths.includes(sourcePath)
          ? historicalReferences
          : references;
        target.push({ component, path: sourcePath, reference: match[0] });
      }
    }
  }
  assert.deepEqual(
    references,
    [],
    "Active Stage 5 candidate tooling contains a hard-coded predecessor candidate reference",
  );
  return { references, historicalReferences };
};

export const assertStage5CandidateManifest = (manifest) => {
  assert.equal(manifest?.schemaVersion, 1, "Stage 5 current-candidate manifest version is invalid");
  assert.match(manifest.candidate, CANDIDATE_PATTERN, "Current candidate must be FINAL-N");
  assert.match(manifest.predecessor, CANDIDATE_PATTERN, "Predecessor must be FINAL-N");
  assert.notEqual(
    manifest.candidate,
    manifest.predecessor,
    "Candidate cannot be its own predecessor",
  );
  assert.equal(
    Number(manifest.candidate.slice("FINAL-".length)),
    Number(manifest.predecessor.slice("FINAL-".length)) + 1,
    "Current candidate must immediately follow its predecessor",
  );
  assert.equal(
    manifest.generationKey,
    `${manifest.candidate.toLowerCase().replaceAll("-", "")}Generation`,
  );
  assert.equal(manifest.stage6Actions, 0);
  for (const key of [
    "manifest",
    "coherenceLibrary",
    "coherenceVerifier",
    "ciConfig",
    "correctionMatrixGenerator",
    "findingLineage",
    "runner",
    "preflight",
    "baselineGenerator",
    "baselineVerifier",
    "sharedBaselineVerifier",
    "baselineRegression",
    "sourceScopeRunner",
    "sourceScanner",
    "postgresqlRunner",
    "evidenceIndex",
    "evidenceCollector",
    "focusedRunner",
    "invocationGuardGenerator",
  ]) {
    assert.equal(typeof manifest.paths?.[key], "string", `Missing current-candidate path: ${key}`);
    assert(
      isSafeRelativePath(manifest.paths[key]),
      `Unsafe repository-relative candidate path: ${key}`,
    );
  }
  assert.equal(manifest.paths.manifest, "tooling/ci/stage-5-current-candidate.json");
  assert.equal(typeof manifest.invocationGuard, "string", "Missing current invocation guard path");
  assert(isSafeRelativePath(manifest.invocationGuard), "Unsafe invocation guard path");
  assert(isSafeRelativePath(manifest.readinessReceipt), "Unsafe readiness receipt path");
  assert(
    manifest.readinessReceipt.includes(manifest.candidate.replaceAll("-", "").toLowerCase()),
    "Readiness receipt must identify the active candidate",
  );
  for (const key of ["evidenceDirectory", "correctionMatrix"])
    assert(isSafeRelativePath(manifest[key]), `Unsafe candidate ${key} path`);
  for (const key of ["validation", "freeze", "scan"]) {
    const finalPath = manifest.finalization?.[key];
    assert(isSafeRelativePath(finalPath), `Unsafe current-candidate finalization path: ${key}`);
    assert(
      finalPath.includes(manifest.candidate.replaceAll("-", "_")) ||
        finalPath.includes(manifest.candidate.toLowerCase()),
      `Finalization path must identify the active candidate: ${key}`,
    );
  }
  assert(Array.isArray(manifest.protectedPaths), "Current candidate protected paths are missing");
  assert.equal(
    new Set(manifest.protectedPaths).size,
    manifest.protectedPaths.length,
    "Protected paths must be unique",
  );
  for (const protectedPath of manifest.protectedPaths) {
    assert.equal(typeof protectedPath, "string");
    assert(
      isSafeRelativePath(protectedPath),
      "Protected paths must be safe repository-relative paths",
    );
  }
  for (const [key, relativePath] of Object.entries(manifest.paths)) {
    assert.equal(typeof relativePath, "string", `Invalid current-candidate path: ${key}`);
    assert(isSafeRelativePath(relativePath), `Unsafe repository-relative candidate path: ${key}`);
  }
  for (const requiredPath of [
    "package.json",
    manifest.paths.manifest,
    ...Object.values(manifest.paths),
  ]) {
    assert(
      manifest.protectedPaths.includes(requiredPath),
      `Protected paths omit active input: ${requiredPath}`,
    );
  }
  assert(Array.isArray(manifest.historicalReferenceExceptions));
  const historicalReferencePaths = manifest.historicalReferenceExceptions.map(
    ({ path: file }) => file,
  );
  assert.equal(new Set(historicalReferencePaths).size, historicalReferencePaths.length);
  assert.deepEqual(historicalReferencePaths, [...historicalReferencePaths].sort());
  for (const exception of manifest.historicalReferenceExceptions) {
    assert(isSafeRelativePath(exception.path));
    assert(typeof exception.reason === "string" && exception.reason.length > 0);
    assert(manifest.protectedPaths.includes(exception.path));
  }
  assert(manifest.protectedPathDelta && typeof manifest.protectedPathDelta === "object");
  for (const key of ["added", "changed", "removed"]) {
    const paths = manifest.protectedPathDelta[key];
    assert(Array.isArray(paths), `Missing protected-path delta list: ${key}`);
    assert.equal(
      new Set(paths).size,
      paths.length,
      `Protected-path delta list must be unique: ${key}`,
    );
    assert.deepEqual(paths, [...paths].sort(), `Protected-path delta list must be sorted: ${key}`);
    assert(
      paths.every(isSafeRelativePath),
      `Protected-path delta list contains an unsafe path: ${key}`,
    );
  }
  assert.deepEqual(
    manifest.protectedPaths,
    [...manifest.protectedPaths].sort(),
    "Protected paths must use canonical lexical order",
  );
  const historicalInputs = manifest.historicalInputs;
  assert(
    historicalInputs && typeof historicalInputs === "object",
    "Immutable predecessor inputs are missing",
  );
  const predecessorSpecificPaths = new Set([
    "predecessorEvidenceDirectory",
    "predecessorFailureReceipt",
    "predecessorRejectionRecord",
    "predecessorCorrectionMatrix",
    "predecessorBaselinePath",
    "predecessorCiReceipt",
    "predecessorEvidenceIndex",
    "predecessorValidation",
    "predecessorFreeze",
    "predecessorFinalScan",
    "predecessorArchiveManifest",
  ]);
  for (const key of predecessorSpecificPaths) {
    assert(isSafeRelativePath(historicalInputs[key]), `Unsafe immutable predecessor input: ${key}`);
    const references = [...historicalInputs[key].matchAll(/FINAL[-_ ]?(\d+)(?!\d)/giu)].map(
      (match) => `FINAL-${match[1]}`,
    );
    if (predecessorSpecificPaths.has(key))
      assert(
        references.length > 0,
        `Immutable predecessor input must identify its predecessor: ${key}`,
      );
    assert(
      references.every((reference) => reference === manifest.predecessor),
      `Historical input ${key} references a non-predecessor candidate`,
    );
  }
  for (const key of [
    "predecessorFailureReceiptSha256",
    "predecessorRejectionRecordSha256",
    "predecessorCorrectionMatrixSha256",
    "predecessorBaselineGenerationSha256",
    "predecessorBaselineSha256",
    "predecessorCiReceiptSha256",
    "predecessorEvidenceIndexSha256",
    "predecessorValidationSha256",
    "predecessorFreezeSha256",
    "predecessorFinalScanSha256",
    "predecessorArchiveManifestSha256",
  ])
    assert.match(historicalInputs[key], /^[a-f0-9]{64}$/u, `Invalid historical hash: ${key}`);
  assert(
    Array.isArray(manifest.historicalScriptExceptions),
    "Historical package-script exceptions are missing",
  );
  const historicalScriptNames = manifest.historicalScriptExceptions.map(({ script }) => script);
  assert.equal(new Set(historicalScriptNames).size, historicalScriptNames.length);
  assert.deepEqual(historicalScriptNames, [...historicalScriptNames].toSorted());
  for (const exception of manifest.historicalScriptExceptions) {
    assert(typeof exception.script === "string" && exception.script.length > 0);
    assert(typeof exception.reason === "string" && exception.reason.length > 0);
  }
  return manifest;
};

export const getStage5CurrentCandidateScripts = (manifest) => {
  assertStage5CandidateManifest(manifest);
  return {
    "stage5:candidate-coherence:verify": `node ${manifest.paths.coherenceVerifier}`,
    "stage5:security-extension:verify": `node ${manifest.paths.baselineVerifier}`,
    "test:stage5:focused": `node ${manifest.paths.focusedRunner}`,
    "test:stage5-security-extension-baseline": `node ${manifest.paths.baselineRegression}`,
    "test:stage5-source-scope": `node ${manifest.paths.scanRegression} && node ${manifest.paths.sourceScopeRunner}`,
    "evidence:stage5:matrix": `node ${manifest.paths.correctionMatrixGenerator} --write && node ${manifest.paths.findingLineage} --write`,
    "evidence:stage5:postgresql": `node ${manifest.paths.postgresqlRunner}`,
    "evidence:stage5:baseline": `node ${manifest.paths.baselineGenerator} --write`,
    "evidence:stage5:prepare": `node ${manifest.paths.evidenceCollector} --write`,
    "evidence:stage5:preflight": `node ${manifest.paths.preflight} --write`,
    "evidence:stage5:index": `node ${manifest.paths.evidenceIndex} --write --phase=PRE_CI`,
    "evidence:stage5:guard": `node ${manifest.paths.invocationGuardGenerator}`,
    "evidence:stage5:ci": `node ${manifest.paths.runner}`,
    "evidence:stage5:freeze": `node ${manifest.paths.freezeCollector} --write`,
    "evidence:stage5:final-scan": `node ${manifest.paths.sourceScanner} --phase=FINAL_CANDIDATE`,
    "evidence:stage5:final-provenance": `node ${manifest.paths.scanProvenance}`,
    "security:scan:source": `node ${manifest.paths.sourceScanner}`,
  };
};

export const assertStage5CandidateCoherenceInputs = ({
  manifest,
  activeSources,
  packageManifest,
}) => {
  assertStage5CandidateManifest(manifest);
  const { references, historicalReferences } = assertNoStaleStage5CandidateReferences(
    manifest.candidate,
    activeSources,
    manifest.historicalReferenceExceptions.map(({ path: sourcePath }) => sourcePath),
  );
  const historicalPathExceptions = new Set(
    manifest.historicalReferenceExceptions.map(({ path: sourcePath }) => sourcePath),
  );
  const hardcodedActiveReferences = activeSources
    .filter(({ path: sourcePath }) => !historicalPathExceptions.has(sourcePath))
    .flatMap(({ component, path: sourcePath, text }) =>
      [...text.matchAll(CANDIDATE_REFERENCE_PATTERN)].map((match) => ({
        component,
        path: sourcePath,
        reference: match[0],
      })),
    );
  assert.deepEqual(
    hardcodedActiveReferences,
    [],
    "Active Stage 5 tooling must derive every candidate identifier from the current-candidate manifest",
  );
  const ciConfig = activeSources.find(
    ({ path: sourcePath }) => sourcePath === manifest.paths.ciConfig,
  )?.text;
  const candidateGate = ciConfig?.indexOf(
    '["stage5-candidate-coherence:pre", "stage5:candidate-coherence:verify"]',
  );
  const securityGate = ciConfig?.indexOf(
    '["stage5-security-extension:pre", "stage5:security-extension:verify"]',
  );
  assert(
    Number.isInteger(candidateGate) &&
      Number.isInteger(securityGate) &&
      candidateGate >= 0 &&
      securityGate > candidateGate,
    "ci:verify must execute candidate coherence before the security-extension pre-gate",
  );
  const historicalScripts = new Set(
    manifest.historicalScriptExceptions.map(({ script }) => script),
  );
  const scriptNames = Object.keys(packageManifest.scripts ?? {});
  for (const historicalScript of historicalScripts) {
    assert(
      scriptNames.includes(historicalScript),
      `Declared historical package script is missing: ${historicalScript}`,
    );
  }
  const activeScriptSources = Object.entries(packageManifest.scripts ?? {})
    .filter(([script]) => !historicalScripts.has(script))
    .map(([script, text]) => ({
      component: `package script ${script}`,
      path: `package.json#scripts.${script}`,
      text,
    }));
  const { references: stalePackageScriptReferences } = assertNoStaleStage5CandidateReferences(
    manifest.candidate,
    activeScriptSources,
  );
  const hardcodedActiveScriptReferences = activeScriptSources.flatMap(
    ({ component, path: sourcePath, text }) =>
      [...text.matchAll(CANDIDATE_REFERENCE_PATTERN)].map((match) => ({
        component,
        path: sourcePath,
        reference: match[0],
      })),
  );
  assert.deepEqual(
    hardcodedActiveScriptReferences,
    [],
    "Active package scripts must derive every candidate identifier from the current-candidate manifest",
  );
  for (const [script, command] of Object.entries(getStage5CurrentCandidateScripts(manifest))) {
    assert.equal(
      packageManifest.scripts?.[script],
      command,
      `Active Stage 5 script ${script} does not resolve through the current-candidate manifest`,
    );
  }
  return {
    candidate: manifest.candidate,
    predecessor: manifest.predecessor,
    activeComponents: activeSources.map(({ component, path: file }) => ({ component, file })),
    staleReferences: references,
    historicalReferences,
    stalePackageScriptReferences,
    historicalScriptExceptions: [...historicalScripts].toSorted(),
    stage6Actions: manifest.stage6Actions,
  };
};

export const verifyStage5CandidateCoherence = async ({
  root = process.cwd(),
  manifestPath,
} = {}) => {
  const resolvedRoot = path.resolve(root);
  const selectedManifestPath = manifestPath ?? "tooling/ci/stage-5-current-candidate.json";
  const manifest = assertStage5CandidateManifest(
    JSON.parse(await readFile(path.join(resolvedRoot, selectedManifestPath), "utf8")),
  );
  const activePaths = Object.entries(manifest.paths).filter(([key]) => key !== "manifest");
  const activeSources = [];
  for (const [component, relativePath] of activePaths) {
    const text = await readFile(path.join(resolvedRoot, relativePath), "utf8");
    activeSources.push({ component, path: relativePath, text });
  }
  for (const exception of manifest.historicalReferenceExceptions) {
    const text = await readFile(path.join(resolvedRoot, exception.path), "utf8");
    if (!activeSources.some(({ path: sourcePath }) => sourcePath === exception.path)) {
      activeSources.push({ component: "historicalReferenceException", path: exception.path, text });
    }
  }
  const packageManifest = JSON.parse(
    await readFile(path.join(resolvedRoot, "package.json"), "utf8"),
  );
  const coherence = assertStage5CandidateCoherenceInputs({
    manifest,
    activeSources,
    packageManifest,
  });
  return { result: "PASS", ...coherence };
};
