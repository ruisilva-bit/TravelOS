import { z } from "zod";

/**
 * Deliberately small trusted Staff context. It contains no role labels or browser-supplied claims.
 * Bigint authorization epochs are JSON strings by contract.
 */
export const AdminStaffSessionContextSchema = z
  .object({
    principalId: z.string().min(1).max(255),
    agencyId: z.uuid(),
    authorizationEpoch: z.string().regex(/^[1-9][0-9]*$/),
    recentMfaVerifiedAtEpochMs: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type AdminStaffSessionContext = z.infer<typeof AdminStaffSessionContextSchema>;
