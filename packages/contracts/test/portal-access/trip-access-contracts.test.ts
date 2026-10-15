import { describe, expect, it } from "vitest";

import * as adminContracts from "../../src/admin/index.js";

interface RuntimeSchema {
  parse(value: unknown): unknown;
  safeParse(value: unknown): { readonly success: boolean; readonly data?: unknown };
}

const schemaFor = (name: string): RuntimeSchema | null => {
  const value = (adminContracts as unknown as Record<string, unknown>)[name];
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<RuntimeSchema>;
  return typeof candidate.parse === "function" && typeof candidate.safeParse === "function"
    ? (candidate as RuntimeSchema)
    : null;
};

const issueSchema = schemaFor("AdminTripAccessGrantIssueV1RequestSchema");
const revokeSchema = schemaFor("AdminTripAccessGrantRevokeV1RequestSchema");
const responseSchema = schemaFor("AdminTripAccessGrantV1ResponseSchema");
const runWhenContractsExist =
  issueSchema !== null && revokeSchema !== null && responseSchema !== null ? it : it.skip;

const agencyId = "abcdef12-3456-7abc-8def-000000000001";
const tripId = "abcdef12-3456-7abc-8def-000000000002";
const grantId = "abcdef12-3456-7abc-8def-000000000003";

const activeGrant = {
  grantId,
  agencyId,
  portalPrincipalId: "portal-principal-1",
  tripId,
  capabilities: ["trip.view_current"],
  issuedByStaffPrincipalId: "staff-principal-1",
  issuedAt: "2026-10-15T10:00:00.000Z",
  expiresAt: null,
  relationshipLabel: null,
  revokedByStaffPrincipalId: null,
  revokedAt: null,
};

describe("Admin TripAccessGrant contracts", () => {
  it("exports strict versioned issue, revoke and response schemas from the Admin entrypoint", () => {
    expect(issueSchema).not.toBeNull();
    expect(revokeSchema).not.toBeNull();
    expect(responseSchema).not.toBeNull();
  });

  runWhenContractsExist(
    "accepts only explicit issue/revoke inputs and the fixed V1 capability response",
    () => {
      expect(
        issueSchema!.parse({
          agencyId,
          portalPrincipalId: "portal-principal-1",
          tripId,
          idempotencyKey: "grant-issue-001",
          expiresAt: "2030-12-31T23:59:59+00:00",
          relationshipLabel: "Primary traveller",
        }),
      ).toMatchObject({
        agencyId,
        portalPrincipalId: "portal-principal-1",
        tripId,
        idempotencyKey: "grant-issue-001",
        relationshipLabel: "Primary traveller",
      });
      expect(
        revokeSchema!.parse({ agencyId, grantId, idempotencyKey: "grant-revoke-001" }),
      ).toEqual({ agencyId, grantId, idempotencyKey: "grant-revoke-001" });
      expect(responseSchema!.parse(activeGrant)).toEqual(activeGrant);
    },
  );

  runWhenContractsExist(
    "rejects caller-selected capabilities, actor fields and unknown DTO values",
    () => {
      expect(
        issueSchema!.safeParse({
          agencyId,
          portalPrincipalId: "portal-principal-1",
          tripId,
          idempotencyKey: "grant-issue-001",
          capabilities: ["trip.view_current", "message.create"],
          issuedByStaffPrincipalId: "attacker-selected",
        }).success,
      ).toBe(false);
      expect(
        revokeSchema!.safeParse({
          agencyId,
          grantId,
          idempotencyKey: "grant-revoke-001",
          force: true,
        }).success,
      ).toBe(false);
      expect(
        responseSchema!.safeParse({ ...activeGrant, internalNote: "INTERNAL_ONLY sentinel" })
          .success,
      ).toBe(false);
    },
  );

  runWhenContractsExist(
    "rejects malformed identifiers, expired-format timestamps and inconsistent revoke facts",
    () => {
      expect(
        issueSchema!.safeParse({
          agencyId: "not-an-opaque-id",
          portalPrincipalId: "portal-principal-1",
          tripId,
          idempotencyKey: "grant-issue-001",
        }).success,
      ).toBe(false);
      expect(
        issueSchema!.safeParse({
          agencyId,
          portalPrincipalId: "portal-principal-1",
          tripId,
          idempotencyKey: "grant-issue-001",
          expiresAt: "2030-12-31T23:59:59.123456Z",
        }).success,
      ).toBe(false);
      expect(
        responseSchema!.safeParse({
          ...activeGrant,
          revokedAt: "2026-10-15T10:01:00.000Z",
        }).success,
      ).toBe(false);
    },
  );
});
