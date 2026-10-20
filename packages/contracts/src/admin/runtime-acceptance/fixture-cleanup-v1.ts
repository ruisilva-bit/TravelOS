import { z } from "zod";

import { AdminOpaqueIdSchema } from "../money.js";

const CleanupCountSchema = z.number().int().min(0).max(10_000);

export const ADMIN_RUNTIME_ACCEPTANCE_FIXTURE_RUN_HEADER =
  "X-TravelOS-Acceptance-Fixture-Run" as const;

export const AdminRuntimeAcceptanceFixtureCleanupV1RequestSchema = z
  .object({
    idempotencyKey: z
      .string()
      .min(1)
      .max(128)
      .refine(
        (value) =>
          ![...value].some((character) => {
            const codePoint = character.codePointAt(0);
            return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
          }),
      ),
  })
  .strict();

export const AdminRuntimeAcceptanceCleanupV1ResponseSchema = z
  .object({
    fixtureRunId: AdminOpaqueIdSchema,
    state: z.enum(["CLEANED", "CLEANUP_PENDING"]),
    counts: z
      .object({
        grantsRevoked: CleanupCountSchema,
        publicationsWithdrawn: CleanupCountSchema,
        tripsCancelled: CleanupCountSchema,
        principalsRetired: CleanupCountSchema,
      })
      .strict(),
    retainedHistoryCounts: z
      .object({
        publicationSnapshots: CleanupCountSchema,
        auditRecords: CleanupCountSchema,
      })
      .strict(),
    errorCode: z.enum(["CLEANUP_STEP_FAILED", "UNEXPECTED_RESOURCE"]).nullable(),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      (receipt.state === "CLEANED" && receipt.errorCode !== null) ||
      (receipt.state === "CLEANUP_PENDING" && receipt.errorCode === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["errorCode"],
        message: "Cleanup receipt state and error code do not agree",
      });
    }
  });

export const AdminRuntimeAcceptanceFixtureConflictV1ResponseSchema = z
  .object({
    error: z.literal("runtime_acceptance_fixture_conflict"),
    recoveryFixtureRunId: AdminOpaqueIdSchema.optional(),
  })
  .strict();

export type AdminRuntimeAcceptanceFixtureCleanupV1Request = z.infer<
  typeof AdminRuntimeAcceptanceFixtureCleanupV1RequestSchema
>;
export type AdminRuntimeAcceptanceCleanupV1Response = z.infer<
  typeof AdminRuntimeAcceptanceCleanupV1ResponseSchema
>;
export type AdminRuntimeAcceptanceFixtureConflictV1Response = z.infer<
  typeof AdminRuntimeAcceptanceFixtureConflictV1ResponseSchema
>;
