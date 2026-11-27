import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  computeShareLinkState,
  createPublicShareOperations,
  createStaffShareLinkOperations,
  decodeShareToken,
  generateShareToken,
  hashPresentedShareToken,
  isShareTokenShape,
  resolveShareLinkExpiryDays,
  ShareLinkNotFoundError,
  type OpaqueId,
  type ShareTokenCryptoPort,
  type StaffPermissionId,
  type StaffShareLinkRepository,
  type TripSnapshotV1,
} from "../../src/index.js";

const crypto: ShareTokenCryptoPort = {
  randomBytes: (length) => new Uint8Array(randomBytes(length)),
  sha256: (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest()),
};

describe("share token domain", () => {
  it("generates 43-character base64url tokens that round-trip to the stored hash", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 2_000; index += 1) {
      const { token, tokenHash } = generateShareToken(crypto);
      expect(token).toHaveLength(43);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(isShareTokenShape(token)).toBe(true);
      expect(tokenHash).toHaveLength(32);
      expect(hashPresentedShareToken(crypto, token)).toEqual(tokenHash);
      seen.add(token);
    }
    expect(seen.size).toBe(2_000);
  });

  it("hashes deterministically and rejects malformed or non-canonical tokens", () => {
    const token = generateShareToken(crypto).token;
    expect(hashPresentedShareToken(crypto, token)).toEqual(hashPresentedShareToken(crypto, token));
    for (const bad of [
      "",
      "a".repeat(42),
      "a".repeat(44),
      `${"a".repeat(42)}=`,
      `${"a".repeat(42)}+`,
      `${"a".repeat(42)} `,
      `${"a".repeat(42)}/`,
      undefined,
      42,
      null,
    ]) {
      expect(hashPresentedShareToken(crypto, bad)).toBeNull();
    }
    // The last character carries only 4 payload bits; a spelling with set padding bits is refused.
    expect(decodeShareToken(`${"A".repeat(42)}B`)).toBeNull();
    expect(decodeShareToken("A".repeat(43))).not.toBeNull();
  });

  it("rejects entropy sources of the wrong length", () => {
    expect(() =>
      generateShareToken({ randomBytes: () => new Uint8Array(16), sha256: crypto.sha256 }),
    ).toThrow();
  });
});

describe("share link expiry and state", () => {
  it("defaults to 90 days and accepts 1..365 integers only", () => {
    expect(resolveShareLinkExpiryDays(undefined)).toBe(90);
    expect(resolveShareLinkExpiryDays(1)).toBe(1);
    expect(resolveShareLinkExpiryDays(365)).toBe(365);
    for (const bad of [0, -1, 366, 1.5, Number.NaN, "30", null]) {
      expect(resolveShareLinkExpiryDays(bad)).toBeNull();
    }
  });

  it("computes ACTIVE, EXPIRED and REVOKED, with revocation winning", () => {
    const base = { nowEpochMs: 1_000, expiresAtEpochMs: 2_000, revokedAtEpochMs: null };
    expect(computeShareLinkState(base)).toBe("ACTIVE");
    expect(computeShareLinkState({ ...base, nowEpochMs: 2_000 })).toBe("EXPIRED");
    expect(computeShareLinkState({ ...base, revokedAtEpochMs: 900 })).toBe("REVOKED");
    expect(computeShareLinkState({ ...base, nowEpochMs: 3_000, revokedAtEpochMs: 900 })).toBe(
      "REVOKED",
    );
  });
});

const agencyId = "abcdef12-3456-7abc-8def-000000000001" as OpaqueId;
const tripId = "abcdef12-3456-7abc-8def-000000000002" as OpaqueId;
const shareLinkId = "abcdef12-3456-7abc-8def-000000000003" as OpaqueId;
const nowEpochMs = Date.parse("2026-11-27T12:00:00.000Z");
const session = {
  sessionId: "staff-session-1",
  staffPrincipalId: "staff-principal-1",
  agencyId,
  authorizationEpoch: 2n,
  expiresAtEpochMs: nowEpochMs + 60_000,
  recentMfaVerifiedAtEpochMs: nowEpochMs,
};

