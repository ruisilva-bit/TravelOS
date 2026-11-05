import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as authAdapterExports from "../src/index.js";

const adapterExports = authAdapterExports as unknown as Record<string, unknown>;

const tokenFactory = (): (() => unknown) | null => {
  const candidate = adapterExports["createStaffInvitationToken"];
  return typeof candidate === "function" ? (candidate as () => unknown) : null;
};

describe("Staff invitation token adapter", () => {
  it("creates a canonical 32-byte base64url bearer and its SHA-256 digest", () => {
    const createToken = tokenFactory();
    expect(createToken).toBeTypeOf("function");
    if (createToken === null) return;

    const generated = createToken();
    expect(generated).toMatchObject({
      token: expect.any(String),
      digest: expect.any(String),
    });
    const record = generated as Record<string, unknown>;
    const token = record["token"];
    const digest = record["digest"];
    expect(token).toBeTypeOf("string");
    expect(digest).toBeTypeOf("string");
    if (typeof token !== "string" || typeof digest !== "string") return;

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(Buffer.from(token, "base64url").toString("base64url")).toBe(token);
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(digest).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
  });

  it("creates distinct bearer tokens across repeated invitations", () => {
    const createToken = tokenFactory();
    expect(createToken).toBeTypeOf("function");
    if (createToken === null) return;

    const tokens = Array.from({ length: 32 }, () => {
      const generated = createToken() as Record<string, unknown>;
      return generated["token"];
    });
    expect(tokens.every((token): token is string => typeof token === "string")).toBe(true);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("hashes the presented bearer exactly as UTF-8 with SHA-256", () => {
    const digestToken = adapterExports["digestStaffInvitationToken"];
    expect(digestToken).toBeTypeOf("function");
    if (typeof digestToken !== "function") return;

    const bearer = "Aq7_Vu9M2pX4cR8tY1wZ6nK3bH5sD0eF9gJ2mL4qC8a";
    const actual = (digestToken as (token: string) => unknown)(bearer);
    expect(actual).toBe(createHash("sha256").update(bearer, "utf8").digest("hex"));
    expect(actual).toMatch(/^[a-f0-9]{64}$/u);
  });
});
