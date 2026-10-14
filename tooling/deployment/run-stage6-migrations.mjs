import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONTRACT_PATH = "deployment/deployment-contract.v1.json";
const BOOTSTRAP_PATH = "migrator/run-stage6-migrations.mjs";
const isSafeRelativePath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !path.posix.isAbsolute(value) &&
  !value.includes("\\") &&
  path.posix.normalize(value) === value &&
  !value.split("/").includes("..") &&
  !value.split("/").includes(".");
const isContained = (root, candidate) =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);
const requiredEnvironment = (environment, name) => {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Required migrator-helper environment variable is absent: ${name}`);
  }
  return value;
};
const requireExpectedEnvironment = (environment, name, expected) => {
  const actual = requiredEnvironment(environment, name);
  if (actual !== expected) {
    throw new Error(`Migrator-helper environment mismatch: ${name}`);
  }
};

export const prepareStage6MigrationEnvironment = async ({ artifactRoot, environment }) => {
  assert.ok(typeof artifactRoot === "string" && artifactRoot.length > 0);
  assert.ok(environment && typeof environment === "object");
  const root = await realpath(artifactRoot);
  const contractFile = path.join(root, CONTRACT_PATH);
  const contractMetadata = await lstat(contractFile);
  assert.ok(contractMetadata.isFile() && !contractMetadata.isSymbolicLink());
  const contract = JSON.parse(await readFile(contractFile, "utf8"));

  assert.equal(contract.schemaVersion, 1, "Unsupported deployment contract schema version");
  assert.equal(
    contract.artifact?.contractPath,
    CONTRACT_PATH,
    "Unexpected deployment contract path",
  );
  assert.equal(contract.migrator?.deploymentEntrypoint, BOOTSTRAP_PATH);
  assert.deepEqual(contract.migrator?.helperEnvironment, {
    host: "PGHOST",
    port: "PGPORT",
    database: "PGDATABASE",
    sessionUser: "PGUSER",
    credentialsDirectory: "CREDENTIALS_DIRECTORY",
  });
  assert.equal(contract.database?.host, "127.0.0.1");
  assert.equal(contract.database?.port, 5432);
  assert.equal(contract.database?.tlsPolicy, "DISABLED_LOOPBACK_ONLY");
  assert.equal(contract.migrator?.credentialName, "migrator-db");
  assert.equal(contract.migrator?.sessionUser, "travelos_migrator");
  assert.equal(contract.migrator?.currentUser, "travelos_owner");
  assert.equal(contract.migrator?.executor, "travelos-migrator-exec");

  const helperEnvironment = contract.migrator.helperEnvironment;
  requireExpectedEnvironment(environment, helperEnvironment.host, contract.database.host);
  requireExpectedEnvironment(environment, helperEnvironment.port, String(contract.database.port));
  requireExpectedEnvironment(environment, helperEnvironment.database, contract.database.name);
  requireExpectedEnvironment(
    environment,
    helperEnvironment.sessionUser,
    contract.migrator.sessionUser,
  );
  if (environment.TRAVELOS_DB_PASSWORD !== undefined) {
    throw new Error("Inline migration passwords are forbidden; use the systemd credential file");
  }

  const credentialsDirectory = requiredEnvironment(
    environment,
    helperEnvironment.credentialsDirectory,
  );
  assert.ok(path.isAbsolute(credentialsDirectory), "Credential directory must be absolute");
  const resolvedCredentialsDirectory = await realpath(credentialsDirectory);
  const credentialName = contract.migrator.credentialName;
  assert.match(credentialName, /^[a-z0-9][a-z0-9-]*$/u, "Invalid systemd credential name");
  const credentialPath = path.join(resolvedCredentialsDirectory, credentialName);
  const credentialMetadata = await lstat(credentialPath);
  assert.ok(credentialMetadata.isFile() && !credentialMetadata.isSymbolicLink());
  await access(credentialPath, fsConstants.R_OK);

  const runnerPath = contract.artifact.migrationRunnerEntrypoint;
  assert.ok(isSafeRelativePath(runnerPath), "Unsafe canonical migration-runner path");
  const resolvedRunnerPath = await realpath(path.join(root, ...runnerPath.split("/")));
  assert.ok(
    isContained(root, resolvedRunnerPath),
    "Canonical migration runner escaped artifact root",
  );
  const runnerMetadata = await lstat(resolvedRunnerPath);
  assert.ok(runnerMetadata.isFile() && !runnerMetadata.isSymbolicLink());

  return {
    variables: {
      TRAVELOS_DB_HOST: contract.database.host,
      TRAVELOS_DB_PORT: String(contract.database.port),
      TRAVELOS_DB_NAME: contract.database.name,
      TRAVELOS_DB_MIGRATOR_ROLE: contract.migrator.sessionUser,
      TRAVELOS_DB_OWNER_ROLE: contract.migrator.currentUser,
      TRAVELOS_DB_PASSWORD_FILE: credentialPath,
      TRAVELOS_DB_TLS_POLICY: contract.database.tlsPolicy,
    },
    runnerPath: resolvedRunnerPath,
  };
};

const runCanonicalMigrationRunner = async () => {
  assert.deepEqual(
    process.argv.slice(2),
    ["up"],
    "Expected exactly one canonical migration action: up",
  );
  const bootstrapFile = fileURLToPath(import.meta.url);
  const artifactRoot = path.resolve(path.dirname(bootstrapFile), "..");
  const prepared = await prepareStage6MigrationEnvironment({
    artifactRoot,
    environment: process.env,
  });
  Object.assign(process.env, prepared.variables);
  delete process.env.PGPASSWORD;
  delete process.env.TRAVELOS_DB_PASSWORD;
  await import(pathToFileURL(prepared.runnerPath).href);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runCanonicalMigrationRunner();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ result: "FAIL", error: error instanceof Error ? error.message : "migration bootstrap failed" })}\n`,
    );
    process.exitCode = 1;
  }
}
