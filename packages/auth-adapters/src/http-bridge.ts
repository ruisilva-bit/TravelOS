import { PORTAL_AUTH_BASE_PATH, STAFF_AUTH_BASE_PATH, type AuthRealm } from "./realm.js";

export interface AuthHttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: unknown;
}

export interface AuthHttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
}

export interface AuthSurfacePolicy {
  readonly canonicalOrigin: string;
  readonly expectedHost: string;
}

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const sensitiveQueryParameter = /^(?:authorization|password|secret|session|token)$/iu;

export const hostHeaderMatchesExpectedHost = (
  value: string | null | undefined,
  expectedHost: string,
): boolean =>
  typeof value === "string" &&
  expectedHost === expectedHost.toLowerCase() &&
  value === value.trim() &&
  value.toLowerCase() === expectedHost;

const rawPathnameFor = (requestUrl: string): string | null => {
  const requestTarget = requestUrl.split(/[?#]/u, 1)[0] ?? "";
  if (requestTarget.startsWith("/")) return requestTarget;
  const schemeSeparator = requestTarget.indexOf("://");
  if (schemeSeparator < 0) return null;
  const pathStart = requestTarget.indexOf("/", schemeSeparator + 3);
  return pathStart < 0 ? "/" : requestTarget.slice(pathStart);
};

const pathnameMatchesBasePath = (pathname: string, basePath: string): boolean => {
  if (pathname === basePath) return true;
  if (!pathname.startsWith(`${basePath}/`)) return false;
  const suffix = pathname.slice(basePath.length + 1);
  return (
    suffix.length > 0 &&
    !pathname.endsWith("/") &&
    !pathname.includes("//") &&
    !/%(?:2f|5c)/iu.test(suffix)
  );
};

export const authRequestPathMatchesBase = (
  requestUrl: string,
  targetUrl: URL,
  basePath: string,
): boolean => {
  const rawPathname = rawPathnameFor(requestUrl);
  return (
    rawPathname !== null &&
    rawPathname === targetUrl.pathname &&
    pathnameMatchesBasePath(rawPathname, basePath)
  );
};

const requestOriginIsAllowed = (request: AuthHttpRequest, policy: AuthSurfacePolicy): boolean => {
  if (!stateChangingMethods.has(request.method.toUpperCase())) return true;
  return request.headers.get("origin") === policy.canonicalOrigin;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const requestBody = (request: AuthHttpRequest, headers: Headers): BodyInit | undefined => {
  if (request.body === undefined || request.body === null) return undefined;
  if (typeof request.body === "string") return request.body;
  // Auth requests are structured UTF-8 form/JSON data; normalize byte input instead of passing
  // a platform-specific typed-array generic through the DOM BodyInit boundary.
  if (request.body instanceof Uint8Array) return new TextDecoder().decode(request.body);
  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.startsWith("application/x-www-form-urlencoded") && isPlainRecord(request.body)) {
    return new URLSearchParams(
      Object.entries(request.body).flatMap(([key, value]) =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? [[key, String(value)]]
          : [],
      ),
    ).toString();
  }
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return JSON.stringify(request.body);
};

/**
 * The delivery bridge rejects host/origin confusion before Better Auth receives the request.
 * It does not parse credentials and it never writes auth material to logs.
 */
export const dispatchAuthRealmRequest = async (
  realm: AuthRealm,
  policy: AuthSurfacePolicy,
  request: AuthHttpRequest,
): Promise<AuthHttpResponse> => {
  const canonicalOrigin = new URL(policy.canonicalOrigin);
  if (
    canonicalOrigin.pathname !== "/" ||
    canonicalOrigin.search !== "" ||
    canonicalOrigin.hash !== ""
  ) {
    throw new Error("Auth surface canonical origin must not include a path, query, or hash");
  }
  if (!hostHeaderMatchesExpectedHost(request.headers.get("host"), policy.expectedHost)) {
    return { status: 404, headers: new Headers(), body: new Uint8Array() };
  }
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (
    request.headers.has("authorization") ||
    (forwardedHost !== null &&
      !hostHeaderMatchesExpectedHost(forwardedHost, policy.expectedHost)) ||
    !requestOriginIsAllowed(request, policy)
  ) {
    return { status: 403, headers: new Headers(), body: new Uint8Array() };
  }
  const targetUrl = new URL(request.url, canonicalOrigin);
  if (
    targetUrl.origin !== canonicalOrigin.origin ||
    [...targetUrl.searchParams.keys()].some((key) => sensitiveQueryParameter.test(key))
  ) {
    return { status: 403, headers: new Headers(), body: new Uint8Array() };
  }
  const expectedBasePath = realm.kind === "STAFF" ? STAFF_AUTH_BASE_PATH : PORTAL_AUTH_BASE_PATH;
  if (
    realm.basePath !== expectedBasePath ||
    !authRequestPathMatchesBase(request.url, targetUrl, expectedBasePath)
  ) {
    return { status: 404, headers: new Headers(), body: new Uint8Array() };
  }
  const headers = new Headers(request.headers);
  const body = requestBody(request, headers);
  const requestInit: RequestInit = { method: request.method, headers };
  if (body !== undefined) requestInit.body = body;
  const outbound = await realm.handle(new Request(targetUrl, requestInit));
  return {
    status: outbound.status,
    headers: outbound.headers,
    body: new Uint8Array(await outbound.arrayBuffer()),
  };
};
