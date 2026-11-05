import {
  PortalAuthenticatedSessionSchema,
  PortalAuthorizedTripListV1QuerySchema,
  PortalAuthorizedTripListV1ResponseSchema,
  PortalTripSnapshotV1Schema,
  type PortalAuthenticatedSession,
  type PortalAuthorizedTripListV1Response,
  type PortalTripSnapshotV1,
} from "@travelos/contracts/portal";

export type PortalApiErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "ACCESS_DENIED"
  | "NOT_AVAILABLE"
  | "UNAVAILABLE"
  | "NETWORK_FAILURE"
  | "INVALID_RESPONSE"
  | "INVALID_REQUEST";

const messages: Record<PortalApiErrorCode, string> = {
  AUTHENTICATION_REQUIRED: "A sessão do Portal terminou. Inicie sessão novamente.",
  ACCESS_DENIED: "Não tem acesso a esta viagem.",
  NOT_AVAILABLE: "Esta viagem não está disponível.",
  UNAVAILABLE: "O serviço está temporariamente indisponível.",
  NETWORK_FAILURE: "Não foi possível contactar o serviço.",
  INVALID_RESPONSE: "Não foi possível validar os dados recebidos.",
  INVALID_REQUEST: "O pedido não é válido.",
};

export class PortalApiError extends Error {
  readonly code: PortalApiErrorCode;
  readonly status: number | null;

  constructor(code: PortalApiErrorCode, status: number | null = null) {
    super(messages[code]);
    this.name = "PortalApiError";
    this.code = code;
    this.status = status;
  }
}

const TRIP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const errorCodeForStatus = (status: number): PortalApiErrorCode => {
  if (status === 401) return "AUTHENTICATION_REQUIRED";
  if (status === 403) return "ACCESS_DENIED";
  if (status === 404) return "NOT_AVAILABLE";
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
    throw new PortalApiError("NETWORK_FAILURE");
  }

  if (!response.ok) throw new PortalApiError(errorCodeForStatus(response.status), response.status);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new PortalApiError("INVALID_RESPONSE", response.status);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new PortalApiError("INVALID_RESPONSE", response.status);
  return parsed.data;
};

export const getPortalSession = (): Promise<PortalAuthenticatedSession> =>
  getJson("/api/portal/session-context", PortalAuthenticatedSessionSchema);

export const listPortalTrips = (input: {
  readonly limit: number;
  readonly cursor: string | null;
}): Promise<PortalAuthorizedTripListV1Response> => {
  const parsed = PortalAuthorizedTripListV1QuerySchema.safeParse({
    limit: String(input.limit),
    cursor: input.cursor,
  });
  if (!parsed.success) return Promise.reject(new PortalApiError("INVALID_REQUEST"));

  const query = new URLSearchParams({ limit: String(parsed.data.limit) });
  if (parsed.data.cursor !== null) query.set("cursor", parsed.data.cursor);
  return getJson(`/api/portal/trips?${query.toString()}`, PortalAuthorizedTripListV1ResponseSchema);
};

export const readPortalTripSnapshot = (tripId: string): Promise<PortalTripSnapshotV1> => {
  if (!TRIP_ID.test(tripId)) return Promise.reject(new PortalApiError("INVALID_REQUEST"));
  return getJson(`/api/portal/trips/${encodeURIComponent(tripId)}`, PortalTripSnapshotV1Schema);
};
