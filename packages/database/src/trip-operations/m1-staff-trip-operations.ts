import {
  createM1StaffTripOperations,
  type M1StaffSessionResolver,
  type M1StaffTripOperations,
} from "@travelos/backend-core";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { createStaffAccessRepository } from "../staff-access/staff-access-repository.js";
import { createM1OperationalSliceRepository } from "./m1-operational-slice-repository.js";

/** Exposes authorized Stage 5 operations, never the raw workspace repository factory. */
export const createPostgresM1StaffTripOperations = (
  persistence: PostgresPersistence<Record<string, never>>,
  sessionResolver: M1StaffSessionResolver,
): M1StaffTripOperations =>
  createM1StaffTripOperations({
    repository: createM1OperationalSliceRepository(persistence),
    authorizationRepository: createStaffAccessRepository(persistence),
    sessionResolver,
  });
