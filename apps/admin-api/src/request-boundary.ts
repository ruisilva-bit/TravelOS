import { hostHeaderMatchesExpectedHost, type AuthSurfacePolicy } from "@travelos/auth-adapters";

/** Minimal request shape the Admin API HTTP boundary checks read. */
export interface BoundaryRequest {
  readonly originalUrl?: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

interface RawHeaderRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawHeaders?: readonly string[];
}

/** Reads every occurrence of one header, preferring raw headers so duplicates stay visible. */
export const headerValues = (request: RawHeaderRequest, name: string): readonly string[] => {
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

export const headersFor = (request: Pick<BoundaryRequest, "headers">): Headers => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(
      name,
      Array.isArray(value) ? value.join(name.toLowerCase() === "cookie" ? "; " : ", ") : value,
    );
  }
  return headers;
};

export const requestUrlFor = (request: BoundaryRequest, policy: AuthSurfacePolicy): URL | null => {
  try {
    const canonicalOrigin = new URL(policy.canonicalOrigin);
    const target = new URL(request.originalUrl ?? request.url, canonicalOrigin);
    return target.origin === canonicalOrigin.origin ? target : null;
  } catch {
    return null;
  }
};

export interface SurfaceRejectionOptions {
  /** When true, a request URL outside the canonical origin is rejected with 404 before host checks. */
  readonly requireRoutableUrl: boolean;
  /** When true, a missing or non-canonical Origin header is rejected with 403. */
  readonly requireCanonicalOrigin: boolean;
  /** When true, a query string is rejected with 400 after every other check passes. */
  readonly rejectQueryString: boolean;
}

/**
 * Check order is fixed: URL (404), Host (404), Authorization / X-Forwarded-Host / Origin (403),
 * query string (400). Each caller selects which checks apply; the statuses never vary per caller.
 */
export const surfaceRejectionStatus = (
  request: BoundaryRequest,
  policy: AuthSurfacePolicy,
  options: SurfaceRejectionOptions,
): 400 | 403 | 404 | null => {
  const target = requestUrlFor(request, policy);
  if (options.requireRoutableUrl && target === null) return 404;
  const headers = headersFor(request);
  if (!hostHeaderMatchesExpectedHost(headers.get("host"), policy.expectedHost)) return 404;

  const forwardedHost = headers.get("x-forwarded-host");
  if (
    headers.has("authorization") ||
    (forwardedHost !== null && !hostHeaderMatchesExpectedHost(forwardedHost, policy.expectedHost))
  ) {
    return 403;
  }
  if (options.requireCanonicalOrigin && headers.get("origin") !== policy.canonicalOrigin) {
    return 403;
  }
  if (options.rejectQueryString && target !== null && target.search !== "") return 400;
  return null;
};
