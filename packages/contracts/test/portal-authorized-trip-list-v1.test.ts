import { describe, expect, it } from "vitest";

import * as portalContracts from "../src/portal/index.js";

type RuntimeSchema = {
  parse(input: unknown): unknown;
  safeParse(input: unknown): { readonly success: boolean };
};

const schema = (name: string): RuntimeSchema => {
  const value = (portalContracts as unknown as Record<string, unknown>)[name];
  expect(value, `${name} must be exported by the Portal contracts`).toBeDefined();
  return value as RuntimeSchema;
};

const tripId = "00000000-0000-7000-8000-000000000072";
const cursor = "00000000-0000-7000-8000-000000000073";
const snapshot = {
  schemaVersion: 1,
  trip: { title: "Synthetic published Trip", startDate: "2027-04-01", endDate: "2027-04-04" },
  items: [],
};

describe("Portal authorized Trip list V1 contract", () => {
  it("parses strict bounded pagination with safe defaults", () => {
    const querySchema = schema("PortalAuthorizedTripListV1QuerySchema");
    expect(querySchema.parse({})).toEqual({ limit: 25, cursor: null });
    expect(querySchema.parse({ limit: "50", cursor })).toEqual({ limit: 50, cursor });
  });

  it("rejects unknown query fields, malformed cursors, and out-of-range limits", () => {
    for (const query of [
      { unsupported: "1" },
      { limit: "0" },
      { limit: "51" },
      { limit: "1.5" },
      { limit: "01" },
      { cursor: "not-a-uuid" },
    ]) {
      expect(schema("PortalAuthorizedTripListV1QuerySchema").safeParse(query).success).toBe(false);
    }
  });

  it("accepts only an authorized published snapshot or a no-publication marker", () => {
    expect(
      schema("PortalAuthorizedTripListV1ResponseSchema").parse({
        items: [
          { tripId, publicationState: "PUBLISHED", snapshot },
          { tripId: cursor, publicationState: "NO_PUBLICATION" },
        ],
        nextCursor: null,
      }),
    ).toEqual({
      items: [
        { tripId, publicationState: "PUBLISHED", snapshot },
        { tripId: cursor, publicationState: "NO_PUBLICATION" },
      ],
      nextCursor: null,
    });
  });

  it("rejects workspace, customer, INTERNAL_ONLY, and malformed publication fields", () => {
    const invalidResponses = [
      {
        items: [{ tripId, publicationState: "NO_PUBLICATION", title: "Mutable workspace title" }],
        nextCursor: null,
      },
      {
        items: [
          {
            tripId,
            publicationState: "PUBLISHED",
            snapshot: { ...snapshot, internalNote: "INTERNAL_ONLY sentinel" },
          },
        ],
        nextCursor: null,
      },
      {
        items: [{ tripId, publicationState: "PUBLISHED", snapshot, customer: "Customer PII" }],
        nextCursor: null,
      },
      {
        items: [{ tripId, publicationState: "NO_PUBLICATION", snapshot }],
        nextCursor: null,
      },
      { items: [], nextCursor: null, agencyId: "untrusted-scope" },
      {
        items: Array.from({ length: 51 }, (_, index) => ({
          tripId: `00000000-0000-7000-8000-${String(index + 100).padStart(12, "0")}`,
          publicationState: "NO_PUBLICATION",
        })),
        nextCursor: null,
      },
    ];

    for (const response of invalidResponses) {
      expect(schema("PortalAuthorizedTripListV1ResponseSchema").safeParse(response).success).toBe(
        false,
      );
    }
  });
});
