import { describe, expect, it, vi } from "vitest";

import {
  asOpaqueId,
  StaffInvitationAcceptanceRejectedError,
  StaffInvitationAuthorizationError,
  StaffInvitationInvariantError,
  type StaffInvitationMetadata,
  type StaffInvitationOperations,
} from "@travelos/backend-core";
import type { AuthSurfacePolicy } from "@travelos/auth-adapters";

import { registerAdminStaffInvitationRoutes } from "../src/staff-invitation-routes.js";
import { createStaffInvitationRateLimiter } from "../src/staff-invitation-rate-limit.js";

type Handler = (
  request: RequestLike,
  response: ResponseLike,
  next: (error?: unknown) => void,
) => void;

type RequestLike = {
  readonly method: string;
  readonly url: string;
  readonly originalUrl?: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body?: unknown;
  readonly params?: Readonly<Record<string, string | undefined>>;
  readonly query?: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly rawHeaders?: readonly string[];
  readonly socket?: { readonly remoteAddress?: string };
};

type ResponseLike = {
  status(statusCode: number): ResponseLike;
  setHeader(name: string, value: string | readonly string[]): void;
  end(body?: Uint8Array): void;
  json(body: unknown): void;
};

class FakeExpress {
  readonly routes = new Map<string, Handler>();

  get(path: string, handler: Handler): void {
    this.routes.set(`GET ${path}`, handler);
  }

  post(path: string, handler: Handler): void {
    this.routes.set(`POST ${path}`, handler);
  }
}

const expectedHost = "admin.example.test";
const canonicalOrigin = `https://${expectedHost}`;
const policy: AuthSurfacePolicy = { canonicalOrigin, expectedHost };
const invitationId = asOpaqueId("00000000-0000-7000-8000-000000000041");
const agencyId = "00000000-0000-7000-8000-000000000042";
const targetEmail = "qa@example.test";
const issueToken = "a".repeat(43);
const acceptToken = "b".repeat(43);
const acceptedPassword = "synthetic-test-value-not-a-credential";
const verificationToken = "synthetic-verification-value-not-a-token";
const createdAtEpochMs = Date.UTC(2026, 0, 1, 12, 0, 0);
const expiresAtEpochMs = createdAtEpochMs + 60 * 60 * 1_000;
const WINDOW_MS = 15 * 60 * 1_000;

const pendingInvitation: StaffInvitationMetadata = {
  invitationId,
  targetEmail,
  status: "PENDING",
  createdAtEpochMs,
  expiresAtEpochMs,
  consumedAtEpochMs: null,
  revokedAtEpochMs: null,
};
const revokedInvitation: StaffInvitationMetadata = {
  ...pendingInvitation,
  status: "REVOKED",
  revokedAtEpochMs: createdAtEpochMs + 1_000,
};

const createOperations = () =>
  ({
    list: vi.fn(async () => ({ items: [pendingInvitation], nextCursor: null })),
    issue: vi.fn(async () => ({ invitation: pendingInvitation, token: issueToken })),
    reissue: vi.fn(async () => ({ invitation: pendingInvitation, token: issueToken })),
    revoke: vi.fn(async () => revokedInvitation),
    accept: vi.fn(async () => ({ accepted: true as const })),
  }) satisfies StaffInvitationOperations;

const createHarness = (
  operations = createOperations(),
  rateLimiter = createStaffInvitationRateLimiter(),
) => {
  const application = new FakeExpress();
  registerAdminStaffInvitationRoutes(application, { policy, operations, rateLimiter });
  return { application, operations, rateLimiter };
};

const requestFor = (
  method: string,
  url: string,
  input: {
    readonly body?: unknown;
    readonly headers?: Record<string, string | string[] | undefined>;
    readonly params?: Readonly<Record<string, string | undefined>>;
    readonly query?: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly remoteAddress?: string;
    readonly rawHeaders?: readonly string[];
  } = {},
): RequestLike => ({
  method,
  url,
  originalUrl: url,
  headers: {
    host: expectedHost,
    ...(method === "GET" ? {} : { origin: canonicalOrigin }),
    "x-forwarded-for": "198.51.100.61",
    ...(input.headers ?? {}),
  },
  ...(input.body === undefined ? {} : { body: input.body }),
  ...(input.params === undefined ? {} : { params: input.params }),
  ...(input.query === undefined ? {} : { query: input.query }),
  ...(input.rawHeaders === undefined ? {} : { rawHeaders: input.rawHeaders }),
  socket: { remoteAddress: input.remoteAddress ?? "127.0.0.1" },
});

