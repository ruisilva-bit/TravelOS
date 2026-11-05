export const STAFF_INVITATION_ACCEPTANCE_RATE_LIMIT_MAX_ATTEMPTS = 10;
export const STAFF_INVITATION_ACCEPTANCE_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
export const STAFF_INVITATION_ACCEPTANCE_RATE_LIMIT_MAX_TRACKED_KEYS = 4_096;

export type StaffInvitationRateLimitOutcome = "ACCEPTED" | "REJECTED";

export type StaffInvitationRateLimitDecision =
  | {
      readonly allowed: true;
      complete(outcome: StaffInvitationRateLimitOutcome): void;
    }
  | {
      readonly allowed: false;
      readonly retryAfterSeconds: number;
    };

export interface StaffInvitationRateLimiter {
  begin(clientKey: string): StaffInvitationRateLimitDecision;
}

export interface StaffInvitationRateLimiterOptions {
  readonly nowEpochMs?: () => number;
  readonly maxAttempts?: number;
  readonly windowMs?: number;
  readonly maxTrackedKeys?: number;
}

interface Attempt {
  readonly id: symbol;
  readonly startedAtEpochMs: number;
}

export interface TrustedStaffInvitationClientRequest {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly rawHeaders?: readonly string[];
  readonly socket?: { readonly remoteAddress?: string };
}

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
};

const isIpv4Address = (value: string): boolean => {
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => {
      if (octet.length === 0 || octet.length > 3 || !/^(?:0|[1-9][0-9]{0,2})$/u.test(octet)) {
        return false;
      }
      return Number(octet) <= 255;
    })
  );
};

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });

const normalizeIpAddress = (value: string | undefined): string | null => {
  if (value === undefined || value.length === 0 || value.length > 64 || value.trim() !== value) {
    return null;
  }

  const ipv4Mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(value)?.[1];
  if (ipv4Mapped !== undefined && isIpv4Address(ipv4Mapped)) return ipv4Mapped;
  if (isIpv4Address(value)) return value;
  if (!value.includes(":") || value.includes("%")) return null;

  try {
    const normalized = new URL(`http://[${value}]/`).hostname;
    return normalized.startsWith("[") && normalized.endsWith("]")
      ? normalized.slice(1, -1).toLowerCase()
      : null;
  } catch {
    return null;
  }
};

const isLoopbackAddress = (value: string): boolean =>
  value === "::1" || (isIpv4Address(value) && value.startsWith("127."));

const headerValues = (
  request: TrustedStaffInvitationClientRequest,
  name: string,
): readonly string[] => {
  if (request.rawHeaders !== undefined) {
    if (request.rawHeaders.length % 2 !== 0) return [];
    const values: string[] = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (request.rawHeaders[index]?.toLowerCase() === name) {
        values.push(request.rawHeaders[index + 1] ?? "");
      }
    }
    return values;
  }

  const header = Object.entries(request.headers).find(
    ([headerName]) => headerName.toLowerCase() === name,
  )?.[1];
  if (header === undefined) return [];
  return typeof header === "string" ? [header] : [...header];
};

/**
 * The Admin manifest pins its API listener to IPv4 loopback, and the active Stage 9 Caddyfile
 * proxies Admin API traffic directly to 127.0.0.1:3101. Caddy's reverse_proxy ignores incoming
 * X-Forwarded-* values unless trusted_proxies is configured; the Admin Caddyfile has no such
 * configuration. Therefore only one X-Forwarded-For IP is accepted from a loopback peer. Other
 * forwarded headers and X-Forwarded-For from any non-loopback peer are never trusted.
 */
export const trustedStaffInvitationClientKey = (
  request: TrustedStaffInvitationClientRequest,
): string => {
  const socketAddress = normalizeIpAddress(request.socket?.remoteAddress);
  if (socketAddress === null || !isLoopbackAddress(socketAddress)) {
    return `ip:${socketAddress ?? "unknown"}`;
  }

  const forwardedValues = headerValues(request, "x-forwarded-for");
  if (forwardedValues.length !== 1) return `ip:${socketAddress}`;
  const forwardedAddress = forwardedValues[0];
  if (forwardedAddress === undefined || forwardedAddress.includes(",")) {
    return `ip:${socketAddress}`;
  }

  const normalizedForwardedAddress = normalizeIpAddress(forwardedAddress);
  return `ip:${normalizedForwardedAddress ?? socketAddress}`;
};

