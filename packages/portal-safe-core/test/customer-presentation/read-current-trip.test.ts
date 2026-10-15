import { describe, expect, it } from "vitest";
import type { PortalTripSnapshotV1 } from "@travelos/contracts/portal";

import {
  readCurrentPortalTripSnapshot,
  type CurrentPublishedPortalTripSnapshotQuery,
  type CurrentPublishedPortalTripSnapshotReader,
  type ReadCurrentPortalTripSnapshotInput,
} from "../../src/customer-presentation/index.js";

type CurrentTripRead = CurrentPublishedPortalTripSnapshotQuery;
type CurrentTripReader = CurrentPublishedPortalTripSnapshotReader;
type ReadCurrentTripInput = ReadCurrentPortalTripSnapshotInput;
const readCurrentTrip = readCurrentPortalTripSnapshot;

const tripId = "00000000-0000-7000-8000-000000000072";
const agencyId = "00000000-0000-7000-8000-000000000071";
const portalSession = {
  realm: "PORTAL",
  sessionId: "portal-session-1",
  principalId: "portal-principal-1",
  expiresAtEpochMs: 2_000,
  agencyId,
  authorizationEpoch: 3n,
  recentMfaVerifiedAtEpochMs: null,
};
const snapshot: PortalTripSnapshotV1 = {
  schemaVersion: 1,
  trip: { title: "Lisboa", startDate: "2026-10-15", endDate: "2026-10-18" },
  items: [],
};
const inputFor = (reader: CurrentTripReader, overrides: Partial<ReadCurrentTripInput> = {}) => ({
  session: portalSession,
  tripId,
  nowEpochMs: 1_000,
  reader,
  ...overrides,
});

describe("current Portal Trip snapshot use case", () => {
  it("denies malformed and Staff realm sessions before querying the read port", async () => {
    let readCount = 0;
    const reader: CurrentTripReader = {
      async readCurrentPublishedTripSnapshot() {
        readCount += 1;
        return snapshot;
      },
    };

    await expect(
      readCurrentTrip(inputFor(reader, { session: { ...portalSession, realm: "STAFF" } })),
    ).resolves.toBeNull();
    await expect(
      readCurrentTrip(inputFor(reader, { session: { principalId: "portal-principal-1" } })),
    ).resolves.toBeNull();
    await expect(readCurrentTrip(inputFor(reader, { tripId: "not-a-uuid" }))).resolves.toBeNull();
    expect(readCount).toBe(0);
  });

  it("reads only the exact Agency, Portal principal, session epoch and Trip", async () => {
    const queries: CurrentTripRead[] = [];
    const reader: CurrentTripReader = {
      async readCurrentPublishedTripSnapshot(query) {
        queries.push(query);
        return query.tripId === tripId ? snapshot : null;
      },
    };

    await expect(readCurrentTrip(inputFor(reader))).resolves.toEqual(snapshot);
    await expect(
      readCurrentTrip(inputFor(reader, { tripId: "00000000-0000-7000-8000-000000000074" })),
    ).resolves.toBeNull();
    expect(queries).toEqual([
      {
        agencyId,
        portalPrincipalId: "portal-principal-1",
        portalSessionId: "portal-session-1",
        authorizationEpoch: 3n,
        tripId,
      },
      {
        agencyId,
        portalPrincipalId: "portal-principal-1",
        portalSessionId: "portal-session-1",
        authorizationEpoch: 3n,
        tripId: "00000000-0000-7000-8000-000000000074",
      },
    ]);
  });

  it("denies an expired session before querying the read port", async () => {
    let readCount = 0;
    const reader: CurrentTripReader = {
      async readCurrentPublishedTripSnapshot() {
        readCount += 1;
        return snapshot;
      },
    };

    await expect(
      readCurrentTrip(inputFor(reader, { session: { ...portalSession, expiresAtEpochMs: 1_000 } })),
    ).resolves.toBeNull();
    expect(readCount).toBe(0);
  });

  it("re-reads authorization on every request and denies revocation or stale epochs", async () => {
    let currentEpoch = 3n;
    let activeGrant = true;
    let reads = 0;
    const reader: CurrentTripReader = {
      async readCurrentPublishedTripSnapshot(query) {
        reads += 1;
        return activeGrant && query.authorizationEpoch === currentEpoch ? snapshot : null;
      },
    };

    await expect(readCurrentTrip(inputFor(reader))).resolves.toEqual(snapshot);
    currentEpoch = 4n;
    activeGrant = false;
    await expect(readCurrentTrip(inputFor(reader))).resolves.toBeNull();
    expect(reads).toBe(2);
  });

  it("preserves denial for expired or revoked grants and absent active publication", async () => {
    const reader: CurrentTripReader = {
      async readCurrentPublishedTripSnapshot() {
        return null;
      },
    };
    await expect(readCurrentTrip(inputFor(reader))).resolves.toBeNull();
  });

  it("rejects unknown snapshot fields without exposing their values", async () => {
    const reader: CurrentTripReader = {
      async readCurrentPublishedTripSnapshot() {
        return { ...snapshot, supplierCost: "STAGE7_INTERNAL_SENTINEL" };
      },
    };

    await expect(readCurrentTrip(inputFor(reader))).rejects.toMatchObject({
      name: "PortalSnapshotContractViolation",
      message: "Portal published snapshot failed strict contract validation",
    });
  });
});
