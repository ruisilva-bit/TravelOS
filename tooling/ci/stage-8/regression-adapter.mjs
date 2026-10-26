import assert from "node:assert/strict";

// Execute the accepted suites against the successor chain without editing their history.
// These substitutions only extend migration expectations and replace the packaged operator
// harness. All business/security assertions remain verbatim.
const replace = (code, before, after, count = 1) => {
  assert.equal(code.split(before).length - 1, count, `Regression anchor drift: ${before}`);
  return code.replaceAll(before, after);
};
export const adaptRegression = (code, stage) => {
  if (stage === 6) {
    const start = code.indexOf("const packageStage6Migrator = (): string => {");
    const end = code.indexOf("const stage5MigrationChain = ", start);
    assert.ok(start > 0 && end > start);
    code =
      code.slice(0, start) +
      `const packageStage6Migrator = (): string => {
      const root = process.env["TRAVELOS_STAGE8_ARTIFACT_ROOT"];
      if (root === undefined) throw new Error("Stage 8 extracted artifact is required");
      return path.join(root, "migrator");
    };\n` +
      code.slice(end);
    code = replace(
      code,
      '({ file }) => file !== "0011_stage6_trip_publication.cjs"',
      '({ file }) => file < "0011"',
    );
    code = replace(
      code,
      "const migratorDirectory = packageStage6Migrator();",
      `const bootstrapPersistence = createPostgresPersistence<Record<string, never>>({ host, port, database: databaseName, user: "travelos_admin_api", tls: { mode: "DISABLED_LOOPBACK_ONLY" }, applicationName: "travelos-stage8-prior-bootstrap", maxConnections: 1 });
    try { await bootstrapRootAgency(createStaffAccessRepository(bootstrapPersistence), { agencyId, bootstrapReference: "stage6-qualification", slug: "stage6-qualification" }); } finally { await bootstrapPersistence.destroy(); }
    const migratorDirectory = packageStage6Migrator();`,
    );
    return replace(
      code,
      'expect(migration.currentVersion).toBe("0011_stage6_trip_publication")',
      'expect(migration.currentVersion).toBe("0014_stage8_worker_activity")',
    );
  }
  assert.equal(stage, 7);
  const start = code.indexOf("const runPackagedOperatorRehearsal = async (");
  const end = code.indexOf("const emptyAgencyId = ", start);
  assert.ok(start > 0 && end > start);
  code =
    code.slice(0, start) +
    `const runPackagedOperatorRehearsal = async (input: { artifactRoot: string; staffEmail: string; staffPassword: string; staffTotpSeed: string }): Promise<void> => {
    const { rehearseAcceptance } = await import(pathToFileURL(path.join(repositoryRoot, "tooling/ci/stage-8/rehearse-acceptance.mjs")).href);
    await rehearseAcceptance({ ...input, databaseName: emptyDatabaseName, port, staffRealmKey: stage7RealmKey, workRoot });
  };\n` +
    code.slice(end);
  code = replace(
    code,
    'const stage7Head = "0013_stage7_runtime_acceptance_cleanup"',
    'const stage7Head = "0014_stage8_worker_activity"',
  );
  code = replace(code, ".verifiedMigrationCount).toBe(13)", ".verifiedMigrationCount).toBe(14)", 3);
  code = replace(code, "emptyRun.ledger).toHaveLength(13)", "emptyRun.ledger).toHaveLength(14)");
  return replace(
    code,
    "priorStage7Run.appliedMigrations).toEqual([stage7Head])",
    'priorStage7Run.appliedMigrations).toEqual(["0013_stage7_runtime_acceptance_cleanup", stage7Head])',
  );
};
