import type { PublicShareOperations } from "@travelos/backend-core";

import { renderSharePage, SHARE_NOT_FOUND_HTML } from "./share-page-renderer.js";
import {
  trustedStaffInvitationClientKey,
  type StaffInvitationRateLimiter,
} from "./staff-invitation-rate-limit.js";

interface IncomingHttpRequest {
  readonly method: string;
  readonly originalUrl?: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly rawHeaders?: readonly string[];
  readonly socket?: { readonly remoteAddress?: string };
}

interface OutgoingHttpResponse {
  status(statusCode: number): OutgoingHttpResponse;
  setHeader(name: string, value: string | readonly string[]): void;
  end(body?: string): void;
}

type Next = (error?: unknown) => void;
type HttpHandler = (
  request: IncomingHttpRequest,
  response: OutgoingHttpResponse,
  next: Next,
) => void;

export interface PublicShareExpressApplication {
  use(path: string, handler: HttpHandler): void;
}

export interface PublicShareRouteOptions {
  readonly operations: PublicShareOperations;
  readonly rateLimiter: StaffInvitationRateLimiter;
}

export const SHARE_ROUTE_PREFIX = "/v";

/** Applied to every outcome (200, 404, 429) so responses cannot be told apart by headers. */
export const PUBLIC_SHARE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
});

/** True for `/v` and anything below it, judged on the raw (undecoded) path. */
export const isPublicSharePath = (url: string | undefined): boolean => {
  const path = (url ?? "").split(/[?#]/u, 1)[0] ?? "";
  return path === SHARE_ROUTE_PREFIX || path.startsWith(`${SHARE_ROUTE_PREFIX}/`);
};

const SHARE_PATH = /^\/v\/([A-Za-z0-9_-]{43})$/u;

const respond = (response: OutgoingHttpResponse, status: number, body: string): void => {
  for (const [name, value] of Object.entries(PUBLIC_SHARE_HEADERS)) response.setHeader(name, value);
  response.status(status).end(body);
};

/**
 * Mounted with `use("/v")`, not as a single-segment route: every method and every path below `/v`
 * is answered here, so nothing under it can fall through to a static or SPA fallback. The token
 * is read from the raw path only and never logged (request telemetry records status and
 * duration, not the URL).
 */
export const registerPublicShareRoutes = (
  application: PublicShareExpressApplication,
  options: PublicShareRouteOptions,
): void => {
  application.use(SHARE_ROUTE_PREFIX, (request, response) => {
    const decision = options.rateLimiter.begin(trustedStaffInvitationClientKey(request));
    if (!decision.allowed) {
      response.setHeader("Retry-After", String(decision.retryAfterSeconds));
      respond(response, 429, SHARE_NOT_FOUND_HTML);
      return;
    }
    const rawPath = (request.originalUrl ?? request.url).split(/[?#]/u, 1)[0] ?? "";
    const match = request.method === "GET" ? SHARE_PATH.exec(rawPath) : null;
    if (match === null || match[1] === undefined) {
      respond(response, 404, SHARE_NOT_FOUND_HTML);
      return;
    }
    options.operations
      .readPublicShare(match[1])
      .then((snapshot) => respond(response, 200, renderSharePage(snapshot)))
      // Unknown, revoked, expired, malformed and unparsable links are indistinguishable.
      .catch(() => respond(response, 404, SHARE_NOT_FOUND_HTML));
  });
};
