import { randomUUID } from "node:crypto";

import {
  createLocalOperatorStaffEnrollmentRealm,
  createOneTimeOperatorToken,
  digestOneTimeOperatorToken,
  STAFF_AUTH_BASE_PATH,
} from "@travelos/auth-adapters";
import { bootstrapRootAgency } from "@travelos/backend-core";
import {
  loadDevelopmentInstanceManifest,
  readSystemdCredentialText,
  type DevelopmentInstanceManifest,
} from "@travelos/config";
import {
  createPostgresPersistence,
  createStaffAccessRepository,
  type PostgresPersistence,
  type StaffAccessRepository,
} from "@travelos/database";

const defaultInvitationLifetimeMinutes = 60;
const maximumInvitationLifetimeMinutes = 24 * 60;
type DatabaseShape = Record<string, never>;

interface LocalOperatorRuntime {
  readonly persistence: PostgresPersistence<DatabaseShape>;
  readonly repository: StaffAccessRepository;
  readonly manifest: DevelopmentInstanceManifest;
}

const readArgument = (name: string): string | undefined => {
  const prefix = `${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline !== undefined) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  return index === -1 ? undefined : value;
};

const requireArgument = (name: string): string => {
  const value = readArgument(name);
  if (value === undefined || value.length === 0)
    throw new Error(`Required argument is missing: ${name}`);
  return value;
};

const requireLocalTty = (): void => {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stderr.isTTY) {
    throw new Error("Local owner bootstrap requires an interactive protected TTY");
  }
};

const rejectSensitiveArguments = (): void => {
  const sensitive = process.argv.find((argument) =>
    /^--(?:password|token|invite|secret)/iu.test(argument),
  );
  if (sensitive !== undefined) {
    throw new Error(
      "Sensitive Owner bootstrap material must be entered through the protected TTY prompt",
    );
  }
};

const readTtyLine = async (prompt: string, sensitive: boolean): Promise<string> => {
  requireLocalTty();
  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (result: "resolve" | "reject", error?: Error): void => {
      process.stdin.off("data", onData);
      process.stdin.off("error", onError);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
      if (result === "resolve") resolve(value);
      else reject(error ?? new Error("Protected TTY input was cancelled"));
    };
    const onError = (): void => finish("reject", new Error("Protected TTY input failed"));
    const onData = (chunk: Buffer): void => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          finish("reject", new Error("Protected TTY input was cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish("resolve");
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = Array.from(value).slice(0, -1).join("");
          if (!sensitive) process.stderr.write("\b \b");
          continue;
        }
        if (character >= " ") {
          value += character;
          if (!sensitive) process.stderr.write(character);
        }
      }
    };
    process.stdin.on("data", onData);
    process.stdin.once("error", onError);
  });
};

const normalizeEmail = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    throw new Error("First Owner email is invalid");
  }
  return normalized;
};

const operatorIdentity = (): string => `LOCAL_OPERATOR_UID:${process.getuid?.() ?? "unknown"}`;

const invitationLifetime = (): number => {
  const source = readArgument("--expires-in-minutes");
  if (source === undefined) return defaultInvitationLifetimeMinutes;
  const value = Number.parseInt(source, 10);
  if (!Number.isInteger(value) || value < 5 || value > maximumInvitationLifetimeMinutes) {
    throw new Error("--expires-in-minutes must be an integer from 5 through 1440");
  }
  return value;
};

const createRuntime = async (manifestPath: string): Promise<LocalOperatorRuntime> => {
  const manifest = await loadDevelopmentInstanceManifest(manifestPath);
  const databaseCredential = await readSystemdCredentialText(
    manifest.database.runtimeRoles.adminApi.credentialReference,
  );
  const persistence = createPostgresPersistence<DatabaseShape>({
    host: manifest.database.host,
    port: manifest.database.port,
    database: manifest.database.name,
    user: manifest.database.runtimeRoles.adminApi.roleName,
    password: databaseCredential,
    tls: { mode: manifest.database.tlsPolicy },
    applicationName: "travelos-local-owner-bootstrap",
    maxConnections: 2,
  });
  return { persistence, repository: createStaffAccessRepository(persistence), manifest };
};

const bootstrapAgency = async (runtime: LocalOperatorRuntime) =>
  bootstrapRootAgency(runtime.repository, {
    agencyId: randomUUID(),
    bootstrapReference: runtime.manifest.agencyBootstrap.reference,
    slug: runtime.manifest.agencyBootstrap.slug,
  });

const issueFirstOwnerInvitation = async (runtime: LocalOperatorRuntime): Promise<void> => {
  const agency = await bootstrapAgency(runtime);
  const targetEmail = normalizeEmail(await readTtyLine("First Owner email: ", false));
  const token = createOneTimeOperatorToken();
  const result = await runtime.repository.issueFirstOwnerInvitation({
    agencyId: agency.agencyId,
    targetEmail,
    tokenDigest: token.digest,
    expiresAt: new Date(Date.now() + invitationLifetime() * 60_000),
    operatorIdentity: operatorIdentity(),
  });
  if (result.result !== "ISSUED") {
    throw new Error("First Owner invitation is already active or has already been consumed");
  }
  process.stderr.write(
    "Copy the following one-time invitation token now; it will not be shown again.\n",
  );
  process.stdout.write(`${token.rawToken}\n`);
};

const enrollFirstOwner = async (runtime: LocalOperatorRuntime): Promise<void> => {
  const email = normalizeEmail(await readTtyLine("First Owner email: ", false));
  const name = (await readTtyLine("First Owner display name: ", false)).trim();
  if (name.length === 0 || name.length > 255)
    throw new Error("First Owner display name is invalid");
  const invitationToken = await readTtyLine("One-time invitation token: ", true);
  const password = await readTtyLine("First Owner password: ", true);
  const invitation = await runtime.repository.inspectFirstOwnerInvitation(
    digestOneTimeOperatorToken(invitationToken),
  );
  if (invitation.result !== "VALID" || invitation.targetEmail !== email) {
    throw new Error("First Owner invitation is not valid for this local enrollment");
  }
  const realmKeyMaterial = await readSystemdCredentialText(
    runtime.manifest.authentication.staffRealmCredentialReference,
  );
  const enrollmentRealm = await runtime.persistence.withConnection(async (database) =>
    createLocalOperatorStaffEnrollmentRealm({
      database,
      canonicalOrigin: `http://${runtime.manifest.hosts.admin}`,
      realmKeyMaterial,
      environment: runtime.manifest.environment,
    }),
  );
  let staffPrincipalId = await runtime.repository.findStaffPrincipalIdByEmail(email);
  if (staffPrincipalId === null) {
    const response = await enrollmentRealm.handle(
      new Request(
        new URL(`${STAFF_AUTH_BASE_PATH}/sign-up/email`, `http://${runtime.manifest.hosts.admin}`),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        },
      ),
    );
    // A process interruption can occur after Better Auth commits the identity but before this
    // command consumes the invitation. Re-read the narrowly validated email so a local operator
    // can safely resume rather than requiring database repair.
    staffPrincipalId = await runtime.repository.findStaffPrincipalIdByEmail(email);
    if (!response.ok && staffPrincipalId === null) {
      throw new Error("First Owner identity enrollment was rejected");
    }
  }
  if (staffPrincipalId === null)
    throw new Error("First Owner identity enrollment did not create a principal");
  const consumed = await runtime.repository.consumeFirstOwnerInvitation({
    tokenDigest: digestOneTimeOperatorToken(invitationToken),
    staffPrincipalId,
    operatorIdentity: operatorIdentity(),
  });
  if (consumed.result !== "CONSUMED") {
    throw new Error("First Owner invitation could not be consumed");
  }
  process.stdout.write(
    "First Owner enrollment completed. Configure TOTP before using Staff routes.\n",
  );
};

const main = async (): Promise<void> => {
  requireLocalTty();
  rejectSensitiveArguments();
  const command = process.argv[2];
  if (command !== "issue-first-owner" && command !== "enroll-first-owner") {
    throw new Error("Expected local command: issue-first-owner or enroll-first-owner");
  }
  const runtime = await createRuntime(requireArgument("--manifest"));
  try {
    if (command === "issue-first-owner") await issueFirstOwnerInvitation(runtime);
    else await enrollFirstOwner(runtime);
  } finally {
    await runtime.persistence.destroy();
  }
};

void main().catch(() => {
  process.stderr.write("TravelOS local Owner bootstrap failed.\n");
  process.exitCode = 1;
});
