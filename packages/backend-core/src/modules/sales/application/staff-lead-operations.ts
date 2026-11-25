import type { StaffAuthorizationOperationProof } from "../../../staff-access/authorization.js";
import type { StaffPermissionId } from "../../../staff-access/permission-registry.js";
import { asOpaqueId, type OpaqueId } from "../../../shared-kernel/opaque-id.js";
import {
  authorizeOperation,
  type StaffAuthorizationDependencies,
} from "../../trip-operations/application/staff-trip-operations.js";
import { InputValidationError } from "../../trip-operations/application/trip-slice.js";
import {
  LEAD_STATES,
  validateCustomerDisplayName,
  validateDisqualificationReason,
  validateLeadDraft,
  type Lead,
  type LeadDisqualificationReason,
  type LeadDraft,
  type LeadQualificationMode,
  type LeadState,
} from "../domain/lead.js";

/** Fixed policy per use case; persistence adapters re-check it inside the command transaction. */
export const LEAD_PERMISSION_REQUIREMENTS = Object.freeze({
  VIEW: Object.freeze(["sales.view"] as const satisfies readonly StaffPermissionId[]),
  EDIT: Object.freeze(["sales.edit"] as const satisfies readonly StaffPermissionId[]),
  QUALIFY: Object.freeze([
    "sales.edit",
    "customer.edit",
  ] as const satisfies readonly StaffPermissionId[]),
});

export const LEAD_LIST_MAXIMUM_LIMIT = 100;
export const LEAD_IDEMPOTENCY_KEY_MAXIMUM_LENGTH = 128;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export interface LeadPage {
  readonly items: readonly Lead[];
  readonly nextCursor: OpaqueId | null;
}

export interface LeadListQuery {
  readonly limit: number;
  readonly cursor: OpaqueId | null;
  readonly state: LeadState | null;
}

export interface CreateLeadInput {
  readonly lead: LeadDraft;
  readonly idempotencyKey: string | null;
}

export interface UpdateLeadInput {
  readonly expectedLockVersion: bigint;
  readonly lead: LeadDraft;
}

export interface QualifyLeadInput {
  readonly expectedLockVersion: bigint;
  readonly mode: LeadQualificationMode;
  readonly idempotencyKey: string | null;
}

export interface DisqualifyLeadInput {
  readonly expectedLockVersion: bigint;
  readonly reason: LeadDisqualificationReason;
  readonly idempotencyKey: string | null;
}

export interface LeadRepository {
  listLeads(
    agencyId: OpaqueId,
    query: LeadListQuery,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<LeadPage>;
  getLead(
    agencyId: OpaqueId,
    leadId: OpaqueId,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<Lead | null>;
  createLead(
    agencyId: OpaqueId,
    lead: LeadDraft,
    idempotencyKey: string | null,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<Lead>;
  updateLead(
    agencyId: OpaqueId,
    leadId: OpaqueId,
    expectedLockVersion: bigint,
    lead: LeadDraft,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<Lead | null>;
  qualifyLead(
    agencyId: OpaqueId,
    leadId: OpaqueId,
    expectedLockVersion: bigint,
    mode: LeadQualificationMode,
    idempotencyKey: string | null,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<Lead | null>;
  disqualifyLead(
    agencyId: OpaqueId,
    leadId: OpaqueId,
    expectedLockVersion: bigint,
    reason: LeadDisqualificationReason,
    idempotencyKey: string | null,
    authorization: StaffAuthorizationOperationProof,
  ): Promise<Lead | null>;
}

export interface StaffLeadOperations {
  listLeads(cookieHeader: unknown, query: LeadListQuery): Promise<LeadPage>;
  getLead(cookieHeader: unknown, leadId: OpaqueId): Promise<Lead>;
  createLead(cookieHeader: unknown, input: CreateLeadInput): Promise<Lead>;
  updateLead(cookieHeader: unknown, leadId: OpaqueId, input: UpdateLeadInput): Promise<Lead>;
  qualifyLead(cookieHeader: unknown, leadId: OpaqueId, input: QualifyLeadInput): Promise<Lead>;
  disqualifyLead(
    cookieHeader: unknown,
    leadId: OpaqueId,
    input: DisqualifyLeadInput,
  ): Promise<Lead>;
}

export interface StaffLeadOperationsDependencies extends StaffAuthorizationDependencies {
  readonly repository: LeadRepository;
}

/** Returned for a missing Lead, a missing linked Customer, or any cross-Agency identifier. */
export class LeadNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;

  constructor() {
    super("Lead resource not found");
    this.name = "LeadNotFoundError";
  }
}

export class LeadIdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_CONFLICT" as const;

  constructor() {
    super("The idempotency key was already used for a different Lead request");
    this.name = "LeadIdempotencyConflictError";
  }
}

const validated = <Result>(work: () => Result): Result => {
  try {
    return work();
  } catch (error) {
    if (error instanceof InputValidationError) throw error;
    throw new InputValidationError(error instanceof Error ? error.message : "Invalid Lead input");
  }
};

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
};

export const validateLeadIdempotencyKey = (value: unknown): string | null => {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > LEAD_IDEMPOTENCY_KEY_MAXIMUM_LENGTH ||
    containsControlCharacter(value)
  ) {
    throw new InputValidationError("Lead idempotency key is invalid");
  }
  return value;
};

const validateExpectedLockVersion = (value: unknown): bigint => {
  if (typeof value !== "bigint" || value < 1n || value > POSTGRES_BIGINT_MAX) {
    throw new InputValidationError("Lead expected lock version is invalid");
  }
  return value;
};

const validateLeadId = (value: unknown): OpaqueId =>
  validated(() => {
    if (typeof value !== "string") throw new Error("Lead identifier is invalid");
    return asOpaqueId(value);
  });

const validateListQuery = (query: LeadListQuery): LeadListQuery =>
  validated(() => {
    if (
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > LEAD_LIST_MAXIMUM_LIMIT
    ) {
      throw new Error("Lead list limit is invalid");
    }
    if (query.state !== null && !(LEAD_STATES as readonly unknown[]).includes(query.state)) {
      throw new Error("Lead list state filter is invalid");
    }
    return {
      limit: query.limit,
      cursor: query.cursor === null ? null : asOpaqueId(query.cursor),
      state: query.state,
    };
  });

/**
 * Validates the qualification mode and, for CREATE_CUSTOMER, the Person and Customer shapes that
 * would be derived from the Lead. A LINK_CUSTOMER request never creates or modifies a Person.
 */
const validateQualificationMode = (mode: LeadQualificationMode): LeadQualificationMode =>
  validated(() => {
    if (mode.kind === "LINK_CUSTOMER") {
      return { kind: "LINK_CUSTOMER", customerId: asOpaqueId(mode.customerId) };
    }
    if (mode.kind !== "CREATE_CUSTOMER") throw new Error("Lead qualification mode is invalid");
    const customerDisplayName =
      mode.customerDisplayName === null ? null : mode.customerDisplayName.trim();
    // Shape-check the explicit name now; the derived default is checked again against the stored Lead.
    if (customerDisplayName !== null) validateCustomerDisplayName(customerDisplayName);
    return { kind: "CREATE_CUSTOMER", customerDisplayName };
  });

const requireLead = (lead: Lead | null): Lead => {
  if (lead === null) throw new LeadNotFoundError();
  return lead;
};

export const createStaffLeadOperations = (
  dependencies: StaffLeadOperationsDependencies,
): StaffLeadOperations => {
  const operations: StaffLeadOperations = {
    async listLeads(cookieHeader, query) {
      const normalized = validateListQuery(query);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        LEAD_PERMISSION_REQUIREMENTS.VIEW,
      );
      return dependencies.repository.listLeads(
        asOpaqueId(authorization.session.agencyId),
        normalized,
        authorization,
      );
    },

    async getLead(cookieHeader, leadId) {
      const normalizedLeadId = validateLeadId(leadId);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        LEAD_PERMISSION_REQUIREMENTS.VIEW,
      );
      return requireLead(
        await dependencies.repository.getLead(
          asOpaqueId(authorization.session.agencyId),
          normalizedLeadId,
          authorization,
        ),
      );
    },

