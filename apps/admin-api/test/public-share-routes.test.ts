import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPublicShareOperations,
  ShareLinkNotFoundError,
  type PublicShareOperations,
  type TripSnapshotV1,
} from "@travelos/backend-core";

import { createAdminApi } from "../src/app.js";
import { PUBLIC_SHARE_HEADERS } from "../src/public-share-routes.js";
import { createStaffInvitationRateLimiter } from "../src/staff-invitation-rate-limit.js";
import { sampleSnapshot } from "./share-page-renderer.test.js";

const expectedHost = "admin.example.test";
const validToken = `${"V".repeat(42)}A`;
const poison = ["INTERNAL_ONLY SUPPLIER COST 12345", "POISON margin", "POISON internal note"];

const operationsFor = (
  readPublicShare: PublicShareOperations["readPublicShare"],
): PublicShareOperations => ({ readPublicShare });

const open = async (
  readPublicShare: PublicShareOperations["readPublicShare"],
  maxAttempts = 1_000,
) =>
  createAdminApi({
    expectedHost,
    publicShare: {
      operations: operationsFor(readPublicShare),
      rateLimiter: createStaffInvitationRateLimiter({ maxAttempts, windowMs: 60_000 }),
    },
  });

const notFound = (): Promise<TripSnapshotV1> => Promise.reject(new ShareLinkNotFoundError());

afterEach(() => vi.restoreAllMocks());

describe("public share route GET /v/:token", () => {
  it("serves 200 HTML without any cookie, with the hardened headers", async () => {
    const application = await open(async () => sampleSnapshot("<script>alert(1)</script>"));
    try {
      const response = await request(application.getHttpServer())
        .get(`/v/${validToken}`)
        .set("Host", expectedHost)
        .expect(200);
      expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
      for (const [name, value] of Object.entries(PUBLIC_SHARE_HEADERS)) {
        expect(response.headers[name.toLowerCase()]).toBe(value);
      }
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.text).not.toContain("<script>");
      expect(response.text).toContain("&lt;script&gt;");
      for (const sentinel of poison) expect(response.text).not.toContain(sentinel);
    } finally {
      await application.close();
    }
  });

  it("answers malformed, unknown, expired and revoked links with byte-identical 404s", async () => {
    const reader = vi.fn((token: unknown) => {
      if (token === "K".repeat(43)) return notFound(); // unknown / expired / revoked: reader returns null
      return Promise.reject(new Error("unexpected failure with detail"));
    });
    const application = await open(reader);
    try {
      const paths = [
        "/v/short",
        `/v/${"K".repeat(43)}`,
        `/v/${"E".repeat(43)}`,
        `/v/${"K".repeat(43)}/extra`,
        `/v/${"K".repeat(42)}%2e`,
        "/v/",
        "/v",
        `/v/${"K".repeat(43)}?x=1`,
      ];
      const seen: { status: number; text: string; headers: Record<string, string> }[] = [];
      for (const path of paths) {
        const response = await request(application.getHttpServer())
          .get(path)
          .set("Host", expectedHost);
        const {
          date: _date,
          "x-request-id": _id,
          ...stable
        } = response.headers as Record<string, string>;
        seen.push({ status: response.status, text: response.text, headers: stable });
      }
      for (const entry of seen) {
        expect(entry.status).toBe(404);
        expect(entry.text).toBe(seen[0]?.text);
        expect(entry.headers).toEqual({
          ...seen[0]?.headers,
          "content-length": entry.headers["content-length"],
        });
        for (const [name, value] of Object.entries(PUBLIC_SHARE_HEADERS)) {
          expect(entry.headers[name.toLowerCase()]).toBe(value);
        }
      }
      const post = await request(application.getHttpServer())
        .post(`/v/${validToken}`)
        .set("Host", expectedHost)
        .set("Origin", `http://${expectedHost}`);
      // Non-GET never reaches the reader (the global Origin guard or the route itself refuses it).
      expect([403, 404]).toContain(post.status);
      expect(reader).not.toHaveBeenCalledWith(validToken);
    } finally {
      await application.close();
    }
  });

  it("still enforces the host allowlist", async () => {
    const readPublicShare = vi.fn(async () => sampleSnapshot());
    const application = await open(readPublicShare);
    try {
      await request(application.getHttpServer())
        .get(`/v/${validToken}`)
        .set("Host", "unauthorized.example.test")
        .expect(404);
      expect(readPublicShare).not.toHaveBeenCalled();
    } finally {
      await application.close();
    }
  });

  it("rate limits per client with 429 and the same security headers", async () => {
    const application = await open(async () => sampleSnapshot(), 3);
    try {
      for (let index = 0; index < 3; index += 1) {
        await request(application.getHttpServer())
          .get(`/v/${validToken}`)
          .set("Host", expectedHost)
          .expect(200);
      }
      const limited = await request(application.getHttpServer())
        .get(`/v/${validToken}`)
        .set("Host", expectedHost)
        .expect(429);
      expect(limited.headers["retry-after"]).toMatch(/^[0-9]+$/u);
      expect(limited.headers["cache-control"]).toBe("no-store");
      expect(limited.headers["referrer-policy"]).toBe("no-referrer");
    } finally {
      await application.close();
    }
  });

  it("never writes the token to the request log", async () => {
    const lines: string[] = [];
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        lines.push(String(chunk));
        return true;
      });
    const application = await open(async () => sampleSnapshot());
    try {
      await request(application.getHttpServer())
        .get(`/v/${validToken}`)
        .set("Host", expectedHost)
        .expect(200);
      await request(application.getHttpServer())
        .get(`/v/${validToken}x`)
        .set("Host", expectedHost)
        .expect(404);
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      write.mockRestore();
      await application.close();
    }
    const logged = lines.join("");
    expect(logged).toContain("http_request");
    expect(logged).not.toContain(validToken);
    expect(logged).not.toContain("/v/");
  });

  it("is not swallowed by an unauthenticated app that has no staff routes, and reads through the real use-case", async () => {
    const reader = vi.fn(async () => ({ canonicalPayload: JSON.stringify(sampleSnapshot()) }));
    const operations = createPublicShareOperations({
      reader: { readByTokenHash: reader },
      crypto: { sha256: () => new Uint8Array(32) },
      parseSnapshot: (value) => value as TripSnapshotV1,
    });
    const application = await createAdminApi({
      expectedHost,
      publicShare: {
        operations,
        rateLimiter: createStaffInvitationRateLimiter({ maxAttempts: 10, windowMs: 60_000 }),
      },
    });
    try {
      await request(application.getHttpServer())
        .get(`/v/${validToken}`)
        .set("Host", expectedHost)
        .expect(200);
      expect(reader).toHaveBeenCalledTimes(1);
      await request(application.getHttpServer()).get("/").set("Host", expectedHost).expect(404);
    } finally {
      await application.close();
    }
  });
});
