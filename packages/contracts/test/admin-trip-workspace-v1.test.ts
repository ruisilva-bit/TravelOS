import { describe, expect, it } from "vitest";

const contracts = (await import("../src/admin/index.js")) as unknown as Record<string, unknown>;
const schemaFrom = (
  name: string,
):
  | { parse(value: unknown): unknown; safeParse(value: unknown): { success: boolean } }
  | undefined => {
  const value = contracts[name];
  return typeof value === "object" && value !== null
    ? (value as {
        parse(value: unknown): unknown;
        safeParse(value: unknown): { success: boolean };
      })
    : undefined;
};

const agencyId = "00000000-0000-7000-8000-000000000101";
const tripId = "00000000-0000-7000-8000-000000000102";
const cursorId = "00000000-0000-7000-8000-000000000103";
const trip = {
  id: tripId,
  agencyId,
  title: "Trip contract fixture",
  startDate: "2026-10-26",
  endDate: "2026-10-30",
  state: "DRAFT",
  workspaceRevision: "7",
  lockVersion: "2",
};
const listResponse = { items: [trip], nextCursor: null };
const detailResponse = { trip, flights: [], accommodations: [] };

describe("Admin Trip workspace V1 contracts", () => {
  it("accepts_strict_workspace_list_and_detail_allowlists", () => {
    const listSchema = schemaFrom("AdminTripWorkspaceListV1ResponseSchema");
    const detailSchema = schemaFrom("AdminTripWorkspaceV1ResponseSchema");

    expect(listSchema).toBeDefined();
    expect(detailSchema).toBeDefined();
    expect(listSchema?.parse(listResponse)).toEqual(listResponse);
    expect(detailSchema?.parse(detailResponse)).toEqual(detailResponse);
    expect(Object.keys(detailResponse).toSorted()).toEqual(["accommodations", "flights", "trip"]);
  });

  it("rejects_unknown_fields_and_out_of_range_pagination", () => {
    const listSchema = schemaFrom("AdminTripWorkspaceListV1ResponseSchema");
    const detailSchema = schemaFrom("AdminTripWorkspaceV1ResponseSchema");
    const querySchema = schemaFrom("AdminTripWorkspaceListV1QuerySchema");

    expect(listSchema).toBeDefined();
    expect(detailSchema).toBeDefined();
    expect(querySchema).toBeDefined();
    expect(querySchema?.parse({})).toEqual({ limit: 25, cursor: null });
    expect(querySchema?.parse({ limit: "50", cursor: cursorId })).toEqual({
      limit: 50,
      cursor: cursorId,
    });
    expect(querySchema?.safeParse({ limit: "0" }).success).toBe(false);
    expect(querySchema?.safeParse({ limit: "51" }).success).toBe(false);
    expect(querySchema?.safeParse({ limit: "abc" }).success).toBe(false);
    expect(querySchema?.safeParse({ limit: "25", unexpected: "value" }).success).toBe(false);
    expect(
      listSchema?.safeParse({ items: Array.from({ length: 51 }, () => trip), nextCursor: null })
        .success,
    ).toBe(false);
    expect(detailSchema?.safeParse({ ...detailResponse, supplierCosts: [] }).success).toBe(false);
    expect(
      detailSchema?.safeParse({ ...detailResponse, trip: { ...trip, internalNote: "sentinel" } })
        .success,
    ).toBe(false);
  });

  it("accepts_only_the_strict_minimal_trip_workspace_create_request", () => {
    const schema = schemaFrom("AdminTripWorkspaceCreateV1RequestSchema");
    const request = {
      customer: { displayName: "Costa Norte Viagens" },
      primaryTraveller: { givenName: "Ana", familyName: "Matos" },
      trip: { title: "Lisboa a Porto", startDate: "2026-10-26", endDate: "2026-10-30" },
    };

    expect(schema).toBeDefined();
    expect(schema?.parse(request)).toEqual(request);
    expect(schema?.safeParse({ ...request, agencyId }).success).toBe(false);
    expect(
      schema?.safeParse({ ...request, reservation: { supplierName: "Supplier" } }).success,
    ).toBe(false);
    expect(
      schema?.safeParse({
        ...request,
        primaryTraveller: { ...request.primaryTraveller, email: "ana@example.test" },
      }).success,
    ).toBe(false);
    expect(
      schema?.safeParse({ ...request, trip: { ...request.trip, state: "CONFIRMED" } }).success,
    ).toBe(false);
    expect(
      schema?.safeParse({
        ...request,
        trip: { ...request.trip, startDate: "2026-10-31" },
      }).success,
    ).toBe(false);
  });
});
