import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import { prepareStage6MigrationEnvironment } from "./run-stage6-migrations.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const contractBytes = await readFile(
  path.join(repositoryRoot, "deploy/contracts/deployment-contract.v1.json"),
);
const contract = JSON.parse(contractBytes.toString("utf8"));
const temporaryRoot = await mkdtemp(
  path.join(process.env.TMPDIR ?? os.tmpdir(), "travelos-stage6-migrator-bootstrap-"),
);
const artifactRoot = path.join(temporaryRoot, "release");
const credentialsDirectory = path.join(temporaryRoot, "credentials");
const contractFile = path.join(artifactRoot, contract.artifact.contractPath);
const runnerPath = path.join(artifactRoot, contract.artifact.migrationRunnerEntrypoint);
const credentialFile = path.join(credentialsDirectory, contract.migrator.credentialName);

try {
  await mkdir(path.dirname(contractFile), { recursive: true });
  await mkdir(path.dirname(runnerPath), { recursive: true });
  await mkdir(credentialsDirectory, { recursive: true });
  await writeFile(contractFile, contractBytes);
  await writeFile(runnerPath, "synthetic canonical runner entrypoint\n");
  await writeFile(credentialFile, "synthetic credential fixture\n");

  const helperEnvironment = {
    PGHOST: contract.database.host,
    PGPORT: String(contract.database.port),
    PGDATABASE: contract.database.name,
    PGUSER: contract.migrator.sessionUser,
    PGPASSWORD: "synthetic-helper-password-marker",
    CREDENTIALS_DIRECTORY: credentialsDirectory,
  };
  const configured = await prepareStage6MigrationEnvironment({
    artifactRoot,
    environment: helperEnvironment,
  });
  assert.deepEqual(configured.variables, {
    TRAVELOS_DB_HOST: contract.database.host,
    TRAVELOS_DB_PORT: String(contract.database.port),
    TRAVELOS_DB_NAME: contract.database.name,
    TRAVELOS_DB_MIGRATOR_ROLE: contract.migrator.sessionUser,
    TRAVELOS_DB_OWNER_ROLE: contract.migrator.currentUser,
    TRAVELOS_DB_PASSWORD_FILE: credentialFile,
    TRAVELOS_DB_TLS_POLICY: contract.database.tlsPolicy,
  });
  assert.equal(configured.runnerPath, runnerPath);
  assert.ok(!Object.hasOwn(configured.variables, "TRAVELOS_DB_PASSWORD"));
  assert.ok(!Object.values(configured.variables).includes(helperEnvironment.PGPASSWORD));

  const missingHost = { ...helperEnvironment };
  delete missingHost.PGHOST;
  await assert.rejects(
    prepareStage6MigrationEnvironment({ artifactRoot, environment: missingHost }),
    /environment variable is absent: PGHOST/u,
  );

  const mismatchedRole = { ...helperEnvironment, PGUSER: "wrong_role" };
  await assert.rejects(
    prepareStage6MigrationEnvironment({ artifactRoot, environment: mismatchedRole }),
    /environment mismatch: PGUSER/u,
  );

  const missingCredential = {
    ...helperEnvironment,
    CREDENTIALS_DIRECTORY: path.join(temporaryRoot, "empty-credentials"),
  };
  await mkdir(missingCredential.CREDENTIALS_DIRECTORY);
  await assert.rejects(
    prepareStage6MigrationEnvironment({ artifactRoot, environment: missingCredential }),
    /ENOENT/u,
  );

  const inlinePassword = {
    ...helperEnvironment,
    TRAVELOS_DB_PASSWORD: "synthetic-inline-password-marker",
  };
  await assert.rejects(
    prepareStage6MigrationEnvironment({ artifactRoot, environment: inlinePassword }),
    /Inline migration passwords are forbidden/u,
  );

  const driftedContract = {
    ...contract,
    migrator: {
      ...contract.migrator,
      helperEnvironment: { ...contract.migrator.helperEnvironment, host: "PGPASSWORD" },
    },
  };
  await writeFile(contractFile, `${JSON.stringify(driftedContract, null, 2)}\n`);
  await assert.rejects(
    prepareStage6MigrationEnvironment({ artifactRoot, environment: helperEnvironment }),
    /deepStrictEqual|deep-equal|Expected values to be strictly deep-equal/u,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(
  `${JSON.stringify({
    result: "PASS",
    scenarios: 6,
    negativeFixtures: [
      "missing-helper-host",
      "mismatched-database-role",
      "missing-credential-file",
      "inline-password-rejected",
      "helper-environment-contract-drift",
    ],
    credentialValuesEmitted: false,
  })}\n`,
);