const makeStaff = (permissions: readonly StaffPermissionId[], resolved: unknown = session) => {
  const repository: StaffShareLinkRepository = {
    createShareLink: vi.fn(async () => ({
      shareLinkId,
      createdAt: "2026-11-27T12:00:00.000Z",
      expiresAt: "2027-02-25T12:00:00.000Z",
    })),
    listShareLinks: vi.fn(async () => [
      {
        shareLinkId,
        createdAt: "2026-11-27T12:00:00.000Z",
        expiresAt: "2027-02-25T12:00:00.000Z",
        revokedAt: null,
        createdBy: "staff-principal-1",
        // Extra fields a careless adapter might return must not survive the use-case.
        tokenHash: new Uint8Array(32),
      } as never,
    ]),
    revokeShareLink: vi.fn(async () => undefined),
  };
  const operations = createStaffShareLinkOperations({
    repository,
    crypto,
    publicOrigin: "https://admin.example.test/",
    sessionResolver: { resolveStaffSession: vi.fn(async () => resolved) },
    authorizationRepository: {
      getStaffAuthorizationSnapshot: vi.fn(async () => ({
        staffPrincipalId: session.staffPrincipalId,
        agencyId,
        membershipState: "ACTIVE" as const,
        authorizationEpoch: session.authorizationEpoch,
        assignments: permissions.map((permissionId) => ({
          agencyId,
          permissionId,
          scopeKind: "AGENCY" as const,
          organizationUnitId: null,
          accessLevel: "ALL" as const,
          active: true,
        })),
      })),
    },
    nowEpochMs: () => nowEpochMs,
  });
  return { operations, repository };
};

