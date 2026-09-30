import { connect } from "node:net";

import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { STAFF_AUTH_BASE_PATH, type AuthRealm } from "@travelos/auth-adapters";

import { createAdminApi, type CreateAdminApiOptions } from "../src/app.js";

const expectedHost = "admin.example.test";
const canonicalOrigin = `http://${expectedHost}`;

type AdminApi = Awaited<ReturnType<typeof createAdminApi>>;

const startListener = async (
  options: Omit<CreateAdminApiOptions, "expectedHost"> = {},
): Promise<{ readonly application: AdminApi; readonly baseUrl: string; readonly port: number }> => {
  const application = await createAdminApi({ expectedHost, ...options });
  await application.listen(0, "127.0.0.1");
  const address = application.getHttpServer().address();
  if (address === null || typeof address === "string") {
    await application.close();
    throw new Error("Admin API test listener did not bind a TCP address");
  }
  return {
    application,
    baseUrl: `http://127.0.0.1:${address.port}`,
    port: address.port,
  };
};

const staffRealm = (
  handle = vi.fn(async () => new Response("staff-auth", { status: 200 })),
): AuthRealm => ({
  kind: "STAFF",
  basePath: STAFF_AUTH_BASE_PATH,
  cookieName: "travelos-dev-staff-session",
  secureTransportRequired: false,
  handle,
  async getServerSession() {
    return null;
  },
});

const authOptions = (realm: AuthRealm): NonNullable<CreateAdminApiOptions["auth"]> => ({
  realm,
  policy: { canonicalOrigin, expectedHost },
  staffAccessRepository: { getStaffAuthorizationSnapshot: vi.fn().mockResolvedValue(null) },
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

describe("Admin API global host and Staff auth routing boundary", () => {
  it("validates the configured Host before body parsing, health, API and unknown-route handling", async () => {
    const { application, baseUrl } = await startListener();
    try {
      await request(baseUrl).get("/health/live").set("Host", expectedHost).expect(200);
      await request(baseUrl).get("/not-a-route").set("Host", expectedHost).expect(404);

      const deniedHealth = await request(baseUrl)
        .get("/health/live")
        .set("Host", "unauthorized.example.test");
      expect(deniedHealth.status).toBe(404);
      expect(deniedHealth.text).toBe("");
      expect(deniedHealth.headers["cache-control"]).toContain("no-store");

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

      const deniedMalformedHealthBody = await request(baseUrl)
        .post("/health/live")
        .set("Host", "unauthorized.example.test")
        .set("Content-Type", "application/json")
        .send("{");
      expect(deniedMalformedHealthBody.status).toBe(404);
      expect(deniedMalformedHealthBody.text).toBe("");

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

  it("fails closed on missing, malformed, port-bearing and duplicate Host headers at the listener", async () => {
    const { application, port } = await startListener();
    try {
      const probes = [
        ["GET /health/live HTTP/1.1", "Connection: close", "", ""].join("\r\n"),
        [
          "GET /health/live HTTP/1.1",
          `Host: ${expectedHost}:3101`,
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
        expect(response).not.toContain('"service":"admin-api"');
      }
    } finally {
      await application.close();
    }
  });

  it("routes only canonical Staff auth paths and rejects lookalikes, Portal and path variants", async () => {
    const handle = vi.fn(async () => new Response("staff-auth", { status: 200 }));
    const realm = staffRealm(handle);
    const { application, baseUrl } = await startListener({ auth: authOptions(realm) });
    try {
      const valid = await request(baseUrl)
        .get(`${STAFF_AUTH_BASE_PATH}/get-session`)
        .set("Host", expectedHost)
        .set("X-Forwarded-Host", expectedHost)
        .expect(200);
      expect(valid.text).toBe("staff-auth");
      expect(handle).toHaveBeenCalledTimes(1);

      const validAdminApiHost = await request(baseUrl)
        .get("/api/staff/session-context")
        .set("Host", expectedHost);
      expect(validAdminApiHost.status).toBe(401);
      const unauthorizedAdminApiHost = await request(baseUrl)
        .get("/api/staff/session-context")
        .set("Host", "attacker.example.test");
      expect(unauthorizedAdminApiHost.status).toBe(404);

      const rejectedPaths = [
        "/api/auth/staffish/get-session",
        "/api/auth/staff-portal/get-session",
        "/api/auth/portal/get-session",
        `${STAFF_AUTH_BASE_PATH}/`,
        `${STAFF_AUTH_BASE_PATH}//get-session`,
        `${STAFF_AUTH_BASE_PATH}%2Fget-session`,
      ];
      for (const path of rejectedPaths) {
        const response = await request(baseUrl).get(path).set("Host", expectedHost);
        expect(response.status, path).toBe(404);
      }
      const traversalVariant = await rawRequest(
        Number(new URL(baseUrl).port),
        [
          `GET ${STAFF_AUTH_BASE_PATH}/../staff/get-session HTTP/1.1`,
          `Host: ${expectedHost}`,
          "Connection: close",
          "",
          "",
        ].join("\r\n"),
      );
      expect(rawStatus(traversalVariant)).toBe(404);
      expect(handle).toHaveBeenCalledTimes(1);
    } finally {
      await application.close();
    }
  });

  it("rejects authentication requests with an invalid Host before parsing their body or invoking Staff auth", async () => {
    const handle = vi.fn(async () => new Response("staff-auth", { status: 200 }));
    const { application, baseUrl } = await startListener({ auth: authOptions(staffRealm(handle)) });
    try {
      const response = await request(baseUrl)
        .post(`${STAFF_AUTH_BASE_PATH}/sign-in/email`)
        .set("Host", "attacker.example.test")
        .set("Content-Type", "application/json")
        .send("{");
      expect(response.status).toBe(404);
      expect(handle).not.toHaveBeenCalled();
    } finally {
      await application.close();
    }
  });
});
