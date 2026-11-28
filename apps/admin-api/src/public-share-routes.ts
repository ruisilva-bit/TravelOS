import type { PublicQuoteOperations, PublicShareOperations } from "@travelos/backend-core";
import { QuoteProposalV1Schema } from "@travelos/contracts/admin";

import { renderProposalPage } from "./proposal-page-renderer.js";
import { renderSharePage, SHARE_NOT_FOUND_HTML } from "./share-page-renderer.js";
import {
  trustedStaffInvitationClientKey,
  type StaffInvitationRateLimiter,
} from "./staff-invitation-rate-limit.js";
import { headerValues } from "./request-boundary.js";

interface IncomingHttpRequest {
  readonly method: string;
  readonly originalUrl?: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly rawHeaders?: readonly string[];
  readonly socket?: { readonly remoteAddress?: string };
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
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
  /** Token-only quote reads and acceptance; a `/v/:token` that is not a trip falls through to this. */
  readonly quoteOperations?: PublicQuoteOperations;
  /** Canonical admin origin; the public accept form must come from here. Absent means no accept. */
  readonly canonicalOrigin?: string;
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

/** Proposal pages: the form posts back to the same origin, and images may come from any https host. */
export const PROPOSAL_CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const ACCEPT_BODY_LIMIT_BYTES = 2_048;

/** True for `/v` and anything below it, judged on the raw (undecoded) path. */
export const isPublicSharePath = (url: string | undefined): boolean => {
  const path = (url ?? "").split(/[?#]/u, 1)[0] ?? "";
  return path === SHARE_ROUTE_PREFIX || path.startsWith(`${SHARE_ROUTE_PREFIX}/`);
};

/** True only for the public proposal acceptance POST, `/v/<token>/accept`. */
export const isPublicShareAcceptPath = (url: string | undefined): boolean =>
  ACCEPT_PATH.test((url ?? "").split(/[?#]/u, 1)[0] ?? "");

const SHARE_PATH = /^\/v\/([A-Za-z0-9_-]{43})$/u;
const ACCEPT_PATH = /^\/v\/([A-Za-z0-9_-]{43})\/accept$/u;

const respond = (
  response: OutgoingHttpResponse,
  status: number,
  body: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): void => {
  for (const [name, value] of Object.entries({ ...PUBLIC_SHARE_HEADERS, ...extraHeaders })) {
    response.setHeader(name, value);
  }
  response.status(status).end(body);
};

const redirect = (response: OutgoingHttpResponse, location: string): void => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
  response.setHeader("Location", location);
  response.status(303).end("");
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const flashFrom = (url: string | undefined): "accepted" | "error" | null => {
  const query = (url ?? "").split("?", 2)[1] ?? "";
  const params = new URLSearchParams(query.split("#", 1)[0] ?? "");
  if (params.get("aceite") === "1") return "accepted";
  if (params.get("erro") === "1") return "error";
  return null;
};

/**
 * Reads a form body of at most `limit` bytes. An oversized body is drained and discarded, so the
 * client still receives the redirect; resolves null when it is oversized or unreadable.
 */
const readFormBody = (request: IncomingHttpRequest, limit: number): Promise<string | null> =>
  new Promise((resolve) => {
    if (typeof request.on !== "function") {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: unknown) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size <= limit) chunks.push(buffer);
    });
    request.on("end", () => resolve(size <= limit ? Buffer.concat(chunks).toString("utf8") : null));
    request.on("error", () => resolve(null));
  });

/** Origin and Referer, when sent, must both be the canonical admin origin. */
const sameOriginAllowed = (request: IncomingHttpRequest, canonicalOrigin: string): boolean => {
  const origins = headerValues(request, "origin");
  if (origins.length > 1) return false;
  if (origins.length === 1 && origins[0] !== canonicalOrigin) return false;
  const referers = headerValues(request, "referer");
  if (referers.length > 1) return false;
  if (referers.length === 1) {
    const referer = referers[0] ?? "";
    if (referer !== canonicalOrigin && !referer.startsWith(`${canonicalOrigin}/`)) return false;
  }
  return true;
};

/** Parses a quote payload strictly; anything that does not match the customer contract is a miss. */
const parseProposal = (payload: unknown) => {
  const parsed = QuoteProposalV1Schema.safeParse(payload);
  return parsed.success ? parsed.data : null;
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

    if (request.method === "POST") {
      const acceptMatch = ACCEPT_PATH.exec(rawPath);
      if (acceptMatch === null || acceptMatch[1] === undefined) {
        respond(response, 404, SHARE_NOT_FOUND_HTML);
        return;
      }
      handleAccept(request, response, acceptMatch[1], options);
      return;
    }

    const match = request.method === "GET" ? SHARE_PATH.exec(rawPath) : null;
    if (match === null || match[1] === undefined) {
      respond(response, 404, SHARE_NOT_FOUND_HTML);
      return;
    }
    const token = match[1];
    const flash = flashFrom(request.originalUrl ?? request.url);
    options.operations
      .readPublicShare(token)
      .then((snapshot) => respond(response, 200, renderSharePage(snapshot)))
      .catch(() => readProposal(response, token, flash, options));
  });
};

const readProposal = (
  response: OutgoingHttpResponse,
  token: string,
  flash: "accepted" | "error" | null,
  options: PublicShareRouteOptions,
): void => {
  if (options.quoteOperations === undefined) {
    respond(response, 404, SHARE_NOT_FOUND_HTML);
    return;
  }
  const today = todayIso();
  options.quoteOperations
    .readPublicQuote(token, today)
    .then((record) => {
      const payload = parseProposal(record.payload);
      if (payload === null) throw new Error("quote payload failed the customer contract");
      respond(
        response,
        200,
        renderProposalPage({
          payload,
          token,
          isLatest: record.isLatest,
          state: record.expired && record.state === "SENT" ? "EXPIRED" : record.state,
          accepted: record.accepted,
          flash,
          today,
        }),
        { "Content-Security-Policy": PROPOSAL_CONTENT_SECURITY_POLICY },
      );
    })
    // Unknown, revoked, expired, malformed and unparsable links are indistinguishable.
    .catch(() => respond(response, 404, SHARE_NOT_FOUND_HTML));
};

const handleAccept = (
  request: IncomingHttpRequest,
  response: OutgoingHttpResponse,
  token: string,
  options: PublicShareRouteOptions,
): void => {
  const back = `/v/${token}`;
  const canonicalOrigin = options.canonicalOrigin;
  const quoteOperations = options.quoteOperations;
  if (
    quoteOperations === undefined ||
    canonicalOrigin === undefined ||
    !sameOriginAllowed(request, canonicalOrigin)
  ) {
    respond(response, 403, "");
    return;
  }
  const contentType = headerValues(request, "content-type")[0] ?? "";
  if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    redirect(response, `${back}?erro=1`);
    return;
  }
  readFormBody(request, ACCEPT_BODY_LIMIT_BYTES)
    .then(async (body) => {
      if (body === null) return `${back}?erro=1`;
      const params = new URLSearchParams(body);
      if (params.get("confirm") !== "on") return `${back}?erro=1`;
      const name = params.get("name") ?? "";
      try {
        const outcome = await quoteOperations.acceptPublicQuote(token, name);
        if (outcome === "ACCEPTED" || outcome === "ALREADY_ACCEPTED") return `${back}?aceite=1`;
        return back;
      } catch {
        // Invalid name, unknown token or an unexpected failure: the customer sees the same retry hint.
        return `${back}?erro=1`;
      }
    })
    .then((location) => redirect(response, location))
    .catch(() => redirect(response, `${back}?erro=1`));
};