const invoke = async (handler: Handler, request: RequestLike) =>
  new Promise<{
    readonly status: number | null;
    readonly body: unknown;
    readonly headers: Readonly<Record<string, string | readonly string[]>>;
    readonly next: boolean;
  }>((resolve, reject) => {
    let status: number | null = null;
    const headers: Record<string, string | readonly string[]> = {};
    const response: ResponseLike = {
      status(code) {
        status = code;
        return this;
      },
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      end(body) {
        resolve({ status, body, headers, next: false });
      },
      json(body) {
        resolve({ status: status ?? 200, body, headers, next: false });
      },
    };
    handler(request, response, (error) => {
      if (error !== undefined) reject(error);
      else resolve({ status, body: undefined, headers, next: true });
    });
  });

const metadataDto = {
  invitationId: invitationId.toString(),
  targetEmail,
  status: "PENDING",
  createdAt: new Date(createdAtEpochMs).toISOString(),
  expiresAt: new Date(expiresAtEpochMs).toISOString(),
  consumedAt: null,
  revokedAt: null,
};

const acceptedCookie = "travelos-dev-staff-session=synthetic-only";

describe("Admin Staff invitation routes", () => {
  it("registers only the five approved lifecycle endpoints", () => {
    const { application } = createHarness();
    expect([...application.routes.keys()].sort()).toEqual(
      [
        "GET /api/admin/staff/invitations",
        "POST /api/admin/staff/invitations",
        "POST /api/admin/staff/invitations/:invitationId/reissue",
        "POST /api/admin/staff/invitations/:invitationId/revoke",
        "POST /api/staff/invitations/accept",
      ].sort(),
    );
  });

  it("uses strict list query and explicit response allowlists", async () => {
    const { application, operations } = createHarness();
    const handler = application.routes.get("GET /api/admin/staff/invitations")!;
    const response = await invoke(
      handler,
      requestFor("GET", "/api/admin/staff/invitations", {
        headers: { cookie: acceptedCookie },
        query: { limit: "10", cursor: invitationId.toString() },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toEqual({ items: [metadataDto], nextCursor: null });
    expect(operations.list).toHaveBeenCalledWith(acceptedCookie, {
      limit: 10,
      cursor: invitationId,
    });
    expect(Object.keys((response.body as { items: unknown[] }).items[0] as object).sort()).toEqual(
      [
        "consumedAt",
        "createdAt",
        "expiresAt",
        "invitationId",
        "revokedAt",
        "status",
        "targetEmail",
      ].sort(),
    );

    const extraQuery = await invoke(
      handler,
      requestFor("GET", "/api/admin/staff/invitations", {
        headers: { cookie: acceptedCookie },
        query: { limit: "10", agencyId },
      }),
    );
    expect(extraQuery.status).toBe(400);
    expect(operations.list).toHaveBeenCalledOnce();
  });

  it("issues and reissues only the fixed role, with a one-time token response", async () => {
    const { application, operations } = createHarness();
    const issueHandler = application.routes.get("POST /api/admin/staff/invitations")!;
    const issueResponse = await invoke(
      issueHandler,
      requestFor("POST", "/api/admin/staff/invitations", {
        headers: { cookie: acceptedCookie },
        body: { targetEmail },
      }),
    );
    expect(issueResponse.status).toBe(201);
    expect(issueResponse.headers["cache-control"]).toBe("private, no-store");
    expect(issueResponse.body).toEqual({ invitation: metadataDto, token: issueToken });
    expect(operations.issue).toHaveBeenCalledWith(acceptedCookie, { targetEmail });

    const reissueHandler = application.routes.get(
      "POST /api/admin/staff/invitations/:invitationId/reissue",
    )!;
    const reissueResponse = await invoke(
      reissueHandler,
      requestFor("POST", `/api/admin/staff/invitations/${invitationId}/reissue`, {
        headers: { cookie: acceptedCookie },
        params: { invitationId: invitationId.toString() },
      }),
    );
    expect(reissueResponse.status).toBe(200);
    expect(reissueResponse.body).toEqual({ invitation: metadataDto, token: issueToken });
    expect(operations.reissue).toHaveBeenCalledWith(acceptedCookie, invitationId);

    const forbiddenInput = await invoke(
      issueHandler,
      requestFor("POST", "/api/admin/staff/invitations", {
        headers: { cookie: acceptedCookie },
        body: { targetEmail, agencyId, roleTemplateKey: "owner" },
      }),
    );
    expect(forbiddenInput.status).toBe(400);
    expect(operations.issue).toHaveBeenCalledOnce();
  });

  it("rejects caller-supplied actor, Agency, or role data on revoke and reissue", async () => {
    const { application, operations } = createHarness();
    const revokeHandler = application.routes.get(
      "POST /api/admin/staff/invitations/:invitationId/revoke",
    )!;
    const response = await invoke(
      revokeHandler,
      requestFor("POST", `/api/admin/staff/invitations/${invitationId}/revoke`, {
        headers: { cookie: acceptedCookie },
        params: { invitationId: invitationId.toString() },
        body: { agencyId, actorStaffPrincipalId: "owner", roleTemplateKey: "owner" },
      }),
    );
    expect(response.status).toBe(400);
    expect(operations.revoke).not.toHaveBeenCalled();
  });

  it("maps authorization and cross-Agency denials without revealing invitation state", async () => {
    const operations = createOperations();
    operations.list.mockRejectedValueOnce(new StaffInvitationAuthorizationError("UNAUTHENTICATED"));
    operations.issue.mockRejectedValueOnce(new StaffInvitationAuthorizationError("FORBIDDEN"));
    operations.revoke.mockRejectedValueOnce(new StaffInvitationInvariantError());
    const { application } = createHarness(operations);

    const listResponse = await invoke(
      application.routes.get("GET /api/admin/staff/invitations")!,
      requestFor("GET", "/api/admin/staff/invitations"),
    );
    expect(listResponse.status).toBe(401);
    expect(listResponse.headers["cache-control"]).toBe("private, no-store");

    const issueResponse = await invoke(
      application.routes.get("POST /api/admin/staff/invitations")!,
      requestFor("POST", "/api/admin/staff/invitations", { body: { targetEmail } }),
    );
    expect(issueResponse.status).toBe(403);
    expect(issueResponse.headers["cache-control"]).toBe("private, no-store");

    const revokeResponse = await invoke(
      application.routes.get("POST /api/admin/staff/invitations/:invitationId/revoke")!,
      requestFor("POST", `/api/admin/staff/invitations/${invitationId}/revoke`, {
        params: { invitationId: invitationId.toString() },
      }),
    );
    expect(revokeResponse.status).toBe(404);
    expect(revokeResponse.body).toBeUndefined();
  });

  it("rejects wrong Host, Origin and bearer auth before any operation", async () => {
    const { application, operations } = createHarness();
    const issueHandler = application.routes.get("POST /api/admin/staff/invitations")!;
    const wrongHost = await invoke(
      issueHandler,
      requestFor("POST", "/api/admin/staff/invitations", {
        headers: { host: "attacker.example.test" },
        body: "malformed",
      }),
    );
    expect(wrongHost.status).toBe(404);
    expect(wrongHost.headers["cache-control"]).toBe("private, no-store");

    const wrongOrigin = await invoke(
      issueHandler,
      requestFor("POST", "/api/admin/staff/invitations", {
        headers: { origin: "https://attacker.example.test" },
        body: "malformed",
      }),
    );
    expect(wrongOrigin.status).toBe(403);

    const bearerAuth = await invoke(
      application.routes.get("GET /api/admin/staff/invitations")!,
      requestFor("GET", "/api/admin/staff/invitations", {
        headers: { authorization: "Bearer synthetic-not-a-token" },
      }),
    );
    expect(bearerAuth.status).toBe(403);
    expect(operations.list).not.toHaveBeenCalled();
    expect(operations.issue).not.toHaveBeenCalled();
  });

  it("accepts with no session and never reflects token, password, or verification evidence", async () => {
    const { application, operations } = createHarness();
    const acceptHandler = application.routes.get("POST /api/staff/invitations/accept")!;
    const response = await invoke(
      acceptHandler,
      requestFor("POST", "/api/staff/invitations/accept", {
        headers: { cookie: acceptedCookie },
        body: { token: acceptToken, name: "QA Staff", password: acceptedPassword },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toBeUndefined();
    expect(operations.accept).toHaveBeenCalledWith({
      token: acceptToken,
      name: "QA Staff",
      password: acceptedPassword,
    });
    expect(operations.accept).not.toHaveBeenCalledWith(
      expect.objectContaining({ cookie: acceptedCookie }),
    );
    const responseBody = JSON.stringify(response.body ?? null);
    expect(responseBody).not.toContain(verificationToken);
  });

  it("rejects strict acceptance bodies and returns identical 404 for duplicate tokens", async () => {
    const operations = createOperations();
    operations.accept.mockRejectedValueOnce(new StaffInvitationAcceptanceRejectedError());
    const { application } = createHarness(operations);
    const acceptHandler = application.routes.get("POST /api/staff/invitations/accept")!;

    const strictBody = await invoke(
      acceptHandler,
      requestFor("POST", "/api/staff/invitations/accept", {
        body: { token: acceptToken, name: "QA Staff", password: acceptedPassword, agencyId },
      }),
    );
    expect(strictBody.status).toBe(400);
    expect(operations.accept).not.toHaveBeenCalled();

    const rejected = await invoke(
      acceptHandler,
      requestFor("POST", "/api/staff/invitations/accept", {
        body: { token: acceptToken, name: "QA Staff", password: acceptedPassword },
      }),
    );
    expect(rejected.status).toBe(404);
    expect(rejected.body).toBeUndefined();
    const responseBody = JSON.stringify(rejected.body ?? null);
    for (const value of [acceptToken, acceptedPassword, verificationToken]) {
      expect(responseBody).not.toContain(value);
    }
  });

  it("counts failed acceptance attempts, blocks at the limit, and releases successful reservations", async () => {
    let nowEpochMs = createdAtEpochMs;
    const limiter = createStaffInvitationRateLimiter({
      nowEpochMs: () => nowEpochMs,
      maxAttempts: 1,
      maxTrackedKeys: 10,
    });
    const operations = createOperations();
    operations.accept.mockRejectedValueOnce(new StaffInvitationAcceptanceRejectedError());
    const { application } = createHarness(operations, limiter);
    const acceptHandler = application.routes.get("POST /api/staff/invitations/accept")!;
    const body = { token: acceptToken, name: "QA Staff", password: acceptedPassword };

    const first = await invoke(
      acceptHandler,
      requestFor("POST", "/api/staff/invitations/accept", { body }),
    );
    expect(first.status).toBe(404);
    const limited = await invoke(
      acceptHandler,
      requestFor("POST", "/api/staff/invitations/accept", { body }),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers["cache-control"]).toBe("private, no-store");
    expect(operations.accept).toHaveBeenCalledOnce();

    nowEpochMs += WINDOW_MS;
    const accepted = await invoke(
      acceptHandler,
      requestFor("POST", "/api/staff/invitations/accept", { body }),
    );
    expect(accepted.status).toBe(204);
    expect(operations.accept).toHaveBeenCalledTimes(2);
  });

  it("returns a generic failure without forwarding or logging secret-bearing errors", async () => {
    const operations = createOperations();
    operations.accept.mockRejectedValueOnce(
      new Error(`${acceptToken} ${acceptedPassword} ${verificationToken}`),
    );
    const { application } = createHarness(operations);
    const next = vi.fn();
    const handler = application.routes.get("POST /api/staff/invitations/accept")!;
    let responseBody: unknown;
    let responseStatus: number | null = null;
    const headers: Record<string, string | readonly string[]> = {};
    const response: ResponseLike = {
      status(statusCode) {
        responseStatus = statusCode;
        return this;
      },
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      end(body) {
        responseBody = body;
      },
      json(body) {
        responseBody = body;
      },
    };
    handler(
      requestFor("POST", "/api/staff/invitations/accept", {
        body: { token: acceptToken, name: "QA Staff", password: acceptedPassword },
      }),
      response,
      next,
    );
    await vi.waitFor(() => expect(responseStatus).toBe(500));
    expect(headers["cache-control"]).toBe("private, no-store");
    expect(next).not.toHaveBeenCalled();
    const serializedBody = JSON.stringify(responseBody ?? null);
    for (const value of [acceptToken, acceptedPassword, verificationToken]) {
      expect(serializedBody).not.toContain(value);
    }
  });
});
