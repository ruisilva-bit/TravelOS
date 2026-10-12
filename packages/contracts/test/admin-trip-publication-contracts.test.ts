import { describe, expect, it } from "vitest";
import {
  AdminPublishTripV1RequestSchema,
  AdminTripPublicationPreviewV1Schema,
} from "../src/admin/trips/index.js";

const projection = {
  schemaVersion: 1 as const,
  trip: { title: "Portugal", startDate: "2026-10-12", endDate: "2026-10-15" },
  items: [],
};

describe("Admin publication contracts", () => {
  it("accepts explicit preview and publish allowlists", () => {
    expect(
      AdminTripPublicationPreviewV1Schema.parse({
        workspaceRevision: "3",
        projectionHash: "a".repeat(64),
        schemaVersion: 1,
        projection,
      }).projection,
    ).toEqual(projection);
    expect(
      AdminPublishTripV1RequestSchema.parse({
        expectedWorkspaceRevision: "3",
        expectedProjectionHash: "b".repeat(64),
        idempotencyKey: "publish-001",
      }).idempotencyKey,
    ).toBe("publish-001");
  });

  it("rejects unknown top-level and nested fields", () => {
    expect(
      AdminTripPublicationPreviewV1Schema.safeParse({
        workspaceRevision: "3",
        projectionHash: "a".repeat(64),
        schemaVersion: 1,
        projection: { ...projection, privateNote: "INTERNAL_ONLY sentinel" },
      }).success,
    ).toBe(false);
    expect(
      AdminPublishTripV1RequestSchema.safeParse({
        expectedWorkspaceRevision: "3",
        expectedProjectionHash: "b".repeat(64),
        idempotencyKey: "publish-001",
        bypassAuthorization: true,
      }).success,
    ).toBe(false);
  });
});
