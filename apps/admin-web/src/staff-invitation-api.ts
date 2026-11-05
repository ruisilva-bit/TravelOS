import {
  AdminOpaqueIdSchema,
  AdminStaffInvitationAcceptV1RequestSchema,
  AdminStaffInvitationIssueV1RequestSchema,
  AdminStaffInvitationListV1QuerySchema,
  AdminStaffInvitationListV1ResponseSchema,
  AdminStaffInvitationMetadataV1Schema,
  AdminStaffInvitationOneTimeV1ResponseSchema,
  type AdminStaffInvitationAcceptV1Request,
  type AdminStaffInvitationIssueV1Request,
  type AdminStaffInvitationListV1Response,
  type AdminStaffInvitationMetadataV1,
  type AdminStaffInvitationOneTimeV1Response,
} from "@travelos/contracts/admin";

import { AdminApiError } from "./api.js";

const errorCodeForStatus = (status: number): ConstructorParameters<typeof AdminApiError>[0] => {
  if (status === 401) return "AUTHENTICATION_REQUIRED";
  if (status === 403) return "ACCESS_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  return status >= 500 ? "UNAVAILABLE" : "INVALID_RESPONSE";
};

const getJson = async <T>(
  path: string,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch {
    throw new AdminApiError("NETWORK_FAILURE");
  }

  if (!response.ok) throw new AdminApiError(errorCodeForStatus(response.status), response.status);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AdminApiError("INVALID_RESPONSE", response.status);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new AdminApiError("INVALID_RESPONSE", response.status);
  return parsed.data;
};

type SafeParseSchema<T> = {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false };
};

const emptyBodySchema: SafeParseSchema<Record<string, never>> = {
  safeParse(value) {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 0
    ) {
      return { success: false };
    }
    return { success: true, data: {} };
  },
};

const postJson = async <TRequest, TResponse>(
  path: string,
  input: unknown,
  requestSchema: SafeParseSchema<TRequest>,
  responseSchema: SafeParseSchema<TResponse>,
  expectedStatus: number,
): Promise<TResponse> => {
  const request = requestSchema.safeParse(input);
  if (!request.success) throw new AdminApiError("INVALID_REQUEST");

  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(request.data),
    });
  } catch {
    throw new AdminApiError("NETWORK_FAILURE");
  }

  if (!response.ok) throw new AdminApiError(errorCodeForStatus(response.status), response.status);
  if (response.status !== expectedStatus) {
    throw new AdminApiError("INVALID_RESPONSE", response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AdminApiError("INVALID_RESPONSE", response.status);
  }

  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw new AdminApiError("INVALID_RESPONSE", response.status);
  return parsed.data;
};

const invitationPath = (invitationId: string, action: "reissue" | "revoke"): string => {
  const parsedId = AdminOpaqueIdSchema.safeParse(invitationId);
  if (!parsedId.success) throw new AdminApiError("INVALID_REQUEST");
  return `/api/admin/staff/invitations/${encodeURIComponent(parsedId.data)}/${action}`;
};

const postNoContent = async <TRequest>(
  path: string,
  input: unknown,
  requestSchema: SafeParseSchema<TRequest>,
): Promise<void> => {
  const request = requestSchema.safeParse(input);
  if (!request.success) throw new AdminApiError("INVALID_REQUEST");

  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(request.data),
    });
  } catch {
    throw new AdminApiError("NETWORK_FAILURE");
  }

  if (!response.ok) throw new AdminApiError(errorCodeForStatus(response.status), response.status);
  if (response.status !== 204) throw new AdminApiError("INVALID_RESPONSE", response.status);
};

export const listAdminStaffInvitations = (input: {
  readonly limit: number;
  readonly cursor: string | null;
}): Promise<AdminStaffInvitationListV1Response> => {
  const parsed = AdminStaffInvitationListV1QuerySchema.safeParse({
    limit: String(input.limit),
    cursor: input.cursor,
  });
  if (!parsed.success) return Promise.reject(new AdminApiError("INVALID_REQUEST"));

  const query = new URLSearchParams({ limit: String(parsed.data.limit) });
  if (parsed.data.cursor !== null) query.set("cursor", parsed.data.cursor);
  return getJson(
    `/api/admin/staff/invitations?${query.toString()}`,
    AdminStaffInvitationListV1ResponseSchema,
  );
};

export const issueAdminStaffInvitation = (
  input: AdminStaffInvitationIssueV1Request,
): Promise<AdminStaffInvitationOneTimeV1Response> =>
  postJson(
    "/api/admin/staff/invitations",
    input,
    AdminStaffInvitationIssueV1RequestSchema,
    AdminStaffInvitationOneTimeV1ResponseSchema,
    201,
  );

export const reissueAdminStaffInvitation = (
  invitationId: string,
): Promise<AdminStaffInvitationOneTimeV1Response> =>
  postJson(
    invitationPath(invitationId, "reissue"),
    {},
    emptyBodySchema,
    AdminStaffInvitationOneTimeV1ResponseSchema,
    200,
  );

export const revokeAdminStaffInvitation = (
  invitationId: string,
): Promise<AdminStaffInvitationMetadataV1> =>
  postJson(
    invitationPath(invitationId, "revoke"),
    {},
    emptyBodySchema,
    AdminStaffInvitationMetadataV1Schema,
    200,
  );

export const acceptAdminStaffInvitation = (
  input: AdminStaffInvitationAcceptV1Request,
): Promise<void> =>
  postNoContent("/api/staff/invitations/accept", input, AdminStaffInvitationAcceptV1RequestSchema);
