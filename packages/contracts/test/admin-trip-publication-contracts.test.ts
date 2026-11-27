import { describe, expect, it } from "vitest";
import {
  AdminCreateShareLinkV1RequestSchema,
  AdminShareLinkCreatedV1ResponseSchema,
  AdminShareLinkListV1ResponseSchema,
  AdminTripPublicationPreviewV1Schema,
} from "../src/admin/trips/index.js";

const projection = {
  schemaVersion: 1 as const,
  trip: { title: "Portugal", startDate: "2026-10-12", endDate: "2026-10-15" },
  items: [],
};
const token = "A".repeat(43);

describe("Admin preview and share-link contracts", () => {
  it("accepts explicit preview and share allowlists", () => {
    expect(
      AdminTripPublicationPreviewV1Schema.parse({
        workspaceRevision: "3",
        projectionHash: "a".repeat(64),
        schemaVersion: 1,
        projection,
      }).projection,
    ).toEqual(projection);
    expect(AdminCreateShareLinkV1RequestSchema.parse({}).expiresInDays).toBeUndefined();
    expect(AdminCreateShareLinkV1RequestSchema.parse({ expiresInDays: 30 }).expiresInDays).toBe(30);
  });

  it("rejects unknown top-level and nested fields and out-of-range validity", () => {
    expect(
      AdminTripPublicationPreviewV1Schema.safeParse({
        workspaceRevision: "3",
        projectionHash: "a".repeat(64),
        schemaVersion: 1,
        projection: { ...projection, privateNote: "INTERNAL_ONLY sentinel" },
      }).success,
    ).toBe(false);
    for (const body of [
      { bypassAuthorization: true },
      { expiresInDays: 0 },
      { expiresInDays: 366 },
      { expiresInDays: 1.5 },
      { expiresInDays: "30" },
    ]) {
      expect(AdminCreateShareLinkV1RequestSchema.safeParse(body).success).toBe(false);
    }
  });

  it("only the creation response may carry a token; the list contract has no such field", () => {
    const summary = {
      shareLinkId: "00000000-0000-7000-8000-000000000001",
      createdAt: "2026-11-27T10:00:00.000Z",
      expiresAt: "2027-02-25T10:00:00.000Z",
      revokedAt: null,
      state: "ACTIVE" as const,
      createdBy: "staff-1",
    };
    expect(AdminShareLinkListV1ResponseSchema.safeParse({ links: [summary] }).success).toBe(true);
    expect(
      AdminShareLinkListV1ResponseSchema.safeParse({ links: [{ ...summary, token }] }).success,
    ).toBe(false);
    expect(
      AdminShareLinkListV1ResponseSchema.safeParse({
        links: [{ ...summary, tokenHash: "00" }],
      }).success,
    ).toBe(false);
    expect(
      AdminShareLinkCreatedV1ResponseSchema.safeParse({
        shareLinkId: summary.shareLinkId,
        token,
        url: `https://admin.example.test/v/${token}`,
        createdAt: summary.createdAt,
        expiresAt: summary.expiresAt,
      }).success,
    ).toBe(true);
  });
});
