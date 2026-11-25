import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import type { StaffAuthorizationOperationProof } from "../../../staff-access/authorization.js";
import type { StaffPermissionId } from "../../../staff-access/permission-registry.js";
import {
  authorizeOperation,
  type StaffAuthorizationDependencies,
} from "../../trip-operations/application/staff-trip-operations.js";
import { InputValidationError } from "../../trip-operations/application/trip-slice.js";
import { TRIP_ACCESS_CAPABILITY_IDS, type TripAccessGrant } from "../domain/trip-access-grant.js";

export const TRIP_ACCESS_MANAGE_PERMISSION_ID =
  "trip.access.manage" as const satisfies StaffPermissionId;
export const STAFF_TRIP_ACCESS_PERMISSION_REQUIREMENTS = Object.freeze([
  TRIP_ACCESS_MANAGE_PERMISSION_ID,
] as const);
export const STAFF_FIXTURE_PORTAL_RETIREMENT_PERMISSION_REQUIREMENTS = Object.freeze([
  "runtime_acceptance.fixture.manage",
  TRIP_ACCESS_MANAGE_PERMISSION_ID,
] as const satisfies readonly StaffPermissionId[]);
export const FIXTURE_PORTAL_PRINCIPAL_RETIREMENT_REASON = "RUNTIME_ACCEPTANCE_CLEANUP" as const;

export interface IssueTripAccessGrantCommand {
  readonly agencyId: OpaqueId;
  readonly portalPrincipalId: string;
  readonly tripId: OpaqueId;
  readonly capabilities: typeof TRIP_ACCESS_CAPABILITY_IDS;
  readonly idempotencyKey: string;
  readonly expiresAt: string | null;
  readonly relationshipLabel: string | null;
}

export interface RevokeTripAccessGrantCommand {
  readonly agencyId: OpaqueId;
  readonly grantId: OpaqueId;
  readonly idempotencyKey: string;
}

export interface RetireFixturePortalPrincipalCommand {
  readonly agencyId: OpaqueId;
  readonly fixtureRunId: OpaqueId;
  readonly portalPrincipalId: string;
  readonly reason: typeof FIXTURE_PORTAL_PRINCIPAL_RETIREMENT_REASON;
}

export interface PortalPrincipalRetirementResult {
  readonly portalPrincipalId: string;
  readonly retiredAt: string;
  readonly authorizationEpoch: bigint;
}

export interface StaffTripAccessRepository {
  issueTripAccessGrant(
    command: IssueTripAccessGrantCommand,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripAccessGrant | null>;
  revokeTripAccessGrant(
    command: RevokeTripAccessGrantCommand,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<TripAccessGrant | null>;
  retireFixturePortalPrincipal(
    command: RetireFixturePortalPrincipalCommand,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<PortalPrincipalRetirementResult | null>;
}

export interface StaffTripAccessOperations {
  issueTripAccessGrant(cookieHeader: unknown, input: unknown): Promise<TripAccessGrant>;
  revokeTripAccessGrant(cookieHeader: unknown, input: unknown): Promise<TripAccessGrant>;
  retireFixturePortalPrincipal(
    cookieHeader: unknown,
    fixtureRunId: unknown,
    portalPrincipalId: unknown,
  ): Promise<PortalPrincipalRetirementResult>;
}

export interface StaffTripAccessOperationsDependencies extends StaffAuthorizationDependencies {
  readonly repository: StaffTripAccessRepository;
}

export class StaffTripAccessNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;

  constructor() {
    super("Not found");
    this.name = "M1StaffTripAccessNotFoundError";
  }
}

type UnknownRecord = Record<string, unknown>;

const invalidInput = (): never => {
  throw new InputValidationError("Invalid Trip access request");
};

const recordWithExactKeys = (
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): UnknownRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidInput();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidInput();

  const record = value as UnknownRecord;
  const actualKeys = Reflect.ownKeys(record);
  if (actualKeys.some((key) => typeof key !== "string")) return invalidInput();
  const stringKeys = actualKeys as string[];
  if (
    requiredKeys.some((key) => !Object.hasOwn(record, key)) ||
    stringKeys.some((key) => !requiredKeys.includes(key) && !optionalKeys.includes(key))
  ) {
    return invalidInput();
  }
  if (
    actualKeys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      return (
        descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")
      );
    })
  ) {
    return invalidInput();
  }
  return record;
};

const opaqueIdField = (record: UnknownRecord, field: string): OpaqueId => {
  const value = record[field];
  if (typeof value !== "string") return invalidInput();
  try {
    return asOpaqueId(value);
  } catch {
    return invalidInput();
  }
};

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
const RFC3339_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

