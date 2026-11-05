import { describe, expect, it } from "vitest";

import {
  createStaffInvitationRateLimiter,
  trustedStaffInvitationClientKey,
} from "../src/staff-invitation-rate-limit.js";

const WINDOW_MS = 15 * 60 * 1_000;

const reject = (
  decision: ReturnType<ReturnType<typeof createStaffInvitationRateLimiter>["begin"]>,
) => {
  if (!decision.allowed) throw new Error("Expected a rate-limit lease");
  decision.complete("REJECTED");
};

describe("Staff invitation acceptance rate limit", () => {
  it("limits invalid attempts in a sliding window and expires the oldest attempt", () => {
    let nowEpochMs = 1_000;
    const limiter = createStaffInvitationRateLimiter({ nowEpochMs: () => nowEpochMs });
    const clientKey = "ip:198.51.100.21";

    for (let attempt = 0; attempt < 10; attempt += 1) {
      reject(limiter.begin(clientKey));
    }
    expect(limiter.begin(clientKey)).toMatchObject({ allowed: false });

    nowEpochMs += WINDOW_MS - 1;
    expect(limiter.begin(clientKey)).toMatchObject({ allowed: false });
    nowEpochMs += 1;
    expect(limiter.begin(clientKey)).toMatchObject({ allowed: true });
  });

  it("reserves concurrent attempts and refunds a successful acceptance", () => {
    const limiter = createStaffInvitationRateLimiter();
    const leases = Array.from({ length: 10 }, () => limiter.begin("ip:198.51.100.22"));
    expect(leases.every((lease) => lease.allowed)).toBe(true);
    expect(limiter.begin("ip:198.51.100.22")).toMatchObject({ allowed: false });

    const firstLease = leases[0];
    if (!firstLease?.allowed) throw new Error("Expected a pending lease");
    firstLease.complete("ACCEPTED");
    expect(limiter.begin("ip:198.51.100.22")).toMatchObject({ allowed: true });

    for (const lease of leases.slice(1)) {
      if (lease?.allowed) lease.complete("REJECTED");
    }
  });

  it("fails closed when the tracked-key cap is reached and reclaims expired keys", () => {
    let nowEpochMs = 10_000;
    const limiter = createStaffInvitationRateLimiter({
      nowEpochMs: () => nowEpochMs,
      maxAttempts: 1,
      maxTrackedKeys: 2,
    });

    reject(limiter.begin("ip:198.51.100.31"));
    reject(limiter.begin("ip:198.51.100.32"));
    expect(limiter.begin("ip:198.51.100.33")).toMatchObject({ allowed: false });

    nowEpochMs += WINDOW_MS;
    expect(limiter.begin("ip:198.51.100.33")).toMatchObject({ allowed: true });
  });

  it("uses forwarded client IP only on the verified loopback Caddy-to-API path", () => {
    expect(
      trustedStaffInvitationClientKey({
        socket: { remoteAddress: "127.0.0.1" },
        headers: { "x-forwarded-for": "198.51.100.41" },
      }),
    ).toBe("ip:198.51.100.41");

    expect(
      trustedStaffInvitationClientKey({
        socket: { remoteAddress: "203.0.113.41" },
        headers: { "x-forwarded-for": "198.51.100.99" },
      }),
    ).toBe("ip:203.0.113.41");
  });

  it("falls back to the trusted socket address for malformed or duplicated forwarded headers", () => {
    expect(
      trustedStaffInvitationClientKey({
        socket: { remoteAddress: "127.0.0.1" },
        headers: { "x-forwarded-for": "198.51.100.41, 198.51.100.42" },
      }),
    ).toBe("ip:127.0.0.1");

    expect(
      trustedStaffInvitationClientKey({
        socket: { remoteAddress: "127.0.0.1" },
        headers: { "x-forwarded-for": ["198.51.100.41", "198.51.100.42"] },
        rawHeaders: ["X-Forwarded-For", "198.51.100.41", "X-Forwarded-For", "198.51.100.42"],
      }),
    ).toBe("ip:127.0.0.1");
  });

  it("ignores X-Real-IP and Forwarded headers and canonicalizes IPv6 aliases", () => {
    expect(
      trustedStaffInvitationClientKey({
        socket: { remoteAddress: "203.0.113.50" },
        headers: {
          "x-real-ip": "198.51.100.50",
          forwarded: "for=198.51.100.51",
        },
      }),
    ).toBe("ip:203.0.113.50");

    const expanded = trustedStaffInvitationClientKey({
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "x-forwarded-for": "2001:0db8:0000:0000:0000:0000:0000:0001" },
    });
    const compressed = trustedStaffInvitationClientKey({
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "x-forwarded-for": "2001:db8::1" },
    });
    expect(expanded).toBe("ip:2001:db8::1");
    expect(compressed).toBe(expanded);
  });
});
