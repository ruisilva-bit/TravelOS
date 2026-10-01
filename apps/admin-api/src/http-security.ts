import { originAllowedForMethod } from "@travelos/auth-adapters";

export const ADMIN_PRIVATE_NO_STORE = "private, no-store";

interface IncomingHttpRequest {
  readonly method: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawHeaders?: readonly string[];
}

interface OutgoingHttpResponse {
  status(statusCode: number): OutgoingHttpResponse;
  setHeader(name: string, value: string | readonly string[]): unknown;
  end(): void;
  removeHeader?: (name: string) => unknown;
}

type Next = (error?: unknown) => void;
type HttpHandler = (
  request: IncomingHttpRequest,
  response: OutgoingHttpResponse,
  next: Next,
) => void;

const headerValues = (request: IncomingHttpRequest, name: string): readonly string[] => {
  const rawHeaders = request.rawHeaders;
  if (rawHeaders !== undefined) {
    if (rawHeaders.length % 2 !== 0) return [];
    const values: string[] = [];
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (rawHeaders[index]?.toLowerCase() === name) {
        values.push(rawHeaders[index + 1] ?? "");
      }
    }
    return values;
  }

  const value = request.headers[name];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
};

/** Pins the Admin cache policy before any route, parser, or error handler can write headers. */
export const createAdminCacheControlMiddleware = (): HttpHandler => (_request, response, next) => {
  const originalSetHeader = response.setHeader.bind(response);
  response.setHeader = (name, value) =>
    originalSetHeader(
      name.toLowerCase() === "cache-control" ? "Cache-Control" : name,
      name.toLowerCase() === "cache-control" ? ADMIN_PRIVATE_NO_STORE : value,
    );

  const originalRemoveHeader = response.removeHeader?.bind(response);
  if (originalRemoveHeader !== undefined) {
    response.removeHeader = (name) =>
      name.toLowerCase() === "cache-control"
        ? response.setHeader("Cache-Control", ADMIN_PRIVATE_NO_STORE)
        : originalRemoveHeader(name);
  }

  response.setHeader("Cache-Control", ADMIN_PRIVATE_NO_STORE);
  next();
};

/** Rejects state-changing Admin requests unless Origin matches the configured Admin origin. */
export const createAdminOriginValidationMiddleware =
  (canonicalOrigin: string | null): HttpHandler =>
  (request, response, next) => {
    const origins = headerValues(request, "origin");
    const origin = origins.length === 1 ? (origins[0] ?? null) : null;
    if (!originAllowedForMethod(request.method, origin, canonicalOrigin)) {
      response.status(403).end();
      return;
    }
    next();
  };