const parseInstant = (value: unknown): { readonly epochMs: number; readonly iso: string } => {
  if (typeof value !== "string") return invalidInput();
  const match = RFC3339_INSTANT.exec(value);
  if (match === null) return invalidInput();

  const localTimestamp = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${(match[7] ?? "").padEnd(3, "0")}Z`;
  const localEpochMs = Date.parse(localTimestamp);
  if (!Number.isFinite(localEpochMs) || new Date(localEpochMs).toISOString() !== localTimestamp) {
    return invalidInput();
  }
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) return invalidInput();
  return { epochMs, iso: new Date(epochMs).toISOString() };
};

const idempotencyKeyField = (record: UnknownRecord): string => {
  const value = record.idempotencyKey;
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    hasControlCharacter(value)
  ) {
    return invalidInput();
  }
  return value;
};

const portalPrincipalIdField = (record: UnknownRecord): string => {
  const value = record.portalPrincipalId;
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 255 ||
    value !== value.trim() ||
    hasControlCharacter(value)
  ) {
    return invalidInput();
  }
  return value;
};

const relationshipLabelField = (record: UnknownRecord): string | null => {
  if (!Object.hasOwn(record, "relationshipLabel")) return null;
  const value = record.relationshipLabel;
  if (typeof value !== "string" || hasControlCharacter(value)) return invalidInput();
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 200) return invalidInput();
  return normalized;
};

const parseIssueCommand = (
  value: unknown,
): {
  readonly command: Omit<IssueTripAccessGrantCommand, "capabilities">;
  readonly expiryEpochMs: number | null;
} => {
  try {
    const record = recordWithExactKeys(
      value,
      ["agencyId", "portalPrincipalId", "tripId", "idempotencyKey"],
      ["expiresAt", "relationshipLabel"],
    );
    const expiry = Object.hasOwn(record, "expiresAt") ? parseInstant(record.expiresAt) : null;
    return {
      command: {
        agencyId: opaqueIdField(record, "agencyId"),
        portalPrincipalId: portalPrincipalIdField(record),
        tripId: opaqueIdField(record, "tripId"),
        idempotencyKey: idempotencyKeyField(record),
        expiresAt: expiry?.iso ?? null,
        relationshipLabel: relationshipLabelField(record),
      },
      expiryEpochMs: expiry?.epochMs ?? null,
    };
  } catch {
    return invalidInput();
  }
};

const parseRevokeCommand = (value: unknown): RevokeTripAccessGrantCommand => {
  try {
    const record = recordWithExactKeys(value, ["agencyId", "grantId", "idempotencyKey"], []);
    return {
      agencyId: opaqueIdField(record, "agencyId"),
      grantId: opaqueIdField(record, "grantId"),
      idempotencyKey: idempotencyKeyField(record),
    };
  } catch {
    return invalidInput();
  }
};

const parseFixtureRunId = (value: unknown): OpaqueId => {
  if (typeof value !== "string") return invalidInput();
  try {
    return asOpaqueId(value);
  } catch {
    return invalidInput();
  }
};

export const createStaffTripAccessOperations = (
  dependencies: StaffTripAccessOperationsDependencies,
): StaffTripAccessOperations => {
  const operations: StaffTripAccessOperations = {
    async issueTripAccessGrant(cookieHeader, input) {
      const { command, expiryEpochMs } = parseIssueCommand(input);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        command.agencyId,
        STAFF_TRIP_ACCESS_PERMISSION_REQUIREMENTS,
      );
      if (expiryEpochMs !== null && expiryEpochMs <= authorization.nowEpochMs)
        return invalidInput();

      const grant = await dependencies.repository.issueTripAccessGrant(
        { ...command, capabilities: TRIP_ACCESS_CAPABILITY_IDS },
        authorization,
      );
      if (grant === null) throw new StaffTripAccessNotFoundError();
      return grant;
    },

    async revokeTripAccessGrant(cookieHeader, input) {
      const command = parseRevokeCommand(input);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        command.agencyId,
        STAFF_TRIP_ACCESS_PERMISSION_REQUIREMENTS,
      );
      const grant = await dependencies.repository.revokeTripAccessGrant(command, authorization);
      if (grant === null) throw new StaffTripAccessNotFoundError();
      return grant;
    },

    async retireFixturePortalPrincipal(cookieHeader, fixtureRunIdValue, principalIdValue) {
      const fixtureRunId = parseFixtureRunId(fixtureRunIdValue);
      const portalPrincipalId = portalPrincipalIdField({ portalPrincipalId: principalIdValue });
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        STAFF_FIXTURE_PORTAL_RETIREMENT_PERMISSION_REQUIREMENTS,
        5 * 60 * 1_000,
      );
      const result = await dependencies.repository.retireFixturePortalPrincipal(
        {
          agencyId: asOpaqueId(authorization.session.agencyId),
          fixtureRunId,
          portalPrincipalId,
          reason: FIXTURE_PORTAL_PRINCIPAL_RETIREMENT_REASON,
        },
        authorization,
      );
      if (result === null) throw new StaffTripAccessNotFoundError();
      return result;
    },
  };
  return Object.freeze(operations);
};