export const createStaffInvitationRateLimiter = (
  options: StaffInvitationRateLimiterOptions = {},
): StaffInvitationRateLimiter => {
  const nowEpochMs = options.nowEpochMs ?? Date.now;
  const maxAttempts = positiveInteger(
    options.maxAttempts ?? STAFF_INVITATION_ACCEPTANCE_RATE_LIMIT_MAX_ATTEMPTS,
    "maxAttempts",
  );
  const windowMs = positiveInteger(
    options.windowMs ?? STAFF_INVITATION_ACCEPTANCE_RATE_LIMIT_WINDOW_MS,
    "windowMs",
  );
  const maxTrackedKeys = positiveInteger(
    options.maxTrackedKeys ?? STAFF_INVITATION_ACCEPTANCE_RATE_LIMIT_MAX_TRACKED_KEYS,
    "maxTrackedKeys",
  );
  const attemptsByClient = new Map<string, Attempt[]>();
  let lastObservedNowEpochMs = 0;

  const now = (): number => {
    const observed = nowEpochMs();
    if (!Number.isSafeInteger(observed) || observed < 0) {
      throw new RangeError("Rate-limit clock must return a non-negative safe integer");
    }
    lastObservedNowEpochMs = Math.max(lastObservedNowEpochMs, observed);
    return lastObservedNowEpochMs;
  };

  const pruneClient = (clientKey: string, nowEpochMs: number): Attempt[] => {
    const current = attemptsByClient.get(clientKey);
    if (current === undefined) return [];
    const retained = current.filter((attempt) => nowEpochMs - attempt.startedAtEpochMs < windowMs);
    if (retained.length === 0) {
      attemptsByClient.delete(clientKey);
      return [];
    }
    attemptsByClient.set(clientKey, retained);
    return retained;
  };

  const pruneAll = (nowEpochMs: number): void => {
    for (const clientKey of attemptsByClient.keys()) pruneClient(clientKey, nowEpochMs);
  };

  const retryAfterSecondsFor = (attempts: readonly Attempt[], nowEpochMs: number): number => {
    const oldestAttempt = attempts.reduce(
      (oldest, attempt) => Math.min(oldest, attempt.startedAtEpochMs),
      Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(oldestAttempt)) return Math.ceil(windowMs / 1_000);
    return Math.max(1, Math.ceil((oldestAttempt + windowMs - nowEpochMs) / 1_000));
  };

  const retryAfterWhenSaturated = (nowEpochMs: number): number => {
    let earliestAttempt = Number.POSITIVE_INFINITY;
    for (const attempts of attemptsByClient.values()) {
      for (const attempt of attempts) {
        earliestAttempt = Math.min(earliestAttempt, attempt.startedAtEpochMs);
      }
    }
    if (!Number.isFinite(earliestAttempt)) return Math.ceil(windowMs / 1_000);
    return Math.max(1, Math.ceil((earliestAttempt + windowMs - nowEpochMs) / 1_000));
  };

  return {
    begin(clientKeyValue) {
      const observedNow = now();
      const clientKey =
        clientKeyValue.length > 0 &&
        clientKeyValue.length <= 64 &&
        !hasControlCharacter(clientKeyValue)
          ? clientKeyValue
          : "ip:unknown";
      let attempts = pruneClient(clientKey, observedNow);

      if (attempts.length === 0 && !attemptsByClient.has(clientKey)) {
        if (attemptsByClient.size >= maxTrackedKeys) {
          pruneAll(observedNow);
          if (attemptsByClient.size >= maxTrackedKeys) {
            return { allowed: false, retryAfterSeconds: retryAfterWhenSaturated(observedNow) };
          }
        }
        attempts = [];
        attemptsByClient.set(clientKey, attempts);
      }

      if (attempts.length >= maxAttempts) {
        return { allowed: false, retryAfterSeconds: retryAfterSecondsFor(attempts, observedNow) };
      }

      const attempt: Attempt = {
        id: Symbol("staff-invitation-attempt"),
        startedAtEpochMs: observedNow,
      };
      attempts.push(attempt);
      let completed = false;

      return {
        allowed: true,
        complete(outcome) {
          if (completed) return;
          completed = true;
          if (outcome === "REJECTED") return;

          const current = attemptsByClient.get(clientKey);
          if (current === undefined) return;
          const index = current.findIndex(({ id }) => id === attempt.id);
          if (index !== -1) current.splice(index, 1);
          if (current.length === 0) attemptsByClient.delete(clientKey);
        },
      };
    },
  };
};
