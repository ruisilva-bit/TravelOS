import {
  createPublicQuoteOperations,
  createStaffQuoteOperations,
  type PublicQuoteOperations,
  type StaffQuoteOperations,
  type StaffQuoteOperationsDependencies,
} from "@travelos/backend-core";

import type { PostgresPersistence } from "../postgres/postgres-persistence.js";
import { createStaffAccessRepository } from "../staff-access/staff-access-repository.js";
import { createPostgresQuoteRepository } from "./quote-repository.js";

export type PostgresStaffQuoteDependencies = Pick<
  StaffQuoteOperationsDependencies,
  "sessionResolver" | "shareTokens" | "agencyDisplayName" | "publicBaseUrl" | "nowEpochMs"
>;

/** Authorized quote use cases over the PostgreSQL adapter. */
export const createPostgresStaffQuoteOperations = (
  persistence: PostgresPersistence<Record<string, never>>,
  dependencies: PostgresStaffQuoteDependencies,
): StaffQuoteOperations =>
  createStaffQuoteOperations({
    ...dependencies,
    repository: createPostgresQuoteRepository(persistence),
    authorizationRepository: createStaffAccessRepository(persistence),
  });

/** Token-only public reads and acceptance; no staff session is involved. */
export const createPostgresPublicQuoteOperations = (
  persistence: PostgresPersistence<Record<string, never>>,
  shareTokens: PostgresStaffQuoteDependencies["shareTokens"],
): PublicQuoteOperations =>
  createPublicQuoteOperations({
    repository: createPostgresQuoteRepository(persistence),
    shareTokens,
  });
