import {
  createStaffTripOperations,
  type StaffSessionResolver,
  type StaffTripOperations,
} from "@travelos/backend-core";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { createStaffAccessRepository } from "../staff-access/staff-access-repository.js";
import { createOperationalSliceRepository } from "./operational-slice-repository.js";

/** Exposes authorized Stage 5 operations, never the raw workspace repository factory. */
export const createPostgresStaffTripOperations = (
  persistence: PostgresPersistence<Record<string, never>>,
  sessionResolver: StaffSessionResolver,
): StaffTripOperations =>
  createStaffTripOperations({
    repository: createOperationalSliceRepository(persistence),
    authorizationRepository: createStaffAccessRepository(persistence),
    sessionResolver,
  });
