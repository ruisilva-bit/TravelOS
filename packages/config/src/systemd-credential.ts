import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { CredentialReferenceIdSchema, type CredentialReferenceId } from "./credential-reference.js";

const credentialReferencePrefix = "systemd-credential:";

export interface SystemdCredentialReadOptions {
  /** Test-only override. Production resolves only the systemd-injected directory. */
  readonly credentialDirectory?: string;
}

export const systemdCredentialFileNameFor = (reference: CredentialReferenceId): string => {
  const parsed = CredentialReferenceIdSchema.parse(reference);
  return parsed.slice(credentialReferencePrefix.length);
};

/**
 * Reads process-scoped systemd credential material without exposing it in configuration or logs.
 * The credential reference is constrained to one filename segment before filesystem resolution.
 */
export const readSystemdCredentialText = async (
  reference: CredentialReferenceId,
  options: SystemdCredentialReadOptions = {},
): Promise<string> => {
  const directory = options.credentialDirectory ?? process.env["CREDENTIALS_DIRECTORY"];
  if (directory === undefined || directory.length === 0 || !isAbsolute(directory)) {
    throw new Error("A systemd-injected absolute CREDENTIALS_DIRECTORY is required");
  }

  const root = resolve(directory);
  const credentialPath = resolve(root, systemdCredentialFileNameFor(reference));
  if (dirname(credentialPath) !== root) {
    throw new Error("Systemd credential reference resolved outside its credential directory");
  }
  return readFile(credentialPath, "utf8");
};