    async createLead(cookieHeader, input) {
      const draft = validated(() => validateLeadDraft(input.lead));
      const idempotencyKey = validateLeadIdempotencyKey(input.idempotencyKey);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        LEAD_PERMISSION_REQUIREMENTS.EDIT,
      );
      return dependencies.repository.createLead(
        asOpaqueId(authorization.session.agencyId),
        draft,
        idempotencyKey,
        authorization,
      );
    },

    async updateLead(cookieHeader, leadId, input) {
      const normalizedLeadId = validateLeadId(leadId);
      const expectedLockVersion = validateExpectedLockVersion(input.expectedLockVersion);
      const draft = validated(() => validateLeadDraft(input.lead));
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        LEAD_PERMISSION_REQUIREMENTS.EDIT,
      );
      return requireLead(
        await dependencies.repository.updateLead(
          asOpaqueId(authorization.session.agencyId),
          normalizedLeadId,
          expectedLockVersion,
          draft,
          authorization,
        ),
      );
    },

    async qualifyLead(cookieHeader, leadId, input) {
      const normalizedLeadId = validateLeadId(leadId);
      const expectedLockVersion = validateExpectedLockVersion(input.expectedLockVersion);
      const mode = validateQualificationMode(input.mode);
      const idempotencyKey = validateLeadIdempotencyKey(input.idempotencyKey);
      // Qualification may create CRM records, so both permissions are required, never either.
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        LEAD_PERMISSION_REQUIREMENTS.QUALIFY,
      );
      return requireLead(
        await dependencies.repository.qualifyLead(
          asOpaqueId(authorization.session.agencyId),
          normalizedLeadId,
          expectedLockVersion,
          mode,
          idempotencyKey,
          authorization,
        ),
      );
    },

    async disqualifyLead(cookieHeader, leadId, input) {
      const normalizedLeadId = validateLeadId(leadId);
      const expectedLockVersion = validateExpectedLockVersion(input.expectedLockVersion);
      const reason = validated(() => validateDisqualificationReason(input.reason));
      const idempotencyKey = validateLeadIdempotencyKey(input.idempotencyKey);
      const authorization = await authorizeOperation(
        dependencies,
        cookieHeader,
        null,
        LEAD_PERMISSION_REQUIREMENTS.EDIT,
      );
      return requireLead(
        await dependencies.repository.disqualifyLead(
          asOpaqueId(authorization.session.agencyId),
          normalizedLeadId,
          expectedLockVersion,
          reason,
          idempotencyKey,
          authorization,
        ),
      );
    },
  };
  return Object.freeze(operations);
};
