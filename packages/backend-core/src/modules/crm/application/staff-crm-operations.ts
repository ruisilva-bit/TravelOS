import type { StaffAuthorizationOperationProof } from "../../../staff-access/authorization.js";
import type { StaffPermissionId } from "../../../staff-access/permission-registry.js";
import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import {
  authorizeOperation,
  StaffAuthorizationError,
  type StaffAuthorizationDependencies,
} from "../../trip-operations/application/staff-trip-operations.js";
import { InputValidationError } from "../../trip-operations/application/trip-slice.js";
import {
  hasSensitivePersonFields,
  redactSensitivePerson,
  validateCustomerDetails,
  validateCustomerRoles,
  validatePersonDetails,
  validatePersonUpdate,
  validateSearchQuery,
  utcToday,
  type CrmCustomerRole,
  type CustomerDetailsDraft,
  type PersonDetailsDraft,
  type PersonUpdateDraft,
} from "../domain/crm.js";

/** Fixed policy per use case; persistence adapters re-check it inside the command transaction. */
export const CRM_PERMISSION_REQUIREMENTS = Object.freeze({
  VIEW: Object.freeze(["customer.view"] as const satisfies readonly StaffPermissionId[]),
  // Detail and search also expose Lead and Trip summaries, so those view permissions are required.
  DETAIL: Object.freeze([
    "customer.view",
    "sales.view",
    "trip.view",
  ] as const satisfies readonly StaffPermissionId[]),
  EDIT: Object.freeze(["customer.edit"] as const satisfies readonly StaffPermissionId[]),
  PERSON_EDIT: Object.freeze(["traveller.edit"] as const satisfies readonly StaffPermissionId[]),
  // Writing sensitive identity fields requires the grant that reads them, checked before any write.
  SENSITIVE_PERSON_EDIT: Object.freeze([
    "traveller.edit",
    "traveller.view_sensitive",
  ] as const satisfies readonly StaffPermissionId[]),
  SENSITIVE_VIEW: Object.freeze([
    "traveller.view_sensitive",
  ] as const satisfies readonly StaffPermissionId[]),
});

