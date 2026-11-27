import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import { parseDevelopmentInstanceManifest } from "../src/index.js";

const examplePath = fileURLToPath(
  new URL("../../../deploy/manifests/development.example.json", import.meta.url),
);
const validManifest = JSON.parse(readFileSync(examplePath, "utf8")) as Record<string, unknown>;
const copyManifest = (): Record<string, unknown> => structuredClone(validManifest);
type RuntimeRoleRecords = Record<"adminApi" | "worker", Record<string, unknown>>;
type AuthenticationRecords = Record<"staffRealmCredentialReference", unknown>;

const runtimeRolesOf = (candidate: Record<string, unknown>): RuntimeRoleRecords => {
  const database = candidate["database"] as Record<string, unknown>;
  return database["runtimeRoles"] as RuntimeRoleRecords;
};
const authenticationOf = (candidate: Record<string, unknown>): AuthenticationRecords =>
  candidate["authentication"] as AuthenticationRecords;

describe("development instance manifest", () => {
  it("accepts the safe repository example", () => {
    const manifest = parseDevelopmentInstanceManifest(copyManifest());
    expect(manifest.environment).toBe("DEVELOPMENT");
    expect(manifest.runtime.listeners).toEqual({
      adminApi: { host: "127.0.0.1", port: 3101 },
    });
    expect(manifest.hostAllowlist).toEqual([{ host: "admin.travelos.test", surface: "ADMIN" }]);
    expect(manifest.database).toEqual({
      host: "127.0.0.1",
      port: 5432,
      name: "travelos_development",
      tlsPolicy: "DISABLED_LOOPBACK_ONLY",
      runtimeRoles: {
        adminApi: {
          roleName: "travelos_admin_api",
          credentialReference: "systemd-credential:admin-api-db",
        },
        worker: {
          roleName: "travelos_worker",
          credentialReference: "systemd-credential:worker-db",
        },
      },
    });
    expect(manifest.authentication).toEqual({
      staffRealmCredentialReference: "systemd-credential:staff-auth-realm",
    });
  });

  it("rejects an unknown root key", () => {
    const candidate = copyManifest();
    candidate["unexpected"] = true;
    expect(() => parseDevelopmentInstanceManifest(candidate)).toThrow();
  });

  it("rejects an unknown nested key", () => {
    const candidate = copyManifest();
    const runtime = candidate["runtime"] as Record<string, unknown>;
    runtime["unexpected"] = true;
    expect(() => parseDevelopmentInstanceManifest(candidate)).toThrow();
  });

  it.each(["password", "apiKey", "token", "databaseUrl", "privateKey"])(
    "rejects secret-like field %s before schema parsing",
    (field) => {
      const candidate = copyManifest();
      candidate[field] = "forbidden";
      expect(() => parseDevelopmentInstanceManifest(candidate)).toThrow(
        /Secret-like configuration field is forbidden/,
      );
    },
  );

  it("rejects a secret-like nested field", () => {
    const candidate = copyManifest();
    const database = candidate["database"] as Record<string, unknown>;
    database["connectionString"] = "forbidden";
    expect(() => parseDevelopmentInstanceManifest(candidate)).toThrow(
      /Secret-like configuration field is forbidden/,
    );
  });

  it("rejects a non-loopback database host", () => {
    const candidate = copyManifest();
    const database = candidate["database"] as Record<string, unknown>;
    database["host"] = "192.168.1.33";
    expect(() => parseDevelopmentInstanceManifest(candidate)).toThrow();
  });

  it.each([
    ["adminApi", "travelos_worker"],
    ["worker", "travelos_admin_api"],
    ["adminApi", "travelos_owner"],
    ["worker", "travelos_migrator"],
    ["adminApi", "travelos_admin_runtime"],
    ["worker", "travelos_worker_runtime"],
  ] as const)("rejects %s database identity %s", (processName, roleName) => {
    const candidate = copyManifest();
    runtimeRolesOf(candidate)[processName]["roleName"] = roleName;
    expect(() => parseDevelopmentInstanceManifest(candidate)).toThrow();
  });

  it("rejects duplicate credential references for adminApi and worker", () => {
    const candidate = copyManifest();
    const roles = runtimeRolesOf(candidate);
    roles["worker"]["credentialReference"] = roles["adminApi"]["credentialReference"];
    expect(() => parseDevelopmentInstanceManifest(candidate)).toThrow(
      /Credential references must be pairwise distinct/,
    );
  });

  it("rejects a realm credential reference reused by a database process", () => {
    const candidate = copyManifest();
    authenticationOf(candidate)["staffRealmCredentialReference"] =
      runtimeRolesOf(candidate)["adminApi"]["credentialReference"];
    expect(() => parseDevelopmentInstanceManifest(candidate)).toThrow(
      /Credential references must be pairwise distinct/,
    );
  });

  it("rejects wildcard, URL, port, and non-normalized hosts", () => {
    for (const host of [
      "*.travelos.test",
      "https://admin.travelos.test",
      "admin.travelos.test:443",
      "Admin.travelos.test",
      "Travelos-Dev",
      "travelos-dev.",
      "-x",
      "a:80",
      "*.x",
      "http://x",
    ]) {
      const candidate = copyManifest();
      const hosts = candidate["hosts"] as Record<string, unknown>;
      hosts["admin"] = host;
      expect(() => parseDevelopmentInstanceManifest(candidate)).toThrow();
    }
  });

  it("accepts a single-label LAN hostname", () => {
    const candidate = copyManifest();
    (candidate["hosts"] as Record<string, unknown>)["admin"] = "travelos-dev";
    candidate["hostAllowlist"] = [{ host: "travelos-dev", surface: "ADMIN" }];
    expect(parseDevelopmentInstanceManifest(candidate).hosts.admin).toBe("travelos-dev");
  });

  it("rejects a host allowlist that does not match the surface hosts", () => {
    const candidate = copyManifest();
    candidate["hostAllowlist"] = [{ host: "wrong.travelos.test", surface: "ADMIN" }];
    expect(() => parseDevelopmentInstanceManifest(candidate)).toThrow(/Host allowlist must match/);
  });
});

describe("CT200 production-shaped example manifest", () => {
  it("validates with the config package", () => {
    const path = fileURLToPath(
      new URL("../../../deploy/manifests/travelos.example.json", import.meta.url),
    );
    const manifest = parseDevelopmentInstanceManifest(JSON.parse(readFileSync(path, "utf8")));
    expect(manifest.hosts.admin).toBe("travelos-dev");
    expect(manifest.runtime.listeners.adminApi.host).toBe("127.0.0.1");
  });
});
