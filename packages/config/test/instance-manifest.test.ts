import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import { parseDevelopmentInstanceManifest } from "../src/index.js";

const examplePath = fileURLToPath(
  new URL("../../../deploy/manifests/development.example.json", import.meta.url),
);
const validManifest = JSON.parse(readFileSync(examplePath, "utf8")) as Record<string, unknown>;
const copyManifest = (): Record<string, unknown> => structuredClone(validManifest);
type ListenerRecords = {
  adminApi: Record<string, unknown>;
  portalApi: Record<string, unknown>;
};

describe("development instance manifest", () => {
  it("accepts the safe repository example", () => {
    const manifest = parseDevelopmentInstanceManifest(copyManifest());
    expect(manifest.environment).toBe("DEVELOPMENT");
    expect(manifest.runtime.listeners).toEqual({
      adminApi: { host: "127.0.0.1", port: 3101 },
      portalApi: { host: "127.0.0.1", port: 3102 },
    });
    expect(manifest.hostAllowlist).toEqual([
      { host: "admin.travelos.test", surface: "ADMIN" },
      { host: "portal.travelos.test", surface: "PORTAL" },
    ]);
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

  it("rejects an Admin and Portal API listener collision", () => {
    const candidate = copyManifest();
    const runtime = candidate["runtime"] as Record<string, unknown>;
    const listeners = runtime["listeners"] as ListenerRecords;
    listeners["portalApi"] = structuredClone(listeners["adminApi"]);
    expect(() => parseDevelopmentInstanceManifest(candidate)).toThrow(
      /listeners must use distinct host and port pairs/,
    );
  });

  it("accepts equal API port numbers on clearly distinct loopback bind addresses", () => {
    const candidate = copyManifest();
    const runtime = candidate["runtime"] as Record<string, unknown>;
    const listeners = runtime["listeners"] as ListenerRecords;
    listeners["portalApi"]["host"] = "127.0.0.2";
    listeners["portalApi"]["port"] = listeners["adminApi"]["port"];
    const manifest = parseDevelopmentInstanceManifest(candidate);
    expect(manifest.runtime.listeners).toEqual({
      adminApi: { host: "127.0.0.1", port: 3101 },
      portalApi: { host: "127.0.0.2", port: 3101 },
    });
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

  it("rejects wildcard, URL, port, and non-normalized hosts", () => {
    for (const host of [
      "*.travelos.test",
      "https://admin.travelos.test",
      "admin.travelos.test:443",
      "Admin.travelos.test",
    ]) {
      const candidate = copyManifest();
      const hosts = candidate["hosts"] as Record<string, unknown>;
      hosts["admin"] = host;
      expect(() => parseDevelopmentInstanceManifest(candidate)).toThrow();
    }
  });

  it("rejects a host allowlist that does not match the surface hosts", () => {
    const candidate = copyManifest();
    candidate["hostAllowlist"] = [
      { host: "wrong.travelos.test", surface: "ADMIN" },
      { host: "portal.travelos.test", surface: "PORTAL" },
    ];
    expect(() => parseDevelopmentInstanceManifest(candidate)).toThrow(/Host allowlist must match/);
  });

  it("rejects equal Admin and Portal hosts", () => {
    const candidate = copyManifest();
    const hosts = candidate["hosts"] as Record<string, unknown>;
    hosts["portal"] = "admin.travelos.test";
    candidate["hostAllowlist"] = [
      { host: "admin.travelos.test", surface: "ADMIN" },
      { host: "admin.travelos.test", surface: "PORTAL" },
    ];
    expect(() => parseDevelopmentInstanceManifest(candidate)).toThrow(
      /Admin and Portal hosts must be distinct/,
    );
  });
});
