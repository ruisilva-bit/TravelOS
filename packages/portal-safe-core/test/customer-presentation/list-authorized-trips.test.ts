import { describe, expect, it, vi } from "vitest";

import * as customerPresentation from "../../src/customer-presentation/index.js";

type CurrentAuthorizedTripListQuery = {
  readonly agencyId: string;
  readonly portalPrincipalId: string;
  readonly portalSessionId: string;
  readonly authorizationEpoch: bigint;
  readonly limit: number;
  readonly cursor: string | null;
};

type CurrentAuthorizedTripListReader = {
  listCurrentAuthorizedTrips(query: CurrentAuthorizedTripListQuery): Promise<unknown>;
};

type ListAuthorizedPortalTripsInput = {
  readonly session: unknown;
  readonly nowEpochMs: number;
  readonly limit: number;
  readonly cursor: string | null;
  readonly reader: CurrentAuthorizedTripListReader;
};

type ListAuthorizedPortalTrips = (input: ListAuthorizedPortalTripsInput) => Promise<unknown | null>;

const agencyId = "00000000-0000-7000-8000-000000000071";
const tripId = "00000000-0000-7000-8000-000000000072";
const principalId = "portal-principal-synthetic";
const session = {
  realm: "PORTAL",
  sessionId: "portal-session-synthetic",
  principalId,
  expiresAtEpochMs: 2_000_000,
  agencyId,
  authorizationEpoch: 4n,
  recentMfaVerifiedAtEpochMs: null,
};
const publishedList = {
  items: [
    {
      tripId,
      publicationState: "PUBLISHED",
      snapshot: {
        schemaVersion: 1,
        trip: { title: "Synthetic trip", startDate: "2027-04-01", endDate: "2027-04-04" },
        items: [],
      },
    },
  ],
  nextCursor: null,
};

const listTrips = (): ListAuthorizedPortalTrips => {
  const candidate = (customerPresentation as unknown as Record<string, unknown>)[
    "listAuthorizedPortalTrips"
  ];
  expect(
    candidate,
    "listAuthorizedPortalTrips must be exported by customer-presentation",
  ).toBeTypeOf("function");
  return candidate as ListAuthorizedPortalTrips;
};

const inputFor = (
  reader: CurrentAuthorizedTripListReader,
  overrides: Partial<ListAuthorizedPortalTripsInput> = {},
): ListAuthorizedPortalTripsInput => ({
  session,
  nowEpochMs: 1_000_000,
  limit: 25,
  cursor: null,
  reader,
  ...overrides,
});

describe("authorized Portal Trip listing", () => {
  it("derives scoped session identity and returns only a validated publication page", async () => {
    let receivedQuery: CurrentAuthorizedTripListQuery | undefined;
    const reader: CurrentAuthorizedTripListReader = {
      async listCurrentAuthorizedTrips(query) {
        receivedQuery = query;
        return publishedList;
      },
    };

    await expect(listTrips()(inputFor(reader, { limit: 10, cursor: tripId }))).resolves.toEqual(
      publishedList,
    );
    expect(receivedQuery).toEqual({
      agencyId,
      portalPrincipalId: principalId,
      portalSessionId: "portal-session-synthetic",
      authorizationEpoch: 4n,
      limit: 10,
      cursor: tripId,
    });
  });

  it("does not query for expired or malformed sessions and invalid pagination", async () => {
    const reader: CurrentAuthorizedTripListReader = {
      listCurrentAuthorizedTrips: vi.fn(async () => publishedList),
    };

    await expect(
      listTrips()(inputFor(reader, { session: { ...session, expiresAtEpochMs: 1_000_000 } })),
    ).resolves.toBeNull();
    await expect(listTrips()(inputFor(reader, { limit: 51 }))).resolves.toBeNull();
    await expect(listTrips()(inputFor(reader, { cursor: "not-a-uuid" }))).resolves.toBeNull();
    expect(reader.listCurrentAuthorizedTrips).not.toHaveBeenCalled();
  });

  it("fails closed when the reader returns fields outside the Portal list contract", async () => {
    const reader: CurrentAuthorizedTripListReader = {
      async listCurrentAuthorizedTrips() {
        return {
          items: [{ tripId, publicationState: "NO_PUBLICATION", workspaceTitle: "secret" }],
          nextCursor: null,
        };
      },
    };

    await expect(listTrips()(inputFor(reader))).rejects.toMatchObject({
      name: "PortalTripListContractViolation",
      message: "Portal authorized Trip list failed strict contract validation",
    });
  });

  it("fails closed when the reader exceeds the requested page limit", async () => {
    const reader: CurrentAuthorizedTripListReader = {
      async listCurrentAuthorizedTrips() {
        return {
          items: [
            { tripId, publicationState: "NO_PUBLICATION" },
            { tripId: "00000000-0000-7000-8000-000000000073", publicationState: "NO_PUBLICATION" },
          ],
          nextCursor: "00000000-0000-7000-8000-000000000073",
        };
      },
    };

    await expect(listTrips()(inputFor(reader, { limit: 1 }))).rejects.toMatchObject({
      name: "PortalTripListContractViolation",
    });
  });
});
