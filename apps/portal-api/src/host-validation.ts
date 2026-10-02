import { hostHeaderMatchesExpectedHost } from "@travelos/auth-adapters";

export const PORTAL_PRIVATE_NO_STORE = "private, no-store";

interface IncomingHttpRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawHeaders?: readonly string[];
}

interface OutgoingHttpResponse {
  status(statusCode: number): OutgoingHttpResponse;
  setHeader(name: string, value: string): void;
  end(): void;
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

/** The raw Host remains authoritative; forwarded host can only corroborate the same manifest value. */
export const createPortalHostValidationMiddleware =
  (expectedHost: string): HttpHandler =>
  (request, response, next) => {
    const hostValues = headerValues(request, "host");
    const forwardedHostValues = headerValues(request, "x-forwarded-host");
    const hostIsAllowed =
      hostValues.length === 1 && hostHeaderMatchesExpectedHost(hostValues[0], expectedHost);
    const forwardedHostIsAllowed =
      forwardedHostValues.length === 0 ||
      (forwardedHostValues.length === 1 &&
        hostHeaderMatchesExpectedHost(forwardedHostValues[0], expectedHost));

    if (!hostIsAllowed || !forwardedHostIsAllowed) {
      response.setHeader("cache-control", PORTAL_PRIVATE_NO_STORE);
      response.status(404).end();
      return;
    }

    next();
  };
