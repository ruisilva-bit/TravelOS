export {
  NestedTransactionNotSupportedError,
  TRANSACTION_NESTING_POLICY,
  type TransactionContext,
  type TransactionPort,
  type TransactionWork,
} from "./application/transaction.js";
export {
  bootstrapRootAgency,
  ROOT_AGENCY_OWNER_TEMPLATE,
  type OwnerRoleTemplate,
  type RootAgencyBootstrapInput,
  type RootAgencyBootstrapPort,
  type RootAgencyBootstrapResult,
} from "./agency-organization/agency-bootstrap.js";
export {
  authorizeStaffRequest,
  protectsLastActiveOwner,
  type LastActiveOwnerPolicyInput,
  type StaffAuthorizationAssignment,
  type StaffAuthorizationDecision,
  type StaffAuthorizationDenial,
  type StaffAuthorizationRequest,
  type StaffAuthorizationOperationProof,
  type StaffAuthorizationSnapshot,
  type StaffAuthorizationTarget,
  type StaffMembershipState,
  type StaffSessionAuthorizationProof,
} from "./staff-access/authorization.js";
export {
  isStaffPermissionId,
  OWNER_ROLE_PERMISSION_IDS,
  OWNER_ROLE_TEMPLATE_KEY,
  PERMISSION_REGISTRY_VERSION,
  permissionDefinitionFor,
  STAGE_4_PERMISSION_REGISTRY,
  STAGE_5_PERMISSION_REGISTRY,
  type AuthorizationScopeKind,
  type PermissionDefinition,
  type ResourceAccessLevel,
  type StaffPermissionId,
} from "./staff-access/permission-registry.js";
export {
  asOpaqueId,
  isOpaqueUuid,
  isUuidV7,
  uuidV7FromEntropy,
  type OpaqueId,
} from "./shared-kernel/opaque-id.js";
export {
  CURRENCY_SCALES,
  ROUNDING_POLICY_REGISTRY,
  addMoney,
  assertSameCurrency,
  createMoney,
  moneyEquals,
  moneyFromJson,
  moneyToJson,
  multiplyMoney,
  roundingPolicyFor,
  subtractMoney,
  type CurrencyCode,
  type Money,
  type MoneyJson,
  type RoundingPolicyId,
} from "./shared-kernel/money/money.js";
export {
  assertIanaTimezone,
  assertLocalDate,
  createLocalDate,
  createScheduledLocalDateTime,
  isCanonicalTravelTimezone,
  TRAVELOS_POSTGRESQL_TIMEZONE_EXCLUSIONS,
  TRAVELOS_CANONICAL_TIMEZONE_NAMES,
  TRAVELOS_TIMEZONE_CONTRACT_VERSION,
  type ScheduledLocalDateTime,
} from "./shared-kernel/time.js";
export {
  M1OptimisticConflictError,
  M1TransactionConflictError,
  M1InputValidationError,
  type CreateM1TripSliceInput,
  type M1OperationalSliceRepository,
  type UpdateAccommodationInput,
  type UpdateInternalNoteInput,
} from "./modules/trip-operations/application/m1-trip-slice.js";
export {
  createM1StaffTripOperations,
  M1StaffAuthorizationError,
  type M1StaffAuthorizationRepository,
  type M1StaffSessionResolver,
  type M1StaffTripOperations,
  type M1StaffTripOperationsDependencies,
} from "./modules/trip-operations/application/m1-staff-operations.js";
export {
  INTERNAL_ONLY_FIELD_CLASSIFICATION,
  type SupplierCostDraft,
  type SupplierCostLine,
} from "./modules/finance-operations/domain/supplier-cost.js";
export {
  type AccommodationDraft,
  type AccommodationItem,
  type FlightDraft,
  type FlightItem,
  type ItineraryItemFamily,
  type M1TripSlice,
  type Reservation,
  type ReservationDraft,
  type ReservationItemLink,
  type ReservationState,
  type Trip,
  type TripState,
} from "./modules/trip-operations/domain/m1-slice.js";
export {
  type Customer,
  type CustomerDraft,
  type CustomerPerson,
  type CustomerPersonRole,
  type Person,
  type PersonDraft,
  type PrimaryTripTraveller,
  type TripTraveller,
  type TripTravellerRole,
} from "./modules/crm/domain/continuity.js";
