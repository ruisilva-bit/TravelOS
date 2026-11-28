import {
  ADMIN_IDEMPOTENCY_KEY_HEADER,
  AdminAgencyProfileV1ResponseSchema,
  AdminAgencyProfileV1UpdateRequestSchema,
  AdminIdempotencyKeySchema,
  AdminCustomerCreateV1RequestSchema,
  AdminCustomerDetailV1ResponseSchema,
  AdminCustomerListV1QuerySchema,
  AdminCustomerListV1ResponseSchema,
  AdminCustomerRolesV1RequestSchema,
  AdminCustomerUpdateV1RequestSchema,
  AdminPersonCreateV1RequestSchema,
  AdminPersonUpdateV1RequestSchema,
  AdminPersonV1ResponseSchema,
  AdminSearchV1QuerySchema,
  AdminSearchV1ResponseSchema,
  AdminLeadCreateV1RequestSchema,
  AdminLeadDisqualifyV1RequestSchema,
  AdminLeadListV1QuerySchema,
  AdminLeadListV1ResponseSchema,
  AdminLeadQualifyV1RequestSchema,
  AdminLeadUpdateV1RequestSchema,
  AdminLeadV1ResponseSchema,
  AdminCreateShareLinkV1RequestSchema,
  AdminShareLinkCreatedV1ResponseSchema,
  AdminShareLinkListV1ResponseSchema,
  AdminShareLinkRevokedV1ResponseSchema,
  AdminTripPublicationPreviewV1Schema,
  AdminOpaqueIdSchema,
  AdminStaffSessionContextSchema,
  AdminTripWorkspaceAccommodationCreateV1RequestSchema,
  AdminTripWorkspaceAccommodationUpdateV1RequestSchema,
  AdminTripWorkspaceCreateV1RequestSchema,
  AdminTripWorkspaceFlightCreateV1RequestSchema,
  AdminTripWorkspaceFlightUpdateV1RequestSchema,
  AdminTripWorkspaceListV1QuerySchema,
  AdminTripWorkspaceListV1ResponseSchema,
  AdminTripWorkspaceTripUpdateV1RequestSchema,
  AdminTripWorkspaceV1ResponseSchema,
  type AdminCustomerCreateV1Request,
  type AdminCustomerDetailV1Response,
  type AdminCustomerListV1Response,
  type AdminCustomerRolesV1Request,
  type AdminAgencyProfileV1Response,
  type AdminAgencyProfileV1UpdateRequest,
  type AdminCustomerUpdateV1Request,
  type AdminPersonCreateV1Request,
  type AdminPersonUpdateV1Request,
  type AdminPersonV1Response,
  type AdminSearchV1Response,
  type AdminLeadCreateV1Request,
  type AdminLeadDisqualifyV1Request,
  type AdminLeadListV1Response,
  type AdminLeadQualifyV1Request,
  type AdminLeadUpdateV1Request,
  type AdminLeadV1Response,
  type AdminCreateShareLinkV1Request,
  type AdminShareLinkCreatedV1Response,
  type AdminShareLinkListV1Response,
  type AdminStaffSessionContext,
  type AdminTripPublicationPreviewV1,
  type AdminTripWorkspaceAccommodationCreateV1Request,
  type AdminTripWorkspaceAccommodationUpdateV1Request,
  type AdminTripWorkspaceCreateV1Request,
  type AdminTripWorkspaceFlightCreateV1Request,
  type AdminTripWorkspaceFlightUpdateV1Request,
  type AdminTripWorkspaceListV1Response,
  type AdminTripWorkspaceTripUpdateV1Request,
  type AdminTripWorkspaceV1Response,
  AdminQuoteAddLineV1RequestSchema,
  AdminQuoteApplyMarginV1RequestSchema,
  AdminQuoteConvertedV1ResponseSchema,
  AdminQuoteCreateV1RequestSchema,
  AdminQuoteDayV1RequestSchema,
  AdminQuoteDetailV1ResponseSchema,
  AdminQuoteExpectedVersionV1RequestSchema,
  AdminQuoteHeaderPatchV1RequestSchema,
  AdminQuoteListV1ResponseSchema,
  AdminQuoteReorderV1RequestSchema,
  AdminQuoteRevokedV1ResponseSchema,
  AdminQuoteSendV1RequestSchema,
  AdminQuoteSentV1ResponseSchema,
  AdminQuoteUpdateLineV1RequestSchema,
  AdminQuoteV1ResponseSchema,
  AdminLeadQuotesV1ResponseSchema,
  type AdminQuoteAddLineV1Request,
  type AdminQuoteApplyMarginV1Request,
  type AdminQuoteCreateV1Request,
  type AdminQuoteDayV1Request,
  type AdminQuoteExpectedVersionV1Request,
  type AdminQuoteHeaderPatchV1Request,
  type AdminQuoteListV1Response,
  type AdminQuoteReorderV1Request,
  type AdminQuoteSendV1Request,
  type AdminQuoteSentV1Response,
  type AdminQuoteUpdateLineV1Request,
  type AdminQuoteV1Response,
  type AdminQuoteDetailV1Response,
} from "@travelos/contracts/admin";

