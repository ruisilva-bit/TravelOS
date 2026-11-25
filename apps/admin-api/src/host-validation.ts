import { hostHeaderMatchesExpectedHost } from "@travelos/auth-adapters";

import { ADMIN_PRIVATE_NO_STORE } from "./http-security.js";
import { headerValues } from "./request-boundary.js";

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

/** The raw Host stays authoritative; forwarded host can only corroborate that same manifest value. */
export const createAdminHostValidationMiddleware =
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
      response.setHeader("cache-control", ADMIN_PRIVATE_NO_STORE);
      response.status(404).end();
      return;
    }

    next();
  };
