import {
  createStaffLeadOperations,
  type StaffLeadOperations,
  type StaffSessionResolver,
} from "@travelos/backend-core";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { createStaffAccessRepository } from "../staff-access/staff-access-repository.js";
import { createPostgresLeadRepository } from "./lead-repository.js";

/** Exposes the authorized Lead use cases over the PostgreSQL adapter. */
export const createPostgresStaffLeadOperations = (
  persistence: PostgresPersistence<Record<string, never>>,
  sessionResolver: StaffSessionResolver,
): StaffLeadOperations =>
  createStaffLeadOperations({
    repository: createPostgresLeadRepository(persistence),
    authorizationRepository: createStaffAccessRepository(persistence),
    sessionResolver,
  });