export type AdminApiErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "ACCESS_DENIED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAVAILABLE"
  | "NETWORK_FAILURE"
  | "INVALID_RESPONSE"
  | "INVALID_REQUEST";

const messages: Record<AdminApiErrorCode, string> = {
  AUTHENTICATION_REQUIRED: "A sessão de equipa terminou. Inicie sessão novamente.",
  ACCESS_DENIED: "Acesso não autorizado.",
  NOT_FOUND: "A viagem não está disponível.",
  CONFLICT: "Os dados foram alterados. Atualize a página antes de continuar.",
  UNAVAILABLE: "O serviço está temporariamente indisponível.",
  NETWORK_FAILURE: "Não foi possível contactar o serviço.",
  INVALID_RESPONSE: "Não foi possível validar os dados recebidos.",
  INVALID_REQUEST: "O pedido não é válido.",
};

export class AdminApiError extends Error {
  readonly code: AdminApiErrorCode;
  readonly status: number | null;

  constructor(code: AdminApiErrorCode, status: number | null = null) {
    super(messages[code]);
    this.name = "AdminApiError";
    this.code = code;
    this.status = status;
  }
}

const errorCodeForStatus = (status: number): AdminApiErrorCode => {
  if (status === 401) return "AUTHENTICATION_REQUIRED";
  if (status === 403) return "ACCESS_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  return status >= 500 ? "UNAVAILABLE" : "INVALID_RESPONSE";
};

const getJson = async <T>(
  path: string,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  method: "GET" | "DELETE" = "GET",
): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
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

