import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readSystemdCredentialText, systemdCredentialFileNameFor } from "../src/index.js";

let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (temporaryDirectory !== undefined) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    temporaryDirectory = undefined;
  }
});

describe("systemd credential references", () => {
  it("maps an opaque reference to exactly one credential filename segment", () => {
    expect(systemdCredentialFileNameFor("systemd-credential:staff-auth-realm")).toBe(
      "staff-auth-realm",
    );
  });

  it("reads only a credential material file from an explicit absolute directory", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "travelos-config-test-"));
    await writeFile(join(temporaryDirectory, "staff-auth-realm"), "opaque-test-material", "utf8");

    await expect(
      readSystemdCredentialText("systemd-credential:staff-auth-realm", {
        credentialDirectory: temporaryDirectory,
      }),
    ).resolves.toBe("opaque-test-material");
  });

  it("rejects a relative credential directory", async () => {
    await expect(
      readSystemdCredentialText("systemd-credential:staff-auth-realm", {
        credentialDirectory: "relative-credentials",
      }),
    ).rejects.toThrow(/absolute CREDENTIALS_DIRECTORY/);
  });
});
