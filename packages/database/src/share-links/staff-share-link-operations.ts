import {
  createStaffShareLinkOperations,
  type StaffSessionResolver,
  type StaffShareLinkOperations,
  type TripSnapshotValidatorPort,
} from "@travelos/backend-core";
import { createTripSnapshotSha256Hasher } from "../customer-presentation/snapshot-hash.js";
import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { createStaffAccessRepository } from "../staff-access/staff-access-repository.js";
import { createShareTokenCrypto } from "./share-token-crypto.js";
import { createPostgresStaffShareLinkRepository } from "./staff-share-link-repository.js";

/** Composes the authorized staff share-link boundary. `publicOrigin` is the canonical origin. */
export const createPostgresStaffShareLinkOperations = (
  persistence: PostgresPersistence<Record<string, never>>,
  sessionResolver: StaffSessionResolver,
  validator: TripSnapshotValidatorPort,
  publicOrigin: string,
): StaffShareLinkOperations =>
  createStaffShareLinkOperations({
    repository: createPostgresStaffShareLinkRepository(
      persistence,
      createTripSnapshotSha256Hasher(),
      validator,
    ),
    authorizationRepository: createStaffAccessRepository(persistence),
    sessionResolver,
    crypto: createShareTokenCrypto(),
    publicOrigin,
  });