const sendJson = async <TRequest, TResponse>(
  path: string,
  method: "POST" | "PATCH" | "PUT",
  input: unknown,
  requestSchema: SafeParseSchema<TRequest>,
  responseSchema: SafeParseSchema<TResponse>,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<TResponse> => {
  const request = requestSchema.safeParse(input);
  if (!request.success) throw new AdminApiError("INVALID_REQUEST");

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(request.data),
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

  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw new AdminApiError("INVALID_RESPONSE", response.status);
  return parsed.data;
};

const tripResourcePath = (tripId: string, resource: string): string => {
  const parsedId = AdminOpaqueIdSchema.safeParse(tripId);
  if (!parsedId.success) throw new AdminApiError("INVALID_REQUEST");
  return `/api/admin/trips/${encodeURIComponent(parsedId.data)}/${resource}`;
};

export const getAdminSessionContext = (): Promise<AdminStaffSessionContext> =>
  getJson("/api/staff/session-context", AdminStaffSessionContextSchema);

export const listAdminTrips = (input: {
  readonly limit: number;
  readonly cursor: string | null;
}): Promise<AdminTripWorkspaceListV1Response> => {
  const parsed = AdminTripWorkspaceListV1QuerySchema.safeParse({
    limit: String(input.limit),
    cursor: input.cursor,
  });
  if (!parsed.success) return Promise.reject(new AdminApiError("INVALID_REQUEST"));

  const query = new URLSearchParams({ limit: String(parsed.data.limit) });
  if (parsed.data.cursor !== null) query.set("cursor", parsed.data.cursor);
  return getJson(`/api/admin/trips?${query.toString()}`, AdminTripWorkspaceListV1ResponseSchema);
};

export const getAdminTripWorkspace = (tripId: string): Promise<AdminTripWorkspaceV1Response> => {
  const parsedId = AdminOpaqueIdSchema.safeParse(tripId);
  if (!parsedId.success) return Promise.reject(new AdminApiError("INVALID_REQUEST"));
  return getJson(
    `/api/admin/trips/${encodeURIComponent(parsedId.data)}/workspace`,
    AdminTripWorkspaceV1ResponseSchema,
  );
};

export const createAdminTripWorkspace = (
  input: AdminTripWorkspaceCreateV1Request,
): Promise<AdminTripWorkspaceV1Response> =>
  sendJson(
    "/api/admin/trips/workspace",
    "POST",
    input,
    AdminTripWorkspaceCreateV1RequestSchema,
    AdminTripWorkspaceV1ResponseSchema,
  );

export const updateAdminTripWorkspace = (
  tripId: string,
  input: AdminTripWorkspaceTripUpdateV1Request,
): Promise<AdminTripWorkspaceV1Response> =>
  sendJson(
    tripResourcePath(tripId, "workspace"),
    "PATCH",
    input,
    AdminTripWorkspaceTripUpdateV1RequestSchema,
    AdminTripWorkspaceV1ResponseSchema,
  );

export const createAdminFlight = (
  tripId: string,
  input: AdminTripWorkspaceFlightCreateV1Request,
): Promise<AdminTripWorkspaceV1Response> =>
  sendJson(
    tripResourcePath(tripId, "workspace/flights"),
    "POST",
    input,
    AdminTripWorkspaceFlightCreateV1RequestSchema,
    AdminTripWorkspaceV1ResponseSchema,
  );

export const updateAdminFlight = (
  tripId: string,
  flightId: string,
  input: AdminTripWorkspaceFlightUpdateV1Request,
): Promise<AdminTripWorkspaceV1Response> => {
  const parsedFlightId = AdminOpaqueIdSchema.safeParse(flightId);
  if (!parsedFlightId.success) return Promise.reject(new AdminApiError("INVALID_REQUEST"));
  return sendJson(
    tripResourcePath(tripId, `workspace/flights/${encodeURIComponent(parsedFlightId.data)}`),
    "PATCH",
    input,
    AdminTripWorkspaceFlightUpdateV1RequestSchema,
    AdminTripWorkspaceV1ResponseSchema,
  );
};

export const createAdminAccommodation = (
  tripId: string,
  input: AdminTripWorkspaceAccommodationCreateV1Request,
): Promise<AdminTripWorkspaceV1Response> =>
  sendJson(
    tripResourcePath(tripId, "workspace/accommodations"),
    "POST",
    input,
    AdminTripWorkspaceAccommodationCreateV1RequestSchema,
    AdminTripWorkspaceV1ResponseSchema,
  );

export const updateAdminAccommodation = (
  tripId: string,
  accommodationId: string,
  input: AdminTripWorkspaceAccommodationUpdateV1Request,
): Promise<AdminTripWorkspaceV1Response> => {
  const parsedAccommodationId = AdminOpaqueIdSchema.safeParse(accommodationId);
  if (!parsedAccommodationId.success) return Promise.reject(new AdminApiError("INVALID_REQUEST"));
  return sendJson(
    tripResourcePath(
      tripId,
      `workspace/accommodations/${encodeURIComponent(parsedAccommodationId.data)}`,
    ),
    "PATCH",
    input,
    AdminTripWorkspaceAccommodationUpdateV1RequestSchema,
    AdminTripWorkspaceV1ResponseSchema,
  );
};

export const getAdminPublicationPreview = (
  tripId: string,
): Promise<AdminTripPublicationPreviewV1> =>
  getJson(tripResourcePath(tripId, "publication-preview"), AdminTripPublicationPreviewV1Schema);

export const createAdminShareLink = (
  tripId: string,
  input: AdminCreateShareLinkV1Request,
  idempotencyKey: string,
): Promise<AdminShareLinkCreatedV1Response> => {
  try {
    return sendJson(
      tripResourcePath(tripId, "share-links"),
      "POST",
      input,
      AdminCreateShareLinkV1RequestSchema,
      AdminShareLinkCreatedV1ResponseSchema,
      idempotencyHeaders(idempotencyKey),
    );
  } catch (error) {
    return Promise.reject(error);
  }
};

export const listAdminShareLinks = (tripId: string): Promise<AdminShareLinkListV1Response> => {
  try {
    return getJson(tripResourcePath(tripId, "share-links"), AdminShareLinkListV1ResponseSchema);
  } catch (error) {
    return Promise.reject(error);
  }
};

export const revokeAdminShareLink = async (shareLinkId: string): Promise<void> => {
  const parsedId = AdminOpaqueIdSchema.safeParse(shareLinkId);
  if (!parsedId.success) throw new AdminApiError("INVALID_REQUEST");
  await sendJson(
    `/api/admin/share-links/${encodeURIComponent(parsedId.data)}/revoke`,
    "POST",
    {},
    AdminCreateShareLinkV1RequestSchema,
    AdminShareLinkRevokedV1ResponseSchema,
  );
};

const leadResourcePath = (leadId: string, resource = ""): string => {
  const parsedId = AdminOpaqueIdSchema.safeParse(leadId);
  if (!parsedId.success) throw new AdminApiError("INVALID_REQUEST");
  return `/api/admin/leads/${encodeURIComponent(parsedId.data)}${resource}`;
};

const idempotencyHeaders = (idempotencyKey: string): Readonly<Record<string, string>> => {
  const parsed = AdminIdempotencyKeySchema.safeParse(idempotencyKey);
  if (!parsed.success) throw new AdminApiError("INVALID_REQUEST");
  return { [ADMIN_IDEMPOTENCY_KEY_HEADER]: parsed.data };
};

export const listAdminLeads = (input: {
  readonly limit: number;
  readonly cursor: string | null;
  readonly state: AdminLeadV1Response["state"] | null;
}): Promise<AdminLeadListV1Response> => {
  const parsed = AdminLeadListV1QuerySchema.safeParse({
    limit: String(input.limit),
    cursor: input.cursor,
    state: input.state,
  });
  if (!parsed.success) return Promise.reject(new AdminApiError("INVALID_REQUEST"));
  const query = new URLSearchParams({ limit: String(parsed.data.limit) });
  if (parsed.data.cursor !== null) query.set("cursor", parsed.data.cursor);
  if (parsed.data.state !== null) query.set("state", parsed.data.state);
  return getJson(`/api/admin/leads?${query.toString()}`, AdminLeadListV1ResponseSchema);
};

export const getAdminLead = (leadId: string): Promise<AdminLeadV1Response> => {
  try {
    return getJson(leadResourcePath(leadId), AdminLeadV1ResponseSchema);
  } catch (error) {
    return Promise.reject(error);
  }
};

export const createAdminLead = (
  input: AdminLeadCreateV1Request,
  idempotencyKey: string,
): Promise<AdminLeadV1Response> => {
  try {
    return sendJson(
      "/api/admin/leads",
      "POST",
      input,
      AdminLeadCreateV1RequestSchema,
      AdminLeadV1ResponseSchema,
      idempotencyHeaders(idempotencyKey),
    );
  } catch (error) {
    return Promise.reject(error);
  }
};

export const updateAdminLead = (
  leadId: string,
  input: AdminLeadUpdateV1Request,
): Promise<AdminLeadV1Response> => {
  try {
    return sendJson(
      leadResourcePath(leadId),
      "PATCH",
      input,
      AdminLeadUpdateV1RequestSchema,
      AdminLeadV1ResponseSchema,
    );
  } catch (error) {
    return Promise.reject(error);
  }
};

export const qualifyAdminLead = (
  leadId: string,
  input: AdminLeadQualifyV1Request,
  idempotencyKey: string,
): Promise<AdminLeadV1Response> => {
  try {
    return sendJson(
      leadResourcePath(leadId, "/qualification"),
      "POST",
      input,
      AdminLeadQualifyV1RequestSchema,
      AdminLeadV1ResponseSchema,
      idempotencyHeaders(idempotencyKey),
    );
  } catch (error) {
    return Promise.reject(error);
  }
};

export const disqualifyAdminLead = (
  leadId: string,
  input: AdminLeadDisqualifyV1Request,
  idempotencyKey: string,
): Promise<AdminLeadV1Response> => {
  try {
    return sendJson(
      leadResourcePath(leadId, "/disqualification"),
      "POST",
      input,
      AdminLeadDisqualifyV1RequestSchema,
      AdminLeadV1ResponseSchema,
      idempotencyHeaders(idempotencyKey),
    );
  } catch (error) {
    return Promise.reject(error);
  }
};

const customerResourcePath = (customerId: string, resource = ""): string => {
  const parsedId = AdminOpaqueIdSchema.safeParse(customerId);
  if (!parsedId.success) throw new AdminApiError("INVALID_REQUEST");
  return `/api/admin/customers/${encodeURIComponent(parsedId.data)}${resource}`;
};

const personResourcePath = (personId: string): string => {
  const parsedId = AdminOpaqueIdSchema.safeParse(personId);
  if (!parsedId.success) throw new AdminApiError("INVALID_REQUEST");
  return `/api/admin/persons/${encodeURIComponent(parsedId.data)}`;
};

export const listAdminCustomers = (input: {
  readonly limit: number;
  readonly cursor: string | null;
  readonly q: string | null;
}): Promise<AdminCustomerListV1Response> => {
  const parsed = AdminCustomerListV1QuerySchema.safeParse({
    limit: String(input.limit),
    cursor: input.cursor,
    q: input.q,
  });
  if (!parsed.success) return Promise.reject(new AdminApiError("INVALID_REQUEST"));
  const query = new URLSearchParams({ limit: String(parsed.data.limit) });
  if (parsed.data.cursor !== null) query.set("cursor", parsed.data.cursor);
  if (parsed.data.q !== null) query.set("q", parsed.data.q);
  return getJson(`/api/admin/customers?${query.toString()}`, AdminCustomerListV1ResponseSchema);
};

export const getAdminCustomer = (customerId: string): Promise<AdminCustomerDetailV1Response> => {
  try {
    return getJson(customerResourcePath(customerId), AdminCustomerDetailV1ResponseSchema);
  } catch (error) {
    return Promise.reject(error);
  }
};

export const createAdminCustomer = (
  input: AdminCustomerCreateV1Request,
  idempotencyKey: string,
): Promise<AdminCustomerDetailV1Response> => {
  try {
    return sendJson(
      "/api/admin/customers",
      "POST",
      input,
      AdminCustomerCreateV1RequestSchema,
      AdminCustomerDetailV1ResponseSchema,
      idempotencyHeaders(idempotencyKey),
    );
  } catch (error) {
    return Promise.reject(error);
  }
};

export const updateAdminCustomer = (
  customerId: string,
  input: AdminCustomerUpdateV1Request,
): Promise<AdminCustomerDetailV1Response> => {
  try {
    return sendJson(
      customerResourcePath(customerId),
      "PATCH",
      input,
      AdminCustomerUpdateV1RequestSchema,
      AdminCustomerDetailV1ResponseSchema,
    );
  } catch (error) {
    return Promise.reject(error);
  }
};

export const getAdminAgencyProfile = (): Promise<AdminAgencyProfileV1Response> =>
  getJson("/api/admin/agency/profile", AdminAgencyProfileV1ResponseSchema);

export const updateAdminAgencyProfile = (
  input: AdminAgencyProfileV1UpdateRequest,
): Promise<AdminAgencyProfileV1Response> =>
  sendJson(
    "/api/admin/agency/profile",
    "PATCH",
    input,
    AdminAgencyProfileV1UpdateRequestSchema,
    AdminAgencyProfileV1ResponseSchema,
  );

export const addAdminPerson = (
  customerId: string,
  input: AdminPersonCreateV1Request,
): Promise<AdminCustomerDetailV1Response> => {
  try {
    return sendJson(
      customerResourcePath(customerId, "/persons"),
      "POST",
      input,
      AdminPersonCreateV1RequestSchema,
      AdminCustomerDetailV1ResponseSchema,
    );
  } catch (error) {
    return Promise.reject(error);
  }
};

export const updateAdminPerson = (
  personId: string,
  input: AdminPersonUpdateV1Request,
): Promise<AdminPersonV1Response> => {
  try {
    return sendJson(
      personResourcePath(personId),
      "PATCH",
      input,
      AdminPersonUpdateV1RequestSchema,
      AdminPersonV1ResponseSchema,
    );
  } catch (error) {
    return Promise.reject(error);
  }
};

export const setAdminPersonRoles = (
  customerId: string,
  personId: string,
  input: AdminCustomerRolesV1Request,
): Promise<AdminCustomerDetailV1Response> => {
  try {
    const parsedPersonId = AdminOpaqueIdSchema.safeParse(personId);
    if (!parsedPersonId.success) throw new AdminApiError("INVALID_REQUEST");
    return sendJson(
      customerResourcePath(customerId, `/persons/${encodeURIComponent(parsedPersonId.data)}/roles`),
      "PUT",
      input,
      AdminCustomerRolesV1RequestSchema,
      AdminCustomerDetailV1ResponseSchema,
    );
  } catch (error) {
    return Promise.reject(error);
  }
};

export const searchAdmin = (q: string): Promise<AdminSearchV1Response> => {
  const parsed = AdminSearchV1QuerySchema.safeParse({ q });
  if (!parsed.success) return Promise.reject(new AdminApiError("INVALID_REQUEST"));
  return getJson(
    `/api/admin/search?${new URLSearchParams({ q: parsed.data.q }).toString()}`,
    AdminSearchV1ResponseSchema,
  );
};

const quoteIdPath = (quoteId: string, resource = ""): string => {
  const parsedId = AdminOpaqueIdSchema.safeParse(quoteId);
  if (!parsedId.success) throw new AdminApiError("INVALID_REQUEST");
  return `/api/admin/quotes/${encodeURIComponent(parsedId.data)}${resource}`;
};

const quoteEntityPath = (kind: "quote-lines" | "quote-share-links", id: string, resource = "") => {
  const parsedId = AdminOpaqueIdSchema.safeParse(id);
  if (!parsedId.success) throw new AdminApiError("INVALID_REQUEST");
  return `/api/admin/${kind}/${encodeURIComponent(parsedId.data)}${resource}`;
};

/** Requests without a body; the empty object is accepted as-is. */
const noBody = { safeParse: (value: unknown) => ({ success: true as const, data: value }) };

export const listAdminQuotes = (input: {
  readonly state?: string;
  readonly customerId?: string;
  readonly leadId?: string;
  readonly q?: string;
  readonly cursor?: string;
  readonly limit?: number;
}): Promise<AdminQuoteListV1Response> => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return getJson(`/api/admin/quotes?${query.toString()}`, AdminQuoteListV1ResponseSchema);
};