export const CRM_LIST_MAXIMUM_LIMIT = 50;
export const CRM_SEARCH_RESULT_LIMIT = 5;
export const CRM_IDEMPOTENCY_KEY_MAXIMUM_LENGTH = 128;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export interface CrmPersonRecord {
  readonly id: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly givenName: string;
  readonly familyName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly nationality: string | null;
  readonly notes: string | null;
  readonly birthDate: string | null;
  readonly passportNumber: string | null;
  readonly passportExpiry: string | null;
  readonly lockVersion: bigint;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CrmCustomerSummary {
  readonly id: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly primaryContactName: string | null;
  readonly lockVersion: bigint;
  readonly updatedAt: string;
}

export interface CrmCustomerPerson extends CrmPersonRecord {
  readonly roles: readonly CrmCustomerRole[];
  readonly isPrimary: boolean;
}

export interface CrmLeadSummary {
  readonly id: OpaqueId;
  readonly name: string;
  readonly state: string;
}

export interface CrmTripSummary {
  readonly id: OpaqueId;
  readonly title: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly state: string;
}

export interface CrmCustomerDetail {
  readonly id: OpaqueId;
  readonly agencyId: OpaqueId;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly notes: string | null;
  readonly lockVersion: bigint;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly people: readonly CrmCustomerPerson[];
  readonly leads: readonly CrmLeadSummary[];
  readonly trips: readonly CrmTripSummary[];
}

export interface CrmCustomerPage {
  readonly items: readonly CrmCustomerSummary[];
  readonly nextCursor: OpaqueId | null;
}

export interface CrmCustomerListQuery {
  readonly limit: number;
  readonly cursor: OpaqueId | null;
  readonly query: string | null;
}

export interface CrmSearchResult {
  readonly customers: readonly CrmCustomerSummary[];
  readonly leads: readonly CrmLeadSummary[];
  readonly trips: readonly CrmTripSummary[];
}

export interface CreateCustomerInput {
  readonly customer: CustomerDetailsDraft;
  readonly primaryPerson: PersonDetailsDraft;
  readonly idempotencyKey: string | null;
}

export interface UpdateCustomerInput {
  readonly expectedLockVersion: bigint;
  readonly customer: CustomerDetailsDraft;
}

export interface AddPersonInput {
  readonly person: PersonDetailsDraft;
  readonly roles: readonly CrmCustomerRole[];
}

export interface UpdatePersonInput {
  readonly expectedLockVersion: bigint;
  readonly person: PersonUpdateDraft;
}

export interface SetPersonRolesInput {
  readonly roles: readonly CrmCustomerRole[];
  readonly isPrimary: boolean;
}

export interface CrmRepository {
  listCustomers(
    agencyId: OpaqueId,
    query: CrmCustomerListQuery,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<CrmCustomerPage>;
  getCustomer(
    agencyId: OpaqueId,
    customerId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<CrmCustomerDetail | null>;
  createCustomer(
    agencyId: OpaqueId,
    input: CreateCustomerInput,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<CrmCustomerDetail>;
  updateCustomer(
    agencyId: OpaqueId,
    customerId: OpaqueId,
    expectedLockVersion: bigint,
    customer: CustomerDetailsDraft,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<CrmCustomerDetail | null>;
  addPerson(
    agencyId: OpaqueId,
    customerId: OpaqueId,
    input: AddPersonInput,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<CrmCustomerDetail | null>;
  updatePerson(
    agencyId: OpaqueId,
    personId: OpaqueId,
    expectedLockVersion: bigint,
    person: PersonUpdateDraft,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<CrmPersonRecord | null>;
  setPersonRoles(
    agencyId: OpaqueId,
    customerId: OpaqueId,
    personId: OpaqueId,
    input: SetPersonRolesInput,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<CrmCustomerDetail | null>;
  search(
    agencyId: OpaqueId,
    query: string,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<CrmSearchResult>;
}

export interface StaffCrmOperations {
  listCustomers(cookieHeader: unknown, query: CrmCustomerListQuery): Promise<CrmCustomerPage>;
  getCustomer(cookieHeader: unknown, customerId: OpaqueId): Promise<CrmCustomerDetail>;
  createCustomer(cookieHeader: unknown, input: CreateCustomerInput): Promise<CrmCustomerDetail>;
  updateCustomer(
    cookieHeader: unknown,
    customerId: OpaqueId,
    input: UpdateCustomerInput,
  ): Promise<CrmCustomerDetail>;
  addPerson(
    cookieHeader: unknown,
    customerId: OpaqueId,
    input: AddPersonInput,
  ): Promise<CrmCustomerDetail>;
  updatePerson(
    cookieHeader: unknown,
    personId: OpaqueId,
    input: UpdatePersonInput,
  ): Promise<CrmPersonRecord>;
  setPersonRoles(
    cookieHeader: unknown,
    customerId: OpaqueId,
    personId: OpaqueId,
    input: SetPersonRolesInput,
  ): Promise<CrmCustomerDetail>;
  search(cookieHeader: unknown, query: unknown): Promise<CrmSearchResult>;
}

export interface StaffCrmOperationsDependencies extends StaffAuthorizationDependencies {
  readonly repository: CrmRepository;
}

/** Returned for a missing Customer or Person, or any cross-Agency identifier. */
export class CrmNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;

  constructor() {
    super("CRM resource not found");
    this.name = "CrmNotFoundError";
  }
}

export class CrmIdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_CONFLICT" as const;

  constructor() {
    super("The idempotency key was already used for a different Customer request");
    this.name = "CrmIdempotencyConflictError";
  }
}

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
};

const validated = <Result>(work: () => Result): Result => {
  try {
    return work();
  } catch (error) {
    if (error instanceof InputValidationError) throw error;
    throw new InputValidationError(error instanceof Error ? error.message : "Invalid CRM input");
  }
};

export const validateCrmIdempotencyKey = (value: unknown): string | null => {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > CRM_IDEMPOTENCY_KEY_MAXIMUM_LENGTH ||
    containsControlCharacter(value)
  ) {
    throw new InputValidationError("Customer idempotency key is invalid");
  }
  return value;
};

const validateLockVersion = (value: unknown): bigint => {
  // Customers and Persons are created at lockVersion zero, so zero is a valid expectation.
  if (typeof value !== "bigint" || value < 0n || value > POSTGRES_BIGINT_MAX) {
    throw new InputValidationError("CRM expected lock version is invalid");
  }
  return value;
};

const validateId = (value: unknown, label: string): OpaqueId =>
  validated(() => {
    if (typeof value !== "string") throw new Error(`${label} identifier is invalid`);
    return asOpaqueId(value);
  });

const validateListQuery = (query: CrmCustomerListQuery): CrmCustomerListQuery =>
  validated(() => {
    if (
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > CRM_LIST_MAXIMUM_LIMIT
    ) {
      throw new Error("Customer list limit is invalid");
    }
    return {
      limit: query.limit,
      cursor: query.cursor === null ? null : asOpaqueId(query.cursor),
      query: query.query === null ? null : validateSearchQuery(query.query),
    };
  });

const validateRoles = (roles: unknown): readonly CrmCustomerRole[] =>
  validated(() => validateCustomerRoles(roles));

const requireFound = <Value>(value: Value | null): Value => {
  if (value === null) throw new CrmNotFoundError();
  return value;
};

/**
 * Whether the caller holds one permission. A missing grant is `false`; an unauthenticated caller
 * still fails closed by rethrowing, so this never widens access.
 */
const holds = async (
  dependencies: StaffCrmOperationsDependencies,
  cookieHeader: unknown,
  permissionIds: readonly StaffPermissionId[],
): Promise<boolean> => {
  try {
    await authorizeOperation(dependencies, cookieHeader, null, permissionIds);
    return true;
  } catch (error) {
    if (error instanceof StaffAuthorizationError && error.code === "FORBIDDEN") return false;
    throw error;
  }
};

/** Redacts sensitive traveller fields in every person of a Customer detail. */
const redactDetail = (detail: CrmCustomerDetail, canViewSensitive: boolean): CrmCustomerDetail => ({
  ...detail,
  people: detail.people.map((person) => redactSensitivePerson(person, canViewSensitive)),
});

const redactPerson = (person: CrmPersonRecord, canViewSensitive: boolean): CrmPersonRecord =>
  redactSensitivePerson(person, canViewSensitive);

export const createStaffCrmOperations = (
  dependencies: StaffCrmOperationsDependencies,
): StaffCrmOperations => {
  const { repository } = dependencies;

  /** Reads the caller's sensitive-view grant once per operation, after the main permission check. */
  const sensitiveViewAllowed = (cookieHeader: unknown): Promise<boolean> =>
    holds(dependencies, cookieHeader, CRM_PERMISSION_REQUIREMENTS.SENSITIVE_VIEW);

  const operations: StaffCrmOperations = {
    async listCustomers(cookieHeader, query) {
      const normalized = validateListQuery(query);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        CRM_PERMISSION_REQUIREMENTS.VIEW,
      );
      return repository.listCustomers(
        asOpaqueId(authorization.session.agencyId),
        normalized,
        authorization,
      );
    },

    async getCustomer(cookieHeader, customerId) {
      const normalizedCustomerId = validateId(customerId, "Customer");
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        CRM_PERMISSION_REQUIREMENTS.DETAIL,
      );
      const detail = requireFound(
        await repository.getCustomer(
          asOpaqueId(authorization.session.agencyId),
          normalizedCustomerId,
          authorization,
        ),
      );
      return redactDetail(detail, await sensitiveViewAllowed(cookieHeader));
    },

    async createCustomer(cookieHeader, input) {
      const customer = validated(() => validateCustomerDetails(input.customer));
      const primaryPerson = validated(() => validatePersonDetails(input.primaryPerson));
      const idempotencyKey = validateCrmIdempotencyKey(input.idempotencyKey);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        CRM_PERMISSION_REQUIREMENTS.EDIT,
      );
      const detail = await repository.createCustomer(
        asOpaqueId(authorization.session.agencyId),
        { customer, primaryPerson, idempotencyKey },
        authorization,
      );
      return redactDetail(detail, await sensitiveViewAllowed(cookieHeader));
    },

    async updateCustomer(cookieHeader, customerId, input) {
      const normalizedCustomerId = validateId(customerId, "Customer");
      const expectedLockVersion = validateLockVersion(input.expectedLockVersion);
      const customer = validated(() => validateCustomerDetails(input.customer));
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        CRM_PERMISSION_REQUIREMENTS.EDIT,
      );
      const detail = requireFound(
        await repository.updateCustomer(
          asOpaqueId(authorization.session.agencyId),
          normalizedCustomerId,
          expectedLockVersion,
          customer,
          authorization,
        ),
      );
      return redactDetail(detail, await sensitiveViewAllowed(cookieHeader));
    },

    async addPerson(cookieHeader, customerId, input) {
      const normalizedCustomerId = validateId(customerId, "Customer");
      const person = validated(() => validatePersonDetails(input.person));
      const roles = validateRoles(input.roles);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        CRM_PERMISSION_REQUIREMENTS.EDIT,
      );
      const detail = requireFound(
        await repository.addPerson(
          asOpaqueId(authorization.session.agencyId),
          normalizedCustomerId,
          { person, roles },
          authorization,
        ),
      );
      return redactDetail(detail, await sensitiveViewAllowed(cookieHeader));
    },

    async updatePerson(cookieHeader, personId, input) {
      const normalizedPersonId = validateId(personId, "Person");
      const expectedLockVersion = validateLockVersion(input.expectedLockVersion);
      const person = validated(() => validatePersonUpdate(input.person, utcToday()));
      const sensitive = hasSensitivePersonFields(person);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        sensitive
          ? CRM_PERMISSION_REQUIREMENTS.SENSITIVE_PERSON_EDIT
          : CRM_PERMISSION_REQUIREMENTS.PERSON_EDIT,
      );
      const canViewSensitive = await sensitiveViewAllowed(cookieHeader);
      const updated = requireFound(
        await repository.updatePerson(
          asOpaqueId(authorization.session.agencyId),
          normalizedPersonId,
          expectedLockVersion,
          person,
          authorization,
        ),
      );
      return redactPerson(updated, canViewSensitive);
    },

    async setPersonRoles(cookieHeader, customerId, personId, input) {
      const normalizedCustomerId = validateId(customerId, "Customer");
      const normalizedPersonId = validateId(personId, "Person");
      const roles = validateRoles(input.roles);
      if (typeof input.isPrimary !== "boolean") {
        throw new InputValidationError("Customer primary flag is invalid");
      }
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        CRM_PERMISSION_REQUIREMENTS.EDIT,
      );
      const detail = requireFound(
        await repository.setPersonRoles(
          asOpaqueId(authorization.session.agencyId),
          normalizedCustomerId,
          normalizedPersonId,
          { roles, isPrimary: input.isPrimary },
          authorization,
        ),
      );
      return redactDetail(detail, await sensitiveViewAllowed(cookieHeader));
    },

    async search(cookieHeader, query) {
      const normalized = validated(() => validateSearchQuery(query));
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        CRM_PERMISSION_REQUIREMENTS.DETAIL,
      );
      return repository.search(
        asOpaqueId(authorization.session.agencyId),
        normalized,
        authorization,
      );
    },
  };
  return Object.freeze(operations);
};
