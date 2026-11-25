import {
  createStaffTripWorkspaceOperations,
  type StaffSessionResolver,
  type StaffTripWorkspaceOperations,
} from "@travelos/backend-core";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { createStaffAccessRepository } from "../staff-access/staff-access-repository.js";
import { createPostgresStaffTripWorkspaceRepository } from "./staff-trip-workspace-repository.js";

/** Exposes the authorized read-only Staff workspace operations. */
export const createPostgresStaffTripWorkspaceOperations = (
  persistence: PostgresPersistence<Record<string, never>>,
  sessionResolver: StaffSessionResolver,
): StaffTripWorkspaceOperations =>
  createStaffTripWorkspaceOperations({
    repository: createPostgresStaffTripWorkspaceRepository(persistence),
    authorizationRepository: createStaffAccessRepository(persistence),
    sessionResolver,
  });