export const getAdminQuote = (quoteId: string): Promise<AdminQuoteDetailV1Response> =>
  getJson(quoteIdPath(quoteId), AdminQuoteDetailV1ResponseSchema);

export const createAdminQuote = (input: AdminQuoteCreateV1Request): Promise<AdminQuoteV1Response> =>
  sendJson(
    "/api/admin/quotes",
    "POST",
    input,
    AdminQuoteCreateV1RequestSchema,
    AdminQuoteV1ResponseSchema,
  );

export const updateAdminQuote = (
  quoteId: string,
  input: AdminQuoteHeaderPatchV1Request,
): Promise<AdminQuoteDetailV1Response> =>
  sendJson(
    quoteIdPath(quoteId),
    "PATCH",
    input,
    AdminQuoteHeaderPatchV1RequestSchema,
    AdminQuoteDetailV1ResponseSchema,
  );

export const addAdminQuoteLine = (
  quoteId: string,
  input: AdminQuoteAddLineV1Request,
): Promise<AdminQuoteDetailV1Response> =>
  sendJson(
    quoteIdPath(quoteId, "/lines"),
    "POST",
    input,
    AdminQuoteAddLineV1RequestSchema,
    AdminQuoteDetailV1ResponseSchema,
  );

export const updateAdminQuoteLine = (
  quoteId: string,
  lineId: string,
  input: AdminQuoteUpdateLineV1Request,
): Promise<AdminQuoteDetailV1Response> =>
  sendJson(
    `${quoteIdPath(quoteId, "/lines/")}${encodeURIComponent(AdminOpaqueIdSchema.parse(lineId))}`,
    "PATCH",
    input,
    AdminQuoteUpdateLineV1RequestSchema,
    AdminQuoteDetailV1ResponseSchema,
  );

