import { describe, expect, it, vi } from "vitest";
import * as backendCore from "../../src/index.js";

const agencyId = "018f47b2-9c6e-7a31-8e4d-3c9b6a10d001";
const fixtureRunId = "018f47b2-9c6e-7a31-8e4d-3c9b6a10d002";
const firstTripId = "018f47b2-9c6e-7a31-8e4d-3c9b6a10d003";
const secondTripId = "018f47b2-9c6e-7a31-8e4d-3c9b6a10d004";
const portalPrincipalId = "018f47b2-9c6e-7a31-8e4d-3c9b6a10d005";
const grantId = "018f47b2-9c6e-7a31-8e4d-3c9b6a10d006";
const staffPrincipalId = "018f47b2-9c6e-7a31-8e4d-3c9b6a10d007";
const sessionId = "stage7-cleanup-test-session";
const nowEpochMs = 1_800_000_000_000;

interface CleanupReceipt {
  readonly fixtureRunId: string;
  readonly state: "CLEANED" | "CLEANUP_PENDING";
  readonly counts: {
    readonly grantsRevoked: number;
    readonly publicationsWithdrawn: number;
    readonly tripsCancelled: number;
    readonly principalsRetired: number;
  };
  readonly retainedHistoryCounts: {
    readonly publicationSnapshots: number;
    readonly auditRecords: number;
  };
  readonly errorCode: "CLEANUP_STEP_FAILED" | "UNEXPECTED_RESOURCE" | null;
}

interface CleanupOperations {
  cleanupFixture(cookieHeader: unknown, runId: unknown, input: unknown): Promise<CleanupReceipt>;
}

interface CleanupFactoryExports {
  readonly createM1RuntimeAcceptanceFixtureOperations?: (
    dependencies: unknown,
  ) => CleanupOperations;
}

const createOperations = (dependencies: unknown): CleanupOperations => {
  const factory = (backendCore as unknown as CleanupFactoryExports)
    .createM1RuntimeAcceptanceFixtureOperations;
  expect(factory, "runtime-acceptance cleanup application factory must be exported").toBeTypeOf(
    "function",
  );
  return factory!(dependencies);
};

const fixturePlan = (overrides: Record<string, unknown> = {}) => ({
  agencyId,
  fixtureRunId,
  state: "CLEANUP_PENDING",
  tripIds: [firstTripId, secondTripId],
  activePublicationTripIds: [firstTripId],
  activeGrants: [{ grantId, tripId: firstTripId }],
  portalPrincipalId,
  portalPrincipalRetired: false,
  retainedHistoryCounts: { publicationSnapshots: 2, auditRecords: 4 },
  counts: { grantsRevoked: 0, publicationsWithdrawn: 0, tripsCancelled: 0, principalsRetired: 0 },
  unexpectedResourceCount: 0,
  ...overrides,
});

const makeDependencies = ({
  plan = fixturePlan(),
  failEffect,
}: {
  plan?: ReturnType<typeof fixturePlan>;
  failEffect?: "revoke" | "withdraw" | "cancel" | "retire";
} = {}) => {
  const events: string[] = [];
  const effectCalls: Array<{ effect: string; idempotencyKey?: unknown }> = [];
  const tripStates = new Map([
    [firstTripId, "CONFIRMED"],
    [secondTripId, "CONFIRMED"],
  ]);
  const failOnce = new Set<string>();
  const fail = (effect: string): void => {
    if (failEffect === effect && !failOnce.has(effect)) {
      failOnce.add(effect);
      throw new Error("synthetic transient operation failure; do not expose");
    }
  };
  const repository = {
    beginCleanup: vi.fn(async () => {
      events.push("begin");
      return { status: "READY", plan };
    }),
    completeCleanup: vi.fn(async () => {
      events.push("complete");
      return {
        fixtureRunId,
        state: "CLEANED" as const,
        counts: {
          grantsRevoked: 1,
          publicationsWithdrawn: 1,
          tripsCancelled: 2,
          principalsRetired: 1,
        },
        retainedHistoryCounts: { publicationSnapshots: 2, auditRecords: 5 },
        errorCode: null,
      };
    }),
  };
  const tripAccessOperations = {
    revokeTripAccessGrant: vi.fn(async (_cookie: unknown, input: Record<string, unknown>) => {
      events.push("revoke");
      effectCalls.push({ effect: "revoke", idempotencyKey: input.idempotencyKey });
      fail("revoke");
      return { status: "REVOKED" };
    }),
    retireFixturePortalPrincipal: vi.fn(
      async (_cookie: unknown, _runId: unknown, _principalId: unknown) => {
        events.push("retire");
        effectCalls.push({ effect: "retire" });
        fail("retire");
        return { portalPrincipalId, authorizationEpoch: 2n };
      },
    ),
  };
  const publicationOperations = {
    withdrawActivePublication: vi.fn(
      async (_cookie: unknown, _tripId: unknown, input: Record<string, unknown>) => {
        events.push("withdraw");
        effectCalls.push({ effect: "withdraw", idempotencyKey: input.idempotencyKey });
        fail("withdraw");
        return { status: "WITHDRAWN" };
      },
    ),
  };
  const tripOperations = {
    readTripSlice: vi.fn(async (_cookie: unknown, tripId: string) => ({
      trip: {
        id: tripId,
        state: tripStates.get(tripId) ?? "CONFIRMED",
        lockVersion: 0n,
      },
    })),
    cancelTrip: vi.fn(async (_cookie: unknown, input: Record<string, unknown>) => {
      events.push("cancel");
      effectCalls.push({
        effect: `cancel:${String(input.tripId)}`,
        idempotencyKey: input.idempotencyKey,
      });
      fail("cancel");
      tripStates.set(String(input.tripId), "CANCELLED");
      return { trip: { id: input.tripId, state: "CANCELLED", lockVersion: 1n } };
    }),
  };
  const dependencies = {
    repository,
    tripOperations,
    tripAccessOperations,
    publicationOperations,
    authorizationRepository: {
      getStaffAuthorizationSnapshot: vi.fn(async () => ({
        staffPrincipalId,
        agencyId,
        membershipState: "ACTIVE",
        authorizationEpoch: 1n,
        assignments: [
          {
            agencyId,
            permissionId: "runtime_acceptance.fixture.manage",
            scopeKind: "AGENCY",
            organizationUnitId: null,
            accessLevel: "ALL",
            active: true,
          },
        ],
      })),
    },
    sessionResolver: {
      resolveStaffSession: vi.fn(async () => ({
        sessionId,
        staffPrincipalId,
        agencyId,
        authorizationEpoch: 1n,
        expiresAtEpochMs: nowEpochMs + 60_000,
        recentMfaVerifiedAtEpochMs: nowEpochMs,
      })),
    },
    nowEpochMs: () => nowEpochMs,
  };
  return {
    operations: createOperations(dependencies),
    repository,
    effectCalls,
    events,
    tripOperations,
    tripAccessOperations,
    publicationOperations,
  };
};

