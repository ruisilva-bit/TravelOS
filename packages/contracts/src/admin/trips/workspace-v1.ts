import { z } from "zod";

import { AdminAccommodationResponseSchema, AdminFlightResponseSchema } from "../itinerary/m1.js";
import { AdminOpaqueIdSchema } from "../money.js";
import { AdminTripResponseSchema } from "./m1.js";

export const AdminTripWorkspaceListV1QuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^(?:[1-9]|[1-4][0-9]|50)$/u)
      .optional()
      .default("25")
      .transform(Number),
    cursor: AdminOpaqueIdSchema.optional().nullable().default(null),
  })
  .strict();

export const AdminTripWorkspaceListV1ResponseSchema = z
  .object({
    items: z.array(AdminTripResponseSchema).max(50),
    nextCursor: AdminOpaqueIdSchema.nullable(),
  })
  .strict();

export const AdminTripWorkspaceV1ResponseSchema = z
  .object({
    trip: AdminTripResponseSchema,
    flights: z.array(AdminFlightResponseSchema).max(500),
    accommodations: z.array(AdminAccommodationResponseSchema).max(500),
  })
  .strict()
  .superRefine((workspace, context) => {
    for (const [collection, items] of [
      ["flights", workspace.flights],
      ["accommodations", workspace.accommodations],
    ] as const) {
      for (const [index, item] of items.entries()) {
        if (item.agencyId !== workspace.trip.agencyId) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [collection, index, "agencyId"],
            message: "Itinerary item Agency mismatch",
          });
        }
        if (item.tripId !== workspace.trip.id) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [collection, index, "tripId"],
            message: "Itinerary item Trip mismatch",
          });
        }
      }
    }
  });

export type AdminTripWorkspaceListV1Query = z.infer<typeof AdminTripWorkspaceListV1QuerySchema>;
export type AdminTripWorkspaceListV1Response = z.infer<
  typeof AdminTripWorkspaceListV1ResponseSchema
>;
export type AdminTripWorkspaceV1Response = z.infer<typeof AdminTripWorkspaceV1ResponseSchema>;