export const deleteAdminQuoteLine = (
  quoteId: string,
  lineId: string,
  expectedLockVersion: string,
): Promise<AdminQuoteDetailV1Response> => {
  const query = new URLSearchParams({ expectedLockVersion });
  return getJson(
    `${quoteIdPath(quoteId, "/lines/")}${encodeURIComponent(AdminOpaqueIdSchema.parse(lineId))}?${query.toString()}`,
    AdminQuoteDetailV1ResponseSchema,
    "DELETE",
  );
};

export const duplicateAdminQuoteLine = (
  quoteId: string,
  lineId: string,
): Promise<AdminQuoteDetailV1Response> =>
  sendJson(
    `${quoteIdPath(quoteId, "/lines/")}${encodeURIComponent(AdminOpaqueIdSchema.parse(lineId))}/duplicate`,
    "POST",
    {},
    noBody,
    AdminQuoteDetailV1ResponseSchema,
  );

export const reorderAdminQuoteLines = (
  quoteId: string,
  input: AdminQuoteReorderV1Request,
): Promise<AdminQuoteDetailV1Response> =>
  sendJson(
    quoteIdPath(quoteId, "/line-order"),
    "PUT",
    input,
    AdminQuoteReorderV1RequestSchema,
    AdminQuoteDetailV1ResponseSchema,
  );

