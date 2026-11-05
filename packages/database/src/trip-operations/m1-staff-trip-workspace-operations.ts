import {
  createM1StaffTripWorkspaceOperations,
  type M1StaffSessionResolver,
  type M1StaffTripWorkspaceOperations,
} from "@travelos/backend-core";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { createStaffAccessRepository } from "../staff-access/staff-access-repository.js";
import { createPostgresM1StaffTripWorkspaceRepository } from "./m1-staff-trip-workspace-repository.js";

/** Exposes the authorized read-only Staff workspace operations. */
export const createPostgresM1StaffTripWorkspaceOperations = (
  persistence: PostgresPersistence<Record<string, never>>,
  sessionResolver: M1StaffSessionResolver,
): M1StaffTripWorkspaceOperations =>
  createM1StaffTripWorkspaceOperations({
    repository: createPostgresM1StaffTripWorkspaceRepository(persistence),
    authorizationRepository: createStaffAccessRepository(persistence),
    sessionResolver,
  });
