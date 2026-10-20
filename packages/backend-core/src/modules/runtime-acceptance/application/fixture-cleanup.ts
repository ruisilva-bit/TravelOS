import type { StaffAuthorizationOperationProof } from "../../../staff-access/authorization.js";
import type { StaffPermissionId } from "../../../staff-access/permission-registry.js";
import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import type { RuntimeAcceptanceFixtureRunState } from "../domain/fixture-run-state.js";
import type { M1StaffTripPublicationOperations } from "../../customer-presentation/application/staff-publication-operations.js";
import type { M1StaffTripAccessOperations } from "../../portal-access/application/staff-trip-access-operations.js";
import {
  authorizeM1Operation,
  type M1StaffAuthorizationDependencies,
  type M1StaffTripOperations,
} from "../../trip-operations/application/m1-staff-operations.js";
import { M1InputValidationError } from "../../trip-operations/application/m1-trip-slice.js";

export const M1_RUNTIME_ACCEPTANCE_FIXTURE_MANAGE_PERMISSION_REQUIREMENTS = Object.freeze([
  "runtime_acceptance.fixture.manage",
] as const satisfies readonly StaffPermissionId[]);

export interface RuntimeAcceptanceCleanupCounts {
  readonly grantsRevoked: number;
  readonly publicationsWithdrawn: number;
  readonly tripsCancelled: number;
  readonly principalsRetired: number;
}

export interface RuntimeAcceptanceCleanupHistoryCounts {
  readonly publicationSnapshots: number;
  readonly auditRecords: number;
}

export interface RuntimeAcceptanceCleanupReceipt {
  readonly fixtureRunId: OpaqueId;
  readonly state: "CLEANED" | "CLEANUP_PENDING";
  readonly counts: RuntimeAcceptanceCleanupCounts;
  readonly retainedHistoryCounts: RuntimeAcceptanceCleanupHistoryCounts;
  readonly errorCode: "CLEANUP_STEP_FAILED" | "UNEXPECTED_RESOURCE" | null;
}

export interface RuntimeAcceptanceFixtureCleanupPlan {
  readonly agencyId: OpaqueId;
  readonly fixtureRunId: OpaqueId;
  readonly state: RuntimeAcceptanceFixtureRunState;
  readonly tripIds: readonly OpaqueId[];
  readonly activePublicationTripIds: readonly OpaqueId[];
  readonly activeGrants: readonly { readonly grantId: OpaqueId; readonly tripId: OpaqueId }[];
  readonly portalPrincipalId: string | null;
  readonly portalPrincipalRetired: boolean;
  readonly counts: RuntimeAcceptanceCleanupCounts;
  readonly retainedHistoryCounts: RuntimeAcceptanceCleanupHistoryCounts;
  readonly unexpectedResourceCount: number;
}

export type RuntimeAcceptanceCleanupStart =
  | { readonly status: "READY"; readonly plan: RuntimeAcceptanceFixtureCleanupPlan }
  | { readonly status: "CLEANED"; readonly receipt: RuntimeAcceptanceCleanupReceipt };

export interface RuntimeAcceptanceCleanupCommand {
  readonly agencyId: OpaqueId;
  readonly fixtureRunId: OpaqueId;
  readonly staffPrincipalId: string;
  readonly idempotencyKey: string;
}

export interface RuntimeAcceptanceFixtureCleanupRepository {
  beginCleanup(
    command: RuntimeAcceptanceCleanupCommand,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<RuntimeAcceptanceCleanupStart | null>;
  completeCleanup(
    command: RuntimeAcceptanceCleanupCommand,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<RuntimeAcceptanceCleanupReceipt | null>;
}

export interface M1RuntimeAcceptanceFixtureOperationsDependencies extends M1StaffAuthorizationDependencies {
  readonly repository: RuntimeAcceptanceFixtureCleanupRepository;
  readonly tripOperations: Pick<M1StaffTripOperations, "readTripSlice" | "cancelTrip">;
  readonly tripAccessOperations: Pick<
    M1StaffTripAccessOperations,
    "revokeTripAccessGrant" | "retireFixturePortalPrincipal"
  >;
  readonly publicationOperations: Pick<
    M1StaffTripPublicationOperations,
    "withdrawActivePublication"
  >;
}

export interface M1RuntimeAcceptanceFixtureOperations {
  cleanupFixture(
    cookieHeader: unknown,
    fixtureRunId: unknown,
    input: unknown,
  ): Promise<RuntimeAcceptanceCleanupReceipt>;
}

export class M1RuntimeAcceptanceFixtureNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;

  constructor() {
    super("Not found");
    this.name = "M1RuntimeAcceptanceFixtureNotFoundError";
  }
}

const MAX_RECEIPT_COUNT = 10_000;
const MAX_REGISTERED_TRIPS = 2;
const MAX_REGISTERED_GRANTS = 2;
const CLEANUP_REASON = "RUNTIME_ACCEPTANCE_CLEANUP" as const;
const RECENT_MFA_MAXIMUM_AGE_MS = 5 * 60 * 1_000;

const invalidInput = (): never => {
  throw new M1InputValidationError("Invalid runtime acceptance fixture cleanup request");
};

const parseCleanupRequest = (value: unknown): { readonly idempotencyKey: string } => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidInput();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidInput();
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (keys.length !== 1 || keys[0] !== "idempotencyKey") return invalidInput();
  const descriptor = Object.getOwnPropertyDescriptor(record, "idempotencyKey");
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !Object.hasOwn(descriptor, "value") ||
    typeof descriptor.value !== "string" ||
    descriptor.value.length < 1 ||
    descriptor.value.length > 128 ||
    [...descriptor.value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    })
  ) {
    return invalidInput();
  }
  return { idempotencyKey: descriptor.value };
};