export const applyAdminQuoteMargin = (
  quoteId: string,
  input: AdminQuoteApplyMarginV1Request,
): Promise<AdminQuoteDetailV1Response> =>
  sendJson(
    quoteIdPath(quoteId, "/apply-margin"),
    "POST",
    input,
    AdminQuoteApplyMarginV1RequestSchema,
    AdminQuoteDetailV1ResponseSchema,
  );

export const upsertAdminQuoteDay = (
  quoteId: string,
  dayIndex: number,
  input: AdminQuoteDayV1Request,
): Promise<AdminQuoteDetailV1Response> =>
  sendJson(
    quoteIdPath(quoteId, `/days/${String(dayIndex)}`),
    "PUT",
    input,
    AdminQuoteDayV1RequestSchema,
    AdminQuoteDetailV1ResponseSchema,
  );

export const resetAdminQuoteDays = (
  quoteId: string,
  expectedLockVersion: string,
): Promise<AdminQuoteDetailV1Response> => {
  const query = new URLSearchParams({ expectedLockVersion });
  return getJson(
    `${quoteIdPath(quoteId, "/days")}?${query.toString()}`,
    AdminQuoteDetailV1ResponseSchema,
    "DELETE",
  );
};

export const sendAdminQuote = (
  quoteId: string,
  input: AdminQuoteSendV1Request,
): Promise<AdminQuoteSentV1Response> =>
  sendJson(
    quoteIdPath(quoteId, "/send"),
    "POST",
    input,
    AdminQuoteSendV1RequestSchema,
    AdminQuoteSentV1ResponseSchema,
  );

