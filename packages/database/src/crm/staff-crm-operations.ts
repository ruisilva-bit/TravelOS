import {
  createStaffCrmOperations,
  type StaffCrmOperations,
  type StaffSessionResolver,
} from "@travelos/backend-core";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { createStaffAccessRepository } from "../staff-access/staff-access-repository.js";
import { createPostgresCrmRepository } from "./crm-repository.js";

/** Exposes the authorized Customer, Person and search use cases over the PostgreSQL adapter. */
export const createPostgresStaffCrmOperations = (
  persistence: PostgresPersistence<Record<string, never>>,
  sessionResolver: StaffSessionResolver,
): StaffCrmOperations =>
  createStaffCrmOperations({
    repository: createPostgresCrmRepository(persistence),
    authorizationRepository: createStaffAccessRepository(persistence),
    sessionResolver,
  });