describe("runtime-acceptance fixture cleanup", () => {
  it("cleanupRetriesAfterFailureAtEachEffect", async () => {
    for (const failEffect of ["revoke", "withdraw", "cancel", "retire"] as const) {
      const harness = makeDependencies({ failEffect });
      const input = { idempotencyKey: `cleanup-${failEffect}-retry` };
      const pending = await harness.operations.cleanupFixture(
        "staff-session-cookie=opaque",
        fixtureRunId,
        input,
      );
      expect(pending).toMatchObject({ state: "CLEANUP_PENDING", errorCode: "CLEANUP_STEP_FAILED" });
      expect(pending.fixtureRunId).toBe(fixtureRunId);
      expect(JSON.stringify(pending)).not.toContain("synthetic transient operation failure");
      expect(harness.repository.completeCleanup).not.toHaveBeenCalled();

      const cleaned = await harness.operations.cleanupFixture(
        "staff-session-cookie=opaque",
        fixtureRunId,
        input,
      );
      expect(cleaned).toMatchObject({
        fixtureRunId,
        state: "CLEANED",
        retainedHistoryCounts: { publicationSnapshots: 2 },
      });
      expect(harness.repository.beginCleanup).toHaveBeenCalledTimes(2);
      expect(harness.repository.completeCleanup).toHaveBeenCalledTimes(1);
      for (const effect of ["revoke", "withdraw", `cancel:${firstTripId}`]) {
        const keys = harness.effectCalls
          .filter((call) => call.effect === effect)
          .map((call) => call.idempotencyKey);
        expect(keys).not.toHaveLength(0);
        expect(new Set(keys).size).toBe(1);
      }
      expect(harness.events[0]).toBe("begin");
      expect(harness.events.at(-1)).toBe("complete");
    }
  });

  it("cleanupRejectsUnexpectedGrantWithoutMutatingIt", async () => {
    const harness = makeDependencies({ plan: fixturePlan({ unexpectedResourceCount: 1 }) });
    const receipt = await harness.operations.cleanupFixture(
      "staff-session-cookie=opaque",
      fixtureRunId,
      { idempotencyKey: "cleanup-unexpected-resource" },
    );

    expect(receipt).toMatchObject({
      fixtureRunId,
      state: "CLEANUP_PENDING",
      errorCode: "UNEXPECTED_RESOURCE",
    });
    expect(harness.tripAccessOperations.revokeTripAccessGrant).not.toHaveBeenCalled();
    expect(harness.publicationOperations.withdrawActivePublication).not.toHaveBeenCalled();
    expect(harness.tripOperations.cancelTrip).not.toHaveBeenCalled();
    expect(harness.tripAccessOperations.retireFixturePortalPrincipal).not.toHaveBeenCalled();
    expect(harness.repository.completeCleanup).not.toHaveBeenCalled();
  });
});
