import { originAllowedForMethod } from "@travelos/auth-adapters";

import { headerValues } from "./request-boundary.js";

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
