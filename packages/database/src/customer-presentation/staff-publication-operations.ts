import {
  createStaffTripPublicationOperations,
  type StaffSessionResolver,
  type StaffTripPublicationOperations,
  type TripSnapshotValidatorPort,
} from "@travelos/backend-core";
import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { createTripSnapshotSha256Hasher } from "../customer-presentation/snapshot-hash.js";
import { createPostgresStaffTripPublicationRepository } from "../customer-presentation/staff-publication-repository.js";
import { createStaffAccessRepository } from "../staff-access/staff-access-repository.js";

/** Composes the authorized Stage 6 boundary; callers supply the independent V1 contract validator. */
export const createPostgresStaffTripPublicationOperations = (
  persistence: PostgresPersistence<Record<string, never>>,
  sessionResolver: StaffSessionResolver,
  validator: TripSnapshotValidatorPort,
): StaffTripPublicationOperations =>
  createStaffTripPublicationOperations({
    repository: createPostgresStaffTripPublicationRepository(
      persistence,
      createTripSnapshotSha256Hasher(),
      validator,
    ),
    authorizationRepository: createStaffAccessRepository(persistence),
    sessionResolver,
  });