const quoteTransition = (
  quoteId: string,
  action: "revise" | "decline" | "archive",
  input: AdminQuoteExpectedVersionV1Request,
): Promise<AdminQuoteDetailV1Response> =>
  sendJson(
    quoteIdPath(quoteId, `/${action}`),
    "POST",
    input,
    AdminQuoteExpectedVersionV1RequestSchema,
    AdminQuoteDetailV1ResponseSchema,
  );

export const reviseAdminQuote = (quoteId: string, input: AdminQuoteExpectedVersionV1Request) =>
  quoteTransition(quoteId, "revise", input);

export const declineAdminQuote = (quoteId: string, input: AdminQuoteExpectedVersionV1Request) =>
  quoteTransition(quoteId, "decline", input);

export const archiveAdminQuote = (quoteId: string, input: AdminQuoteExpectedVersionV1Request) =>
  quoteTransition(quoteId, "archive", input);

export const revokeAdminQuoteShareLink = async (shareLinkId: string): Promise<void> => {
  await sendJson(
    quoteEntityPath("quote-share-links", shareLinkId, "/revoke"),
    "POST",
    {},
    noBody,
    AdminQuoteRevokedV1ResponseSchema,
  );
};

export const convertAdminQuoteToTrip = (quoteId: string): Promise<{ readonly tripId: string }> =>
  sendJson(
    quoteIdPath(quoteId, "/convert-to-trip"),
    "POST",
    {},
    noBody,
    AdminQuoteConvertedV1ResponseSchema,
  );

export const listAdminLeadQuotes = (
  leadId: string,
): Promise<{ readonly items: AdminQuoteV1Response[] }> =>
  getJson(leadResourcePath(leadId, "/quotes"), AdminLeadQuotesV1ResponseSchema);
