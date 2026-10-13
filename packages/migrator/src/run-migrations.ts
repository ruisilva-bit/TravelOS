import { readFile } from "node:fs/promises";

import {
  runMigrationChain,
  type MigrationTarget,
} from "../../../tooling/database/migration-runner.js";
import { resolveMigrationChainPaths } from "./resolve-migration-chain.js";

const requiredEnvironment = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable is absent: ${name}`);
  return value;
};

const optionalPassword = async (): Promise<string | undefined> => {
  const credentialPath = process.env["TRAVELOS_DB_PASSWORD_FILE"];
  if (credentialPath) return (await readFile(credentialPath, "utf8")).trimEnd();
  return process.env["TRAVELOS_DB_PASSWORD"];
};

const tlsMode = process.env["TRAVELOS_DB_TLS_POLICY"] ?? "DISABLED_LOOPBACK_ONLY";
if (tlsMode !== "DISABLED_LOOPBACK_ONLY" && tlsMode !== "VERIFY_FULL") {
  throw new Error("TRAVELOS_DB_TLS_POLICY must be DISABLED_LOOPBACK_ONLY or VERIFY_FULL");
}

const password = await optionalPassword();
const target: MigrationTarget = {
  host: requiredEnvironment("TRAVELOS_DB_HOST"),
  port: Number.parseInt(requiredEnvironment("TRAVELOS_DB_PORT"), 10),
  database: requiredEnvironment("TRAVELOS_DB_NAME"),
  migratorRole: requiredEnvironment("TRAVELOS_DB_MIGRATOR_ROLE"),
  ownerRole: requiredEnvironment("TRAVELOS_DB_OWNER_ROLE"),
  ...(password === undefined ? {} : { password }),
  tls:
    tlsMode === "VERIFY_FULL"
      ? {
          mode: "VERIFY_FULL",
          certificateAuthority: await readFile(
            requiredEnvironment("TRAVELOS_DB_TLS_CA_FILE"),
            "utf8",
          ),
        }
      : { mode: "DISABLED_LOOPBACK_ONLY" },
  allowTrustAuthenticationForTests: process.env["TRAVELOS_ALLOW_TRUST_AUTH_FOR_TESTS"] === "true",
};

const action = process.argv[2] ?? "up";
if (action !== "up") {
  throw new Error("Expected migration action: up");
}

const result = await runMigrationChain(target, resolveMigrationChainPaths());
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
