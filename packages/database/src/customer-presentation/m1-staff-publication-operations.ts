import {
  createM1StaffTripPublicationOperations,
  type M1StaffSessionResolver,
  type M1StaffTripPublicationOperations,
  type PortalTripSnapshotValidatorPort,
} from "@travelos/backend-core";
import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { createPortalTripSnapshotSha256Hasher } from "../customer-presentation/snapshot-hash.js";
import { createPostgresM1StaffTripPublicationRepository } from "../customer-presentation/staff-publication-repository.js";
import { createStaffAccessRepository } from "../staff-access/staff-access-repository.js";

/** Composes the authorized Stage 6 boundary; callers supply the independent V1 contract validator. */
export const createPostgresM1StaffTripPublicationOperations = (
  persistence: PostgresPersistence<Record<string, never>>,
  sessionResolver: M1StaffSessionResolver,
  validator: PortalTripSnapshotValidatorPort,
): M1StaffTripPublicationOperations =>
  createM1StaffTripPublicationOperations({
    repository: createPostgresM1StaffTripPublicationRepository(
      persistence,
      createPortalTripSnapshotSha256Hasher(),
      validator,
    ),
    authorizationRepository: createStaffAccessRepository(persistence),
    sessionResolver,
  });