describe("staff share link operations", () => {
  it("returns the token and URL only from create, storing only the hash", async () => {
    const { operations, repository } = makeStaff(["trip.view", "trip.publish"]);
    const created = await operations.createShareLink("cookie", tripId, { idempotencyKey: "k1" });
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(created.url).toBe(`https://admin.example.test/v/${created.token}`);
    const call = vi.mocked(repository.createShareLink).mock.calls[0];
    expect(call?.[2]).toEqual({ expiresInDays: 90, idempotencyKey: "k1" });
    expect(call?.[3]).toEqual(hashPresentedShareToken(crypto, created.token));
    expect(JSON.stringify(call?.slice(0, 3))).not.toContain(created.token);
  });

  it("rejects invalid create requests before touching the repository", async () => {
    const { operations, repository } = makeStaff(["trip.view", "trip.publish"]);
    for (const bad of [
      { idempotencyKey: "k", expiresInDays: 0 },
      { idempotencyKey: "k", expiresInDays: 366 },
      { idempotencyKey: "" },
      { idempotencyKey: "k\nx" },
      { idempotencyKey: "k", extra: 1 },
      null,
    ]) {
      await expect(operations.createShareLink("cookie", tripId, bad)).rejects.toMatchObject({
        code: "INVALID_SHARE_LINK_REQUEST",
      });
    }
    expect(repository.createShareLink).not.toHaveBeenCalled();
  });

  it("denies unauthenticated and under-privileged staff", async () => {
    await expect(
      makeStaff(["trip.view", "trip.publish"], null).operations.createShareLink("c", tripId, {
        idempotencyKey: "k",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const previewOnly = makeStaff(["trip.view", "trip.preview"]);
    await expect(
      previewOnly.operations.createShareLink("c", tripId, { idempotencyKey: "k" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(previewOnly.operations.revokeShareLink("c", shareLinkId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const publishOnly = makeStaff(["trip.view", "trip.publish"]);
    await expect(publishOnly.operations.listShareLinks("c", tripId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(previewOnly.repository.createShareLink).not.toHaveBeenCalled();
  });

  it("lists an explicit allowlist with computed state and never a token or hash", async () => {
    const { operations } = makeStaff(["trip.view", "trip.preview"]);
    const links = await operations.listShareLinks("c", tripId);
    expect(links).toEqual([
      {
        shareLinkId,
        createdAt: "2026-11-27T12:00:00.000Z",
        expiresAt: "2027-02-25T12:00:00.000Z",
        revokedAt: null,
        state: "ACTIVE",
        createdBy: "staff-principal-1",
      },
    ]);
    expect(JSON.stringify(links)).not.toMatch(/token/iu);
  });

  it("revokes idempotently and surfaces not-found from another agency", async () => {
    const { operations, repository } = makeStaff(["trip.view", "trip.publish"]);
    await operations.revokeShareLink("c", shareLinkId);
    await operations.revokeShareLink("c", shareLinkId);
    expect(repository.revokeShareLink).toHaveBeenCalledTimes(2);
    vi.mocked(repository.revokeShareLink).mockRejectedValueOnce(new ShareLinkNotFoundError());
    await expect(operations.revokeShareLink("c", shareLinkId)).rejects.toBeInstanceOf(
      ShareLinkNotFoundError,
    );
  });
});

const snapshot: TripSnapshotV1 = {
  schemaVersion: 1,
  trip: { title: "Portugal", startDate: "2026-10-12", endDate: "2026-10-15" },
  items: [],
};

describe("public share read", () => {
  const make = (record: { canonicalPayload: string } | null | Error, parse = (v: unknown) => v) => {
    const readByTokenHash = vi.fn(async (_hash: Uint8Array) => {
      if (record instanceof Error) throw record;
      return record;
    });
    const onFailure = vi.fn();
    const operations = createPublicShareOperations({
      reader: { readByTokenHash },
      crypto,
      parseSnapshot: parse as (value: unknown) => TripSnapshotV1,
      onFailure,
    });
    return { operations, readByTokenHash, onFailure };
  };
  const token = generateShareToken(crypto).token;

  it("returns the parsed snapshot for a known token", async () => {
    const { operations, readByTokenHash } = make({ canonicalPayload: JSON.stringify(snapshot) });
    await expect(operations.readPublicShare(token)).resolves.toEqual(snapshot);
    expect(vi.mocked(readByTokenHash).mock.calls[0]?.[0]).toEqual(
      hashPresentedShareToken(crypto, token),
    );
  });

  it("answers NOT_FOUND without any database call for malformed tokens", async () => {
    const { operations, readByTokenHash } = make({ canonicalPayload: "{}" });
    for (const bad of ["x", "a".repeat(44), undefined, 5]) {
      await expect(operations.readPublicShare(bad)).rejects.toBeInstanceOf(ShareLinkNotFoundError);
    }
    expect(readByTokenHash).not.toHaveBeenCalled();
  });

  it("answers NOT_FOUND for unknown links, reader errors and unparsable payloads, logging no token", async () => {
    await expect(make(null).operations.readPublicShare(token)).rejects.toBeInstanceOf(
      ShareLinkNotFoundError,
    );
    const failing = make(new Error(`boom ${token}`));
    await expect(failing.operations.readPublicShare(token)).rejects.toBeInstanceOf(
      ShareLinkNotFoundError,
    );
    expect(failing.onFailure).toHaveBeenCalledWith("READER_ERROR");
    const strict = make({ canonicalPayload: "{not json" });
    await expect(strict.operations.readPublicShare(token)).rejects.toBeInstanceOf(
      ShareLinkNotFoundError,
    );
    expect(strict.onFailure).toHaveBeenCalledWith("INVALID_PAYLOAD");
    expect(JSON.stringify(strict.onFailure.mock.calls)).not.toContain(token);
    const rejecting = make({ canonicalPayload: JSON.stringify(snapshot) }, () => {
      throw new Error("strict");
    });
    await expect(rejecting.operations.readPublicShare(token)).rejects.toBeInstanceOf(
      ShareLinkNotFoundError,
    );
  });
});
