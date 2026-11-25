import { describe, expect, it, vi } from "vitest";
import {
  asOpaqueId,
  StalePublicationCandidateError,
  type StaffTripOperations,
  type StaffTripPublicationOperations,
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

const makeHarness = (publicationOperations: StaffTripPublicationOperations) => {
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
    publicationOperations: publicationOperations,
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

describe("Admin Stage 6 publication routes", () => {
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
    const harness = makeHarness({
      previewTrip,
      publishTrip: vi.fn(),
      listPublicationHistory: vi.fn(),
      withdrawActivePublication: vi.fn(async () => undefined as never),
    });
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

  it("rejects unknown publication-history query parameters and validates the response", async () => {
    const listPublicationHistory = vi.fn().mockResolvedValue({
      entries: [
        {
          version: 2,
          publishedAt: "2026-10-12T12:00:00.000Z",
          actorReference: "00000000-0000-7000-8000-000000000099",
          schemaVersion: 1,
          projectionHash: hash,
          isActive: true,
        },
      ],
      nextCursor: null,
    });
    const harness = makeHarness({
      previewTrip: vi.fn(),
      publishTrip: vi.fn(),
      listPublicationHistory,
      withdrawActivePublication: vi.fn(async () => undefined as never),
    });
    const rejected = await harness.invoke("GET /api/admin/trips/:tripId/publications", undefined, {
      unknown: "value",
    });
    expect(rejected.statusCode).toBe(400);
    expect(listPublicationHistory).not.toHaveBeenCalled();

    const accepted = await harness.invoke("GET /api/admin/trips/:tripId/publications", undefined, {
      before: "3",
    });
    expect(accepted.statusCode).toBe(200);
    expect(listPublicationHistory).toHaveBeenCalledWith("session=opaque", tripId, "3");
    expect(accepted.body).toMatchObject({
      entries: [{ version: 2, isActive: true }],
      nextCursor: null,
    });
  });

  it("maps a stale publish candidate to the accepted HTTP 409 conflict", async () => {
    const publishTrip = vi.fn().mockRejectedValue(new StalePublicationCandidateError());
    const harness = makeHarness({
      previewTrip: vi.fn(),
      publishTrip,
      listPublicationHistory: vi.fn(),
      withdrawActivePublication: vi.fn(async () => undefined as never),
    });
    const response = await harness.invoke("POST /api/admin/trips/:tripId/publications", {
      expectedWorkspaceRevision: "7",
      expectedProjectionHash: hash,
      idempotencyKey: "key-1",
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ error: "STALE_PUBLICATION_CANDIDATE" });
    expect(publishTrip).toHaveBeenCalledWith("session=opaque", tripId, {
      expectedWorkspaceRevision: "7",
      expectedProjectionHash: hash,
      idempotencyKey: "key-1",
    });
  });
});
