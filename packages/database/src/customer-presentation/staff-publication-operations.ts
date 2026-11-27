import {
  createStaffTripPreviewOperations,
  type StaffSessionResolver,
  type StaffTripPreviewOperations,
  type TripSnapshotValidatorPort,
} from "@travelos/backend-core";
import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { createTripSnapshotSha256Hasher } from "../customer-presentation/snapshot-hash.js";
import { createPostgresStaffTripPreviewRepository } from "../customer-presentation/staff-publication-repository.js";
import { createStaffAccessRepository } from "../staff-access/staff-access-repository.js";

/** Composes the authorized read-only preview; callers supply the independent V1 contract validator. */
export const createPostgresStaffTripPreviewOperations = (
  persistence: PostgresPersistence<Record<string, never>>,
  sessionResolver: StaffSessionResolver,
  validator: TripSnapshotValidatorPort,
): StaffTripPreviewOperations =>
  createStaffTripPreviewOperations({
    repository: createPostgresStaffTripPreviewRepository(
      persistence,
      createTripSnapshotSha256Hasher(),
      validator,
    ),
    authorizationRepository: createStaffAccessRepository(persistence),
    sessionResolver,
  });
