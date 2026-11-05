import { z } from "zod";

import { AdminLocalDateSchema } from "../itinerary/m1.js";
import { AdminAccommodationDraftSchema, AdminFlightDraftSchema } from "../itinerary/m1.js";
import { AdminLockVersionSchema, AdminPostgresBigintSchema } from "../lock-version.js";

const AdminTripWorkspaceTripDraftV1Schema = z
  .object({
    title: z.string().trim().min(1).max(300),
    startDate: AdminLocalDateSchema,
    endDate: AdminLocalDateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startDate > value.endDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "Trip end date must not precede its start date",
      });
    }
  });

export const AdminTripWorkspaceFlightCreateV1RequestSchema = z
  .object({
    expectedWorkspaceRevision: AdminPostgresBigintSchema,
    flight: AdminFlightDraftSchema,
  })
  .strict();

export const AdminTripWorkspaceFlightUpdateV1RequestSchema = z
  .object({
    expectedLockVersion: AdminLockVersionSchema,
    expectedWorkspaceRevision: AdminPostgresBigintSchema,
    flight: AdminFlightDraftSchema,
  })
  .strict();

export const AdminTripWorkspaceAccommodationCreateV1RequestSchema = z
  .object({
    expectedWorkspaceRevision: AdminPostgresBigintSchema,
    accommodation: AdminAccommodationDraftSchema,
  })
  .strict();

export const AdminTripWorkspaceAccommodationUpdateV1RequestSchema = z
  .object({
    expectedLockVersion: AdminLockVersionSchema,
    expectedWorkspaceRevision: AdminPostgresBigintSchema,
    accommodation: AdminAccommodationDraftSchema,
  })
  .strict();

export const AdminTripWorkspaceTripUpdateV1RequestSchema = z
  .object({
    expectedLockVersion: AdminLockVersionSchema,
    expectedWorkspaceRevision: AdminPostgresBigintSchema,
    trip: AdminTripWorkspaceTripDraftV1Schema,
  })
  .strict();

export type AdminTripWorkspaceFlightCreateV1Request = z.infer<
  typeof AdminTripWorkspaceFlightCreateV1RequestSchema
>;
export type AdminTripWorkspaceFlightUpdateV1Request = z.infer<
  typeof AdminTripWorkspaceFlightUpdateV1RequestSchema
>;
export type AdminTripWorkspaceAccommodationCreateV1Request = z.infer<
  typeof AdminTripWorkspaceAccommodationCreateV1RequestSchema
>;
export type AdminTripWorkspaceAccommodationUpdateV1Request = z.infer<
  typeof AdminTripWorkspaceAccommodationUpdateV1RequestSchema
>;
export type AdminTripWorkspaceTripUpdateV1Request = z.infer<
  typeof AdminTripWorkspaceTripUpdateV1RequestSchema
>;
