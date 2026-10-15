import { connect } from "node:net";

import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { PORTAL_AUTH_BASE_PATH, type PortalAuthRealm } from "@travelos/auth-adapters/portal";

import { createPortalApi, type CreatePortalApiOptions } from "../src/app.js";

const expectedHost = "portal.example.test";
const canonicalOrigin = `http://${expectedHost}`;

type PortalApi = Awaited<ReturnType<typeof createPortalApi>>;

const startListener = async (
  options: Omit<CreatePortalApiOptions, "expectedHost"> = {},
): Promise<{
  readonly application: PortalApi;
  readonly baseUrl: string;
  readonly port: number;
}> => {
  const application = await createPortalApi({ expectedHost, ...options });
  await application.listen(0, "127.0.0.1");
  const address = application.getHttpServer().address();
  if (address === null || typeof address === "string") {
    await application.close();
    throw new Error("Portal API test listener did not bind a TCP address");
  }
  return {
    application,
    baseUrl: `http://127.0.0.1:${address.port}`,
    port: address.port,
  };
};

const portalRealm = (
  handle = vi.fn(async () => new Response("portal-auth", { status: 200 })),
): PortalAuthRealm => ({
  kind: "PORTAL",
  basePath: PORTAL_AUTH_BASE_PATH,
  cookieName: "travelos-dev-portal-session",
  secureTransportRequired: false,
  handle,
  async getServerSession() {
    return null;
  },
});

const authOptions = (realm: PortalAuthRealm): NonNullable<CreatePortalApiOptions["auth"]> => ({
  realm,
  policy: { canonicalOrigin, expectedHost },
});

const rawRequest = (port: number, requestText: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = connect(port, "127.0.0.1", () => socket.write(requestText));
    socket.setTimeout(3_000, () => socket.destroy(new Error("Raw HTTP probe timed out")));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("latin1")));
    socket.on("error", reject);
  });

const rawStatus = (response: string): number => {
  const statusLine = /^HTTP\/1\.1 (\d{3})\b/m.exec(response)?.[1];
  if (statusLine === undefined) throw new Error(`No HTTP/1.1 status line in response: ${response}`);
  return Number(statusLine);
};

describe("Portal API global host and Portal auth routing boundary", () => {
  it("validates the configured Host before body parsing, health, API and unknown-route handling", async () => {
    const { application, baseUrl } = await startListener({ auth: authOptions(portalRealm()) });
    try {
      const liveHealth = await request(baseUrl).get("/health/live").set("Host", expectedHost);
      expect(liveHealth.status).toBe(200);

      const deniedHealth = await request(baseUrl)
        .get("/health/live")
        .set("Host", "unauthorized.example.test");
      expect(deniedHealth.status).toBe(404);
      expect(deniedHealth.text).toBe("");
      expect(deniedHealth.headers["cache-control"]).toBe("private, no-store");

      const deniedUnknownRoute = await request(baseUrl)
        .get("/not-a-route")
        .set("Host", "unauthorized.example.test");
      expect(deniedUnknownRoute.status).toBe(404);
      expect(deniedUnknownRoute.text).toBe("");

      const deniedMalformedBody = await request(baseUrl)
        .post("/not-a-route")
        .set("Host", "unauthorized.example.test")
        .set("Content-Type", "application/json")
        .send("{");
      expect(deniedMalformedBody.status).toBe(404);
      expect(deniedMalformedBody.text).toBe("");

      const authorizedMalformedBody = await request(baseUrl)
        .post("/not-a-route")
        .set("Host", expectedHost)
        .set("Content-Type", "application/json")
        .send("{");
      expect(authorizedMalformedBody.status).toBe(400);
    } finally {
      await application.close();
    }
  });

  it("never lets an untrusted X-Forwarded-Host replace or disagree with the authoritative Host", async () => {
    const { application, baseUrl } = await startListener();
    try {
      const forwardedHostCannotRescueInvalidHost = await request(baseUrl)
        .get("/health/live")
        .set("Host", "unauthorized.example.test")
        .set("X-Forwarded-Host", expectedHost);
      expect(forwardedHostCannotRescueInvalidHost.status).toBe(404);

      const conflictingForwardedHost = await request(baseUrl)
        .get("/health/live")
        .set("Host", expectedHost)
        .set("X-Forwarded-Host", "attacker.example.test");
      expect(conflictingForwardedHost.status).toBe(404);

      await request(baseUrl)
        .get("/health/live")
        .set("Host", expectedHost)
        .set("X-Forwarded-Host", expectedHost)
        .expect(200);
    } finally {
      await application.close();
    }
  });

  it("fails closed on missing, port-bearing and duplicate Host headers at the listener", async () => {
    const { application, port } = await startListener();
    try {
      const probes = [
        ["GET /health/live HTTP/1.1", "Connection: close", "", ""].join("\r\n"),
        [
          "GET /health/live HTTP/1.1",
          `Host: ${expectedHost}:3102`,
          "Connection: close",
          "",
          "",
        ].join("\r\n"),
        [
          "GET /health/live HTTP/1.1",
          `Host: ${expectedHost}`,
          `Host: ${expectedHost}`,
          "Connection: close",
          "",
          "",
        ].join("\r\n"),
      ];

      for (const probe of probes) {
        const response = await rawRequest(port, probe);
        expect([400, 404]).toContain(rawStatus(response));
        expect(response).not.toContain('"service":"portal-api"');
      }
    } finally {
      await application.close();
    }
  });

  it("rejects the wrong Host before the Portal realm can observe an auth request", async () => {
    const handle = vi.fn(async () => new Response("portal-auth", { status: 200 }));
    const { application, baseUrl } = await startListener({
      auth: authOptions(portalRealm(handle)),
    });
    try {
      const denied = await request(baseUrl)
        .get(`${PORTAL_AUTH_BASE_PATH}/get-session`)
        .set("Host", "attacker.example.test");
      expect(denied.status).toBe(404);
      expect(denied.text).toBe("");
      expect(handle).not.toHaveBeenCalled();

      const allowed = await request(baseUrl)
        .get(`${PORTAL_AUTH_BASE_PATH}/get-session`)
        .set("Host", expectedHost);
      expect(allowed.status).toBe(200);
      expect(allowed.text).toBe("portal-auth");
      expect(handle).toHaveBeenCalledTimes(1);
    } finally {
      await application.close();
    }
  });

  it("rejects a Portal auth configuration that is not bound to the API manifest host", async () => {
    await expect(
      createPortalApi({
        expectedHost,
        auth: {
          realm: portalRealm(),
          policy: {
            canonicalOrigin: "http://other.example.test",
            expectedHost: "other.example.test",
          },
        },
      }),
    ).rejects.toThrow("same canonical manifest host");
  });
});