const parseFixtureRunId = (value: unknown): OpaqueId => {
  if (typeof value !== "string") return invalidInput();
  try {
    return asOpaqueId(value);
  } catch {
    return invalidInput();
  }
};

const stableEffectKey = (fixtureRunId: OpaqueId, effect: string, resourceId: string): string =>
  `ra:${fixtureRunId}:${effect}:${resourceId}`;

const validCount = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_RECEIPT_COUNT;

const validCounts = (value: RuntimeAcceptanceCleanupCounts): boolean =>
  validCount(value.grantsRevoked) &&
  validCount(value.publicationsWithdrawn) &&
  validCount(value.tripsCancelled) &&
  validCount(value.principalsRetired);

const validHistoryCounts = (value: RuntimeAcceptanceCleanupHistoryCounts): boolean =>
  validCount(value.publicationSnapshots) && validCount(value.auditRecords);

const validatePlan = (
  plan: RuntimeAcceptanceFixtureCleanupPlan,
  agencyId: OpaqueId,
  fixtureRunId: OpaqueId,
): boolean => {
  if (
    plan.agencyId !== agencyId ||
    plan.fixtureRunId !== fixtureRunId ||
    plan.state !== "CLEANUP_PENDING" ||
    !Array.isArray(plan.tripIds) ||
    plan.tripIds.length > MAX_REGISTERED_TRIPS ||
    !Array.isArray(plan.activePublicationTripIds) ||
    plan.activePublicationTripIds.length > MAX_REGISTERED_TRIPS ||
    !Array.isArray(plan.activeGrants) ||
    plan.activeGrants.length > MAX_REGISTERED_GRANTS ||
    !validCount(plan.unexpectedResourceCount) ||
    !validCounts(plan.counts) ||
    !validHistoryCounts(plan.retainedHistoryCounts) ||
    typeof plan.portalPrincipalRetired !== "boolean"
  ) {
    return false;
  }
  if (
    plan.portalPrincipalId !== null &&
    (typeof plan.portalPrincipalId !== "string" || plan.portalPrincipalId.length === 0)
  ) {
    return false;
  }
  try {
    const tripIds = plan.tripIds.map((id) => asOpaqueId(id));
    const tripSet = new Set(tripIds);
    if (tripSet.size !== tripIds.length) return false;
    const publicationIds = plan.activePublicationTripIds.map((id) => asOpaqueId(id));
    if (
      new Set(publicationIds).size !== publicationIds.length ||
      publicationIds.some((id) => !tripSet.has(id))
    ) {
      return false;
    }
    const grantIds = plan.activeGrants.map(({ grantId, tripId }) => {
      asOpaqueId(grantId);
      return asOpaqueId(tripId);
    });
    if (
      new Set(plan.activeGrants.map(({ grantId }) => asOpaqueId(grantId))).size !==
        plan.activeGrants.length ||
      grantIds.some((tripId) => !tripSet.has(tripId)) ||
      (plan.activeGrants.length > 0 && plan.portalPrincipalId === null)
    ) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
};

const receiptFromPlan = (
  plan: RuntimeAcceptanceFixtureCleanupPlan,
  errorCode: RuntimeAcceptanceCleanupReceipt["errorCode"],
  counts: RuntimeAcceptanceCleanupCounts = plan.counts,
  retainedHistoryCounts: RuntimeAcceptanceCleanupHistoryCounts = plan.retainedHistoryCounts,
): RuntimeAcceptanceCleanupReceipt => ({
  fixtureRunId: plan.fixtureRunId,
  state: "CLEANUP_PENDING",
  counts,
  retainedHistoryCounts,
  errorCode,
});

export const createM1RuntimeAcceptanceFixtureOperations = (
  dependencies: M1RuntimeAcceptanceFixtureOperationsDependencies,
): M1RuntimeAcceptanceFixtureOperations => {
  const operations: M1RuntimeAcceptanceFixtureOperations = {
    async cleanupFixture(cookieHeader, fixtureRunIdValue, inputValue) {
      const fixtureRunId = parseFixtureRunId(fixtureRunIdValue);
      const request = parseCleanupRequest(inputValue);
      const authorization = await authorizeM1Operation(
        dependencies,
        cookieHeader,
        null,
        M1_RUNTIME_ACCEPTANCE_FIXTURE_MANAGE_PERMISSION_REQUIREMENTS,
        RECENT_MFA_MAXIMUM_AGE_MS,
      );
      const agencyId = asOpaqueId(authorization.session.agencyId);
      const command: RuntimeAcceptanceCleanupCommand = {
        agencyId,
        fixtureRunId,
        staffPrincipalId: authorization.session.staffPrincipalId,
        idempotencyKey: request.idempotencyKey,
      };
      const started = await dependencies.repository.beginCleanup(command, authorization);
      if (started === null) throw new M1RuntimeAcceptanceFixtureNotFoundError();
      if (started.status === "CLEANED") return started.receipt;

      const plan = started.plan;
      if (!validatePlan(plan, agencyId, fixtureRunId)) {
        return {
          fixtureRunId,
          state: "CLEANUP_PENDING",
          counts: {
            grantsRevoked: 0,
            publicationsWithdrawn: 0,
            tripsCancelled: 0,
            principalsRetired: 0,
          },
          retainedHistoryCounts: { publicationSnapshots: 0, auditRecords: 0 },
          errorCode: "UNEXPECTED_RESOURCE",
        };
      }
      if (plan.unexpectedResourceCount > 0) {
        return receiptFromPlan(plan, "UNEXPECTED_RESOURCE");
      }

      const counts = { ...plan.counts };
      const retainedHistoryCounts = { ...plan.retainedHistoryCounts };
      try {
        for (const grant of [...plan.activeGrants].toSorted((left, right) =>
          left.grantId.localeCompare(right.grantId),
        )) {
          await dependencies.tripAccessOperations.revokeTripAccessGrant(cookieHeader, {
            agencyId,
            grantId: grant.grantId,
            idempotencyKey: stableEffectKey(fixtureRunId, "grant.revoke", grant.grantId),
          });
          counts.grantsRevoked += 1;
        }

        for (const tripId of [...plan.activePublicationTripIds].toSorted()) {
          await dependencies.publicationOperations.withdrawActivePublication(cookieHeader, tripId, {
            reason: CLEANUP_REASON,
            idempotencyKey: stableEffectKey(fixtureRunId, "publication.withdraw", tripId),
          });
          counts.publicationsWithdrawn += 1;
        }

        for (const tripId of [...plan.tripIds].toSorted()) {
          const slice = await dependencies.tripOperations.readTripSlice(cookieHeader, tripId);
          if (slice === null) throw new Error("Registered fixture Trip is unavailable");
          if (slice.trip.state === "CANCELLED") continue;
          if (typeof slice.trip.lockVersion !== "bigint" || slice.trip.lockVersion < 0n) {
            throw new Error("Registered fixture Trip version is unavailable");
          }
          await dependencies.tripOperations.cancelTrip(cookieHeader, {
            tripId,
            expectedLockVersion: slice.trip.lockVersion.toString(),
            idempotencyKey: stableEffectKey(fixtureRunId, "trip.cancel", tripId),
          });
          counts.tripsCancelled += 1;
        }

        if (plan.portalPrincipalId !== null && !plan.portalPrincipalRetired) {
          await dependencies.tripAccessOperations.retireFixturePortalPrincipal(
            cookieHeader,
            fixtureRunId,
            plan.portalPrincipalId,
          );
          counts.principalsRetired = 1;
          retainedHistoryCounts.auditRecords += 1;
        }

        const completed = await dependencies.repository.completeCleanup(command, authorization);
        if (completed === null)
          return receiptFromPlan(plan, "CLEANUP_STEP_FAILED", counts, retainedHistoryCounts);
        return completed;
      } catch {
        return receiptFromPlan(plan, "CLEANUP_STEP_FAILED", counts, retainedHistoryCounts);
      }
    },
  };
  return Object.freeze(operations);
};
