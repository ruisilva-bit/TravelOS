import { z } from "zod";

import { AdminCustomerDraftSchema } from "../customers/m1.js";
import { AdminLocalDateSchema } from "../itinerary/m1.js";

export const AdminTripWorkspaceCreateV1RequestSchema = z
  .object({
    customer: AdminCustomerDraftSchema,
    primaryTraveller: z
      .object({
        givenName: z.string().trim().min(1).max(200),
        familyName: z.string().trim().min(1).max(200),
      })
      .strict(),
    trip: z
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
      }),
  })
  .strict();

export type AdminTripWorkspaceCreateV1Request = z.infer<
  typeof AdminTripWorkspaceCreateV1RequestSchema
>;
