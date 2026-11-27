import { describe, expect, it, vi } from "vitest";
import {
  asOpaqueId,
  type StaffTripOperations,
  type StaffTripPreviewOperations,
} from "@travelos/backend-core";
import type { AuthSurfacePolicy } from "@travelos/auth-adapters";
import { registerAdminRoutes, type AdminExpressApplication } from "../src/admin-routes.js";

const policy: AuthSurfacePolicy = {
  canonicalOrigin: "https://admin.example.test",
  expectedHost: "admin.example.test",
};
const tripId = asOpaqueId("00000000-0000-7000-8000-000000000010");
const hash = "a".repeat(64);
const projection = {
  schemaVersion: 1 as const,
  trip: { title: "Portugal", startDate: "2026-10-12", endDate: "2026-10-15" },
  items: [],
};

const makeHarness = (previewOperations: StaffTripPreviewOperations) => {
  type Handler = Parameters<AdminExpressApplication["get"]>[1];
  const handlers = new Map<string, Handler>();
  const application: AdminExpressApplication = {
    get: (path, handler) => handlers.set(`GET ${path}`, handler),
    post: (path, handler) => handlers.set(`POST ${path}`, handler),
    patch: () => undefined,
  };
  registerAdminRoutes(application, {
    policy,
    tripOperations: {} as StaffTripOperations,
    previewOperations,
  });
  const invoke = async (
    key: string,
    body?: unknown,
    query: Readonly<Record<string, string | readonly string[] | undefined>> = {},
    headers: Record<string, string | string[] | undefined> = {
      host: "admin.example.test",
      origin: "https://admin.example.test",
      cookie: "session=opaque",
    },
  ) => {
    const handler = handlers.get(key);
    if (handler === undefined) throw new Error(`Missing handler ${key}`);
    const response = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      setHeader() {},
      end() {},
      json(value: unknown) {
        this.body = value;
      },
    };
    let nextError: unknown;
    handler(
      {
        method: key.split(" ")[0] ?? "GET",
        url: "/api/admin/trips/00000000-0000-7000-8000-000000000010",
        originalUrl: "/api/admin/trips/00000000-0000-7000-8000-000000000010",
        headers,
        body,
        params: { tripId },
        query,
      },
      response,
      (error: unknown) => {
        nextError = error;
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (nextError !== undefined) throw nextError;
    return response;
  };
  return { handlers, invoke };
};

describe("Admin preview route", () => {
  it("returns a strict preview and delegates with the Staff cookie", async () => {
    const previewTrip = vi.fn().mockResolvedValue({
      tripId,
      workspaceRevision: 7n,
      projectionHash: hash,
      schemaVersion: 1,
      projection,
      canonicalJson:
        '{"items":[],"schemaVersion":1,"trip":{"endDate":"2026-10-15","startDate":"2026-10-12","title":"Portugal"}}',
    });
    const harness = makeHarness({ previewTrip });
    const response = await harness.invoke("GET /api/admin/trips/:tripId/publication-preview");
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      workspaceRevision: "7",
      projectionHash: hash,
      schemaVersion: 1,
      projection,
    });
    expect(previewTrip).toHaveBeenCalledWith("session=opaque", tripId);
  });

  it("no longer exposes publish or publication-history routes", () => {
    const harness = makeHarness({ previewTrip: vi.fn() });
    expect([...harness.handlers.keys()].filter((key) => /publication/u.test(key))).toEqual([
      "GET /api/admin/trips/:tripId/publication-preview",
    ]);
  });
});
