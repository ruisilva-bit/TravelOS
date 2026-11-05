import { z } from "zod";

import { PortalTripSnapshotV1Schema } from "./trip-snapshot-v1.js";

const PortalAuthorizedTripListItemV1Schema = z.discriminatedUnion("publicationState", [
  z
    .object({
      tripId: z.string().uuid(),
      publicationState: z.literal("PUBLISHED"),
      snapshot: PortalTripSnapshotV1Schema,
    })
    .strict(),
  z
    .object({
      tripId: z.string().uuid(),
      publicationState: z.literal("NO_PUBLICATION"),
    })
    .strict(),
]);

/** Strict bounded query contract for grant-authorized Portal trip listing. */
export const PortalAuthorizedTripListV1QuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^(?:[1-9]|[1-4]\d|50)$/u)
      .transform(Number)
      .pipe(z.number().int().min(1).max(50))
      .optional()
      .default(25),
    cursor: z.string().uuid().optional().nullable().default(null),
  })
  .strict();

/** Each item is either its current published allowlist or an authorized no-publication marker. */
export const PortalAuthorizedTripListV1ResponseSchema = z
  .object({
    items: z.array(PortalAuthorizedTripListItemV1Schema).max(50),
    nextCursor: z.string().uuid().nullable(),
  })
  .strict();

export type PortalAuthorizedTripListV1Query = z.infer<typeof PortalAuthorizedTripListV1QuerySchema>;
export type PortalAuthorizedTripListV1Response = z.infer<
  typeof PortalAuthorizedTripListV1ResponseSchema
>;
